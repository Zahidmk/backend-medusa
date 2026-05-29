import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import OdooSyncService from "../../modules/odoo-sync/service"

function genId(prefix: string): string {
  const c = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
  let id = prefix + "_"
  for (let i = 0; i < 26; i++) id += c[Math.floor(Math.random() * c.length)]
  return id
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const odooService = new OdooSyncService()

  try {
    console.log("[Sync Inventory] Fetching stock from Odoo...")
    // Fetch variant stock from Odoo stock.quant
    const stockData = await odooService.fetchInventory()
    console.log(`[Sync Inventory] Fetched ${stockData.length} stock quant records from Odoo.`)

    // Create a map by SKU
    const odooStockMap = new Map<string, number>()
    for (const item of stockData) {
      if (item.sku) {
        const currentQty = odooStockMap.get(item.sku) || 0
        odooStockMap.set(item.sku, currentQty + (item.quantity || 0))
      }
    }

    console.log("[Sync Inventory] Processing variants in Medusa...")
    
    // Get default stock location
    const locationRes = await pgConnection.raw(`SELECT id FROM stock_location LIMIT 1`)
    if (!locationRes.rows || locationRes.rows.length === 0) {
      return res.status(500).json({ error: "No stock_location found in Medusa." })
    }
    const locationId = locationRes.rows[0].id

    // Get all variants
    const variantRes = await pgConnection.raw(
      `SELECT id, sku, title, product_id FROM product_variant WHERE deleted_at IS NULL`
    )
    const variants = variantRes.rows

    let createdItems = 0
    let createdLinks = 0
    let updatedLevels = 0

    // Fetch existing links
    const existingLinksRes = await pgConnection.raw(
      `SELECT variant_id, inventory_item_id FROM product_variant_inventory_item WHERE deleted_at IS NULL`
    )
    const existingLinksMap = new Map<string, string>()
    for (const row of existingLinksRes.rows) {
      existingLinksMap.set(row.variant_id, row.inventory_item_id)
    }

    // Fetch existing inventory items by SKU
    const existingItemsRes = await pgConnection.raw(
      `SELECT id, sku FROM inventory_item WHERE deleted_at IS NULL`
    )
    const existingItemsMap = new Map<string, string>()
    for (const row of existingItemsRes.rows) {
      if (row.sku) {
        existingItemsMap.set(row.sku, row.id)
      }
    }

    // Fetch existing inventory levels by inventory_item_id
    const existingLevelsRes = await pgConnection.raw(
      `SELECT id, inventory_item_id, stocked_quantity FROM inventory_level WHERE deleted_at IS NULL`
    )
    const existingLevelsMap = new Map<string, { id: string, qty: number }>()
    for (const row of existingLevelsRes.rows) {
      existingLevelsMap.set(row.inventory_item_id, { id: row.id, qty: Number(row.stocked_quantity) })
    }

    for (const variant of variants) {
      if (!variant.sku) continue

      const odooQty = odooStockMap.get(variant.sku) || 0

      // 1. Ensure inventory_item exists
      let inventoryItemId = existingItemsMap.get(variant.sku)
      if (!inventoryItemId) {
        inventoryItemId = genId("iitem")
        await pgConnection.raw(
          `INSERT INTO inventory_item (id, sku, title, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())`,
          [inventoryItemId, variant.sku, variant.title || variant.sku]
        )
        existingItemsMap.set(variant.sku, inventoryItemId)
        createdItems++
      }

      // 2. Ensure inventory_level exists and update quantity
      const level = existingLevelsMap.get(inventoryItemId)
      if (!level) {
        await pgConnection.raw(
          `INSERT INTO inventory_level (id, inventory_item_id, location_id, stocked_quantity, reserved_quantity, incoming_quantity, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, 0, NOW(), NOW())`,
          [genId("iloc"), inventoryItemId, locationId, odooQty]
        )
        existingLevelsMap.set(inventoryItemId, { id: "new", qty: odooQty })
        updatedLevels++
      } else if (level.qty !== odooQty) {
        await pgConnection.raw(
          `UPDATE inventory_level SET stocked_quantity = ?, updated_at = NOW() WHERE id = ?`,
          [odooQty, level.id]
        )
        level.qty = odooQty
        updatedLevels++
      }

      // 3. Ensure product_variant_inventory_item link exists
      const linkedItemId = existingLinksMap.get(variant.id)
      if (linkedItemId !== inventoryItemId) {
        // If it's linked to the wrong item, delete the old link first
        if (linkedItemId) {
          await pgConnection.raw(
            `DELETE FROM product_variant_inventory_item WHERE variant_id = ?`,
            [variant.id]
          )
        }
        await pgConnection.raw(
          `INSERT INTO product_variant_inventory_item (id, variant_id, inventory_item_id, required_quantity, created_at, updated_at)
           VALUES (?, ?, ?, 1, NOW(), NOW())`,
          [genId("pvitem"), variant.id, inventoryItemId]
        )
        existingLinksMap.set(variant.id, inventoryItemId)
        createdLinks++
      }

      // Optional: Update product metadata just in case
      await pgConnection.raw(
        `UPDATE product 
         SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{odoo_stock}', ?::jsonb)
         WHERE id = ?`,
        [String(odooQty), variant.product_id]
      )
    }

    res.json({
      success: true,
      message: "Inventory synced successfully",
      stats: {
        total_variants_processed: variants.length,
        items_created: createdItems,
        levels_created_or_updated: updatedLevels,
        links_created_or_fixed: createdLinks
      }
    })

  } catch (error: any) {
    console.error("[Sync Inventory] Error:", error)
    res.status(500).json({ error: error.message })
  }
}
