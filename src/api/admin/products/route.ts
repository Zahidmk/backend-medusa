import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils"

export const AUTHENTICATE = true

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as any

    const search = (req.query.q as string) || ""
    const idsParam = (req.query.ids as string) || ""
    const statusParam = (req.query.status as string) || "" // Only filter if explicitly passed (e.g. status=published)
    const limit = parseInt((req.query.limit as string) || "50", 10)
    const offset = parseInt((req.query.offset as string) || "0", 10)

    if (idsParam) {
      const ids = idsParam.split(",").map((i) => i.trim()).filter(Boolean)
      if (ids.length === 0) {
        return res.json({ products: [], count: 0 })
      }
      const placeholders = ids.map(() => "?").join(", ")
      const result = await pgConnection.raw(
        `SELECT DISTINCT ON (p.id)
                p.id, p.title, p.handle,
                COALESCE(p.thumbnail, img.url) as thumbnail,
                p.status
         FROM product p
         LEFT JOIN product_image pi ON pi.product_id = p.id
         LEFT JOIN image img ON img.id = pi.image_id
         WHERE p.id IN (${placeholders}) AND p.deleted_at IS NULL`,
        ids
      )
      const rows = result.rows || []
      return res.json({ products: rows, count: rows.length })
    }

    const bindings: any[] = []
    let whereClause = "WHERE p.deleted_at IS NULL"

    if (statusParam && statusParam !== "all") {
      bindings.push(statusParam)
      whereClause += " AND p.status = ?"
    }

    if (search) {
      bindings.push(`%${search}%`)
      bindings.push(`%${search}%`)
      whereClause += " AND (p.title ILIKE ? OR p.handle ILIKE ?)"
    }

    const countRes = await pgConnection.raw(
      `SELECT COUNT(DISTINCT p.id) as total FROM product p ${whereClause}`,
      bindings
    )
    const total = parseInt(countRes.rows?.[0]?.total || "0", 10)

    const queryBindings = [...bindings, limit, offset]
    const result = await pgConnection.raw(
      `SELECT DISTINCT ON (p.id)
              p.id, p.title, p.handle,
              COALESCE(p.thumbnail, img.url) as thumbnail,
              p.status, p.created_at
       FROM product p
       LEFT JOIN product_image pi ON pi.product_id = p.id
       LEFT JOIN image img ON img.id = pi.image_id
       ${whereClause}
       ORDER BY p.id, p.created_at DESC
       LIMIT ? OFFSET ?`,
      queryBindings
    )

    const rows = result.rows || []
    return res.json({ products: rows, count: total })
  } catch (e: any) {
    console.error("GET /admin/products error:", e)
    try {
      const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as any
      const search = (req.query.q as string) || ""
      const statusParam = (req.query.status as string) || ""
      const limit = parseInt((req.query.limit as string) || "50", 10)
      const bindings: any[] = []
      let where = "WHERE deleted_at IS NULL"
      if (statusParam && statusParam !== "all") {
        bindings.push(statusParam)
        where += " AND status = ?"
      }
      if (search) {
        bindings.push(`%${search}%`)
        bindings.push(`%${search}%`)
        where += " AND (title ILIKE ? OR handle ILIKE ?)"
      }
      bindings.push(limit)
      const resFallback = await pgConnection.raw(
        `SELECT id, title, handle, thumbnail, status FROM product ${where} ORDER BY created_at DESC LIMIT ?`,
        bindings
      )
      return res.json({ products: resFallback.rows || [], count: resFallback.rows?.length || 0 })
    } catch (fallbackErr: any) {
      return res.status(500).json({ message: e?.message || "Failed to fetch products" })
    }
  }
}


// Admin-side route-level validation for product create/update
// Controlled by env var REQUIRE_PRODUCT_METADATA (string 'true' enables enforcement).
// When enabled, requests creating products must include at least one of:
// - tags: non-empty array
// - collection_id or collection_ids: single or array
// - categories: non-empty array

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

  // Support a few common frontend/admin keys for thumbnail.
  const thumb = next.thumbnail || next.thumbnail_url || next.temp_image || next.image_url
  if (thumb && !next.thumbnail) {
    next.thumbnail = thumb
  }

  // Normalize images into [{ url: string }]
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

  // If we have a thumbnail but no images, include it as first image.
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

    // Try common create method names used across Medusa versions/customizations
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
    // id may come from query param (e.g., /admin/products?id=prod_...) or body
    const id = (req.query && (req.query.id as string)) || body?.id
    if (!id) return res.status(400).json({ message: 'Missing product id for update' })

    // NOTE: Don't enforce metadata on updates.
    // Image-only updates (thumbnail/images) and other partial edits must stay allowed.

    const productService = req.scope.resolve(Modules.PRODUCT) as any

    // Try a few common update method names
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
