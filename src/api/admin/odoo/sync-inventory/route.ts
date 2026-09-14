/**
 * POST /admin/odoo/sync-inventory
 *
 * Pulls current stock quantities from Odoo (product.product free_qty /
 * qty_available) and updates matching inventory_level rows in Medusa by SKU.
 * Only updates levels for variants that already have a linked inventory item
 * (i.e. products already synced from Odoo) — it does not create new
 * products, variants, or inventory items.
 *
 * GET /admin/odoo/sync-inventory
 * Returns last sync time + current inventory level / item counts.
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

const BATCH_SIZE = 1000

async function recordSyncTime(pgConnection: any) {
  await pgConnection.raw(`
    CREATE TABLE IF NOT EXISTS system_config (
      key VARCHAR(255) PRIMARY KEY,
      value TEXT,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await pgConnection.raw(
    `INSERT INTO system_config (key, value, updated_at)
     VALUES ('odoo_last_inventory_sync', ?, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [new Date().toISOString()]
  )
}

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const startTime = Date.now()
  const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  let odooSyncService: any
  try {
    odooSyncService = req.scope.resolve("odoo_sync")
  } catch {
    res.status(400).json({ success: false, error: "OdooSyncService not registered" })
    return
  }

  if (odooSyncService.isConfigured && !odooSyncService.isConfigured()) {
    res.status(400).json({ success: false, error: "Odoo not configured" })
    return
  }

  try {
    const stock: any[] = await odooSyncService.fetchVariantStock(20000)

    const entries: Array<[string, number]> = []
    for (const p of stock) {
      const sku = p.default_code
      if (!sku || typeof sku !== "string") continue
      // free_qty (available to promise, after reservations) is frequently 0
      // even when real stock exists — qty_available (physical on-hand) is
      // the meaningful number in that case, so fall through on a falsy 0 too.
      const qty = Math.max(0, Math.floor(p.free_qty || p.qty_available || 0))
      entries.push([sku, qty])
    }

    let updatedLevels = 0
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const batch = entries.slice(i, i + BATCH_SIZE)
      const values = batch.map(() => `(?::text, ?::numeric)`).join(", ")
      const params: any[] = []
      batch.forEach(([sku, qty]) => params.push(sku, qty))

      const result = await pgConnection.raw(
        `WITH odoo_stock(sku, qty) AS (VALUES ${values})
         UPDATE inventory_level il
         SET stocked_quantity = os.qty,
             raw_stocked_quantity = jsonb_build_object('value', os.qty::text, 'precision', 20),
             updated_at = NOW()
         FROM odoo_stock os
         JOIN product_variant pv ON pv.sku = os.sku
         JOIN product_variant_inventory_item pvii ON pvii.variant_id = pv.id AND pvii.deleted_at IS NULL
         WHERE il.inventory_item_id = pvii.inventory_item_id AND il.deleted_at IS NULL
         RETURNING il.id`,
        params
      )
      updatedLevels += result.rows?.length || 0
    }

    await recordSyncTime(pgConnection)

    res.json({
      success: true,
      message: `Inventory sync complete. Updated ${updatedLevels} inventory levels from ${entries.length} Odoo SKUs.`,
      total_odoo_skus: entries.length,
      updated_levels: updatedLevels,
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
        `SELECT value FROM system_config WHERE key = 'odoo_last_inventory_sync' LIMIT 1`
      )
      lastSync = result.rows[0]?.value || null
    } catch { /* table may not exist yet */ }

    const levelCount = await pgConnection.raw(
      `SELECT COUNT(*) as total FROM inventory_level WHERE deleted_at IS NULL`
    )
    const itemCount = await pgConnection.raw(
      `SELECT COUNT(*) as total FROM inventory_item WHERE deleted_at IS NULL`
    )

    res.json({
      success: true,
      last_sync: lastSync,
      inventory: {
        items: parseInt(itemCount.rows[0]?.total || "0"),
        levels: parseInt(levelCount.rows[0]?.total || "0"),
      },
    })
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message })
  }
}
