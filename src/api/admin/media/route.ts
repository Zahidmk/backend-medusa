import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { MEDIA_MODULE } from "../../../modules/media"

// Admin endpoints require authentication
export const AUTHENTICATE = true

async function ensureProductIdsColumn(scope: any) {
  try {
    const pg = scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as any
    await pg.raw(`ALTER TABLE IF EXISTS "media" ADD COLUMN IF NOT EXISTS "product_ids" jsonb null;`)
  } catch (err) {
    console.warn("Could not auto-add product_ids column:", err)
  }
}

/**
 * GET /admin/media
 * Query: limit, offset
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    await ensureProductIdsColumn(req.scope)
    const mediaService = req.scope.resolve(MEDIA_MODULE) as any
    const limit = Number(req.query.limit || 50)
    const offset = Number(req.query.offset || 0)

    const [rows, count] = await mediaService.listAndCountMedia({}, { take: limit, skip: offset })

    // Return DB fields as-is (admin UI expects url, thumbnail_url etc)
    const media = (rows || []).map((m: any) => ({
      id: m.id,
      url: m.url,
      mime_type: m.mime_type || null,
      title: m.title || null,
      title_ar: m.title_ar || null,
      alt_text: m.alt_text || null,
      thumbnail_url: m.thumbnail_url || null,
      brand: m.brand || null,
      views: m.views ?? 0,
      display_order: m.display_order ?? 0,
      is_featured: !!m.is_featured,
      product_ids: m.product_ids || [],
      metadata: m.metadata || null,
    }))

    res.json({ media, count: count || 0 })
  } catch (e: any) {
    console.error('Admin media GET error:', e)
    res.status(500).json({ message: e?.message || 'Failed to list media' })
  }
}

/**
 * POST /admin/media
 * Body: { url, title?, mime_type?, thumbnail_url? }
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    await ensureProductIdsColumn(req.scope)
    const mediaService = req.scope.resolve(MEDIA_MODULE) as any
    const body = (req.body || {}) as any

    const productIds = Array.isArray(body.product_ids) ? body.product_ids : []
    let brand = body.brand || null

    // Auto-derive brand from linked product if brand was not specified
    if (!brand && productIds.length > 0) {
      try {
        const pg = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as any
        const resProd = await pg.raw(`SELECT metadata FROM product WHERE id = ?`, [productIds[0]])
        const meta = resProd.rows?.[0]?.metadata
        const metaObj = typeof meta === 'string' ? JSON.parse(meta) : (meta || {})
        if (metaObj.brand) {
          brand = metaObj.brand
        }
      } catch (err) {
        // non-blocking
      }
    }

    const payload: any = {
      url: body.url,
      title: body.title,
      title_ar: body.title_ar,
      mime_type: body.mime_type,
      alt_text: body.alt_text,
      thumbnail_url: body.thumbnail_url,
      brand,
      views: typeof body.views === "number" ? body.views : undefined,
      display_order: typeof body.display_order === "number" ? body.display_order : undefined,
      is_featured: typeof body.is_featured === "boolean" ? body.is_featured : undefined,
      product_ids: productIds,
      metadata: body.metadata,
    }

    const created = await (typeof mediaService.createMedia === 'function'
      ? mediaService.createMedia(payload)
      : mediaService.createMedias(payload))

    const result = Array.isArray(created) ? created[0] : created
    res.status(201).json({ media: result })
  } catch (e: any) {
    console.error('Admin media POST error:', e)
    res.status(500).json({ message: e?.message || 'Failed to create media' })
  }
}

