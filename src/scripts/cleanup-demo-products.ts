import { ExecArgs, IProductModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

const DEMO_HANDLES = [
  // Apple demo products
  "iphone-17-pro-max",
  "iphone-17-pro",
  "macbook-pro-14",
  "macbook-air-13",
  "airpods-pro-3",
  "apple-watch-ultra-3",
  "ipad-pro-12",
  "airpods-max",
  // Hot deals demo products
  "samsung-s24-ultra",
  "sony-wh1000xm5",
  "jbl-flip-6",
  "logitech-gpro-x",
  "anker-powercore-26800",
  "samsung-watch-6",
  // Powerbank demo products
  "anker-powercore-20000",
  "xiaomi-pb3-pro",
  "samsung-wireless-pb",
  "baseus-65w-30000",
  "anker-737-24k",
  "ugreen-145w",
  // Medusa default demo handles
  "shirt",
  "sweatshirt",
  "sweatpants",
  "shorts",
  "mug",
]

export default async function cleanupDemoProducts({ container }: ExecArgs) {
  const productService: IProductModuleService = container.resolve(Modules.PRODUCT)

  console.log("🧹 Cleaning up demo products...")
  console.log("=" .repeat(50))

  let deletedCount = 0

  for (const handle of DEMO_HANDLES) {
    try {
      const existing = await productService.listProducts({ handle })
      if (existing.length > 0) {
        const ids = existing.map((p) => p.id)
        await productService.deleteProducts(ids)
        console.log(`  ✓ Deleted demo product(s) for handle '${handle}': ${ids.join(", ")}`)
        deletedCount += ids.length
      }
    } catch (e: any) {
      console.log(`  ⚠ Could not delete handle '${handle}': ${e.message}`)
    }
  }

  console.log("\n" + "=".repeat(50))
  console.log(`🎉 Demo product cleanup complete! Total deleted: ${deletedCount}`)
}
