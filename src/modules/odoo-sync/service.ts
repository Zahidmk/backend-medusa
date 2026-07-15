/**
 * Odoo Sync Service — COMPLETE EDITION
 * 
 * Handles full synchronization of ALL product data between Odoo ERP and MedusaJS.
 * Odoo is the single source of truth for:
 *   - Products (name, SKU, barcode, descriptions, prices, weight, volume)
 *   - Brands (brand_id from product.brand model)
 *   - Categories (categ_id + public_categ_ids)
 *   - Variants & Attributes (attribute_line_ids → Color, Size, etc.)
 *   - Images (image_1920 + product_template_image_ids gallery)
 *   - Inventory (qty_available, virtual_available, incoming, outgoing)
 *   - SEO (website_meta_title/description/keywords, seo_name)
 *   - Cross-sell (optional_product_ids, accessory_product_ids, alternative_product_ids)
 *   - Ratings (rating_avg, rating_count)
 *   - Vendors (seller_ids)
 *   - Ribbons, tags, publish status
 * 
 * @version 2.0 — March 2026
 */

import axios, { AxiosInstance } from "axios"
import https from "https"

// ─────────────────────────────────────────────────
//  TYPE DEFINITIONS
// ─────────────────────────────────────────────────

/** Odoo many2one fields come as [id, name] tuple or false */
type M2O = [number, string] | false

/**
 * Complete Odoo product.template record with ALL synced fields
 */
export interface OdooProduct {
  id: number

  // ── Core ──
  name: string
  default_code: string | false          // SKU / Internal Reference
  barcode: string | false
  type: string                          // "consu" | "service" | "combo"
  active: boolean
  sequence: number
  is_favorite: boolean
  color: number

  // ── Prices ──
  list_price: number                    // Sales Price
  standard_price: number                // Cost
  compare_list_price: number            // Compare-to / Was price

  retail_price?: number                 // Retail price
  x_ecommerce_price?: number            // eCommerce Website Sales Price (custom field)
  currency_id: M2O

  // ── Descriptions ──
  description: string | false           // Internal description
  description_sale: string | false      // Sales description
  description_ecommerce: string | false // Rich HTML for website PDP

  // ── Brand & Category ──
  brand_id: M2O                         // product.brand many2one
  categ_id: M2O                         // product.category many2one
  public_categ_ids: number[]            // Website public categories
  x_studio_brand_1: string | false      // Custom brand field (selection)
  x_studio_sub_category: string | false // Custom sub-category

  // ── Inventory & Logistics ──
  qty_available: number                 // Quantity On Hand
  virtual_available: number             // Forecasted Quantity
  incoming_qty: number                  // Incoming
  outgoing_qty: number                  // Outgoing
  is_storable: boolean                  // Track Inventory
  weight: number
  volume: number
  weight_uom_name: string | false
  volume_uom_name: string | false
  hs_code: string | false              // HS Code for customs
  country_of_origin: M2O               // Origin of Goods
  sale_delay: number                    // Customer Lead Time (days)
  allow_out_of_stock_order: boolean     // Continue selling when OOS
  out_of_stock_message: string | false  // Out-of-Stock Message (HTML)
  show_availability: boolean            // Show stock qty on website
  available_threshold: number           // Threshold for "Only X left"
  uom_id: M2O                          // Unit of Measure
  uom_name: string | false

  // ── Images ──
  image_1920: string | false            // Main image (base64)
  product_template_image_ids: number[]  // Extra gallery image IDs
  can_image_1024_be_zoomed: boolean

  // ── Variants & Attributes ──
  attribute_line_ids: number[]          // product.template.attribute.line IDs
  product_variant_ids: number[]         // product.product IDs (the actual variants)
  product_variant_count: number
  has_configurable_attributes: boolean

  // ── SEO & Website ──
  seo_name: string | false             // URL slug
  website_meta_title: string | false
  website_meta_description: string | false
  website_meta_keywords: string | false
  website_meta_og_img: string | false
  is_published: boolean
  website_url: string | false
  website_sequence: number
  website_ribbon_id: M2O               // Ribbon ("NEW", "SALE", etc.)
  product_tag_ids: number[]            // Product tags

