import { ExecArgs } from "@medusajs/framework/types"
import OdooSyncService from "../modules/odoo-sync/service"

export default async function checkBrandOdooFields({ container }: ExecArgs) {
  console.log("🔍 Inspecting Odoo Brand records for image fields...")

  const odoo = new OdooSyncService()
  if (!odoo.isConfigured()) {
    console.error("Odoo not configured.")
    return
  }

  await (odoo as any).ensureAuth()

  try {
    // Fetch all brands from custom.product.brand
    const brands = await (odoo as any).searchRead(
      "custom.product.brand",
      [],
      [], // fetch ALL fields for debugging
      50
    )

    console.log(`Found ${brands.length} brand records in Odoo:\n`)

    for (const b of brands) {
      const keys = Object.keys(b)
      const imgKeys = keys.filter(k => k.includes("image") || k.includes("logo") || k.includes("pic") || k.includes("icon"))
      
      const hasImage1920 = Boolean(b.image_1920 && b.image_1920.length > 20)
      const otherImgs = imgKeys.filter(k => b[k] && typeof b[k] === 'string' && b[k].length > 20)

      console.log(`• Brand "${b.name}" (ID: ${b.id}):`)
      console.log(`    image_1920 present? ${hasImage1920 ? "YES (" + b.image_1920.length + " bytes)" : "NO"}`)
      if (otherImgs.length > 0) {
        console.log(`    Other image fields present: ${otherImgs.join(", ")}`)
      }
    }

  } catch (err: any) {
    console.error("Failed to inspect Odoo brands:", err.message)
  }
}
