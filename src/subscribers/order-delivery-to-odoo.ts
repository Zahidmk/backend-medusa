import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import axios from "axios"

/**
 * Order Delivered Subscriber → Odoo Delivery Validation
 * 
 * When an order is marked as completed/delivered in Medusa,
 * this subscriber finds the corresponding Odoo Sales Order
 * and automatically validates its Delivery Order (stock.picking).
 */

import { ODOO_CONFIG } from "../config/odoo"

const ODOO_URL = ODOO_CONFIG.url
const ODOO_DB = ODOO_CONFIG.dbName
const ODOO_USER = ODOO_CONFIG.username
const ODOO_API_KEY = ODOO_CONFIG.apiKey

async function authenticateOdoo(): Promise<number | null> {
  try {
    const response = await axios.post(`${ODOO_URL}/jsonrpc`, {
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "common",
        method: "authenticate",
        args: [ODOO_DB, ODOO_USER, ODOO_API_KEY, {}]
      },
      id: 1
    })
    return response.data.result || null
  } catch (error) {
    console.error("[Odoo Delivery Sync] Authentication failed:", error)
    return null
  }
}

async function validateOdooDelivery(uid: number, medusaOrderId: string, logger: any): Promise<boolean> {
  try {
    // 1. Search for matching sale.order in Odoo
    const orderSearch = await axios.post(`${ODOO_URL}/jsonrpc`, {
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [
          ODOO_DB, uid, ODOO_API_KEY, "sale.order", "search_read",
          [[["client_order_ref", "=", medusaOrderId]]],
          { fields: ["id", "name", "picking_ids", "state"] }
        ]
      },
      id: 2
    })

    let saleOrders = orderSearch.data.result || []

    // Fallback: search by note containing medusaOrderId
    if (saleOrders.length === 0) {
      const fallbackSearch = await axios.post(`${ODOO_URL}/jsonrpc`, {
        jsonrpc: "2.0",
        method: "call",
        params: {
          service: "object",
          method: "execute_kw",
          args: [
            ODOO_DB, uid, ODOO_API_KEY, "sale.order", "search_read",
            [[["note", "ilike", medusaOrderId]]],
            { fields: ["id", "name", "picking_ids", "state"] }
          ]
        },
        id: 3
      })
      saleOrders = fallbackSearch.data.result || []
    }

    if (saleOrders.length === 0) {
      logger.warn(`[Odoo Delivery Sync] Could not find Odoo Sales Order for Medusa Order ${medusaOrderId}`)
      return false
    }

    const odooSaleOrder = saleOrders[0]
    logger.info(`[Odoo Delivery Sync] Found Odoo Sales Order: ${odooSaleOrder.name} (ID: ${odooSaleOrder.id})`)

    // 2. Search for pending stock.picking (delivery orders)
    const pickingSearch = await axios.post(`${ODOO_URL}/jsonrpc`, {
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [
          ODOO_DB, uid, ODOO_API_KEY, "stock.picking", "search_read",
          [[
            ["origin", "=", odooSaleOrder.name],
            ["state", "not in", ["done", "cancel"]]
          ]],
          { fields: ["id", "name", "state", "move_ids_without_package"] }
        ]
      },
      id: 4
    })

    const pendingPickings = pickingSearch.data.result || []

    if (pendingPickings.length === 0) {
      logger.info(`[Odoo Delivery Sync] No pending delivery pickings found for Odoo Order ${odooSaleOrder.name} (may already be validated).`)
      return true
    }

    // 3. Process and validate each pending delivery picking
    for (const picking of pendingPickings) {
      logger.info(`[Odoo Delivery Sync] Validating Odoo Delivery Picking: ${picking.name} (ID: ${picking.id})...`)

      // A. Reserve items if needed
      await axios.post(`${ODOO_URL}/jsonrpc`, {
        jsonrpc: "2.0",
        method: "call",
        params: {
          service: "object",
          method: "execute_kw",
          args: [ODOO_DB, uid, ODOO_API_KEY, "stock.picking", "action_assign", [[picking.id]]]
        },
        id: 5
      })

      // B. Fetch stock moves and set quantities done
      const moveSearch = await axios.post(`${ODOO_URL}/jsonrpc`, {
        jsonrpc: "2.0",
        method: "call",
        params: {
          service: "object",
          method: "execute_kw",
          args: [
            ODOO_DB, uid, ODOO_API_KEY, "stock.move", "search_read",
            [[["picking_id", "=", picking.id]]],
            { fields: ["id", "product_uom_qty", "quantity_done", "quantity"] }
          ]
        },
        id: 6
      })

      const moves = moveSearch.data.result || []
      for (const move of moves) {
        const targetQty = move.product_uom_qty || 1
        try {
          // Set quantity_done for Odoo 16 or quantity for Odoo 17/18
          await axios.post(`${ODOO_URL}/jsonrpc`, {
            jsonrpc: "2.0",
            method: "call",
            params: {
              service: "object",
              method: "execute_kw",
              args: [
                ODOO_DB, uid, ODOO_API_KEY, "stock.move", "write",
                [[move.id], { quantity_done: targetQty }]
              ]
            },
            id: 7
          })
        } catch {
          try {
            await axios.post(`${ODOO_URL}/jsonrpc`, {
              jsonrpc: "2.0",
              method: "call",
              params: {
                service: "object",
                method: "execute_kw",
                args: [
                  ODOO_DB, uid, ODOO_API_KEY, "stock.move", "write",
                  [[move.id], { quantity: targetQty }]
                ]
              },
              id: 8
            })
          } catch {}
        }
      }

      // C. Execute button_validate to mark picking as DONE (Delivered)
      const validateRes = await axios.post(`${ODOO_URL}/jsonrpc`, {
        jsonrpc: "2.0",
        method: "call",
        params: {
          service: "object",
          method: "execute_kw",
          args: [
            ODOO_DB, uid, ODOO_API_KEY, "stock.picking", "button_validate",
            [[picking.id]]
          ],
          kwargs: {
            context: {
              skip_immediate: true,
              skip_expired: true,
              skip_backorder: true
            }
          }
        },
        id: 9
      })

      if (validateRes.data.error) {
        logger.warn(`[Odoo Delivery Sync] Notice during button_validate for ${picking.name}: ${JSON.stringify(validateRes.data.error.data || validateRes.data.error)}`)
      } else {
        logger.info(`[Odoo Delivery Sync] ✅ Successfully validated Delivery Order ${picking.name} in Odoo!`)
      }
    }

    return true
  } catch (err: any) {
    logger.error(`[Odoo Delivery Sync] Error validating delivery in Odoo: ${err.message}`)
    return false
  }
}

export default async function orderDeliveredHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve("logger")
  const orderId = event.data.id

  if (!orderId) return

  logger.info(`🚚 Order marked as delivered/completed in Medusa: ${orderId} - Validating Odoo Delivery...`)

  const uid = await authenticateOdoo()
  if (!uid) {
    logger.warn("[Odoo Delivery Sync] Skipping delivery validation - Odoo authentication failed.")
    return
  }

  await validateOdooDelivery(uid, orderId, logger)
}

export const config: SubscriberConfig = {
  event: "order.completed",
}
