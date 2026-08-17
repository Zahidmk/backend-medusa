import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ODOO_CONFIG } from "../../../../config/odoo"

/**
 * GET /store/categories/tree
 * 
 * Returns full category tree with:
 * - Parent categories
 * - Children categories with images
 * - Product count per category
 * - Category images from metadata
 * 
 * Query params:
 * - parent_id: Filter by parent category
 * - include_empty: Include categories with 0 products (default: false)
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const parentId = req.query.parent_id as string
  const includeEmpty = req.query.include_empty === "true"

  try {
    // Get all categories with product counts
    const categoriesResult = await pgConnection.raw(
      `SELECT pc.id, pc.name, pc.handle, pc.description, 
              pc.parent_category_id, pc.is_active, pc.rank,
              pc.metadata,
              COUNT(DISTINCT pcp.product_id) as product_count
       FROM product_category pc
       LEFT JOIN product_category_product pcp ON pcp.product_category_id = pc.id
       WHERE pc.deleted_at IS NULL AND pc.is_active = true
       GROUP BY pc.id
       ORDER BY pc.rank ASC, pc.name ASC`
    )

    // Build tree structure
    const categories = categoriesResult.rows
    const categoryMap: Record<string, any> = {}
    const rootCategories: any[] = []

    // First pass: create all category objects
    for (const cat of categories) {
      const meta = typeof cat.metadata === "string" 
        ? JSON.parse(cat.metadata) 
        : (cat.metadata || {})
        
      const odooId = meta.odoo_id
      const odooUrl = ODOO_CONFIG.url
      let imageUrl = meta.image_url || null
      
      if (!imageUrl && odooId && odooUrl) {
        imageUrl = `${odooUrl}/web/image/product.public.category/${odooId}/image_1920`
      }

      categoryMap[cat.id] = {
        id: cat.id,
        name: cat.name,
        handle: cat.handle,
        description: cat.description || "",
        image_url: imageUrl,
        product_count: parseInt(cat.product_count),
        parent_id: cat.parent_category_id,
        children: [],
      }
    }

    // Second pass: build tree
    for (const cat of categories) {
      const node = categoryMap[cat.id]
      if (cat.parent_category_id && categoryMap[cat.parent_category_id]) {
        categoryMap[cat.parent_category_id].children.push(node)
      } else if (!cat.parent_category_id) {
        rootCategories.push(node)
      }
    }

    // Calculate total product count for parents (sum of children)
    for (const root of rootCategories) {
      let childTotal = 0
      for (const child of root.children) {
        childTotal += child.product_count
        // Also sum grandchildren
        let grandchildTotal = 0
        for (const gc of child.children) {
          grandchildTotal += gc.product_count
        }
        if (grandchildTotal > 0 && child.product_count === 0) {
          child.product_count = grandchildTotal
        }
      }
      if (childTotal > 0 && root.product_count === 0) {
        root.product_count = childTotal
      }
    }

    // Filter by parent if requested
    let result = rootCategories
    if (parentId) {
      const parent = categoryMap[parentId]
      if (parent) {
        result = parent.children
      } else {
        result = []
      }
    }

    // Filter empty categories if needed
    if (!includeEmpty) {
      result = result.filter((c: any) => c.product_count > 0 || c.children.length > 0)
      for (const cat of result) {
        if (cat.children) {
          cat.children = cat.children.filter((c: any) => c.product_count > 0 || c.children.length > 0)
        }
      }
    }

    res.json({
      categories: result,
      total: result.length,
    })
  } catch (error: any) {
    console.error("[Categories Tree] Error:", error)
    res.status(500).json({ type: "server_error", message: error.message })
  }
}
