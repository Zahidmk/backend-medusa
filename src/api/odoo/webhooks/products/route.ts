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

import { ODOO_CONFIG } from "../../../../config/odoo"

const WEBHOOK_SECRET = ODOO_CONFIG.webhookSecret
const ODOO_BASE_URL = ODOO_CONFIG.url

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

interface OdooProductVariantPayload {
  variant_id: number
  sku?: string
  default_code?: string
  price?: number
  lst_price?: number
  marka_price?: number
  retail_price?: number
  barcode?: string
  free_qty?: number
  oskar_expo_template_id?: number | false
  attributes?: Record<string, string>
  name?: string
  [key: string]: any
}

interface OdooProductPayload {
  odoo_id: number
  name: string
  variants?: OdooProductVariantPayload[]
  oskar_expo_template_id?: number | false
  // ── Arabic translations (real Odoo fields: arabic_name, arabic_description) ─
  arabic_name?: string               // Arabic product name → saved as title_ar
  arabic_description?: string        // Arabic description  → saved as description_ar
  // ── Basic fields ──────────────────────────────────────────────────────────
  default_code?: string
  barcode?: string
  list_price?: number
  marka_price?: number
  compare_list_price?: number        // strikethrough price on product page
  standard_price?: number            // cost price (Odoo field name) → saved as cost_price
  cost_price?: number                // alias for standard_price

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
  free_qty?: number
  virtual_available?: number         // forecasted qty (Odoo: virtual_available)
  is_published?: boolean
  description_ecommerce?: string     // Rich HTML description (Odoo native field)
  ecommerce_description?: string     // alias kept for backward compatibility
  medusa_description?: string        // Custom Medusa description field
  medusa_overview?: string           // Custom Medusa overview field
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
  specifications?: Array<{key: string, value: string, primary: boolean}> // custom product specifications
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

/**
 * Resolve a flat {attribute: value} map from an Odoo-supplied `attributes` field.
 *
 * Supports both:
 * 1. Object shape: { "color": "Blue" }
 * 2. Array of objects shape: [ { "attribute": "color", "value": "Blue" } ] or [ { "attribute": "color", "values": ["Blue", "Black"] } ]
 */
function resolveAttributesMap(raw: unknown, context: string, warn: boolean): Record<string, string> {
  if (!raw) return {}
  if (Array.isArray(raw)) {
    const result: Record<string, string> = {}
    for (const item of raw) {
      if (item && typeof item === "object") {
        const attrName = (item as any).attribute || (item as any).name || (item as any).key
        if (!attrName) continue
        const key = String(attrName).trim()
        if ((item as any).value !== undefined && (item as any).value !== null) {
          result[key] = String((item as any).value).trim()
        } else if (Array.isArray((item as any).values)) {
          result[key] = (item as any).values.map((v: any) => String(v).trim()).join(", ")
        }
      }
    }
    return result
  }
  if (typeof raw === "object") {
    return raw as Record<string, string>
  }
  if (warn) {
    console.warn(`[Odoo Webhook] Rejected malformed 'attributes' for ${context}: expected object or array, got ${typeof raw}.`)
  }
  return {}
}

/**
 * True if any value in a resolved attributes map is a comma-joined multi-value string
 * (e.g. "Red, Blue"). A single variant cannot legitimately have two values for one option,
 * so this shape indicates an aggregate/template-wide list leaked into a per-variant field.
 */
function hasAmbiguousValue(attrs: Record<string, string>): boolean {
  return Object.values(attrs).some((val) => {
    const parts = String(val).split(",").map((s) => s.trim()).filter(Boolean)
    return parts.length > 1
  })
}

/**
 * Sync variants, prices, inventory items, options, and option values for a product.
 * Supports both multi-variant payloads (p.variants array) and single-variant fallback.
 */
async function syncProductVariantsAndOptions(
  pg: any,
  prodId: string,
  p: OdooProductPayload,
  templateSku: string,
  templateAttributes: Record<string, string>
) {
  const KWD_FILS_DIVISOR = 1000

  // 1. Prepare raw variant array
  let rawVariants: OdooProductVariantPayload[] = []
  if (p.variants && Array.isArray(p.variants) && p.variants.length > 0) {
    rawVariants = p.variants
  } else {
    rawVariants = [
      {
        variant_id: p.odoo_id,
        sku: p.default_code || templateSku,
        price: p.marka_price || p.list_price || 0,
        barcode: p.barcode || "",
        free_qty: p.free_qty || 0,
        oskar_expo_template_id: p.oskar_expo_template_id || false,
        attributes: templateAttributes,
      },
    ]
  }

  // 2. Classify each variant's attributes: resolve to a flat map, and detect ambiguity.
  // A variant's attributes are "ambiguous" when they cannot be trusted to represent that
  // variant's own selection — malformed shape, a comma-joined multi-value (invalid for a
  // single variant), or a template-wide fallback that can't distinguish sibling variants.
  // Ambiguous variants still get synced for their core commerce fields (SKU/price/stock —
  // see step 3) but are never used to create or overwrite product_option /
  // product_variant_option data.
  const resolvedVariantAttrs: Record<string, string>[] = []
  const variantAmbiguous: boolean[] = []
  for (const v of rawVariants) {
    const ctx = `variant ${v.variant_id} of product "${p.name}" (odoo_id=${p.odoo_id})`
    const hasOwnAttrs = v.attributes !== undefined && v.attributes !== null
    const ownAttrs = resolveAttributesMap(v.attributes, ctx, true)
    const malformedShape = hasOwnAttrs && typeof v.attributes !== "object"
    const usingTemplateFallback = Object.keys(ownAttrs).length === 0
    const vAttrs = usingTemplateFallback ? templateAttributes : ownAttrs
    resolvedVariantAttrs.push(vAttrs)

    let ambiguous = malformedShape
    if (!ambiguous && hasAmbiguousValue(vAttrs)) {
      console.warn(
        `[Odoo Webhook] Rejected ambiguous 'attributes' for ${ctx}: a value contains multiple ` +
        `comma-separated entries, which is invalid for a single variant. Resolved value: ${JSON.stringify(vAttrs)}`
      )
      ambiguous = true
    }
    if (!ambiguous && usingTemplateFallback && rawVariants.length > 1) {
      console.warn(
        `[Odoo Webhook] No per-variant 'attributes' for ${ctx}; falling back to template-wide ` +
        `attributes cannot distinguish this variant from its siblings — rejecting for option assignment.`
      )
      ambiguous = true
    }
    variantAmbiguous.push(ambiguous)
  }

  // If every variant that DID resolve non-empty attributes ended up identical, Odoo is most
  // likely sending the template's full attribute/value list to each variant instead of that
  // variant's own selected value. Treat all of them as ambiguous too.
  if (rawVariants.length > 1) {
    const nonAmbiguousNonEmpty = resolvedVariantAttrs
      .map((a, i) => ({ a, i }))
      .filter(({ a, i }) => !variantAmbiguous[i] && Object.keys(a).length > 0)
    if (nonAmbiguousNonEmpty.length > 1) {
      const first = JSON.stringify(nonAmbiguousNonEmpty[0].a)
      if (nonAmbiguousNonEmpty.every(({ a }) => JSON.stringify(a) === first)) {
        console.warn(
          `[Odoo Webhook] All ${nonAmbiguousNonEmpty.length} variants of product "${p.name}" (odoo_id=${p.odoo_id}) ` +
          `resolved to identical attribute values (${first}). This usually means Odoo sent the template's ` +
          `full attribute/value list instead of each variant's own selected value — rejecting for all affected variants.`
        )
        for (const { i } of nonAmbiguousNonEmpty) variantAmbiguous[i] = true
      }
    }
  }

  // 3. Build product_option / product_option_value only from variants with usable attributes.
  // If none exist, leave any existing option data untouched rather than partially rebuilding it.
  const optionValuesMap: Record<string, Set<string>> = {}
  for (let i = 0; i < rawVariants.length; i++) {
    if (variantAmbiguous[i]) continue
    for (const [key, val] of Object.entries(resolvedVariantAttrs[i])) {
      if (!key || val === undefined || val === null) continue
      const valStr = String(val).trim()
      if (!valStr) continue
      if (!optionValuesMap[key]) optionValuesMap[key] = new Set<string>()
      optionValuesMap[key].add(valStr)
    }
  }

  const optionValueIdMap: Map<string, string> = new Map()

  if (Object.keys(optionValuesMap).length > 0) {
    // Delete stale 'Default' values so old fallback options don't clutter real options
    await pg.raw(
      `DELETE FROM product_option_value WHERE (LOWER(value) = 'default' OR value = 'Default Option') AND option_id IN (SELECT id FROM product_option WHERE product_id = ?)`,
      [prodId]
    )

    for (const [optTitle, valSet] of Object.entries(optionValuesMap)) {
      let optId = genId("opt")
      await pg.raw(
        `INSERT INTO product_option (id, product_id, title, created_at, updated_at)
         VALUES (?, ?, ?, NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [optId, prodId, optTitle]
      )
      const optRes = await pg.raw(
        `SELECT id FROM product_option WHERE product_id = ? AND title = ? AND deleted_at IS NULL LIMIT 1`,
        [prodId, optTitle]
      )
      if (optRes.rows?.length > 0) {
        optId = optRes.rows[0].id
      }

      for (const optVal of Array.from(valSet)) {
        let optValId = genId("optval")
        await pg.raw(
          `INSERT INTO product_option_value (id, option_id, value, created_at, updated_at)
           VALUES (?, ?, ?, NOW(), NOW())
           ON CONFLICT DO NOTHING`,
          [optValId, optId, optVal]
        )
        const valRes = await pg.raw(
          `SELECT id FROM product_option_value WHERE option_id = ? AND value = ? AND deleted_at IS NULL LIMIT 1`,
          [optId, optVal]
        )
        if (valRes.rows?.length > 0) {
          optValId = valRes.rows[0].id
        }
        optionValueIdMap.set(`${optTitle}:::${optVal}`, optValId)
      }
    }
  } else if (variantAmbiguous.some(Boolean)) {
    console.warn(
      `[Odoo Webhook] Skipping product_option sync for product "${p.name}" (odoo_id=${p.odoo_id}): ` +
      `no variant in this payload had usable per-variant attributes. Existing option data, if any, is left untouched.`
    )
  }

  // 3. Process variants
  const activeVariantIds: string[] = []

  for (let idx = 0; idx < rawVariants.length; idx++) {
    const v = rawVariants[idx]
    const varOdooId = v.variant_id || p.odoo_id
    const varSku = (v.sku || v.default_code || (rawVariants.length === 1 ? templateSku : `${templateSku}-v${varOdooId}`)).trim()

    const rawBarcode = v.barcode || p.barcode || null
    const varBarcode = rawBarcode
      ? rawBarcode.replace(/^\(.*?\):\s*/i, "").trim() || rawBarcode
      : null

    const varPriceRaw = v.price ?? v.marka_price ?? v.lst_price ?? p.marka_price ?? p.list_price ?? 0
    const varPrice = Math.round(varPriceRaw * KWD_FILS_DIVISOR)
    const varQty = v.free_qty ?? 0
    const varExpoTemplateId = v.oskar_expo_template_id || false
    // Reuse the value already resolved (and logged) in step 2 — avoids double-warning per variant.
    const vAttrs = resolvedVariantAttrs[idx]
    const isAmbiguous = variantAmbiguous[idx]

    // Safe fallback title — NEVER the product/template name (that's what caused a broken
    // sync to show every variant labeled with the product's own name, e.g. "Apple 19").
    const safeFallbackTitle = rawVariants.length > 1 ? `Variant ${varOdooId}` : "Default"

    let varTitle = safeFallbackTitle
    if (!isAmbiguous) {
      const attrValues = Object.values(vAttrs).filter(Boolean)
      if (attrValues.length > 0) {
        varTitle = attrValues.join(" / ")
      } else if (v.name) {
        varTitle = v.name
      }
    }
    // Ambiguous-attribute case is resolved below, once we know whether the variant already
    // exists — an existing "real" title is preserved rather than downgraded to the fallback.

    const varMetadata: Record<string, any> = {
      odoo_variant_id: varOdooId,
      odoo_template_id: p.odoo_id,
      oskar_expo_template_id: varExpoTemplateId,
      attributes: vAttrs,
      free_qty: varQty,
      synced_at: new Date().toISOString(),
    }

    let varRes = await pg.raw(
      `SELECT id, title FROM product_variant WHERE product_id = ? AND metadata->>'odoo_variant_id' = ? AND deleted_at IS NULL LIMIT 1`,
      [prodId, String(varOdooId)]
    )

    if (!varRes.rows?.length && varSku) {
      varRes = await pg.raw(
        `SELECT id, title FROM product_variant WHERE sku = ? AND deleted_at IS NULL LIMIT 1`,
        [varSku]
      )
    }

    if (!varRes.rows?.length && rawVariants.length === 1) {
      varRes = await pg.raw(
        `SELECT id, title FROM product_variant WHERE product_id = ? AND deleted_at IS NULL LIMIT 1`,
        [prodId]
      )
    }

    // Ambiguous attributes must never downgrade an existing (possibly already-correct)
    // title — only apply the safe fallback when the variant row is being created fresh.
    if (isAmbiguous && varRes.rows?.length > 0) {
      varTitle = varRes.rows[0].title
    }

    let vid: string
    let safeVarBarcode: string | null = null
    if (typeof varBarcode === 'string' && varBarcode.trim() !== '' && varBarcode !== 'false') {
      const candidate = varBarcode.trim()
      const existingBc = await pg.raw(
        `SELECT id FROM product_variant WHERE barcode = ? AND deleted_at IS NULL LIMIT 1`,
        [candidate]
      )
      // Only set barcode if not used by any variant, or if used by this exact variant
      if (!existingBc.rows?.length || (varRes.rows?.length > 0 && existingBc.rows[0].id === varRes.rows[0].id)) {
        safeVarBarcode = candidate
      }
    }

    if (varRes.rows?.length > 0) {
      vid = varRes.rows[0].id
      await pg.raw(
        `UPDATE product_variant 
         SET product_id = ?, title = ?, sku = ?, barcode = COALESCE(?, barcode), metadata = ?, allow_backorder = true, variant_rank = ?, updated_at = NOW() 
         WHERE id = ?`,
        [prodId, varTitle, varSku, safeVarBarcode, JSON.stringify(varMetadata), idx, vid]
      )
    } else {
      vid = genId("variant")
      await pg.raw(
        `INSERT INTO product_variant (id, product_id, title, sku, barcode, manage_inventory, allow_backorder, variant_rank, metadata, created_at, updated_at) 
         VALUES (?, ?, ?, ?, ?, true, true, ?, ?, NOW(), NOW())`,
        [vid, prodId, varTitle, varSku, safeVarBarcode, idx, JSON.stringify(varMetadata)]
      )
    }

    activeVariantIds.push(vid)

    // Price Sync
    let psId: string | null = null
    const psRes = await pg.raw(
      `SELECT price_set_id FROM product_variant_price_set WHERE variant_id = ? LIMIT 1`,
      [vid]
    )
    if (psRes.rows?.length > 0) {
      psId = psRes.rows[0].price_set_id
    } else {
      psId = genId("pset")
      await pg.raw(`INSERT INTO price_set (id, created_at, updated_at) VALUES (?, NOW(), NOW())`, [psId])
      await pg.raw(
        `INSERT INTO product_variant_price_set (id, variant_id, price_set_id, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())`,
        [genId("pvps"), vid, psId]
      )
    }

    if (psId && varPrice >= 0) {
      const rawAmount = JSON.stringify({ value: String(varPrice), precision: 20 })
      const existsKwd = await pg.raw(
        `SELECT id FROM price WHERE price_set_id = ? AND currency_code = 'kwd' AND deleted_at IS NULL LIMIT 1`,
        [psId]
      )
      if (existsKwd.rows?.length === 0) {
        await pg.raw(
          `INSERT INTO price (id, price_set_id, currency_code, amount, raw_amount, rules_count, created_at, updated_at) 
           VALUES (?, ?, 'kwd', ?, ?, 0, NOW(), NOW())`,
          [genId("price"), psId, varPrice, rawAmount]
        )
      } else {
        await pg.raw(
          `UPDATE price SET amount = ?, raw_amount = ?, updated_at = NOW() WHERE price_set_id = ? AND currency_code = 'kwd' AND deleted_at IS NULL`,
          [varPrice, rawAmount, psId]
        )
      }
    }

    // Inventory Sync
    try {
      let invItemId: string | null = null
      const invItemRes = await pg.raw(`SELECT id FROM inventory_item WHERE sku = ? LIMIT 1`, [varSku])

      if (invItemRes.rows?.length > 0) {
        invItemId = invItemRes.rows[0].id
        const invLvlRes = await pg.raw(`SELECT id FROM inventory_level WHERE inventory_item_id = ? LIMIT 1`, [invItemId])
        if (invLvlRes.rows?.length > 0) {
          await pg.raw(
            `UPDATE inventory_level SET stocked_quantity = ?, updated_at = NOW() WHERE id = ?`,
            [varQty, invLvlRes.rows[0].id]
          )
        } else {
          const locRes = await pg.raw(`SELECT id FROM stock_location LIMIT 1`)
          if (locRes.rows?.length > 0) {
            await pg.raw(
              `INSERT INTO inventory_level (id, inventory_item_id, location_id, stocked_quantity, reserved_quantity, incoming_quantity, created_at, updated_at) 
               VALUES (?, ?, ?, ?, 0, 0, NOW(), NOW())`,
              [genId("iloc"), invItemId, locRes.rows[0].id, varQty]
            )
          }
        }
      } else {
        invItemId = genId("iitem")
        await pg.raw(
          `INSERT INTO inventory_item (id, sku, title, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())`,
          [invItemId, varSku, `${p.name} - ${varTitle}`]
        )
        const locRes = await pg.raw(`SELECT id FROM stock_location LIMIT 1`)
        if (locRes.rows?.length > 0) {
          await pg.raw(
            `INSERT INTO inventory_level (id, inventory_item_id, location_id, stocked_quantity, reserved_quantity, incoming_quantity, created_at, updated_at) 
             VALUES (?, ?, ?, ?, 0, 0, NOW(), NOW())`,
            [genId("iloc"), invItemId, locRes.rows[0].id, varQty]
          )
        }
      }

      if (invItemId) {
        const linkRes = await pg.raw(
          `SELECT id FROM product_variant_inventory_item WHERE variant_id = ? AND inventory_item_id = ? LIMIT 1`,
          [vid, invItemId]
        )
        if (linkRes.rows?.length === 0) {
          await pg.raw(`DELETE FROM product_variant_inventory_item WHERE variant_id = ?`, [vid])
          await pg.raw(
            `INSERT INTO product_variant_inventory_item (id, variant_id, inventory_item_id, required_quantity, created_at, updated_at) 
             VALUES (?, ?, ?, 1, NOW(), NOW())`,
            [genId("pvitem"), vid, invItemId]
          )
        }
      }
    } catch (err) {
      console.warn(`[Odoo Webhook] Inventory sync failed for variant ${varSku}: ${err}`)
    }

    // Option Values Link — skipped entirely for ambiguous attributes so a bad sync can
    // never wipe out or corrupt existing (possibly manually-fixed) variant/option links.
    if (isAmbiguous) {
      console.warn(
        `[Odoo Webhook] Skipping option-value link for variant ${vid} (sku=${varSku}, odoo_variant_id=${varOdooId}) ` +
        `of product "${p.name}": attributes were ambiguous. Existing links, if any, are left untouched.`
      )
    } else {
      try {
        await pg.raw(`DELETE FROM product_variant_option WHERE variant_id = ?`, [vid])

        for (const [optKey, optVal] of Object.entries(vAttrs)) {
          if (!optKey || !optVal) continue
          const optValId = optionValueIdMap.get(`${optKey}:::${String(optVal).trim()}`)
          if (optValId) {
            await pg.raw(
              `INSERT INTO product_variant_option (variant_id, option_value_id)
               VALUES (?, ?)
               ON CONFLICT DO NOTHING`,
              [vid, optValId]
            )
          }
        }
      } catch (err) {
        console.warn(`[Odoo Webhook] Variant option value link failed for variant ${vid}: ${err}`)
      }
    }
  }

  // 4. Soft delete old variants of this product that are no longer present in Odoo
  if (activeVariantIds.length > 0) {
    try {
      const placeholders = activeVariantIds.map(() => "?").join(",")
      await pg.raw(
        `UPDATE product_variant SET deleted_at = NOW() WHERE product_id = ? AND id NOT IN (${placeholders}) AND deleted_at IS NULL`,
        [prodId, ...activeVariantIds]
      )
    } catch (err) {
      console.warn(`[Odoo Webhook] Stale variant cleanup failed for product ${prodId}: ${err}`)
    }
  }

  console.log(`[Odoo Webhook] Synced ${activeVariantIds.length} variant(s) and ${Object.keys(optionValuesMap).length} option(s) for product ${prodId}`)
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
  const rawPrice = p.marka_price || 0
  const price = Math.round(rawPrice * KWD_FILS_DIVISOR)
  const description = p.description_sale || p.description || ""
  const weight = p.weight ? String(p.weight) : null
  const isPubFlag = p.is_published === true || p.website_published === true || p.published === true || p.x_studio_published === true || String(p.is_published) === "true" || String(p.website_published) === "true"
  const status = isPubFlag ? "published" : "draft"

  const rawBarcode = p.barcode || null
  const barcode = rawBarcode
    ? rawBarcode.replace(/^\(.*?\):\s*/i, "").trim() || rawBarcode
    : null

  const brand = (p.custom_brand_id && Array.isArray(p.custom_brand_id) ? p.custom_brand_id[1] : null)
    || p.brand
    || null

  const brandLogoUrl = p.brand_image_url
    || p.brand_logo_url
    || (p.custom_brand_id && Array.isArray(p.custom_brand_id)
      ? `${ODOO_BASE_URL}/api/brand/image/${p.custom_brand_id[0]}`
      : null)

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
  const category = categoryForMapping
    || (p.categ_id && Array.isArray(p.categ_id) ? p.categ_id[1] : null)

  let attributes: Record<string, string> = resolveAttributesMap(
    p.attributes,
    `product "${p.name}" (odoo_id=${p.odoo_id}) template-level attributes`,
    true
  )
  if (Object.keys(attributes).length === 0 && p.attribute_line_ids) {
    if (Array.isArray(p.attribute_line_ids)) {
      for (const line of p.attribute_line_ids as Array<{name: string; values: string[]}>) {
        if (line.name && Array.isArray(line.values) && line.values.length > 0) {
          attributes[line.name] = line.values.join(", ")
        }
      }
    } else if (typeof p.attribute_line_ids === 'object') {
      attributes = p.attribute_line_ids as Record<string, string>
    }
  }

  const alternativeIds = Array.isArray(p.alternative_odoo_ids) ? p.alternative_odoo_ids
    : Array.isArray(p.alternative_product_ids) ? p.alternative_product_ids : []
  const accessoryIds = Array.isArray(p.accessory_odoo_ids) ? p.accessory_odoo_ids
    : Array.isArray(p.accessory_product_ids) ? p.accessory_product_ids : []
  const upsellIds = Array.isArray(p.upsell_odoo_ids) ? p.upsell_odoo_ids
    : Array.isArray(p.optional_product_ids) ? p.optional_product_ids : []

  const ecommerceDesc = p.description_ecommerce || p.ecommerce_description || ''

  // Total stock calculation across variants if variants array provided
  const rawVarList = (p.variants && Array.isArray(p.variants) && p.variants.length > 0) ? p.variants : []
  const totalVariantsQty = rawVarList.reduce((sum, v) => sum + (v.free_qty || 0), 0)
  const totalQty = (p.free_qty !== undefined && p.free_qty !== null && p.free_qty !== 0)
    ? p.free_qty
    : (rawVarList.length > 0 ? totalVariantsQty : (p.free_qty || 0))

  const metadata: Record<string, any> = {
    odoo_id: odooId,
    odoo_sku: sku,
    odoo_barcode: barcode,
    odoo_category: category,
    odoo_brand: brand,
    odoo_qty: totalQty,
    odoo_stock: totalQty,
    oskar_expo_template_id: p.oskar_expo_template_id || false,
    variants_count: rawVarList.length || 1,
    synced_at: new Date().toISOString(),
    list_price: p.list_price || 0,
    retail_price: p.retail_price || 0,
    compare_price: p.compare_list_price || 0,
    marka_price: p.marka_price || 0,
    brand: brand,
    brand_logo_url: brandLogoUrl,
    title_ar: p.arabic_name || null,
    description_ar: p.arabic_description || null,
    ecommerce_description: ecommerceDesc,
    medusa_description: p.medusa_description || null,
    medusa_overview: p.medusa_overview || null,
    sub_category: p.x_studio_sub_category || null,
    public_categ_ids: p.public_categ_ids || null,
    forecasted_qty: p.virtual_available || 0,
    volume: p.volume || null,
    hs_code: p.hs_code || null,
    country_of_origin: p.country_of_origin || null,
    is_new: p.is_new === true,
    warranty: p.warranty || '1 Year Warranty',
    seo_title: p.website_meta_title || p.seo_title || null,
    seo_description: p.website_meta_description || p.seo_description || null,
    night_delivery: p.night_delivery === true,
    fast_delivery_areas: Array.isArray(p.fast_delivery_areas) ? p.fast_delivery_areas : [],
    alternative_odoo_ids: alternativeIds,
    upsell_odoo_ids: upsellIds,
    accessory_odoo_ids: accessoryIds,
    attributes: attributes,
    features: Array.isArray(p.features) ? p.features : [],
    specifications: Array.isArray(p.specifications) ? p.specifications : [],
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

  let prodId: string
  let action: string

  if (existBySku.rows?.length > 0) {
    prodId = existBySku.rows[0].id
    action = "updated"
    await pg.raw(
      `UPDATE product SET title=?, description=?, weight=?, metadata=?, status=?, thumbnail=COALESCE(?, thumbnail), updated_at=NOW() WHERE id=?`,
      [title, description, weight, JSON.stringify(metadata), status, p.image_url || null, prodId]
    )
  } else {
    let handle = slugify(title)
    if (!handle) handle = `odoo-${odooId}`
    if (existingHandles.has(handle)) handle = `${handle}-${odooId}`
    if (existingHandles.has(handle)) handle = `${handle}-${Date.now().toString(36)}`
    existingHandles.add(handle)

    let thumbnail: string | null = p.image_url || null
    if (!thumbnail && (p.image_1920 || p.odoo_id)) {
      thumbnail = getOdooImageUrl(odooId)
    }

    prodId = genId("prod")
    action = "created"
    await pg.raw(
      `INSERT INTO product (id, title, handle, subtitle, description, thumbnail, status, weight, metadata, discountable, is_giftcard, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, true, false, NOW(), NOW())`,
      [prodId, title, handle, brand || "", description, thumbnail, status, weight, JSON.stringify(metadata)]
    )

    if (salesChannelId) {
      try {
        await pg.raw(
          `INSERT INTO product_sales_channel (id, product_id, sales_channel_id, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW()) ON CONFLICT (product_id, sales_channel_id) DO NOTHING`,
          [genId("psc"), prodId, salesChannelId]
        )
      } catch { /* ignore */ }
    }

    try {
      const spRes = await pg.raw(`SELECT id FROM shipping_profile WHERE type = 'default' AND deleted_at IS NULL LIMIT 1`)
      if (spRes.rows?.length > 0) {
        const spId = spRes.rows[0].id
        await pg.raw(
          `INSERT INTO product_shipping_profile (id, product_id, shipping_profile_id, created_at, updated_at)
           VALUES (?, ?, ?, NOW(), NOW())
           ON CONFLICT (product_id, shipping_profile_id) DO NOTHING`,
          ['sprod_' + prodId.replace('prod_', '').substring(0, 26), prodId, spId]
        )
      }
    } catch (spErr) {
      console.warn(`[Odoo Webhook] Shipping profile link failed for ${prodId}: ${spErr}`)
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // IMAGE SYNC
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (p.images && Array.isArray(p.images) && p.images.length > 0) {
    try {
      await pg.raw(`DELETE FROM image WHERE product_id = ?`, [prodId])
      for (let idx = 0; idx < p.images.length; idx++) {
        const imgUrl = p.images[idx]
        if (!imgUrl) continue
        await pg.raw(
          `INSERT INTO image (id, url, rank, product_id, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())`,
          [genId("img"), imgUrl, idx, prodId]
        )
      }
      await pg.raw(
        `UPDATE product SET thumbnail = ?, updated_at = NOW() WHERE id = ?`,
        [p.images[0], prodId]
      )
      console.log(`[Odoo Webhook] Updated ${p.images.length} image(s) for product ${prodId}`)
    } catch (imgErr) {
      console.warn(`[Odoo Webhook] Image sync failed for ${prodId}: ${imgErr}`)
    }
  } else if (p.image_url) {
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
  // BRAND SYNC
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const brandName = (Array.isArray(p.brand_id) ? p.brand_id[1] : null) || (Array.isArray(p.custom_brand_id) ? p.custom_brand_id[1] : null) || p.brand || p.x_studio_brand_1 || null;
  const brandOdooId = (Array.isArray(p.custom_brand_id) ? p.custom_brand_id[0] : null) || (Array.isArray(p.brand_id) ? p.brand_id[0] : null) || null;
  const brandImageUrl = brandOdooId
    ? `${ODOO_BASE_URL}/api/brand/image/${brandOdooId}`
    : null;

  if (brandName && typeof brandName === "string") {
    try {
      const brandSlug = brandName.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").substring(0, 100);
      const existingBrand = await pg.raw(
        `SELECT id, logo_url FROM brand WHERE slug = ? AND deleted_at IS NULL LIMIT 1`,
        [brandSlug]
      );
      let brandId: string;
      if (existingBrand.rows?.length > 0) {
        brandId = existingBrand.rows[0].id;
        const existingLogo = existingBrand.rows[0].logo_url;
        if (brandImageUrl && (existingLogo !== brandImageUrl)) {
          await pg.raw(
            `UPDATE brand SET logo_url = ?, updated_at = NOW() WHERE id = ?`,
            [brandImageUrl, brandId]
          );
        }
      } else {
        brandId = `brand_${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
        await pg.raw(
          `INSERT INTO brand (id, name, slug, is_active, is_special, logo_url, created_at, updated_at) VALUES (?, ?, ?, true, true, ?, NOW(), NOW())`,
          [brandId, brandName, brandSlug, brandImageUrl]
        );
      }
      const existingLink = await pg.raw(
        `SELECT id FROM product_brand WHERE product_id = ? AND brand_id = ? AND deleted_at IS NULL LIMIT 1`,
        [prodId, brandId]
      );
      if (!existingLink.rows?.length) {
        await pg.raw(
          `INSERT INTO product_brand (id, product_id, brand_id, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())`,
          [`pbr_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 8)}`, prodId, brandId]
        );
      }
    } catch (brandErr: any) {
      console.warn(`[Odoo Webhook] Brand sync failed for ${title}: ${brandErr.message}`);
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // VARIANTS, PRICES, INVENTORY & OPTIONS SYNC
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  await syncProductVariantsAndOptions(pg, prodId, p, sku, attributes)

  return { action, productId: prodId }
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
    } else if (body.id || body.odoo_id || body.product_id || body.name || body.default_code || body.barcode) {
      // Odoo sends fields at root level — wrap into expected shape
      event_type = "product.created"
      if (!body.product) {
        body.product = { ...body }
        body.product.odoo_id = body.product.odoo_id || body.product.id || body.product.product_id || body.product.template_id
      }
    } else if (body.product?.id || body.product?.odoo_id || body.product?.product_id) {
      event_type = "product.created"
      if (!body.product.odoo_id) body.product.odoo_id = body.product.id || body.product.product_id || body.product.template_id
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
    if (event_type === "product.updated" || event_type === "product.created") {
      const p = body.product || body
      console.log(`[Odoo Webhook] Full Payload for ${p.name || 'product'}:`, JSON.stringify(p, null, 2))
      if (!p?.odoo_id || !p?.name) {
        return res.status(400).json({ message: "product.odoo_id and product.name are required" })
      }
      const result = await upsertProduct(pg, p, salesChannelId, existingHandles, categoryByHandle)
      console.log(`[Odoo Webhook] ${result.action}: ${p.name} -> ${result.productId}`)
      return res.json({ status: "success", ...result, odoo_id: p.odoo_id, product_name: p.name })
    }

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
