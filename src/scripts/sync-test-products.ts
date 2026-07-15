/**
 * Sync 2 Test Products from Odoo → MedusaJS
 * 
 * Samsung Galaxy S25 Ultra (ID: 92486) 
 * Marshall Minor III Bluetooth In-Ear Headphone -Black (ID: 84925)
 * 
 * Usage: npx medusa exec ./src/scripts/sync-test-products.ts
 */

import { ExecArgs } from "@medusajs/framework/types"
import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import OdooSyncService, {
  OdooProduct,
  OdooVariant,
  OdooAttributeLine,
  OdooAttributeValue,
  OdooTag,
} from "../modules/odoo-sync/service"

const ODOO_BASE_URL = process.env.ODOO_URL || "https://oskarllc-new-31031096.dev.odoo.com"

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 100)
}

/**
 * Generate a direct Odoo image URL instead of downloading and saving locally.
 */
function getOdooImageUrl(odooId: number): string {
  return `${ODOO_BASE_URL}/web/image/product.template/${odooId}/image_1920`
}

function getOdooGalleryImageUrl(imageId: number): string {
  return `${ODOO_BASE_URL}/web/image/product.image/${imageId}/image_1920`
}

const TEST_PRODUCT_IDS = [92486, 84925]

export default async function syncTestProducts({ container }: ExecArgs) {
  const productService = container.resolve(Modules.PRODUCT)
  const pricingService = container.resolve(Modules.PRICING)
  const remoteLink = container.resolve(ContainerRegistrationKeys.REMOTE_LINK)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  
  console.log("\n" + "═".repeat(60))
  console.log("  🧪 SYNCING 2 TEST PRODUCTS FROM ODOO")
  console.log("═".repeat(60))

  const odoo = new OdooSyncService()
  const authOk = await odoo.authenticate()
  if (!authOk) {
    console.error("❌ Auth failed")
    return
  }

  // Get existing products to check for duplicates
  const existingProducts = await productService.listProducts({}, {
    select: ["id", "handle", "metadata"],
    take: 5000,
  })
  const existingHandles = new Set(existingProducts.map((p: any) => p.handle))
  const odooIdMap = new Map<number, string>()
  for (const p of existingProducts) {
    if (p.metadata?.odoo_id) {
      odooIdMap.set(Number(p.metadata.odoo_id), p.id)
    }
  }

  for (const odooId of TEST_PRODUCT_IDS) {
    console.log(`\n${"─".repeat(60)}`)
    
    try {
      // Fetch product from Odoo
      const odooProduct = await odoo.fetchProductById(odooId)
      if (!odooProduct) {
        console.error(`  ❌ Product ID ${odooId} not found`)
        continue
      }

      console.log(`  📦 ${odooProduct.name} (Odoo ID: ${odooId})`)

      // Resolve brand
      let brandName: string | null = null
      if (Array.isArray(odooProduct.brand_id)) {
        brandName = odooProduct.brand_id[1]
      } else if (odooProduct.x_studio_brand_1 && typeof odooProduct.x_studio_brand_1 === "string") {
        brandName = odooProduct.x_studio_brand_1
      }

      // Resolve tags
      let tagNames: string[] = []
      if (odooProduct.product_tag_ids?.length > 0) {
        try {
          const tags = await odoo.fetchTags(odooProduct.product_tag_ids)
          tagNames = tags.map((t: OdooTag) => t.name)
        } catch { /* ignore */ }
      }

      // Resolve vendors
      let vendors: Array<{ name: string; price: number; currency: string; lead_time: number }> = []
      if (odooProduct.seller_ids?.length > 0) {
        try {
          const vendorRecords = await odoo.fetchVendors(odooProduct.seller_ids)
          vendors = vendorRecords.map(v => ({
            name: v.partner_id ? v.partner_id[1] : "Unknown",
            price: v.price,
            currency: v.currency_id ? v.currency_id[1] : "KWD",
            lead_time: v.delay || 0,
          }))
        } catch { /* ignore */ }
      }

      // Convert to Medusa
      const medusaData = odoo.convertToMedusaProduct(odooProduct, {
        brandName: brandName || undefined,
        tagNames,
        vendors,
      })

      // Determine product currency
      const productCurrency = "kwd"
      const KWD_FILS_DIVISOR = 1000

      // ── Handle variants with attributes ──
      if (odooProduct.product_variant_count > 1 && odooProduct.attribute_line_ids?.length > 0) {
        try {
          const attrLines = await odoo.fetchAttributeLines(odooProduct.attribute_line_ids)
          const allValueIds = attrLines.flatMap((al: OdooAttributeLine) => al.value_ids)
          const attrValues = await odoo.fetchAttributeValues(allValueIds)
          const valueMap = new Map(attrValues.map((v: OdooAttributeValue) => [v.id, v]))

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

          const odooVariants = await odoo.fetchVariantsByTemplate(odooProduct.id)

          if (odooVariants.length > 0 && options.length > 0) {
            const allPtavIds = odooVariants.flatMap((v: OdooVariant) => v.product_template_attribute_value_ids || [])
            let ptavMap = new Map<number, any>()
            if (allPtavIds.length > 0) {
              try {
                const ptavs = await odoo.fetchTemplateAttributeValues(allPtavIds)
                ptavMap = new Map(ptavs.map((p: any) => [p.id, p]))
              } catch { /* ignore */ }
            }

            medusaData.options = options.map((o) => ({ title: o.title, values: o.values }))
            medusaData.variants = odooVariants.map((v: OdooVariant) => {
              const variantOptions: Record<string, string> = {}
              for (const ptavId of (v.product_template_attribute_value_ids || [])) {
                const ptav = ptavMap.get(ptavId)
                if (ptav?.attribute_id) {
                  variantOptions[ptav.attribute_id[1]] = ptav.name
                }
              }

              return {
                title: v.display_name || "Variant",
                sku: (v.default_code as string) || `ODOO-${v.id}`,
                barcode: (v.barcode as string) || undefined,
                manage_inventory: odooProduct.is_storable || false,
                allow_backorder: odooProduct.allow_out_of_stock_order || false,
                inventory_quantity: Math.floor(v.qty_available || 0),
                weight: v.weight || odooProduct.weight || 0,
                options: variantOptions,
                metadata: {
                  odoo_variant_id: v.id,
                  odoo_product_id: odooProduct.id,
                  odoo_price: odooProduct.retail_price || 0,
                  odoo_price_amount: Math.round((odooProduct.retail_price || 0) * KWD_FILS_DIVISOR),
                  odoo_currency: productCurrency,
                  odoo_cost: v.standard_price || odooProduct.standard_price || 0,
                  odoo_stock: v.qty_available || 0,
                  odoo_forecasted: v.virtual_available || 0,
                },
              }
            })

            console.log(`  🎨 Attributes: ${options.map(o => `${o.title}(${o.values.join(",")})`).join(" | ")}`)
            console.log(`  📋 Variants: ${medusaData.variants.length}`)
          }
        } catch (e: any) {
          console.warn(`  ⚠️  Variant fetch failed: ${e.message}`)
        }
      }

      // ── Create or Update ──
      const existingId = odooIdMap.get(odooId)

      if (existingId) {
        // UPDATE
        await productService.updateProducts(existingId, {
          title: medusaData.title,
          subtitle: medusaData.subtitle,
          description: medusaData.description,
          handle: medusaData.handle,
          status: medusaData.status as "published" | "draft",
          weight: medusaData.weight,
          metadata: medusaData.metadata,
        })
        console.log(`  📝 UPDATED (Medusa ID: ${existingId})`)
      } else {
        // CREATE — MedusaJS 2.x: create product first, then add options/variants
        let handle = medusaData.handle
        let counter = 1
        while (existingHandles.has(handle)) {
          handle = `${medusaData.handle}-${counter++}`
        }
        medusaData.handle = handle
        existingHandles.add(handle)

        // Separate options and variants for step-by-step creation
        const productOptions = medusaData.options
        const productVariants = medusaData.variants
        delete medusaData.options

        // Replace variants with a simple default variant (no options reference)
        medusaData.variants = [{
          title: "Default",
          sku: (odooProduct.default_code as string) || `ODOO-${odooProduct.id}`,
          manage_inventory: odooProduct.is_storable || false,
          allow_backorder: odooProduct.allow_out_of_stock_order || false,
          metadata: { odoo_product_id: odooProduct.id },
        }]

        const result: any = await productService.createProducts(medusaData as any)
        const newId = Array.isArray(result) ? result[0]?.id : result?.id
        console.log(`  ✅ CREATED (Medusa ID: ${newId})`)

        if (newId) {
          odooIdMap.set(odooId, newId)

          // Now add options and real variants if product has them
          if (productOptions && productOptions.length > 0 && productVariants && productVariants.length > 0) {
            try {
              // Create options on the product
              for (const opt of productOptions) {
                await productService.createProductOptions({ 
                  product_id: newId, 
                  title: opt.title,
                  values: opt.values,
                })
              }
              console.log(`  🎨 Created ${productOptions.length} options`)

              // Delete the default variant
              const createdProduct = await productService.retrieveProduct(newId, { relations: ["variants"] })
              if (createdProduct.variants?.length > 0) {
                const variantIds = createdProduct.variants.map((v: any) => v.id)
                await productService.deleteProductVariants(variantIds)
              }

              // Create real variants with option values
              for (const variant of productVariants) {
                await productService.createProductVariants({
                  product_id: newId,
                  title: variant.title,
                  sku: variant.sku,
                  barcode: variant.barcode,
                  manage_inventory: variant.manage_inventory,
                  allow_backorder: variant.allow_backorder,
                  weight: variant.weight,
                  options: variant.options, // { color: "Blue", Storage: "512 GB" }
                  metadata: variant.metadata,
                })
              }
              console.log(`  📋 Created ${productVariants.length} variants with options`)
            } catch (varError: any) {
              console.warn(`  ⚠️  Variant/option creation failed: ${varError.message}`)
              console.warn(`     Product was created successfully with default variant`)
            }
          }
        }
      }

      // ── Set images (direct Odoo URLs) ──
      const medusaId = odooIdMap.get(odooId)
      if (medusaId && odooProduct.image_1920 && typeof odooProduct.image_1920 === "string") {
        const imageUrl = getOdooImageUrl(odooProduct.id)
        if (imageUrl) {
          const imageUrls = [{ url: imageUrl }]

          // Gallery images — use direct Odoo URLs
          if (odooProduct.product_template_image_ids?.length > 0) {
            for (const galleryImgId of odooProduct.product_template_image_ids) {
              imageUrls.push({ url: getOdooGalleryImageUrl(galleryImgId) })
            }
          }

          await productService.updateProducts(medusaId, {
            thumbnail: imageUrl,
            images: imageUrls,
          })
          console.log(`  🖼️  Images: ${imageUrls.length} URLs set (main + gallery)`)
        }
      }

      // ── Sync prices via Pricing module ──
      // MedusaJS 2.x: prices are NOT part of variant creation.
      // Must create price sets and link them to variants via RemoteLink.
      if (medusaId) {
        try {
          const fullProduct = await productService.retrieveProduct(medusaId, { relations: ["variants"] })
          let pricesSynced = 0

          for (const variant of (fullProduct.variants || [])) {
            const variantMeta = (variant.metadata || {}) as Record<string, any>
            const priceAmount = variantMeta.odoo_price_amount || Math.round((odooProduct.retail_price || 0) * KWD_FILS_DIVISOR)
            const currency = variantMeta.odoo_currency || productCurrency

            // Check if variant already has a price set linked
            const { data: existingLinks } = await query.graph({
              entity: "product_variant",
              fields: ["id", "price_set.*"],
              filters: { id: variant.id },
            })

            if (existingLinks?.[0]?.price_set) {
              // Update existing price set
              const priceSetId = existingLinks[0].price_set.id
              try {
                await pricingService.addPrices([{
                  priceSetId,
                  prices: [{ amount: priceAmount, currency_code: currency }],
                }])
              } catch { /* price may already exist */ }
            } else {
              // Create new price set and link to variant
              const [newPriceSet] = await pricingService.createPriceSets([{
                prices: [{ amount: priceAmount, currency_code: currency }],
              }])

              await remoteLink.create({
                [Modules.PRODUCT]: { variant_id: variant.id },
                [Modules.PRICING]: { price_set_id: newPriceSet.id },
              })
            }
            pricesSynced++
          }
          console.log(`  💰 Prices: ${pricesSynced} variant prices synced (${productCurrency.toUpperCase()})`)
        } catch (priceError: any) {
          console.warn(`  ⚠️  Price sync failed: ${priceError.message}`)
        }
      }

      // ── Print final metadata summary ──
      console.log(`\n  📊 METADATA SUMMARY (${Object.keys(medusaData.metadata).length} fields):`)
      const meta = medusaData.metadata
      console.log(`     Brand: ${meta.brand || "—"}`)
      console.log(`     Category: ${meta.odoo_category_name || "—"}`)
      console.log(`     Price: ${odooProduct.list_price} ${meta.currency} (compare: ${meta.compare_price}, cost: ${meta.cost_price})`)
      console.log(`     Stock: ${meta.odoo_stock} (forecasted: ${meta.forecasted_qty})`)
      console.log(`     Description: ${medusaData.description ? String(medusaData.description).substring(0, 60) + "..." : "—"}`)
      console.log(`     Ecommerce HTML: ${meta.ecommerce_description ? "✅ present" : "—"}`)
      console.log(`     SEO: title=${meta.seo_title || "—"}, desc=${meta.seo_description || "—"}`)
      console.log(`     Upsell IDs: ${JSON.stringify(meta.upsell_odoo_ids)}`)
      console.log(`     Accessory IDs: ${JSON.stringify(meta.accessory_odoo_ids)}`)
      console.log(`     Alternative IDs: ${JSON.stringify(meta.alternative_odoo_ids)}`)
      console.log(`     Tags: ${meta.tags?.length > 0 ? meta.tags.join(", ") : "—"}`)
      console.log(`     Vendors: ${meta.vendors?.length > 0 ? meta.vendors.map((v: any) => v.name).join(", ") : "—"}`)
      console.log(`     Ribbon: ${meta.ribbon || "—"}`)
      console.log(`     Rating: ${meta.rating}/5 (${meta.reviews_count} reviews)`)
      console.log(`     Variants: ${meta.variant_count}`)
      console.log(`     Gallery images: ${meta.gallery_image_ids?.length || 0}`)
      console.log(`     Status: ${medusaData.status}`)
      console.log(`     Handle: ${medusaData.handle}`)

    } catch (error: any) {
      console.error(`  ❌ Error syncing product ${odooId}: ${error.message}`)
      if (error.stack) console.error(error.stack.split("\n").slice(0, 5).join("\n"))
    }
  }

  console.log("\n" + "═".repeat(60))
  console.log("  ✅ TEST SYNC COMPLETE")
  console.log("═".repeat(60) + "\n")
}
