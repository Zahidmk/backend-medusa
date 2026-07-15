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
  const currency = (req.query.currency as string) || "aed"

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

    // 3. All variants with prices
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
         AND pp.currency_code = ?
       WHERE pv.product_id = ? AND pv.deleted_at IS NULL
       ORDER BY pv.variant_rank ASC`,
      [currency, productId]
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
        `SELECT DISTINCT p.id, p.title, p.handle, p.thumbnail, p.subtitle,
                pp.amount as price, pp.currency_code
         FROM product p
         JOIN product_category_product pcp ON pcp.product_id = p.id
         LEFT JOIN product_variant pv ON pv.product_id = p.id AND pv.deleted_at IS NULL
         LEFT JOIN product_variant_price_set pvps ON pvps.variant_id = pv.id
         LEFT JOIN price pp ON pp.price_set_id = pvps.price_set_id AND pp.currency_code = ?
         WHERE pcp.product_category_id IN (${categoryIds.map(() => "?").join(",")})
           AND p.id != ?
           AND p.status = 'published'
           AND p.deleted_at IS NULL
         LIMIT 10`,
        [currency, ...categoryIds, productId]
      )
      relatedProducts = relatedResult.rows.map((p: any) => ({
        id: p.id,
        title: p.title,
        handle: p.handle,
        thumbnail: p.thumbnail,
        subtitle: p.subtitle,
        price: p.price ? parseFloat(p.price) : null,
        currency_code: p.currency_code,
      }))
    }

    // ── 9. Comparison products (from Odoo alternative_odoo_ids) ──────────
    // Professional approach: resolve comparison products SERVER-SIDE so the
    // frontend gets ready-to-render data in a single API call. No extra
    // requests needed. Each comparison product includes title, image,
    // price (converted from fils to display units), and its own specs
    // for side-by-side comparison.
    const currencyDivisor = 1000
    const currencyDecimals = 3

    const altOdooIds: number[] = Array.isArray(metadata.alternative_odoo_ids) ? metadata.alternative_odoo_ids : []
    const upsellOdooIds: number[] = Array.isArray(metadata.upsell_odoo_ids) ? metadata.upsell_odoo_ids : []
    const accessoryOdooIds: number[] = Array.isArray(metadata.accessory_odoo_ids) ? metadata.accessory_odoo_ids : []
    // Merge all comparison IDs (alternative + upsell + accessory), deduplicate
    const allComparisonOdooIds = [...new Set([...altOdooIds, ...upsellOdooIds, ...accessoryOdooIds])]

    let comparisonProducts: any[] = []
    if (allComparisonOdooIds.length > 0) {
      try {
        // Find products by their odoo_id in metadata
        const placeholders = allComparisonOdooIds.map(() => "?").join(",")
        const compResult = await pgConnection.raw(
          `SELECT p.id, p.title, p.handle, p.thumbnail, p.weight, p.metadata,
                  pp.amount as price, pp.currency_code
           FROM product p
           LEFT JOIN product_variant pv ON pv.product_id = p.id AND pv.deleted_at IS NULL
           LEFT JOIN product_variant_price_set pvps ON pvps.variant_id = pv.id
           LEFT JOIN price pp ON pp.price_set_id = pvps.price_set_id AND pp.currency_code = ?
           WHERE (p.metadata->>'odoo_id')::int IN (${placeholders})
             AND p.status = 'published'
             AND p.deleted_at IS NULL`,
          [currency, ...allComparisonOdooIds]
        )

        comparisonProducts = compResult.rows.map((cp: any) => {
          const cpMeta = typeof cp.metadata === "string" ? JSON.parse(cp.metadata) : (cp.metadata || {})
          const rawPrice = cp.price ? parseFloat(cp.price) : 0
          const displayPrice = rawPrice / currencyDivisor

          // Build specs for this comparison product
          const cpSpecs: Record<string, string> = {}
          if (cpMeta.brand) cpSpecs["Brand"] = cpMeta.brand
          if (cp.weight) cpSpecs["Weight"] = `${cp.weight}g`
          if (cpMeta.odoo_barcode) cpSpecs["Barcode"] = cpMeta.odoo_barcode
          if (cpMeta.odoo_sku) cpSpecs["SKU"] = cpMeta.odoo_sku
          if (cpMeta.odoo_category) {
            const parts = cpMeta.odoo_category.split(" / ")
            cpSpecs["Category"] = parts[parts.length - 1]
          }
          if (cpMeta.warranty) cpSpecs["Warranty"] = cpMeta.warranty
          // Include attributes (color, material, etc.)
          if (cpMeta.attributes && typeof cpMeta.attributes === "object") {
            for (const [k, v] of Object.entries(cpMeta.attributes)) {
              if (v) {
                const key = k.charAt(0).toUpperCase() + k.slice(1)
                cpSpecs[key] = String(v)
              }
            }
          }

          return {
            id: cp.id,
            title: cp.title,
            handle: cp.handle,
            thumbnail: cp.thumbnail,
            odoo_id: cpMeta.odoo_id || null,
            price: displayPrice,
            price_formatted: `${displayPrice.toFixed(currencyDecimals)}`,
            currency_code: cp.currency_code || currency,
            specifications: cpSpecs,
          }
        })
      } catch (err) {
        console.warn("[Product Details] Failed to fetch comparison products:", err)
      }
    }

    // Build specifications from metadata and product fields
    const specifications: Record<string, string> = {}
    if (metadata.brand) specifications["Brand"] = metadata.brand
    if (product.weight) specifications["Weight"] = `${product.weight}g`
    if (product.length) specifications["Length"] = `${product.length}cm`
    if (product.height) specifications["Height"] = `${product.height}cm`
    if (product.width) specifications["Width"] = `${product.width}cm`
    if (product.material) specifications["Material"] = product.material
    if (product.origin_country) specifications["Origin"] = product.origin_country
    if (metadata.odoo_barcode) specifications["Barcode"] = metadata.odoo_barcode
    if (metadata.odoo_sku) specifications["SKU"] = metadata.odoo_sku
    if (metadata.odoo_category) {
      const catParts = metadata.odoo_category.split(" / ")
      specifications["Category"] = catParts[catParts.length - 1]
    }
    if (metadata.warranty) specifications["Warranty"] = metadata.warranty
    // ── Odoo attributes (color, material, size, etc.) → Specifications ──
    if (metadata.attributes && typeof metadata.attributes === "object") {
      for (const [k, v] of Object.entries(metadata.attributes)) {
        if (v) {
          const key = k.charAt(0).toUpperCase() + k.slice(1)
          specifications[key] = String(v)
        }
      }
    }

    // Build overview
    const overview = {
      description: product.description || "",
      subtitle: product.subtitle || "",
      html_description: metadata.ecommerce_description_html || null,
      brand: metadata.brand || metadata.odoo_brand || extractBrand(product.title),
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

    // Build variants — convert fils to display price
    const variants = variantsResult.rows.map((v: any) => {
      const rawPrice = v.price ? parseFloat(v.price) : null
      return {
        id: v.id,
        title: v.title,
        sku: v.sku,
        barcode: v.barcode,
        price_raw: rawPrice,                                         // fils (for calculations)
        price: rawPrice != null ? rawPrice / currencyDivisor : null, // display (KWD)
        price_formatted: rawPrice != null ? (rawPrice / currencyDivisor).toFixed(currencyDecimals) : null,
        currency_code: v.currency_code || currency,
        inventory_quantity: null,
        allow_backorder: v.allow_backorder,
        weight: v.weight,
        metadata: v.variant_metadata,
      }
    })

    // Stock availability
    const in_stock = metadata.stock_qty > 0 || metadata.stock_free_qty > 0
    const stock_quantity = metadata.stock_qty || 0

    res.json({
      product: {
        id: product.id,
        title: product.title,
        handle: product.handle,
        thumbnail: product.thumbnail,
        status: product.status,
        created_at: product.created_at,
        updated_at: product.updated_at,

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

        // Comparison products (alternative + upsell + accessory from Odoo)
        // Pre-resolved server-side with prices, specs — ready to render
        comparison_products: comparisonProducts,

        // Q&A placeholder (for "Q&A" tab)
        qa: {
          total_questions: 0,
          questions: [],
          can_ask: true,
        },

        // Metadata (Odoo sync info)
        odoo_id: metadata.odoo_id || null,
        brand: metadata.brand || metadata.odoo_brand || extractBrand(product.title),

        // Currency & price helpers (for frontend display)
        currency_code: currency,
        currency_symbol: "KWD",
        currency_decimals: currencyDecimals,
        currency_divisor: currencyDivisor,

        // Metadata passthrough for frontend (Medusa store API strips metadata)
        metadata_summary: {
          brand: metadata.brand || metadata.odoo_brand || null,
          warranty: metadata.warranty || null,
          is_new: metadata.is_new || false,
          attributes: metadata.attributes || {},
          alternative_odoo_ids: altOdooIds,
          upsell_odoo_ids: upsellOdooIds,
          accessory_odoo_ids: accessoryOdooIds,
          night_delivery: metadata.night_delivery || false,
          fast_delivery_areas: metadata.fast_delivery_areas || [],
          seo_title: metadata.seo_title || null,
          seo_description: metadata.seo_description || null,
          odoo_stock: metadata.odoo_stock || 0,
          list_price: metadata.list_price || 0,
          compare_price: metadata.compare_price || 0,
        },
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
