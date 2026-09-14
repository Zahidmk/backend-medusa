/**
 * POST /admin/odoo/sync-brands
 * Triggers an immediate brand sync from Odoo (shares logic with the
 * nightly odoo-brand-sync job — see src/jobs/odoo-brand-sync.ts).
 *
 * GET /admin/odoo/sync-brands
 * Returns last sync time + current brand count.
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { runBrandSync } from "../../../../jobs/odoo-brand-sync"

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const startTime = Date.now()
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  try {
    const result = await runBrandSync(req.scope, logger)
    res.json({
      success: true,
      message: `Brand sync complete. Created: ${result.created}, Updated: ${result.updated}, Errors: ${result.errors}`,
      total_odoo_brands: result.total,
      created: result.created,
      updated: result.updated,
      errors: result.errors,
      error_details: result.error_details,
      elapsed_ms: Date.now() - startTime,
    })
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message })
  }
}

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  try {
    let lastSync: string | null = null
    try {
      const result = await pgConnection.raw(
        `SELECT value FROM system_config WHERE key = 'odoo_last_brand_sync' LIMIT 1`
      )
      lastSync = result.rows[0]?.value || null
    } catch { /* table may not exist yet */ }

    const countResult = await pgConnection.raw(
      `SELECT COUNT(*) as total FROM brand WHERE deleted_at IS NULL`
    )

    res.json({
      success: true,
      last_sync: lastSync,
      brands: { total: parseInt(countResult.rows[0]?.total || "0") },
    })
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message })
  }
}
