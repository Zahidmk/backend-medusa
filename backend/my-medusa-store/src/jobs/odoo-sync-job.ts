/**
 * Odoo Auto-Sync Job (v2)
 *
 * Runs every 5 minutes. Fetches products modified since last sync
 * and creates/updates them in MedusaJS with ALL metadata fields.
 * Prices are synced via the Pricing module (not inline on variants).
 */
import {
  MedusaContainer,
} from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils";

export default async function odooSyncJob(container: MedusaContainer) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const pgConnection = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const productService = container.resolve(Modules.PRODUCT);
  const pricingService = container.resolve(Modules.PRICING);
  const remoteLink = container.resolve(ContainerRegistrationKeys.REMOTE_LINK);

  let odooSyncService: any;
  try {
    odooSyncService = container.resolve("odooSyncService");
  } catch {
    logger.warn("[Odoo Sync Job] OdooSyncService not registered, skipping.");
    return;
  }

  logger.info("[Odoo Sync Job] Starting delta sync...");

  try {
    // Get last sync timestamp from system_config
    let lastSync: string | null = null;
    try {
      const result = await pgConnection.raw(
        `SELECT value FROM system_config WHERE key = ?`,
        ["odoo_last_sync"]
      );
      if (result.rows?.length > 0) {
        lastSync = result.rows[0].value;
      }
    } catch {
      // Table may not exist yet
      try {
        await pgConnection.raw(`
          CREATE TABLE IF NOT EXISTS system_config (
            key VARCHAR(255) PRIMARY KEY,
            value TEXT,
            updated_at TIMESTAMP DEFAULT NOW()
          )
        `);
      } catch {
        logger.warn("[Odoo Sync Job] Could not create system_config table");
      }
    }

    // Fetch products modified since last sync
    const products = await odooSyncService.fetchProductsSince(lastSync);

    if (!products || products.length === 0) {
      logger.info("[Odoo Sync Job] No new/updated products found.");
      await updateLastSync(pgConnection, logger);
      return;
    }

    logger.info(`[Odoo Sync Job] Found ${products.length} products to sync.`);

    let created = 0;
    let updated = 0;
    let errors = 0;

    for (const odooProduct of products) {
      try {
        const medusaData = odooSyncService.convertToMedusaProduct(odooProduct);

        // Check if product exists by odoo_id
        const existing = await productService.listProducts(
          {} as any,
          { select: ["id", "metadata"], take: 5000 }
        );
        const existingProduct = existing.find(
          (p: any) =>
            p.metadata?.odoo_id === odooProduct.id ||
            p.metadata?.odoo_id === String(odooProduct.id)
        );

        let medusaProductId: string;

        if (existingProduct) {
          await productService.updateProducts(existingProduct.id, {
            title: medusaData.title,
            description: medusaData.description,
            handle: medusaData.handle,
            status: medusaData.status,
            metadata: medusaData.metadata,
          });
          medusaProductId = existingProduct.id;
          updated++;
          logger.info(`[Odoo Sync Job] Updated: ${medusaData.title} (${medusaProductId})`);
        } else {
          const created_products = await productService.createProducts(medusaData);
          const created_product = Array.isArray(created_products) ? created_products[0] : created_products;
          medusaProductId = created_product.id;
          created++;
          logger.info(`[Odoo Sync Job] Created: ${medusaData.title} (${medusaProductId})`);
        }

        // Sync prices via Pricing module
        const price = odooProduct.list_price || odooProduct.lst_price || 0;
        const currency = "kwd";

        if (price > 0) {
          try {
            const product = await productService.retrieveProduct(medusaProductId, {
              relations: ["variants"],
            });

            for (const variant of product.variants || []) {
              const priceSet = await pricingService.createPriceSets({
                prices: [{ amount: price, currency_code: currency }],
              });
              await remoteLink.create({
                [Modules.PRODUCT]: { variant_id: variant.id },
                [Modules.PRICING]: { price_set_id: priceSet.id },
              });
            }
          } catch (priceError: any) {
            logger.warn(`[Odoo Sync Job] Price sync failed for ${medusaData.title}: ${priceError.message}`);
          }
        }
      } catch (productError: any) {
        errors++;
        logger.error(`[Odoo Sync Job] Failed to sync product ${odooProduct.id}: ${productError.message}`);
      }
    }

    await updateLastSync(pgConnection, logger);
    logger.info(`[Odoo Sync Job] Completed: ${created} created, ${updated} updated, ${errors} errors`);
  } catch (error: any) {
    logger.error(`[Odoo Sync Job] Fatal error: ${error.message}`);
  }
}

async function updateLastSync(pgConnection: any, logger: any) {
  try {
    const now = new Date().toISOString();
    await pgConnection.raw(
      `INSERT INTO system_config (key, value, updated_at)
       VALUES (?, ?, NOW())
       ON CONFLICT (key) DO UPDATE SET value = ?, updated_at = NOW()`,
      ["odoo_last_sync", now, now]
    );
  } catch (e: any) {
    logger.warn(`[Odoo Sync Job] Could not update last sync: ${e.message}`);
  }
}

export const config = {
  name: "odoo-product-sync",
  schedule: "*/5 * * * *",
};
