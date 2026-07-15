import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * POST /odoo/webhooks/products
 * 
 * SELF-CONTAINED webhook - Odoo pushes ALL product data directly.
 * No callback to Odoo needed. Works even if Odoo credentials change.
 * 
 * Images use direct Odoo URLs instead of downloading/storing locally.
 * 
 * Supports single + bulk operations.
 */

const WEBHOOK_SECRET = process.env.ODOO_WEBHOOK_SECRET || "marqa-odoo-webhook-2026"
const ODOO_BASE_URL = (process.env.ODOO_URL || "https://oskarllc-new-31031096.dev.odoo.com").replace(/\/$/, "")

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/(^-|-$)/g, "").substring(0, 100)
}

function genId(prefix: string): string {
  const c = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
  let id = prefix + "_"
  for (let i = 0; i < 26; i++) id += c[Math.floor(Math.random() * c.length)]
  return id
}

/**
 * Maps an Odoo category path to Medusa category handle
 * PERMANENT SOLUTION: Uses hierarchical matching + ALL 373 Odoo categories
 * 
 * Examples:
 *   "Gaming / Monitor" → finds or creates "gaming"
 *   "Mobile / Tablet / Powerbanks / Magsafe" → finds or creates "magsafe"
 *   "Electronics / Audio / Headphones" → finds or creates "headphones"
 */
function odooCategoryToHandle(odooCategory: string | null): string | null {
  if (!odooCategory) return null
  
  const cat = odooCategory.toLowerCase().trim()
  const parts = cat.split("/").map(p => p.trim()).filter(p => p.length > 0)
  
  // Extract the LAST meaningful category (most specific)
  // "Mobile / Tablet / Powerbanks / Magsafe" → use "magsafe"
  const lastPart = parts.length > 0 ? parts[parts.length - 1] : null
  if (!lastPart) return null
  
  // Smart keyword matching on final category level
  // ORDER MATTERS: more specific entries FIRST (before generic ones)
  const keywords: Record<string, string> = {
    // ── Power ───────────────────────────────────────────────────────────
    "power station": "powerbank",
    "power bank": "powerbank",
    "powerbank": "powerbank",
    // ── Kids & Toys ──────────────────────────────────────────────────────
    "kids headphones": "kids-headphones",
    "kids headphone": "kids-headphones",
    "kids earphones": "kids-headphones",
    "kids earphone": "kids-headphones",
    "kids smart watch": "kids-smart-watches",
    "kids smartwatch": "kids-smart-watches",
    "kids watch": "kids-smart-watches",
    "kids toys": "kids-toys",
    "kids toy": "kids-toys",
    "kids & toys": "kids-toys",
    "kids and toys": "kids-toys",
    "kids": "kids-toys",
    "toy": "toys",
    "toys": "toys",
    "games": "toys",
    "toys, games": "toys",
    // ── Gaming ───────────────────────────────────────────────────────────
    "gaming monitor": "gaming",
    "gaming console": "gaming",
    "gaming mouse": "gaming",
    "gaming headset": "gaming",
    "gaming mic": "gaming",
    "gaming speaker": "gaming",
    "gaming": "gaming",
    "projector": "projectors",
    // ── Audio / Headphones ───────────────────────────────────────────────
    "wireless headphone": "tws-headphone",
    "wireless earphone": "tws-headphone",
    "earphone": "tws-headphone",
    "earbud": "tws-headphone",
    "headset": "tws-headphone",
    "headphone": "tws-headphone",
    "fm transmitter": "fm-transmitter",
    "speaker": "speakers",
    "bluetooth speaker": "speakers",
    // ── Cables & Hubs ────────────────────────────────────────────────────
    "usb hub": "hubs",
    "hub": "hubs",
    "usb-c": "cables",
    "micro usb": "cables",
    "lightning": "cables",
    "cable": "cables",
    "usb": "cables",
    // ── Power sockets ────────────────────────────────────────────────────
    "power socket": "power-socket",
    "power outlet": "power-socket",
    // ── Tablets ──────────────────────────────────────────────────────────
    "ipad": "mobiletablet",
    "tablet": "mobiletablet",
    // ── Watches ──────────────────────────────────────────────────────────
    "watch band": "smart-watch-loops",
    "watch strap": "smart-watch-loops",
    "smart watch": "smart-watch",
    "smartwatch": "smart-watch",
    "watch": "smart-watch",
    // ── Stands / Holders ─────────────────────────────────────────────────
    "phone stand": "mobile-stand",
    "phone mount": "car-mount",
    "car mount": "car-mount",
    "car charger": "car-charger",
    "holder": "mobile-stand",
    "stand": "mobile-stand",
    // ── Chargers ─────────────────────────────────────────────────────────
    "power charger": "chargers",
    "fast charger": "chargers",
    "power delivery": "chargers",
    "charger": "chargers",
    // ── MagSafe ──────────────────────────────────────────────────────────
    "magsafe": "magsafe",
    "magnetic": "magsafe",
    // ── Screen Protectors ────────────────────────────────────────────────
    "screen protector": "screen-protector",
    "tempered glass": "screen-protector",
    "protector": "screen-protector",
    // ── Cases ────────────────────────────────────────────────────────────
    "protective case": "cases",
    "mobile case": "cases",
    "phone case": "cases",
    "case": "cases",
    // ── Lifestyle ────────────────────────────────────────────────────────
    "lifestyle": "lifestyle",
  }
  
  // Check exact match on last part first
  const exactMatch = keywords[lastPart]
  if (exactMatch) {
    return exactMatch
  }
  
  // Check partial matches on last part
  for (const [keyword, handle] of Object.entries(keywords)) {
    if (lastPart.includes(keyword) || keyword.includes(lastPart)) {
      return handle
    }
  }
  
  // Check all parts (breadcrumb matching)
  for (const part of parts) {
    const partMatch = keywords[part]
    if (partMatch) {
      return partMatch
    }
    for (const [keyword, handle] of Object.entries(keywords)) {
      if (part.includes(keyword) || keyword.includes(part)) {
        return handle
      }
    }
  }
  
  // Last resort: use the last part as the handle (slugified)
  return lastPart.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
}

