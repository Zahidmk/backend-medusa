import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export const AUTHENTICATE = true

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as any
    const search = ((req.query.q as string) || "").trim()
    const idsParam = ((req.query.ids as string) || "").trim()
    const statusParam = ((req.query.status as string) || "").trim()
    const limit = parseInt((req.query.limit as string) || "100", 10)
    const offset = parseInt((req.query.offset as string) || "0", 10)

    if (idsParam) {
      const ids = idsParam.split(",").map((i) => i.trim()).filter(Boolean)
      if (ids.length === 0) return res.json({ products: [], count: 0 })
      const placeholders = ids.map(() => "?").join(", ")
      const resIds = await pgConnection.raw(
        `SELECT p.id, p.title, p.handle,
                COALESCE(p.thumbnail, (SELECT url FROM product_image pi WHERE pi.product_id = p.id AND pi.deleted_at IS NULL ORDER BY pi.rank ASC LIMIT 1)) as thumbnail,
                p.status
         FROM product p
         WHERE p.id IN (${placeholders}) AND p.deleted_at IS NULL`,
        ids
      )
      return res.json({ products: resIds.rows || [], count: resIds.rows?.length || 0 })
    }

    const bindings: any[] = []
    let where = "WHERE p.deleted_at IS NULL"

    if (statusParam && statusParam !== "all") {
      bindings.push(statusParam)
      where += " AND (p.status = ? OR p.status IS NULL)"
    }

    if (search) {
      bindings.push(`%${search}%`)
      bindings.push(`%${search}%`)
      where += " AND (p.title ILIKE ? OR p.handle ILIKE ?)"
    }

    const countRes = await pgConnection.raw(`SELECT COUNT(*) as total FROM product p ${where}`, bindings)
    const total = parseInt(countRes.rows?.[0]?.total || "0", 10)

    bindings.push(limit)
    bindings.push(offset)
    const resProducts = await pgConnection.raw(
      `SELECT p.id, p.title, p.handle,
              COALESCE(p.thumbnail, (SELECT url FROM product_image pi WHERE pi.product_id = p.id AND pi.deleted_at IS NULL ORDER BY pi.rank ASC LIMIT 1)) as thumbnail,
              p.status
       FROM product p
       ${where}
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
      bindings
    )

    return res.json({ products: resProducts.rows || [], count: total })
  } catch (e: any) {
    console.error("GET /admin/custom/products error:", e?.message)
    return res.status(500).json({ message: e?.message || "Failed to fetch products" })
  }
}
