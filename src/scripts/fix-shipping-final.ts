import { ExecArgs } from "@medusajs/framework/types"

export default async function fixShippingFinal({ container }: ExecArgs) {
  console.log("\n🚚 Fixing Kuwait Shipping Final...")
  
  const fulfillmentModuleService = container.resolve("fulfillment")
  const stockLocationService = container.resolve("stock_location")
  const salesChannelService = container.resolve("sales_channel")
  const linkService = container.resolve("link")
  const pricingService = container.resolve("pricing")

  try {
    // 1. Ensure sales channel is linked to stock location
    const salesChannels = await salesChannelService.listSalesChannels({})
    const defaultChannel = salesChannels[0]
    
    const locations = await stockLocationService.listStockLocations({ name: "Kuwait Warehouse" })
    const kuwaitLocation = locations[0]

    if (defaultChannel && kuwaitLocation) {
      try {
        await linkService.create({
          sales_channel_stock_location: {
            sales_channel_id: defaultChannel.id,
            stock_location_id: kuwaitLocation.id
          }
        })
        console.log("✅ Linked Sales Channel to Kuwait Warehouse")
      } catch (e: any) {
        console.log(`ℹ️ Sales Channel <-> Location Link: ${e.message.includes('already exists') ? 'Already exists' : e.message}`)
      }
    }

    // 2. Fetch the shipping option
    const shippingOptions = await fulfillmentModuleService.listShippingOptions({
      name: "Kuwait Standard Shipping"
    })

    if (shippingOptions.length > 0) {
      const option = shippingOptions[0]
      console.log(`✅ Found Shipping Option: ${option.id}`)

      // 3. Remove restrictive rules that block checkout
      const rules = await fulfillmentModuleService.listShippingOptionRules({
        shipping_option_id: option.id
      })
      
      for (const rule of rules) {
        if (rule.attribute === "enabled_in_store") {
          console.log(`🗑️ Removing restrictive rule: ${rule.attribute}`)
          await fulfillmentModuleService.deleteShippingOptionRules(rule.id)
        }
      }

      // 4. Ensure price is linked
      try {
        const priceSet = await pricingService.createPriceSets({
          prices: [{ amount: 0, currency_code: "kwd" }]
        })
        await linkService.create({
          shipping_option_price_set: {
            shipping_option_id: option.id,
            price_set_id: priceSet.id
          }
        })
        console.log("✅ Linked Free Shipping Price to Option")
      } catch (e: any) {
        console.log(`ℹ️ Price Link: ${e.message.includes('already exists') ? 'Already exists' : e.message}`)
      }

      // 5. Check fulfillment set links
      const fulfillmentSets = await fulfillmentModuleService.listFulfillmentSets({ name: "Kuwait Fulfillment" })
      if (fulfillmentSets.length > 0 && kuwaitLocation) {
        try {
          await linkService.create({
            stock_location_fulfillment_set: {
              stock_location_id: kuwaitLocation.id,
              fulfillment_set_id: fulfillmentSets[0].id
            }
          })
          console.log("✅ Linked Fulfillment Set to Location")
        } catch (e: any) {
          console.log(`ℹ️ Fulfillment Link: ${e.message.includes('already exists') ? 'Already exists' : e.message}`)
        }
      }
    } else {
      console.log("❌ Kuwait Standard Shipping option not found! Make sure you ran setup-kuwait-shipping.ts")
    }

    console.log("\n✅ Fix complete! Please try refreshing your checkout page.")
  } catch (err: any) {
    console.error(`❌ Error: ${err.message}`)
  }
}
