import { ExecArgs } from "@medusajs/framework/types"

export default async function setupKuwaitShipping({ container }: ExecArgs) {
  console.log("\n🚚 Setting up Full Kuwait Shipping...")
  console.log("=".repeat(50))
  
  const regionService = container.resolve("region")
  const stockLocationService = container.resolve("stock_location")
  const fulfillmentModuleService = container.resolve("fulfillment")
  const salesChannelService = container.resolve("sales_channel")
  const pricingService = container.resolve("pricing")
  const linkService: any = container.resolve("link")
  
  try {
    // 1. Kuwait Stock Location
    console.log("\n1️⃣ Setting up Kuwait Stock Location...")
    let kuwaitLocation
    const existingLocations = await stockLocationService.listStockLocations({ name: "Kuwait Warehouse" })
    
    if (existingLocations.length > 0) {
      kuwaitLocation = existingLocations[0]
      console.log(`  ✅ Found existing Kuwait Warehouse: ${kuwaitLocation.id}`)
    } else {
      kuwaitLocation = await stockLocationService.createStockLocations({
        name: "Kuwait Warehouse",
        address: { address_1: "Kuwait City", city: "Kuwait City", country_code: "kw", postal_code: "12345" }
      })
      console.log(`  ✅ Created Kuwait Warehouse: ${kuwaitLocation.id}`)
    }

    // 2. Sales Channel Link
    console.log("\n2️⃣ Linking Sales Channel ↔ Stock Location...")
    const salesChannels = await salesChannelService.listSalesChannels({})
    const defaultChannel = salesChannels[0]
    
    if (defaultChannel) {
      try {
        await linkService.create({
          sales_channel_stock_location: {
            sales_channel_id: defaultChannel.id,
            stock_location_id: kuwaitLocation.id
          }
        })
        console.log(`  ✅ Linked Sales Channel (${defaultChannel.id}) ↔ Stock Location`)
      } catch (e: any) {
        console.log(`  ℹ️ Sales Channel Link: ${e.message.includes('already exists') ? 'Already exists' : e.message}`)
      }
    }
    
    // 3. Shipping Profile
    console.log("\n3️⃣ Setting up Shipping Profile...")
    let defaultProfile
    const shippingProfiles = await fulfillmentModuleService.listShippingProfiles({ name: "Default" })
    if (shippingProfiles.length > 0) {
      defaultProfile = shippingProfiles[0]
      console.log(`  ✅ Found existing Shipping Profile: ${defaultProfile.id}`)
    } else {
      defaultProfile = await fulfillmentModuleService.createShippingProfiles({
        name: "Default",
        type: "default"
      })
      console.log(`  ✅ Created Shipping Profile: ${defaultProfile.id}`)
    }

    // 4. Fulfillment Set & Service Zone
    console.log("\n4️⃣ Setting up Fulfillment Set & Service Zone...")
    let kuwaitFulfillmentSet
    const fulfillmentSets = await fulfillmentModuleService.listFulfillmentSets({ name: "Kuwait Fulfillment" })
    if (fulfillmentSets.length > 0) {
      kuwaitFulfillmentSet = fulfillmentSets[0]
      console.log(`  ✅ Found Fulfillment Set: ${kuwaitFulfillmentSet.id}`)
    } else {
      kuwaitFulfillmentSet = await fulfillmentModuleService.createFulfillmentSets({
        name: "Kuwait Fulfillment",
        type: "shipping"
      })
      console.log(`  ✅ Created Fulfillment Set: ${kuwaitFulfillmentSet.id}`)
    }

    try {
      await linkService.create({
        stock_location_fulfillment_set: {
          stock_location_id: kuwaitLocation.id,
          fulfillment_set_id: kuwaitFulfillmentSet.id
        }
      })
      console.log("  ✅ Linked Fulfillment Set ↔ Stock Location")
    } catch (e: any) {
      console.log(`  ℹ️ Fulfillment Link: ${e.message.includes('already exists') ? 'Already exists' : e.message}`)
    }

    let kuwaitServiceZone
    const serviceZones = await fulfillmentModuleService.listServiceZones({ name: "Kuwait Zone" })
    if (serviceZones.length > 0) {
      kuwaitServiceZone = serviceZones[0]
      console.log(`  ✅ Found Service Zone: ${kuwaitServiceZone.id}`)
    } else {
      kuwaitServiceZone = await fulfillmentModuleService.createServiceZones({
        name: "Kuwait Zone",
        fulfillment_set_id: kuwaitFulfillmentSet.id,
        geo_zones: [{ type: "country", country_code: "kw" }]
      })
      console.log(`  ✅ Created Service Zone: ${kuwaitServiceZone.id}`)
    }

    // 5. Shipping Option & Price Set Link
    console.log("\n5️⃣ Setting up Shipping Option & Price Set...")
    let shippingOption
    const existingOptions = await fulfillmentModuleService.listShippingOptions({ name: "Kuwait Standard Shipping" })
    
    if (existingOptions.length > 0) {
      shippingOption = existingOptions[0]
      console.log(`  ✅ Found Shipping Option: ${shippingOption.id}`)
    } else {
      shippingOption = await fulfillmentModuleService.createShippingOptions({
        name: "Kuwait Standard Shipping",
        price_type: "flat",
        service_zone_id: kuwaitServiceZone.id,
        shipping_profile_id: defaultProfile.id,
        provider_id: "manual_manual",
        type: {
          label: "Standard",
          description: "Standard shipping to Kuwait (2-3 days)",
          code: "standard"
        }
      })
      console.log(`  ✅ Created Shipping Option: ${shippingOption.id}`)
    }

    // Always ensure price set is created and linked
    const priceSet = await pricingService.createPriceSets({
      prices: [{ amount: 0, currency_code: "kwd" }] // Free shipping
    })
    console.log(`  ✅ Created Free Shipping Price Set: ${priceSet.id}`)

    try {
      await linkService.create({
        shipping_option_price_set: {
          shipping_option_id: shippingOption.id,
          price_set_id: priceSet.id
        }
      })
      console.log("  ✅ Linked Shipping Option ↔ Price Set")
    } catch (e: any) {
      console.log(`  ℹ️ Price Link: ${e.message.includes('already exists') ? 'Already exists' : e.message}`)
    }

    console.log("\n✅ Setup complete! All links established.")
  } catch (err: any) {
    console.error(`❌ Setup Error: ${err.message}`)
  }
}
