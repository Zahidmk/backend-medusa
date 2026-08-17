import { ExecArgs } from "@medusajs/framework/types"
import axios from "axios"

import { ODOO_CONFIG } from "../config/odoo"

const ODOO_URL = ODOO_CONFIG.url
const ODOO_DB = ODOO_CONFIG.dbName
const ODOO_USER = ODOO_CONFIG.username
const ODOO_API_KEY = ODOO_CONFIG.apiKey

export default async function testOdoo({ container }: ExecArgs) {
  try {
    const auth = await axios.post(`${ODOO_URL}/jsonrpc`, {
      jsonrpc: "2.0", method: "call",
      params: { service: "common", method: "authenticate", args: [ODOO_DB, ODOO_USER, ODOO_API_KEY, {}] }, id: 1
    })
    const uid = auth.data.result
    
    // Fetch latest 3 sale orders from Odoo
    const orders = await axios.post(`${ODOO_URL}/jsonrpc`, {
      jsonrpc: "2.0", method: "call",
      params: { 
        service: "object", 
        method: "execute_kw", 
        args: [
          ODOO_DB, uid, ODOO_API_KEY, "sale.order", "search_read", 
          [[]], // no domain (all)
          { fields: ["id", "name", "partner_id", "amount_total", "state", "client_order_ref", "create_date"], limit: 3, order: "id desc" }
        ] 
      }, id: 2
    })
    
    console.log("================ LATEST ODOO ORDERS ================")
    orders.data.result.forEach((o: any) => {
       console.log(`- Order: ${o.name} (ID: ${o.id})`)
       console.log(`  Medusa Ref: ${o.client_order_ref || 'None'}`)
       console.log(`  Customer: ${o.partner_id ? o.partner_id[1] : 'None'}`)
       console.log(`  Total: ${o.amount_total} KWD`)
       console.log(`  Status: ${o.state}`)
       console.log(`  Date: ${o.create_date}`)
       console.log("---------------------------------------------------")
    })
  } catch (error) {
    console.error(error)
  }
}
