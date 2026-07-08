import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MEDIA_MODULE } from "../../../modules/media"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * GET /store/homepage
 * Returns homepage sections: banners + product grids grouped by collection.
 * Uses raw SQL to fetch products by collection — reliable and fast.
 */

const SECTION_HANDLES: Record<string, string[]> = {
  host_deals: ['hot-deals'],
  best_in_powerbanks: ['best-in-power-banks', 'powerbanks', 'powerbank'],
  best_in_laptops: ['best-in-laptops', 'laptops', 'laptop'],
  new_arrival: ['new-arrival', 'new-arrivals'],
  apple: ['apple'],
  // 'recommended' is intentionally omitted — built dynamically from best sellers (completed orders)
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const mediaService = req.scope.resolve(MEDIA_MODULE) as any
    const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as any

    // Use BACKEND_URL env or build from request headers (works on localhost AND production)
    const origin = (
      process.env.BACKEND_URL ||
      process.env.MEDUSA_URL ||
      `${req.protocol}://${req.get('host')}`
    ).replace(/\/$/, '')

    const makeAbsolute = (u: string | null) => {
      if (!u) return null
      // Strip any hardcoded localhost URL so it works on production too
      let cleaned = u
        .replace(/^https?:\/\/localhost:\d+/, '')
        .replace(/^https?:\/\/127\.0\.0\.1:\d+/, '')
      if (cleaned.startsWith('http://') || cleaned.startsWith('https://')) return cleaned
      return `${origin}${cleaned.startsWith('/') ? cleaned : '/' + cleaned}`
    }

    // ── Banners ──────────────────────────────────────────────
    const mapBanners = (rows: any[]) => (rows || []).map((b: any) => ({
      id: b.id,
      title: b.title || null,
      link: b.link || null,
      position: b.position || null,
      image_url: makeAbsolute(b.image_url || null),
      media: { url: makeAbsolute(b.image_url || null) },
    }))

    const [heroRows] = await mediaService.listAndCountBanners({ is_active: true, position: "hero" }, { order: { display_order: "ASC" }, take: 12 })
    const [singleRows] = await mediaService.listAndCountBanners({ is_active: true, position: "single" }, { order: { display_order: "ASC" }, take: 4 })
    const [dualRows] = await mediaService.listAndCountBanners({ is_active: true, position: "dual" }, { order: { display_order: "ASC" }, take: 4 })
    const [tripleRows] = await mediaService.listAndCountBanners({ is_active: true, position: "triple" }, { order: { display_order: "ASC" }, take: 6 })

    const banners = mapBanners(heroRows)
    const singleBanners = mapBanners(singleRows)
    const dualBanners = mapBanners(dualRows)
    const tripleBanners = mapBanners(tripleRows)

    // ── Fetch products by collection handle using raw SQL ─────
    async function fetchByCollection(handles: string[], limit: number): Promise<any[]> {
      if (!handles.length) return []

      const placeholders = handles.map(() => '?').join(', ')

      const query = `
        SELECT p.id, p.title, p.handle, p.subtitle, p.description,
               p.thumbnail, p.status, p.collection_id, p.created_at,
               p.metadata
        FROM product p
        INNER JOIN product_collection pc ON p.collection_id = pc.id
        WHERE pc.handle IN (${placeholders})
          AND p.status = 'published'
        ORDER BY p.created_at DESC
        LIMIT ?
      `

      const result = await pgConnection.raw(query, [...handles, limit])
      const products = result.rows || []

      // Fetch images and variants for these products
      if (products.length > 0) {
        const productIds = products.map((p: any) => p.id)
        const idPlaceholders = productIds.map(() => '?').join(', ')

        const imgResult = await pgConnection.raw(
          `SELECT id, product_id, url, rank FROM image WHERE product_id IN (${idPlaceholders}) ORDER BY rank ASC`,
          productIds
        )
        const imagesByProduct: Record<string, any[]> = {}
        for (const img of (imgResult.rows || [])) {
          if (!imagesByProduct[img.product_id]) imagesByProduct[img.product_id] = []
          imagesByProduct[img.product_id].push({ ...img, url: makeAbsolute(img.url) })
        }

        const varResult = await pgConnection.raw(
          `SELECT pv.id, pv.product_id, pv.title, pv.sku, pv.manage_inventory,
                  pvp.amount, pvp.currency_code
           FROM product_variant pv
           LEFT JOIN product_variant_price_set pvps ON pvps.variant_id = pv.id
           LEFT JOIN price pvp ON pvp.price_set_id = pvps.price_set_id AND pvp.currency_code = 'kwd'
           WHERE pv.product_id IN (${idPlaceholders})`,
          productIds
        )
        const variantsByProduct: Record<string, any[]> = {}
        for (const v of (varResult.rows || [])) {
          if (!variantsByProduct[v.product_id]) variantsByProduct[v.product_id] = []
          const existing = variantsByProduct[v.product_id].find((ev: any) => ev.id === v.id)
          if (existing) {
            if (v.amount != null) {
              existing.prices = existing.prices || []
              existing.prices.push({ amount: v.amount, currency_code: v.currency_code })
            }
          } else {
            variantsByProduct[v.product_id].push({
              id: v.id,
              title: v.title,
              sku: v.sku,
              manage_inventory: v.manage_inventory,
              prices: v.amount != null ? [{ amount: v.amount, currency_code: v.currency_code }] : [],
            })
          }
        }

        return products.map((p: any) => ({
          ...p,
          thumbnail: makeAbsolute(p.thumbnail),
          images: imagesByProduct[p.id] || [],
          variants: variantsByProduct[p.id] || [],
        }))
      }

      return products
    }

    // Fetch all sections
    async function fetchSection(sectionId: string, limit = 12) {
      const handles = SECTION_HANDLES[sectionId] || []
      return fetchByCollection(handles, limit)
    }

    const [hostDeals, powerbanks, laptops, newArrivals, appleProducts] = await Promise.all([
      fetchSection('host_deals', 8),
      fetchSection('best_in_powerbanks', 8),
      fetchSection('best_in_laptops', 8),
      fetchSection('new_arrival', 12),
      fetchSection('apple', 12),
    ])

    // ── Recommended = Best Sellers (auto, no manual curation needed) ──────────
    // ── Recommended = Best Sellers + fill up with newest products ────────────
    // Priority: products with most completed orders come first (ranked).
    // If fewer than 24 best sellers exist, pad with newest published products
    // so the section always looks full. As real orders accumulate, the
    // best sellers naturally replace the filler products.
    const RECOMMENDED_LIMIT = 24
    let recommendedFinal: any[] = []
    try {
      const bestSellersResult = await pgConnection.raw(`
        SELECT
          p.id, p.title, p.handle, p.subtitle, p.description,
          p.thumbnail, p.status, p.collection_id, p.created_at, p.metadata,
          COUNT(oi.id) AS order_count
        FROM product p
        JOIN product_variant pv ON pv.product_id = p.id
        JOIN order_line_item li ON li.variant_id = pv.id
        JOIN order_item oi ON oi.item_id = li.id
        JOIN "order" o ON o.id = oi.order_id
        WHERE o.status = 'completed'
          AND p.status = 'published'
        GROUP BY p.id, p.title, p.handle, p.subtitle, p.description,
                 p.thumbnail, p.status, p.collection_id, p.created_at, p.metadata
        ORDER BY order_count DESC
        LIMIT ${RECOMMENDED_LIMIT}
      `)
      recommendedFinal = bestSellersResult.rows || []
    } catch (e) {
      console.warn('Best sellers query failed, using fallback:', (e as any)?.message)
    }

    // Pad with newest products if we have fewer than RECOMMENDED_LIMIT best sellers
    if (recommendedFinal.length < RECOMMENDED_LIMIT) {
      const existingIds = recommendedFinal.map((p: any) => `'${p.id}'`).join(', ')
      const excludeClause = existingIds.length ? `AND p.id NOT IN (${existingIds})` : ''
      const needed = RECOMMENDED_LIMIT - recommendedFinal.length
      const padResult = await pgConnection.raw(
        `SELECT p.id, p.title, p.handle, p.subtitle, p.description,
                p.thumbnail, p.status, p.collection_id, p.created_at, p.metadata
         FROM product p
         WHERE p.status = 'published' ${excludeClause}
         ORDER BY p.created_at DESC
         LIMIT ${needed}`
      )
      // Pad rows get order_count = 0 (not yet ordered)
      const padRows = (padResult.rows || []).map((p: any) => ({ ...p, order_count: 0 }))
      recommendedFinal = [...recommendedFinal, ...padRows]
    }

    // Hydrate with images + variants (same as fetchByCollection does)
    if (recommendedFinal.length > 0) {
      const productIds = recommendedFinal.map((p: any) => p.id)
      const idPlaceholders = productIds.map(() => '?').join(', ')

      const imgResult = await pgConnection.raw(
        `SELECT id, product_id, url, rank FROM image WHERE product_id IN (${idPlaceholders}) ORDER BY rank ASC`,
        productIds
      )
      const imagesByProduct: Record<string, any[]> = {}
      for (const img of (imgResult.rows || [])) {
        if (!imagesByProduct[img.product_id]) imagesByProduct[img.product_id] = []
        imagesByProduct[img.product_id].push({ ...img, url: makeAbsolute(img.url) })
      }

      const varResult = await pgConnection.raw(
        `SELECT pv.id, pv.product_id, pv.title, pv.sku, pv.manage_inventory,
                pvp.amount, pvp.currency_code
         FROM product_variant pv
         LEFT JOIN product_variant_price_set pvps ON pvps.variant_id = pv.id
         LEFT JOIN price pvp ON pvp.price_set_id = pvps.price_set_id AND pvp.currency_code = 'kwd'
         WHERE pv.product_id IN (${idPlaceholders})`,
        productIds
      )
      const variantsByProduct: Record<string, any[]> = {}
      for (const v of (varResult.rows || [])) {
        if (!variantsByProduct[v.product_id]) variantsByProduct[v.product_id] = []
        const existing = variantsByProduct[v.product_id].find((ev: any) => ev.id === v.id)
        if (existing) {
          if (v.amount != null) {
            existing.prices = existing.prices || []
            existing.prices.push({ amount: v.amount, currency_code: v.currency_code })
          }
        } else {
          variantsByProduct[v.product_id].push({
            id: v.id,
            title: v.title,
            sku: v.sku,
            manage_inventory: v.manage_inventory,
            prices: v.amount != null ? [{ amount: v.amount, currency_code: v.currency_code }] : [],
          })
        }
      }

      recommendedFinal = recommendedFinal.map((p: any) => ({
        ...p,
        thumbnail: makeAbsolute(p.thumbnail),
        images: imagesByProduct[p.id] || [],
        variants: variantsByProduct[p.id] || [],
      }))
    }

    // ── Build response ───────────────────────────────────────
    const toItems = (products: any[]) => products.map((p: any) => ({ id: p.id, type: 'product', product_id: p.id }))

    const sections = [
      { id: 'hero', type: 'banner', items: banners },
      { id: 'single_banner', type: 'banner', position: 'single', items: singleBanners },
      { id: 'dual_banner', type: 'banner', position: 'dual', items: dualBanners },
      { id: 'triple_banner', type: 'banner', position: 'triple', items: tripleBanners },
      { id: 'host_deals', type: 'product_grid', title: 'Host Deals', items: toItems(hostDeals), products: hostDeals },
      { id: 'best_in_powerbanks', type: 'product_grid', title: 'Best in Powerbanks', items: toItems(powerbanks), products: powerbanks },
      { id: 'best_in_laptops', type: 'product_grid', title: 'Best in Laptops', items: toItems(laptops), products: laptops },
      { id: 'new_arrival', type: 'product_grid', title: 'New Arrivals', items: toItems(newArrivals), products: newArrivals },
      { id: 'recommended', type: 'product_grid', title: 'Recommended', items: toItems(recommendedFinal), products: recommendedFinal },
      { id: 'apple', type: 'product_grid', title: 'Apple', items: toItems(appleProducts), products: appleProducts },
    ]

    res.json({
      locale: req.query.locale || 'en',
      generated_at: new Date().toISOString(),
      sections,
      banners: { hero: banners, single: singleBanners, dual: dualBanners, triple: tripleBanners },
    })
  } catch (e: any) {
    console.error('Homepage endpoint error:', e)
    res.status(500).json({ message: e?.message || 'Failed to build homepage' })
  }
}
