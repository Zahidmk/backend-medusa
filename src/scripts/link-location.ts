import { ExecArgs } from "@medusajs/framework/types"
import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils"

export default async function linkSalesChannelLocation({ container }: ExecArgs) {
  const logger = container.resolve("logger")
  const salesChannelService = container.resolve(Modules.SALES_CHANNEL)
  const stockLocationService = container.resolve(Modules.STOCK_LOCATION)
  const remoteLink = container.resolve(ContainerRegistrationKeys.REMOTE_LINK)

  let salesChannels: any[] = []
  let stockLocations: any[] = []

  try {
    salesChannels = await salesChannelService.listSalesChannels({})
    if (!salesChannels.length) {
      logger.error("No sales channels found")
      return
    }
    const salesChannel = salesChannels[0]

    stockLocations = await stockLocationService.listStockLocations({})
    if (!stockLocations.length) {
      logger.info("No stock locations found, creating one...")
      const created = await stockLocationService.createStockLocations({
        name: "Default Location",
      })
      stockLocations = [created]
    }
    const stockLocation = stockLocations[0]

    logger.info(`Linking Sales Channel ${salesChannel.id} to Stock Location ${stockLocation.id}...`)

    await remoteLink.create({
      [Modules.SALES_CHANNEL]: {
        sales_channel_id: salesChannel.id,
      },
      [Modules.STOCK_LOCATION]: {
        stock_location_id: stockLocation.id,
      },
    })
    logger.info("Successfully linked sales channel and stock location!")
  } catch (error: any) {
    logger.error("Error linking: " + error.message)
    // fallback attempt with different keys
    if (salesChannels.length > 0 && stockLocations.length > 0) {
      try {
          await remoteLink.create({
              salesChannelService: {
                sales_channel_id: salesChannels[0].id,
              },
              stockLocationService: {
                stock_location_id: stockLocations[0].id,
              },
          })
          logger.info("Successfully linked using fallback keys!")
      } catch(e: any) {
          logger.error("Fallback error: " + e.message)
      }
    }
  }
}
