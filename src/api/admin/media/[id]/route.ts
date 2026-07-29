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
    const id = req.params.id
    const body = (req.body || {}) as any

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

    // Use updateMedias/updateMedia pattern if available
    if (typeof mediaService.updateMedias === 'function') {
      const updated = await mediaService.updateMedias({ id }, body)
      return res.json({ media: updated })
    }
    if (typeof mediaService.updateMedia === 'function') {
      const updated = await mediaService.updateMedia(id, body)
      return res.json({ media: updated })
    }
    // Fallback: try generic update method
    if (typeof mediaService.update === 'function') {
      await mediaService.update(id, body)
      const item = await mediaService.retrieveMedia(id).catch(() => null)
      return res.json({ media: item })
    }

    res.status(501).json({ message: 'Update not supported on media service' })
  } catch (e: any) {
    console.error('Admin media PUT error:', e)
    res.status(500).json({ message: e?.message || 'Failed to update media' })
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