  // ── Sales & Cross-sell ──
  optional_product_ids: number[]       // "You may also like" (upsell)
  accessory_product_ids: number[]      // "Frequently bought together"
  alternative_product_ids: number[]    // "Compare with"
  sales_count: number                  // Total sold
  combo_ids: number[]                  // Combo/bundle products
  sale_ok: boolean
  purchase_ok: boolean

  // ── Ratings ──
  rating_avg: number
  rating_count: number
  rating_percentage_satisfaction: number
  rating_last_feedback: string | false
  rating_last_value: number

  // ── Vendors ──
  seller_ids: number[]                 // product.supplierinfo IDs

  // ── Timestamps ──
  create_date: string
  write_date: string

  // ── Legacy compatibility ──
  product_tmpl_id?: M2O
}

/**
 * Odoo product.brand record
 */
export interface OdooBrand {
  id: number
  name: string
  logo: string | false        // base64 logo image (legacy field name)
  image_1920: string | false  // base64 logo image (actual Odoo field name returned by API)
  description: string | false
}

/**
 * Odoo product.template.attribute.line — defines which attributes a product has
 */
export interface OdooAttributeLine {
  id: number
  attribute_id: M2O           // e.g. [1, "Color"]
  value_ids: number[]         // e.g. [10, 11, 12] → Red, Blue, Green
  product_tmpl_id: M2O
}

/**
 * Odoo product.attribute.value — individual attribute value
 */
export interface OdooAttributeValue {
  id: number
  name: string                // "Red", "XL", "128GB"
  attribute_id: M2O           // [1, "Color"]
  html_color: string | false  // hex color for color swatches
  is_custom: boolean
  sequence: number
}

/**
 * Odoo product.product — individual variant record
 */
export interface OdooVariant {
  id: number
  display_name: string
  default_code: string | false    // Variant SKU
  barcode: string | false
  list_price: number
  standard_price: number
  qty_available: number
  virtual_available: number
  weight: number
  volume: number
  image_1920: string | false      // Variant-specific image
  product_tmpl_id: M2O
  product_template_attribute_value_ids: number[]  // Which attribute values this variant has
  active: boolean
}

/**
 * Odoo product.image — extra gallery image
 */
export interface OdooProductImage {
  id: number
  name: string
  image_1920: string | false      // base64 image data
  sequence: number
  product_tmpl_id: M2O
}

/**
 * Odoo product.supplierinfo — vendor/supplier record
 */
export interface OdooVendor {
  id: number
  partner_id: M2O                 // Vendor partner [id, name]
  price: number
  currency_id: M2O
  delay: number                   // Lead time in days
  min_qty: number
  product_tmpl_id: M2O
}

/**
 * Odoo product.ribbon — website ribbon/badge
 */
export interface OdooRibbon {
  id: number
  html: string                    // "NEW", "SALE", "HOT DEAL"
  bg_color: string | false
  text_color: string | false
  html_class: string | false
}

/**
 * Odoo product.tag — product tag
 */
export interface OdooTag {
  id: number
  name: string
  color: number
}

/**
 * Odoo product.public.category — website category
 */
export interface OdooPublicCategory {
  id: number
  name: string
  parent_id: M2O
  parent_path: string | false
  sequence: number
  website_id: M2O
  image_1920: string | false
}

export interface OdooCategory {
  id: number
  name: string
  parent_id: M2O
  complete_name: string
}

export interface OdooStockQuant {
  id: number
  product_id: M2O
  location_id: M2O
  quantity: number
  reserved_quantity: number
}

export interface SyncResult {
  success: boolean
  synced: number
  failed: number
  errors: string[]
  timestamp: string
}

export interface OdooConfig {
  url: string
  dbName: string
  username: string
  password: string
}

// ─────────────────────────────────────────────────
//  COMPLETE FIELD LIST TO FETCH FROM ODOO
// ─────────────────────────────────────────────────

/**
 * All product.template fields we request from Odoo.
 * We fetch from product.template (not product.product) to get template-level data,
 * then fetch variants separately.
 */
