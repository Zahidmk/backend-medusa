import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * GET /store/categories/:handle/products
 * 
 * Returns products for a specific category by handle
 * Includes child category products too
 * 
 * Query params:
 * - page (default: 1)
 * - limit (default: 20)
 * - sort: price_asc, price_desc, newest, oldest, title_asc, title_desc (default: newest)
 * - min_price, max_price
 * - brand
 * - in_stock: true/false
 * - currency (default: aed)
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const handle = req.params.handle
  const page = parseInt(req.query.page as string) || 1
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 50)
  const offset = (page - 1) * limit
  const sort = (req.query.sort as string) || "newest"
  const minPrice = req.query.min_price ? parseFloat(req.query.min_price as string) : null
  const maxPrice = req.query.max_price ? parseFloat(req.query.max_price as string) : null
  const brand = req.query.brand as string       // filter by odoo_brand in metadata
  const color = req.query.color as string       // filter by color option value
  const inStock = req.query.in_stock as string
  const currency = (req.query.currency as string) || "aed"

  try {
    // Find category by handle and get all child category IDs
    const categoryResult = await pgConnection.raw(
      `SELECT id, name, handle, metadata FROM product_category 
       WHERE handle = ? AND deleted_at IS NULL`,
      [handle]
    )

    if (!categoryResult.rows || categoryResult.rows.length === 0) {
      return res.status(404).json({ type: "not_found", message: "Category not found" })
    }

    const category = categoryResult.rows[0]
    const catMeta = typeof category.metadata === "string" 
      ? JSON.parse(category.metadata) 
      : (category.metadata || {})

    // Get this category + all child category IDs
    const childrenResult = await pgConnection.raw(
      `WITH RECURSIVE cat_tree AS (
         SELECT id FROM product_category WHERE id = ?
         UNION ALL
         SELECT pc.id FROM product_category pc
         JOIN cat_tree ct ON pc.parent_category_id = ct.id
         WHERE pc.deleted_at IS NULL
       )
       SELECT id FROM cat_tree`,
      [category.id]
    )
    const categoryIds = childrenResult.rows.map((r: any) => r.id)

    // Build WHERE conditions
    const conditions: string[] = [
      "p.status = 'published'",
      "p.deleted_at IS NULL",
      `pcp.product_category_id IN (${categoryIds.map(() => "?").join(",")})`,
    ]
    const params: any[] = [...categoryIds]

    const productCurrency = currency.toLowerCase()
    const divisor = (productCurrency === "kwd" || productCurrency === "omr" || productCurrency === "bhd") ? 1000 : 100

    if (minPrice !== null) {
      conditions.push("pp.amount >= ?")
      params.push(minPrice * divisor)
    }
    if (maxPrice !== null) {
      conditions.push("pp.amount <= ?")
      params.push(maxPrice * divisor)
    }
    if (brand) {
      // Match against brand (primary), odoo_brand, or brand_name in metadata, fallback to title starts-with
      conditions.push(`(
        LOWER(COALESCE(
          NULLIF(TRIM(p.metadata->>'brand'), ''),
          NULLIF(TRIM(p.metadata->>'odoo_brand'), ''),
          NULLIF(TRIM(p.metadata->>'brand_name'), '')
        )) = LOWER(?)
        OR (
          COALESCE(
            NULLIF(TRIM(p.metadata->>'brand'), ''),
            NULLIF(TRIM(p.metadata->>'odoo_brand'), ''),
            NULLIF(TRIM(p.metadata->>'brand_name'), '')
          ) IS NULL
          AND LOWER(p.title) LIKE LOWER(? || '%')
        )
      )`)
      params.push(brand, brand)
    }
    if (color) {
      // Match against product option values (Color option)
      conditions.push(`p.id IN (
        SELECT DISTINCT p2.id FROM product p2
        JOIN product_option po ON po.product_id = p2.id AND po.deleted_at IS NULL
        JOIN product_option_value pov ON pov.option_id = po.id AND pov.deleted_at IS NULL
        WHERE LOWER(po.title) IN ('color','colour') AND LOWER(pov.value) = LOWER(?)
      )`)
      params.push(color)
    }
    if (inStock === "true") {
      conditions.push("COALESCE((p.metadata->>'odoo_stock')::numeric, COALESCE((p.metadata->>'stock_qty')::numeric, 0)) > 0")
    }

    // Sort mapping — outerOrderBy uses column aliases from the subquery SELECT
    let outerOrderBy = "created_at DESC"
    switch (sort) {
      case "price_asc": outerOrderBy = "price ASC NULLS LAST"; break
      case "price_desc": outerOrderBy = "price DESC NULLS LAST"; break
      case "newest": outerOrderBy = "created_at DESC"; break
      case "oldest": outerOrderBy = "created_at ASC"; break
      case "title_asc": outerOrderBy = "title ASC"; break
      case "title_desc": outerOrderBy = "title DESC"; break
    }

    // Count total
    const countResult = await pgConnection.raw(
      `SELECT COUNT(DISTINCT p.id) as total
       FROM product p
       JOIN product_category_product pcp ON pcp.product_id = p.id
       LEFT JOIN product_variant pv ON pv.product_id = p.id AND pv.deleted_at IS NULL
       LEFT JOIN product_variant_price_set pvps ON pvps.variant_id = pv.id
       LEFT JOIN price pp ON pp.price_set_id = pvps.price_set_id AND pp.currency_code = ?
       WHERE ${conditions.join(" AND ")}`,
      [currency, ...params]
    )
    const total = parseInt(countResult.rows[0].total)

    // Get products — use subquery to deduplicate by product, then sort correctly
    const productsResult = await pgConnection.raw(
      `SELECT * FROM (
         SELECT DISTINCT ON (p.id) 
                p.id, p.title, p.handle, p.thumbnail, p.subtitle,
                p.description, p.metadata, p.created_at,
                pp.amount as price, pp.currency_code,
                pv.id as variant_id, pv.sku
         FROM product p
         JOIN product_category_product pcp ON pcp.product_id = p.id
         LEFT JOIN product_variant pv ON pv.product_id = p.id AND pv.deleted_at IS NULL
         LEFT JOIN product_variant_price_set pvps ON pvps.variant_id = pv.id
         LEFT JOIN price pp ON pp.price_set_id = pvps.price_set_id AND pp.currency_code = ?
         WHERE ${conditions.join(" AND ")}
         ORDER BY p.id, pp.amount ASC NULLS LAST
       ) deduped
       ORDER BY ${outerOrderBy}
       LIMIT ? OFFSET ?`,
      [currency, ...params, limit, offset]
    )

    // Format response
    const products = productsResult.rows.map((p: any) => {
      const meta = typeof p.metadata === "string" ? JSON.parse(p.metadata) : (p.metadata || {})
      return {
        id: p.id,
        title: p.title,
        handle: p.handle,
        thumbnail: p.thumbnail,
        subtitle: p.subtitle,
        price: p.price ? parseFloat(p.price) : null,
        currency_code: p.currency_code || currency,
        in_stock: (meta.odoo_stock || meta.odoo_qty || meta.stock_qty || 0) > 0,
        brand: meta.brand || meta.odoo_brand || meta.brand_name || extractBrand(p.title),
        created_at: p.created_at,
      }
    })

    res.json({
      category: {
        id: category.id,
        name: category.name,
        handle: category.handle,
        image_url: catMeta.image_url || null,
      },
      products,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
        has_more: offset + limit < total,
      },
    })
  } catch (error: any) {
    console.error("[Category Products] Error:", error)
    res.status(500).json({ type: "server_error", message: error.message })
  }
}

function extractBrand(title: string): string | null {
  if (!title) return null
  const brands = [
    "Porodo", "Powerology", "Baseus", "Anker", "Samsung", "Apple",
    "Xiaomi", "Huawei", "Lenovo", "Green Lion", "LePresso", "Remax",
    "Hoco", "Joyroom", "Ugreen", "Liberty Guard", "Devia", "Oraimo",
    "Marshall", "JBL", "Sony", "Bose", "Harman", "Kemei",
  ]
  for (const brand of brands) {
    if (title.toLowerCase().startsWith(brand.toLowerCase())) return brand
  }
  return title.split(" ")[0]
}
