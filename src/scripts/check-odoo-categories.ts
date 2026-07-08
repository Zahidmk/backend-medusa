import { ExecArgs } from "@medusajs/framework/types";


export default async function checkOdooCategories({ container }: ExecArgs) {
  const logger = container.resolve("logger");
  const odooSyncService = container.resolve("odoo_sync") as any;

  logger.info("Connecting to Odoo...");
  const categories = await odooSyncService.fetchPublicCategories();
  
  logger.info(`Fetched ${categories.length} categories from Odoo.`);
  
  const matches = categories.filter((c: any) => c.name.toLowerCase().includes("accessories"));
  
  logger.info("Categories containing 'accessories':");
  for (const cat of matches) {
    logger.info(`- ID: ${cat.id}, Name: "${cat.name}", Parent Path: ${cat.parent_path}`);
  }
}