export const ODOO_PRODUCT_TEMPLATE_FIELDS = [
  // Core
  "id", "name", "default_code", "barcode", "type", "active",
  "sequence", "is_favorite", "color",

  // Prices
  "list_price", "standard_price", "compare_list_price", "retail_price",
  "x_ecommerce_price",
  "currency_id",

  // Descriptions
  "description", "description_sale", "description_ecommerce",

  // Brand & Category
  "brand_id", "categ_id", "public_categ_ids",
  "x_studio_brand_1", "x_studio_sub_category",

  // Inventory & Logistics
  "qty_available", "virtual_available", "incoming_qty", "outgoing_qty",
  "is_storable", "weight", "volume", "weight_uom_name", "volume_uom_name",
  "hs_code", "country_of_origin", "sale_delay",
  "allow_out_of_stock_order", "out_of_stock_message",
  "show_availability", "available_threshold",
  "uom_id", "uom_name",

  // Images
  "image_1920", "product_template_image_ids", "can_image_1024_be_zoomed",

  // Variants & Attributes
  "attribute_line_ids", "product_variant_ids", "product_variant_count",
  "has_configurable_attributes",

  // SEO & Website
  "seo_name", "website_meta_title", "website_meta_description",
  "website_meta_keywords", "website_meta_og_img",
  "is_published", "website_url", "website_sequence",
  "website_ribbon_id",
  "product_tag_ids",

  // Sales & Cross-sell
  "optional_product_ids", "accessory_product_ids", "alternative_product_ids",
  "sales_count", "combo_ids", "sale_ok", "purchase_ok",

  // Ratings
  "rating_avg", "rating_count", "rating_percentage_satisfaction",
  "rating_last_feedback", "rating_last_value",

  // Vendors
  "seller_ids",

  // Timestamps
  "create_date", "write_date",
] as const

/** Fields for product.product (variant-level) */
export const ODOO_VARIANT_FIELDS = [
  "id", "display_name", "default_code", "barcode",
  "list_price", "standard_price",
  "qty_available", "virtual_available",
  "weight", "volume",
  "image_1920",
  "product_tmpl_id",
  "product_template_attribute_value_ids",
  "active",
] as const

// ─────────────────────────────────────────────────
//  ODOO SYNC SERVICE
// ─────────────────────────────────────────────────

/**
 * Odoo Sync Service — connects to Odoo via JSON-RPC and fetches
 * all product data for synchronization with MedusaJS.
 */
class OdooSyncService {
  private config: OdooConfig
  private client: AxiosInstance | null = null
  private uid: number | null = null
  private requestId = 0

  constructor() {
    // Use hardcoded config since env vars aren't loading in MedusaJS exec context
    this.config = {
      url: process.env.ODOO_URL?.replace(/\/$/, '') || "https://oskarllc-new-31031096.dev.odoo.com",
      dbName: process.env.ODOO_DB_NAME || "oskarllc-new-31031096",
      username: process.env.ODOO_USERNAME || "SYG",
      password: process.env.ODOO_API_KEY || "2a420f7cb6d0c1c8f73368131f025f638c30704e",
    }
  }

  // ── Config helpers ──

  isConfigured(): boolean {
    return !!(this.config.url && this.config.dbName && this.config.username && this.config.password)
  }

  getConfig(): Partial<OdooConfig> {
    return { url: this.config.url, dbName: this.config.dbName, username: this.config.username }
  }

  setConfig(config: OdooConfig): void {
    this.config = config
    this.client = null
    this.uid = null
  }

  // ── HTTP / JSON-RPC layer ──

  private createClient(): AxiosInstance {
    if (!this.client) {
      this.client = axios.create({
        baseURL: this.config.url,
        headers: { "Content-Type": "application/json" },
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        timeout: 60000, // 60s for large fetches
      })
    }
    return this.client
  }

  private async jsonRpc(url: string, method: string, params: Record<string, any>): Promise<any> {
    const client = this.createClient()
    const response = await client.post(url, {
      jsonrpc: "2.0",
      method,
      params,
      id: ++this.requestId,
    })

    if (response.data.error) {
      console.error("\n❌ Odoo Error Raw Response:", JSON.stringify(response.data.error, null, 2))
      const msg = response.data.error.message || response.data.error.data?.message || "Unknown Odoo error"
      throw new Error(`Odoo Error: ${msg}`)
    }
    return response.data.result
  }

