import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

export default async function clearAllBrands({ container }: ExecArgs) {
  const logger = container.resolve("logger");
  const pgConnection = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);

  logger.info("🗑️ Clearing all current brands from Medusa...");

  try {
    // Use raw queries to clean both product_brand and brand efficiently
    await pgConnection.raw('DELETE FROM product_brand');
    logger.info("  ✓ Cleared product_brand mappings");

    await pgConnection.raw('DELETE FROM brand');
    logger.info("  ✓ Cleared all brands");

    logger.info("✅ Successfully cleared all fallback brands!");
    logger.info("You can now trigger Odoo webhooks to populate the brands purely from Odoo.");
  } catch (error: unknown) {
    logger.error("Failed to delete brands:", error as Error);
    throw error;
  }
}
