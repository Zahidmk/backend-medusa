import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils"

export const AUTHENTICATE = true

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as any
    const search = ((req.query.q as string) || "").trim()
    const idsParam = ((req.query.ids as string) || "").trim()
    const statusParam = ((req.query.status as string) || "").trim()
    const limit = parseInt((req.query.limit as string) || "50", 10)
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
    console.error("GET /admin/products error:", e?.message)
    return res.status(500).json({ message: e?.message || "Failed to fetch products" })
  }
}
}

function hasMetadata(payload: any) {
  if (!payload || typeof payload !== 'object') return false
  const hasTags = Array.isArray(payload.tags) && payload.tags.length > 0
  const hasCollectionId = !!payload.collection_id
  const hasCollectionIds = Array.isArray(payload.collection_ids) && payload.collection_ids.length > 0
  const hasCategories = Array.isArray(payload.categories) && payload.categories.length > 0
  return hasTags || hasCollectionId || hasCollectionIds || hasCategories
}

function normalizeImageFields(payload: any) {
  if (!payload || typeof payload !== "object") return payload

  const next = { ...payload }

  const thumb = next.thumbnail || next.thumbnail_url || next.temp_image || next.image_url
  if (thumb && !next.thumbnail) {
    next.thumbnail = thumb
  }

  if (Array.isArray(next.images)) {
    next.images = next.images
      .map((img: any) => {
        if (!img) return null
        if (typeof img === "string") return { url: img }
        if (typeof img?.url === "string") return { url: img.url }
        return null
      })
      .filter(Boolean)
  } else if (typeof next.images === "string") {
    next.images = [{ url: next.images }]
  }

  if (next.thumbnail && (!Array.isArray(next.images) || next.images.length === 0)) {
    next.images = [{ url: next.thumbnail }]
  }

  return next
}

const metadataError = {
  message:
    'Missing required metadata: please include tags OR collection_id/collection_ids OR categories in the product payload.\n' +
    'Set REQUIRE_PRODUCT_METADATA=false to disable this check (e.g., during bulk import).',
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const body = normalizeImageFields((req.body as any) || {})
    const requireMetadata = process.env.REQUIRE_PRODUCT_METADATA === 'true'

    if (requireMetadata && !hasMetadata(body)) {
      return res.status(400).json(metadataError)
    }

    const productService = req.scope.resolve(Modules.PRODUCT) as any

    let created: any = null
    if (typeof productService.create === 'function') {
      created = await productService.create(body)
    } else if (typeof productService.createProduct === 'function') {
      created = await productService.createProduct(body)
    } else if (typeof productService.createProducts === 'function') {
      created = await productService.createProducts(body)
    } else {
      console.error('Product service create method not found on service:', Object.keys(productService || {}))
      return res.status(500).json({ message: 'Product create method not found on product service' })
    }

    return res.json({ product: created })
  } catch (e: any) {
    console.error('Admin product create error:', e)
    return res.status(500).json({ message: e?.message || 'Failed to create product' })
  }
}

export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  try {
    const body = normalizeImageFields((req.body as any) || {})
    const id = (req.query && (req.query.id as string)) || body?.id
    if (!id) return res.status(400).json({ message: 'Missing product id for update' })

    const productService = req.scope.resolve(Modules.PRODUCT) as any

    let updated: any = null
    if (typeof productService.updateProducts === 'function') {
      updated = await productService.updateProducts(id, body)
    } else if (typeof productService.updateProduct === 'function') {
      updated = await productService.updateProduct(id, body)
    } else if (typeof productService.update === 'function') {
      updated = await productService.update(id, body)
    } else {
      console.error('Product service update method not found on service:', Object.keys(productService || {}))
      return res.status(500).json({ message: 'Product update method not found on product service' })
    }

    return res.json({ product: updated })
  } catch (e: any) {
    console.error('Admin product update error:', e)
    return res.status(500).json({ message: e?.message || 'Failed to update product' })
  }
}