  async authenticate(): Promise<boolean> {
    try {
      const result = await this.jsonRpc("/jsonrpc", "call", {
        service: "common",
        method: "authenticate",
        args: [this.config.dbName, this.config.username, this.config.password, {}],
      })
      if (result && typeof result === "number" && result > 0) {
        this.uid = result
        console.log("✅ Odoo authenticated, UID:", this.uid)
        return true
      }
      console.error("❌ Odoo auth failed: Invalid response", result)
      return false
    } catch (error: any) {
      console.error("❌ Odoo auth failed:", error.message)
      return false
    }
  }

  private async ensureAuth(): Promise<void> {
    if (!this.uid) {
      const ok = await this.authenticate()
      if (!ok) throw new Error("Failed to authenticate with Odoo")
    }
  }

  private async executeKw(model: string, method: string, args: any[], kwargs: Record<string, any> = {}): Promise<any> {
    await this.ensureAuth()
    return this.jsonRpc("/jsonrpc", "call", {
      service: "object",
      method: "execute_kw",
      args: [this.config.dbName, this.uid, this.config.password, model, method, args, kwargs],
    })
  }

  private async searchRead(model: string, domain: any[], fields: string[], limit = 100, offset = 0, order?: string): Promise<any[]> {
    const kwargs: Record<string, any> = { fields, limit, offset }
    if (order) kwargs.order = order
    return this.executeKw(model, "search_read", [domain], kwargs)
  }

  private async read(model: string, ids: number[], fields: string[]): Promise<any[]> {
    if (ids.length === 0) return []
    return this.executeKw(model, "read", [ids], { fields })
  }

  private async searchCount(model: string, domain: any[]): Promise<number> {
    return this.executeKw(model, "search_count", [domain])
  }

  // ═══════════════════════════════════════════════
  //  PRODUCT FETCHING — COMPLETE FIELD LIST
  // ═══════════════════════════════════════════════

  /**
   * Fetch products from Odoo with ALL fields.
   * Uses product.template model for template-level data.
   */
  async fetchProducts(limit = 100, offset = 0): Promise<OdooProduct[]> {
    await this.ensureAuth()
    const products = await this.searchRead(
      "product.template",
      [["active", "=", true], ["sale_ok", "=", true]],
      [...ODOO_PRODUCT_TEMPLATE_FIELDS],
      limit,
      offset,
      "write_date desc"
    )
    return products as OdooProduct[]
  }

  /**
   * Fetch only products modified since a given date (for delta sync)
   */
  async fetchProductsSince(since: string, limit = 500): Promise<OdooProduct[]> {
    await this.ensureAuth()
    const products = await this.searchRead(
      "product.template",
      [
        ["active", "=", true],
        ["sale_ok", "=", true],
        "|",
        ["write_date", ">", since],
        ["create_date", ">", since],
      ],
      [...ODOO_PRODUCT_TEMPLATE_FIELDS],
      limit,
      0,
      "write_date desc"
    )
    return products as OdooProduct[]
  }

  /**
   * Fetch a single product by Odoo template ID
   */
  async fetchProductById(templateId: number): Promise<OdooProduct | null> {
    await this.ensureAuth()
    const products = await this.read("product.template", [templateId], [...ODOO_PRODUCT_TEMPLATE_FIELDS])
    return products.length > 0 ? (products[0] as OdooProduct) : null
  }

  /**
   * Get total count of active saleable products
   */
  async getProductCount(): Promise<number> {
    return this.searchCount("product.template", [["active", "=", true], ["sale_ok", "=", true]])
  }

  // ═══════════════════════════════════════════════
  //  VARIANTS — Individual product.product records
  // ═══════════════════════════════════════════════

  /**
   * Fetch all variants for a given template
   */
  async fetchVariantsByTemplate(templateId: number): Promise<OdooVariant[]> {
    await this.ensureAuth()
    const variants = await this.searchRead(
      "product.product",
      [["product_tmpl_id", "=", templateId], ["active", "=", true]],
      [...ODOO_VARIANT_FIELDS],
      100
    )
    return variants as OdooVariant[]
  }

