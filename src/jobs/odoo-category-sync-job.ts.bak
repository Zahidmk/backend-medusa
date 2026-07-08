/**
 * Odoo Category Auto-Sync Job
 *
 * Runs every 15 minutes. Fetches ALL public categories from Odoo
 * and creates/updates them in Medusa so the storefront always stays
 * in sync with whatever is in Odoo — no manual intervention needed.
 */
import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

function slugify(text: string): string {
  let slug = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/(^-|-$)/g, "")
    .substring(0, 100)
  // Fallback: if slug is empty (e.g., Arabic/Unicode text), generate one
  if (!slug) {
    slug = `cat-${Date.now().toString(36)}${Math.random().toString(36).substring(2, 6)}`
  }
  return slug
}

// Category names to exclude from syncing to the website
const EXCLUDED_CATEGORY_PATTERNS = [
  'expo', 'wholesale', 'previous', 'test category', 'demo', 'archive',
  'old category', 'deprecated', 'draft'
]

export default async function odooCategorySyncJob(container: MedusaContainer) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const pgConnection = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const productService = container.resolve(Modules.PRODUCT)

  let odooSyncService: any
  try {
    odooSyncService = container.resolve("odoo_sync")
  } catch {
    logger.warn("[Odoo Category Sync] OdooSyncService not registered, skipping.")
    return
  }

  if (!odooSyncService.isConfigured?.()) {
    logger.warn("[Odoo Category Sync] Odoo not configured, skipping.")
    return
  }

  logger.info("[Odoo Category Sync] Fetching categories from Odoo...")

  try {
    const odooCategories: any[] = await odooSyncService.fetchPublicCategories()

    if (!odooCategories || odooCategories.length === 0) {
      logger.info("[Odoo Category Sync] No categories returned from Odoo.")
      return
    }

    logger.info(`[Odoo Category Sync] Got ${odooCategories.length} categories from Odoo (before filtering).`)

    // Filter out unwanted categories (expo, wholesale, etc.)
    const filteredCategories = odooCategories.filter((cat: any) => {
      const name = (cat.name || '').toLowerCase().trim()
      return !EXCLUDED_CATEGORY_PATTERNS.some(pattern => name.includes(pattern))
    })

    if (filteredCategories.length < odooCategories.length) {
      logger.info(`[Odoo Category Sync] Excluded ${odooCategories.length - filteredCategories.length} categories (expo/wholesale/etc.).`)
    }

    let created = 0
    let updated = 0
    let errors = 0
    const odooIdToHandle = new Map<number, string>()

    // Sort categories by parent_path depth (number of slashes or path length)
    // shorter paths (roots/parents) will be processed first,
    // ensuring parent categories are ALWAYS created in Medusa before their children.
    filteredCategories.sort((a: any, b: any) => {
      const depthA = (a.parent_path || "").split("/").filter(Boolean).length
      const depthB = (b.parent_path || "").split("/").filter(Boolean).length
      return depthA - depthB
    })

    const processCategory = async (oCategory: any, parentMedusaId: string | null) => {
      try {
        const handle = slugify(oCategory.name)
        odooIdToHandle.set(oCategory.id, handle)

        const metadata = { odoo_id: oCategory.id }

        const existing = await pgConnection.raw(
          `SELECT id FROM product_category WHERE handle = ? LIMIT 1`,
          [handle]
        )

        if (existing.rows.length > 0) {
          await pgConnection.raw(
            `UPDATE product_category
             SET name = ?, parent_category_id = ?,
                 metadata = COALESCE(metadata, '{}')::jsonb || ?::jsonb,
                 deleted_at = NULL, updated_at = NOW()
             WHERE handle = ?`,
            [oCategory.name, parentMedusaId, JSON.stringify(metadata), handle]
          )
          updated++
        } else {
          await productService.createProductCategories({
            name: oCategory.name,
            handle,
            parent_category_id: parentMedusaId,
            is_active: true,
            metadata,
          })
          created++
          logger.info(`[Odoo Category Sync] Created: "${oCategory.name}" (${handle})`)
        }
      } catch (err: any) {
        errors++
        logger.warn(`[Odoo Category Sync] Error on "${oCategory.name}": ${err.message}`)
      }
    }

    // Process categories in hierarchy order
    for (const cat of filteredCategories) {
      const parentOdooId = Array.isArray(cat.parent_id) ? cat.parent_id[0] : null
      const parentHandle = parentOdooId ? odooIdToHandle.get(parentOdooId) : null

      let parentMedusaId: string | null = null
      if (parentHandle) {
        const parentRow = await pgConnection.raw(
          `SELECT id FROM product_category WHERE handle = ? AND deleted_at IS NULL LIMIT 1`,
          [parentHandle]
        )
        parentMedusaId = parentRow.rows[0]?.id || null
      }

      // Fallback: look up parent by odoo_id in metadata
      if (!parentMedusaId && parentOdooId) {
        const parentByOdooId = await pgConnection.raw(
          `SELECT id FROM product_category WHERE metadata->>'odoo_id' = ? AND deleted_at IS NULL LIMIT 1`,
          [String(parentOdooId)]
        )
        parentMedusaId = parentByOdooId.rows[0]?.id || null
      }

      await processCategory(cat, parentMedusaId)
    }

    // Clean up categories in Medusa that are no longer synced from Odoo
    let softDeletedCount = 0
    try {
      const medusaCategories = await pgConnection.raw(
        `SELECT id, metadata->>'odoo_id' as odoo_id FROM product_category WHERE metadata->>'odoo_id' IS NOT NULL AND deleted_at IS NULL`
      )
      const syncedOdooIds = new Set(filteredCategories.map((c: any) => String(c.id)))

      for (const row of medusaCategories.rows) {
        if (!syncedOdooIds.has(row.odoo_id)) {
          await pgConnection.raw(
            `UPDATE product_category SET deleted_at = NOW(), updated_at = NOW() WHERE id = ?`,
            [row.id]
          )
          softDeletedCount++
        }
      }
      if (softDeletedCount > 0) {
        logger.info(`[Odoo Category Sync] Soft-deleted ${softDeletedCount} categories that are no longer marked for sync.`)
      }
    } catch (cleanupErr: any) {
      logger.warn(`[Odoo Category Sync] Cleanup failed: ${cleanupErr.message}`)
    }

    // Record sync time
    try {
      await pgConnection.raw(`
        CREATE TABLE IF NOT EXISTS system_config (
          key VARCHAR(255) PRIMARY KEY,
          value TEXT,
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `)
      await pgConnection.raw(
        `INSERT INTO system_config (key, value, updated_at)
         VALUES ('odoo_last_category_sync', ?, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [new Date().toISOString()]
      )
    } catch { /* ignore */ }

    logger.info(
      `[Odoo Category Sync] Done: ${created} created, ${updated} updated, ${errors} errors`
    )
  } catch (error: any) {
    logger.error(`[Odoo Category Sync] Fatal error: ${error.message}`)
  }
}

export const config = {
  name: "odoo-category-sync",
  schedule: "0 0 1 1 *", // Disabled: Runs only once a year on Jan 1st
}
