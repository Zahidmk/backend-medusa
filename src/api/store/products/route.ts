import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * GET /store/products
 *
 * Returns products from the store, with optional filtering and search.
 *
 * Query params:
 *   ?q=search_term       (search by title or description)
 *   ?limit=20            (default 20, max 100)
 *   ?offset=0            (default 0)
 *   ?handle=product-slug (filter by handle)
 *   ?collection_handle   (filter by collection)
 *   ?tags=tag1,tag2      (filter by tags)
 *   ?region_id=reg_xxx   (specific region for pricing)
 *   ?currency=kwd        (currency for price lookup, default kwd)
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

    // Parse query parameters
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100)
    const offset = parseInt(req.query.offset as string) || 0
    const searchQuery = req.query.q as string
    const handle = req.query.handle as string
    const collectionHandle = req.query.collection_handle as string
    const tags = req.query.tags as string
    const currency = (req.query.currency as string) || "kwd"

    // Build WHERE conditions
    const conditions: string[] = ["p.status = 'published'"]
    const params: any[] = []

    // Search by title or description
    if (searchQuery && searchQuery.trim()) {
      const searchTerm = `%${searchQuery}%`
      conditions.push("(LOWER(p.title) LIKE LOWER(?) OR LOWER(p.description) LIKE LOWER(?))")
      params.push(searchTerm, searchTerm)
    }

    // Filter by ID
    const idParams: string[] = []
    Object.keys(req.query).forEach(key => {
      if (key === "id[]" || key === "id") {
        const val = req.query[key]
        if (Array.isArray(val)) idParams.push(...(val as string[]))
        else idParams.push(val as string)
      }
    })
    if (idParams.length > 0) {
      const placeholders = idParams.map(() => "?").join(",")
      conditions.push(`p.id IN (${placeholders})`)
      params.push(...idParams)
    }

    // Filter by handle
    if (handle) {
      conditions.push("p.handle = ?")
      params.push(handle)
    }

    // Filter by collection ID
    const collParams: string[] = []
    Object.keys(req.query).forEach(key => {
      if (key === "collection_id[]" || key === "collection_id") {
        const val = req.query[key]
        if (Array.isArray(val)) collParams.push(...(val as string[]))
        else collParams.push(val as string)
      }
    })
    if (collParams.length > 0) {
      const placeholders = collParams.map(() => "?").join(",")
      conditions.push(`p.collection_id IN (${placeholders})`)
      params.push(...collParams)
    }

    // Filter by collection handle
    if (collectionHandle) {
      conditions.push(
        `p.id IN (
          SELECT p.id FROM product p
          INNER JOIN product_collection pc ON p.collection_id = pc.id
          WHERE pc.handle = ?
        )`
      )
      params.push(collectionHandle)
    }

    // Filter by tags
    if (tags && tags.trim()) {
      const tagList = tags.split(",").map(t => t.trim()).filter(t => t)
      if (tagList.length > 0) {
        const placeholders = tagList.map(() => "?").join(",")
        conditions.push(
          `p.id IN (
            SELECT DISTINCT pt.product_id FROM product_tag pt
            WHERE pt.tag_id IN (
              SELECT id FROM product_tag WHERE name IN (${placeholders})
            )
          )`
        )
        params.push(...tagList)
      }
    }

    // Count total matching products
    const countQuery = `
      SELECT COUNT(DISTINCT p.id) as total
      FROM product p
      WHERE ${conditions.join(" AND ")}
    `
    const countResult = await pgConnection.raw(countQuery, params)
    const total = parseInt(countResult.rows?.[0]?.total || "0")

    // Fetch products (without variants first - get unique products)
    const productsQuery = `
      SELECT DISTINCT
        p.id,
        p.title,
        p.handle,
        p.thumbnail,
        p.subtitle,
        p.description,
        p.metadata,
        p.created_at,
        p.collection_id
      FROM product p
      WHERE ${conditions.join(" AND ")}
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `
    
    const productsResult = await pgConnection.raw(
      productsQuery,
      [...params, limit, offset]
    )
    const products = productsResult.rows || []

    // Fetch all images for these products
    const productIds = products.map((p: any) => p.id)
    let imagesByProduct: Record<string, any[]> = {}
    let variantsByProduct: Record<string, any[]> = {}
    let optionsByProduct: Record<string, any[]> = {}
    let optionsByVariant: Record<string, any[]> = {}
    
    if (productIds.length > 0) {
      const placeholders = productIds.map(() => "?").join(",")
      const imagesResult = await pgConnection.raw(
        `SELECT id, product_id, url FROM image WHERE product_id IN (${placeholders}) AND deleted_at IS NULL ORDER BY product_id, rank`,
        productIds
      )
      const images = imagesResult.rows || []
      images.forEach((img: any) => {
        if (!imagesByProduct[img.product_id]) {
          imagesByProduct[img.product_id] = []
        }
        imagesByProduct[img.product_id].push({
          id: img.id,
          url: img.url,
        })
      })

      // Fetch ALL variants with prices for these products
      const variantsResult = await pgConnection.raw(
        `SELECT pv.id, pv.product_id, pv.title, pv.sku, pv.manage_inventory, pv.allow_backorder, 
                pv.metadata as variant_metadata, pp.amount as price, pp.currency_code
         FROM product_variant pv
         LEFT JOIN product_variant_price_set pvps ON pvps.variant_id = pv.id
         LEFT JOIN price pp ON pp.price_set_id = pvps.price_set_id 
           AND (LOWER(pp.currency_code) = LOWER(?) OR pp.id = (
             SELECT id FROM price p2 WHERE p2.price_set_id = pvps.price_set_id ORDER BY (LOWER(p2.currency_code) = LOWER(?)) DESC LIMIT 1
           ))
         WHERE pv.product_id IN (${placeholders}) AND pv.deleted_at IS NULL
         ORDER BY pv.product_id, pv.variant_rank ASC`,
        [currency.toLowerCase(), currency.toLowerCase(), ...productIds]
      )
      const variants = variantsResult.rows || []
      
      // We need product metadata to get list_price fallback
      const productMetadataMap: Record<string, any> = {}
      products.forEach((p: any) => {
        productMetadataMap[p.id] = typeof p.metadata === "string" ? JSON.parse(p.metadata) : (p.metadata || {})
      })

      // Fetch options for products
      const optionsResult = await pgConnection.raw(
        `SELECT po.id as option_id, po.product_id, po.title, pov.id as value_id, pov.value
         FROM product_option po
         LEFT JOIN product_option_value pov ON pov.option_id = po.id
         WHERE po.product_id IN (${placeholders})
         ORDER BY po.id, pov.id`,
        productIds
      )
      const optionMap: Record<string, { id: string; title: string; values: any[] }> = {}

      for (const row of optionsResult.rows || []) {
        if (!optionsByProduct[row.product_id]) optionsByProduct[row.product_id] = []
        const key = `${row.product_id}:::${row.option_id}`
        if (!optionMap[key]) {
          const optObj = { id: row.option_id, title: row.title, values: [] as any[] }
          optionMap[key] = optObj
          optionsByProduct[row.product_id].push(optObj)
        }
        if (row.value_id && row.value) {
          if (!optionMap[key].values.some((v: any) => v.value === row.value)) {
            optionMap[key].values.push({ id: row.value_id, value: row.value })
          }
        }
      }

      // Fetch variant option values
      const varOptsResult = await pgConnection.raw(
        `SELECT pvo.variant_id, po.title as option_title, pov.value
         FROM product_variant_option pvo
         JOIN product_option_value pov ON pov.id = pvo.option_value_id
         JOIN product_option po ON po.id = pov.option_id
         WHERE po.product_id IN (${placeholders})`,
        productIds
      )
      for (const row of varOptsResult.rows || []) {
        if (!optionsByVariant[row.variant_id]) optionsByVariant[row.variant_id] = []
        optionsByVariant[row.variant_id].push({
          option: { title: row.option_title },
          value: row.value,
        })
      }

      variants.forEach((v: any) => {
        if (!variantsByProduct[v.product_id]) {
          variantsByProduct[v.product_id] = []
        }
        
        const pMeta = productMetadataMap[v.product_id] || {}
        const vMeta = typeof v.variant_metadata === "string"
          ? (JSON.parse(v.variant_metadata) || {})
          : (v.variant_metadata || {})

        let priceAmt: number | null = v.price != null ? parseFloat(v.price) : null
        if (priceAmt == null || isNaN(priceAmt)) {
          const rawPrice = vMeta.odoo_price_amount != null
            ? parseFloat(vMeta.odoo_price_amount) / 1000
            : (vMeta.odoo_price ?? vMeta.list_price ?? vMeta.price ?? pMeta.marka_price ?? pMeta.list_price ?? pMeta.price)
          if (rawPrice != null && !isNaN(parseFloat(rawPrice))) {
            const num = parseFloat(rawPrice)
            priceAmt = num < 500 ? Math.round(num * 1000) : Math.round(num)
          }
        }

        const currCode = (v.currency_code || currency).toLowerCase()
        let prices: any[] = []
        if (priceAmt != null) {
          prices = [{ amount: priceAmt, currency_code: currCode }]
        }
        
        variantsByProduct[v.product_id].push({
          id: v.id,
          title: v.title,
          sku: v.sku,
          price: priceAmt,
          calculated_price: priceAmt != null ? { calculated_amount: priceAmt, currency_code: currCode } : null,
          original_price: priceAmt,
          manage_inventory: v.manage_inventory,
          allow_backorder: v.allow_backorder,
          metadata: vMeta,
          prices: prices,
          options: optionsByVariant[v.id] || [],
        })
      })
    }

    // Format response
    const formattedProducts = products.map((p: any) => {
      const productImages = imagesByProduct[p.id] || []
      const odooId = meta.odoo_id || meta.product_tmpl_id
      const odooImg = (odooId && String(odooId) !== 'false') ? `https://oskarllc-new-36501645.dev.odoo.com/web/image/product.template/${odooId}/image_1920` : null
      const firstImgUrl = productImages[0]?.url
      const finalThumbnail = (p.thumbnail && p.thumbnail !== 'false') ? p.thumbnail : (meta.image_url || firstImgUrl || odooImg || null)
      
      let finalImages = productImages
      if (finalImages.length === 0 && finalThumbnail) {
        finalImages = [{ id: "img_main", url: finalThumbnail }]
      }

      return {
        id: p.id,
        title: p.title,
        handle: p.handle,
        thumbnail: finalThumbnail,
        subtitle: p.subtitle,
        description: p.description,
        price: price,
        calculated_price: price != null ? { calculated_amount: price, currency_code: mainCurrency } : null,
        original_price: price,
        currency_code: mainCurrency,
        sku: firstVariant?.sku || null,
        images: finalImages,
        options: optionsByProduct[p.id] || [],
        metadata: meta,
        created_at: p.created_at,
        collection_id: p.collection_id,
        variants: variants,
      }
    })

    res.json({
      products: formattedProducts,
      count: total,
      limit,
      offset,
    })
  } catch (error: any) {
    console.error("[GET /store/products] Error:", error)
    res.status(500).json({
      type: "server_error",
      message: error.message,
    })
  }
}
