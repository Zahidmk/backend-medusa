import { ExecArgs } from "@medusajs/framework/types"
import orderCreatedHandler from "../subscribers/order-to-odoo"

/**
 * Test script to verify Medusa -> Odoo Sales Order creation
 * 
 * Usage: npx medusa exec ./src/scripts/test-order-sync.ts
 */
export default async function testOrderSync({ container }: ExecArgs) {
  const logger = container.resolve("logger") as any

  logger.info("🧪 Testing Odoo Sales Order creation subscriber...")

  // We fetch a real recent order from Medusa DB if available
  const pgConnection = container.resolve("__pg_connection__") as any
  
  const recentOrder = await pgConnection.raw(
    `SELECT id FROM "order" WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`
  )

  let orderIdToTest: string

  if (recentOrder.rows?.length > 0) {
    orderIdToTest = recentOrder.rows[0].id
    logger.info(`Found existing order in DB to test: ${orderIdToTest}`)
  } else {
    logger.warn("No order found in DB. Please place an order on the storefront or create one.")
    return
  }

  // Trigger the subscriber handler directly
  await orderCreatedHandler({
    event: {
      name: "order.placed",
      data: { id: orderIdToTest },
    },
    container,
  } as any)

  logger.info("🎉 Order sync test complete!")
}
