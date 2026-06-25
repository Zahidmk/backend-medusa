import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import axios from "axios"

/**
 * Order Created Subscriber
 * 
 * When an order is created in MedusaJS, this subscriber
 * will create a corresponding sale order in Odoo.
 * 
 * IMPORTANT: This matches products by SKU (default_code in Odoo)
 * so that stock is automatically reduced when order is confirmed.
 */

const ODOO_URL = process.env.ODOO_URL || "https://oskarllc-new-31031096.dev.odoo.com"
const ODOO_DB = process.env.ODOO_DB_NAME || "oskarllc-stage-27028831"
const ODOO_USER = process.env.ODOO_USERNAME || "SYG"
const ODOO_API_KEY = process.env.ODOO_API_KEY || ""

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
    console.error("Odoo authentication failed:", error)
    return null
  }
}

/**
 * Find Odoo product by SKU (default_code)
 */
async function findOdooProductBySku(uid: number, sku: string): Promise<number | null> {
  try {
    // First try to match by default_code (SKU)
    let response = await axios.post(`${ODOO_URL}/jsonrpc`, {
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [ODOO_DB, uid, ODOO_API_KEY, "product.product", "search", [[["default_code", "=", sku]]]]
      },
      id: 10
    })
    
    if (response.data.result && response.data.result.length > 0) {
      return response.data.result[0]
    }
    
    // Try with ODOO- prefix stripped
    if (sku.startsWith("ODOO-")) {
      const odooId = parseInt(sku.replace("ODOO-", ""))
      if (!isNaN(odooId)) {
        return odooId
      }
    }
    
    return null
  } catch (error) {
    console.error(`Failed to find Odoo product for SKU ${sku}:`, error)
    return null
  }
}

async function createOdooOrder(uid: number, orderData: any, logger: any): Promise<{ orderId: number | null, confirmed: boolean }> {
  try {
    // First, find or create the customer in Odoo
    const customerEmail = orderData.email || orderData.customer?.email
    const customerName = `${orderData.shipping_address?.first_name || ""} ${orderData.shipping_address?.last_name || ""}`.trim() || "Guest Customer"
    
    // Search for existing partner
    let partnerId: number
    const partnerSearch = await axios.post(`${ODOO_URL}/jsonrpc`, {
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [ODOO_DB, uid, ODOO_API_KEY, "res.partner", "search", [[["email", "=", customerEmail]]]]
      },
      id: 2
    })
    
    if (partnerSearch.data.result && partnerSearch.data.result.length > 0) {
      partnerId = partnerSearch.data.result[0]
      logger.info(`  Found existing Odoo partner: ${partnerId}`)
    } else {
      // Create new partner
      const partnerCreate = await axios.post(`${ODOO_URL}/jsonrpc`, {
        jsonrpc: "2.0",
        method: "call",
        params: {
          service: "object",
          method: "execute_kw",
          args: [ODOO_DB, uid, ODOO_API_KEY, "res.partner", "create", [{
            name: customerName,
            email: customerEmail,
            phone: orderData.shipping_address?.phone || "",
            street: orderData.shipping_address?.address_1 || "",
            city: orderData.shipping_address?.city || "",
            zip: orderData.shipping_address?.postal_code || "",
            customer_rank: 1
          }]]
        },
        id: 3
      })
      partnerId = partnerCreate.data.result
      logger.info(`  Created new Odoo partner: ${partnerId}`)
    }
    
    // Build order lines with product_id for stock reduction
    const orderLines: any[] = []
    for (const item of (orderData.items || [])) {
      const sku = item.variant?.sku || item.sku || ""
      const productName = item.title || item.variant?.title || "Product"
      
      // Try to find matching Odoo product by SKU
      const odooProductId = sku ? await findOdooProductBySku(uid, sku) : null
      
      const lineData: any = {
        name: productName,
        product_uom_qty: item.quantity || 1,
        price_unit: (item.unit_price || 0) / 1000, // Convert from fils (KWD has 3 decimals)
      }
      
      if (odooProductId) {
        lineData.product_id = odooProductId
        logger.info(`  ✅ Matched SKU "${sku}" to Odoo product ID: ${odooProductId}`)
      } else {
        logger.warn(`  ⚠️ Could not find Odoo product for SKU: ${sku}`)
      }
      
      orderLines.push([0, 0, lineData])
    }
    
    // Create sale order
    const orderCreate = await axios.post(`${ODOO_URL}/jsonrpc`, {
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [ODOO_DB, uid, ODOO_API_KEY, "sale.order", "create", [{
          partner_id: partnerId,
          client_order_ref: orderData.id,
          note: `Order from Marqa Souq - ${orderData.id}`,
          order_line: orderLines
        }]]
      },
      id: 4
    })
    
    const odooOrderId = orderCreate.data.result
    if (!odooOrderId) {
      return { orderId: null, confirmed: false }
    }
    
    logger.info(`  📝 Created Odoo sale order: ${odooOrderId}`)
    
    // Confirm the sale order to reduce stock
    let confirmed = false
    try {
      const confirmResponse = await axios.post(`${ODOO_URL}/jsonrpc`, {
        jsonrpc: "2.0",
        method: "call",
        params: {
          service: "object",
          method: "execute_kw",
          args: [ODOO_DB, uid, ODOO_API_KEY, "sale.order", "action_confirm", [[odooOrderId]]]
        },
        id: 5
      })
      
      if (confirmResponse.data.result !== false) {
        confirmed = true
        logger.info(`  ✅ Confirmed order in Odoo - stock will be reduced`)
      }
    } catch (confirmError: any) {
      logger.warn(`  ⚠️ Could not auto-confirm order: ${confirmError.message}`)
    }
    
    return { orderId: odooOrderId, confirmed }
  } catch (error) {
    console.error("Failed to create Odoo order:", error)
    return { orderId: null, confirmed: false }
  }
}