  /**
   * Fetch specific variants by IDs
   */
  async fetchVariantsByIds(variantIds: number[]): Promise<OdooVariant[]> {
    if (variantIds.length === 0) return []
    await this.ensureAuth()
    return this.read("product.product", variantIds, [...ODOO_VARIANT_FIELDS]) as Promise<OdooVariant[]>
  }

  // ═══════════════════════════════════════════════
  //  ATTRIBUTES — Color, Size, Storage, etc.
  // ═══════════════════════════════════════════════

  /**
   * Fetch attribute lines for a product (which attributes it has)
   */
  async fetchAttributeLines(lineIds: number[]): Promise<OdooAttributeLine[]> {
    if (lineIds.length === 0) return []
    await this.ensureAuth()
    return this.read("product.template.attribute.line", lineIds, [
      "id", "attribute_id", "value_ids", "product_tmpl_id",
    ]) as Promise<OdooAttributeLine[]>
  }

  /**
   * Fetch attribute values by IDs (e.g., "Red", "XL", "128GB")
   */
  async fetchAttributeValues(valueIds: number[]): Promise<OdooAttributeValue[]> {
    if (valueIds.length === 0) return []
    await this.ensureAuth()
    return this.read("product.attribute.value", valueIds, [
      "id", "name", "attribute_id", "html_color", "is_custom", "sequence",
    ]) as Promise<OdooAttributeValue[]>
  }

  /**
   * Fetch template attribute value IDs (for mapping variant → attribute values)
   */
  async fetchTemplateAttributeValues(ids: number[]): Promise<any[]> {
    if (ids.length === 0) return []
    await this.ensureAuth()
    return this.read("product.template.attribute.value", ids, [
      "id", "name", "attribute_id", "product_attribute_value_id", "ptav_active",
    ])
  }

  // ═══════════════════════════════════════════════
  //  BRANDS — product.brand model
  // ═══════════════════════════════════════════════

  /**
   * Fetch all brands from Odoo.
   * Uses context { bin_size: false } to force Odoo to return actual
   * base64 image data instead of just `true` (a size marker).
   */
  async fetchBrands(): Promise<OdooBrand[]> {
    await this.ensureAuth()
    try {
      const brands = await this.executeKw(
        "custom.product.brand",
        "search_read",
        [[]],
        { fields: ["id", "name", "image_1920"], limit: 500, context: { bin_size: false } }
      )
      return brands as OdooBrand[]
    } catch (error: any) {
      // custom.product.brand model may not exist in all Odoo installations
      console.warn("⚠️  custom.product.brand model not available:", error.message)
      return []
    }
  }

  /**
   * Fetch a single brand by ID
   */
  async fetchBrandById(brandId: number): Promise<OdooBrand | null> {
    await this.ensureAuth()
    try {
      const brands = await this.read("custom.product.brand", [brandId], ["id", "name", "image_1920"])
      return brands.length > 0 ? (brands[0] as OdooBrand) : null
    } catch {
      return null
    }
  }

  // ═══════════════════════════════════════════════
  //  CATEGORIES
  // ═══════════════════════════════════════════════

  /**
   * Fetch internal categories (product.category)
   */
  async fetchCategories(): Promise<OdooCategory[]> {
    await this.ensureAuth()
    return this.searchRead(
      "product.category",
      [],
      ["id", "name", "parent_id", "complete_name"],
      500
    ) as Promise<OdooCategory[]>
  }

  /**
   * Fetch website public categories (product.public.category)
   */
  async fetchPublicCategories(): Promise<OdooPublicCategory[]> {
    await this.ensureAuth()
    try {
      const categories = await this.executeKw(
        "product.public.category",
        "search_read",
        [[["medusa_sync", "=", true]]],
        { 
          fields: ["id", "name", "parent_id", "parent_path", "sequence", "website_id", "image_1920", "medusa_sync"], 
          limit: 1000, 
          offset: 0, 
          order: "sequence asc",
          context: { bin_size: false }
        }
      )
      return categories as OdooPublicCategory[]
    } catch (error: any) {
      console.warn("⚠️  product.public.category not available:", error.message)
      return []
    }
  }