/**
 * Generate direct Odoo image URL for a product
 */
function getOdooImageUrl(odooId: number): string {
  return `${ODOO_BASE_URL}/web/image/product.product/${odooId}/image_1920`
}

interface OdooProductPayload {
  odoo_id: number
  name: string
  // ── Arabic translations (real Odoo fields: arabic_name, arabic_description) ─
  arabic_name?: string               // Arabic product name → saved as title_ar
  arabic_description?: string        // Arabic description  → saved as description_ar
  // ── Basic fields ──────────────────────────────────────────────────────────
  default_code?: string
  barcode?: string
  list_price?: number
  compare_list_price?: number        // strikethrough price on product page
  standard_price?: number            // cost price (Odoo field name) → saved as cost_price
  cost_price?: number                // alias for standard_price
  x_studio_retail_price?: number              // RRP / recommended retail price
  currency_code?: string
  description_sale?: string
  description?: string
  categ_id?: [number, string] | false
  // ── eCommerce / public categories (Odoo: public_categ_ids) ───────────────
  // This is the STOREFRONT category path e.g. "Electronics / Earphones & Headphones/Kids Headphone"
  // It is MORE accurate than categ_id for website display — use it as primary category source
  public_categ_ids?: string | string[] | [number, string][]  // various formats Odoo may send
  // ── Brand (use custom_brand_id from Odoo, NOT brand_id) ───────────────────
  brand?: string                     // brand name string (from x_studio_brand_1 or custom_brand_id[1])
  custom_brand_id?: [number, string] | false  // [id, "Apple"] → used to build brand_logo_url
  brand_logo_url?: string            // direct URL to brand logo image
  brand_image_url?: string           // alias that Odoo dev may send instead of brand_logo_url
  // ── Weight / Dimensions ───────────────────────────────────────────────────
  weight?: number
  volume?: number
  hs_code?: string                   // Harmonized System code for customs
  country_of_origin?: string         // origin country name string
  // ── Images ────────────────────────────────────────────────────────────────
  image_url?: string
  image_1920?: string
  images?: string[]
  // ── Stock ─────────────────────────────────────────────────────────────────
  qty_available?: number
  virtual_available?: number         // forecasted qty (Odoo: virtual_available)
  is_published?: boolean
  // ── eCommerce description (Odoo field: description_ecommerce) ─────────────
  description_ecommerce?: string     // Rich HTML description (Odoo native field)
  ecommerce_description?: string     // alias kept for backward compatibility
  // ── Category / Sub-category ───────────────────────────────────────────────
  x_studio_sub_category?: string     // Odoo custom sub-category string
  // ── SEO (Odoo fields: website_meta_title, website_meta_description) ───────
  website_meta_title?: string        // SEO page title
  website_meta_description?: string  // SEO meta description
  seo_title?: string                 // alias
  seo_description?: string           // alias
  // ── Badges / Flags ────────────────────────────────────────────────────────
  is_new?: boolean                   // shows "New" badge (custom Odoo field)
  warranty?: string                  // warranty text e.g. "1 Year Warranty"
  // ── Delivery fields (custom Odoo fields) ──────────────────────────────────
  night_delivery?: boolean           // true = eligible for night delivery
  fast_delivery_areas?: string[]     // areas for fast delivery e.g. ["Kuwait City","Hawalli"]
  // ── Product Comparison / Cross-sell ───────────────────────────────────────
  alternative_odoo_ids?: number[]    // from Odoo: alternative_product_ids
  alternative_product_ids?: number[] // Odoo native field name alias
  upsell_odoo_ids?: number[]         // optional products / upsell
  optional_product_ids?: number[]    // Odoo native field name alias
  accessory_odoo_ids?: number[]      // from Odoo: accessory_product_ids
  accessory_product_ids?: number[]   // Odoo native field name alias
  // ── Specifications / Attributes ───────────────────────────────────────────
  attributes?: Record<string, string> // computed from attribute_line_ids e.g. {"Color":"Black","Size":"M"}
  attribute_line_ids?: Record<string, string> | Array<{name: string; values: string[]}> // raw Odoo format
  features?: string[]                 // bullet-point feature list
  // ──────────────────────────────────────────────────────────────────────────
  [key: string]: any
}

/**
 * Ensure a category exists, creating it if necessary
 * This enables automatic category creation from Odoo products
 */
