import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import axios from "axios"

/**
 * Odoo -> MedusaJS Full Product Sync (v3)
 * 
 * Run: npx medusa exec src/scripts/odoo-sync.ts
 *   or: npm run sync:odoo
 * 
 * Features:
 * - Paginates through ALL Odoo products (supports 6000+)
 * - Uses raw SQL for fast bulk inserts
 * - Upserts: creates new, updates existing (matched by odoo_id or SKU)
 * - Copies prices, images, assigns sales channel
 *
 * @version 3.0 - March 2026
 */

const PAGE_SIZE = 200
const CURRENCY = process.env.DEFAULT_CURRENCY || "kwd"

function genId(prefix: string): string {
  const c = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
  let id = prefix + "_"
  for (let i = 0; i < 26; i++) id += c[Math.floor(Math.random() * c.length)]
  return id
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/(^-|-$)/g, "").substring(0, 100)
}

/**
 * Maps an Odoo category path (e.g. "All / Saleable / Power Bank / Magsafe")
 * to the corresponding Medusa category handle.
 * Order matters: more specific paths checked first.
 */
function odooCategoryToHandle(odooCategory: string | null): string | null {
  if (!odooCategory) return null
  const cat = odooCategory.toLowerCase()

  if (cat.includes("power station"))        return "powerbank"
  if (cat.includes("power bank"))           return "powerbank"
  if (cat.includes("powerbank"))            return "powerbank"
  if (cat.includes("projector"))            return "projectors"
  if (cat.includes("gaming / monitor"))     return "gaming"
  if (cat.includes("gaming / console"))     return "gaming"
  if (cat.includes("gaming / mouse"))       return "gaming"
  if (cat.includes("gaming / headset"))     return "gaming"
  if (cat.includes("gaming / mic"))         return "gaming"
  if (cat.includes("gaming / speaker"))     return "gaming"
  if (cat.includes("gaming"))              return "gaming"
  if (cat.includes("earphone"))             return "tws-headphone"
  if (cat.includes("headset"))              return "tws-headphone"
  if (cat.includes("headphone"))            return "tws-headphone"
  if (cat.includes("fm transmit"))          return "fm-transmitter"
  if (cat.includes("cable"))                return "cables"
  if (cat.includes("hub"))                  return "hubs"
  if (cat.includes("power socket"))         return "power-socket"
  if (cat.includes("tablet"))               return "mobiletablet"
  if (cat.includes("smart watch"))          return "smart-watch"
  if (cat.includes("watch band"))           return "smart-watch-loops"
  if (cat.includes("lifestyle"))            return "lifestyle"
  if (cat.includes("holder"))               return "mobile-stand"
  if (cat.includes("stand"))                return "mobile-stand"
  if (cat.includes("speaker"))              return "speakers"
  if (cat.includes("charger"))              return "chargers"
  if (cat.includes("car charger"))          return "car-charger"
  if (cat.includes("car mount"))            return "car-mount"
  if (cat.includes("magsafe"))              return "magsafe"
  if (cat.includes("screen protector"))     return "screen-protector"
  if (cat.includes("case"))                 return "cases"

  return null
}

