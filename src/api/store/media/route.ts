import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { MEDIA_MODULE } from "../../../modules/media"
import { BRAND_MODULE } from "../../../modules/brands"
import BrandService from "../../../modules/brands/service"
import { Knex } from "knex"

export const AUTHENTICATE = false

function parseProductIds(raw: any): string[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.map(x => String(x).trim()).filter(Boolean)
  if (typeof raw === 'number') return [String(raw)]
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) return []
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) return parsed.map(x => String(x).trim()).filter(Boolean)
      if (typeof parsed === 'string' || typeof parsed === 'number') return [String(parsed).trim()]
    } catch (e) {
      if (trimmed.includes(',')) {
        return trimmed.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
      }
      return [trimmed.replace(/^['"]|['"]$/g, '')]
    }
  }
  return []
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const mediaService = req.scope.resolve(MEDIA_MODULE) as any
    const gallery_id = req.query.gallery_id as string | undefined
    let items: any[] = []
    let count = 0

    if (gallery_id) {
      const mediaIds = await mediaService.listGalleryMediaIds(gallery_id)
      if (!mediaIds || !mediaIds.length) return res.json({ media: [], count: 0 })
      const [rows, c] = await mediaService.listAndCountMedia({ id: { $in: mediaIds } }, { take: 200 })
      items = rows || []
      count = c || 0
    } else {
      const [rows, c] = await mediaService.listAndCountMedia({}, { take: 200 })
      items = rows || []
      count = c || 0
    }

    // Build a brand logo map keyed by brand name for O(1) lookup per media item
    const brandService = req.scope.resolve<BrandService>(BRAND_MODULE)
    const [allBrands] = await brandService.listAndCountBrands({}, { take: 200 })
    const brandLogoMap = new Map<string, { logo_url: string | null; slug: string | null }>()
    for (const b of allBrands) {
      brandLogoMap.set(b.name, { logo_url: b.logo_url ?? null, slug: b.slug ?? null })
    }

    const getOrigin = () => {
      const fromEnv = process.env.MEDUSA_URL
      if (fromEnv) return fromEnv.replace(/\/$/, '')
      return `${(req.headers['x-forwarded-proto'] as string) || (req.protocol as string) || 'http'}://${req.headers.host || 'localhost:9000'}`
    }

    const origin = getOrigin()
    const makeAbsolute = (u: string | null) => {
      if (!u) return null
      if (u.startsWith('http://') || u.startsWith('https://')) return u
      const path = u.startsWith('/') ? u : `/${u}`
      return `${origin}${path}`
    }

    // Collect all product IDs across all media items to batch-fetch them
    const allProductIds: string[] = []
    for (const m of items) {
      const pids = parseProductIds(m.product_ids)
      for (const pid of pids) {
        if (pid && !allProductIds.includes(pid)) allProductIds.push(pid)
      }
    }

    // Batch-fetch products from the DB using raw SQL for performance
    const productMap = new Map<string, any>()
    if (allProductIds.length > 0) {
      try {
        const pgConnection: Knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
        const placeholders = allProductIds.map(() => '?').join(', ')

        // Query products by ID, Handle, or Odoo Template ID cleanly
        const resProds = await pgConnection.raw(
          `SELECT p.id, p.title, p.handle, p.metadata,
                  COALESCE(p.thumbnail, (SELECT url FROM product_image pi WHERE pi.product_id = p.id AND pi.deleted_at IS NULL ORDER BY pi.rank ASC LIMIT 1)) as thumbnail
           FROM product p
           WHERE (p.id IN (${placeholders}) OR p.handle IN (${placeholders}) OR p.metadata->>'odoo_template_id' IN (${placeholders})) AND p.deleted_at IS NULL`,
          [...allProductIds, ...allProductIds, ...allProductIds]
        )

        const priceMap = new Map<string, string>()
        try {
          const resPrices = await pgConnection.raw(
            `SELECT pvar.product_id, pr.amount
             FROM product_variant pvar
             JOIN product_variant_price_set pvps ON pvps.variant_id = pvar.id
             JOIN price pr ON pr.price_set_id = pvps.price_set_id
             WHERE pvar.product_id IN (
               SELECT id FROM product WHERE (id IN (${placeholders}) OR handle IN (${placeholders})) AND deleted_at IS NULL
             ) AND pvar.deleted_at IS NULL
             ORDER BY pr.amount ASC`,
            [...allProductIds, ...allProductIds]
          )
          for (const row of resPrices.rows || []) {
            if (!priceMap.has(row.product_id) && row.amount != null) {
              const amt = parseFloat(row.amount)
              const formatted = amt > 100 ? (amt / 1000).toFixed(3) : amt.toFixed(3)
              priceMap.set(row.product_id, formatted)
            }
          }
        } catch (priceErr) {
          console.warn("Price fetch warning for media products:", priceErr)
        }

        for (const row of resProds.rows || []) {
          const pPrice = priceMap.get(row.id) || null
          const prodObj = {
            id: row.id,
            title: row.title,
            handle: row.handle || row.id,
            thumbnail: makeAbsolute(row.thumbnail || null),
            price: pPrice,
            calculated_price: pPrice
          }
          if (row.id) productMap.set(row.id, prodObj)
          if (row.handle) productMap.set(row.handle, prodObj)
          if (row.metadata) {
            try {
              const metaObj = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
              if (metaObj?.odoo_template_id) productMap.set(String(metaObj.odoo_template_id), prodObj)
            } catch (e) {}
          }
        }
      } catch (err) {
        console.error('Failed to fetch products for media:', err)
      }
    }

    console.log(`[Store Media API] Items: ${items.length}, Products matched: ${productMap.size}`)

    const media = items.map((m: any) => {
      const brandInfo = m.brand ? brandLogoMap.get(m.brand) : null
      const pids = parseProductIds(m.product_ids)
      const related_products = pids.map((pid: string) => productMap.get(pid)).filter(Boolean)

      return {
        id: m.id,
        url: makeAbsolute(m.url || null),
        mime_type: m.mime_type || null,
        title: m.title || null,
        title_ar: m.title_ar || null,
        alt_text: m.alt_text || null,
        thumbnail_url: makeAbsolute(m.thumbnail_url || null),
        brand: m.brand || null,
        brand_logo_url: brandInfo ? brandInfo.logo_url : null,
        brand_slug: brandInfo ? brandInfo.slug : null,
        views: m.views ?? 0,
        display_order: m.display_order ?? 0,
        is_featured: !!m.is_featured,
        product_ids: pids,
        related_products,
        metadata: m.metadata || null,
      }
    })

    res.json({ media, count })
  } catch (e: any) {
    console.error('Store media GET error:', e)
    res.status(500).json({ message: e?.message || 'Failed to list media' })
  }
}
