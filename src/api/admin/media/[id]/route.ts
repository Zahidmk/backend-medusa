import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { MEDIA_MODULE } from "../../../../modules/media"
export const AUTHENTICATE = true

async function ensureProductIdsColumn(scope: any) {
  try {
    const pg = scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as any
    await pg.raw(`ALTER TABLE IF EXISTS "media" ADD COLUMN IF NOT EXISTS "product_ids" jsonb null;`)
  } catch (err) {
    console.warn("Could not auto-add product_ids column:", err)
  }
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    await ensureProductIdsColumn(req.scope)
    const mediaService = req.scope.resolve(MEDIA_MODULE) as any
    const id = req.params.id
    const item = await (mediaService.retrieveMedia ? mediaService.retrieveMedia(id) : mediaService.get(id))
    if (!item) return res.status(404).json({ message: 'Media not found' })
    res.json({ media: item })
  } catch (e: any) {
    console.error('Admin media GET error:', e)
    res.status(500).json({ message: e?.message || 'Failed to retrieve media' })
  }
}

export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  try {
    await ensureProductIdsColumn(req.scope)
    const mediaService = req.scope.resolve(MEDIA_MODULE) as any
    const id = req.params.id || (req as any).params?.id
    const body = (req.body || {}) as any

    console.log("media_id =", id)
    console.log("req.body =", req.body)

    if (!id) return res.status(400).json({ message: "Media ID is required" })

    const productIds = Array.isArray(body.product_ids) ? body.product_ids : undefined
    let brand = body.brand

    // Auto-derive brand from linked product if brand is not provided or empty
    if ((!brand || brand === 'Markasouq') && productIds && productIds.length > 0) {
      try {
        const pg = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as any
        const resProd = await pg.raw(`SELECT metadata FROM product WHERE id = ?`, [productIds[0]])
        const meta = resProd.rows?.[0]?.metadata
        const metaObj = typeof meta === 'string' ? JSON.parse(meta) : (meta || {})
        if (metaObj.brand) {
          body.brand = metaObj.brand
        }
      } catch (err) {
        // non-blocking
      }
    }

    // Direct DB update first to guarantee fields are saved without MedusaService signature mismatch
    try {
      const pg = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as any
      await pg.raw(
        `UPDATE media SET
          title = COALESCE(?, title),
          title_ar = ?,
          thumbnail_url = ?,
          views = COALESCE(?, views),
          display_order = COALESCE(?, display_order),
          is_featured = COALESCE(?, is_featured),
          product_ids = ?::jsonb,
          updated_at = NOW()
         WHERE id = ?`,
        [
          body.title || null,
          body.title_ar || null,
          body.thumbnail_url || null,
          body.views ?? null,
          body.display_order ?? null,
          body.is_featured ?? null,
          JSON.stringify(productIds || []),
          id
        ]
      )
    } catch (dbErr) {
      console.warn("Direct DB media update error:", dbErr)
    }

    // Try service update methods safely with array format [{ id, ...body }]
    let updated: any = null
    try {
      if (typeof mediaService.updateMedias === 'function') {
        updated = await mediaService.updateMedias([{ id, ...body }])
      } else if (typeof mediaService.updateMedia === 'function') {
        updated = await mediaService.updateMedia(id, body)
      } else if (typeof mediaService.update === 'function') {
        await mediaService.update(id, body)
      }
    } catch (serviceErr: any) {
      console.warn("Service updateMedias warning (handled by DB update):", serviceErr?.message)
    }

    let finalMedia: any = null
    try {
      const items = await mediaService.listMedias({ id })
      finalMedia = Array.isArray(items) ? items[0] : items
    } catch (err) {
      // fallback
    }

    return res.json({ media: finalMedia || updated || { id, ...body } })
  } catch (e: any) {
    console.error('Admin media PUT error:', e)
    return res.status(500).json({ message: e?.message || 'Failed to update media' })
  }
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  try {
    const mediaService = req.scope.resolve(MEDIA_MODULE) as any
    const id = req.params.id
    if (!id) return res.status(400).json({ message: 'id is required' })

    const existing = await (typeof mediaService.retrieveMedia === 'function'
      ? mediaService.retrieveMedia(id)
      : mediaService.retrieveMedias ? (await mediaService.retrieveMedias({ id })).shift() : null)

    if (!existing) return res.status(404).json({ message: 'Media not found' })

    // Prefer soft delete if available
    // Try common deletion method names used by Medusa-style services
    const deleteAttempts = [
      'softDeleteMedias', 'softDeleteMedia',
      'deleteMedias', 'deleteMedia',
      'removeMedias', 'removeMedia',
      'delete', 'destroy',
    ]

    let performed = false
    for (const name of deleteAttempts) {
      if (typeof (mediaService as any)[name] === 'function') {
        try {
          // call with array or id depending on common signature
          if (name.toLowerCase().includes('medias') || name.toLowerCase().endsWith('s')) {
            await (mediaService as any)[name]({ id })
          } else {
            await (mediaService as any)[name](id)
          }
          performed = true
          break
        } catch (err) {
          console.warn(`Delete attempt via ${name} failed:`, err)
        }
      }
    }

    // As a last resort, attempt a soft-delete by setting deleted_at via update method
    if (!performed) {
      if (typeof mediaService.updateMedias === 'function') {
        await mediaService.updateMedias({ id }, { deleted_at: new Date().toISOString() })
        performed = true
      } else if (typeof mediaService.updateMedia === 'function') {
        await mediaService.updateMedia(id, { deleted_at: new Date().toISOString() })
        performed = true
      }
    }

    if (!performed) {
      return res.status(501).json({ message: 'Delete not supported on media service' })
    }

    res.status(204).send()
  } catch (e: any) {
    console.error('Admin media DELETE error:', e)
    res.status(500).json({ message: e?.message || 'Failed to delete media' })
  }
}
