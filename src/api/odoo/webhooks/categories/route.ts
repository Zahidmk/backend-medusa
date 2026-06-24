import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import OdooSyncService from "../../../../modules/odoo-sync/service"
import fs from "fs"
import path from "path"

/**
 * POST /odoo/webhooks/categories
 *
 * INSTANT category sync webhook — Odoo calls this endpoint
 * whenever a category is created, updated, or deleted.
 *
 * Supports two modes:
 *  1. Payload-based: Odoo pushes category data directly  →  instant, one category
 *  2. Full-sync:     Odoo sends { action: "full_sync" }  →  fetches ALL from Odoo
 *
 * Also supports a simple GET ping for health-check.
 *
 * Setup in Odoo:
 *   Automation Rule → Model: product.public.category
 *   Trigger: On Creation / On Update / On Deletion
 *   Action: Execute Code → requests.post(webhook_url, json=payload)
 */

const WEBHOOK_SECRET = process.env.ODOO_WEBHOOK_SECRET || "marqa-odoo-webhook-2026"
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
 * GET /odoo/webhooks/categories
 * Health check — verifies endpoint is reachable
 */
export async function GET(_req: MedusaRequest, res: MedusaResponse): Promise<void> {
  res.json({
    status: "ok",
    endpoint: "odoo-category-webhook",
    message: "POST category data here for instant sync",
    timestamp: new Date().toISOString(),
  })
}

