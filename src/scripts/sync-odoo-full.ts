/**
 * Full Odoo → MedusaJS Product Sync
 * 
 * This is the MASTER sync script that imports ALL product data from Odoo
 * including brands, categories, variants, attributes, images, SEO, and cross-sell data.
 * 
 * Usage: npx medusa exec ./src/scripts/sync-odoo-full.ts
 * 
 * What it does:
 *  1. Connects to Odoo and fetches ALL product templates with 60+ fields
 *  2. Syncs brands from Odoo → Medusa brands module
 *  3. Syncs categories from Odoo → Medusa categories
 *  4. For each product:
 *     a. Creates/updates the product with all metadata
 *     b. Resolves and syncs variants with attributes (Color, Size, etc.)
 *     c. Downloads and attaches images (main + gallery)
 *     d. Creates pricing records (list_price, compare_price)
 *     e. Sets inventory levels
 *     f. Maps SEO fields, ratings, ribbons, tags
 *     g. Stores cross-sell IDs for frontend resolution
 * 
 * @version 2.0 — March 2026
 */

import { ExecArgs } from "@medusajs/framework/types"
import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import OdooSyncService, {
  OdooProduct,
  OdooBrand,
  OdooVariant,
  OdooAttributeLine,
  OdooAttributeValue,
  OdooProductImage,
  OdooRibbon,
  OdooTag,
} from "../modules/odoo-sync/service"

// ─────────────────────────────────────────────────
//  CONFIGURATION
// ─────────────────────────────────────────────────

const BATCH_SIZE = 50          // Products per batch from Odoo
const MAX_PRODUCTS = 4000      // Safety limit - increased to get more products
const ODOO_BASE_URL = process.env.ODOO_URL || "https://oskarllc-new-31031096.dev.odoo.com"
const DEFAULT_CURRENCY_CODE = "omr"    // Default currency (from Odoo)
const DEFAULT_CURRENCY_DECIMALS = 3    // OMR/KWD have 3 decimal places

// ─────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/(^-|-$)/g, "")
    .substring(0, 100)
}

function toSmallestUnit(amount: number): number {
  // KWD/OMR: 1 unit = 1000 smallest (3 decimal places)
  return Math.round(amount * Math.pow(10, DEFAULT_CURRENCY_DECIMALS))
}

/**
 * Generate a direct Odoo image URL instead of downloading and saving locally.
 * Odoo serves images publicly at: {ODOO_URL}/web/image/{model}/{id}/{field}
 */
function getOdooImageUrl(odooId: number, field: string = "image_1920"): string {
  return `${ODOO_BASE_URL}/web/image/product.template/${odooId}/${field}`
}

function getOdooGalleryImageUrl(imageId: number): string {
  return `${ODOO_BASE_URL}/web/image/product.image/${imageId}/image_1920`
}

function getOdooBrandLogoUrl(brandId: number): string {
  return `${ODOO_BASE_URL}/web/image/product.brand/${brandId}/logo`
}

// ─────────────────────────────────────────────────
//  MAIN SYNC FUNCTION
// ─────────────────────────────────────────────────

