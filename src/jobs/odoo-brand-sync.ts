import { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { BRAND_MODULE } from "../modules/brands";
import fs from "fs";
import path from "path";

export default async function odooBrandSyncJob(container: MedusaContainer) {
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
    
    // Check if we are running on production server to save images to NextJS directly
    const IS_PROD = fs.existsSync('/var/www/marqa-souq/frontend/markasouq-web/public/brands');
    const outDir = IS_PROD 
        ? '/var/www/marqa-souq/frontend/markasouq-web/public/brands' 
        : path.join(process.cwd(), 'static', 'brands'); // Local fallback
    
    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }

    for (const odooBrand of brands) {
      const name = (odooBrand.name || "").trim();
      if (!name) continue;

      let logoUrl = null;

      // Process Logo Image
      const img = odooBrand.image_1920;
      if (img && img !== true && img.length > 200) {
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        
        try {
            const buf = Buffer.from(img, 'base64');
            const isSvg = buf.slice(0, 100).toString('utf8').trim().startsWith('<svg') || 
                          buf.slice(0, 100).toString('utf8').trim().startsWith('<?xml');
            const ext = isSvg ? '.svg' : '.png';
            
            const fname = slug + '-brand' + ext;
            const fpath = path.join(outDir, fname);
            
            fs.writeFileSync(fpath, buf);
            logoUrl = '/brands/' + fname; // Assuming frontend serves from /brands
            if (!IS_PROD) {
               logoUrl = '/static/brands/' + fname; // Local Medusa static fallback
            }
        } catch(e: any) {
            logger.error(`[Brand Sync] Failed to write image for ${name}: ${e.message}`);
        }
      }

      // Upsert into DB manually using pgConnection because BrandService might not have upsert
      try {
        const existingResult = await pgConnection.raw(
          `SELECT id, logo_url FROM brand WHERE LOWER(name) = ?`,
          [name.toLowerCase()]
        );
        
        if (existingResult.rows?.length > 0) {
          // Update
          const existingId = existingResult.rows[0].id;
          const currentLogo = existingResult.rows[0].logo_url;
          
          // Only update logo if we have a new one and it's not already pointing to a good SVG
          let newLogo = logoUrl;
          if (currentLogo && currentLogo.endsWith('.svg')) {
             newLogo = currentLogo; // Keep original high-quality SVG
          } else if (!newLogo) {
             newLogo = currentLogo; // Keep existing if Odoo has no image
          }
          
          await pgConnection.raw(
            `UPDATE brand SET updated_at = NOW(), logo_url = ? WHERE id = ?`,
            [newLogo, existingId]
          );
          updated++;
        } else {
          // Create new using Medusa Service to ensure ID generation and other hooks
          const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
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
  schedule: "*/15 * * * *", // Every 15 minutes
};
