import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { BRAND_MODULE } from "../../../../modules/brands"
import fs from "fs"
import path from "path"

/**
 * POST /odoo/webhooks/brands
 *
 * INSTANT brand sync webhook — Odoo calls this endpoint
 * whenever a brand is created or updated.
 *
 * Payload expected:
 * {
 *   "secret": "marqa-odoo-webhook-2026",
 *   "brand": {
 *     "name": "JBL",
 *     "image_1920": "base64_string..."
 *   }
 * }
 */

const WEBHOOK_SECRET = process.env.ODOO_WEBHOOK_SECRET || "marqa-odoo-webhook-2026"
const BRANDS_UPLOAD_DIR = path.join(process.cwd(), "static", "uploads", "brands")

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const startTime = Date.now()
  const body = req.body as any

  // 1. Verify webhook secret
  const secret = body?.secret || req.headers["x-webhook-secret"]
  if (secret !== WEBHOOK_SECRET) {
    res.status(401).json({ success: false, error: "Invalid webhook secret" })
    return
  }

  // 2. Extract brand data
  const brandData = body?.brand
  if (!brandData || !brandData.name) {
    res.status(400).json({ success: false, error: "Missing brand data or brand name" })
    return
  }

  const name = brandData.name.trim()
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  
  if (!fs.existsSync(BRANDS_UPLOAD_DIR)) {
    fs.mkdirSync(BRANDS_UPLOAD_DIR, { recursive: true })
  }

  // 3. Process logo if provided
  let logoUrl: string | null = null
  const img = brandData.image_1920

  if (img && typeof img === 'string' && img.length > 200) {
    try {
      const buf = Buffer.from(img, 'base64')
      const isSvg = buf.slice(0, 100).toString('utf8').trim().startsWith('<svg') || 
                    buf.slice(0, 100).toString('utf8').trim().startsWith('<?xml')
      const ext = isSvg ? '.svg' : '.png'
      
      const fname = `${slug}-brand${ext}`
      const fpath = path.join(BRANDS_UPLOAD_DIR, fname)
      
      fs.writeFileSync(fpath, buf)
      logoUrl = `/static/uploads/brands/${fname}`
    } catch(e: any) {
      console.error(`[Brand Webhook] Failed to write image for ${name}: ${e.message}`)
    }
  }

  // 4. Update Database
  const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  let brandService: any
  try {
    brandService = req.scope.resolve(BRAND_MODULE)
  } catch {
    console.error("[Brand Webhook] BRAND_MODULE not registered.")
    res.status(500).json({ success: false, error: "Brand module not found" })
    return
  }

  try {
    const existingResult = await pgConnection.raw(
      `SELECT id, logo_url FROM brand WHERE LOWER(name) = ?`,
      [name.toLowerCase()]
    )
    
    if (existingResult.rows?.length > 0) {
      // Update
      const existingId = existingResult.rows[0].id
      const currentLogo = existingResult.rows[0].logo_url
      const newLogo = logoUrl || currentLogo
      
      await pgConnection.raw(
        `UPDATE brand SET updated_at = NOW(), logo_url = ? WHERE id = ?`,
        [newLogo, existingId]
      )
      
      res.json({ success: true, action: "updated", brand: name, elapsed_ms: Date.now() - startTime })
    } else {
      // Create
      await brandService.createBrands({
         name: name,
         slug: slug,
         logo_url: logoUrl || null,
         is_active: true,
         is_special: false
      })
      
      res.json({ success: true, action: "created", brand: name, elapsed_ms: Date.now() - startTime })
    }
  } catch (err: any) {
    console.error(`[Brand Webhook] Error processing brand ${name}: ${err.message}`)
    res.status(500).json({ success: false, error: err.message })
  }
}