async function ensureCategory(
  pg: any,
  handle: string,
  name: string,
  categoryByHandle: Map<string, string>
): Promise<string> {
  if (categoryByHandle.has(handle)) {
    return categoryByHandle.get(handle)!
  }
  
  try {
    const catId = genId("pcat")
    await pg.raw(
      `INSERT INTO product_category (id, name, handle, status, is_active, rank, created_at, updated_at)
       VALUES (?, ?, ?, 'published', true, 0, NOW(), NOW())
       ON CONFLICT (handle) DO NOTHING`,
      [catId, name, handle]
    )
    
    // Re-fetch to get the actual ID (in case of conflict)
    const fetchRes = await pg.raw(
      `SELECT id FROM product_category WHERE handle = ? AND deleted_at IS NULL LIMIT 1`,
      [handle]
    )
    
    if (fetchRes.rows?.length > 0) {
      const actualId = fetchRes.rows[0].id
      categoryByHandle.set(handle, actualId)
      console.log(`[Odoo Webhook] Auto-created category: ${name} (${handle})`)
      return actualId
    }
  } catch (err) {
    console.warn(`[Odoo Webhook] Failed to create category ${handle}: ${err}`)
  }
  
  return ""
}

async function upsertProduct(
  pg: any,
  p: OdooProductPayload,
  salesChannelId: string | null,
  existingHandles: Set<string>,
  categoryByHandle: Map<string, string>
): Promise<{ action: string; productId: string }> {
  const odooId = p.odoo_id
  const sku = p.default_code || `ODOO-${odooId}`
  const title = p.name || `Odoo Product ${odooId}`
  const KWD_FILS_DIVISOR = 1000
  const rawPrice = p.x_studio_retail_price || 0
  const price = Math.round(rawPrice * KWD_FILS_DIVISOR)
  const description = p.description_sale || p.description || ""
  const weight = p.weight ? String(p.weight) : null
  // Default all newly synced products to "draft" so they can be reviewed before publishing
  const status = "draft"

  // ── Barcode: strip "(EAN-13): " or "(EAN-8): " or any similar prefix ──────
  const rawBarcode = p.barcode || null
  const barcode = rawBarcode
    ? rawBarcode.replace(/^\(.*?\):\s*/i, "").trim() || rawBarcode
    : null

  // ── Brand: prefer custom_brand_id[1], fallback to brand string ───────────
  const brand = (p.custom_brand_id && Array.isArray(p.custom_brand_id) ? p.custom_brand_id[1] : null)
    || p.brand
    || null

  // ── Brand logo: accept brand_image_url (Odoo dev field) OR brand_logo_url,
  //    OR auto-build from custom_brand_id ────────────────────────────────────
  const brandLogoUrl = p.brand_image_url
    || p.brand_logo_url
    || (p.custom_brand_id && Array.isArray(p.custom_brand_id)
      ? `${ODOO_BASE_URL}/web/image/custom.product.brand/${p.custom_brand_id[0]}/image_1920`
      : null)

  // ── Category: prefer public_categ_ids (eCommerce path) over categ_id ─────
  // public_categ_ids is the STOREFRONT category ("Electronics / Earphones & Headphones/Kids Headphone")
  // categ_id is the internal accounting category ("Kids Headphones") — less accurate for website
  let categoryForMapping: string | null = null
  if (p.public_categ_ids) {
    if (typeof p.public_categ_ids === 'string') {
      categoryForMapping = p.public_categ_ids
    } else if (Array.isArray(p.public_categ_ids) && p.public_categ_ids.length > 0) {
      const first = p.public_categ_ids[0]
      if (typeof first === 'string') {
        categoryForMapping = first
      } else if (Array.isArray(first) && first.length >= 2) {
        categoryForMapping = String(first[1])
      }
    }
  }
  // Fallback to categ_id if public_categ_ids not provided
  const category = categoryForMapping
    || (p.categ_id && Array.isArray(p.categ_id) ? p.categ_id[1] : null)

  // ── Attributes: accept both pre-computed { Color: "Yellow" } dict
  //    AND raw attribute_line_ids array from Odoo ────────────────────────────
  let attributes: Record<string, string> = {}
  if (p.attributes && typeof p.attributes === 'object' && !Array.isArray(p.attributes)) {
    attributes = p.attributes
  } else if (p.attribute_line_ids) {
    if (Array.isArray(p.attribute_line_ids)) {
      // Array format: [{name: "Colour", values: ["Yellow"]}, ...]
      for (const line of p.attribute_line_ids as Array<{name: string; values: string[]}>) {
        if (line.name && Array.isArray(line.values) && line.values.length > 0) {
          attributes[line.name] = line.values.join(", ")
        }
      }
    } else if (typeof p.attribute_line_ids === 'object') {
      // Dict format: { "colour": "yellow" }
      attributes = p.attribute_line_ids as Record<string, string>
    }
  }

  // ── Alternative/accessory/upsell: accept both Odoo native names + our aliases ─
  const alternativeIds = Array.isArray(p.alternative_odoo_ids) ? p.alternative_odoo_ids
    : Array.isArray(p.alternative_product_ids) ? p.alternative_product_ids : []
  const accessoryIds = Array.isArray(p.accessory_odoo_ids) ? p.accessory_odoo_ids
    : Array.isArray(p.accessory_product_ids) ? p.accessory_product_ids : []
  const upsellIds = Array.isArray(p.upsell_odoo_ids) ? p.upsell_odoo_ids
    : Array.isArray(p.optional_product_ids) ? p.optional_product_ids : []

  // ── eCommerce description: accept both field names ────────────────────────
  const ecommerceDesc = p.description_ecommerce || p.ecommerce_description || ''

  const metadata: Record<string, any> = {
    odoo_id: odooId,
    odoo_sku: sku,
    odoo_barcode: barcode,
    odoo_category: category,
    odoo_brand: brand,
    odoo_qty: p.qty_available || 0,
    odoo_stock: p.qty_available || 0,
    synced_at: new Date().toISOString(),
    // ── Pricing ──────────────────────────────────────────────────────────
    compare_price: p.compare_list_price || 0,
    retail_price: p.x_studio_retail_price || 0,
    // ── Brand ────────────────────────────────────────────────────────────
    brand: brand,
    brand_logo_url: brandLogoUrl,
    // ── Arabic translations ───────────────────────────────────────────────
    title_ar: p.arabic_name || null,
    description_ar: p.arabic_description || null,
    // ── Descriptions ─────────────────────────────────────────────────────
    ecommerce_description: ecommerceDesc,
    // ── Category / Sub-category ───────────────────────────────────────────
    sub_category: p.x_studio_sub_category || null,
    public_categ_ids: p.public_categ_ids || null,    // full eCommerce path from Odoo
    // ── Stock / Inventory ─────────────────────────────────────────────────
    forecasted_qty: p.virtual_available || 0,
    // ── Physical ─────────────────────────────────────────────────────────
    volume: p.volume || null,
    hs_code: p.hs_code || null,
    country_of_origin: p.country_of_origin || null,
    // ── Badges / Flags ────────────────────────────────────────────────────
    is_new: p.is_new === true,
    warranty: p.warranty || '1 Year Warranty',
    // ── SEO ──────────────────────────────────────────────────────────────
    seo_title: p.website_meta_title || p.seo_title || null,
    seo_description: p.website_meta_description || p.seo_description || null,
    // ── Delivery eligibility ──────────────────────────────────────────────
    night_delivery: p.night_delivery === true,
    fast_delivery_areas: Array.isArray(p.fast_delivery_areas) ? p.fast_delivery_areas : [],
    // ── Cross-sell / Comparison ───────────────────────────────────────────
    alternative_odoo_ids: alternativeIds,
    upsell_odoo_ids: upsellIds,
    accessory_odoo_ids: accessoryIds,
    // ── Specifications / Attributes ───────────────────────────────────────
    attributes: attributes,
    features: Array.isArray(p.features) ? p.features : [],
    // ─────────────────────────────────────────────────────────────────────
  }

  // Check if product exists by odoo_id or SKU
  const existing = await pg.raw(
    `SELECT id, handle FROM product WHERE metadata->>'odoo_id' = ? AND deleted_at IS NULL LIMIT 1`,
    [String(odooId)]
  )
  const existBySku = existing.rows?.length
    ? existing
    : await pg.raw(
        `SELECT p.id, p.handle FROM product p JOIN product_variant pv ON pv.product_id = p.id WHERE pv.sku = ? AND p.deleted_at IS NULL AND pv.deleted_at IS NULL LIMIT 1`,
        [sku]
      )

  if (existBySku.rows?.length > 0) {
    const prodId = existBySku.rows[0].id
    await pg.raw(
      `UPDATE product SET title=?, description=?, weight=?, metadata=?, thumbnail=COALESCE(?, thumbnail), updated_at=NOW() WHERE id=?`,
      [title, description, weight, JSON.stringify(metadata), p.image_url || null, prodId]
    )
    const varRes = await pg.raw(
      `SELECT pv.id as vid, pvps.price_set_id as psid FROM product_variant pv LEFT JOIN product_variant_price_set pvps ON pvps.variant_id = pv.id WHERE pv.product_id = ? AND pv.deleted_at IS NULL LIMIT 1`,
      [prodId]
    )
    // Ensure allow_backorder=false so out of stock items cannot be bought
    if (varRes.rows?.length > 0) {
      await pg.raw(
        `UPDATE product_variant SET allow_backorder = false, updated_at = NOW() WHERE id = ?`,
        [varRes.rows[0].vid]
      )
    }
    // Always update barcode with cleaned value on update
    if (varRes.rows?.length > 0 && barcode) {
      await pg.raw(
        `UPDATE product_variant SET barcode=?, updated_at=NOW() WHERE id=?`,
        [barcode, varRes.rows[0].vid]
      )
    }
    if (varRes.rows?.length > 0 && varRes.rows[0].psid && price > 0) {
      const rawAmount = JSON.stringify({ value: String(price), precision: 20 })
      const existsKwd = await pg.raw(
        `SELECT id FROM price WHERE price_set_id=? AND currency_code='kwd' AND deleted_at IS NULL LIMIT 1`,
        [varRes.rows[0].psid]
      )
      if (existsKwd.rows?.length === 0) {
        await pg.raw(
          `INSERT INTO price (id, price_set_id, currency_code, amount, raw_amount, rules_count, created_at, updated_at) VALUES (?, ?, 'kwd', ?, ?, 0, NOW(), NOW())`,
          [genId("price"), varRes.rows[0].psid, price, rawAmount]
        )
      } else {
        await pg.raw(
          `UPDATE price SET amount=?, raw_amount=?, updated_at=NOW() WHERE price_set_id=? AND currency_code='kwd' AND deleted_at IS NULL`,
          [price, rawAmount, varRes.rows[0].psid]
        )
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // IMAGE SYNC (update path)
    // Replace all images whenever Odoo sends an `images` array
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (p.images && Array.isArray(p.images) && p.images.length > 0) {
      try {
        // Delete all existing images for this product
        await pg.raw(`DELETE FROM image WHERE product_id = ?`, [prodId])
        // Re-insert the full gallery in order
        for (let idx = 0; idx < p.images.length; idx++) {
          const imgUrl = p.images[idx]
          if (!imgUrl) continue
          await pg.raw(
            `INSERT INTO image (id, url, rank, product_id, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())`,
            [genId("img"), imgUrl, idx, prodId]
          )
        }
        // Also update thumbnail to be the first image
        await pg.raw(
          `UPDATE product SET thumbnail = ?, updated_at = NOW() WHERE id = ?`,
          [p.images[0], prodId]
        )
        console.log(`[Odoo Webhook] Updated ${p.images.length} image(s) for product ${prodId}`)
      } catch (imgErr) {
        console.warn(`[Odoo Webhook] Image sync failed for ${prodId}: ${imgErr}`)
      }
    } else if (p.image_url) {
      // If only a single image_url is provided, ensure it exists in the image table
      try {
        const existImgRes = await pg.raw(`SELECT id FROM image WHERE product_id = ? LIMIT 1`, [prodId])
        if (existImgRes.rows?.length === 0) {
          await pg.raw(
            `INSERT INTO image (id, url, rank, product_id, created_at, updated_at) VALUES (?, ?, 0, ?, NOW(), NOW())`,
            [genId("img"), p.image_url, prodId]
          )
        }
      } catch (imgErr) {
        console.warn(`[Odoo Webhook] Single image sync failed: ${imgErr}`)
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // CATEGORY SYNC
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const catHandle = odooCategoryToHandle(category)
    if (catHandle) {
      // Use ensureCategory to automatically create if missing
      const catId = await ensureCategory(pg, catHandle, category || catHandle, categoryByHandle)
      if (catId) {
        try {
          await pg.raw(
            `INSERT INTO product_category_product (product_id, product_category_id)
             VALUES (?, ?)
             ON CONFLICT (product_id, product_category_id) DO NOTHING`,
            [prodId, catId]
          )
        } catch (err) {
          console.warn(`[Odoo Webhook] Category link failed for ${prodId}: ${err}`)
        }
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // INVENTORY SYNC
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const qty = p.qty_available || 0
    if (varRes.rows?.length > 0) {
      const vid = varRes.rows[0].vid
      try {
        let invItemId: string | null = null

        // Check if inventory_item exists
        const invItemRes = await pg.raw(
          `SELECT id FROM inventory_item WHERE sku = ? LIMIT 1`,
          [sku]
        )

        if (invItemRes.rows?.length > 0) {
          invItemId = invItemRes.rows[0].id
          const invLvlRes = await pg.raw(
            `SELECT id FROM inventory_level WHERE inventory_item_id = ? LIMIT 1`,
            [invItemId]
          )
          if (invLvlRes.rows?.length > 0) {
            await pg.raw(
              `UPDATE inventory_level SET stocked_quantity = ?, updated_at = NOW() WHERE id = ?`,
              [qty, invLvlRes.rows[0].id]
            )
          } else {
            const locRes = await pg.raw(`SELECT id FROM stock_location LIMIT 1`)
            if (locRes.rows?.length > 0) {
              await pg.raw(
                `INSERT INTO inventory_level (id, inventory_item_id, location_id, stocked_quantity, reserved_quantity, incoming_quantity, created_at, updated_at)
                 VALUES (?, ?, ?, ?, 0, 0, NOW(), NOW())`,
                [genId("iloc"), invItemId, locRes.rows[0].id, qty]
              )
            }
          }
        } else {
          invItemId = genId("iitem")
          await pg.raw(
            `INSERT INTO inventory_item (id, sku, title, created_at, updated_at)
             VALUES (?, ?, ?, NOW(), NOW())`,
            [invItemId, sku, title]
          )
          const locRes = await pg.raw(`SELECT id FROM stock_location LIMIT 1`)
          if (locRes.rows?.length > 0) {
            await pg.raw(
              `INSERT INTO inventory_level (id, inventory_item_id, location_id, stocked_quantity, reserved_quantity, incoming_quantity, created_at, updated_at)
               VALUES (?, ?, ?, ?, 0, 0, NOW(), NOW())`,
              [genId("iloc"), invItemId, locRes.rows[0].id, qty]
            )
          }
        }

        // CRITICAL FIX: Link the variant to the inventory item so Medusa knows about it
        if (invItemId) {
          const linkRes = await pg.raw(
            `SELECT id FROM product_variant_inventory_item WHERE variant_id = ? AND inventory_item_id = ? LIMIT 1`,
            [vid, invItemId]
          )
          if (linkRes.rows?.length === 0) {
            // Check if it's linked to a wrong item, if so, delete the wrong link
            await pg.raw(`DELETE FROM product_variant_inventory_item WHERE variant_id = ?`, [vid])
            await pg.raw(
              `INSERT INTO product_variant_inventory_item (id, variant_id, inventory_item_id, required_quantity, created_at, updated_at)
               VALUES (?, ?, ?, 1, NOW(), NOW())`,
              [genId("pvitem"), vid, invItemId]
            )
          }
        }
      } catch (err) {
        console.warn(`[Odoo Webhook] Inventory sync failed for ${sku}: ${err}`)
      }
    }

    return { action: "updated", productId: prodId }
  }

  // CREATE new product
  let handle = slugify(title)
  if (!handle) handle = `odoo-${odooId}`
  if (existingHandles.has(handle)) handle = `${handle}-${odooId}`
  if (existingHandles.has(handle)) handle = `${handle}-${Date.now().toString(36)}`
  existingHandles.add(handle)

  let thumbnail: string | null = p.image_url || null
  if (!thumbnail && (p.image_1920 || p.odoo_id)) {
    // Use direct Odoo image URL instead of saving base64 locally
    thumbnail = getOdooImageUrl(odooId)
  }

  const productId = genId("prod")
  await pg.raw(
    `INSERT INTO product (id, title, handle, subtitle, description, thumbnail, status, weight, metadata, discountable, is_giftcard, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, true, false, NOW(), NOW())`,
    [productId, title, handle, brand || "", description, thumbnail, status, weight, JSON.stringify(metadata)]
  )

  // Check if a variant with this SKU already exists (e.g. from a previous failed insert)
  // and reuse it rather than crashing on duplicate SKU constraint
  const existingVariant = await pg.raw(
    `SELECT id FROM product_variant WHERE sku = ? AND deleted_at IS NULL LIMIT 1`,
    [sku]
  )
  let variantId: string
  if (existingVariant.rows?.length > 0) {
    variantId = existingVariant.rows[0].id
    await pg.raw(
      `UPDATE product_variant SET product_id=?, barcode=COALESCE(?, barcode), updated_at=NOW() WHERE id=?`,
      [productId, barcode, variantId]
    )
  } else {
    variantId = genId("variant")
    await pg.raw(
      `INSERT INTO product_variant (id, product_id, title, sku, barcode, manage_inventory, allow_backorder, variant_rank, created_at, updated_at)
       VALUES (?, ?, 'Default', ?, ?, true, false, 0, NOW(), NOW())`,
      [variantId, productId, sku, barcode]
    )
  }

  // ── Price ─────────────────────────────────────────────────────────────────
  // Always insert a KWD price
  if (price > 0) {
    const priceSetId = genId("pset")
    await pg.raw(`INSERT INTO price_set (id, created_at, updated_at) VALUES (?, NOW(), NOW())`, [priceSetId])
    await pg.raw(
      `INSERT INTO product_variant_price_set (id, variant_id, price_set_id, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())`,
      [genId("pvps"), variantId, priceSetId]
    )
    const rawAmount = JSON.stringify({ value: String(price), precision: 20 })
    await pg.raw(
      `INSERT INTO price (id, price_set_id, currency_code, amount, raw_amount, rules_count, created_at, updated_at) VALUES (?, ?, 'kwd', ?, ?, 0, NOW(), NOW())`,
      [genId("price"), priceSetId, price, rawAmount]
    )
  }

  // ── Product Options (attributes from attribute_line_ids / attributes) ─────
  // Writes to product_option + product_option_value tables so admin shows them
  if (Object.keys(attributes).length > 0) {
    try {
      let optionRank = 0
      for (const [attrName, attrValue] of Object.entries(attributes)) {
        const optionId = genId("opt")
        await pg.raw(
          `INSERT INTO product_option (id, product_id, title, rank, created_at, updated_at)
           VALUES (?, ?, ?, ?, NOW(), NOW())
           ON CONFLICT DO NOTHING`,
          [optionId, productId, attrName, optionRank++]
        )
        // Re-fetch the option id (in case of conflict)
        const optRes = await pg.raw(
          `SELECT id FROM product_option WHERE product_id = ? AND title = ? LIMIT 1`,
          [productId, attrName]
        )
        const realOptId = optRes.rows?.[0]?.id || optionId
        // Insert each value (comma-separated support)
        const values = attrValue.split(",").map((v: string) => v.trim()).filter(Boolean)
        let valueRank = 0
        for (const val of values) {
          const ovId = genId("optval")
          await pg.raw(
            `INSERT INTO product_option_value (id, option_id, value, rank, created_at, updated_at)
             VALUES (?, ?, ?, ?, NOW(), NOW())
             ON CONFLICT DO NOTHING`,
            [ovId, realOptId, val, valueRank++]
          )
        }
        // Link variant to option value
        const ovRes = await pg.raw(
          `SELECT id FROM product_option_value WHERE option_id = ? ORDER BY rank LIMIT 1`,
          [realOptId]
        )
        if (ovRes.rows?.[0]?.id) {
          await pg.raw(
            `INSERT INTO product_variant_option_value (id, variant_id, option_value_id, created_at, updated_at)
             VALUES (?, ?, ?, NOW(), NOW())
             ON CONFLICT DO NOTHING`,
            [genId("pvov"), variantId, ovRes.rows[0].id]
          )
        }
      }
      console.log(`[Odoo Webhook] Wrote ${Object.keys(attributes).length} option(s) for ${sku}`)
    } catch (err) {
      console.warn(`[Odoo Webhook] Option write failed for ${sku}: ${err}`)
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // IMAGE SYNC (create path)
  // Insert all images from the `images` array sent by Odoo.
  // images[0] is usually the same as image_url/thumbnail so we
  // use the array as the single source of truth when present.
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (p.images && Array.isArray(p.images) && p.images.length > 0) {
    // Use the full images array — rank starts at 0
    for (let idx = 0; idx < p.images.length; idx++) {
      const imgUrl = p.images[idx]
      if (!imgUrl) continue
      await pg.raw(
        `INSERT INTO image (id, url, rank, product_id, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())`,
        [genId("img"), imgUrl, idx, productId]
      )
    }
  } else if (thumbnail) {
    // Fallback: only the thumbnail is known — insert it as the single image
    await pg.raw(
      `INSERT INTO image (id, url, rank, product_id, created_at, updated_at) VALUES (?, ?, 0, ?, NOW(), NOW())`,
      [genId("img"), thumbnail, productId]
    )
  }

  if (salesChannelId) {
    try {
      await pg.raw(
        `INSERT INTO product_sales_channel (id, product_id, sales_channel_id, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW()) ON CONFLICT (product_id, sales_channel_id) DO NOTHING`,
        [genId("psc"), productId, salesChannelId]
      )
    } catch { /* ignore */ }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // CATEGORY SYNC
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const catHandle = odooCategoryToHandle(category)
  // Use ensureCategory on CREATE path too (same as UPDATE path)
  // This means: if handle maps to an existing category → link it; if not → create it
  const catIdForCreate = catHandle
    ? await ensureCategory(pg, catHandle, category || catHandle, categoryByHandle)
    : null
  if (catIdForCreate) {
    try {
      await pg.raw(
        `INSERT INTO product_category_product (product_id, product_category_id)
         VALUES (?, ?)
         ON CONFLICT (product_id, product_category_id) DO NOTHING`,
        [productId, catIdForCreate]
      )
    } catch (err) {
      console.warn(`[Odoo Webhook] Category link failed for ${productId}: ${err}`)
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // INVENTORY SYNC
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const qty = p.qty_available || 0
  try {
    // Create inventory_item
    const invItemId = genId("iitem")
    await pg.raw(
      `INSERT INTO inventory_item (id, sku, title, created_at, updated_at)
       VALUES (?, ?, ?, NOW(), NOW())`,
      [invItemId, sku, title]
    )
    // Get default location
    const locRes = await pg.raw(`SELECT id FROM stock_location LIMIT 1`)
    if (locRes.rows?.length > 0) {
      // Create inventory_level
      await pg.raw(
        `INSERT INTO inventory_level (id, inventory_item_id, location_id, stocked_quantity, reserved_quantity, incoming_quantity, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, 0, NOW(), NOW())`,
        [genId("iloc"), invItemId, locRes.rows[0].id, qty]
      )
    }
    
    // CRITICAL FIX: Link the variant to the inventory item
    await pg.raw(
      `INSERT INTO product_variant_inventory_item (id, variant_id, inventory_item_id, required_quantity, created_at, updated_at)
       VALUES (?, ?, ?, 1, NOW(), NOW())`,
      [genId("pvitem"), variantId, invItemId]
    )
  } catch (err) {
    console.warn(`[Odoo Webhook] Inventory sync failed for ${sku}: ${err}`)
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SHIPPING PROFILE LINK — required for checkout to work
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  try {
    const spRes = await pg.raw(`SELECT id FROM shipping_profile WHERE type = 'default' AND deleted_at IS NULL LIMIT 1`)
    if (spRes.rows?.length > 0) {
      const spId = spRes.rows[0].id
      await pg.raw(
        `INSERT INTO product_shipping_profile (id, product_id, shipping_profile_id, created_at, updated_at)
         VALUES (?, ?, ?, NOW(), NOW())
         ON CONFLICT (product_id, shipping_profile_id) DO NOTHING`,
        ['sprod_' + productId.replace('prod_', '').substring(0, 26), productId, spId]
      )
    }
  } catch (spErr) {
    console.warn(`[Odoo Webhook] Shipping profile link failed for ${productId}: ${spErr}`)
  }

  return { action: "created", productId }
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const pg = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const startTime = Date.now()
  const body = req.body as any

  // Log raw payload for debugging (first 500 chars)
  console.log(`[Odoo Webhook] RAW body keys: ${Object.keys(body || {}).join(', ')}`)

  const { webhook_secret } = body

  if (WEBHOOK_SECRET && webhook_secret !== WEBHOOK_SECRET) {
    return res.status(401).json({ type: "unauthorized", message: "Invalid webhook_secret" })
  }

  // Auto-detect event_type if not provided by Odoo
  // Odoo may send the product fields directly at root level (no event_type wrapper)
  let event_type = body.event_type

  if (!event_type) {
    if (body.products && Array.isArray(body.products)) {
      event_type = "product.bulk"
    } else if (body.id && body.name) {
      // Odoo sends fields at root level — wrap into expected shape
      event_type = "product.created"
      if (!body.product) {
        body.product = { ...body }
        body.product.odoo_id = body.product.odoo_id || body.product.id
      }
    } else if (body.product?.id || body.product?.odoo_id) {
      event_type = "product.created"
      if (!body.product.odoo_id) body.product.odoo_id = body.product.id
    } else {
      console.warn(`[Odoo Webhook] 400 - missing event_type. Body: ${JSON.stringify(body).substring(0,300)}`)
      return res.status(400).json({ type: "invalid_data", message: "event_type is required" })
    }
  }

  console.log(`[Odoo Webhook] ${event_type} received`)

  try {
    const scRes = await pg.raw(`SELECT id FROM sales_channel WHERE deleted_at IS NULL LIMIT 1`)
    const salesChannelId = scRes.rows?.[0]?.id || null
    const hRes = await pg.raw(`SELECT handle FROM product WHERE deleted_at IS NULL`)
    const existingHandles = new Set<string>(hRes.rows?.map((r: any) => r.handle) || [])

    // Load category mappings
    const catRes = await pg.raw(`SELECT id, handle FROM product_category WHERE deleted_at IS NULL`)
    const categoryByHandle = new Map<string, string>()
    for (const row of catRes.rows || []) {
      categoryByHandle.set(row.handle, row.id)
    }
    console.log(`[Odoo Webhook] Loaded ${categoryByHandle.size} categories`)

    // DELETE
    if (event_type === "product.deleted") {
      const odooId = body.product?.odoo_id
      if (!odooId) return res.status(400).json({ message: "product.odoo_id required" })
      const found = await pg.raw(
        `SELECT id, title FROM product WHERE metadata->>'odoo_id' = ? AND deleted_at IS NULL`,
        [String(odooId)]
      )
      if (found.rows?.length > 0) {
        await pg.raw(`UPDATE product SET deleted_at=NOW(), status='draft' WHERE id=?`, [found.rows[0].id])
        console.log(`[Odoo Webhook] Deleted: ${found.rows[0].title}`)
        return res.json({ status: "success", action: "deleted", id: found.rows[0].id })
      }
      return res.json({ status: "not_found", message: `No product for Odoo ID ${odooId}` })
    }

    // BULK
    if (event_type === "product.bulk") {
      const products: OdooProductPayload[] = body.products || []
      if (!products.length) return res.status(400).json({ message: "products array required" })
      let created = 0, updated = 0, errors = 0
      for (const p of products) {
        try {
          if (!p.odoo_id || !p.name) { errors++; continue }
          const r = await upsertProduct(pg, p, salesChannelId, existingHandles, categoryByHandle)
          if (r.action === "created") created++; else updated++
        } catch (err: any) {
          errors++
          console.error(`[Odoo Webhook] Bulk err [${p.odoo_id}]: ${err.message}`)
        }
      }
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
      console.log(`[Odoo Webhook] Bulk done: created=${created} updated=${updated} errors=${errors} (${elapsed}s)`)
      return res.json({ status: "success", action: "bulk", created, updated, errors, total: products.length, elapsed_seconds: elapsed })
    }

    // SINGLE CREATE/UPDATE
    // Support both: { product: {...} } and flat root-level { id, name, ... }
    const p: OdooProductPayload = body.product || body
    if (!p?.odoo_id || !p?.name) {
      return res.status(400).json({ message: "product.odoo_id and product.name are required" })
    }
    const result = await upsertProduct(pg, p, salesChannelId, existingHandles, categoryByHandle)
    console.log(`[Odoo Webhook] ${result.action}: ${p.name} -> ${result.productId}`)
    return res.json({ status: "success", ...result, odoo_id: p.odoo_id, product_name: p.name })

  } catch (error: any) {
    console.error(`[Odoo Webhook] Error:`, error.message)
    return res.status(500).json({ type: "error", message: error.message })
  }
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const pg = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const countRes = await pg.raw(`SELECT COUNT(*) as c FROM product WHERE status='published' AND deleted_at IS NULL`)
  const odooCount = await pg.raw(`SELECT COUNT(*) as c FROM product WHERE metadata->>'odoo_id' IS NOT NULL AND deleted_at IS NULL`)

  return res.json({
    status: "active",
    endpoint: "/odoo/webhooks/products",
    total_products: parseInt(countRes.rows?.[0]?.c || "0"),
    odoo_synced_products: parseInt(odooCount.rows?.[0]?.c || "0"),
    supported_events: ["product.created", "product.updated", "product.deleted", "product.bulk"],
    webhook_secret: "Required in request body",
    example_single: {
      event_type: "product.created",
      webhook_secret: "<secret>",
      product: { odoo_id: 123, name: "Product Name", default_code: "SKU-001", list_price: 99.99, currency_code: "aed", description_sale: "Description", brand: "Brand", image_url: "https://example.com/image.jpg", is_published: true },
    },
    example_bulk: {
      event_type: "product.bulk",
      webhook_secret: "<secret>",
      products: ["... array of product objects ..."],
    },
  })
}
