import { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { BRAND_MODULE } from "../modules/brands";
import fs from "fs";
import path from "path";
import { ODOO_CONFIG } from "../config/odoo";

export default async function odooBrandSyncJob(containerOrObj: any) {
  const container: MedusaContainer = containerOrObj?.resolve ? containerOrObj : containerOrObj?.container;
  if (!container) return;
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const pgConnection = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  
  let odooSyncService: any;
  try {
    odooSyncService = container.resolve("odoo_sync");
  } catch {
    try { odooSyncService = container.resolve("odooSyncService"); } catch {
      logger.warn("[Brand Sync] OdooSyncService not registered, skipping.");
      return;
    }
  }

  let brandService: any;
  try {
    brandService = container.resolve(BRAND_MODULE);
  } catch {
    logger.warn("[Brand Sync] BRAND_MODULE not registered.");
    return;
  }

  logger.info("[Brand Sync] Starting brand sync from Odoo...");

  try {
    const brands = await odooSyncService.fetchBrands();
    if (!brands || brands.length === 0) {
      logger.info("[Brand Sync] No brands found in Odoo.");
      return;
    }

    logger.info(`[Brand Sync] Found ${brands.length} brands in Odoo. Processing...`);

    let created = 0;
    let updated = 0;
    
    const outDir = path.join(process.cwd(), 'static', 'uploads', 'brands');
    
    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }

    const odooUrl = ODOO_CONFIG.url

    for (const odooBrand of brands) {
      const name = (odooBrand.name || "").trim();
      if (!name) continue;

      // Prefer public Odoo custom brand image endpoint if odooBrand.id exists
      let logoUrl: string | null = odooBrand.id
        ? `${odooUrl}/api/brand/image/${odooBrand.id}`
        : null;
      const img = odooBrand.image_1920;
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

      // Note: We no longer download base64 images locally.
      // The frontend will stream them directly from Odoo.

      // Upsert into DB manually using pgConnection because BrandService might not have upsert
      try {
        const existingResult = await pgConnection.raw(
          `SELECT id, logo_url FROM brand WHERE LOWER(name) = ?`,
          [name.toLowerCase()]
        );
        
        if (existingResult.rows?.length > 0) {
          const existingId = existingResult.rows[0].id;
          const currentLogo = existingResult.rows[0].logo_url;
          const newLogo = logoUrl || currentLogo;
          
          await pgConnection.raw(
            `UPDATE brand SET updated_at = NOW(), logo_url = ? WHERE id = ?`,
            [newLogo, existingId]
          );
          updated++;
        } else {
          await brandService.createBrands({
             name: name,
             slug: slug,
             logo_url: logoUrl || null,
             is_active: true,
             is_special: false
          });
          created++;
        }
      } catch (e: any) {
         logger.error(`[Brand Sync] Error processing brand ${name}: ${e.message}`);
      }
    }

    logger.info(`[Brand Sync] Completed: ${created} created, ${updated} updated.`);
  } catch (error: any) {
    logger.error(`[Brand Sync] Fatal error: ${error.message}`);
  }
}

export const config = {
  name: "odoo-brand-sync",
  schedule: "0 5 * * *", // Daily at 5:00 AM (86,400,000 ms delay, safely fits within Node 32-bit signed int limit)
};
