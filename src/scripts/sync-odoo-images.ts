import { ExecArgs } from "@medusajs/framework/types"
import axios from "axios"

/**
 * Sync Odoo Product Images
 * 
 * This script sets direct Odoo image URLs for products,
 * instead of downloading and storing images locally.
 * 
 * Odoo serves images publicly at:
 *   {ODOO_URL}/web/image/product.product/{odoo_id}/image_1920
 * 
 * Run with: yarn sync:images
 */

interface ProductWithImage {
  id: string
  title: string
  metadata: {
    odoo_id?: number
  }
}

// Odoo configuration
const ODOO_URL = process.env.ODOO_URL || "https://oskarllc-new-31031096.dev.odoo.com"
const ODOO_DB = process.env.ODOO_DB_NAME || "oskarllc-new-31031096"
const ODOO_USERNAME = process.env.ODOO_USERNAME || "SYG"
const ODOO_PASSWORD = process.env.ODOO_API_KEY || process.env.ODOO_PASSWORD || "S123456"

export default async function syncOdooImages({ container }: ExecArgs) {
  console.log("\n🖼️  Starting Odoo Image Sync (Direct URL mode)...")
  console.log("=" .repeat(50))
  
  // Authenticate with Odoo
  console.log("\n1️⃣  Authenticating with Odoo...")
  
  let uid: number
  try {
    const authResponse = await axios.post(`${ODOO_URL}/jsonrpc`, {
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "common",
        method: "authenticate",
        args: [ODOO_DB, ODOO_USERNAME, ODOO_PASSWORD, {}]
      },
      id: 1
    })
    
    uid = authResponse.data.result
    if (!uid) {
      console.error("❌ Authentication failed")
      return
    }
    console.log(`✅ Authenticated (UID: ${uid})`)
  } catch (error: any) {
    console.error("❌ Authentication failed:", error.message)
    return
  }
  
  // Get database connection
  const { Pool } = require("pg")
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || "postgres://marqa_user:marqa123@localhost:5432/marqa_souq_dev",
  })
  
  // Get all products with odoo_id that don't have images yet
  console.log("\n2️⃣  Finding products that need images...")
  
  const productsResult = await pool.query(`
    SELECT p.id, p.title, p.metadata
    FROM product p
    WHERE p.metadata->>'odoo_id' IS NOT NULL
    AND p.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM image i 
      WHERE i.product_id = p.id 
      AND i.deleted_at IS NULL
    )
    ORDER BY p.created_at DESC
    LIMIT 300
  `)
  
  const productsWithoutImages: ProductWithImage[] = productsResult.rows
  console.log(`📦 Found ${productsWithoutImages.length} products needing images`)
  
  if (productsWithoutImages.length === 0) {
    console.log("✅ All products already have images!")
    await pool.end()
    return
  }
  
  // Get Odoo IDs for these products
  const odooIds = productsWithoutImages
    .map(p => p.metadata?.odoo_id)
    .filter(Boolean)
  
  // Fetch images from Odoo
  console.log("\n3️⃣  Fetching images from Odoo...")
  
  let odooProducts: any[] = []
  try {
    const response = await axios.post(`${ODOO_URL}/jsonrpc`, {
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [
          ODOO_DB,
          uid,
          ODOO_PASSWORD,
          "product.product",
          "search_read",
          [[["id", "in", odooIds]]],
          {
            fields: ["id", "name", "image_1920"],
            limit: 500
          }
        ]
      },
      id: 2
    })
    
    odooProducts = response.data.result || []
    console.log(`✅ Fetched ${odooProducts.length} products from Odoo`)
  } catch (error: any) {
    console.error("❌ Failed to fetch from Odoo:", error.message)
    await pool.end()
    return
  }
  
  // Create a set of Odoo IDs that have images
  const odooIdsWithImages = new Set<number>()
  for (const product of odooProducts) {
    // Odoo returns image_1920 as base64 string if image exists, false if not
    if (product.image_1920 && product.image_1920 !== false) {
      odooIdsWithImages.add(product.id)
    }
  }
  
  console.log(`📷 Products with images: ${odooIdsWithImages.size}`)
  
  // Process and set direct Odoo image URLs
  console.log("\n4️⃣  Setting Odoo direct image URLs...")
  
  let savedCount = 0
  let errorCount = 0
  let noImageCount = 0
  
  for (const product of productsWithoutImages) {
    const odooId = product.metadata?.odoo_id
    if (!odooId) continue
    
    if (!odooIdsWithImages.has(odooId)) {
      noImageCount++
      continue
    }
    
    try {
      // Use Odoo's direct public image URL instead of downloading
      const imageUrl = `${ODOO_URL}/web/image/product.product/${odooId}/image_1920`
      
      // Insert image record into database
      const imageId = `img_odoo_${odooId}_${Date.now()}`
      await pool.query(
        `INSERT INTO image (id, product_id, url, rank, created_at, updated_at)
         VALUES ($1, $2, $3, 0, NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [imageId, product.id, imageUrl]
      )

      // Also update the product thumbnail
      await pool.query(
        `UPDATE product SET thumbnail = $1, updated_at = NOW() WHERE id = $2 AND (thumbnail IS NULL OR thumbnail LIKE '/static/%' OR thumbnail LIKE 'http://localhost%')`,
        [imageUrl, product.id]
      )
      
      savedCount++
      if (savedCount % 20 === 0) {
        console.log(`  ✅ Set ${savedCount} image URLs...`)
      }
      
    } catch (error: any) {
      errorCount++
      console.log(`  ❌ Error setting image for ${product.title}: ${error.message}`)
    }
  }
  
  // Close database connection
  await pool.end()
  
  // Summary
  console.log("\n" + "=" .repeat(50))
  console.log("📊 IMAGE SYNC SUMMARY")
  console.log("=" .repeat(50))
  console.log(`✅ Image URLs set: ${savedCount}`)
  console.log(`📷 No image in Odoo: ${noImageCount}`)
  console.log(`❌ Errors: ${errorCount}`)
  console.log(`� URL pattern: ${ODOO_URL}/web/image/product.product/{id}/image_1920`)
  console.log("\n✅ Image sync completed!")
}
