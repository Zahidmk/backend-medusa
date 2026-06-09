import { ExecArgs } from '@medusajs/framework/types'
import { Modules, ContainerRegistrationKeys } from '@medusajs/framework/utils'
import OdooSyncService from '../modules/odoo-sync/service'

export default async function fixMissingPrices({ container }: ExecArgs) {
  const logger = container.resolve('logger')
  const pricingService = container.resolve(Modules.PRICING)
  const remoteLink = container.resolve(ContainerRegistrationKeys.REMOTE_LINK)
  const pgConnection = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  logger.info('🔄 Fetching missing prices from Odoo...')

  const missingResult = await pgConnection.raw(`
    SELECT p.id as product_id, pv.id as variant_id, p.metadata->>'odoo_id' as odoo_id, pv.title, p.title as product_title
    FROM product_variant pv
    JOIN product p ON p.id = pv.product_id
    LEFT JOIN product_variant_price_set pvps ON pvps.variant_id = pv.id
    WHERE pvps.price_set_id IS NULL AND p.status = 'published' AND pv.deleted_at IS NULL
  `)

  const missingVariants = missingResult.rows
  logger.info(`Found ${missingVariants.length} variants missing prices.`)

  const odoo = new OdooSyncService()
  let successCount = 0
  let errorCount = 0

  for (const item of missingVariants) {
    if (!item.odoo_id) continue
    
    try {
      const odooProduct = await odoo.fetchProductById(Number(item.odoo_id))
      if (!odooProduct) {
         logger.warn(`⚠️ Odoo product not found for ${item.product_title}`)
         continue
      }
      
      const price = odooProduct.list_price || odooProduct.lst_price || 0
      
      if (price > 0) {
        const priceSet = await pricingService.createPriceSets({
          prices: [{ amount: price, currency_code: 'kwd' }],
        })
        await remoteLink.create({
          [Modules.PRODUCT]: { variant_id: item.variant_id },
          [Modules.PRICING]: { price_set_id: priceSet.id },
        })
        successCount++
        logger.info(`✅ Synced price ${price} for ${item.product_title}`)
      } else {
        logger.warn(`⚠️ Odoo returned 0 price for ${item.product_title}`)
      }
    } catch (e: any) {
      errorCount++
      logger.error(`❌ Failed to sync price for ${item.product_title}: ${e.message}`)
    }
  }

  logger.info(`Done! ✅ Success: ${successCount}, ❌ Errors: ${errorCount}`)
}
