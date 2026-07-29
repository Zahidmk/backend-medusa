import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils"

export const AUTHENTICATE = true

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const productService = req.scope.resolve(Modules.PRODUCT) as any
    const search = (req.query.q as string) || ""
    const idsParam = (req.query.ids as string) || ""
    const statusParam = req.query.status as string
    const limit = parseInt((req.query.limit as string) || "50", 10)
    const offset = parseInt((req.query.offset as string) || "0", 10)

    if (idsParam) {
      const ids = idsParam.split(",").map((i) => i.trim()).filter(Boolean)
      if (ids.length === 0) return res.json({ products: [], count: 0 })

      let products: any[] = []
      if (typeof productService.listProducts === "function") {
        products = await productService.listProducts({ id: ids }, { select: ["id", "title", "handle", "thumbnail", "status"] })
      } else if (typeof productService.list === "function") {
        products = await productService.list({ id: ids }, { select: ["id", "title", "handle", "thumbnail", "status"] })
      }
      return res.json({ products: products || [], count: products?.length || 0 })
    }

    const filters: any = {}
    if (statusParam && statusParam !== "all") {
      filters.status = statusParam
    }
    if (search) {
      filters.q = search
    }

    let products: any[] = []
    let count = 0

    if (typeof productService.listAndCountProducts === "function") {
      const result = await productService.listAndCountProducts(filters, {
        select: ["id", "title", "handle", "thumbnail", "status"],
        take: limit,
        skip: offset,
        order: { created_at: "DESC" },
      })
      products = result[0] || []
      count = result[1] || 0
    } else if (typeof productService.listAndCount === "function") {
      const result = await productService.listAndCount(filters, {
        select: ["id", "title", "handle", "thumbnail", "status"],
        take: limit,
        skip: offset,
        order: { created_at: "DESC" },
      })
      products = result[0] || []
      count = result[1] || 0
    } else {
      throw new Error("Product service listAndCount method not found")
    }

    return res.json({ products, count })
  } catch (e: any) {
    console.error("GET /admin/products error via product service, using raw DB fallback:", e?.message)
    try {
      const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as any
      const search = (req.query.q as string) || ""
      const idsParam = (req.query.ids as string) || ""
      const statusParam = (req.query.status as string) || ""
      const limit = parseInt((req.query.limit as string) || "50", 10)
      const offset = parseInt((req.query.offset as string) || "0", 10)

      if (idsParam) {
        const ids = idsParam.split(",").map((i) => i.trim()).filter(Boolean)
        if (ids.length === 0) return res.json({ products: [], count: 0 })
        const placeholders = ids.map(() => "?").join(", ")
        const resIds = await pgConnection.raw(
          `SELECT id, title, handle, thumbnail, status FROM product WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
          ids
        )
        return res.json({ products: resIds.rows || [], count: resIds.rows?.length || 0 })
      }

      const bindings: any[] = []
      let where = "WHERE deleted_at IS NULL"
      if (statusParam && statusParam !== "all") {
        bindings.push(statusParam)
        where += " AND (status = ? OR status IS NULL)"
      }
      if (search) {
        bindings.push(`%${search}%`)
        bindings.push(`%${search}%`)
        where += " AND (title ILIKE ? OR handle ILIKE ?)"
      }

      const countRes = await pgConnection.raw(`SELECT COUNT(*) as total FROM product ${where}`, bindings)
      const total = parseInt(countRes.rows?.[0]?.total || "0", 10)

      bindings.push(limit)
      bindings.push(offset)
      const resFallback = await pgConnection.raw(
        `SELECT id, title, handle, thumbnail, status FROM product ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        bindings
      )
      return res.json({ products: resFallback.rows || [], count: total })
    } catch (fallbackErr: any) {
      return res.status(500).json({ message: fallbackErr?.message || "Failed to fetch products" })
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
