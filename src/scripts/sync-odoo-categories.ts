import { ExecArgs } from "@medusajs/framework/types";
import odooCategorySyncJob from "../jobs/odoo-category-sync-job";

export default async function syncOdooCategories({ container }: ExecArgs) {
  const logger = container.resolve("logger");
  logger.info("Starting manual Odoo Category Sync to fetch odoo_ids...");
  await odooCategorySyncJob({ container } as any);
  logger.info("Odoo Category Sync complete!");
}
