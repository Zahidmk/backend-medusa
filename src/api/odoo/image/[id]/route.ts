/**
 * GET /odoo/image/:id            → main image of Odoo product.template :id
 * GET /odoo/image/:id?gallery=N  → gallery image N (product.image) of that product
 * GET /odoo/image/:id?variant=V  → image of Odoo variant V (product.product)
 *
 * Fetches image_1920 through the Odoo API (authenticated), caches it on disk and
 * serves it. Needed because Odoo's public /web/image URL only works for products
 * published on the Odoo website.
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import axios from "axios"
import fs from "fs"
import path from "path"
import { ODOO_CONFIG } from "../../../../config/odoo"

const CACHE_DIR = path.join(process.cwd(), "static", "odoo-img")
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

let cachedUid: number | null = null

async function rpc(params: any): Promise<any> {
  const r = await axios.post(`${ODOO_CONFIG.url}/jsonrpc`, { jsonrpc: "2.0", method: "call", params, id: 1 }, { timeout: 30000 })
  if (r.data.error) throw new Error(r.data.error.data?.message || r.data.error.message || "Odoo error")
  return r.data.result
}

async function getUid(): Promise<number> {
  if (cachedUid) return cachedUid
  const uid = await rpc({ service: "common", method: "authenticate", args: [ODOO_CONFIG.db, ODOO_CONFIG.username, ODOO_CONFIG.password, {}] })
  if (!uid) throw new Error("Odoo authentication failed")
  cachedUid = uid
  return uid
}

async function fetchImage(model: string, recordId: number): Promise<Buffer | null> {
  const read = async () => {
    const uid = await getUid()
    return rpc({
      service: "object", method: "execute_kw",
      args: [ODOO_CONFIG.db, uid, ODOO_CONFIG.password, model, "read", [[recordId]], { fields: ["image_1920"] }],
    })
  }
  let rows: any[]
  try {
    rows = await read()
  } catch (e) {
    cachedUid = null // uid may be stale — retry once with a fresh login
    rows = await read()
  }
  const b64 = rows?.[0]?.image_1920
  return b64 ? Buffer.from(b64, "base64") : null
}

function detectMime(buf: Buffer): string {
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png"
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg"
  if (buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") return "image/webp"
  if (buf.slice(0, 3).toString() === "GIF") return "image/gif"
  if (buf.slice(0, 200).toString().includes("<svg")) return "image/svg+xml"
  return "application/octet-stream"
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const id = Number(req.params.id)
  const gallery = req.query.gallery !== undefined ? Number(req.query.gallery) : null
  const variant = req.query.variant !== undefined ? Number(req.query.variant) : null
  const bad = (n: number | null) => n !== null && (!Number.isInteger(n) || n <= 0)
  if (!Number.isInteger(id) || id <= 0 || bad(gallery) || bad(variant)) {
    return res.status(400).json({ message: "invalid id" })
  }

  const model = variant ? "product.product" : gallery ? "product.image" : "product.template"
  const recordId = variant || gallery || id
  const cacheFile = path.join(CACHE_DIR, `${model}-${recordId}.img`)

  try {
    let buf: Buffer | null = null
    try {
      const st = fs.statSync(cacheFile)
      if (Date.now() - st.mtimeMs < CACHE_TTL_MS) buf = fs.readFileSync(cacheFile)
    } catch { /* not cached */ }

    if (!buf) {
      buf = await fetchImage(model, recordId)
      if (!buf) return res.status(404).json({ message: "no image" })
      fs.mkdirSync(CACHE_DIR, { recursive: true })
      fs.writeFileSync(cacheFile, buf)
    }

    res.setHeader("Content-Type", detectMime(buf))
    res.setHeader("Cache-Control", "public, max-age=86400")
    return res.status(200).send(buf)
  } catch (e: any) {
    console.error(`[Odoo Image] ${model} ${recordId}: ${e.message}`)
    return res.status(502).json({ message: "could not fetch image from Odoo" })
  }
}
