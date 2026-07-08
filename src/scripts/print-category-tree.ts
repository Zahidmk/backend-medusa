import { ExecArgs } from "@medusajs/framework/types";

export default async function printCategoryTree({ container }: ExecArgs) {
  const logger = container.resolve("logger");
  const query = container.resolve("query");

  logger.info("Fetching all categories to generate tree view...");

  const { data: categories } = await query.graph({
    entity: "product_category",
    fields: ["id", "name", "handle", "parent_category_id", "metadata"],
    filters: { deleted_at: null }
  });

  if (!categories || categories.length === 0) {
    logger.info("No categories found in database.");
    return;
  }

  // Build tree
  const categoryMap = new Map();
  const roots: any[] = [];

  categories.forEach((cat: any) => {
    cat.children = [];
    categoryMap.set(cat.id, cat);
  });

  categories.forEach((cat: any) => {
    if (cat.parent_category_id && categoryMap.has(cat.parent_category_id)) {
      categoryMap.get(cat.parent_category_id).children.push(cat);
    } else {
      roots.push(cat);
    }
  });

  // Sort by name
  const sortByName = (a: any, b: any) => a.name.localeCompare(b.name);
  
  function printTree(nodes: any[], prefix = "") {
    nodes.sort(sortByName).forEach((node, index) => {
      const isLast = index === nodes.length - 1;
      const marker = isLast ? "└── " : "├── ";
      
      const odooId = node.metadata?.odoo_id ? `[Odoo ID: ${node.metadata.odoo_id}]` : "[No Odoo ID]";
      
      console.log(`${prefix}${marker}${node.name} (${node.handle}) ${odooId}`);
      
      if (node.children.length > 0) {
        const childPrefix = prefix + (isLast ? "    " : "│   ");
        printTree(node.children, childPrefix);
      }
    });
  }

  console.log("\n=======================================================");
  console.log("              FULL CATEGORY HIERARCHY TREE             ");
  console.log("=======================================================\n");
  printTree(roots);
  console.log("\n=======================================================\n");
}
