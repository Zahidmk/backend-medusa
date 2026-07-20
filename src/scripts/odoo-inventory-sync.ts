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
  qty_available?: number
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
  
  // Debug stock.quant directly
  console.log("\n🔍 Checking stock.quant directly for SKU BMOHMP17X25PCSPEG...")
  try {
    const prodRes = await axios.post(`${odooUrl}/jsonrpc`, {
      jsonrpc: "2.0", method: "call",
      params: { service: "object", method: "execute_kw", args: [odooDb, uid, odooPassword, "product.product", "search_read", [[["default_code", "=", "BMOHMP17X25PCSPEG"]]], { fields: ["id"], limit: 1 }] },
      id: 99
    })
    const pid = prodRes.data.result?.[0]?.id
    if (pid) {
      const quantRes = await axios.post(`${odooUrl}/jsonrpc`, {
        jsonrpc: "2.0", method: "call",
        params: { 
          service: "object", 
          method: "execute_kw", 
          args: [
            odooDb, uid, odooPassword, "stock.quant", "search_read", 
            [[["product_id", "=", pid]]], 
            { 
              fields: ["quantity", "reserved_quantity", "location_id"],
              limit: 10 
            }
          ] 
        },
        id: 100
      })
      console.log("🚨 STOCK.QUANT RAW RESULT 🚨")
      console.log(JSON.stringify(quantRes.data.result, null, 2))
      console.log("----------------------------\n")
    } else {
       console.log("Could not find product BMOHMP17X25PCSPEG in Odoo to check stock.quant")
    }
  } catch (e: any) {
    console.log("Could not check stock.quant:", e.message)
  }
  
  let odooProducts: OdooProduct[] = []
  
  // Discover available quantity fields safely
  console.log("\n🔍 Discovering available quantity fields in Odoo...")
  try {
      const discoveryRes = await axios.post(`${odooUrl}/jsonrpc`, {
        jsonrpc: "2.0", method: "call",
        params: {
          service: "object", method: "execute_kw",
          args: [odooDb, uid, odooPassword, "product.product", "search_read", [[["active", "=", true]]], { limit: 1 }]
        }, id: 2
      })
      const sample = discoveryRes.data.result?.[0]
      if (sample) {
        const qtyKeys = Object.keys(sample).filter(k => k.includes("qty") || k.includes("quant") || k.includes("available"))
        console.log("--- DEBUG: AVAILABLE QUANTITY FIELDS ---")
        console.log(qtyKeys.map(k => `${k}: ${sample[k]}`))
        console.log("----------------------------------------\n")
      }
    } catch (e: any) {
      console.log("Could not discover schema:", e.message)
    }

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
            fields: ["id", "default_code", "free_qty", "qty_available", "virtual_available", "name"],
            limit: 10000
          }
        ]
      },
      id: 3
    })
    
    odooProducts = productsResponse.data.result || []
    console.log(`✅ Found ${odooProducts.length} products in Odoo`)
    
    // Check specific problematic SKU
    const targetSku = "BMOHMP17X25PCSPEG"
    const problematicProduct = odooProducts.find(p => p.default_code === targetSku)
    if (problematicProduct) {
      console.log(`\n🚨 FOUND TARGET SKU IN ODOO: ${targetSku} 🚨`)
      console.log(JSON.stringify(problematicProduct, null, 2))
      console.log("------------------------------------------------\n")
    } else {
      console.log(`\n🚨 TARGET SKU NOT FOUND IN ODOO: ${targetSku} 🚨\n`)
    }
    
    // Debug output to verify what Odoo is returning
    console.log("\\n🔍 First 20 Odoo Products Quantities:");
    for (const p of odooProducts.slice(0, 20)) {
      console.log(
        p.default_code,
        "| free_qty =", p.free_qty,
        "| qty_available =", p.qty_available,
        "| virtual_available =", p.virtual_available
      )
    }
    console.log("");
  } catch (error: any) {
    console.error("❌ Failed to fetch inventory:", error.message)
    return
  }
  
  // Build SKU to inventory map
  const odooInventory = new Map<string, { qty: number, odooId: number, name: string, fullProduct: OdooProduct }>()
  for (const product of odooProducts) {
    const sku = product.default_code || `ODOO-${product.id}`
    odooInventory.set(sku, {
      qty: Math.max(0, Math.floor(product.free_qty || product.qty_available || 0)),
      odooId: product.id,
      name: product.name,
      fullProduct: product
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
              
              const levels = await inventoryModuleService.listInventoryLevels({
                inventory_item_id: inventoryItem.id,
                location_id: location.id,
              })
              
              if (levels && levels.length > 0) {
                // Update existing level
                await inventoryModuleService.updateInventoryLevels({
                  inventory_item_id: inventoryItem.id,
                  location_id: location.id,
                  stocked_quantity: qty,
                })
                updatedCount++
                console.log(`  ✅ Updated stock for ${sku} -> ${qty}`)
              } else {
                // Create new level
                await inventoryModuleService.createInventoryLevels({
                  inventory_item_id: inventoryItem.id,
                  location_id: location.id,
                  stocked_quantity: qty
                })
                updatedCount++
                console.log(`  ➕ Set initial stock for ${sku} -> ${qty}`)
              }

              // Update product metadata with exact numbers for debugging
              try {
                await productModuleService.updateProducts(product.id, {
                  metadata: {
                    ...(product.metadata || {}),
                    free_qty: odooStock.fullProduct.free_qty ?? null,
                    qty_available: odooStock.fullProduct.qty_available ?? null,
                    forecasted_qty: odooStock.fullProduct.virtual_available ?? null,
                    inventory_synced_at: new Date().toISOString()
                  }
                })
              } catch (metaErr) {
                // Ignore metadata update errors
              }

            } else {
              const remoteLink = container.resolve("remoteLink" as any)
              
              // This is safe even if it's already linked, but we can wrap it in try/catch just in case
              try {
                await remoteLink.create({
                  "product": {
                    variant_id: variant.id
                  },
                  "inventory": {
                    inventory_item_id: inventoryItem.id
                  }
                })
                console.log(`  🔗 Linked inventory item to variant ${sku}`)
              } catch (linkError) {
                // Usually means it's already linked, which is fine
              }
              
              updatedCount++
              if (updatedCount <= 20) {
                console.log(`  ✅ ${sku}: ${odooStock.qty} units (${odooStock.name})`)
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
