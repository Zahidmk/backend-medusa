// Syncs Odoo attribute variants (Color/Size...) into Medusa via the local webhook. Run with the backend running.
// Dry-run by default; APPLY=1 writes. ONLY=<odoo_template_id> limits to one product.
// Usage: APPLY=1 npm run sync:variants
require("dotenv").config()
const axios = require("axios"), { Client } = require("pg")
const { ODOO_URL: u, ODOO_DB_NAME: db, ODOO_USERNAME: un, ODOO_PASSWORD: pw, DATABASE_URL, ODOO_WEBHOOK_SECRET } = process.env
const BASE = (process.env.PUBLIC_BACKEND_URL || "https://admin.markasouq.com").replace(/\/$/, "")
const APPLY = process.env.APPLY === "1", ONLY = process.env.ONLY ? Number(process.env.ONLY) : null
const rpc = (p) => axios.post(u + "/jsonrpc", { jsonrpc: "2.0", method: "call", params: p, id: 1 }, { timeout: 120000 }).then((r) => { if (r.data.error) throw new Error(r.data.error.data?.message || r.data.error.message); return r.data.result })
;(async () => {
  const uid = await rpc({ service: "common", method: "authenticate", args: [db, un, pw, {}] })
  const call = (model, m, a, k) => rpc({ service: "object", method: "execute_kw", args: [db, uid, pw, model, m, a, k || {}] })
  const pg = new Client({ connectionString: DATABASE_URL }); await pg.connect()
  const mine = new Map((await pg.query(`select (metadata->>'odoo_id')::int oid, status from product where deleted_at is null and metadata ? 'odoo_id'`)).rows.map((r) => [r.oid, r.status]))
  const tpls = await call("product.template", "search_read", [[["active", "=", true], ["sale_ok", "=", true], ["attribute_line_ids", "!=", false]]],
    { fields: ["name", "default_code", "barcode", "retail_price", "weight", "custom_brand_id", "x_studio_brand_1", "product_variant_ids"], order: "id asc" })
  const todo = tpls.filter((t) => mine.has(t.id) && (!ONLY || t.id === ONLY) && t.product_variant_ids.length > 1)
  console.log(APPLY ? "APPLY" : "DRY RUN", "- Odoo attribute templates:", tpls.length, "| in Medusa with >1 variants:", todo.length, "| published among them:", todo.filter((t) => mine.get(t.id) === "published").length)
  let ok = 0, fail = 0, nvars = 0
  for (const t of todo) {
    const vs = await call("product.product", "read", [t.product_variant_ids], { fields: ["display_name", "default_code", "barcode", "retail_price", "qty_available", "free_qty", "product_template_attribute_value_ids", "image_variant_1920"] })
    const ptavIds = [...new Set(vs.flatMap((v) => v.product_template_attribute_value_ids))]
    const ptav = ptavIds.length ? await call("product.template.attribute.value", "read", [ptavIds], { fields: ["attribute_id", "product_attribute_value_id"] }) : []
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1); const pm = new Map(ptav.map((x) => [x.id, [cap(x.attribute_id[1]), x.product_attribute_value_id[1].replace(/^.*?:\s*/, "").trim()]]))
    const variants = vs.map((v) => ({
      variant_id: v.id, default_code: v.default_code || undefined, barcode: v.barcode || undefined,
      retail_price: v.retail_price || 0, free_qty: v.free_qty || v.qty_available || 0,
      attributes: Object.fromEntries(v.product_template_attribute_value_ids.map((i) => pm.get(i)).filter(Boolean)), name: v.display_name,
      image_url: v.image_variant_1920 ? `${BASE}/odoo/image/${t.id}?variant=${v.id}` : undefined,
    }))
    nvars += variants.length
    const body = { webhook_secret: ODOO_WEBHOOK_SECRET, event_type: "product.updated", product: {
      odoo_id: t.id, name: t.name, default_code: t.default_code || undefined, barcode: t.barcode || undefined, retail_price: t.retail_price || 0, weight: t.weight || undefined,
      custom_brand_id: t.custom_brand_id || undefined, brand: t.x_studio_brand_1 || undefined, variants } }
    if (!APPLY) { if (ok < 2) console.log("sample:", JSON.stringify({ ...body, webhook_secret: "***" }).slice(0, 700)); ok++; continue }
    try { const r = await axios.post("http://localhost:9000/odoo/webhooks/products", body, { timeout: 120000 }); ok++; if (ok <= 3) console.log("posted", t.id, JSON.stringify(r.data).slice(0, 120)) }
    catch (e) { fail++; console.log("FAIL", t.id, t.name.slice(0, 40), e.response?.status, JSON.stringify(e.response?.data || e.message).slice(0, 150)) }
  }
  console.log("done: products", ok, "failed", fail, "| variants", nvars)
  await pg.end()
})().catch((e) => { console.error("ERR", e.message); process.exit(1) })