export default async function orderCreatedHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve("logger")
  const orderId = event.data.id
  
  logger.info(`📦 Order created: ${orderId} - Syncing to Odoo...`)
  
  try {
    // Medusa v2: use the order module service correctly
    // The module key in v2 is "order" but the service has method `retrieve` not `retrieveOrder`
    let order: any = null
    
    try {
      const orderModuleService = container.resolve("order")
      // v2 uses `.retrieve()` with proper selects/relations config
      order = await orderModuleService.retrieve(orderId, {
        relations: ["items", "items.variant", "shipping_address", "shipping_address.*"],
        select: [
          "id", "email", "status",
          "items.id", "items.title", "items.quantity", "items.unit_price",
          "items.variant.id", "items.variant.sku",
          "shipping_address.first_name", "shipping_address.last_name",
          "shipping_address.address_1", "shipping_address.city",
          "shipping_address.postal_code", "shipping_address.phone",
        ]
      })
    } catch (resolveErr: any) {
      logger.warn(`Direct order module resolve failed (${resolveErr.message}), trying query service...`)
      
      // Fallback: use the query service (available in Medusa v2)
      try {
        const query = container.resolve("query")
        const { data: orders } = await query.graph({
          entity: "order",
          filters: { id: orderId },
          fields: [
            "id", "email", "status",
            "items.*",
            "items.variant.*",
            "shipping_address.*",
          ]
        })
        order = orders?.[0] ?? null
      } catch (queryErr: any) {
        logger.warn(`Query service also failed: ${queryErr.message}`)
      }
    }

    if (!order) {
      logger.warn(`Could not retrieve order ${orderId} - skipping Odoo sync`)
      return
    }
    
    // Authenticate with Odoo
    const uid = await authenticateOdoo()
    if (!uid) {
      logger.warn("Could not authenticate with Odoo, order not synced")
      return
    }
    
    // Create order in Odoo (with product matching and confirmation)
    const { orderId: odooOrderId, confirmed } = await createOdooOrder(uid, order, logger)
    
    if (odooOrderId) {
      logger.info(`✅ Order ${orderId} synced to Odoo as order ID: ${odooOrderId}`)
      if (confirmed) {
        logger.info(`✅ Stock reduced in Odoo for order ${odooOrderId}`)
      }
    } else {
      logger.warn(`Failed to sync order ${orderId} to Odoo`)
    }
  } catch (error: any) {
    logger.error(`Error syncing order to Odoo: ${error.message}`)
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
