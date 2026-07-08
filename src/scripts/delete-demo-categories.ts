import { ExecArgs } from "@medusajs/framework/types";
import { deleteProductCategoriesWorkflow } from "@medusajs/medusa/core-flows";

export default async function deleteDemoCategories({ container }: ExecArgs) {
  const logger = container.resolve("logger");
  const query = container.resolve("query");

  const handlesToRemove = ["shirts", "sweatshirts", "pants", "merch"];

  logger.info("Looking for demo categories to remove...");

  const { data: categories } = await query.graph({
    entity: "product_category",
    fields: ["id", "handle", "name"],
    filters: {
      handle: handlesToRemove
    }
  });

  if (!categories || categories.length === 0) {
    logger.info("No demo categories found (they might have already been deleted).");
    return;
  }

  const categoryIds = categories.map((c: any) => c.id);
  
  logger.info(`Found ${categories.length} demo categories to delete:`);
  categories.forEach((c: any) => logger.info(`- ${c.name} (${c.handle})`));

  try {
    await deleteProductCategoriesWorkflow(container).run({
      input: categoryIds
    });
    logger.info("✅ Successfully deleted demo categories!");
  } catch (error: any) {
    logger.error(`Failed to delete categories: ${error.message}`);
  }
}