  // ═══════════════════════════════════════════════
  //  IMAGES — Gallery images
  // ═══════════════════════════════════════════════

  /**
   * Fetch extra product images (product.image)
   */
  async fetchProductImages(imageIds: number[]): Promise<OdooProductImage[]> {
    if (imageIds.length === 0) return []
    await this.ensureAuth()
    return this.read("product.image", imageIds, [
      "id", "name", "image_1920", "sequence", "product_tmpl_id",
    ]) as Promise<OdooProductImage[]>
  }

  // ═══════════════════════════════════════════════
  //  VENDORS / SUPPLIERS
  // ═══════════════════════════════════════════════

  /**
   * Fetch vendor/supplier info for a product
   */
  async fetchVendors(sellerIds: number[]): Promise<OdooVendor[]> {
    if (sellerIds.length === 0) return []
    await this.ensureAuth()
    return this.read("product.supplierinfo", sellerIds, [
      "id", "partner_id", "price", "currency_id", "delay", "min_qty", "product_tmpl_id",
    ]) as Promise<OdooVendor[]>
  }

  // ═══════════════════════════════════════════════
  //  RIBBONS — NEW / SALE / HOT DEAL badges
  // ═══════════════════════════════════════════════

  /**
   * Fetch all ribbons
   */
  async fetchRibbons(): Promise<OdooRibbon[]> {
    await this.ensureAuth()
    try {
      return this.searchRead(
        "product.ribbon",
        [],
        ["id", "html", "bg_color", "text_color", "html_class"],
        50
      ) as Promise<OdooRibbon[]>
    } catch {
      return []
    }
  }

  // ═══════════════════════════════════════════════
  //  TAGS
  // ═══════════════════════════════════════════════

  /**
   * Fetch product tags by IDs
   */
  async fetchTags(tagIds: number[]): Promise<OdooTag[]> {
    if (tagIds.length === 0) return []
    await this.ensureAuth()
    try {
      return this.read("product.tag", tagIds, ["id", "name", "color"]) as Promise<OdooTag[]>
    } catch {
      return []
    }
  }

  // ═══════════════════════════════════════════════
  //  INVENTORY
  // ═══════════════════════════════════════════════

  /**
   * Fetch stock quant records
   */
  async fetchInventory(): Promise<any[]> {
    await this.ensureAuth()
    
    // First fetch stock quants
    const quants = await this.searchRead(
      "stock.quant",
      [["quantity", ">", 0], ["location_id.usage", "=", "internal"]],
      ["id", "product_id", "location_id", "quantity", "reserved_quantity"],
      10000
    )
    
    if (!quants || quants.length === 0) return []
    
    // Extract unique product variant IDs
    const productIds = [...new Set(quants.map((q: any) => q.product_id[0]))]
    
    // Fetch SKUs (default_code) for these products
    const products = await this.read("product.product", productIds as number[], ["id", "default_code"])
    const skuMap = new Map()
    for (const p of products) {
      skuMap.set(p.id, p.default_code)
    }
    
    // Attach SKU to the quants
    return quants.map((q: any) => ({
      ...q,
      sku: skuMap.get(q.product_id[0]) || false
    }))
  }

  /**
   * Fetch product variants with extended stock fields.
   * Returns qty_available, virtual_available (forecast), incoming, outgoing, free_qty.
   */
  async fetchVariantStock(limit = 1000): Promise<any[]> {
    await this.ensureAuth()
    return this.searchRead(
      "product.product",
      [["active", "=", true]],
      [
        "id", "default_code", "name",
        "qty_available", "virtual_available",
        "incoming_qty", "outgoing_qty", "free_qty",
      ],
      limit
    )
  }

  // ═══════════════════════════════════════════════
  //  CONVERT TO MEDUSA FORMAT (Complete)
  // ═══════════════════════════════════════════════

