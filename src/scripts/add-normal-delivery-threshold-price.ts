import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Add a cart-total-based price rule to "Normal Delivery" so it correctly
 * charges KWD 1.000 when the item subtotal is below KWD 7.000, and stays
 * free (the existing default price) at or above that threshold - matching
 * the shipping_policy already advertised to customers
 * (FREE_DELIVERY_THRESHOLD_KWD=7, SHIPPING_CHARGE_BELOW_THRESHOLD_KWD=1).
 *
 * Uses Medusa's native shipping-option price rules (added in v2.1.1) which
 * match against the cart's `item_total` at checkout time - no custom
 * fulfillment provider needed. The existing rule-less price (amount 0)
 * stays as the default for carts at/above the threshold; this adds a more
 * specific rule-scoped price (amount 1000) for carts below it.
 *
 * Run: npx medusa exec ./src/scripts/add-normal-delivery-threshold-price.ts
 */

const NORMAL_DELIVERY_ID = "so_01KYAHXR1ER9FYJ3NK7PZC5TSQ"
const FREE_THRESHOLD = Number(process.env.FREE_DELIVERY_THRESHOLD_KWD || 7) * 1000
const CHARGE_BELOW_THRESHOLD = Number(process.env.SHIPPING_CHARGE_BELOW_THRESHOLD_KWD || 1) * 1000

export default async function addNormalDeliveryThresholdPrice({ container }: ExecArgs) {
  console.log("\n💵 Adding threshold-based price rule to Normal Delivery...")

  const pricingService = container.resolve("pricing")
  const pgConnection = container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as any

  const linkRow = await pgConnection.raw(
    `SELECT price_set_id FROM shipping_option_price_set WHERE shipping_option_id = ? LIMIT 1`,
    [NORMAL_DELIVERY_ID]
  )
  const priceSetId = linkRow.rows?.[0]?.price_set_id
  if (!priceSetId) {
    console.log("  ⚠️ Could not resolve price_set_id for Normal Delivery, aborting")
    return
  }
  console.log(`  Price set: ${priceSetId}`)

  const existing = await pricingService.listPrices(
    { price_set_id: [priceSetId], currency_code: ["kwd"] },
    { relations: ["price_rules"] }
  )
  console.log(`  Existing KWD prices: ${JSON.stringify(existing.map((p: any) => ({ amount: p.amount, rules: p.price_rules?.map((r: any) => `${r.attribute} ${r.value}`) })))}`)

  const alreadyHasRule = existing.some((p: any) =>
    (p.price_rules || []).some((r: any) => r.attribute === "item_total")
  )
  if (alreadyHasRule) {
    console.log("  ✅ A price rule on item_total already exists, leaving as-is")
    return
  }

  await pricingService.addPrices({
    priceSetId,
    prices: [
      {
        amount: CHARGE_BELOW_THRESHOLD,
        currency_code: "kwd",
        rules: {
          item_total: [{ operator: "lt", value: FREE_THRESHOLD }],
        },
      },
    ],
  })

  console.log(`  ✅ Added rule: item_total < ${FREE_THRESHOLD} -> amount ${CHARGE_BELOW_THRESHOLD}`)
  console.log("\n✅ Done.")
}
