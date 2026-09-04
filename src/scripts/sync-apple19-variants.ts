import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import http from "https"

function odooRequest(params: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      jsonrpc: "2.0",
      method: "call",
      params,
      id: Date.now()
    })
    const req = http.request({
      hostname: "oskarllc-new-36501645.dev.odoo.com",
      path: "/jsonrpc",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data)
      }
    }, res => {
      let body = ""
      res.on("data", chunk => body += chunk)
      res.on("end", () => {
        try { resolve(JSON.parse(body)) } catch (e) { reject(e) }
      })
    })
    req.on("error", reject)
    req.write(data)
    req.end()
  })
}

function genId(prefix: string): string {
  const c = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
  let id = prefix + "_"
  for (let i = 0; i < 26; i++) id += c[Math.floor(Math.random() * c.length)]
  return id
}

export default async function syncApple19({ container }: ExecArgs) {
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  console.log("🍏 Syncing Apple 19 multi-attribute template & 8 variants from Odoo...")

  // 1. Fetch template from Odoo
  const tmplRes = await odooRequest({
    service: "object",
    method: "execute_kw",
    args: [
      "oskarllc-new-36501645", 59, "123",
      "product.template", "read",
      [[71929]],
      { fields: ["id", "name", "list_price", "is_published", "product_variant_ids", "attribute_line_ids"] }
    ]
  })

  const tmpl = tmplRes.result?.[0]
  if (!tmpl) {
    console.error("❌ Apple 19 template 71929 not found in Odoo")
    return
  }

  // 2. Fetch attribute lines
  let attrLineMap: Record<number, { name: string }> = {}
  if (tmpl.attribute_line_ids?.length) {
    const linesRes = await odooRequest({
      service: "object",
      method: "execute_kw",
      args: [
        "oskarllc-new-36501645", 59, "123",
        "product.template.attribute.line", "read",
        [tmpl.attribute_line_ids],
        { fields: ["id", "attribute_id", "value_ids"] }
      ]
    })
    for (const l of linesRes.result || []) {
      attrLineMap[l.id] = { name: Array.isArray(l.attribute_id) ? l.attribute_id[1] : "Option" }
    }
  }

  // 3. Fetch all 8 product variants
  const varIds = tmpl.product_variant_ids || []
  const varsRes = await odooRequest({
    service: "object",
    method: "execute_kw",
    args: [
      "oskarllc-new-36501645", 59, "123",
      "product.product", "read",
      [varIds],
      { fields: ["id", "name", "display_name", "default_code", "barcode", "lst_price", "qty_available", "product_template_attribute_value_ids"] }
    ]
  })
  const variants = varsRes.result || []

  // 4. Fetch attribute values details
  const allValIds = Array.from(new Set(variants.flatMap((v: any) => v.product_template_attribute_value_ids || [])))
  let valDetailsMap: Record<number, { attribute_name: string; name: string }> = {}
  if (allValIds.length) {
    const valRes = await odooRequest({
      service: "object",
      method: "execute_kw",
      args: [
        "oskarllc-new-36501645", 59, "123",
        "product.template.attribute.value", "read",
        [allValIds],
        { fields: ["id", "attribute_id", "name"] }
      ]
    })
    for (const v of valRes.result || []) {
      valDetailsMap[v.id] = {
        attribute_name: Array.isArray(v.attribute_id) ? v.attribute_id[1] : "Option",
        name: v.name
      }
    }
  }

  console.log(`Found ${variants.length} variants for Apple 19 in Odoo:`)
  variants.forEach((v: any) => {
    const attrs = (v.product_template_attribute_value_ids || []).map((id: number) => {
      const d = valDetailsMap[id]
      return d ? `${d.attribute_name}: ${d.name}` : id
    })
    console.log(`  - Variant ID ${v.id} (${v.display_name}): ${attrs.join(", ")}`)
  })

  // 5. Ensure product template exists in Medusa DB
  let prodId: string
  const existingProd = await pg.raw(`SELECT id FROM product WHERE metadata->>'odoo_id' = '71929' LIMIT 1`)
  if (existingProd.rows?.length) {
    prodId = existingProd.rows[0].id
    await pg.raw(`UPDATE product SET status = 'published', updated_at = NOW() WHERE id = ?`, [prodId])
  } else {
    prodId = genId("prod")
    await pg.raw(`
      INSERT INTO product (id, title, handle, subtitle, description, status, weight, metadata, discountable, is_giftcard, created_at, updated_at)
      VALUES (?, 'Apple 19', 'apple-19', 'Apple', 'Apple 19 with multiple attributes', 'published', 0.5, ?, true, false, NOW(), NOW())
    `, [prodId, JSON.stringify({ odoo_id: 71929, odoo_stock: 10, brand: "Apple" })])
  }

  // Ensure Sales Channel link
  const scRes = await pg.raw(`SELECT id FROM sales_channel LIMIT 1`)
  if (scRes.rows?.length) {
    await pg.raw(`
      INSERT INTO product_sales_channel (id, product_id, sales_channel_id, created_at, updated_at)
      VALUES (?, ?, ?, NOW(), NOW()) ON CONFLICT (product_id, sales_channel_id) DO NOTHING
    `, [genId("psc"), prodId, scRes.rows[0].id])
  }

  // 6. Build product_option & product_option_value records
  // Group values by attribute title
  const optionMap: Record<string, Set<string>> = {}
  Object.values(valDetailsMap).forEach(d => {
    if (!optionMap[d.attribute_name]) optionMap[d.attribute_name] = new Set()
    optionMap[d.attribute_name].add(d.name)
  })

  await pg.raw(`DELETE FROM product_option_value WHERE option_id IN (SELECT id FROM product_option WHERE product_id = ?)`, [prodId])
  await pg.raw(`DELETE FROM product_option WHERE product_id = ?`, [prodId])

  const optionIdMap: Record<string, string> = {}
  const optionValueIdMap: Record<string, string> = {} // "Color:::Red" -> id

  for (const [optTitle, valSet] of Object.entries(optionMap)) {
    const optId = genId("opt")
    optionIdMap[optTitle] = optId
    await pg.raw(`
      INSERT INTO product_option (id, title, product_id, created_at, updated_at)
      VALUES (?, ?, ?, NOW(), NOW())
    `, [optId, optTitle, prodId])

    for (const valName of Array.from(valSet)) {
      const optValId = genId("optval")
      optionValueIdMap[`${optTitle}:::${valName}`] = optValId
      await pg.raw(`
        INSERT INTO product_option_value (id, value, option_id, created_at, updated_at)
        VALUES (?, ?, ?, NOW(), NOW())
      `, [optValId, valName, optId])
    }
  }

  // 7. Insert or update the 8 variants in product_variant table
  await pg.raw(`DELETE FROM product_variant WHERE product_id = ?`, [prodId])

  for (const v of variants) {
    const varId = genId("variant")
    const varSku = v.default_code || `APPLE19-${v.id}`
    const varTitle = v.display_name || "Apple 19 Variant"

    await pg.raw(`
      INSERT INTO product_variant (id, title, sku, barcode, product_id, allow_backorder, manage_inventory, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, true, false, ?, NOW(), NOW())
    `, [varId, varTitle, varSku, v.barcode || null, prodId, JSON.stringify({ odoo_variant_id: v.id, odoo_price: v.lst_price || 1 })])

    // Link variant to price set (1 KWD = 1000 fils)
    const psId = genId("pset")
    await pg.raw(`INSERT INTO price_set (id, created_at, updated_at) VALUES (?, NOW(), NOW())`, [psId])
    await pg.raw(`
      INSERT INTO product_variant_price_set (id, variant_id, price_set_id, created_at, updated_at)
      VALUES (?, ?, ?, NOW(), NOW())
    `, [genId("pvps"), varId, psId])
    await pg.raw(`
      INSERT INTO price (id, price_set_id, currency_code, amount, raw_amount, rules_count, created_at, updated_at)
      VALUES (?, ?, 'kwd', 1000, '{"value":"1000","precision":20}', 0, NOW(), NOW())
    `, [genId("price"), psId])

    // Link variant to option values
    for (const valId of (v.product_template_attribute_value_ids || [])) {
      const valDetail = valDetailsMap[valId]
      if (valDetail) {
        const optValId = optionValueIdMap[`${valDetail.attribute_name}:::${valDetail.name}`]
        if (optValId) {
          await pg.raw(`
            INSERT INTO product_variant_option (variant_id, option_value_id)
            VALUES (?, ?) ON CONFLICT DO NOTHING
          `, [varId, optValId])
        }
      }
    }
  }

  console.log(`✅ Apple 19 options & ${variants.length} variants successfully inserted into Medusa DB!`)
}