  /**
   * Convert an Odoo product to MedusaJS product format.
   * 
   * Mapping strategy:
   * - Native Medusa fields: title, description, handle, status, weight, etc.
   * - metadata JSON: ALL extra Odoo fields that don't have a Medusa equivalent
   * 
   * @param product - Complete Odoo product record
   * @param options - Optional resolved related data
   */
  convertToMedusaProduct(
    product: OdooProduct,
    options?: {
      brandName?: string
      ribbonText?: string
      tagNames?: string[]
      vendors?: Array<{ name: string; price: number; currency: string; lead_time: number }>
    }
  ): Record<string, any> {
    // URL slug: prefer Odoo seo_name, fallback to generated slug
    const handle = (product.seo_name && typeof product.seo_name === "string")
      ? product.seo_name
      : product.name
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, "")
          .replace(/\s+/g, "-")
          .replace(/-{2,}/g, "-")        // collapse multiple dashes
          .replace(/^-|-$/g, "")         // trim leading/trailing dashes
          .substring(0, 100)

    // Determine product status:
    // Default set to "draft" as requested so it can be manually published on the Medusa dashboard later
    const status = "draft"

    // Brand name: from resolved brand_id, or x_studio_brand_1, or options
    const brandName = options?.brandName
      || (product.brand_id ? product.brand_id[1] : null)
      || (product.x_studio_brand_1 || null)

    // Ribbon text: from resolved ribbon or options
    const ribbonText = options?.ribbonText
      || (product.website_ribbon_id ? product.website_ribbon_id[1] : null)

    // Helper: strip HTML tags for plain text description
    const stripHtml = (html: string): string =>
      html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()

    // Description: prefer description_sale, then strip description_ecommerce, then description
    let description: string | null = null
    if (product.description_sale && typeof product.description_sale === "string") {
      description = product.description_sale
    } else if (product.description_ecommerce && typeof product.description_ecommerce === "string") {
      description = stripHtml(product.description_ecommerce)
    } else if (product.description && typeof product.description === "string") {
      description = product.description
    }

    // Currency code is always kwd
    const currencyCode = "kwd"
    const KWD_FILS_DIVISOR = 1000

