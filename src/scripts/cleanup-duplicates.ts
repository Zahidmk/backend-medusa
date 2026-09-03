import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Script to clean up old standalone variant products (e.g., "PAWA Blender - White", "PAWA Blender - Yellow")
 * that were imported as separate product rows in earlier sync runs before multi-variant grouping was added.
 */
export default async function cleanupDuplicates({ container }: ExecArgs) {
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  console.log("🧹 Starting duplicate standalone variant cleanup...")

  try {
    // 1. Mark old standalone color-suffix products as deleted when a combined template product exists
    const result = await pg.raw(`
      UPDATE product
      SET deleted_at = NOW()
      WHERE deleted_at IS NULL
        AND id IN (
          SELECT p1.id
          FROM product p1
          JOIN product p2 ON LOWER(TRIM(REGEXP_REPLACE(p1.title, '[-:\\s]*(Black|White|Gray|Grey|Yellow|Pink|Blue|Red|Green|Orange|Purple|Navy|Black & Orange)\\s*$', '', 'i'))) = LOWER(TRIM(p2.title))
          WHERE p1.id != p2.id 
            AND p1.deleted_at IS NULL 
            AND p2.deleted_at IS NULL
        )
    `)

    console.log(`✅ Successfully cleaned up ${result.rowCount || 0} duplicate standalone variant product rows!`)

    // 2. Also mark obsolete standalone products that have zero variants or deleted variants
    const emptyProds = await pg.raw(`
      UPDATE product
      SET deleted_at = NOW()
      WHERE deleted_at IS NULL
        AND id NOT IN (
          SELECT DISTINCT product_id 
          FROM product_variant 
          WHERE deleted_at IS NULL
        )
    `)

    console.log(`✅ Soft-deleted ${emptyProds.rowCount || 0} empty product templates with zero variants.`)

  } catch (err: any) {
    console.error("❌ Cleanup failed:", err.message)
  }
}
