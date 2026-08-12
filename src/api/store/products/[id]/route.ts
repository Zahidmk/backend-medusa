import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * GET /store/products/:id
 * 
 * Standard store endpoint for a single product by ID (or handle/SKU).
 * Populates top-level price, calculated_price, variants, images, and metadata fallbacks.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const productId = req.params.id
  const currency = ((req.query.currency as string) || "kwd").toLowerCase()

  try {
    // 1. Fetch product basic info
    const productResult = await pgConnection.raw(
      `SELECT p.id, p.title, p.handle, p.subtitle, p.description, 
              p.status, p.thumbnail, p.metadata, p.weight, p.length, 
              p.height, p.width, p.material, p.origin_country,
              p.type_id, p.collection_id, p.created_at, p.updated_at
       FROM product p
       WHERE (p.id = ? OR p.handle = ?) AND p.deleted_at IS NULL`,
      [productId, productId]
    )

    if (!productResult.rows || productResult.rows.length === 0) {
      return res.status(404).json({ type: "not_found", message: "Product not found" })
    }

    const product = productResult.rows[0]
    const metadata = typeof product.metadata === "string" 
      ? JSON.parse(product.metadata) 
      : (product.metadata || {})

    // 2. Fetch images
    const imagesResult = await pgConnection.raw(
      `SELECT id, url, rank FROM image 
       WHERE product_id = ? AND deleted_at IS NULL 
       ORDER BY rank ASC, created_at ASC`,
      [product.id]
    )
    const images = imagesResult.rows || []
    if (product.thumbnail && !images.find((i: any) => i.url === product.thumbnail)) {
      images.unshift({ id: "thumbnail", url: product.thumbnail, rank: -1 })
    }

    // 3. Fetch variants with price lookups and fallbacks
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
      [currency, currency, product.id]
    )

    const variants = (variantsResult.rows || []).map((v: any) => {
      const vMeta = typeof v.variant_metadata === "string" 
        ? (JSON.parse(v.variant_metadata) || {})
        : (v.variant_metadata || {})

      let priceAmt: number | null = v.price != null ? parseFloat(v.price) : null
      
      if (priceAmt == null || isNaN(priceAmt)) {
        const rawOdooPrice = vMeta.odoo_price_amount != null
          ? parseFloat(vMeta.odoo_price_amount) / 1000
          : (vMeta.odoo_price ?? vMeta.list_price ?? vMeta.price ?? metadata.marka_price ?? metadata.list_price ?? metadata.price)

        if (rawOdooPrice != null && !isNaN(parseFloat(rawOdooPrice))) {
          const numPrice = parseFloat(rawOdooPrice)
          priceAmt = numPrice < 500 ? Math.round(numPrice * 1000) : Math.round(numPrice)
        }
      }

      const currCode = (v.currency_code || currency).toLowerCase()

      return {
        id: v.id,
        title: v.title,
        sku: v.sku,
        barcode: v.barcode,
        price: priceAmt,
        calculated_price: priceAmt != null ? { calculated_amount: priceAmt, currency_code: currCode } : null,
        original_price: priceAmt,
        currency_code: currCode,
        prices: priceAmt != null ? [{ amount: priceAmt, currency_code: currCode }] : [],
        inventory_quantity: metadata.odoo_stock || metadata.stock_qty || 0,
        allow_backorder: v.allow_backorder,
        weight: v.weight,
        metadata: vMeta,
      }
    })

    const firstVariant = variants[0]
    let mainPrice = firstVariant?.price ?? null
    if (mainPrice == null && (metadata.marka_price || metadata.list_price || metadata.price)) {
      const rawPrice = parseFloat(metadata.marka_price || metadata.list_price || metadata.price)
      if (!isNaN(rawPrice)) {
        mainPrice = rawPrice < 500 ? Math.round(rawPrice * 1000) : Math.round(rawPrice)
      }
    }
    const mainCurrency = firstVariant?.currency_code || currency

    res.json({
      product: {
        id: product.id,
        title: product.title,
        handle: product.handle,
        subtitle: product.subtitle,
        description: product.description,
        thumbnail: product.thumbnail,
        status: product.status,
        created_at: product.created_at,
        updated_at: product.updated_at,

        // TOP-LEVEL PRICE FIELDS
        price: mainPrice,
        calculated_price: mainPrice != null ? { calculated_amount: mainPrice, currency_code: mainCurrency } : null,
        original_price: mainPrice,
        currency_code: mainCurrency,
        prices: mainPrice != null ? [{ amount: mainPrice, currency_code: mainCurrency }] : [],

        images: images,
        variants: variants,
        metadata: metadata,
      },
    })
  } catch (error: any) {
    console.error("[GET /store/products/:id] Error:", error)
    res.status(500).json({ type: "server_error", message: error.message })
  }
}
