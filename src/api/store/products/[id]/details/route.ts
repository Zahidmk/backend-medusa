import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * GET /store/products/:id/details
 * 
 * Returns comprehensive product details for Flutter app:
 * - overview (description + metadata)
 * - specifications (from metadata)
 * - images (all product images)
 * - variants with prices
 * - categories
 * - related products (same category)
 * - reviews summary
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const productId = req.params.id
  const currency = ((req.query.currency as string) || "kwd").toLowerCase()

  try {
    // 1. Product basic info
    const productResult = await pgConnection.raw(
      `SELECT p.id, p.title, p.handle, p.subtitle, p.description, 
              p.status, p.thumbnail, p.metadata, p.weight, p.length, 
              p.height, p.width, p.material, p.origin_country,
              p.type_id, p.collection_id, p.created_at, p.updated_at
       FROM product p
       WHERE p.id = ? AND p.deleted_at IS NULL`,
      [productId]
    )

    if (!productResult.rows || productResult.rows.length === 0) {
      return res.status(404).json({ type: "not_found", message: "Product not found" })
    }

    const product = productResult.rows[0]
    const metadata = typeof product.metadata === "string" 
      ? JSON.parse(product.metadata) 
      : (product.metadata || {})

    // 2. All product images
    const imagesResult = await pgConnection.raw(
      `SELECT id, url, rank FROM image 
       WHERE product_id = ? AND deleted_at IS NULL 
       ORDER BY rank ASC, created_at ASC`,
      [productId]
    )

    // 3. All variants with prices (case-insensitive currency match with fallback)
    const variantsResult = await pgConnection.raw(
      `SELECT pv.id, pv.title, pv.sku, pv.barcode, pv.ean,
              pv.allow_backorder, pv.manage_inventory,
              pv.weight, pv.length, pv.height, pv.width,
              pv.material, pv.origin_country, pv.variant_rank,
              pv.metadata as variant_metadata,
              pp.amount as price, pp.currency_code
       FROM product_variant pv
       LEFT JOIN product_variant_price_set pvps ON pvps.variant_id = pv.id
       LEFT JOIN price pp ON pp.price_set_id = pvps.price_set_id 
         AND (LOWER(pp.currency_code) = LOWER(?) OR pp.id = (
           SELECT id FROM price p2 WHERE p2.price_set_id = pvps.price_set_id ORDER BY (LOWER(p2.currency_code) = LOWER(?)) DESC LIMIT 1
         ))
       WHERE pv.product_id = ? AND pv.deleted_at IS NULL
       ORDER BY pv.variant_rank ASC`,
      [currency, currency, productId]
    )

    // 4. Product options & option values
    const optionsResult = await pgConnection.raw(
      `SELECT po.id as option_id, po.title as option_name,
              pov.id as value_id, pov.value as option_value
       FROM product_option po
       JOIN product_option_value pov ON pov.option_id = po.id
       WHERE po.product_id = ? AND po.deleted_at IS NULL AND pov.deleted_at IS NULL
       ORDER BY po.title, pov.value`,
      [productId]
    )

    // Group options
    const optionsMap: Record<string, any> = {}
    for (const opt of optionsResult.rows) {
      if (!optionsMap[opt.option_id]) {
        optionsMap[opt.option_id] = {
          id: opt.option_id,
          name: opt.option_name,
          values: [],
        }
      }
      optionsMap[opt.option_id].values.push({
        id: opt.value_id,
        value: opt.option_value,
      })
    }

    // 5. Categories
    const categoriesResult = await pgConnection.raw(
      `SELECT pc.id, pc.name, pc.handle, pc.metadata as cat_metadata
       FROM product_category pc
       JOIN product_category_product pcp ON pcp.product_category_id = pc.id
       WHERE pcp.product_id = ? AND pc.deleted_at IS NULL`,
      [productId]
    )

    // 6. Stock info (simplified - use metadata instead of complex JOINs)
    // Stock data is synced from Odoo into product metadata
    // No need for complex inventory_level queries

    // 7. Reviews summary
    let reviewsSummary = { average_rating: 0, total_reviews: 0, ratings_breakdown: {} }
    try {
      const reviewsResult = await pgConnection.raw(
        `SELECT 
           COALESCE(AVG(rating), 0) as average_rating,
           COUNT(*) as total_reviews,
           COUNT(*) FILTER (WHERE rating = 5) as five_star,
           COUNT(*) FILTER (WHERE rating = 4) as four_star,
           COUNT(*) FILTER (WHERE rating = 3) as three_star,
           COUNT(*) FILTER (WHERE rating = 2) as two_star,
           COUNT(*) FILTER (WHERE rating = 1) as one_star
         FROM product_review
         WHERE product_id = ? AND status = 'approved'`,
        [productId]
      )
      if (reviewsResult.rows.length > 0) {
        const r = reviewsResult.rows[0]
        reviewsSummary = {
          average_rating: parseFloat(parseFloat(r.average_rating).toFixed(1)),
          total_reviews: parseInt(r.total_reviews),
          ratings_breakdown: {
            "5": parseInt(r.five_star),
            "4": parseInt(r.four_star),
            "3": parseInt(r.three_star),
            "2": parseInt(r.two_star),
            "1": parseInt(r.one_star),
          },
        }
      }
    } catch (err) {
      // Review table may not exist, ignore
    }

    // 8. Related products (same category, different product)
    const categoryIds = categoriesResult.rows.map((c: any) => c.id)
    let relatedProducts: any[] = []
    if (categoryIds.length > 0) {
      const relatedResult = await pgConnection.raw(
        `SELECT DISTINCT p.id, p.title, p.handle, p.thumbnail, p.subtitle, p.metadata,
                pp.amount as price, pp.currency_code
         FROM product p
         JOIN product_category_product pcp ON pcp.product_id = p.id
         LEFT JOIN product_variant pv ON pv.product_id = p.id AND pv.deleted_at IS NULL
         LEFT JOIN product_variant_price_set pvps ON pvps.variant_id = pv.id
         LEFT JOIN price pp ON pp.price_set_id = pvps.price_set_id 
           AND (LOWER(pp.currency_code) = LOWER(?) OR pp.id = (
             SELECT id FROM price p2 WHERE p2.price_set_id = pvps.price_set_id ORDER BY (LOWER(p2.currency_code) = LOWER(?)) DESC LIMIT 1
           ))
         WHERE pcp.product_category_id IN (${categoryIds.map(() => "?").join(",")})
           AND p.id != ?
           AND p.status = 'published'
           AND p.deleted_at IS NULL
         LIMIT 10`,
        [currency, currency, ...categoryIds, productId]
      )
      relatedProducts = relatedResult.rows.map((p: any) => {
        const pMeta = typeof p.metadata === "string" ? JSON.parse(p.metadata) : (p.metadata || {})
        let price = p.price != null ? parseFloat(p.price) : null
        if (price == null || isNaN(price)) {
          const rawOdooPrice = pMeta.marka_price ?? pMeta.list_price ?? pMeta.price
          if (rawOdooPrice != null && !isNaN(parseFloat(rawOdooPrice))) {
            const num = parseFloat(rawOdooPrice)
            price = num < 500 ? Math.round(num * 1000) : Math.round(num)
          }
        }
        const relCurrency = (p.currency_code || currency).toLowerCase()
        return {
          id: p.id,
          title: p.title,
          handle: p.handle,
          thumbnail: p.thumbnail,
          subtitle: p.subtitle,
          price: price,
          calculated_price: price,
          currency_code: relCurrency,
        }
      })
    }

    // Build specifications from metadata and product fields
    // Priority: 1) Resolved Odoo attribute specs, 2) Odoo metadata, 3) Native Medusa fields
    const specifications: Record<string, string> = {}

    // 1. From resolved Odoo attribute lines (stored during sync)
    if (metadata.specifications && typeof metadata.specifications === 'object') {
      for (const [key, val] of Object.entries(metadata.specifications)) {
        if (val && typeof val === 'string' && val.trim()) {
          specifications[key] = val
        }
      }
    }

    // 2. From Odoo-synced metadata fields
    if (metadata.brand && !specifications["Brand"]) specifications["Brand"] = String(metadata.brand)
    if (metadata.odoo_sku) specifications["SKU"] = String(metadata.odoo_sku)
    if (metadata.odoo_barcode) specifications["Barcode"] = String(metadata.odoo_barcode)
    if (metadata.odoo_category_name) specifications["Category"] = String(metadata.odoo_category_name)
    if (metadata.sub_category) specifications["Sub Category"] = String(metadata.sub_category)
    if (metadata.uom) specifications["Unit of Measure"] = String(metadata.uom)
    if (metadata.hs_code) specifications["HS Code"] = String(metadata.hs_code)
    if (metadata.origin_country) specifications["Country of Origin"] = String(metadata.origin_country)
    if (metadata.weight_unit && (product.weight || metadata.odoo_stock !== undefined)) {
      const w = product.weight || 0
      if (w > 0) specifications["Weight"] = `${w} ${metadata.weight_unit}`
    }
    if (metadata.volume && Number(metadata.volume) > 0) {
      specifications["Volume"] = `${metadata.volume} ${metadata.volume_unit || 'm³'}`
    }
    if (metadata.lead_time_days && Number(metadata.lead_time_days) > 0) {
      specifications["Lead Time"] = `${metadata.lead_time_days} days`
    }

    // 3. Native Medusa fields (fallbacks)
    if (product.weight && !specifications["Weight"]) specifications["Weight"] = `${product.weight}g`
    if (product.length) specifications["Length"] = `${product.length}cm`
    if (product.height) specifications["Height"] = `${product.height}cm`
    if (product.width) specifications["Width"] = `${product.width}cm`
    if (product.material) specifications["Material"] = product.material
    if (product.origin_country && !specifications["Country of Origin"]) specifications["Origin"] = product.origin_country

    // 4. Fallback: parse rich ecommerce description for specs if no attribute specs found
    if (Object.keys(specifications).length <= 3 && metadata.ecommerce_description) {
      // Try to extract key-value pairs from HTML description (common Odoo pattern)
      const htmlDesc = String(metadata.ecommerce_description)
      const specPattern = /<(?:tr|li)[^>]*>\s*<(?:td|strong|b)[^>]*>([^<]+)<\/(?:td|strong|b)>\s*[:\-]?\s*<(?:td|span)[^>]*>([^<]+)/gi
      let match
      while ((match = specPattern.exec(htmlDesc)) !== null) {
        const key = match[1].trim()
        const val = match[2].trim()
        if (key && val && key.length < 50 && val.length < 200) {
          specifications[key] = val
        }
      }
    }

    // Build overview
    const overview = {
      description: product.description || "",
      subtitle: product.subtitle || "",
      html_description: metadata.ecommerce_description || metadata.ecommerce_description_html || null,
      brand: metadata.brand || metadata.brand_name || extractBrand(product.title),
    }

    // Build images array
    const images = imagesResult.rows.map((img: any) => ({
      id: img.id,
      url: img.url,
      rank: img.rank,
    }))
    // Include thumbnail as first image if not already in images
    if (product.thumbnail && !images.find((i: any) => i.url === product.thumbnail)) {
      images.unshift({ id: "thumbnail", url: product.thumbnail, rank: -1 })
    }

    // Build variants with fallback price resolution
    const variants = variantsResult.rows.map((v: any) => {
      const vMeta = typeof v.variant_metadata === "string" 
        ? (JSON.parse(v.variant_metadata) || {})
        : (v.variant_metadata || {})

      let price: number | null = v.price != null ? parseFloat(v.price) : null
      
      // Fallback to variant metadata or product metadata if price table is null
      if (price == null || isNaN(price)) {
        const rawOdooPrice = vMeta.odoo_price_amount != null
          ? parseFloat(vMeta.odoo_price_amount) / 1000
          : (vMeta.odoo_price ?? vMeta.list_price ?? vMeta.price ?? metadata.marka_price ?? metadata.list_price ?? metadata.price)

        if (rawOdooPrice != null && !isNaN(parseFloat(rawOdooPrice))) {
          const numPrice = parseFloat(rawOdooPrice)
          price = numPrice < 500 ? Math.round(numPrice * 1000) : Math.round(numPrice)
        }
      }

      const currCode = (v.currency_code || currency).toLowerCase()

      return {
        id: v.id,
        title: v.title,
        sku: v.sku,
        barcode: v.barcode,
        price: price,
        calculated_price: price != null ? { calculated_amount: price, currency_code: currCode } : null,
        original_price: price,
        currency_code: currCode,
        prices: price != null ? [{ amount: price, currency_code: currCode }] : [],
        inventory_quantity: null, // Will be populated from stock
        allow_backorder: v.allow_backorder,
        weight: v.weight,
        metadata: vMeta,
      }
    })

    // Determine top-level product price from first variant or metadata
    const firstVariant = variants[0]
    let mainPrice = firstVariant?.price ?? null
    if (mainPrice == null && (metadata.marka_price || metadata.list_price || metadata.price)) {
      const rawPrice = parseFloat(metadata.marka_price || metadata.list_price || metadata.price)
      if (!isNaN(rawPrice)) {
        mainPrice = rawPrice < 500 ? Math.round(rawPrice * 1000) : Math.round(rawPrice)
      }
    }
    const mainCurrency = firstVariant?.currency_code || currency

    // Stock availability — check odoo_stock (primary), then stock_qty/stock_free_qty fallbacks
    const in_stock = (metadata.odoo_stock || metadata.stock_qty || metadata.stock_free_qty || 0) > 0
    const stock_quantity = metadata.odoo_stock || metadata.stock_qty || 0

    res.json({
      product: {
        id: product.id,
        title: product.title,
        handle: product.handle,
        thumbnail: product.thumbnail,
        status: product.status,
        created_at: product.created_at,
        updated_at: product.updated_at,

        // TOP-LEVEL PRICE FIELDS (Crucial for mobile apps expecting product.price or calculated_price)
        price: mainPrice,
        calculated_price: mainPrice != null ? { calculated_amount: mainPrice, currency_code: mainCurrency } : null,
        original_price: mainPrice,
        currency_code: mainCurrency,
        prices: mainPrice != null ? [{ amount: mainPrice, currency_code: mainCurrency }] : [],

        // Overview section (for "Overview" tab)
        overview,

        // All images (for image gallery/slider)
        images,

        // Specifications section (for "Specifications" tab)
        specifications,

        // Options (Color, Size, Storage, etc.)
        options: Object.values(optionsMap),

        // Variants with prices
        variants,

        // Categories
        categories: categoriesResult.rows.map((c: any) => ({
          id: c.id,
          name: c.name,
          handle: c.handle,
          image_url: c.cat_metadata?.image_url || null,
        })),

        // Stock info
        in_stock,
        stock_quantity,

        // Reviews summary (for "Reviews" tab)
        reviews: reviewsSummary,

        // Related products
        related_products: relatedProducts,

        // Q&A placeholder (for "Q&A" tab)
        qa: {
          total_questions: 0,
          questions: [],
          can_ask: true,
        },

        // Metadata (Odoo sync info)
        odoo_id: metadata.odoo_id || null,
        brand: metadata.brand || metadata.brand_name || extractBrand(product.title),
      },
    })
  } catch (error: any) {
    console.error("[Product Details] Error:", error)
    res.status(500).json({ type: "server_error", message: error.message })
  }
}

/**
 * Extract brand name from product title
 * Common brands: Porodo, Powerology, Baseus, Anker, Samsung, Apple, etc.
 */
function extractBrand(title: string): string | null {
  if (!title) return null
  const brands = [
    "Porodo", "Powerology", "Baseus", "Anker", "Samsung", "Apple",
    "Xiaomi", "Huawei", "Lenovo", "Green Lion", "LePresso", "Remax",
    "Hoco", "Joyroom", "Ugreen", "Liberty Guard", "Devia", "Oraimo",
    "Marshall", "JBL", "Sony", "Bose", "Harman", "Kemei", "MSI",
    "ASUS", "HP", "Dell", "Acer", "NexTool", "Ravpower", "Mcdodo",
  ]
  for (const brand of brands) {
    if (title.toLowerCase().startsWith(brand.toLowerCase())) {
      return brand
    }
  }
  // Try first word as brand
  return title.split(" ")[0]
}
