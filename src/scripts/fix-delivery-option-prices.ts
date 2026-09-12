import { ExecArgs } from "@medusajs/framework/types"

/**
 * Fix missing KWD prices on the "Normal Delivery" and "Night Delivery"
 * shipping options. Both options had a price_set linked but no price rows,
 * so Medusa rejected them as "Shipping options ... do not have a price" and
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
  const pgConnection = container.resolve("pgConnection")

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
    const priceSetId = linkRow.rows?.[0]?.price_set_id
    if (!priceSetId) {
      console.log("  ⚠️ Could not resolve price_set_id, skipping")
      continue
    }

    const existing = await pricingService.listPrices({
      price_set_id: [priceSetId],
      currency_code: ["kwd"],
    })

    if (existing.length > 0) {
      console.log(`  ✅ KWD price already exists: ${existing[0].amount} (leaving as-is)`)
      continue
    }

    await pricingService.addPrices({
      priceSetId,
      prices: [{ amount: targetAmount, currency_code: "kwd" }],
    })
    console.log(`  ✅ Added KWD price: ${targetAmount}`)
  }

  console.log("\n✅ Done.")
}
