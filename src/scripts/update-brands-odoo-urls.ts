import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ODOO_CONFIG } from "../config/odoo"

/**
 * Update Brand Logo URLs to point directly to Odoo
 * 
 * Replaces any local /static/uploads/ relative URLs with direct Odoo image URLs
 * e.g. {ODOO_URL}/web/image/custom.product.brand/:id/image_1920
 * 
 * Usage: npx medusa exec ./src/scripts/update-brands-odoo-urls.ts
 */
export default async function updateBrandsOdooUrls({ container }: ExecArgs) {
  const pgConnection = container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as any
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as any

  let odooSyncService: any
  try {
    odooSyncService = container.resolve("odoo_sync")
  } catch {
    try { odooSyncService = container.resolve("odooSyncService") } catch {}
  }

  const odooUrl = ODOO_CONFIG.url

  logger.info("🔄 Fetching brands from Odoo to map direct Odoo image URLs...")

  if (!odooSyncService) {
    logger.error("OdooSyncService not available.")
    return
  }

  try {
    const odooBrands = await odooSyncService.fetchBrands()
    logger.info(`Found ${odooBrands?.length || 0} brands in Odoo.`)

    let updatedCount = 0

    for (const b of (odooBrands || [])) {
      const name = (b.name || "").trim()
      if (!name || !b.id) continue

      const directOdooUrl = `${odooUrl}/api/brand/image/${b.id}`

      const res = await pgConnection.raw(
        `UPDATE brand SET logo_url = ?, updated_at = NOW() WHERE LOWER(name) = ? RETURNING id, name`,
        [directOdooUrl, name.toLowerCase()]
      )

      if (res.rows?.length > 0) {
        logger.info(`  ✓ Updated brand ${name} -> ${directOdooUrl}`)
        updatedCount += res.rows.length
      }
    }

    logger.info(`🎉 Successfully updated ${updatedCount} brands to direct Odoo image URLs!`)
  } catch (err: any) {
    logger.error(`Failed to update brand image URLs: ${err.message}`)
  }
}
