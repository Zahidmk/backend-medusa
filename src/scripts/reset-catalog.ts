import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Script to wipe product, variant, category, brand, image, price, and inventory catalog tables
 * in Medusa PostgreSQL database so a 100% fresh sync can be performed from Odoo.
 */
export default async function resetCatalog({ container }: ExecArgs) {
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  console.log("⚠️ Wiping Medusa catalog tables for a 100% fresh Odoo import...")

  try {
    // Truncate product catalog tables with CASCADE to prevent foreign key errors
    await pg.raw(`
      TRUNCATE TABLE 
        product_variant_price_set,
        product_variant_inventory_item,
        product_option_value,
        product_option,
        product_variant,
        product_category_product,
        product_category,
        product_sales_channel,
        product_brand,
        brand,
        image,
        price,
        price_set,
        inventory_level,
        inventory_item,
        product
      CASCADE;
    `)

    console.log("✨ Successfully cleared all product, variant, category, brand, and pricing data from Medusa DB!")
  } catch (err: any) {
    console.error("❌ Failed to wipe catalog tables:", err.message)
  }
}
