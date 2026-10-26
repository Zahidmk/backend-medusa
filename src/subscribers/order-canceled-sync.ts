import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import axios from "axios"
import { ODOO_CONFIG } from "../config/odoo"
import { createRefundDueForCancelledOrder, isKnetPaid, loadOrder } from "../lib/return-requests"

/**
 * order.canceled (customer, admin, or Odoo):
 *  1. If the order was paid online with KNET, record that a refund is owed so
 *     admin sees it under "Returns & Refunds" (KNET refunds are made manually).
 *  2. Cancel the matching sale order in Odoo, unless the cancel came from Odoo.
 */
async function odooCall(model: string, method: string, args: any[], uid: number) {
  const r = await axios.post(`${ODOO_CONFIG.url}/jsonrpc`, {
    jsonrpc: "2.0",
    method: "call",
    params: { service: "object", method: "execute_kw", args: [ODOO_CONFIG.dbName, uid, ODOO_CONFIG.apiKey, model, method, args] },
    id: 1,
  })
  if (r.data.error) throw new Error(r.data.error.data?.message || r.data.error.message)
  return r.data.result
}

export default async function orderCanceledSyncHandler({ event, container }: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve("logger")
  const orderId = event.data.id

  try {
    const order = await loadOrder(container, orderId)
    if (!order) return

    // 1. Refund owed for online payments
    try {
      const pg = container.resolve("__pg_connection__") as any
      if (await isKnetPaid(pg, orderId)) {
        const created = await createRefundDueForCancelledOrder(container, order)
        if (created) logger.info(`[CancelSync] Refund due recorded for KNET order #${order.display_id}`)
      }
    } catch (err: any) {
      logger.error(`[CancelSync] Could not record refund due for ${orderId}: ${err.message}`)
    }

    // 2. Mirror the cancellation in Odoo (skip when Odoo is the source)
    if (order.metadata?.odoo_cancelled) return
    const auth = await axios.post(`${ODOO_CONFIG.url}/jsonrpc`, {
      jsonrpc: "2.0",
      method: "call",
      params: { service: "common", method: "authenticate", args: [ODOO_CONFIG.dbName, ODOO_CONFIG.username, ODOO_CONFIG.apiKey, {}] },
      id: 1,
    })
    const uid = auth.data.result
    if (!uid) {
      logger.warn(`[CancelSync] Odoo auth failed — order #${order.display_id} not cancelled in Odoo`)
      return
    }
    const ids: number[] = await odooCall("sale.order", "search", [[["client_order_ref", "=", orderId], ["state", "!=", "cancel"]]], uid)
    for (const id of ids) {
      await odooCall("sale.order", "action_cancel", [[id]], uid)
      logger.info(`[CancelSync] Cancelled Odoo sale order ${id} for Medusa order #${order.display_id}`)
    }
    if (!ids.length) logger.warn(`[CancelSync] No open Odoo sale order found for order #${order.display_id}`)
  } catch (err: any) {
    logger.error(`[CancelSync] Failed for ${orderId}: ${err.message}`)
  }
}

export const config: SubscriberConfig = {
  event: "order.canceled",
}
