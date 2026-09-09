import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Script to enable backorders on all variants so items can be added to cart without inventory block
 * 
 * Run with: npx medusa exec src/scripts/fix-backorders.ts
 */
export default async function fixBackorders({ container }: ExecArgs) {
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  
  console.log("Updating all product variants to enable backorders...")
  
  try {
    const res = await pg.raw(`UPDATE product_variant SET allow_backorder = true WHERE allow_backorder = false OR allow_backorder IS NULL RETURNING id`)
    
    console.log(`✅ Successfully updated ${res.rows?.length || 0} variants!`)
    console.log("Backorders are now enabled (allow_backorder = true) for all products.")
  } catch (err: any) {
    console.error("❌ Failed to update variants:", err.message)
  }
}
