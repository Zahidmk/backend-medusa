/**
 * Manual Odoo Sync Endpoint
 * POST /admin/odoo/sync-now - Trigger immediate sync
 * GET /admin/odoo/sync-status - Check sync status
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import https from "https"

const ODOO_CONFIG = {
  url: process.env.ODOO_URL || "https://oskarllc-new-31031096.dev.odoo.com",
  db: process.env.ODOO_DB_NAME || "oskarllc-new-31031096",
  username: process.env.ODOO_USERNAME || "SYG",
  password: process.env.ODOO_PASSWORD || "S123456",
}

async function odooJsonRpc(params: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      jsonrpc: "2.0",
      method: "call",
      params,
      id: Date.now(),
    })

    const url = new URL(ODOO_CONFIG.url)
    const options = {
      hostname: url.hostname,
      port: 443,
      path: "/jsonrpc",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    }

    const req = https.request(options, (res) => {
      let body = ""
      res.on("data", (chunk) => (body += chunk))
      res.on("end", () => {
        try {
          const result = JSON.parse(body)
          resolve(result.result)
        } catch (e) {
          reject(e)
        }
      })
    })

    req.on("error", reject)
    req.write(data)
    req.end()
  })
}

// POST /admin/odoo/sync-now - Trigger immediate full sync
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { Pool } = require("pg")
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || "postgres://marqa_user:marqa123@localhost:5432/marqa_souq_dev",
  })

  try {
    // Authenticate with Odoo
    const uid = await odooJsonRpc({
      service: "common",
      method: "authenticate",
      args: [ODOO_CONFIG.db, ODOO_CONFIG.username, ODOO_CONFIG.password, {}],
    })

    if (!uid) {
      return res.status(401).json({ success: false, error: "Failed to authenticate with Odoo" })
    }

    // Fetch ALL products from Odoo (paginate to get all 6000+)
    const allOdooProducts: any[] = []
    let offset = 0
    const pageSize = 500
    let hasMore = true

    while (hasMore) {
      console.log(`[Odoo Sync] Fetching products page offset=${offset}...`)
      const pageProducts = await odooJsonRpc({
        service: "object",
        method: "execute_kw",
        args: [
          ODOO_CONFIG.db,
          uid,
          ODOO_CONFIG.password,
          "product.product",
          "search_read",
          [[["sale_ok", "=", true]]],
          {
            fields: ["id", "name", "default_code", "list_price", "barcode", "categ_id", "qty_available", "image_1920"],
            limit: pageSize,
            offset: offset,
          },
        ],
      })

      if (!pageProducts || pageProducts.length === 0) {
        hasMore = false
      } else {
        allOdooProducts.push(...pageProducts)
        offset += pageSize
        console.log(`[Odoo Sync] Fetched ${pageProducts.length} products. Total so far: ${allOdooProducts.length}`)
      }
    }

    console.log(`[Odoo Sync] Total products fetched from Odoo: ${allOdooProducts.length}`)
    const odooProducts = allOdooProducts

    // Get existing products
    const existingProducts = await pool.query("SELECT id, handle, metadata FROM product")
    const existingOdooIds = new Set(
      existingProducts.rows
        .filter((p: any) => p.metadata?.odoo_id)
        .map((p: any) => p.metadata.odoo_id)
    )
    const existingHandles = new Set(existingProducts.rows.map((p: any) => p.handle))

    // Get sales channel
    const salesChannelResult = await pool.query("SELECT id FROM sales_channel LIMIT 1")
    const salesChannelId = salesChannelResult.rows[0]?.id

    let imported = 0
    let skipped = 0
    const batchSize = 50
    const totalProducts = odooProducts.length

    console.log(`[Odoo Sync] Starting import of ${totalProducts} products...`)

    for (let i = 0; i < odooProducts.length; i++) {
      const product = odooProducts[i]

      // Log progress every 50 products
      if (i % batchSize === 0) {
        console.log(`[Odoo Sync] Progress: ${i}/${totalProducts} (${Math.round((i / totalProducts) * 100)}%)`)
      }

      // Skip if already imported
      if (existingOdooIds.has(product.id)) {
        skipped++
        continue
      }

      const handle = product.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .substring(0, 100)

      // Skip if handle exists
      if (existingHandles.has(handle)) {
        skipped++
        continue
      }

      const sku = product.default_code || `ODOO-${product.id}`

      try {
        const productId = `prod_${Date.now()}${Math.random().toString(36).substr(2, 9)}`

        // Create product
        await pool.query(
          `INSERT INTO product (id, title, handle, status, metadata, created_at, updated_at)
           VALUES ($1, $2, $3, 'published', $4, NOW(), NOW())`,
          [
            productId,
            product.name,
            handle,
            JSON.stringify({
              odoo_id: product.id,
              odoo_sku: sku,
              odoo_category: product.categ_id ? product.categ_id[1] : null,
            }),
          ]
        )

        // Create variant
        const variantId = `variant_${Date.now()}${Math.random().toString(36).substr(2, 9)}`
        await pool.query(
          `INSERT INTO product_variant (id, product_id, title, sku, metadata, created_at, updated_at)
           VALUES ($1, $2, 'Default', $3, $4, NOW(), NOW())`,
          [variantId, productId, sku, JSON.stringify({ odoo_id: product.id })]
        )

        // Add to sales channel
        if (salesChannelId) {
          await pool.query(
            `INSERT INTO product_sales_channel (product_id, sales_channel_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [productId, salesChannelId]
          )
        }

        // Add image if exists
        if (product.image_1920) {
          const imageUrl = `${ODOO_CONFIG.url}/web/image/product.product/${product.id}/image_1920`
          await pool.query(
            `INSERT INTO product_image (id, product_id, url, created_at, updated_at)
             VALUES ($1, $2, $3, NOW(), NOW())`,
            [`img_${Date.now()}${Math.random().toString(36).substr(2, 9)}`, productId, imageUrl]
          )
        }

        existingHandles.add(handle)
        existingOdooIds.add(product.id)
        imported++
      } catch (error: any) {
        console.error(`Failed to import ${product.name}:`, error.message)
      }
    }

    console.log(`[Odoo Sync] Import complete! Imported ${imported}, skipped ${skipped}`)

    await pool.end()

    res.json({
      success: true,
      message: `Sync completed! Imported ${imported} new products, skipped ${skipped} existing.`,
      stats: {
        odoo_total: odooProducts.length,
        imported,
        skipped,
        medusa_total: existingProducts.rows.length + imported,
      },
    })
  } catch (error: any) {
    await pool.end()
    res.status(500).json({ success: false, error: error.message })
  }
}

// GET /admin/odoo/sync-now - Get sync status
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { Pool } = require("pg")
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || "postgres://marqa_user:marqa123@localhost:5432/marqa_souq_dev",
  })

  try {
    // Get Odoo product count
    const uid = await odooJsonRpc({
      service: "common",
      method: "authenticate",
      args: [ODOO_CONFIG.db, ODOO_CONFIG.username, ODOO_CONFIG.password, {}],
    })

    const odooCount = await odooJsonRpc({
      service: "object",
      method: "execute_kw",
      args: [
        ODOO_CONFIG.db,
        uid,
        ODOO_CONFIG.password,
        "product.product",
        "search_count",
        [[["sale_ok", "=", true]]],
      ],
    })

    // Get MedusaJS product count
    const medusaResult = await pool.query("SELECT COUNT(*) as count FROM product")
    const medusaCount = parseInt(medusaResult.rows[0].count)

    // Get last sync time
    let lastSync = null
    try {
      const syncResult = await pool.query("SELECT value FROM system_config WHERE key = 'odoo_last_sync'")
      lastSync = syncResult.rows[0]?.value
    } catch (e) {}

    await pool.end()

    res.json({
      success: true,
      odoo_products: odooCount,
      medusa_products: medusaCount,
      missing: odooCount - medusaCount,
      last_sync: lastSync,
      auto_sync_enabled: true,
      auto_sync_interval: "5 minutes",
    })
  } catch (error: any) {
    await pool.end()
    res.status(500).json({ success: false, error: error.message })
  }
}
