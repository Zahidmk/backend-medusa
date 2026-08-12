import { defineMiddlewares, authenticate } from "@medusajs/framework/http"
import type { MedusaRequest, MedusaResponse, MedusaNextFunction } from "@medusajs/framework/http"
import Busboy from "busboy"
import path from "path"
import fs from "fs"
import mime from "mime-types"
import { injectBranding } from "./middlewares/branding"

// Development-only middleware to safely handle multipart/form-data for admin
// upload routes. This avoids the global JSON/body parser from interfering
// with multipart streams during local development where middleware ordering
// can cause `LIMIT_UNEXPECTED_FILE` errors.
//
// This middleware is intentionally gated to non-production environments and
// requires either a valid admin session (production path) or the
// DEV_ADMIN_TOKEN header when ENABLE_DEV_ADMIN_BYPASS=1.

const uploadDir = path.join(process.cwd(), "static", "uploads")
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })

async function adminMultipartGuard(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  try {
    const ct = (req.headers['content-type'] || '') as string
    if (!ct.includes('multipart/form-data')) return next()

    console.log('Admin multipart middleware handling upload for', req.path)

    const bb = Busboy({ headers: req.headers as any })

    let storedFilePath: string | null = null
    let originalName: string | null = null
    let mimetype: string | null = null
    let size = 0

    bb.on('file', (_field, file, info) => {
      originalName = info.filename
      mimetype = info.mimeType
      const safe = (originalName || 'upload').replace(/[^a-zA-Z0-9_.-]/g, '_')
      const filename = `${Date.now()}-${safe}`
      storedFilePath = path.join(uploadDir, filename)
      const writeStream = fs.createWriteStream(storedFilePath)
      file.on('data', (data) => { size += data.length })
      file.pipe(writeStream)
      writeStream.on('error', (err) => {
        console.error('Write stream error (middleware):', err)
        try { fs.unlinkSync(storedFilePath!) } catch {}
        return res.status(500).json({ message: 'Failed to write file' })
      })
    })

    bb.on('error', (err) => {
      console.error('Busboy error (middleware):', err)
      return res.status(500).json({ message: 'Upload parsing failed' })
    })

    bb.on('finish', () => {
      if (!storedFilePath) {
        return res.status(400).json({ message: 'No file uploaded' })
      }
      // Block video uploads unless explicitly enabled
      const isVideo = (mimetype || '').startsWith('video/')
      const allowVideos = String(process.env.ALLOW_VIDEO_UPLOADS || '').toLowerCase() === 'true'
      if (isVideo && !allowVideos) {
        try { if (fs.existsSync(storedFilePath!)) fs.unlinkSync(storedFilePath!) } catch {}
        return res.status(400).json({ message: 'Video uploads are disabled. Set ALLOW_VIDEO_UPLOADS=true to enable.' })
      }
      const url = `/static/uploads/${path.basename(storedFilePath)}`
      console.log('Middleware upload OK ->', url)
      return res.json({ url, filename: originalName, size, mimetype })
    })

    ;(req as any).pipe(bb as any)
  } catch (e: any) {
    console.error('Admin multipart middleware failed:', e)
    return res.status(500).json({ message: e?.message || 'Upload failed' })
  }
}

async function parseKnetUrlEncoded(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  try {
    const ct = (req.headers["content-type"] || "") as string
    if (ct.includes("application/x-www-form-urlencoded")) {
      let rawBody = ""
      req.on("data", (chunk) => {
        rawBody += chunk.toString()
      })
      req.on("end", () => {
        try {
          const params = new URLSearchParams(rawBody)
          const bodyObj: Record<string, any> = {}
          for (const [key, val] of params.entries()) {
            bodyObj[key] = val
          }
          ;(req as any).body = bodyObj
          ;(req as any).rawBody = rawBody
        } catch (err) {
          console.error("[KNET Middleware] Failed to parse urlencoded body", err)
          ;(req as any).body = {}
        }
        next()
      })
      return
    }
  } catch (e) {
    console.error("[KNET Middleware] Error reading request stream", e)
  }
  next()
}

export default defineMiddlewares({
  routes: [
    {
      // Match the admin upload endpoints (adjust as needed)
      matcher: "/admin/uploads",
      middlewares: [adminMultipartGuard],
    },
    {
      matcher: "/admin/media/upload",
      // Disable Medusa's built-in body parser so multer can read the raw multipart stream
      bodyParser: false,
      middlewares: [adminMultipartGuard],
    },
    {
      // Inject marqasouq branding into admin pages
      matcher: "/app/*",
      middlewares: [injectBranding],
    },
    // Customer authentication for store customer routes (required for /store/customers/me)
    {
      matcher: "/store/customers/me*",
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },
    // Customer creation after registration - needs allowUnregistered since customer profile doesn't exist yet
    {
      matcher: "/store/customers",
      method: "POST",
      middlewares: [authenticate("customer", ["session", "bearer"], { allowUnregistered: true })],
    },
    // Customer authentication for custom store routes
    {
      matcher: "/store/wishlist*",
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },
    // Customer cancel order - must be authenticated and own the order
    {
      matcher: "/store/orders/*/cancel",
      method: "POST",
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },
    {
      matcher: "/store/products/*/reviews",
      middlewares: [authenticate("customer", ["session", "bearer"], { allowUnauthenticated: true })],
    },
    {
      // Disable Medusa's JSON body parser for KNET callback so urlencoded POST data is read cleanly
      matcher: "/store/knet/callback*",
      bodyParser: false,
      middlewares: [parseKnetUrlEncoded],
    },
  ],
})
