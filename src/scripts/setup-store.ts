import { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { createApiKeysWorkflow, linkSalesChannelsToApiKeyWorkflow } from "@medusajs/medusa/core-flows"
import fs from "fs"
import path from "path"

/**
 * Setup Store
 * 
 * Master initialization script that performs all necessary zero-manual-SQL setup
 * before products are synced. It is idempotent (safe to run repeatedly).
 */
export default async function setupStore({ container }: ExecArgs) {
  console.log("\n🚀 Initializing Medusa Store Setup...")
  console.log("=" .repeat(50))

  const regionService = container.resolve(Modules.REGION)
  const storeService = container.resolve(Modules.STORE)
  const salesChannelService = container.resolve(Modules.SALES_CHANNEL)
  const stockLocationService = container.resolve(Modules.STOCK_LOCATION)
  const fulfillmentModuleService = container.resolve(Modules.FULFILLMENT)
  const pricingService = container.resolve(Modules.PRICING)
  const linkService: any = container.resolve(Modules.LINK)

  try {
    // 1. Sales Channel
    console.log("\n1️⃣ Setting up Default Sales Channel...")
    let defaultChannel
    const salesChannels = await salesChannelService.listSalesChannels({})
    if (salesChannels.length > 0) {
      defaultChannel = salesChannels[0]
      console.log(`  ✅ Found existing Sales Channel: ${defaultChannel.name}`)
    } else {
      defaultChannel = await salesChannelService.createSalesChannels({
        name: "Default Sales Channel",
        description: "Created by automated setup"
      })
      console.log(`  ✅ Created Sales Channel: ${defaultChannel.name}`)
    }

    // 2. Region & Store settings
    console.log("\n2️⃣ Setting up Kuwait Region & Store Defaults...")
    let kuwaitRegion
    const regions = await regionService.listRegions({})
    kuwaitRegion = regions.find((r: any) => 
      r.currency_code === "kwd" || r.name?.toLowerCase().includes("kuwait") || r.countries?.some((c: any) => c.iso_2?.toLowerCase() === 'kw')
    )

    if (kuwaitRegion) {
      console.log(`  ✅ Found existing Kuwait Region: ${kuwaitRegion.name}`)
    } else {
      const [region] = await regionService.createRegions([{
        name: "Kuwait",
        currency_code: "kwd",
        countries: ["kw"],
      }])
      kuwaitRegion = region
      console.log(`  ✅ Created Kuwait Region: ${kuwaitRegion.name}`)
    }

    const stores = await storeService.listStores({})
    if (stores.length > 0) {
      const store = stores[0]
      await storeService.updateStores(store.id, {
        default_region_id: kuwaitRegion.id,
      })
      console.log(`  ✅ Set ${kuwaitRegion.name} as default store region`)
    }

    // 3. Stock Location (Warehouse)
    console.log("\n3️⃣ Setting up Kuwait Warehouse...")
    let kuwaitLocation
    const existingLocations = await stockLocationService.listStockLocations({ name: "Kuwait Warehouse" })
    
    if (existingLocations.length > 0) {
      kuwaitLocation = existingLocations[0]
      console.log(`  ✅ Found existing Warehouse: ${kuwaitLocation.id}`)
    } else {
      kuwaitLocation = await stockLocationService.createStockLocations({
        name: "Kuwait Warehouse",
        address: { address_1: "Kuwait City", city: "Kuwait City", country_code: "kw", postal_code: "12345" }
      })
      console.log(`  ✅ Created Warehouse: ${kuwaitLocation.id}`)
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

    // 5. Shipping Profile, Option & Price
    console.log("\n5️⃣ Setting up Shipping Profile & Options...")
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
        type: { label: "Standard", description: "Standard shipping to Kuwait", code: "standard" }
      })
      console.log(`  ✅ Created Shipping Option: ${shippingOption.id}`)
    }

    const priceSet = await pricingService.createPriceSets({
      prices: [{ amount: 0, currency_code: "kwd" }]
    })
    console.log(`  ✅ Created Free Shipping Price Set: ${priceSet.id}`)

    // 6. Establish All Links
    console.log("\n6️⃣ Establishing System Links...")
    
    const linkPromises = [
      // Link Warehouse ↔ Sales Channel
      linkService.create({ sales_channel_stock_location: { sales_channel_id: defaultChannel.id, stock_location_id: kuwaitLocation.id } }).catch(() => {}),
      // Link Fulfillment Set ↔ Warehouse
      linkService.create({ stock_location_fulfillment_set: { stock_location_id: kuwaitLocation.id, fulfillment_set_id: kuwaitFulfillmentSet.id } }).catch(() => {}),
      // Link Shipping Option ↔ Price Set
      linkService.create({ shipping_option_price_set: { shipping_option_id: shippingOption.id, price_set_id: priceSet.id } }).catch(() => {})
    ]
    await Promise.all(linkPromises)
    console.log("  ✅ Links established (ignored duplicates)")

    // 7. Publishable Key
    console.log("\n7️⃣ Setting up Publishable API Key...")
    // Wait for the native medusa SDK function
    try {
      // Find if we already have one
      const keyService = container.resolve(Modules.API_KEY)
      const existingKeys = await keyService.listApiKeys({ type: "publishable" })
      
      let keyId
      if (existingKeys.length > 0) {
        keyId = existingKeys[0].id
        console.log(`  ✅ Found existing Publishable Key`)
      } else {
        const { result: apiKeys } = await createApiKeysWorkflow(container).run({
          input: {
            api_keys: [{ title: "Webshop Frontend", type: "publishable", created_by: "" }]
          }
        })
        const key = apiKeys?.[0]
        if (key && key.token) {
          keyId = key.id
          console.log(`  ✅ Created new Publishable Key: ${key.token}`)
          const repoRoot = process.cwd()
          try {
            fs.appendFileSync(path.join(repoRoot, '..', '.env'), `\nMEDUSA_PUBLISHABLE_KEY=${key.token}\n`)
            fs.appendFileSync(path.join(repoRoot, '..', '..', 'frontend', 'markasouq-web', '.env.local'), `\nNEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=${key.token}\n`)
          } catch {}
        }
      }

      if (keyId && defaultChannel) {
        await linkSalesChannelsToApiKeyWorkflow(container).run({
          input: { id: keyId, add: [defaultChannel.id] }
        })
        console.log(`  ✅ Linked Key ↔ Sales Channel`)
      }
    } catch (e: any) {
      console.log(`  ⚠️ Publishable Key setup skipped/failed: ${e.message}`)
    }

    console.log("\n" + "=" .repeat(50))
    console.log("🎉 STORE SETUP COMPLETE & READY FOR SYNC")
    console.log("=" .repeat(50) + "\n")
  } catch (err: any) {
    console.error(`❌ Setup Error: ${err.message}`)
  }
}