export default async function odooSync({ container }: ExecArgs) {
  console.log("\n\ud83d\udd04 Odoo -> MedusaJS Full Sync v3")
  console.log("=".repeat(55))

  const odooUrl = process.env.ODOO_URL || ""
  const odooDb = process.env.ODOO_DB_NAME || ""
  const odooUsername = process.env.ODOO_USERNAME || ""
  const odooPassword = process.env.ODOO_PASSWORD || process.env.ODOO_API_KEY || ""

  if (!odooUrl || !odooDb || !odooUsername || !odooPassword) {
    console.error("Missing ODOO_URL, ODOO_DB_NAME, ODOO_USERNAME, ODOO_PASSWORD in .env")
    return
  }

  console.log(`Odoo: ${odooUrl}  DB: ${odooDb}  User: ${odooUsername}`)

  // 1. Authenticate
  console.log("\n1. Authenticating...")
  let uid: number
  try {
    const r = await axios.post(`${odooUrl}/jsonrpc`, {
      jsonrpc: "2.0", method: "call",
      params: { service: "common", method: "authenticate", args: [odooDb, odooUsername, odooPassword, {}] },
      id: 1,
    }, { timeout: 15000 })
    uid = r.data.result
    if (!uid) {
      console.error("Authentication failed - Odoo returned:", uid)
      console.error("Ask Odoo developer to verify credentials / API key")
      return
    }
    console.log(`Authenticated (UID: ${uid})`)
  } catch (e: any) {
    console.error("Auth failed:", e.message)
    return
  }

  let reqId = 1
  async function odooCall(model: string, method: string, args: any[], kwargs: any = {}): Promise<any> {
    const r = await axios.post(`${odooUrl}/jsonrpc`, {
      jsonrpc: "2.0", method: "call",
      params: { service: "object", method: "execute_kw", args: [odooDb, uid, odooPassword, model, method, args, kwargs] },
      id: ++reqId,
    }, { timeout: 120000 })
    if (r.data.error) throw new Error(r.data.error.message || r.data.error.data?.message || "Odoo error")
    return r.data.result
  }

  // 2. Count products
  console.log("\n2. Counting Odoo products...")
  const totalCount = await odooCall("product.template", "search_count", [[["active", "=", true], ["sale_ok", "=", true]]])
  console.log(`Total active saleable products in Odoo: ${totalCount}`)

  // 3. Fetch ALL products
  console.log(`\n3. Fetching products (page size: ${PAGE_SIZE})...`)
  const fields = [
    "id", "name", "default_code", "barcode",
    "list_price", "compare_list_price",
    "description_sale", "categ_id", "brand_id", "x_studio_brand_1", "custom_brand_id",
    "weight", "qty_available", "is_published", "website_url",
  ]

  interface OdooProduct {
    id: number; name: string; default_code: string | false; barcode: string | false
    list_price: number; compare_list_price: number
    description_sale: string | false; categ_id: [number, string] | false
    brand_id: [number, string] | false; x_studio_brand_1: string | false; custom_brand_id?: [number, string] | false
    weight: number; qty_available: number; is_published: boolean
    website_url: string | false
  }

  const allProducts: OdooProduct[] = []
  let offset = 0
  while (offset < totalCount) {
    const batch = await odooCall("product.template", "search_read",
      [[["active", "=", true], ["sale_ok", "=", true]]],
      { fields, limit: PAGE_SIZE, offset, order: "id asc" }
    )
    allProducts.push(...batch)
    offset += PAGE_SIZE
    if (offset < totalCount) process.stdout.write(`  Fetched ${allProducts.length}/${totalCount}...\r`)
  }
  console.log(`Fetched ${allProducts.length} products from Odoo`)

  // 4. Prepare MedusaJS DB
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  const existRes = await pg.raw(`SELECT id, handle, metadata->>'odoo_id' as odoo_id FROM product WHERE deleted_at IS NULL`)
  const existingByOdooId = new Map<string, { id: string; handle: string }>()
  const existingHandles = new Set<string>()
  for (const row of existRes.rows || []) {
    if (row.odoo_id) existingByOdooId.set(String(row.odoo_id), { id: row.id, handle: row.handle })
    existingHandles.add(row.handle)
  }

  const skuRes = await pg.raw(`SELECT pv.sku, p.id as product_id FROM product_variant pv JOIN product p ON p.id = pv.product_id WHERE pv.sku IS NOT NULL AND pv.sku != '' AND p.deleted_at IS NULL AND pv.deleted_at IS NULL`)
  const existingBySku = new Map<string, string>()
  for (const row of skuRes.rows || []) existingBySku.set(row.sku.trim(), row.product_id)

  const scRes = await pg.raw(`SELECT id FROM sales_channel WHERE deleted_at IS NULL LIMIT 1`)
  const salesChannelId = scRes.rows?.[0]?.id || null

  console.log(`Existing in MedusaJS: ${existRes.rows?.length || 0} products`)
  console.log(`Sales Channel: ${salesChannelId}`)

  // Load all Medusa categories into a handle->id map for fast lookup
  const catRes = await pg.raw(`SELECT id, handle FROM product_category WHERE deleted_at IS NULL`)
  const categoryByHandle = new Map<string, string>()
  for (const row of catRes.rows || []) categoryByHandle.set(row.handle, row.id)

  // 5. Sync
  console.log(`\n4. Syncing ${allProducts.length} products...`)
  let created = 0, updated = 0, errors = 0

  for (let i = 0; i < allProducts.length; i++) {
    const p = allProducts[i]
    const sku = (p.default_code || `ODOO-${p.id}`).toString().trim()
    const odooIdStr = String(p.id)

    try {
      const brandName = (Array.isArray(p.brand_id) ? p.brand_id[1] : null) || (Array.isArray(p.custom_brand_id) ? p.custom_brand_id[1] : null) || p.x_studio_brand_1 || null;
      const brandOdooId = (Array.isArray(p.custom_brand_id) ? p.custom_brand_id[0] : null) || (Array.isArray(p.brand_id) ? p.brand_id[0] : null) || null;
      const brand = brandName;
      const category = p.categ_id && Array.isArray(p.categ_id) ? p.categ_id[1] : null
      const status = p.is_published === false ? "draft" : "published"

      const metadata = JSON.stringify({
        odoo_id: p.id, odoo_sku: sku, odoo_barcode: p.barcode || null,
        odoo_category: category, odoo_brand: brand,
        odoo_qty: p.qty_available || 0, synced_at: new Date().toISOString(),
      })

      const imageUrl = p.website_url ? `${odooUrl}/web/image/product.template/${p.id}/image_1920` : null
      const existingByOdoo = existingByOdooId.get(odooIdStr)
      const existingProdId = existingByOdoo?.id || existingBySku.get(sku)

      if (existingProdId) {
        await pg.raw(
          `UPDATE product SET title=?, description=?, status=?, weight=?, metadata=?, thumbnail=COALESCE(?,thumbnail), updated_at=NOW() WHERE id=?`,
          [p.name, p.description_sale || "", status, p.weight ? String(p.weight) : null, metadata, imageUrl, existingProdId]
        )
        const vr = await pg.raw(
          `SELECT pvps.price_set_id FROM product_variant pv JOIN product_variant_price_set pvps ON pvps.variant_id=pv.id WHERE pv.product_id=? AND pv.deleted_at IS NULL LIMIT 1`,
          [existingProdId]
        )
        if (vr.rows?.length > 0 && p.list_price > 0) {
          const rawAmt = JSON.stringify({ value: String(p.list_price), precision: 20 })
          await pg.raw(
            `UPDATE price SET amount=?, currency_code=?, raw_amount=?, updated_at=NOW() WHERE price_set_id=? AND deleted_at IS NULL`, 
            [p.list_price, CURRENCY, rawAmt, vr.rows[0].price_set_id]
          )
        }
        // Assign category from Odoo category path
        const catHandle = odooCategoryToHandle(category)
        const catId = catHandle ? categoryByHandle.get(catHandle) : null
        if (catId) {
          await pg.raw(
            `INSERT INTO product_category_product (product_id, product_category_id) VALUES (?, ?) ON CONFLICT DO NOTHING`,
            [existingProdId, catId]
          )
        }
        updated++
      } else {
        let handle = slugify(p.name) || `odoo-${p.id}`
        if (existingHandles.has(handle)) handle = `${handle}-${p.id}`
        if (existingHandles.has(handle)) handle = `${handle}-${Date.now().toString(36)}`
        existingHandles.add(handle)

        const productId = genId("prod")
        await pg.raw(
          `INSERT INTO product (id,title,handle,description,thumbnail,status,weight,metadata,discountable,is_giftcard,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,true,false,NOW(),NOW())`,
          [productId, p.name, handle, p.description_sale || "", imageUrl, status, p.weight ? String(p.weight) : null, metadata]
        )

        const variantId = genId("variant")
        await pg.raw(
          `INSERT INTO product_variant (id,product_id,title,sku,barcode,manage_inventory,allow_backorder,variant_rank,created_at,updated_at) VALUES (?,?,'Default',?,?,true,false,0,NOW(),NOW())`,
          [variantId, productId, sku, p.barcode || null]
        )

        if (p.list_price > 0) {
          const psid = genId("pset")
          await pg.raw(`INSERT INTO price_set (id,created_at,updated_at) VALUES (?,NOW(),NOW())`, [psid])
          await pg.raw(`INSERT INTO product_variant_price_set (id,variant_id,price_set_id,created_at,updated_at) VALUES (?,?,?,NOW(),NOW())`, [genId("pvps"), variantId, psid])
          const rawAmt = JSON.stringify({ value: String(p.list_price), precision: 20 })
          await pg.raw(`INSERT INTO price (id,price_set_id,currency_code,amount,raw_amount,rules_count,created_at,updated_at) VALUES (?,?,?,?,?,0,NOW(),NOW())`, [genId("price"), psid, CURRENCY, p.list_price, rawAmt])
        }

        if (imageUrl) {
          await pg.raw(`INSERT INTO image (id,url,rank,product_id,created_at,updated_at) VALUES (?,?,0,?,NOW(),NOW())`, [genId("img"), imageUrl, productId])
        }

        if (salesChannelId) {
          try { await pg.raw(`INSERT INTO product_sales_channel (id,product_id,sales_channel_id,created_at,updated_at) VALUES (?,?,?,NOW(),NOW()) ON CONFLICT (product_id,sales_channel_id) DO NOTHING`, [genId("psc"), productId, salesChannelId]) } catch {}
        }

        // Assign category from Odoo category path
        const catHandle = odooCategoryToHandle(category)
        const catId = catHandle ? categoryByHandle.get(catHandle) : null
        if (catId) {
          await pg.raw(
            `INSERT INTO product_category_product (product_id, product_category_id) VALUES (?, ?) ON CONFLICT DO NOTHING`,
            [productId, catId]
          )
        }

        existingByOdooId.set(odooIdStr, { id: productId, handle })
        existingBySku.set(sku, productId)
        created++
      }

      const currentProdId = existingProdId || existingByOdooId.get(odooIdStr)?.id || existingBySku.get(sku);

      if (currentProdId) {
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // BRAND SYNC
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        const brandImageUrl = brandOdooId
          ? `${odooUrl.replace(/\/$/, '')}/web/image/custom.product.brand/${brandOdooId}/image_1920`
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
                await pg.raw(`UPDATE brand SET logo_url = ?, updated_at = NOW() WHERE id = ?`, [brandImageUrl, brandId]);
              }
            } else {
              brandId = `brand_${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
              await pg.raw(
                `INSERT INTO brand (id, name, slug, is_active, is_special, logo_url, created_at, updated_at) VALUES (?, ?, ?, true, true, ?, NOW(), NOW())`,
                [brandId, brandName, brandSlug, brandImageUrl]
              );
            }
            // Link product to brand
            const existingLink = await pg.raw(
              `SELECT id FROM product_brand WHERE product_id = ? AND brand_id = ? AND deleted_at IS NULL LIMIT 1`,
              [currentProdId, brandId]
            );
            if (!existingLink.rows?.length) {
              await pg.raw(
                `INSERT INTO product_brand (id, product_id, brand_id, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())`,
                [`pbr_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 8)}`, currentProdId, brandId]
              );
            }
          } catch (brandErr: any) {
            console.warn(`[Odoo Sync Script] Brand sync failed for ${p.name}: ${brandErr.message}`);
          }
        }
      }

      if ((created + updated) % 100 === 0 || i === allProducts.length - 1) {
        process.stdout.write(`  Progress: ${i + 1}/${allProducts.length} (created: ${created}, updated: ${updated})\r`)
      }
    } catch (err: any) {
      errors++
      if (errors <= 15) console.error(`\n  Error [${sku}] ${err.message}`)
    }
  }

  const finalRes = await pg.raw(`SELECT COUNT(*) as c FROM product WHERE status='published' AND deleted_at IS NULL`)
  console.log(`\n\n${"=".repeat(55)}`)
  console.log("SYNC SUMMARY")
  console.log(`${"=".repeat(55)}`)
  console.log(`Created:  ${created}`)
  console.log(`Updated:  ${updated}`)
  console.log(`Errors:   ${errors}`)
  console.log(`Odoo total:      ${allProducts.length}`)
  console.log(`MedusaJS total:  ${finalRes.rows?.[0]?.c || "?"}`)
  console.log("=".repeat(55))
  console.log("Sync complete!\n")
}
