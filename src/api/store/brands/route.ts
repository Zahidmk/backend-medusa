import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Knex } from "knex"

export const AUTHENTICATE = false

/**
 * GET /store/brands
 * Returns active brands synced from Odoo.
 * Logo URLs point to files in the frontend's /public/brands/ folder.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const pgConnection: Knex = req.scope.resolve("__pg_connection__")

  const limit = parseInt(req.query.limit as string) || 50
  const offset = parseInt(req.query.offset as string) || 0

  const countResult = await pgConnection.raw(
    `SELECT COUNT(DISTINCT b.id) as total 
     FROM brand b
     INNER JOIN product_brand pb ON pb.brand_id = b.id AND pb.deleted_at IS NULL
     INNER JOIN product p ON p.id = pb.product_id AND p.deleted_at IS NULL AND p.status = 'published'
     WHERE b.is_active = true AND b.deleted_at IS NULL`
  )
  const total = parseInt(countResult.rows[0].total)

  const result = await pgConnection.raw(
    `SELECT DISTINCT ON (b.display_order, b.name, b.id) 
            b.id, b.name, b.slug, b.description, b.logo_url, b.banner_url,
            b.is_active, b.is_special, b.display_order, b.created_at
     FROM brand b
     INNER JOIN product_brand pb ON pb.brand_id = b.id AND pb.deleted_at IS NULL
     INNER JOIN product p ON p.id = pb.product_id AND p.deleted_at IS NULL AND p.status = 'published'
     WHERE b.is_active = true AND b.deleted_at IS NULL
     ORDER BY b.display_order ASC NULLS LAST, b.name ASC, b.id
     LIMIT ? OFFSET ?`,
    [limit, offset]
  )

  const brands = result.rows.map((b: any) => ({
    id: b.id,
    name: b.name,
    slug: b.slug || b.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    description: b.description || "",
    logo_url: b.logo_url || "",
    banner_url: b.banner_url || "",
    is_active: b.is_active,
    is_special: b.is_special,
    display_order: b.display_order || 99,
    created_at: b.created_at,
  }))

  res.json({ brands, count: total, limit, offset })
}

