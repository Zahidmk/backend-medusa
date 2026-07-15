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
const ODOO_BASE_URL = process.env.ODOO_URL || "https://oskarllc-new-27289548.dev.odoo.com"

// ── Odoo JSON-RPC credentials (for auto-fetching attributes when webhook sends empty) ──
// IMPORTANT: For JSON-RPC authentication, Odoo requires the API key (not the user password).
const ODOO_DB = process.env.ODOO_DB_NAME || "oskarllc-new-27289548"
const ODOO_USER = process.env.ODOO_USERNAME || "SYG"
const ODOO_PASS = process.env.ODOO_API_KEY || process.env.ODOO_PASSWORD || "fa8410bdf3264b91ea393b9f8341626a98ca262a"
let _odooUid: number | null = null

/**
 * Lightweight Odoo JSON-RPC call — no external library needed.
 * Uses Node's built-in fetch (available in Node 18+).
 */
async function odooRpc(service: string, method: string, args: any[]): Promise<any> {
  const res = await fetch(`${ODOO_BASE_URL}/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "call",
      params: { service, method, args },
      id: Date.now(),
    }),
  })
  const json = await res.json() as any
  if (json.error) throw new Error(json.error.message || json.error.data?.message || "Odoo RPC error")
  return json.result
}

async function odooAuth(): Promise<number> {
  if (_odooUid) return _odooUid
  const uid = await odooRpc("common", "authenticate", [ODOO_DB, ODOO_USER, ODOO_PASS, {}])
  if (!uid || typeof uid !== "number") {
    console.warn(`[Odoo Webhook] Odoo auth failed — db=${ODOO_DB}, user=${ODOO_USER}, pass=${ODOO_PASS ? ODOO_PASS.substring(0, 6) + "..." : "EMPTY"}, result=${uid}`)
    throw new Error("Odoo auth failed")
  }
  console.log(`[Odoo Webhook] Odoo API authenticated, UID=${uid}`)
  _odooUid = uid
  return uid
}

async function odooRead(model: string, ids: number[], fields: string[]): Promise<any[]> {
  if (ids.length === 0) return []
  const uid = await odooAuth()
  return odooRpc("object", "execute_kw", [ODOO_DB, uid, ODOO_PASS, model, "read", [ids], { fields }])
}

async function odooSearchRead(model: string, domain: any[], fields: string[], limit = 100): Promise<any[]> {
  const uid = await odooAuth()
  return odooRpc("object", "execute_kw", [ODOO_DB, uid, ODOO_PASS, model, "search_read", [domain], { fields, limit }])
}

/**
 * Fetch product attributes directly from Odoo API.
 * Called when webhook doesn't include attributes (common with basic Odoo webhooks).
 * 
 * Flow:
 *   1. Read product.template to get attribute_line_ids
 *   2. Read product.template.attribute.line to get attribute_id + value_ids
 *   3. Read product.attribute.value to get actual value names
 * 
 * Returns: { "Color": "Black", "Storage": "128GB, 256GB" } or empty {} on failure
 */
async function fetchAttributesFromOdoo(odooProductId: number): Promise<Record<string, string>> {
  try {
    // Step 1: Get the template — odoo_id from webhook could be product.template or product.product
    // Try product.template first
    let templates = await odooRead("product.template", [odooProductId], ["attribute_line_ids"])
    if (!templates?.length || !templates[0].attribute_line_ids?.length) {
      // Maybe it's a product.product ID — look up the template
      const variants = await odooRead("product.product", [odooProductId], ["product_tmpl_id"])
      if (variants?.length && variants[0].product_tmpl_id) {
        const tmplId = Array.isArray(variants[0].product_tmpl_id) ? variants[0].product_tmpl_id[0] : variants[0].product_tmpl_id
        templates = await odooRead("product.template", [tmplId], ["attribute_line_ids"])
      }
    }

    if (!templates?.length || !templates[0].attribute_line_ids?.length) {
      return {} // Product genuinely has no attributes in Odoo
    }

    // Step 2: Read attribute lines
    const lineIds: number[] = templates[0].attribute_line_ids
    const lines = await odooRead("product.template.attribute.line", lineIds, ["attribute_id", "value_ids"])
    if (!lines?.length) return {}

    // Step 3: Collect all value IDs and fetch them in one call
    const allValueIds: number[] = lines.flatMap((l: any) => l.value_ids || [])
    const values = await odooRead("product.attribute.value", allValueIds, ["id", "name", "attribute_id"])
    const valueMap = new Map<number, string>()
    for (const v of values || []) {
      valueMap.set(v.id, v.name)
    }

    // Step 4: Build the attributes dict
    const attrs: Record<string, string> = {}
    for (const line of lines) {
      const attrName = Array.isArray(line.attribute_id) ? line.attribute_id[1] : String(line.attribute_id)
      const valueNames = (line.value_ids || []).map((vid: number) => valueMap.get(vid)).filter(Boolean)
      if (attrName && valueNames.length > 0) {
        attrs[attrName] = valueNames.join(", ")
      }
    }

    if (Object.keys(attrs).length > 0) {
      console.log(`[Odoo Webhook] Fetched ${Object.keys(attrs).length} attribute(s) from Odoo API for template ${odooProductId}: ${JSON.stringify(attrs)}`)
    }
    return attrs
  } catch (err) {
    console.warn(`[Odoo Webhook] Failed to fetch attributes from Odoo API for ${odooProductId}: ${err}`)
    return {}
  }
}

/**
 * Fetch comparison/cross-sell product IDs directly from Odoo API.
 * Called when webhook doesn't include alternative_product_ids, optional_product_ids, accessory_product_ids.
 *
 * Returns: { alternativeIds: number[], upsellIds: number[], accessoryIds: number[] }
 */
async function fetchComparisonFromOdoo(odooProductId: number): Promise<{
  alternativeIds: number[]
  upsellIds: number[]
  accessoryIds: number[]
}> {
  const empty = { alternativeIds: [], upsellIds: [], accessoryIds: [] }
  try {
    // Try product.template first
    let result = await odooRead("product.template", [odooProductId], [
      "alternative_product_ids", "optional_product_ids", "accessory_product_ids"
    ])

    if (!result?.length) {
      // Maybe it's a product.product ID — look up the template
      const variants = await odooRead("product.product", [odooProductId], ["product_tmpl_id"])
      if (variants?.length && variants[0].product_tmpl_id) {
        const tmplId = Array.isArray(variants[0].product_tmpl_id) ? variants[0].product_tmpl_id[0] : variants[0].product_tmpl_id
        result = await odooRead("product.template", [tmplId], [
          "alternative_product_ids", "optional_product_ids", "accessory_product_ids"
        ])
      }
    }

    if (!result?.length) return empty

    const r = result[0]
    const alternativeIds = Array.isArray(r.alternative_product_ids) ? r.alternative_product_ids : []
    const upsellIds = Array.isArray(r.optional_product_ids) ? r.optional_product_ids : []
    const accessoryIds = Array.isArray(r.accessory_product_ids) ? r.accessory_product_ids : []

    const total = alternativeIds.length + upsellIds.length + accessoryIds.length
    if (total > 0) {
      console.log(`[Odoo Webhook] Fetched comparison IDs from Odoo API for ${odooProductId}: alt=${JSON.stringify(alternativeIds)}, upsell=${JSON.stringify(upsellIds)}, accessory=${JSON.stringify(accessoryIds)}`)
    }

    return { alternativeIds, upsellIds, accessoryIds }
  } catch (err) {
    console.warn(`[Odoo Webhook] Failed to fetch comparison IDs from Odoo API for ${odooProductId}: ${err}`)
    return empty
  }
}

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
/**
 * Maps an Odoo category path to a Medusa category handle.
 * 
 * FULLY DYNAMIC — no hardcoded keyword map.
 * Takes the LAST part of the Odoo category path, slugifies it,
 * and returns it as the handle. ensureCategory() will auto-create
 * any category that doesn't exist yet.
 *
 * Examples:
 *   "Gaming / Monitor"                          → "monitor"
 *   "Mobile / Tablet / Powerbanks / Magsafe"    → "magsafe"
 *   "Electronics / Audio / Headphones"           → "headphones"
 *   "Mobile/Tablet / Cables & Chargers / Chargers/Universal Adapter" → "universal-adapter"
 */
function odooCategoryToHandle(odooCategory: string | null): string | null {
  if (!odooCategory) return null

  const parts = odooCategory
    .split("/")
    .map(p => p.trim())
    .filter(p => p.length > 0)

  // Use the LAST part (most specific category)
  const lastPart = parts.length > 0 ? parts[parts.length - 1] : null
  if (!lastPart) return null

  // Slugify: lowercase, replace non-alphanumeric with hyphens, trim hyphens
  return lastPart
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    || null
}

/**
 * Extract the full category hierarchy from an Odoo category path.
 * Returns array of { handle, name } from root → leaf.
 * 
 * Example: "Mobile / Tablet / Cables & Chargers / Chargers / Universal Adapter"
 * Returns:
 *   [
 *     { handle: "mobile", name: "Mobile" },
 *     { handle: "tablet", name: "Tablet" },
 *     { handle: "cables-chargers", name: "Cables & Chargers" },
 *     { handle: "chargers", name: "Chargers" },
 *     { handle: "universal-adapter", name: "Universal Adapter" },
 *   ]
 */
function odooCategoryHierarchy(odooCategory: string | null): Array<{ handle: string; name: string }> {
  if (!odooCategory) return []

  return odooCategory
    .split("/")
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .map(name => ({
      name,
      handle: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
    }))
    .filter(c => c.handle.length > 0)
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
  retail_price?: number              // RRP / recommended retail price
  currency_code?: string
  currency_id?: [number, string] | string  // Odoo format: [2, "AED"] or "AED"
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
  // ── Category image (Odoo developer sends this alongside product data) ─────
  // When provided, this URL is written to product_category.metadata.image_url
  // for every category this product belongs to.
  // Field name: category_image_url
  category_image_url?: string        // direct URL to the category cover image
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
 * Ensure a brand exists in the brand table, creating/updating it if necessary.
 * Also links the product to the brand via product_brand table.
 * This enables automatic brand creation from Odoo webhook data.
 */
async function ensureBrand(
  pg: any,
  brandName: string,
  brandLogoUrl: string | null,
  productId: string
): Promise<void> {
  if (!brandName) return

  try {
    const slug = brandName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")

    // Check if brand already exists (using WHERE deleted_at IS NULL to match partial index)
    const existingBrand = await pg.raw(
      `SELECT id FROM brand WHERE slug = ? AND deleted_at IS NULL LIMIT 1`,
      [slug]
    )

    let brandId: string
    if (existingBrand.rows?.length > 0) {
      brandId = existingBrand.rows[0].id
      // Update logo if we have one
      if (brandLogoUrl) {
        await pg.raw(
          `UPDATE brand SET logo_url = ?, updated_at = NOW() WHERE id = ?`,
          [brandLogoUrl, brandId]
        )
      }
    } else {
      // Insert new brand — no ON CONFLICT because partial index can't be targeted that way
      brandId = genId("brand")
      try {
        await pg.raw(
          `INSERT INTO brand (id, name, slug, logo_url, is_active, is_special, display_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, true, false, 0, NOW(), NOW())`,
          [brandId, brandName, slug, brandLogoUrl || null]
        )
        console.log(`[Odoo Webhook] Auto-created brand: ${brandName} (${slug})`)
      } catch (insertErr: any) {
        // Race condition / duplicate — re-fetch
        const refetch = await pg.raw(
          `SELECT id FROM brand WHERE slug = ? AND deleted_at IS NULL LIMIT 1`,
          [slug]
        )
        if (refetch.rows?.length > 0) {
          brandId = refetch.rows[0].id
        } else {
          console.warn(`[Odoo Webhook] Brand insert failed and not found: ${insertErr.message}`)
          return
        }
      }
    }

    // Link product → brand — check first to avoid duplicate
    const existingLink = await pg.raw(
      `SELECT id FROM product_brand WHERE product_id = ? AND brand_id = ? AND deleted_at IS NULL LIMIT 1`,
      [productId, brandId]
    )
    if (!existingLink.rows?.length) {
      await pg.raw(
        `INSERT INTO product_brand (id, product_id, brand_id, created_at, updated_at)
         VALUES (?, ?, ?, NOW(), NOW())`,
        [genId("pbrand"), productId, brandId]
      )
    }
  } catch (err) {
    console.warn(`[Odoo Webhook] Brand sync failed for "${brandName}": ${err}`)
  }
}

/**
 * Sync a category image URL sent by Odoo into product_category.metadata.image_url.
 *
 * Called on every product CREATE and UPDATE whenever the webhook payload contains
 * a non-empty `category_image_url` field. It updates ALL categories that match the
 * resolved handle so parent + child categories can each have their own image.
 *
 * The Odoo developer should include this field in the webhook payload:
 *   "category_image_url": "https://oskarllc-new-27289548.dev.odoo.com/web/image/..."
 *
 * This writes the URL into JSONB metadata using jsonb_set so it merges cleanly
 * without overwriting other metadata fields (e.g. home_order, home_enabled).
 */
async function syncCategoryImage(
  pg: any,
  categoryHandle: string,
  categoryImageUrl: string
): Promise<void> {
  if (!categoryHandle || !categoryImageUrl) return
  try {
    const result = await pg.raw(
      `UPDATE product_category
       SET metadata = jsonb_set(
         COALESCE(metadata, '{}'::jsonb),
         '{image_url}',
         to_jsonb(?::text)
       ),
       updated_at = NOW()
       WHERE handle = ? AND deleted_at IS NULL`,
      [categoryImageUrl, categoryHandle]
    )
    const rowsUpdated = result.rowCount ?? result.rows?.length ?? 0
    if (rowsUpdated > 0) {
      console.log(`[Odoo Webhook] Category image synced: handle=${categoryHandle} url=${categoryImageUrl}`)
    } else {
      console.warn(`[Odoo Webhook] Category image: no category found with handle=${categoryHandle}`)
    }
  } catch (err) {
    console.warn(`[Odoo Webhook] Category image sync failed for handle=${categoryHandle}: ${err}`)
  }
}

/**
 * Sync product options/attributes to product_option + product_option_value tables.
 * Runs on both CREATE and UPDATE so attributes always stay in sync.
 */
async function syncProductOptions(
  pg: any,
  productId: string,
  variantId: string,
  attributes: Record<string, string>,
  sku: string
): Promise<void> {
  if (Object.keys(attributes).length === 0) return
  try {
    let optionRank = 0
    for (const [attrName, attrValue] of Object.entries(attributes)) {
      // Check if option already exists (partial unique index: product_id + title WHERE deleted_at IS NULL)
      const existOpt = await pg.raw(
        `SELECT id FROM product_option WHERE product_id = ? AND title = ? AND deleted_at IS NULL LIMIT 1`,
        [productId, attrName]
      )
      let realOptId: string
      if (existOpt.rows?.length > 0) {
        realOptId = existOpt.rows[0].id
      } else {
        const optionId = genId("opt")
        try {
          await pg.raw(
            `INSERT INTO product_option (id, product_id, title, created_at, updated_at)
             VALUES (?, ?, ?, NOW(), NOW())`,
            [optionId, productId, attrName]
          )
          realOptId = optionId
        } catch (_) {
          // Re-fetch on race condition
          const re = await pg.raw(
            `SELECT id FROM product_option WHERE product_id = ? AND title = ? AND deleted_at IS NULL LIMIT 1`,
            [productId, attrName]
          )
          if (!re.rows?.length) { optionRank++; continue }
          realOptId = re.rows[0].id
        }
      }
      optionRank++

      // Insert each value (comma-separated support)
      const values = attrValue.split(",").map((v: string) => v.trim()).filter(Boolean)
      let valueRank = 0
      for (const val of values) {
        const existVal = await pg.raw(
          `SELECT id FROM product_option_value WHERE option_id = ? AND value = ? AND deleted_at IS NULL LIMIT 1`,
          [realOptId, val]
        )
        let ovId: string
        if (existVal.rows?.length > 0) {
          ovId = existVal.rows[0].id
        } else {
          ovId = genId("optval")
          try {
            await pg.raw(
              `INSERT INTO product_option_value (id, option_id, value, created_at, updated_at)
               VALUES (?, ?, ?, NOW(), NOW())`,
              [ovId, realOptId, val]
            )
          } catch (_) {
            const re = await pg.raw(
              `SELECT id FROM product_option_value WHERE option_id = ? AND value = ? AND deleted_at IS NULL LIMIT 1`,
              [realOptId, val]
            )
            if (re.rows?.length > 0) ovId = re.rows[0].id
          }
        }
        valueRank++

        // Link variant → option value (product_variant_option)
        if (variantId && ovId) {
          const existLink = await pg.raw(
            `SELECT variant_id FROM product_variant_option WHERE variant_id = ? AND option_value_id = ? LIMIT 1`,
            [variantId, ovId]
          )
          if (!existLink.rows?.length) {
            try {
              await pg.raw(
                `INSERT INTO product_variant_option (variant_id, option_value_id)
                 VALUES (?, ?)`,
                [variantId, ovId]
              )
            } catch (_) { /* ignore duplicate */ }
          }
        }
      }
    }
    console.log(`[Odoo Webhook] Synced ${Object.keys(attributes).length} option(s) for ${sku}`)
  } catch (err) {
    console.warn(`[Odoo Webhook] Option sync failed for ${sku}: ${err}`)
  }
}

/**
 * Ensure a category exists, creating it if necessary.
 * If imageUrl is provided, it is written into metadata.image_url on insert.
 * This enables automatic category creation from Odoo products.
 */
async function ensureCategory(
  pg: any,
  handle: string,
  name: string,
  categoryByHandle: Map<string, string>,
  imageUrl?: string | null
): Promise<string> {
  if (categoryByHandle.has(handle)) {
    return categoryByHandle.get(handle)!
  }
  
  try {
    const catId = genId("pcat")
    const initialMetadata = imageUrl ? JSON.stringify({ image_url: imageUrl }) : null
    await pg.raw(
      `INSERT INTO product_category (id, name, handle, is_active, rank, metadata, created_at, updated_at)
       VALUES (?, ?, ?, true, 0, ?::jsonb, NOW(), NOW())
       ON CONFLICT (handle) DO NOTHING`,
      [catId, name, handle, initialMetadata || '{}']
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

  // ── SKU: only accept real SKU codes, never descriptions ──────────────────
  // A real SKU is short (< 40 chars), no spaces/sentences.
  // If Odoo sends empty default_code or a description string, fallback to ODOO-{id}
  let sku = p.default_code?.trim() || ""
  if (!sku || sku.length > 40 || sku.includes(". ") || sku.split(" ").length > 5) {
    sku = `ODOO-${odooId}`
    if (p.default_code) {
      console.warn(`[Odoo Webhook] Rejected bad SKU for product ${odooId}: "${p.default_code}" → using ${sku}`)
    }
  }

  const title = p.name || `Odoo Product ${odooId}`

  // ── Currency & Price ─────────────────────────────────────────────────────
  const KWD_FILS_DIVISOR = 1000
  const rawPrice = p.retail_price || 0
  const price = Math.round(rawPrice * KWD_FILS_DIVISOR)

  const description = p.description_sale || p.description || ""
  const weight = p.weight ? String(p.weight) : null
  const status = p.is_published === false ? "draft" : "published"

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
  let odooCategoryId: number | null = null   // numeric Odoo category ID for auto-building image URL
  if (p.public_categ_ids) {
    if (typeof p.public_categ_ids === 'string') {
      categoryForMapping = p.public_categ_ids
    } else if (Array.isArray(p.public_categ_ids) && p.public_categ_ids.length > 0) {
      const first = p.public_categ_ids[0]
      if (typeof first === 'number') {
        // Odoo sent raw ID array e.g. [341] — extract numeric ID for image URL
        odooCategoryId = first
      } else if (typeof first === 'string') {
        categoryForMapping = first
      } else if (Array.isArray(first) && first.length >= 2) {
        // Tuple format e.g. [[341, "Laptop Stands"]]
        odooCategoryId = typeof first[0] === 'number' ? first[0] : null
        categoryForMapping = String(first[1])
      }
    }
  }
  // Fallback to categ_id if public_categ_ids not provided
  let category = categoryForMapping
    || (p.categ_id && Array.isArray(p.categ_id) ? p.categ_id[1] : null)
  // Extract categ_id numeric ID as fallback for image URL
  if (!odooCategoryId && p.categ_id && Array.isArray(p.categ_id) && typeof p.categ_id[0] === 'number') {
    odooCategoryId = p.categ_id[0]
  }

  // ── AUTO-FETCH category name from Odoo when we only have a numeric ID ────
  // Real scenario: Odoo sends public_categ_ids: [341] (just the ID, no name).
  // We call Odoo's API to get the actual category name so we can create/link it properly.
  if (!category && odooCategoryId) {
    try {
      const cats = await odooRead("product.public.category", [odooCategoryId], ["id", "name", "parent_path"])
      if (cats?.length > 0 && cats[0].name) {
        category = cats[0].name
        console.log(`[Odoo Webhook] Fetched category name from Odoo API: ID ${odooCategoryId} → "${category}"`)
      }
    } catch (err) {
      console.warn(`[Odoo Webhook] Failed to fetch category name from Odoo for ID ${odooCategoryId}: ${err}`)
    }
  }

  // ── Auto-build category image URL from Odoo category ID ──────────────────
  // If Odoo developer didn't send category_image_url explicitly, we build it
  // ourselves from the numeric category ID using Odoo's standard image endpoint.
  // This means: as long as the category has an image in Odoo, it will show up
  // on the storefront automatically — no extra work for the Odoo developer.
  const autoCategoryImageUrl = p.category_image_url
    || (odooCategoryId ? `${ODOO_BASE_URL}/web/image/product.public.category/${odooCategoryId}/image_1920` : null)

  if (autoCategoryImageUrl) {
    console.log(`[Odoo Webhook] Category image URL resolved: ${autoCategoryImageUrl} (odooCategoryId=${odooCategoryId})`)
  }

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

  // ── AUTO-FETCH attributes from Odoo API when webhook didn't include them ──
  // This is the real ecommerce solution: most basic Odoo webhooks don't include
  // attribute data, so we call Odoo's JSON-RPC API ourselves to get Color, Size, etc.
  if (Object.keys(attributes).length === 0 && odooId) {
    attributes = await fetchAttributesFromOdoo(odooId)
  }

  // ── Alternative/accessory/upsell: accept both Odoo native names + our aliases ─
  let alternativeIds = Array.isArray(p.alternative_odoo_ids) ? p.alternative_odoo_ids
    : Array.isArray(p.alternative_product_ids) ? p.alternative_product_ids : []
  let accessoryIds = Array.isArray(p.accessory_odoo_ids) ? p.accessory_odoo_ids
    : Array.isArray(p.accessory_product_ids) ? p.accessory_product_ids : []
  let upsellIds = Array.isArray(p.upsell_odoo_ids) ? p.upsell_odoo_ids
    : Array.isArray(p.optional_product_ids) ? p.optional_product_ids : []

  // ── AUTO-FETCH comparison IDs from Odoo API when webhook didn't include them ──
  if (alternativeIds.length === 0 && upsellIds.length === 0 && accessoryIds.length === 0 && odooId) {
    const comp = await fetchComparisonFromOdoo(odooId)
    alternativeIds = comp.alternativeIds
    upsellIds = comp.upsellIds
    accessoryIds = comp.accessoryIds
  }

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
    list_price: p.list_price || 0,
    compare_price: p.compare_list_price || 0,
    cost_price: p.standard_price || p.cost_price || 0,
    retail_price: p.retail_price || 0,
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
      `UPDATE product SET title=?, description=?, status=?, weight=?, metadata=?, thumbnail=COALESCE(?, thumbnail), updated_at=NOW() WHERE id=?`,
      [title, description, status, weight, JSON.stringify(metadata), p.image_url || null, prodId]
    )
    const varRes = await pg.raw(
      `SELECT pv.id as vid, pvps.price_set_id as psid FROM product_variant pv LEFT JOIN product_variant_price_set pvps ON pvps.variant_id = pv.id WHERE pv.product_id = ? AND pv.deleted_at IS NULL LIMIT 1`,
      [prodId]
    )
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
    // CATEGORY SYNC
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const catHandle = odooCategoryToHandle(category)
    if (catHandle && catHandle !== 'all') {
      // Use ensureCategory to automatically create if missing
      const catId = await ensureCategory(pg, catHandle, category || catHandle, categoryByHandle, autoCategoryImageUrl || null)
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
        // Sync category image (auto-built from Odoo category ID or explicit from webhook)
        if (autoCategoryImageUrl) {
          await syncCategoryImage(pg, catHandle, autoCategoryImageUrl)
        }
      }
    } else if (autoCategoryImageUrl) {
      // No useful category name from webhook (e.g. public_categ_ids was numeric-only [341])
      // but we have an auto-built image URL — apply it to the product's existing category
      try {
        const existingCatRes = await pg.raw(
          `SELECT pc.handle FROM product_category pc
           JOIN product_category_product pcp ON pcp.product_category_id = pc.id
           WHERE pcp.product_id = ? AND pc.deleted_at IS NULL
           LIMIT 1`,
          [prodId]
        )
        if (existingCatRes.rows?.length > 0) {
          const existingHandle = existingCatRes.rows[0].handle
          console.log(`[Odoo Webhook] Applying auto-built image to existing category "${existingHandle}" for product ${prodId}`)
          await syncCategoryImage(pg, existingHandle, autoCategoryImageUrl)
        }
      } catch (err) {
        console.warn(`[Odoo Webhook] Failed to sync image to existing category: ${err}`)
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // INVENTORY SYNC
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const qty = p.qty_available || 0
    if (varRes.rows?.length > 0) {
      const vid = varRes.rows[0].vid
      try {
        // Check if inventory_item exists
        const invItemRes = await pg.raw(
          `SELECT id FROM inventory_item WHERE sku = ? LIMIT 1`,
          [sku]
        )

        if (invItemRes.rows?.length > 0) {
          // Update existing
          const invItemId = invItemRes.rows[0].id
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
            // Create level if missing
            const locRes = await pg.raw(`SELECT id FROM stock_location LIMIT 1`)
            if (locRes.rows?.length > 0) {
              await pg.raw(
                `INSERT INTO inventory_level (id, inventory_item_id, location_id, stocked_quantity, reserved_quantity, incoming_quantity, created_at, updated_at)
                 VALUES (?, ?, ?, ?, 0, 0, NOW(), NOW())`,
                [genId("iloc"), invItemId, locRes.rows[0].id, qty]
              )
            }
          }
          // Ensure variant ↔ inventory_item link exists
          const pviiCheck = await pg.raw(
            `SELECT id FROM product_variant_inventory_item WHERE variant_id = ? AND inventory_item_id = ? AND deleted_at IS NULL LIMIT 1`,
            [vid, invItemId]
          )
          if (!pviiCheck.rows?.length) {
            await pg.raw(
              `INSERT INTO product_variant_inventory_item (id, variant_id, inventory_item_id, required_quantity, created_at, updated_at)
               VALUES (?, ?, ?, 1, NOW(), NOW())
               ON CONFLICT DO NOTHING`,
              [genId("pvitem"), vid, invItemId]
            )
          }
        } else {
          // Create inventory_item + level + variant link
          const invItemId = genId("iitem")
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
          // Link variant to inventory_item
          await pg.raw(
            `INSERT INTO product_variant_inventory_item (id, variant_id, inventory_item_id, required_quantity, created_at, updated_at)
             VALUES (?, ?, ?, 1, NOW(), NOW())
             ON CONFLICT DO NOTHING`,
            [genId("pvitem"), vid, invItemId]
          )
        }
      } catch (err) {
        console.warn(`[Odoo Webhook] Inventory sync failed for ${sku}: ${err}`)
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // BRAND SYNC (UPDATE)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (brand) {
      await ensureBrand(pg, brand, brandLogoUrl, prodId)
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // PRODUCT OPTIONS / ATTRIBUTES SYNC (UPDATE)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (varRes.rows?.length > 0 && Object.keys(attributes).length > 0) {
      await syncProductOptions(pg, prodId, varRes.rows[0].vid, attributes, sku)
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
  await syncProductOptions(pg, productId, variantId, attributes, sku)

  // ── Brand Sync ────────────────────────────────────────────────────────────
  if (brand) {
    await ensureBrand(pg, brand, brandLogoUrl, productId)
  }

  if (thumbnail) {
    await pg.raw(
      `INSERT INTO image (id, url, rank, product_id, created_at, updated_at) VALUES (?, ?, 0, ?, NOW(), NOW())`,
      [genId("img"), thumbnail, productId]
    )
  }
  if (p.images && Array.isArray(p.images)) {
    for (let idx = 0; idx < p.images.length; idx++) {
      await pg.raw(
        `INSERT INTO image (id, url, rank, product_id, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())`,
        [genId("img"), p.images[idx], idx + 1, productId]
      )
    }
  }

  if (salesChannelId) {
    try {
      await pg.raw(
        `INSERT INTO product_sales_channel (id, product_id, sales_channel_id, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW()) ON CONFLICT (product_id, sales_channel_id) DO NOTHING`,
        [genId("psc"), productId, salesChannelId]
      )
    } catch { /* ignore */ }
  }

  // ── Assign Default Shipping Profile (required for checkout) ───────────────
  try {
    const spRes = await pg.raw(`SELECT id FROM shipping_profile WHERE deleted_at IS NULL AND type = 'default' LIMIT 1`)
    if (spRes.rows?.length > 0) {
      await pg.raw(
        `INSERT INTO product_shipping_profile (id, product_id, shipping_profile_id, created_at, updated_at)
         VALUES (?, ?, ?, NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [genId("psp"), productId, spRes.rows[0].id]
      )
    }
  } catch (err) {
    console.warn(`[Odoo Webhook] Shipping profile assignment failed for ${productId}: ${err}`)
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // CATEGORY SYNC
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const catHandle = odooCategoryToHandle(category)
  // Use ensureCategory on CREATE path too (same as UPDATE path)
  // This means: if handle maps to an existing category → link it; if not → create it
  const catIdForCreate = (catHandle && catHandle !== 'all')
    ? await ensureCategory(pg, catHandle, category || catHandle, categoryByHandle, autoCategoryImageUrl || null)
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
    // Sync category image (auto-built from Odoo category ID or explicit from webhook)
    if (autoCategoryImageUrl && catHandle) {
      await syncCategoryImage(pg, catHandle, autoCategoryImageUrl)
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
    // Link variant to inventory_item (CRITICAL for add-to-cart to work)
    await pg.raw(
      `INSERT INTO product_variant_inventory_item (id, variant_id, inventory_item_id, required_quantity, created_at, updated_at)
       VALUES (?, ?, ?, 1, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [genId("pvitem"), variantId, invItemId]
    )
  } catch (err) {
    console.warn(`[Odoo Webhook] Inventory sync failed for ${sku}: ${err}`)
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