    return {
      title: product.name,
      subtitle: brandName || null,
      description,
      handle,
      is_giftcard: false,
      status,
      thumbnail: null, // Set separately after image download
      weight: product.weight || 0,
      metadata: {
        // ── Odoo Reference ──
        odoo_id: product.id,
        odoo_sku: product.default_code || null,
        odoo_barcode: product.barcode || null,
        odoo_product_type: product.type || null,

        // ── Category ──
        odoo_category_id: product.categ_id ? product.categ_id[0] : null,
        odoo_category_name: product.categ_id ? product.categ_id[1] : null,
        sub_category: product.x_studio_sub_category || null,
        public_category_ids: product.public_categ_ids || [],

        // ── Brand ──
        brand: brandName,
        brand_id: product.brand_id ? product.brand_id[0] : null,
        brand_selection: product.x_studio_brand_1 || null,

        // ── Prices ──
        cost_price: product.standard_price || 0,
        compare_price: product.compare_list_price || 0,
        retail_price: product.retail_price || 0,
        ecommerce_price: product.x_ecommerce_price || null,  // Separate website sales price
        currency: product.currency_id ? product.currency_id[1] : null,

        // ── Descriptions ──
        ecommerce_description: product.description_ecommerce || null,

        // ── Inventory ──
        odoo_stock: product.qty_available || 0,
        forecasted_qty: product.virtual_available || 0,
        incoming_qty: product.incoming_qty || 0,
        outgoing_qty: product.outgoing_qty || 0,
        is_storable: product.is_storable || false,
        volume: product.volume || 0,
        weight_unit: product.weight_uom_name || "kg",
        volume_unit: product.volume_uom_name || "m³",
        hs_code: product.hs_code || null,
        origin_country: product.country_of_origin ? product.country_of_origin[1] : null,
        origin_country_code: product.country_of_origin ? product.country_of_origin[0] : null,
        lead_time_days: product.sale_delay || 0,
        allow_backorder: product.allow_out_of_stock_order || false,
        oos_message: product.out_of_stock_message || null,
        show_stock_qty: product.show_availability || false,
        stock_threshold: product.available_threshold || 0,
        uom: product.uom_name || null,

        // ── SEO ──
        seo_title: product.website_meta_title || null,
        seo_description: product.website_meta_description || null,
        seo_keywords: product.website_meta_keywords || null,
        og_image: product.website_meta_og_img || null,
        display_order: product.website_sequence || 0,
        odoo_website_url: product.website_url || null,
        is_published_odoo: product.is_published || false,

        // ── Ribbon / Badge ──
        ribbon: ribbonText,

        // ── Tags ──
        tags: options?.tagNames || [],
        tag_ids: product.product_tag_ids || [],

        // ── Cross-sell / Upsell (Odoo template IDs — resolve to Medusa IDs at display time) ──
        upsell_odoo_ids: product.optional_product_ids || [],
        accessory_odoo_ids: product.accessory_product_ids || [],
        alternative_odoo_ids: product.alternative_product_ids || [],
        combo_ids: product.combo_ids || [],

        // ── Social proof ──
        total_sold: product.sales_count || 0,
        rating: product.rating_avg || 0,
        reviews_count: product.rating_count || 0,
        satisfaction_pct: product.rating_percentage_satisfaction || 0,
        latest_review_text: product.rating_last_feedback || null,
        latest_review_rating: product.rating_last_value || 0,

        // ── Vendors ──
        vendors: options?.vendors || [],
        vendor_ids: product.seller_ids || [],

        // ── Feature flags ──
        is_featured: product.is_favorite || false,
        sort_order: product.sequence || 0,
        sale_ok: product.sale_ok || false,
        purchase_ok: product.purchase_ok || false,
        can_be_zoomed: product.can_image_1024_be_zoomed || false,

        // ── Variant info ──
        variant_count: product.product_variant_count || 1,
        has_configurable_attributes: product.has_configurable_attributes || false,

        // ── Image gallery IDs (to be resolved) ──
        gallery_image_ids: product.product_template_image_ids || [],

        // ── Sync timestamp ──
        synced_at: new Date().toISOString(),
        odoo_write_date: product.write_date || null,
      },

      // Default variant (will be replaced with real variants if product has attributes)
      // NOTE: prices are NOT part of CreateProductVariantDTO in MedusaJS 2.x
      // Prices must be set via the Pricing module after product/variant creation
      // Price info is stored in variant metadata for later pricing sync
      variants: [
        {
          title: "Default",
          sku: (product.default_code as string) || `ODOO-${product.id}`,
          barcode: (product.barcode as string) || undefined,
          manage_inventory: product.is_storable || false,
          allow_backorder: false, // Disabled backorders to prevent selling out of stock items
          inventory_quantity: Math.floor(product.qty_available || 0),
          weight: product.weight || 0,
          metadata: {
            odoo_product_id: product.id,
            odoo_price: product.retail_price || product.x_ecommerce_price || 0,
            odoo_retail_price: product.retail_price || 0,
            odoo_price_amount: Math.round((product.retail_price || product.x_ecommerce_price || 0) * 1000),
            odoo_currency: "kwd",
          },
        },
      ],
    }
  }

  // ═══════════════════════════════════════════════
  //  TEST CONNECTION
  // ═══════════════════════════════════════════════

  async testConnection(): Promise<{ success: boolean; message: string; data?: any }> {
    try {
      if (!this.isConfigured()) {
        return {
          success: false,
          message: "Odoo is not configured. Set ODOO_URL, ODOO_DB_NAME, ODOO_USERNAME, ODOO_API_KEY.",
        }
      }
      const authenticated = await this.authenticate()
      if (!authenticated) {
        return { success: false, message: "Authentication failed. Check credentials." }
      }

      const productCount = await this.getProductCount()
      const categories = await this.fetchCategories()
      let brandCount = 0
      try {
        const brands = await this.fetchBrands()
        brandCount = brands.length
      } catch { /* brand model may not exist */ }

      return {
        success: true,
        message: "Successfully connected to Odoo",
        data: {
          userId: this.uid,
          productCount,
          categoryCount: categories.length,
          brandCount,
        },
      }
    } catch (error: any) {
      return { success: false, message: `Connection failed: ${error.message}` }
    }
  }
}

export default OdooSyncService
