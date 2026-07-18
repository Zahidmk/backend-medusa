import { ExecArgs } from "@medusajs/framework/types"
import axios from "axios"

/**
 * Odoo Inventory Sync Script
 * 
 * This script synchronizes inventory levels FROM Odoo to MedusaJS.
 * It updates stock quantities for products that have already been synced.
 * 
 * Run manually: npx medusa exec ./src/scripts/odoo-inventory-sync.ts
 * Or via yarn: yarn inventory:sync
 */

interface OdooProduct {
  id: number
  default_code: string | false
  free_qty?: number
  virtual_available: number
  name: string
}

export default async function odooInventorySync({ container }: ExecArgs) {
  console.log("\n📦 Starting Odoo Inventory Sync to MedusaJS...")
  console.log("=" .repeat(50))
  
  // Get configuration from environment
  const odooUrl = process.env.ODOO_URL || "https://oskarllc-new-31031096.dev.odoo.com"
  const odooDb = process.env.ODOO_DB_NAME || "oskarllc-new-31031096"
  const odooUsername = process.env.ODOO_USERNAME || "SYG"
  const odooPassword = process.env.ODOO_PASSWORD || "S123456"
  
  console.log(`📡 Odoo URL: ${odooUrl}`)
  console.log(`📁 Database: ${odooDb}`)
  
  // Authenticate with Odoo
  console.log("\n1️⃣ Authenticating with Odoo...")
  
  let uid: number
  try {
    const authResponse = await axios.post(`${odooUrl}/jsonrpc`, {
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "common",
        method: "authenticate",
        args: [odooDb, odooUsername, odooPassword, {}]
      },
      id: 1
    })
    
    uid = authResponse.data.result
    if (!uid) {
      console.error("❌ Authentication failed - no UID returned")
      return
    }
    console.log(`✅ Authenticated successfully (UID: ${uid})`)
  } catch (error: any) {
    console.error("❌ Authentication failed:", error.message)
    return
  }
  
  // Fetch inventory from Odoo
  console.log("\n2️⃣ Fetching inventory from Odoo...")
  
  let odooProducts: OdooProduct[] = []
  try {
    const productsResponse = await axios.post(`${odooUrl}/jsonrpc`, {
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [
          odooDb,
          uid,
          odooPassword,
          "product.product",
          "search_read",
          [[["active", "=", true]]],
          {
            fields: ["id", "default_code", "free_qty", "virtual_available", "name"],
            limit: 10000
          }
        ]
      },
      id: 2
    })
    
    odooProducts = productsResponse.data.result || []
    console.log(`✅ Found ${odooProducts.length} products in Odoo`)
  } catch (error: any) {
    console.error("❌ Failed to fetch inventory:", error.message)
    return
  }
  
  // Build SKU to inventory map
  const odooInventory = new Map<string, { qty: number, odooId: number, name: string }>()
  for (const product of odooProducts) {
    const sku = product.default_code || `ODOO-${product.id}`
    odooInventory.set(sku, {
      qty: Math.max(0, Math.floor(product.free_qty || 0)),
      odooId: product.id,
      name: product.name
    })
  }
  console.log(`📊 Built inventory map with ${odooInventory.size} SKUs`)
  console.log(
      "First Odoo SKU:",
      [...odooInventory.keys()].slice(0, 20)
  )
  
  // Get services from container
  const productModuleService = container.resolve("product")
  const inventoryModuleService = container.resolve("inventory")
  
  // Get existing products with variants
  console.log("\n3️⃣ Fetching MedusaJS products...")
  
  let existingProducts: any[] = []
  let skip = 0
  
  while (true) {
    const batch = await productModuleService.listProducts(
      {},
      {
        select: ["id", "handle", "metadata"],
        relations: ["variants"],
        take: 1000,
        skip,
      }
    )
  
    existingProducts.push(...batch)
  
    if (batch.length < 1000) {
      break
    }
  
    skip += 1000
  }
  
  console.log(`📊 Found ${existingProducts.length} products in MedusaJS`)
  console.log(
      "First Medusa SKU:",
      existingProducts
        .flatMap((p:any)=>p.variants || [])
        .map((v:any)=>v.sku)
        .slice(0,20)
  )
  
  // Get inventory items
  console.log("\n4️⃣ Fetching inventory items...")
  
  let inventoryItems: any[] = []
  try {
    let skipItems = 0

    while (true) {
        const batch = await inventoryModuleService.listInventoryItems(
            {},
            {
                take: 1000,
                skip: skipItems,
            }
        )

        inventoryItems.push(...batch)

        if (batch.length < 1000) {
            break
        }

        skipItems += 1000
    }

    console.log(`📊 Found ${inventoryItems.length} inventory items`)
  } catch (error: any) {
    console.log(`⚠️ Could not list inventory items: ${error.message}`)
  }
  
  // Build SKU to inventory item map
  const inventoryItemMap = new Map<string, any>()
  for (const item of inventoryItems) {
    if (item.sku) {
      inventoryItemMap.set(item.sku, item)
    }
  }
  
  // Update inventory levels
  console.log("\n5️⃣ Updating inventory levels...")
  
  let updatedCount = 0
  let skippedCount = 0
  let errorCount = 0
  let createdCount = 0
  
  for (const product of existingProducts) {
    for (const variant of product.variants || []) {
      const sku = variant.sku

      if (updatedCount === 0 && skippedCount < 30) {
          console.log(
              "Variant:",
              sku,
              "Exists in Odoo:",
              odooInventory.has(sku)
          )
      }

      if (!sku) continue
      
      const odooStock = odooInventory.get(sku)
      if (!odooStock) {
        skippedCount++
        continue
      }
      
      try {
        // Check if inventory item exists
        let inventoryItem = inventoryItemMap.get(sku)
        
        if (!inventoryItem) {
          // Create inventory item for this variant
          try {
            inventoryItem = await inventoryModuleService.createInventoryItems({
              sku: sku,
              title: variant.title || product.title || "Product",
            })
            if (Array.isArray(inventoryItem)) {
              inventoryItem = inventoryItem[0]
            }
            createdCount++
            console.log(`  📦 Created inventory item for SKU: ${sku}`)
          } catch (createError: any) {
            // Item might already exist
            const existing = await inventoryModuleService.listInventoryItems({ sku })
            if (existing && existing.length > 0) {
              inventoryItem = existing[0]
            }
          }
        }
        
        if (inventoryItem) {
          // Get or create inventory level for default location
          try {
            const pg = container.resolve("pgConnection" as any);
            
            // Get stock locations
            const stockLocationService = container.resolve("stock_location")
            const locations = await stockLocationService.listStockLocations({})
            
            if (locations.length === 0) {
              // Create a default location
              const newLocation = await stockLocationService.createStockLocations({
                name: "Kuwait Warehouse",
                address: {
                  address_1: "Kuwait City",
                  country_code: "kw"
                }
              })
              console.log(`  📍 Created default stock location: Kuwait Warehouse`)
            }
            
            const location = locations[0] || (await stockLocationService.listStockLocations({}))[0]
            
            if (location) {
              const qty = Math.max(0, odooStock.qty);

              // Check if inventory level exists
              const invLvlRes = await pg.raw(
                `SELECT id FROM inventory_level WHERE inventory_item_id = ? AND location_id = ? LIMIT 1`,
                [inventoryItem.id, location.id]
              )

              if (invLvlRes.rows?.length > 0) {
                // Update
                await pg.raw(
                  `UPDATE inventory_level SET stocked_quantity = ?, updated_at = NOW() WHERE id = ?`,
                  [qty, invLvlRes.rows[0].id]
                )
              } else {
                // Insert
                // Generate a random ID since genId might not be available here
                const newId = `iloc_${Math.random().toString(36).substring(2, 15)}`
                await pg.raw(
                  `INSERT INTO inventory_level (id, inventory_item_id, location_id, stocked_quantity, reserved_quantity, incoming_quantity, created_at, updated_at)
                   VALUES (?, ?, ?, ?, 0, 0, NOW(), NOW())`,
                  [newId, inventoryItem.id, location.id, qty]
                )
              }

              // CRITICAL FIX: Link the variant to the inventory item
              const linkRes = await pg.raw(
                `SELECT id FROM product_variant_inventory_item WHERE variant_id = ? AND inventory_item_id = ? LIMIT 1`,
                [variant.id, inventoryItem.id]
              )
              if (linkRes.rows?.length === 0) {
                // Remove wrong links
                await pg.raw(`DELETE FROM product_variant_inventory_item WHERE variant_id = ?`, [variant.id])
                
                const newLinkId = `pvitem_${Math.random().toString(36).substring(2, 15)}`
                await pg.raw(
                  `INSERT INTO product_variant_inventory_item (id, variant_id, inventory_item_id, required_quantity, created_at, updated_at)
                   VALUES (?, ?, ?, 1, NOW(), NOW())`,
                  [newLinkId, variant.id, inventoryItem.id]
                )
                console.log(`  🔗 Linked inventory item to variant ${sku}`)
              }
              
              updatedCount++
              if (updatedCount <= 20) {
                console.log(`  ✅ ${sku}: ${qty} units (${odooStock.name})`)
              }
            }
          } catch (levelError: any) {
            errorCount++
            console.log(`  ❌ Error updating level for ${sku}: ${levelError.message}`)
          }
        }
      } catch (error: any) {
        errorCount++
        console.log(`  ❌ Error processing ${sku}: ${error.message}`)
      }
    }
  }
  
  if (updatedCount > 20) {
    console.log(`  ... and ${updatedCount - 20} more`)
  }
  
  // Summary
  console.log("\n" + "=" .repeat(50))
  console.log("📊 INVENTORY SYNC SUMMARY")
  console.log("=" .repeat(50))
  console.log(`✅ Inventory levels updated: ${updatedCount}`)
  console.log(`📦 Inventory items created: ${createdCount}`)
  console.log(`⏭️  Products skipped (no Odoo match): ${skippedCount}`)
  console.log(`❌ Errors: ${errorCount}`)
  console.log(`📦 Total Odoo products: ${odooProducts.length}`)
  console.log("\n✅ Inventory sync completed!")
}