export default async function syncOdooFull({ container }: ExecArgs) {
  const logger = container.resolve("logger")
  const productService = container.resolve(Modules.PRODUCT)
  const pricingService = container.resolve(Modules.PRICING)
  const regionService = container.resolve(Modules.REGION)
  const salesChannelService = container.resolve(Modules.SALES_CHANNEL)
  const remoteLink = container.resolve(ContainerRegistrationKeys.REMOTE_LINK)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  let brandService: any
  try {
    brandService = container.resolve("brands")
  } catch {
    logger.warn("⚠️  Brands module not available, will store brand in metadata only")
  }

  console.log("\n" + "═".repeat(60))
  console.log("  🔄 FULL ODOO → MEDUSAJS PRODUCT SYNC")
  console.log("  📅 " + new Date().toISOString())
  console.log("═".repeat(60))

  // ── 1. Initialize Odoo connection ──
  const odoo = new OdooSyncService()
  if (!odoo.isConfigured()) {
    console.error("❌ Odoo not configured. Set ODOO_URL, ODOO_DB_NAME, ODOO_USERNAME, ODOO_API_KEY")
    return
  }

  const connectionTest = await odoo.testConnection()
  if (!connectionTest.success) {
    console.error("❌ Odoo connection failed:", connectionTest.message)
    return
  }
  console.log(`\n✅ Connected to Odoo`)
  console.log(`   📦 Products: ${connectionTest.data.productCount}`)
  console.log(`   📁 Categories: ${connectionTest.data.categoryCount}`)
  console.log(`   🏷️  Brands: ${connectionTest.data.brandCount}`)

  // ── 2. Pre-fetch lookup tables ──
  console.log("\n📋 Loading lookup data from Odoo...")

  // Ribbons (model may not exist on all Odoo instances)
  const ribbonMap = new Map<number, string>()
  try {
    const ribbons = await odoo.fetchRibbons()
    for (const r of ribbons) {
      const text = r.html.replace(/<[^>]*>/g, "").trim()
      ribbonMap.set(r.id, text)
    }
    console.log(`   🎀 Ribbons: ${ribbons.length}`)
  } catch {
    console.log(`   🎀 Ribbons: model not available, skipping`)
  }

  // Brands from Odoo (product.brand may not exist)
  const odooBrandMap = new Map<number, OdooBrand>()
  let odooBrands: OdooBrand[] = []
  try {
    odooBrands = await odoo.fetchBrands()
    for (const b of odooBrands) {
      odooBrandMap.set(b.id, b)
    }
    console.log(`   🏷️  Brands: ${odooBrands.length}`)
  } catch {
    console.log(`   🏷️  Brands: model not available, skipping`)
  }

  // ── 3. Sync brands to Medusa brands module ──
  if (brandService && odooBrands.length > 0) {
    console.log("\n🏷️  Syncing brands...")
    for (const odooBrand of odooBrands) {
      try {
        const slug = slugify(odooBrand.name)
        const existing = await brandService.listBrands({ slug })
        if (existing.length === 0) {
          // Use direct Odoo URL for brand logo
          let logoUrl: string | null = null
          if (odooBrand.logo) {
            logoUrl = getOdooBrandLogoUrl(odooBrand.id)
          }
          await brandService.createBrands({
            name: odooBrand.name,
            slug,
            description: odooBrand.description || null,
            logo_url: logoUrl,
            is_active: true,
          })
          console.log(`   ✅ Created brand: ${odooBrand.name}`)
        }
      } catch (error: any) {
        console.warn(`   ⚠️  Brand "${odooBrand.name}": ${error.message}`)
      }
    }
  }

  // ── 4. Get existing Medusa products (to avoid duplicates) ──
  console.log("\n📊 Loading existing Medusa products...")
  const existingProducts = await productService.listProducts({}, {
    select: ["id", "handle", "metadata"],
    take: 5000,
  })

  const odooIdToMedusaId = new Map<number, string>()
  const existingHandles = new Set<string>()
  for (const p of existingProducts) {
    existingHandles.add(p.handle)
    if (p.metadata?.odoo_id) {
      odooIdToMedusaId.set(Number(p.metadata.odoo_id), p.id)
    }
  }
  console.log(`   📦 Existing products: ${existingProducts.length}`)
  console.log(`   🔗 Already linked to Odoo: ${odooIdToMedusaId.size}`)

  // ── 5. Get default sales channel ──
  const salesChannels = await salesChannelService.listSalesChannels({})
  const defaultSalesChannel = salesChannels[0]
  if (!defaultSalesChannel) {
    console.error("❌ No sales channel found!")
    return
  }

  // ── 6. Get/Create region for KWD ──
  let regions = await regionService.listRegions({})
  let region = regions.find((r: any) => r.currency_code === DEFAULT_CURRENCY_CODE) || regions[0]
  console.log(`   💰 Region: ${region?.name} (${region?.currency_code?.toUpperCase()})`)

  // ── 7. Fetch and sync products in batches ──
  console.log("\n" + "─".repeat(60))
  console.log("  📦 SYNCING PRODUCTS")
  console.log("─".repeat(60))

  let totalCreated = 0
  let totalUpdated = 0
  let totalFailed = 0
  let totalSkipped = 0
  const errors: string[] = []

  let offset = 0
  let hasMore = true

  while (hasMore && offset < MAX_PRODUCTS) {
    // Fetch batch from Odoo
    const batch = await odoo.fetchProducts(BATCH_SIZE, offset)
    if (batch.length === 0) {
      hasMore = false
      break
    }

    console.log(`\n📦 Processing batch ${Math.floor(offset / BATCH_SIZE) + 1} (${batch.length} products, offset ${offset})...`)

    for (const odooProduct of batch) {
      try {
        // Resolve brand name
        let brandName: string | null = null
        if (odooProduct.brand_id && Array.isArray(odooProduct.brand_id)) {
          brandName = odooProduct.brand_id[1]
        } else if (odooProduct.x_studio_brand_1) {
          brandName = odooProduct.x_studio_brand_1 as string
        }

        // Resolve ribbon
        let ribbonText: string | null = null
        if (odooProduct.website_ribbon_id && Array.isArray(odooProduct.website_ribbon_id)) {
          ribbonText = ribbonMap.get(odooProduct.website_ribbon_id[0]) || odooProduct.website_ribbon_id[1]
        }

        // Resolve tags
        let tagNames: string[] = []
        if (odooProduct.product_tag_ids?.length > 0) {
          try {
            const tags = await odoo.fetchTags(odooProduct.product_tag_ids)
            tagNames = tags.map((t: OdooTag) => t.name)
          } catch { /* ignore tag fetch errors */ }
        }

        // Resolve vendors
        let vendors: Array<{ name: string; price: number; currency: string; lead_time: number }> = []
        if (odooProduct.seller_ids?.length > 0) {
          try {
            const vendorRecords = await odoo.fetchVendors(odooProduct.seller_ids)
            vendors = vendorRecords.map((v) => ({
              name: v.partner_id ? v.partner_id[1] : "Unknown",
              price: v.price,
              currency: v.currency_id ? v.currency_id[1] : "KWD",
              lead_time: v.delay || 0,
            }))
          } catch { /* ignore vendor fetch errors */ }
        }

        // Convert to Medusa format
        const medusaData = odoo.convertToMedusaProduct(odooProduct, {
          brandName: brandName || undefined,
          ribbonText: ribbonText || undefined,
          tagNames,
          vendors,
        })

        // Determine currency from product
        const productCurrency = odooProduct.currency_id
          ? odooProduct.currency_id[1].toLowerCase()
          : DEFAULT_CURRENCY_CODE

        // ── Handle variants with attributes ──
        if (odooProduct.product_variant_count > 1 && odooProduct.attribute_line_ids?.length > 0) {
          try {
            // Fetch attribute lines (which attributes the product has)
            const attrLines = await odoo.fetchAttributeLines(odooProduct.attribute_line_ids)

            // Collect all unique value IDs
            const allValueIds = attrLines.flatMap((al: OdooAttributeLine) => al.value_ids)
            const attrValues = await odoo.fetchAttributeValues(allValueIds)
            const valueMap = new Map(attrValues.map((v: OdooAttributeValue) => [v.id, v]))

            // Build Medusa options from attribute lines
            const options: Array<{ title: string; values: string[] }> = []
            for (const line of attrLines) {
              const attrName = line.attribute_id ? line.attribute_id[1] : "Option"
              const values = line.value_ids
                .map((vid: number) => valueMap.get(vid)?.name)
                .filter(Boolean) as string[]
              if (values.length > 0) {
                options.push({ title: attrName, values })
              }
            }

            // Fetch actual variants from Odoo
            const odooVariants = await odoo.fetchVariantsByTemplate(odooProduct.id)

            if (odooVariants.length > 0 && options.length > 0) {
              // Fetch template attribute values to map variant → attribute values
              const allPtavIds = odooVariants.flatMap((v: OdooVariant) => v.product_template_attribute_value_ids || [])
              let ptavMap = new Map<number, any>()
              if (allPtavIds.length > 0) {
                try {
                  const ptavs = await odoo.fetchTemplateAttributeValues(allPtavIds)
                  ptavMap = new Map(ptavs.map((p: any) => [p.id, p]))
                } catch { /* ignore */ }
              }

              // Build variant data for Medusa
              medusaData.options = options.map((o) => ({ title: o.title, values: o.values }))
              medusaData.variants = odooVariants.map((v: OdooVariant) => {
                // Determine which option values this variant has
                const variantOptions: Record<string, string> = {}
                for (const ptavId of (v.product_template_attribute_value_ids || [])) {
                  const ptav = ptavMap.get(ptavId)
                  if (ptav && ptav.attribute_id) {
                    variantOptions[ptav.attribute_id[1]] = ptav.name
                  }
                }

                return {
                  title: v.display_name || "Variant",
                  sku: (v.default_code as string) || `ODOO-${v.id}`,
                  barcode: (v.barcode as string) || undefined,
                  manage_inventory: odooProduct.is_storable || false,
                  allow_backorder: false,
                  inventory_quantity: Math.floor(v.qty_available || 0),
                  weight: v.weight || odooProduct.weight || 0,
                  options: variantOptions,
                  metadata: {
                    odoo_variant_id: v.id,
                    odoo_product_id: odooProduct.id,
                    odoo_price: v.list_price || odooProduct.x_studio_retail_price || odooProduct.list_price || 0,
                    odoo_price_amount: toSmallestUnit(v.list_price || odooProduct.x_studio_retail_price || odooProduct.list_price || 0),
                    odoo_currency: productCurrency,
                    odoo_stock: v.qty_available || 0,
                    odoo_forecasted: v.virtual_available || 0,
                  },
                }
              })
            }
          } catch (variantError: any) {
            console.warn(`   ⚠️  Variant fetch failed for "${odooProduct.name}": ${variantError.message}`)
            // Fall through with default single variant
          }
        }

        // ── Create or Update in Medusa ──
        const existingMedusaId = odooIdToMedusaId.get(odooProduct.id)

        if (existingMedusaId) {
          // UPDATE existing product
          await productService.updateProducts(existingMedusaId, {
            title: medusaData.title,
            subtitle: medusaData.subtitle,
            description: medusaData.description,
            handle: medusaData.handle,
            status: medusaData.status as "published" | "draft",
            weight: medusaData.weight,
            metadata: medusaData.metadata,
          })
          totalUpdated++
          if (totalUpdated % 10 === 0) {
            console.log(`   📝 Updated ${totalUpdated} products...`)
          }
        } else {
          // CREATE new product
          // Ensure handle is unique
          let handle = medusaData.handle
          let counter = 1
          while (existingHandles.has(handle)) {
            handle = `${medusaData.handle}-${counter++}`
          }
          medusaData.handle = handle
          existingHandles.add(handle)

          try {
            const created: any = await productService.createProducts(medusaData as any)
            const createdId = Array.isArray(created) ? created[0]?.id : created?.id
            if (createdId) {
              odooIdToMedusaId.set(odooProduct.id, createdId)
            }
            totalCreated++

            if (totalCreated % 10 === 0) {
              console.log(`   ✅ Created ${totalCreated} products...`)
            }
          } catch (createError: any) {
            // If creation fails (e.g., duplicate handle), try updating handle
            console.warn(`   ⚠️  Create failed for "${odooProduct.name}": ${createError.message}`)
            totalFailed++
            errors.push(`CREATE ${odooProduct.name}: ${createError.message}`)
          }
        }

        // ── Set main image URL (direct from Odoo) ──
        if (odooProduct.image_1920 && typeof odooProduct.image_1920 === "string") {
          try {
            const imageUrl = getOdooImageUrl(odooProduct.id)

            if (imageUrl) {
              const medusaId = odooIdToMedusaId.get(odooProduct.id)
              if (medusaId) {
                await productService.updateProducts(medusaId, {
                  thumbnail: imageUrl,
                  images: [{ url: imageUrl }],
                })
              }
            }
          } catch (imgError: any) {
            // Don't fail the whole product for image errors
            console.warn(`   ⚠️  Image URL failed for "${odooProduct.name}": ${imgError.message}`)
          }
        }

        // ── Set gallery image URLs (direct from Odoo) ──
        if (odooProduct.product_template_image_ids?.length > 0) {
          try {
            const imageUrls: Array<{ url: string }> = []

            // Keep main image first
            const medusaId = odooIdToMedusaId.get(odooProduct.id)
            if (medusaId) {
              const existingProduct = await productService.retrieveProduct(medusaId, { select: ["thumbnail"] })
              if (existingProduct?.thumbnail) {
                imageUrls.push({ url: existingProduct.thumbnail })
              }
            }

            // Add gallery images using direct Odoo URLs
            for (const galleryImgId of odooProduct.product_template_image_ids) {
              const url = getOdooGalleryImageUrl(galleryImgId)
              imageUrls.push({ url })
            }

            if (imageUrls.length > 0 && medusaId) {
              await productService.updateProducts(medusaId, {
                images: imageUrls,
              })
            }
          } catch (galleryError: any) {
            console.warn(`   ⚠️  Gallery images failed for "${odooProduct.name}": ${galleryError.message}`)
          }
        }

        // ── Sync prices via Pricing module ──
        // MedusaJS 2.x: prices must be set via Pricing module, not inline on variants
        const medusaIdForPricing = odooIdToMedusaId.get(odooProduct.id)
        if (medusaIdForPricing) {
          try {
            const fullProduct = await productService.retrieveProduct(medusaIdForPricing, { relations: ["variants"] })
            for (const variant of (fullProduct.variants || [])) {
              const variantMeta = (variant.metadata || {}) as Record<string, any>
              const priceAmount = variantMeta.odoo_price_amount || toSmallestUnit(odooProduct.x_studio_retail_price || odooProduct.list_price || 0)
              const currency = variantMeta.odoo_currency || productCurrency

              const { data: existingLinks } = await query.graph({
                entity: "product_variant",
                fields: ["id", "price_set.*"],
                filters: { id: variant.id },
              })

              if (existingLinks?.[0]?.price_set) {
                try {
                  await pricingService.addPrices([{
                    priceSetId: existingLinks[0].price_set.id,
                    prices: [{ amount: priceAmount, currency_code: currency }],
                  }])
                } catch { /* price may already exist */ }
              } else {
                const [newPriceSet] = await pricingService.createPriceSets([{
                  prices: [{ amount: priceAmount, currency_code: currency }],
                }])
                await remoteLink.create({
                  [Modules.PRODUCT]: { variant_id: variant.id },
                  [Modules.PRICING]: { price_set_id: newPriceSet.id },
                })
              }
            }
          } catch (priceError: any) {
            console.warn(`   ⚠️  Price sync failed for "${odooProduct.name}": ${priceError.message}`)
          }
        }

      } catch (productError: any) {
        totalFailed++
        errors.push(`${odooProduct.name}: ${productError.message}`)
        console.error(`   ❌ Failed: "${odooProduct.name}": ${productError.message}`)
      }
    }

    offset += batch.length
    if (batch.length < BATCH_SIZE) {
      hasMore = false
    }
  }

  // ── 8. Summary ──
  console.log("\n" + "═".repeat(60))
  console.log("  📊 SYNC COMPLETE")
  console.log("═".repeat(60))
  console.log(`   ✅ Created:  ${totalCreated}`)
  console.log(`   📝 Updated:  ${totalUpdated}`)
  console.log(`   ❌ Failed:   ${totalFailed}`)
  console.log(`   ⏭️  Skipped:  ${totalSkipped}`)
  console.log(`   📦 Total:    ${totalCreated + totalUpdated + totalFailed + totalSkipped}`)

  if (errors.length > 0) {
    console.log(`\n   ⚠️  Errors (${errors.length}):`)
    errors.slice(0, 20).forEach((e) => console.log(`      - ${e}`))
    if (errors.length > 20) {
      console.log(`      ... and ${errors.length - 20} more`)
    }
  }

  console.log(`\n   🕐 Completed at: ${new Date().toISOString()}`)
  console.log("═".repeat(60) + "\n")
}
