/**
 * Sync Odoo Prices to Medusa Pricing Module
 * 
 * This script reads odoo_price from variant metadata and creates
 * proper Medusa price records so products can be added to cart.
 * 
 * Usage: npx medusa exec ./src/scripts/sync-odoo-prices.ts
 */

import { ExecArgs } from "@medusajs/framework/types"
import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils"

export default async function syncOdooPrices({ container }: ExecArgs) {
  const logger = container.resolve("logger")
  const productService = container.resolve(Modules.PRODUCT)
  const pricingService = container.resolve(Modules.PRICING)
  const regionService = container.resolve(Modules.REGION)
  const remoteLink = container.resolve(ContainerRegistrationKeys.REMOTE_LINK)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  logger.info("🔄 Starting Odoo price sync to Medusa pricing module...")

  try {
    // Get or create default region for Kuwait
    let regions = await regionService.listRegions({})
    let region = regions.find(r => r.currency_code === "kwd") || regions[0]
    
    if (!region) {
      logger.info("Creating Kuwait region...")
      const [createdRegion] = await regionService.createRegions([{
        name: "Kuwait",
        currency_code: "kwd",
        countries: ["kw"],
      }])
      region = createdRegion
    }
    
    logger.info(`Using region: ${region.name} (${region.currency_code.toUpperCase()})`)

    // Get all products with variants
    const products = await productService.listProducts(
      {},
      {
        relations: ["variants"],
        take: 1000,
      }
    )

    logger.info(`Found ${products.length} products to process`)

    let successCount = 0
    let skippedCount = 0
    let errorCount = 0

    for (const product of products) {
      for (const variant of product.variants || []) {
        try {
          // Get price from metadata
          const metadata = variant.metadata as Record<string, any> || {}
          let odooPrice = metadata.odoo_price
          
          // If no odoo_price, set a default price of 10 KWD for soft launch
          if (!odooPrice && odooPrice !== 0) {
            odooPrice = 10.000 // Default 10 KWD
            logger.warn(`No odoo_price for variant ${variant.id} (${variant.sku || 'no-sku'}), using default 10 KWD`)
          }

          // Convert price to smallest unit (fils for KWD - 1 KWD = 1000 fils)
          // KWD uses 3 decimal places unlike most currencies that use 2
          const priceAmount = Math.round(parseFloat(odooPrice) * 1000)

          // Check if variant already has a price set linked
          const { data: existingLinks } = await query.graph({
            entity: "product_variant",
            fields: ["id", "price_set.*"],
            filters: { id: variant.id },
          })

          if (existingLinks?.[0]?.price_set) {
            // Price set already linked, add/update price
            const priceSetId = existingLinks[0].price_set.id
            logger.info(`Variant ${variant.sku} already has price set ${priceSetId}, updating...`)
            
            // Add new price (will be added if currency doesn't exist)
            try {
              await pricingService.addPrices([{
                priceSetId: priceSetId,
                prices: [{
                  amount: priceAmount,
                  currency_code: region.currency_code,
                }]
              }])
              logger.info(`Updated price for ${variant.sku}: ${odooPrice} ${region.currency_code}`)
            } catch (addError: any) {
              // Price might already exist, that's okay
              logger.warn(`Could not add price for ${variant.sku}: ${addError.message}`)
            }
          } else {
            // Create new price set with price
            const [newPriceSet] = await pricingService.createPriceSets([{
              prices: [{
                amount: priceAmount,
                currency_code: region.currency_code,
              }]
            }])

            // Link price set to variant using remote link
            await remoteLink.create({
              [Modules.PRODUCT]: {
                variant_id: variant.id,
              },
              [Modules.PRICING]: {
                price_set_id: newPriceSet.id,
              },
            })
            
            logger.info(`Created price set for ${variant.sku}: ${odooPrice} ${region.currency_code}`)
          }

          successCount++
        } catch (variantError: any) {
          logger.error(`Error processing variant ${variant.id}: ${variantError.message}`)
          errorCount++
        }
      }
    }

    logger.info("=".repeat(50))
    logger.info("📊 Price Sync Summary:")
    logger.info(`   ✅ Success: ${successCount}`)
    logger.info(`   ⏭️  Skipped (no price): ${skippedCount}`)
    logger.info(`   ❌ Errors: ${errorCount}`)
    logger.info("=".repeat(50))

  } catch (error: any) {
    logger.error(`Failed to sync prices: ${error.message}`)
    throw error
  }
}
