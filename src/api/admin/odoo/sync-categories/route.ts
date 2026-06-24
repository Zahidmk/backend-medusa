/**
 * POST /admin/odoo/sync-categories
 *
 * Permanent solution: Syncs ALL categories (public categories) from Odoo → Medusa.
 * - Creates new categories that don't exist yet
 * - Updates existing categories (name, parent, image)
 * - Preserves parent → child hierarchy
 * - Called automatically by the odoo-category-sync-job every hour
 * - Can also be triggered manually from the Admin dashboard
 *
 * GET /admin/odoo/sync-categories
 * - Returns current sync status + last sync time
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import OdooSyncService from "../../../../modules/odoo-sync/service"
import fs from "fs"
import path from "path"

const CATEGORIES_UPLOAD_DIR = path.join(process.cwd(), "static", "uploads", "categories")
const CATEGORIES_URL_PREFIX = "/static/uploads/categories"

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/(^-|-$)/g, "")
    .substring(0, 100)
}

function saveBase64Image(base64Data: string | false, dir: string, filename: string): string | null {
  if (!base64Data || typeof base64Data !== "string") return null
  const buffer = Buffer.from(base64Data, "base64")
  if (buffer.length < 100) return null

  // Detect image type from magic bytes or SVG text
  let ext = "jpg"
  if (buffer[0] === 0x89 && buffer[1] === 0x50) ext = "png"
  else if (buffer[0] === 0x47 && buffer[1] === 0x49) ext = "gif"
  else if (buffer[0] === 0x52 && buffer[1] === 0x49) ext = "webp"
  else if (buffer.slice(0, 100).toString('utf8').trim().startsWith('<svg') || 
           buffer.slice(0, 100).toString('utf8').trim().startsWith('<?xml')) ext = "svg"

  const fullFilename = `${filename}.${ext}`
  const filePath = path.join(dir, fullFilename)
  fs.writeFileSync(filePath, buffer)
  return fullFilename
}

/**
 * POST /admin/odoo/sync-categories
 * Triggers a full category sync from Odoo → Medusa
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const startTime = Date.now()
  const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const productService = req.scope.resolve(Modules.PRODUCT)

  const odoo = new OdooSyncService()

  if (!odoo.isConfigured()) {
    res.status(400).json({
      success: false,
      error: "Odoo not configured. Check ODOO_URL, ODOO_DB_NAME, ODOO_USERNAME, ODOO_API_KEY in .env",
    })
    return
  }

  const connectionTest = await odoo.testConnection()
  if (!connectionTest.success) {
    res.status(503).json({
      success: false,
      error: `Cannot reach Odoo: ${connectionTest.message}`,
    })
    return
  }

  // Ensure upload dir
  if (!fs.existsSync(CATEGORIES_UPLOAD_DIR)) {
    fs.mkdirSync(CATEGORIES_UPLOAD_DIR, { recursive: true })
  }

  let created = 0
  let updated = 0
  let errors = 0
  const errorMessages: string[] = []

  try {
    // Fetch all public categories from Odoo
    const odooCategories = await odoo.fetchPublicCategories()

    if (odooCategories.length === 0) {
      res.json({
        success: true,
        message: "No categories found in Odoo eCommerce public categories.",
        created: 0,
        updated: 0,
        errors: 0,
        elapsed_ms: Date.now() - startTime,
      })
      return
    }

    // Ensure system_config table exists for tracking last sync
    await pgConnection.raw(`
      CREATE TABLE IF NOT EXISTS system_config (
        key VARCHAR(255) PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `).catch(() => {})

    // Map: Odoo category ID → Medusa handle (for parent linking)
    const odooIdToHandle = new Map<number, string>()

    // Sort categories by parent_path depth (number of slashes or path length)
    // shorter paths (roots/parents) will be processed first,
    // ensuring parent categories are ALWAYS created in Medusa before their children.
    odooCategories.sort((a: any, b: any) => {
      const depthA = (a.parent_path || "").split("/").filter(Boolean).length
      const depthB = (b.parent_path || "").split("/").filter(Boolean).length
      return depthA - depthB
    })

    const processCategory = async (oCategory: any, parentMedusaId: string | null) => {
      try {
        const handle = slugify(oCategory.name)
        if (!handle) return
        odooIdToHandle.set(oCategory.id, handle)

        // Try to save image
        let imageUrl: string | null = null
        if (oCategory.image_1920 && typeof oCategory.image_1920 === "string") {
          const filename = saveBase64Image(oCategory.image_1920, CATEGORIES_UPLOAD_DIR, `cat-${handle}`)
          if (filename) {
            imageUrl = `${CATEGORIES_URL_PREFIX}/${filename}`
          }
        }

        const metadata = {
          image_url: imageUrl,
          odoo_id: oCategory.id,
        }

        // Check if already exists (by handle)
        const existing = await pgConnection.raw(
          `SELECT id FROM product_category WHERE handle = ? LIMIT 1`,
          [handle]
        )

        if (existing.rows.length > 0) {
          // Update: restore if soft-deleted, update name/parent/image
          await pgConnection.raw(
            `UPDATE product_category
             SET name = ?,
                 parent_category_id = ?,
                 metadata = COALESCE(metadata, '{}')::jsonb || ?::jsonb,
                 deleted_at = NULL,
                 updated_at = NOW()
             WHERE handle = ?`,
            [oCategory.name, parentMedusaId, JSON.stringify(metadata), handle]
          )
          updated++
        } else {
          // Create new category
          await productService.createProductCategories({
            name: oCategory.name,
            handle,
            parent_category_id: parentMedusaId,
            is_active: true,
            metadata,
          })
          created++
        }
      } catch (err: any) {
        errors++
        errorMessages.push(`"${oCategory.name}": ${err.message}`)
      }
    }

    // Process all categories in hierarchy order
    for (const cat of odooCategories) {
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
      const syncedOdooIds = new Set(odooCategories.map((c: any) => String(c.id)))

      for (const row of medusaCategories.rows) {
        if (!syncedOdooIds.has(row.odoo_id)) {
          await pgConnection.raw(
            `UPDATE product_category SET deleted_at = NOW(), updated_at = NOW() WHERE id = ?`,
            [row.id]
          )
          softDeletedCount++
        }
      }
    } catch (cleanupErr: any) {
      errorMessages.push(`Cleanup: ${cleanupErr.message}`)
    }

    // Record last sync time
    await pgConnection.raw(
      `INSERT INTO system_config (key, value, updated_at)
       VALUES ('odoo_last_category_sync', ?, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [new Date().toISOString()]
    ).catch(() => {})

    const elapsed = Date.now() - startTime

    res.json({
      success: true,
      message: `Category sync complete. Created: ${created}, Updated: ${updated}, Errors: ${errors}`,
      total_odoo_categories: odooCategories.length,
      created,
      updated,
      errors,
      error_details: errorMessages,
      elapsed_ms: elapsed,
    })
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err.message,
      created,
      updated,
      errors,
    })
  }
}

/**
 * GET /admin/odoo/sync-categories
 * Returns current sync status: last sync time + category count
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  try {
    // Get last sync time
    let lastSync: string | null = null
    try {
      const result = await pgConnection.raw(
        `SELECT value FROM system_config WHERE key = 'odoo_last_category_sync' LIMIT 1`
      )
      lastSync = result.rows[0]?.value || null
    } catch { /* table may not exist */ }

    // Get current category count
    const countResult = await pgConnection.raw(
      `SELECT COUNT(*) as total FROM product_category WHERE deleted_at IS NULL`
    )
    const totalCategories = parseInt(countResult.rows[0]?.total || "0")

    // Get root vs child breakdown
    const rootResult = await pgConnection.raw(
      `SELECT COUNT(*) as total FROM product_category WHERE deleted_at IS NULL AND parent_category_id IS NULL`
    )
    const rootCategories = parseInt(rootResult.rows[0]?.total || "0")

    res.json({
      success: true,
      last_sync: lastSync,
      next_auto_sync: "⚡ Instant webhook + every 5 min backup",
      categories: {
        total: totalCategories,
        root: rootCategories,
        children: totalCategories - rootCategories,
      },
    })
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message })
  }
}
