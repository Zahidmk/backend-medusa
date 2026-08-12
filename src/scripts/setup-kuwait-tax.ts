import { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

/**
 * Setup 0% (No Tax/VAT) for Kuwait in Medusa
 * Run: npx medusa exec ./src/scripts/setup-kuwait-tax.ts
 */
export default async function setupKuwaitTax({ container }: ExecArgs) {
  const logger = container.resolve("logger")
  const taxModuleService = container.resolve(Modules.TAX)

  logger.info("🇰🇼 Setting up 0% (No Tax/VAT) for Kuwait in Medusa...")

  try {
    // 1. Check or create Tax Region for Kuwait (KW)
    let taxRegions = await taxModuleService.listTaxRegions({
      country_code: "kw",
    })

    let taxRegion = taxRegions[0]

    if (!taxRegion) {
      logger.info("Creating Kuwait Tax Region (kw)...")
      taxRegion = await taxModuleService.createTaxRegions({
        country_code: "kw",
        provider_id: "tp_system",
      })
      logger.info(`✅ Kuwait Tax Region created: ${taxRegion.id}`)
    } else {
      logger.info(`Kuwait Tax Region found: ${taxRegion.id}`)
    }

    // 2. Check or create 0% Tax Rate
    const existingRates = await taxModuleService.listTaxRates({
      tax_region_id: taxRegion.id,
    })

    if (existingRates.length === 0) {
      logger.info("Creating 0% No Tax Rate...")
      const [taxRate] = await taxModuleService.createTaxRates([
        {
          name: "No Tax",
          rate: 0,
          code: "TAX0",
          tax_region_id: taxRegion.id,
          is_default: true,
        }
      ])
      logger.info(`✅ Created 0% Rate: ${taxRate.name} (${taxRate.rate}%)`)
    } else {
      logger.info(`Updating existing tax rates to 0% (No Tax)...`)
      for (const rate of existingRates) {
        await taxModuleService.updateTaxRates(rate.id, {
          name: "No Tax",
          rate: 0,
          code: "TAX0",
          is_default: true,
        })
        logger.info(`✅ Updated Tax Rate ${rate.id} (${rate.name}) -> 0% No Tax`)
      }
    }

    logger.info("=" .repeat(50))
    logger.info("🇰🇼 Kuwait 0% Tax setup complete! (No VAT / Tax free)")
    logger.info("=" .repeat(50))
  } catch (error: any) {
    logger.error(`❌ Failed to setup Kuwait VAT: ${error.message}`)
    console.error(error)
  }
}
