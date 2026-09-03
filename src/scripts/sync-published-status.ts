import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import axios from "axios"

/**
 * Script to sync product published status strictly based on Odoo's `is_published` / `website_published` field.
 * Only products marked as Published in Odoo will have `status = 'published'` in Medusa (and appear on frontend).
 * All other products will have `status = 'draft'` (hidden from storefront).
 */
export default async function syncPublishedStatus({ container }: ExecArgs) {
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  const ODOO_URL = process.env.ODOO_URL || "https://oskarllc-new-36501645.dev.odoo.com"
  const ODOO_DB = process.env.ODOO_DB_NAME || "oskarllc-new-36501645"
  const ODOO_USER = process.env.ODOO_USERNAME || "SYG"
  const ODOO_PASSWORD = process.env.ODOO_PASSWORD || "123"

  console.log("🔒 Syncing product published status from Odoo...")

  try {
    // Authenticate with Odoo
    const authRes = await axios.post(`${ODOO_URL}/jsonrpc`, {
      jsonrpc: "2.0", method: "call",
      params: { service: "common", method: "login", args: [ODOO_DB, ODOO_USER, ODOO_PASSWORD] }
    })
    const uid = authRes.data.result
    if (!uid) {
      throw new Error("Failed to authenticate with Odoo")
    }

    // Search all published products in Odoo
    const pubRes = await axios.post(`${ODOO_URL}/jsonrpc`, {
      jsonrpc: "2.0", method: "call",
      params: {
        service: "object", method: "execute_kw",
        args: [
          ODOO_DB, uid, ODOO_PASSWORD,
          "product.template", "search_read",
          [[["is_published", "=", true]]],
          { fields: ["id", "name", "default_code"] }
        ]
      }
    })

    const publishedOdooProds = pubRes.data.result || []
    console.log(`Found ${publishedOdooProds.length} published product(s) in Odoo.`)

    const publishedOdooIds = publishedOdooProds.map((p: any) => String(p.id))

    // 1. Reset all products to draft
    await pg.raw(`UPDATE product SET status = 'draft', updated_at = NOW() WHERE deleted_at IS NULL`)

    // 2. Publish products that have is_published = true in Odoo
    if (publishedOdooIds.length > 0) {
      const res = await pg.raw(`
        UPDATE product 
        SET status = 'published', updated_at = NOW() 
        WHERE metadata->>'odoo_id' = ANY(?) AND deleted_at IS NULL
      `, [publishedOdooIds])
      console.log(`✅ Set status = 'published' for ${res.rowCount || 0} product(s) in Medusa!`)
    } else {
      console.log("ℹ️ No products marked as is_published = true in Odoo.")
    }

  } catch (err: any) {
    console.error("❌ Failed to sync published status:", err.message)
  }
}
