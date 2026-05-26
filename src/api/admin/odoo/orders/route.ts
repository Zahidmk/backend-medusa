import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import axios from "axios"

const ODOO_URL = process.env.ODOO_URL || "https://oskarllc-new-31031096.dev.odoo.com"
const ODOO_DB = process.env.ODOO_DB_NAME || "oskarllc-new-31031096"
const ODOO_USER = process.env.ODOO_USERNAME || "SYG"
const ODOO_PASS = process.env.ODOO_PASSWORD || "S123456"

/**
 * GET /admin/odoo/orders - Fetch orders from Odoo
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    // Authenticate with Odoo
    const authRes = await axios.post(`${ODOO_URL}/jsonrpc`, {
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "common",
        method: "authenticate",
        args: [ODOO_DB, ODOO_USER, ODOO_PASS, {}]
      },
      id: 1
    })
    
    const uid = authRes.data.result
    if (!uid) {
      return res.status(401).json({ error: "Failed to authenticate with Odoo" })
    }
    
    // Fetch orders
    const ordersRes = await axios.post(`${ODOO_URL}/jsonrpc`, {
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [
          ODOO_DB, uid, ODOO_PASS,
          "sale.order", "search_read",
          [[]],
          {
            fields: ["id", "name", "partner_id", "date_order", "state", 
                     "amount_total", "amount_tax", "order_line", "currency_id"],
            order: "date_order desc",
            limit: 50
          }
        ]
      },
      id: 2
    })
    
    const orders = ordersRes.data.result || []
    
    // Get order lines for each order
    const ordersWithLines = await Promise.all(orders.map(async (order: any) => {
      if (order.order_line && order.order_line.length > 0) {
        const linesRes = await axios.post(`${ODOO_URL}/jsonrpc`, {
          jsonrpc: "2.0",
          method: "call",
          params: {
            service: "object",
            method: "execute_kw",
            args: [
              ODOO_DB, uid, ODOO_PASS,
              "sale.order.line", "search_read",
              [[["order_id", "=", order.id]]],
              { fields: ["product_id", "name", "product_uom_qty", "price_unit", "price_subtotal"] }
            ]
          },
          id: 3
        })
        order.items = linesRes.data.result || []
      } else {
        order.items = []
      }
      return order
    }))
    
    return res.json({
      success: true,
      count: orders.length,
      orders: ordersWithLines
    })
    
  } catch (error: any) {
    return res.status(500).json({ 
      error: "Failed to fetch orders from Odoo",
      message: error.message 
    })
  }
}

/**
 * POST /admin/odoo/orders - Create order in Odoo from MedusaJS order
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { order_id } = req.body as { order_id: string }
    
    if (!order_id) {
      return res.status(400).json({ error: "order_id is required" })
    }
    
    // Get order from MedusaJS
    const orderService = req.scope.resolve("order")
    const order = await orderService.retrieveOrder(order_id, {
      relations: ["items", "shipping_address"]
    }) as any
    
    if (!order) {
      return res.status(404).json({ error: "Order not found" })
    }
    
    // Authenticate with Odoo
    const authRes = await axios.post(`${ODOO_URL}/jsonrpc`, {
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "common",
        method: "authenticate",
        args: [ODOO_DB, ODOO_USER, ODOO_PASS, {}]
      },
      id: 1
    })
    
    const uid = authRes.data.result
    if (!uid) {
      return res.status(401).json({ error: "Failed to authenticate with Odoo" })
    }
    
    // Find or create customer in Odoo
    let partnerId: number
    
    const customerEmail = order.email || "customer@marqasouq.com"
    const existingPartner = await axios.post(`${ODOO_URL}/jsonrpc`, {
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [
          ODOO_DB, uid, ODOO_PASS,
          "res.partner", "search",
          [[["email", "=", customerEmail]]]
        ]
      },
      id: 2
    })
    
    if (existingPartner.data.result && existingPartner.data.result.length > 0) {
      partnerId = existingPartner.data.result[0]
    } else {
      // Create new partner
      const createPartner = await axios.post(`${ODOO_URL}/jsonrpc`, {
        jsonrpc: "2.0",
        method: "call",
        params: {
          service: "object",
          method: "execute_kw",
          args: [
            ODOO_DB, uid, ODOO_PASS,
            "res.partner", "create",
            [{
              name: order.shipping_address?.first_name + " " + order.shipping_address?.last_name,
              email: customerEmail,
              phone: order.shipping_address?.phone,
              street: order.shipping_address?.address_1,
              city: order.shipping_address?.city,
              zip: order.shipping_address?.postal_code,
              country_id: 1 // Default country
            }]
          ]
        },
        id: 3
      })
      partnerId = createPartner.data.result
    }
    
    // Create order in Odoo
    const orderLines = order.items?.map((item: any) => {
      return [0, 0, {
        name: item.title || item.variant?.product?.title || "Product",
        product_uom_qty: item.quantity,
        price_unit: item.unit_price / 100 // Convert from cents
      }]
    }) || []
    
    const createOrder = await axios.post(`${ODOO_URL}/jsonrpc`, {
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [
          ODOO_DB, uid, ODOO_PASS,
          "sale.order", "create",
          [{
            partner_id: partnerId,
            order_line: orderLines,
            client_order_ref: order.id,
            note: `Synced from MedusaJS - Order ${order.display_id}`
          }]
        ]
      },
      id: 4
    })
    
    const odooOrderId = createOrder.data.result
    
    return res.json({
      success: true,
      message: "Order synced to Odoo",
      medusa_order_id: order.id,
      odoo_order_id: odooOrderId
    })
    
  } catch (error: any) {
    return res.status(500).json({
      error: "Failed to sync order to Odoo",
      message: error.message
    })
  }
}
