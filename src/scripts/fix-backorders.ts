import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Script to disable backorders on all variants
 * 
 * Run with: npx medusa exec src/scripts/fix-backorders.ts
 */
export default async function fixBackorders({ container }: ExecArgs) {
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  
  console.log("Updating all product variants to disable backorders...")
  
  try {
    const res = await pg.raw(`UPDATE product_variant SET allow_backorder = false WHERE allow_backorder = true RETURNING id`)
    
    console.log(`✅ Successfully updated ${res.rows?.length || 0} variants!`)
    console.log("Backorders are now disabled (allow_backorder = false) for all products.")
  } catch (err: any) {
    console.error("❌ Failed to update variants:", err.message)
  }
}
