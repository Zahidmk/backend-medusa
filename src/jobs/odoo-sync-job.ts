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
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import axios from "axios";
import { ODOO_CONFIG } from "../config/odoo";
import { odooImageUrl } from "../utils/odoo-image";

export default async function odooSyncJob(containerOrObj: any) {
  const container: MedusaContainer = containerOrObj?.resolve ? containerOrObj : containerOrObj?.container;
  if (!container) return;
  const logger = container.resolve("logger" as any);
  const pgConnection = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const productService = container.resolve(Modules.PRODUCT);
  const pricingService = container.resolve(Modules.PRICING);
  const remoteLink = container.resolve("remoteLink" as any);

  let odooSyncService: any;
  try {
    odooSyncService = container.resolve("odoo_sync");
  } catch {
    // Fallback: try legacy key
    try {
      odooSyncService = container.resolve("odooSyncService");
    } catch {
      logger.warn("[Odoo Sync Job] OdooSyncService not registered, skipping.");
      return;
    }
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

        // Resolve Odoo attribute lines into human-readable specifications
        // e.g., Color: "Red, Blue", Size: "S, M, L, XL"
        try {
          if (odooProduct.attribute_line_ids?.length > 0) {
            const specifications: Record<string, string> = {}
            const attrLines = await odooSyncService.fetchAttributeLines(odooProduct.attribute_line_ids)
            for (const line of attrLines) {
              const attrName = line.attribute_id?.[1] || "Unknown"
              if (line.value_ids?.length > 0) {
                const values = await odooSyncService.fetchAttributeValues(line.value_ids)
                specifications[attrName] = values.map((v: any) => v.name).join(", ")
              }
            }
            if (Object.keys(specifications).length > 0) {
              medusaData.metadata.specifications = specifications
            }
          }
        } catch (specErr: any) {
          logger.warn(`[Odoo Sync Job] Could not resolve specs for ${odooProduct.id}: ${specErr.message}`)
        }

        // Check if product exists by odoo_id
        const existingRows = await pgConnection.raw(
          `SELECT id FROM product WHERE metadata->>'odoo_id' = ? AND deleted_at IS NULL ORDER BY created_at LIMIT 1`,
          [String(odooProduct.id)]
        );
        const existingProduct = existingRows.rows?.[0];

        let medusaProductId: string;

        // Images are served by our own /odoo/image endpoint (Odoo's public URL only
        // works for website-published products): main thumbnail + gallery.
        const imageUrls: Array<{ url: string }> = [];
        if (odooProduct.image_1920) {
          imageUrls.push({ url: odooImageUrl(odooProduct.id) });
        }
        if (odooProduct.product_template_image_ids?.length > 0) {
          for (const galleryId of odooProduct.product_template_image_ids) {
            imageUrls.push({ url: odooImageUrl(odooProduct.id, galleryId) });
          }
        }

        if (existingProduct) {
          // Publish status, title, description, handle and images are managed in
          // Medusa — Odoo only refreshes metadata (prices, SKU, stock info).
          const current = await productService.retrieveProduct(existingProduct.id, {
            select: ["id", "metadata", "thumbnail", "description"],
          });
          const updatePayload: any = {
            metadata: { ...(current.metadata || {}), ...(medusaData.metadata || {}) },
          };

          // Fill an empty description from Odoo once; never overwrite one set in Medusa
          const odooDescription = (odooProduct as any).medusa_description || odooProduct.description_sale || "";
          if (!current.description && odooDescription) {
            updatePayload.description = odooDescription;
          }

          if (imageUrls.length > 0 && !current.thumbnail) {
            updatePayload.thumbnail = imageUrls[0].url;
            updatePayload.images = imageUrls;
          }

          await productService.updateProducts(existingProduct.id, updatePayload);
          medusaProductId = existingProduct.id;
          updated++;
          logger.info(`[Odoo Sync Job] Updated: ${medusaData.title} (${medusaProductId}) with ${imageUrls.length} images`);
        } else {
          // New products start as draft; publishing is done in Medusa admin.
          const created_products = await productService.createProducts({
            ...medusaData,
            status: "draft",
            ...(imageUrls.length > 0 ? { thumbnail: imageUrls[0].url, images: imageUrls } : {}),
          });
          const created_product = Array.isArray(created_products) ? created_products[0] : created_products;
          medusaProductId = created_product.id;
          created++;
          logger.info(`[Odoo Sync Job] Created: ${medusaData.title} (${medusaProductId})`);
        }

        // Auto-create and link brand
        const brandName = odooProduct.brand_id?.[1] || odooProduct.custom_brand_id?.[1] || odooProduct.x_studio_brand_1 || null;
        const brandOdooId = odooProduct.custom_brand_id?.[0] || odooProduct.brand_id?.[0] || null;
        // Build brand image URL from Odoo custom.product.brand model
        const brandImageUrl = brandOdooId
          ? `${ODOO_CONFIG.url}/web/image/custom.product.brand/${brandOdooId}/image_1920`
          : null;

        if (brandName && typeof brandName === "string") {
          try {
            const brandSlug = brandName.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").substring(0, 100);
            const existingBrand = await pgConnection.raw(
              `SELECT id, logo_url FROM brand WHERE slug = ? AND deleted_at IS NULL LIMIT 1`,
              [brandSlug]
            );
            let brandId: string;
            if (existingBrand.rows?.length > 0) {
              brandId = existingBrand.rows[0].id;
              // Always update logo_url from Odoo if we have one (Odoo is source of truth for logos)
              const existingLogo = existingBrand.rows[0].logo_url;
              if (brandImageUrl && (existingLogo !== brandImageUrl)) {
                await pgConnection.raw(
                  `UPDATE brand SET logo_url = ?, updated_at = NOW() WHERE id = ?`,
                  [brandImageUrl, brandId]
                );
                logger.info(`[Odoo Sync Job] Updated brand logo: ${brandName} -> ${brandImageUrl}`);
              }
            } else {
              brandId = `brand_${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
              await pgConnection.raw(
                `INSERT INTO brand (id, name, slug, is_active, is_special, logo_url, created_at, updated_at) VALUES (?, ?, ?, true, true, ?, NOW(), NOW())`,
                [brandId, brandName, brandSlug, brandImageUrl]
              );
              logger.info(`[Odoo Sync Job] Created brand: ${brandName} (${brandId}) logo: ${brandImageUrl || "none"}`);
            }
            // Link product to brand
            const existingLink = await pgConnection.raw(
              `SELECT id FROM product_brand WHERE product_id = ? AND brand_id = ? AND deleted_at IS NULL LIMIT 1`,
              [medusaProductId, brandId]
            );
            if (!existingLink.rows?.length) {
              await pgConnection.raw(
                `INSERT INTO product_brand (id, product_id, brand_id, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())`,
                [`pbr_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 8)}`, medusaProductId, brandId]
              );
            }
          } catch (brandErr: any) {
            logger.warn(`[Odoo Sync Job] Brand sync failed for ${medusaData.title}: ${brandErr.message}`);
          }
        }

        // Sync prices via Pricing module
        // Website uses Odoo Retail Price (not Sales Price)
        const price = (odooProduct as any).retail_price || 0;
        const currency = "kwd";

        if (price > 0) {
          try {
            const product = await productService.retrieveProduct(medusaProductId, {
              relations: ["variants"],
            });

            // Prices are stored in fils (1 KWD = 1000), matching the rest of the system
            const amount = Math.round(price * 1000);

            for (const variant of product.variants || []) {
              const linked = await pgConnection.raw(
                `SELECT price_set_id FROM product_variant_price_set WHERE variant_id = ? AND deleted_at IS NULL LIMIT 1`,
                [variant.id]
              );
              const existingPriceSetId = linked.rows?.[0]?.price_set_id;

              if (existingPriceSetId) {
                await pgConnection.raw(
                  `UPDATE price SET amount = ?, raw_amount = jsonb_build_object('value', ?::text, 'precision', 20), updated_at = NOW()
                   WHERE price_set_id = ? AND currency_code = ? AND deleted_at IS NULL`,
                  [amount, amount, existingPriceSetId, currency]
                );
              } else {
                const priceSet = await pricingService.createPriceSets({
                  prices: [{ amount, currency_code: currency }],
                });
                await remoteLink.create({
                  [Modules.PRODUCT]: { variant_id: variant.id },
                  [Modules.PRICING]: { price_set_id: priceSet.id },
                });
              }
            }
          } catch (priceError: any) {
            logger.warn(`[Odoo Sync Job] Price sync failed for ${medusaData.title}: ${priceError.message}`);
          }
        }

        // Attribute variants (Color, Size...): Odoo products with several variants are synced through
        // the Odoo product webhook logic, which builds Medusa options, option values and variants.
        if ((odooProduct.product_variant_ids?.length ?? 0) > 1 && (odooProduct.attribute_line_ids?.length ?? 0) > 0) {
          try {
            const variants = await odooSyncService.fetchVariantPayloads(odooProduct.id);
            if (variants.length > 1) {
              await axios.post(
                `http://localhost:${process.env.PORT || 9000}/odoo/webhooks/products`,
                {
                  webhook_secret: ODOO_CONFIG.webhookSecret,
                  event_type: "product.updated",
                  product: {
                    odoo_id: odooProduct.id,
                    name: odooProduct.name,
                    default_code: odooProduct.default_code || undefined,
                    barcode: odooProduct.barcode || undefined,
                    retail_price: (odooProduct as any).retail_price || 0,
                    weight: odooProduct.weight || undefined,
                    custom_brand_id: (odooProduct as any).custom_brand_id || undefined,
                    brand: odooProduct.x_studio_brand_1 || undefined,
                    variants,
                  },
                },
                { timeout: 120000 }
              );
              logger.info(`[Odoo Sync Job] Synced ${variants.length} variants for ${medusaData.title}`);
            }
          } catch (variantErr: any) {
            logger.warn(`[Odoo Sync Job] Variant sync failed for ${medusaData.title}: ${variantErr.message}`);
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
  schedule: "*/5 * * * *", // Every 5 minutes (delta sync by write_date)
};