/**
 * POST /odoo/webhooks/categories
 *
 * Accepts:
 *   { secret, action: "full_sync" }                        → full sync from Odoo
 *   { secret, action: "create"|"update", category: {...} } → single category upsert
 *   { secret, action: "delete", odoo_id: 123 }             → soft-delete
 *   { secret, categories: [...] }                           → bulk upsert
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const startTime = Date.now()
  const body = req.body as any

  // ── Verify webhook secret ──
  const secret = body?.secret || req.headers["x-webhook-secret"]
  if (secret !== WEBHOOK_SECRET) {
    res.status(401).json({ success: false, error: "Invalid webhook secret" })
    return
  }

  const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const productService = req.scope.resolve(Modules.PRODUCT)

  // Ensure upload dir
  if (!fs.existsSync(CATEGORIES_UPLOAD_DIR)) {
    fs.mkdirSync(CATEGORIES_UPLOAD_DIR, { recursive: true })
  }

  const action = body?.action || "upsert"

  try {
    // ══════════════════════════════════════
    //  MODE 1: Full Sync (fetch all from Odoo)
    // ══════════════════════════════════════
    if (action === "full_sync") {
      const odoo = new OdooSyncService()

      if (!odoo.isConfigured()) {
        res.status(400).json({ success: false, error: "Odoo not configured" })
        return
      }

      const odooCategories = await odoo.fetchPublicCategories()
      const result = await syncCategories(odooCategories, pgConnection, productService)

      // Record last sync time
      await recordSyncTime(pgConnection)

      res.json({
        success: true,
        action: "full_sync",
        ...result,
        elapsed_ms: Date.now() - startTime,
      })
      return
    }

    // ══════════════════════════════════════
    //  MODE 2: Delete a category
    // ══════════════════════════════════════
    if (action === "delete") {
      const odooId = body?.odoo_id
      if (!odooId) {
        res.status(400).json({ success: false, error: "Missing odoo_id for delete action" })
        return
      }

      const deleteResult = await pgConnection.raw(
        `UPDATE product_category SET deleted_at = NOW()
         WHERE metadata->>'odoo_id' = ? AND deleted_at IS NULL`,
        [String(odooId)]
      )

      res.json({
        success: true,
        action: "delete",
        odoo_id: odooId,
        deleted: deleteResult.rowCount || 0,
        elapsed_ms: Date.now() - startTime,
      })
      return
    }

    // ══════════════════════════════════════
    //  MODE 3: Single category create/update
    // ══════════════════════════════════════
    if (body?.category) {
      const result = await upsertSingleCategory(body.category, pgConnection, productService)
      await recordSyncTime(pgConnection)

      res.json({
        success: true,
        action: result.action,
        category: result.handle,
        elapsed_ms: Date.now() - startTime,
      })
      return
    }

    // ══════════════════════════════════════
    //  MODE 4: Bulk categories
    // ══════════════════════════════════════
    if (Array.isArray(body?.categories)) {
      const result = await syncCategories(body.categories, pgConnection, productService)
      await recordSyncTime(pgConnection)

      res.json({
        success: true,
        action: "bulk_upsert",
        ...result,
        elapsed_ms: Date.now() - startTime,
      })
      return
    }

    res.status(400).json({
      success: false,
      error: "Invalid payload. Send { action: 'full_sync' }, { category: {...} }, or { categories: [...] }",
    })
  } catch (err: any) {
    console.error("❌ Category webhook error:", err)
    res.status(500).json({ success: false, error: err.message })
  }
}

// ═══════════════════════════════════════════════
//  Helper: Upsert a single category
// ═══════════════════════════════════════════════
async function upsertSingleCategory(
  cat: any,
  pg: any,
  productService: any
): Promise<{ action: string; handle: string }> {
  const name = cat.name
  const handle = slugify(name)
  if (!handle) throw new Error("Category name is empty or produces empty slug")

  // Save image if provided
  let imageUrl: string | null = null
  if (cat.image_1920 && typeof cat.image_1920 === "string") {
    const filename = saveBase64Image(cat.image_1920, CATEGORIES_UPLOAD_DIR, `cat-${handle}`)
    if (filename) imageUrl = `${CATEGORIES_URL_PREFIX}/${filename}`
  }

  const metadata: any = { odoo_id: cat.id || cat.odoo_id }
  if (imageUrl) metadata.image_url = imageUrl

  // Resolve parent
  let parentMedusaId: string | null = null
  if (cat.parent_id) {
    const parentOdooId = Array.isArray(cat.parent_id) ? cat.parent_id[0] : cat.parent_id
    const parentName = Array.isArray(cat.parent_id) ? cat.parent_id[1] : null

    // Try to find parent by odoo_id in metadata
    let parentRow = await pg.raw(
      `SELECT id FROM product_category
       WHERE metadata->>'odoo_id' = ? AND deleted_at IS NULL LIMIT 1`,
      [String(parentOdooId)]
    )

    // Fallback: find by handle of parent name
    if (parentRow.rows.length === 0 && parentName) {
      parentRow = await pg.raw(
        `SELECT id FROM product_category WHERE handle = ? AND deleted_at IS NULL LIMIT 1`,
        [slugify(parentName)]
      )
    }

    parentMedusaId = parentRow.rows[0]?.id || null
  }

  // Check if exists
  const existing = await pg.raw(
    `SELECT id FROM product_category WHERE handle = ? LIMIT 1`,
    [handle]
  )

  if (existing.rows.length > 0) {
    // Update
    await pg.raw(
      `UPDATE product_category
       SET name = ?,
           parent_category_id = ?,
           metadata = COALESCE(metadata, '{}')::jsonb || ?::jsonb,
           deleted_at = NULL,
           updated_at = NOW()
       WHERE handle = ?`,
      [name, parentMedusaId, JSON.stringify(metadata), handle]
    )
    return { action: "updated", handle }
  } else {
    // Create
    await productService.createProductCategories({
      name,
      handle,
      parent_category_id: parentMedusaId,
      is_active: true,
      metadata,
    })
    return { action: "created", handle }
  }
}

// ═══════════════════════════════════════════════
//  Helper: Sync multiple categories (full or bulk)
// ═══════════════════════════════════════════════
async function syncCategories(
  odooCategories: any[],
  pg: any,
  productService: any
): Promise<{ total: number; created: number; updated: number; errors: number; error_details: string[] }> {
  let created = 0
  let updated = 0
  let errors = 0
  const errorDetails: string[] = []

  const odooIdToHandle = new Map<number, string>()

  const rootCategories = odooCategories.filter((c: any) => !c.parent_id)
  const childCategories = odooCategories.filter((c: any) => !!c.parent_id)

  const processCategory = async (oCategory: any, parentMedusaId: string | null) => {
    try {
      const handle = slugify(oCategory.name)
      if (!handle) return
      odooIdToHandle.set(oCategory.id, handle)

      let imageUrl: string | null = null
      if (oCategory.image_1920 && typeof oCategory.image_1920 === "string") {
        const filename = saveBase64Image(oCategory.image_1920, CATEGORIES_UPLOAD_DIR, `cat-${handle}`)
        if (filename) imageUrl = `${CATEGORIES_URL_PREFIX}/${filename}`
      }

      const metadata = { image_url: imageUrl, odoo_id: oCategory.id }

      const existing = await pg.raw(
        `SELECT id FROM product_category WHERE handle = ? LIMIT 1`,
        [handle]
      )

      if (existing.rows.length > 0) {
        await pg.raw(
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
      }
    } catch (err: any) {
      errors++
      errorDetails.push(`"${oCategory.name}": ${err.message}`)
    }
  }

  // Process root first, then children
  for (const cat of rootCategories) {
    await processCategory(cat, null)
  }

  for (const cat of childCategories) {
    const parentOdooId = Array.isArray(cat.parent_id) ? cat.parent_id[0] : null
    const parentHandle = parentOdooId ? odooIdToHandle.get(parentOdooId) : null

    let parentMedusaId: string | null = null
    if (parentHandle) {
      const parentRow = await pg.raw(
        `SELECT id FROM product_category WHERE handle = ? AND deleted_at IS NULL LIMIT 1`,
        [parentHandle]
      )
      parentMedusaId = parentRow.rows[0]?.id || null
    }

    await processCategory(cat, parentMedusaId)
  }

  return { total: odooCategories.length, created, updated, errors, error_details: errorDetails }
}

// ═══════════════════════════════════════════════
//  Helper: Record last sync timestamp
// ═══════════════════════════════════════════════
async function recordSyncTime(pg: any) {
  try {
    await pg.raw(`
      CREATE TABLE IF NOT EXISTS system_config (
        key VARCHAR(255) PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `)
    await pg.raw(
      `INSERT INTO system_config (key, value, updated_at)
       VALUES ('odoo_last_category_sync', ?, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [new Date().toISOString()]
    )
  } catch {
    // ignore
  }
}
