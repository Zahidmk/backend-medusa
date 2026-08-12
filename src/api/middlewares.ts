import { defineMiddlewares, authenticate } from "@medusajs/framework/http"
import type { MedusaRequest, MedusaResponse, MedusaNextFunction } from "@medusajs/framework/http"
import Busboy from "busboy"
import path from "path"
import fs from "fs"
import { injectBranding } from "./middlewares/branding"

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

function parseKnetRawBody(rawBody: string): Record<string, any> {
  const result: Record<string, any> = {};
  if (!rawBody || typeof rawBody !== "string") return result;

  const trimmed = rawBody.trim();

  // Strategy 1: URLSearchParams (works for standard form-urlencoded or plain query string regardless of Content-Type header)
  try {
    const params = new URLSearchParams(trimmed);
    for (const [key, val] of params.entries()) {
      if (key && val && !key.startsWith("<")) {
        result[key] = val;
      }
    }
  } catch { /* ignore */ }

  // Strategy 2: HTML input field extraction if trandata was not found via URLSearchParams
  if (!result.trandata) {
    const inputRegex = /<input\s+[^>]*name=["']?([^"'\s>]+)["']?[^>]*value=["']?([^"'\s>]*)["']?[^>]*>/gi;
    let match: RegExpExecArray | null;
    while ((match = inputRegex.exec(trimmed)) !== null) {
      const name = match[1];
      const val = match[2];
      if (name) {
        result[name] = val;
      }
    }

    const inputRegexAlt = /<input\s+[^>]*value=["']?([^"'\s>]*)["']?[^>]*name=["']?([^"'\s>]+)["']?[^>]*>/gi;
    while ((match = inputRegexAlt.exec(trimmed)) !== null) {
      const val = match[1];
      const name = match[2];
      if (name && !result[name]) {
        result[name] = val;
      }
    }
  }

  // Strategy 3: Regex fallback if trandata key=value is embedded in raw body text/html
  if (!result.trandata) {
    const trandataMatch = /trandata=([A-Fa-f0-9]+)/i.exec(trimmed) || /trandata=([^&\s<"']+)/i.exec(trimmed);
    if (trandataMatch && trandataMatch[1]) {
      result.trandata = trandataMatch[1];
    }
  }

  return result;
}

async function parseKnetUrlEncoded(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  try {
    const ct = (req.headers["content-type"] || "unknown") as string;
    console.log("[KNET Middleware] Callback detected");
    console.log(`[KNET Middleware] Content-Type: ${ct}`);

    let rawBody = "";
    req.on("data", (chunk) => {
      rawBody += chunk.toString();
    });
    req.on("end", () => {
      try {
        console.log(`[KNET Middleware] Raw body length: ${rawBody.length}`);
        const parsedObj = parseKnetRawBody(rawBody);
        
        console.log(`[KNET Middleware] Parsed body keys: ${Object.keys(parsedObj).join(", ")}`);
        console.log(`[KNET Middleware] trandata present: ${parsedObj.trandata ? "yes" : "no"}`);

        ;(req as any).body = parsedObj;
        ;(req as any).rawBody = rawBody;
      } catch (err) {
        console.error("[KNET Middleware] Failed to parse request body", err);
        ;(req as any).body = {};
      }
      next();
    });
    return;
  } catch (e) {
    console.error("[KNET Middleware] Error reading request stream", e);
  }
  next();
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
    {
      matcher: "/store/carts/*/shipping-methods",
      middlewares: [authenticate("customer", ["session", "bearer"], { allowUnauthenticated: true })],
    },
    {
      matcher: "/store/carts/*/payment-sessions",
      middlewares: [authenticate("customer", ["session", "bearer"], { allowUnauthenticated: true })],
    },
    {
      matcher: "/store/carts/*",
      middlewares: [authenticate("customer", ["session", "bearer"], { allowUnauthenticated: true })],
    },
    {
      matcher: "/store/orders",
      method: "POST",
      middlewares: [authenticate("customer", ["session", "bearer"], { allowUnauthenticated: true })],
    },
    {
      matcher: "/store/orders/me",
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },
    {
      matcher: "/store/orders/*",
      middlewares: [authenticate("customer", ["session", "bearer"], { allowUnauthenticated: true })],
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
      // Disable Medusa's JSON body parser for KNET POST callback so urlencoded data is read cleanly
      matcher: "/knet/callback",
      method: "POST",
      bodyParser: false,
      middlewares: [parseKnetUrlEncoded],
    },
  ],
})
