import { ExecArgs } from "@medusajs/framework/types"
import axios from "axios"

/**
 * Odoo Order Sync Script
 * 
 * Syncs orders between Odoo and MedusaJS
 * Run with: yarn sync:orders
 */

const ODOO_URL = process.env.ODOO_URL || "https://oskarllc-new-31031096.dev.odoo.com"
const ODOO_DB = process.env.ODOO_DB_NAME || "oskarllc-new-31031096"
const ODOO_USER = process.env.ODOO_USERNAME || "SYG"
const ODOO_PASS = process.env.ODOO_PASSWORD || "S123456"

interface OdooOrder {
  id: number
  name: string
  partner_id: [number, string]
  date_order: string
  state: string
  amount_total: number
  amount_tax: number
  amount_untaxed: number
  order_line: number[]
  currency_id: [number, string]
}

interface OdooOrderLine {
  id: number
  product_id: [number, string] | false
  name: string
  product_uom_qty: number
  price_unit: number
  price_subtotal: number
  price_total: number
}

async function odooJsonRpc(uid: number, model: string, method: string, args: any[], kwargs: any = {}) {
  const response = await axios.post(`${ODOO_URL}/jsonrpc`, {
    jsonrpc: "2.0",
    method: "call",
    params: {
      service: "object",
      method: "execute_kw",
      args: [ODOO_DB, uid, ODOO_PASS, model, method, args, kwargs]
    },
    id: Date.now()
  })
  return response.data.result
}

export default async function syncOdooOrders({ container }: ExecArgs) {
  console.log("\n📦 Starting Odoo Order Sync...")
  console.log("=" .repeat(50))
  
  // Authenticate with Odoo
  console.log("\n1️⃣ Authenticating with Odoo...")
  
  let uid: number
  try {
    const authResponse = await axios.post(`${ODOO_URL}/jsonrpc`, {
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "common",
        method: "authenticate",
        args: [ODOO_DB, ODOO_USER, ODOO_PASS, {}]
      },
      id: 1
    })
    
    uid = authResponse.data.result
    if (!uid) {
      console.error("❌ Authentication failed")
      return
    }
    console.log(`✅ Authenticated (UID: ${uid})`)
  } catch (error: any) {
    console.error("❌ Authentication failed:", error.message)
    return
  }
  
  // Fetch orders from Odoo
  console.log("\n2️⃣ Fetching orders from Odoo...")
  
  const orders: OdooOrder[] = await odooJsonRpc(uid, "sale.order", "search_read", 
    [[]],
    { 
      fields: ["id", "name", "partner_id", "date_order", "state", "amount_total", 
               "amount_tax", "amount_untaxed", "order_line", "currency_id"],
      order: "date_order desc",
      limit: 100
    }
  )
  
  console.log(`📦 Found ${orders.length} orders in Odoo`)
  
  if (orders.length === 0) {
    console.log("\n⚠️ No orders found in Odoo.")
    console.log("   Orders will sync automatically when created in Odoo.")
    
    // Show summary of available data
    console.log("\n📊 Current Odoo Data:")
    
    const productCount = await odooJsonRpc(uid, "product.product", "search_count", [[["sale_ok", "=", true]]])
    console.log(`   - Products: ${productCount}`)
    
    const customerCount = await odooJsonRpc(uid, "res.partner", "search_count", [[["customer_rank", ">", 0]]])
    console.log(`   - Customers: ${customerCount}`)
    
    const orderCount = await odooJsonRpc(uid, "sale.order", "search_count", [[]])
    console.log(`   - Orders: ${orderCount}`)
    
    return
  }
  
  // Process orders
  console.log("\n3️⃣ Processing orders...")
  
  for (const order of orders.slice(0, 10)) {
    console.log(`\n   Order: ${order.name}`)
    console.log(`   - Customer: ${order.partner_id[1]}`)
    console.log(`   - Date: ${order.date_order}`)
    console.log(`   - State: ${order.state}`)
    console.log(`   - Total: ${order.amount_total} ${order.currency_id[1]}`)
    
    // Get order lines
    if (order.order_line.length > 0) {
      const lines: OdooOrderLine[] = await odooJsonRpc(uid, "sale.order.line", "search_read",
        [[["order_id", "=", order.id]]],
        { fields: ["product_id", "name", "product_uom_qty", "price_unit", "price_subtotal"] }
      )
      
      console.log(`   - Items: ${lines.length}`)
      lines.forEach(line => {
        const productName = line.product_id ? line.product_id[1] : line.name
        console.log(`     • ${productName.substring(0, 40)} x${line.product_uom_qty} @ ${line.price_unit}`)
      })
    }
  }
  
  console.log("\n" + "=" .repeat(50))
  console.log("✅ Order sync completed!")
}
