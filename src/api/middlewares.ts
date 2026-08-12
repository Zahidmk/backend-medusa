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

function getSanitizedRawBodyPreview(rawBody: string): string {
  if (!rawBody) return "";
  return rawBody
    .substring(0, 300)
    .replace(/value=["']?[^"'\s>]{15,}["']?/gi, 'value="[REDACTED]"')
    .replace(/(trandata=)[^&\s<"']+/gi, '$1[REDACTED]')
    .replace(/(tranid=)[^&\s<"']+/gi, '$1[REDACTED]')
    .replace(/(paymentid=)[^&\s<"']+/gi, '$1[REDACTED]');
}

function parseKnetRawBody(rawBody: string): Record<string, any> {
  const result: Record<string, any> = {};
  if (!rawBody || typeof rawBody !== "string") return result;

  const trimmed = rawBody.trim();

  // Strategy 1: Direct Raw Hexadecimal Encrypted Payload (KNET POSTs raw hex string directly in request body)
  if (/^[0-9A-Fa-f]{32,}$/.test(trimmed) && trimmed.length % 2 === 0) {
    result.trandata = trimmed;
    result._rawFormat = "raw-trandata-hex";
    return result;
  }

  // Strategy 2: Standard URLSearchParams (for form-urlencoded, query strings, or key=value pairs)
  try {
    const params = new URLSearchParams(trimmed);
    for (const [key, val] of params.entries()) {
      if (key && val && !key.startsWith("<")) {
        result[key] = val;
        result[key.toLowerCase()] = val;
      }
    }
  } catch { /* ignore */ }

  if (result.trandata) {
    result._rawFormat = "url-encoded";
    return result;
  }

  // Strategy 3: Robust HTML Tag & Input Parser (case-insensitive for <INPUT>, <input>, any attribute ordering)
  const inputTagRegex = /<input\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = inputTagRegex.exec(trimmed)) !== null) {
    const tagStr = match[0];
    const nameMatch = /name=["']?([^"'\s/>]+)["']?/i.exec(tagStr);
    const valMatch = /value=["']?([^"'\s/>]+)["']?/i.exec(tagStr);
    if (nameMatch && nameMatch[1] && valMatch && valMatch[1] !== undefined) {
      const name = nameMatch[1];
      const val = valMatch[1];
      result[name] = val;
      result[name.toLowerCase()] = val;
    }
  }

  if (result.trandata) {
    result._rawFormat = "html-input";
    return result;
  }

  // Strategy 4: Key-Value regex scanner anywhere in body (e.g. trandata=... or paymentid=...)
  const kvRegex = /([a-zA-Z0-9_\-]+)=(?:["']([^"']*)["']|([^\s&<>]+))/g;
  let kvMatch: RegExpExecArray | null;
  while ((kvMatch = kvRegex.exec(trimmed)) !== null) {
    const key = kvMatch[1];
    const val = kvMatch[2] !== undefined ? kvMatch[2] : kvMatch[3];
    if (key && val && !key.startsWith("<") && !result[key]) {
      result[key] = val;
      result[key.toLowerCase()] = val;
    }
  }

  if (result.trandata) {
    result._rawFormat = "regex-match";
    return result;
  }

  // Strategy 5: HTML Error page detection (if KNET test portal returned an HTML error page)
  if (!result.trandata && !result.ErrorText && !result.errortext) {
    const titleMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(trimmed);
    const bodyTextMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(trimmed);
    if (titleMatch || bodyTextMatch) {
      const pageText = (titleMatch?.[1] || "") + " " + (bodyTextMatch?.[1] || "").replace(/<[^>]+>/g, " ");
      if (/error|cancel|invalid|fail/i.test(pageText)) {
        result.ErrorText = pageText.replace(/\s+/g, " ").trim().substring(0, 200);
        result._rawFormat = "html-error-page";
      }
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
        const trimmed = rawBody.trim();
        const parsedObj = parseKnetRawBody(rawBody);

        console.log(`[KNET Middleware] Raw body length: ${rawBody.length}`);
        console.log(`[KNET Middleware] Raw body format: ${parsedObj._rawFormat || "unknown"}`);
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
