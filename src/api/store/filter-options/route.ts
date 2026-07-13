import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * GET /store/filter-options
 * Returns available filter options (colors, sizes, etc.) for the store or a specific category.
 * 
 * Query params:
 *   category_id  - optional, filter options for products in this category
 *   region_id    - optional, for price range context
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const { category_id } = req.query as { category_id?: string }

  try {
    // Build product filter: if category_id is provided, only look at products in that category
    let productFilter = ""
    const params: any[] = []

    if (category_id) {
      productFilter = `
        AND p.id IN (
          SELECT pcp.product_id FROM product_category_product pcp WHERE pcp.product_category_id = ?
        )
      `
      params.push(category_id)
    }

    // Get all distinct option titles and their values
    const optionsResult = await pgConnection.raw(
      `SELECT 
        po.id as option_id,
        po.title as option_title,
        ARRAY_AGG(DISTINCT pov.value ORDER BY pov.value) as values
       FROM product_option po
       JOIN product_option_value pov ON pov.option_id = po.id AND pov.deleted_at IS NULL
       JOIN product p ON po.product_id = p.id AND p.deleted_at IS NULL AND p.status = 'published'
       WHERE po.deleted_at IS NULL
         AND po.title != 'Default'
         ${productFilter}
       GROUP BY po.id, po.title
       ORDER BY po.title`,
      params
    )

    // Get price range
    const priceParams: any[] = []
    let priceFilter = ""
    if (category_id) {
      priceFilter = `
        AND pv.product_id IN (
          SELECT pcp.product_id FROM product_category_product pcp WHERE pcp.product_category_id = ?
        )
      `
      priceParams.push(category_id)
    }

    const priceResult = await pgConnection.raw(
      `SELECT 
        MIN(pp.amount) as min_price,
        MAX(pp.amount) as max_price,
        pp.currency_code
       FROM product_variant_price_set pvps
       JOIN price pp ON pp.price_set_id = pvps.price_set_id AND pp.deleted_at IS NULL
       JOIN product_variant pv ON pv.id = pvps.variant_id AND pv.deleted_at IS NULL
       JOIN product p ON p.id = pv.product_id AND p.deleted_at IS NULL AND p.status = 'published'
       WHERE 1=1 ${priceFilter}
       GROUP BY pp.currency_code`,
      priceParams
    )

    // Get available brands from product metadata
    const brandParams: any[] = []
    let brandFilter = ""
    if (category_id) {
      brandFilter = `
        AND p.id IN (
          SELECT pcp.product_id FROM product_category_product pcp WHERE pcp.product_category_id = ?
        )
      `
      brandParams.push(category_id)
    }

    const brandResult = await pgConnection.raw(
      `SELECT DISTINCT COALESCE(
          NULLIF(TRIM(p.metadata->>'brand'), ''),
          NULLIF(TRIM(p.metadata->>'odoo_brand'), ''),
          NULLIF(TRIM(p.metadata->>'brand_name'), ''),
          split_part(TRIM(p.title), ' ', 1)
        ) as brand
       FROM product p
       WHERE p.deleted_at IS NULL 
         AND p.status = 'published'
         ${brandFilter}
       ORDER BY brand`,
      brandParams
    )

    // Format options for Flutter
    const filters: any[] = []

    // Add color, size, and other product options
    for (const opt of (optionsResult.rows || [])) {
      const title = opt.option_title.toLowerCase()
      filters.push({
        id: opt.option_id,
        title: opt.option_title,
        type: title === "color" || title === "colour" ? "color" : 
              title === "size" ? "size" : "select",
        values: opt.values || [],
      })
    }

    // Add brand filter
    const brands = (brandResult.rows || []).map((r: any) => r.brand).filter(Boolean)
    if (brands.length > 0) {
      filters.push({
        id: "brand",
        title: "Brand",
        type: "select",
        values: brands,
      })
    }

    // Add price range
    const priceRanges = (priceResult.rows || []).map((r: any) => {
      const code = (r.currency_code || "aed").toLowerCase()
      const divisor = (code === "kwd" || code === "omr" || code === "bhd") ? 1000 : 100
      return {
        currency_code: r.currency_code,
        min: (parseFloat(r.min_price) || 0) / divisor,
        max: (parseFloat(r.max_price) || 0) / divisor,
      }
    })

    // Add sort options
    const sortOptions = [
      { value: "created_at", label: "Newest First" },
      { value: "-created_at", label: "Oldest First" },
      { value: "title", label: "Name A-Z" },
      { value: "-title", label: "Name Z-A" },
      { value: "price_asc", label: "Price: Low to High" },
      { value: "price_desc", label: "Price: High to Low" },
    ]

    res.json({
      filters,
      price_range: priceRanges,
      sort_options: sortOptions,
      category_id: category_id || null,
    })
  } catch (error: any) {
    console.error("[Filter Options] Error:", error)
    res.status(500).json({
      type: "server_error",
      message: error.message,
    })
  }
}
