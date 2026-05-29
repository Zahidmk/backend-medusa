/**
 * Odoo Inventory Auto-Sync Job
 *
 * Runs every 15 minutes. Fetches stock quantities for ALL variants from Odoo
 * and updates the Medusa inventory levels.
 * Odoo stock moves do NOT change product write_date, so this is necessary
 * unless Odoo webhooks are perfectly configured.
 */
import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export default async function odooInventorySyncJob(container: MedusaContainer) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const pgConnection = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  let odooSyncService: any
  try {
    odooSyncService = container.resolve("odoo_sync")
  } catch {
    logger.warn("[Odoo Inventory Sync] OdooSyncService not registered, skipping.")
    return
  }

  if (!odooSyncService.isConfigured?.()) {
    logger.warn("[Odoo Inventory Sync] Odoo not configured, skipping.")
    return
  }

  logger.info("[Odoo Inventory Sync] Fetching stock from Odoo...")

  try {
    const stockData = await odooSyncService.fetchInventory()
    
    if (!stockData || stockData.length === 0) {
      logger.info("[Odoo Inventory Sync] No stock data returned from Odoo.")
      return
    }

    logger.info(`[Odoo Inventory Sync] Fetched ${stockData.length} stock quant records from Odoo.`)

    const odooStockMap = new Map<string, number>()
    for (const item of stockData) {
      if (item.sku) {
        const currentQty = odooStockMap.get(item.sku) || 0
        odooStockMap.set(item.sku, currentQty + (item.quantity || 0))
      }
    }

    // Get all inventory items with their current level quantities
    const res = await pgConnection.raw(`
      SELECT ii.id as inventory_item_id, ii.sku, il.id as level_id, il.stocked_quantity
      FROM inventory_item ii
      JOIN inventory_level il ON il.inventory_item_id = ii.id
      WHERE ii.deleted_at IS NULL AND il.deleted_at IS NULL
    `)

    let updated = 0
    
    for (const row of res.rows) {
      if (!row.sku) continue
      
      const newQty = odooStockMap.get(row.sku)
      if (newQty !== undefined && newQty !== Number(row.stocked_quantity)) {
        await pgConnection.raw(
          `UPDATE inventory_level SET stocked_quantity = ?, updated_at = NOW() WHERE id = ?`,
          [newQty, row.level_id]
        )
        updated++
      }
    }

    logger.info(`[Odoo Inventory Sync] Completed. Updated ${updated} inventory levels.`)
    
  } catch (error: any) {
    logger.error(`[Odoo Inventory Sync] Fatal error: ${error.message}`)
  }
}

export const config = {
  name: "odoo-inventory-sync",
  schedule: "*/15 * * * *", // Every 15 minutes
}
