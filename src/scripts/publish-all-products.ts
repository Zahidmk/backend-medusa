import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Script to publish all active Medusa products so they are visible on the storefront.
 * Odoo sets `is_published: false` by default for catalog items, which caused Medusa 
 * to mark products as `status = draft` (hidden from storefront API).
 */
export default async function publishAllProducts({ container }: ExecArgs) {
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  console.log("📢 Publishing all active products to storefront...")

  try {
    const result = await pg.raw(`
      UPDATE product
      SET status = 'published', updated_at = NOW()
      WHERE status = 'draft' AND deleted_at IS NULL
    `)

    console.log(`✅ Successfully published ${result.rowCount || 0} product(s)! They are now visible on the storefront.`)
  } catch (err: any) {
    console.error("❌ Failed to publish products:", err.message)
  }
}
