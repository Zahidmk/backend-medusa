import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Fix missing KWD prices on the "Normal Delivery" and "Night Delivery"
 * shipping options. Both options' shipping_option_price_set link rows
 * pointed at a price_set id that no longer exists (orphaned link), so
 * Medusa rejected them as "Shipping options ... do not have a price" and
 * checkout silently fell back to a different (free) shipping option instead
 * of the one the customer actually selected.
 *
 * Amounts follow this store's existing thousandths convention
 * (amount / 1000 = real KWD value), matching what is already displayed to
 * customers: Normal Delivery = free, Night Delivery = KWD 2.000.
 *
 * Run: npx medusa exec ./src/scripts/fix-delivery-option-prices.ts
 */

const TARGET_PRICES: Record<string, number> = {
  "Normal Delivery": 0,
  "Night Delivery": 2000,
}

export default async function fixDeliveryOptionPrices({ container }: ExecArgs) {
  console.log("\n🚚 Fixing Normal/Night Delivery KWD prices...")

  const fulfillmentModuleService = container.resolve("fulfillment")
  const pricingService = container.resolve("pricing")
  const linkService = container.resolve("link")
  const pgConnection = container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as any

  const shippingOptions = await fulfillmentModuleService.listShippingOptions({
    name: Object.keys(TARGET_PRICES),
  })

  for (const option of shippingOptions) {
    const targetAmount = TARGET_PRICES[option.name]
    console.log(`\nProcessing: ${option.name} (${option.id}) -> target amount ${targetAmount}`)

    const linkRow = await pgConnection.raw(
      `SELECT price_set_id FROM shipping_option_price_set WHERE shipping_option_id = ? LIMIT 1`,
      [option.id]
    )
    const oldPriceSetId = linkRow.rows?.[0]?.price_set_id

    if (oldPriceSetId) {
      const found = await pgConnection.raw(
        `SELECT id FROM price_set WHERE id = ? LIMIT 1`,
        [oldPriceSetId]
      )
      if (found.rows?.length > 0) {
        const existing = await pricingService.listPrices({
          price_set_id: [oldPriceSetId],
          currency_code: ["kwd"],
        })
        if (existing.length > 0) {
          console.log(`  ✅ KWD price already exists: ${existing[0].amount} (leaving as-is)`)
          continue
        }
        await pricingService.addPrices({
          priceSetId: oldPriceSetId,
          prices: [{ amount: targetAmount, currency_code: "kwd" }],
        })
        console.log(`  ✅ Added KWD price to existing price_set: ${targetAmount}`)
        continue
      }
      console.log(`  ⚠️ Linked price_set ${oldPriceSetId} does not exist (orphaned link) - recreating`)
    }

    const priceSet = await pricingService.createPriceSets({
      prices: [{ amount: targetAmount, currency_code: "kwd" }],
    })
    console.log(`  ✅ Created new price_set: ${priceSet.id}`)

    if (oldPriceSetId) {
      await pgConnection.raw(
        `DELETE FROM shipping_option_price_set WHERE shipping_option_id = ? AND price_set_id = ?`,
        [option.id, oldPriceSetId]
      )
    }

    await linkService.create({
      shipping_option_price_set: {
        shipping_option_id: option.id,
        price_set_id: priceSet.id,
      },
    })
    console.log(`  ✅ Linked new price_set to ${option.name}`)
  }

  console.log("\n✅ Done.")
}
