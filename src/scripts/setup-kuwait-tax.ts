import { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

/**
 * Setup 5% Kuwait VAT in Medusa
 * Run: npx medusa exec ./src/scripts/setup-kuwait-tax.ts
 */
export default async function setupKuwaitTax({ container }: ExecArgs) {
  const logger = container.resolve("logger")
  const taxModuleService = container.resolve(Modules.TAX)

  logger.info("🇰🇼 Setting up 5% Kuwait VAT in Medusa...")

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

    // 2. Check or create 5% VAT Tax Rate
    const existingRates = await taxModuleService.listTaxRates({
      tax_region_id: taxRegion.id,
    })

    if (existingRates.length === 0) {
      logger.info("Creating 5% VAT Tax Rate...")
      const [taxRate] = await taxModuleService.createTaxRates([
        {
          name: "Kuwait VAT",
          rate: 5,
          code: "VAT5",
          tax_region_id: taxRegion.id,
        }
      ])
      logger.info(`✅ Created 5% VAT Rate: ${taxRate.name} (${taxRate.rate}%)`)
    } else {
      logger.info(`✅ Kuwait Tax Rate already exists: ${existingRates[0].name} (${existingRates[0].rate}%)`)
      if (existingRates[0].rate !== 5) {
        await taxModuleService.updateTaxRates(existingRates[0].id, { rate: 5 })
        logger.info(`✅ Updated Kuwait Tax Rate to 5%`)
      }
    }

    logger.info("=" .repeat(50))
    logger.info("🇰🇼 Kuwait VAT setup complete!")
    logger.info("=" .repeat(50))
  } catch (error: any) {
    logger.error(`❌ Failed to setup Kuwait VAT: ${error.message}`)
    console.error(error)
  }
}
