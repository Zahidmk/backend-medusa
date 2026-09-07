import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * Backfills product <-> shipping_profile links for products that are missing
 * the profile actually used by LIVE shipping options.
 *
 * Root cause: Medusa's checkout validation (validate-shipping step) requires
 * item.variant.product.shipping_profile.id to equal the shipping_profile_id of
 * the chosen shipping option. Products created before the shipping profile was
 * wired up (or synced from Odoo before the fix) have no product_shipping_profile
 * row at all, so checkout fails with:
 *   "The cart items require shipping profiles that are not satisfied by the
 *    current shipping methods"
 *
 * Run: npx medusa exec ./src/scripts/fix-product-shipping-profiles.ts
 */
export default async function fixProductShippingProfiles({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const remoteLink = container.resolve(ContainerRegistrationKeys.REMOTE_LINK)

  logger.info("\n🔎 Checking live shipping options and their shipping profiles...")

  const liveOptions = await pg.raw(`
    SELECT so.id, so.name, so.shipping_profile_id, sp.name AS profile_name, sp.type AS profile_type
    FROM shipping_option so
    JOIN shipping_profile sp ON sp.id = so.shipping_profile_id AND sp.deleted_at IS NULL
    WHERE so.deleted_at IS NULL
  `)

  if (!liveOptions.rows?.length) {
    logger.warn("❌ No live shipping options found. Cannot determine which shipping profile products should use.")
    return
  }

  const profileCounts = new Map<string, number>()
  for (const row of liveOptions.rows) {
    profileCounts.set(row.shipping_profile_id, (profileCounts.get(row.shipping_profile_id) || 0) + 1)
    logger.info(`  - "${row.name}" -> profile "${row.profile_name}" (${row.shipping_profile_id}, type=${row.profile_type})`)
  }

  if (profileCounts.size > 1) {
    logger.warn(
      `⚠️ Found ${profileCounts.size} distinct shipping profiles across live shipping options. ` +
      `Every shipping option should normally share ONE profile - mixed profiles will keep causing checkout failures ` +
      `depending on which shipping method the customer picks. Consider re-pointing all shipping options to the same profile.`
    )
  }

  const canonicalProfileId = [...profileCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
  logger.info(`\n✅ Using canonical shipping profile: ${canonicalProfileId} (used by ${profileCounts.get(canonicalProfileId)} live option(s))`)

  const missing = await pg.raw(
    `
    SELECT p.id, p.title
    FROM product p
    WHERE p.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM product_shipping_profile psp
      WHERE psp.product_id = p.id AND psp.shipping_profile_id = ?
    )
    `,
    [canonicalProfileId]
  )

  const rows = missing.rows || []
  logger.info(`\n📦 Found ${rows.length} product(s) missing the canonical shipping profile link.`)

  let fixed = 0
  let failed = 0
  for (const row of rows) {
    try {
      await remoteLink.create({
        [Modules.PRODUCT]: { product_id: row.id },
        [Modules.FULFILLMENT]: { shipping_profile_id: canonicalProfileId },
      })
      fixed++
    } catch (e: any) {
      failed++
      logger.warn(`  ⚠️ Failed to link product ${row.id} (${row.title}): ${e.message}`)
    }
  }

  logger.info(`\n✅ Done. Linked ${fixed} product(s). ${failed ? `${failed} failed - see warnings above.` : ""}`)
}
