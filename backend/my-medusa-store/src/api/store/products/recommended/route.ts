/**
 * GET /store/products/recommended
 *
 * Returns the top N best-selling products based on real order history.
 * Falls back to newest products if there are not enough orders yet.
 *
 * Query params:
 *   ?limit=12        (default 12)
 *   ?days=90         (look-back window in days, default 90)
 *   ?currency=kwd    (for price lookup, default kwd)
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const pg = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  const limit  = Math.min(parseInt((req.query.limit  as string) || "12"), 50)
  const days   = Math.min(parseInt((req.query.days   as string) || "90"), 365)
  const currency = ((req.query.currency as string) || "kwd").toLowerCase()

  try {
    // ── Step 1: Top-selling product IDs from real orders (only published products) ──
    const bestsellersResult = await pg.raw(`
      SELECT
        oli.product_id,
        SUM(oi.quantity) AS total_sold
      FROM order_line_item oli
      JOIN order_item oi ON oi.item_id = oli.id
      JOIN "order" o     ON o.id        = oi.order_id
      JOIN product p     ON p.id        = oli.product_id
        AND p.deleted_at IS NULL
        AND p.status = 'published'
      WHERE oli.product_id IS NOT NULL
        AND oli.deleted_at IS NULL
        AND o.deleted_at   IS NULL
        AND o.created_at  >= NOW() - INTERVAL '${days} days'
      GROUP BY oli.product_id
      ORDER BY total_sold DESC
      LIMIT ?
    `, [limit])

    let productIds: string[] = bestsellersResult.rows.map((r: any) => r.product_id)
    const salesMap: Record<string, number> = {}
    for (const r of bestsellersResult.rows) {
      salesMap[r.product_id] = parseInt(r.total_sold)
    }

    // ── Step 2: Fallback — if fewer than 'limit' orders, pad with newest ──
    if (productIds.length < limit) {
      const exclude = productIds.length > 0
        ? `AND p.id NOT IN (${productIds.map(() => "?").join(",")})`
        : ""
      const needed = limit - productIds.length

      const newlyAdded = await pg.raw(`
        SELECT p.id
        FROM product p
        WHERE p.deleted_at IS NULL
          AND p.status = 'published'
          ${exclude}
        ORDER BY p.created_at DESC
        LIMIT ?
      `, [...productIds, needed])

      const fallbackIds = newlyAdded.rows.map((r: any) => r.id)
      productIds = [...productIds, ...fallbackIds]
    }

    if (productIds.length === 0) {
      return res.json({ products: [], count: 0, source: "empty" })
    }

    // ── Step 3: Fetch full product data with KWD price ────────────────────
    const placeholders = productIds.map(() => "?").join(",")

    // Build CASE for ordering by bestseller rank
    const orderCase = productIds.map((id, i) => `WHEN p.id = '${id.replace(/'/g, "''")}' THEN ${i}`).join(" ")

    const productsResult = await pg.raw(`
      SELECT
        p.id,
        p.title,
        p.handle,
        p.thumbnail,
        p.description,
        p.status,
        p.metadata,
        p.created_at,
        pv.id           AS variant_id,
        pv.sku,
        pv.manage_inventory,
        pp.amount       AS price_amount,
        pp.currency_code
      FROM product p
      LEFT JOIN product_variant pv ON pv.product_id = p.id
        AND pv.deleted_at IS NULL
      LEFT JOIN product_variant_price_set pvps ON pvps.variant_id = pv.id
      LEFT JOIN price pp ON pp.price_set_id = pvps.price_set_id
        AND pp.currency_code = ?
        AND pp.deleted_at IS NULL
      WHERE p.id IN (${placeholders})
        AND p.deleted_at IS NULL
      ORDER BY CASE ${orderCase} ELSE 999 END, pp.amount ASC NULLS LAST
    `, [currency, ...productIds])

    // ── Step 4: Group rows by product (multiple variants per product) ─────
    const productMap: Record<string, any> = {}
    for (const row of productsResult.rows) {
      if (!productMap[row.id]) {
        productMap[row.id] = {
          id:          row.id,
          title:       row.title,
          handle:      row.handle,
          thumbnail:   row.thumbnail,
          description: row.description,
          status:      row.status,
          metadata:    row.metadata,
          created_at:  row.created_at,
          total_sold:  salesMap[row.id] || 0,
          variants:    [],
        }
      }
      if (row.variant_id && !productMap[row.id].variants.find((v: any) => v.id === row.variant_id)) {
        productMap[row.id].variants.push({
          id:               row.variant_id,
          sku:              row.sku,
          manage_inventory: row.manage_inventory,
          prices: row.price_amount != null
            ? [{ amount: parseFloat(row.price_amount), currency_code: row.currency_code }]
            : [],
          calculated_price: row.price_amount != null
            ? { calculated_amount: parseFloat(row.price_amount), currency_code: row.currency_code }
            : null,
        })
      }
    }

    // Preserve bestseller order
    const products = productIds
      .map(id => productMap[id])
      .filter(Boolean)

    res.json({
      products,
      count: products.length,
      source: bestsellersResult.rows.length > 0 ? "bestsellers" : "newest",
      meta: {
        days_window: days,
        currency,
      }
    })
  } catch (error: any) {
    console.error("[/store/products/recommended] Error:", error)
    res.status(500).json({ type: "server_error", message: error.message })
  }
}
