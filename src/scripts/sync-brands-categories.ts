/**
 * Sync Brands + Categories from Odoo → MedusaJS
 *
 * - Downloads brand logos from Odoo (base64 → saves as file on server)
 * - Downloads category images from Odoo (base64 → saves as file on server)
 * - Deletes old dummy categories (Unsplash/placeholder images)
 * - Creates/updates real categories from Odoo public categories
 * - Creates/updates brands with real logo URLs
 *
 * Usage: npx medusa exec ./src/scripts/sync-brands-categories.ts
 */

import { ExecArgs } from "@medusajs/framework/types"
import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import fs from "fs"
import path from "path"
import OdooSyncService, { OdooBrand, OdooPublicCategory } from "../modules/odoo-sync/service"

// ─────────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────────

const ODOO_BASE_URL = process.env.ODOO_URL || "https://oskarllc-new-31031096.dev.odoo.com"

// Where to save images on the server
const BRANDS_UPLOAD_DIR = path.join(process.cwd(), "static", "uploads", "brands")
const CATEGORIES_UPLOAD_DIR = path.join(process.cwd(), "static", "uploads", "categories")

// Public URL prefix (served by MedusaJS static middleware)
const BRANDS_URL_PREFIX = "/static/uploads/brands"
const CATEGORIES_URL_PREFIX = "/static/uploads/categories"

// ─────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/(^-|-$)/g, "")
    .substring(0, 100)
}

/**
 * Save a base64 image string to disk.
 * Returns the public URL or null if no image data.
 */
function saveBase64Image(base64Data: string | false, dir: string, filename: string): string | null {
  if (!base64Data || typeof base64Data !== "string") return null

  // Odoo returns base64 without data: prefix
  const buffer = Buffer.from(base64Data, "base64")
  if (buffer.length < 100) return null // empty / corrupt

  // Detect image type from magic bytes or SVG text
  let ext = "jpg"
  if (buffer[0] === 0x89 && buffer[1] === 0x50) ext = "png"
  else if (buffer[0] === 0x47 && buffer[1] === 0x49) ext = "gif"
  else if (buffer[0] === 0x52 && buffer[1] === 0x49) ext = "webp"
  else if (buffer.slice(0, 100).toString('utf8').trim().startsWith('<svg') || 
           buffer.slice(0, 100).toString('utf8').trim().startsWith('<?xml')) ext = "svg"

  const fullFilename = `${filename}.${ext}`
  const filePath = path.join(dir, fullFilename)

  fs.writeFileSync(filePath, buffer)
  return fullFilename
}

/**
 * Ensure upload directory exists
 */
function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
    console.log(`   📁 Created directory: ${dir}`)
  }
}

// ─────────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────────

export default async function syncBrandsCategories({ container }: ExecArgs) {
  const pgConnection = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const productService = container.resolve(Modules.PRODUCT)

  let brandService: any
  try {
    brandService = container.resolve("brands")
  } catch {
    console.error("❌ Brands module not available")
    return
  }

  console.log("\n" + "═".repeat(60))
  console.log("  🔄 ODOO → BRANDS + CATEGORIES SYNC")
  console.log("  📅 " + new Date().toISOString())
  console.log("═".repeat(60))

  // ── Connect to Odoo ──
  const odoo = new OdooSyncService()
  if (!odoo.isConfigured()) {
    console.error("❌ Odoo not configured. Check ODOO_URL, ODOO_DB_NAME, ODOO_USERNAME, ODOO_API_KEY in .env")
    return
  }

  const connectionTest = await odoo.testConnection()
  if (!connectionTest.success) {
    console.error("❌ Odoo connection failed:", connectionTest.message)
    return
  }
  console.log(`\n✅ Connected to Odoo (${ODOO_BASE_URL})`)

  // Ensure upload directories exist
  ensureDir(BRANDS_UPLOAD_DIR)
  ensureDir(CATEGORIES_UPLOAD_DIR)

  // ══════════════════════════════════════════════
  //  PART 1 — BRANDS
  // ══════════════════════════════════════════════

  console.log("\n" + "─".repeat(60))
  console.log("  🏷️  SYNCING BRANDS")
  console.log("─".repeat(60))

  let odooBrands: OdooBrand[] = []
  try {
    odooBrands = await odoo.fetchBrands()
    console.log(`\n   📥 Fetched ${odooBrands.length} brands from Odoo`)
  } catch (err: any) {
    console.warn(`   ⚠️  Could not fetch brands: ${err.message}`)
  }

  let brandsCreated = 0
  let brandsUpdated = 0
  let brandsNoLogo = 0

  for (const odooBrand of odooBrands) {
    try {
      const slug = slugify(odooBrand.name)

      // Save logo image from base64
      let logoUrl: string | null = null
      if (odooBrand.logo && typeof odooBrand.logo === "string") {
        const filename = saveBase64Image(odooBrand.logo, BRANDS_UPLOAD_DIR, `brand-${slug}`)
        if (filename) {
          logoUrl = `${BRANDS_URL_PREFIX}/${filename}`
          console.log(`   🖼️  Logo saved: ${odooBrand.name} → ${filename}`)
        } else {
          brandsNoLogo++
          console.log(`   ⚠️  No logo data for brand: ${odooBrand.name}`)
        }
      } else {
        brandsNoLogo++
        console.log(`   ⚠️  Brand "${odooBrand.name}" has no logo in Odoo`)
      }

      // Check if brand exists
      const existing = await brandService.listBrands({ slug })

      if (existing.length === 0) {
        // Create new brand
        await brandService.createBrands({
          name: odooBrand.name,
          slug,
          description: odooBrand.description || null,
          logo_url: logoUrl,
          is_active: true,
        })
        brandsCreated++
        console.log(`   ✅ Created brand: ${odooBrand.name}`)
      } else {
        // Update existing brand logo_url
        await pgConnection.raw(
          `UPDATE brand SET logo_url = ?, updated_at = NOW() WHERE id = ?`,
          [logoUrl, existing[0].id]
        )
        brandsUpdated++
        console.log(`   📝 Updated brand: ${odooBrand.name}`)
      }
    } catch (err: any) {
      console.warn(`   ❌ Brand "${odooBrand.name}" failed: ${err.message}`)
    }
  }

  console.log(`\n   ✅ Created: ${brandsCreated}`)
  console.log(`   📝 Updated: ${brandsUpdated}`)
  console.log(`   ⚠️  No logo (ask Odoo dev to add): ${brandsNoLogo}`)

  // ══════════════════════════════════════════════
  //  PART 2 — CATEGORIES
  // ══════════════════════════════════════════════

  console.log("\n" + "─".repeat(60))
  console.log("  📁 SYNCING CATEGORIES")
  console.log("─".repeat(60))

  let odooCategories: OdooPublicCategory[] = []
  try {
    odooCategories = await odoo.fetchPublicCategories()
    console.log(`\n   📥 Fetched ${odooCategories.length} categories from Odoo`)
  } catch (err: any) {
    console.error(`   ❌ Could not fetch categories: ${err.message}`)
    return
  }

  if (odooCategories.length === 0) {
    console.log("   ⚠️  No categories found in Odoo. Ask Odoo developer to add them.")
    return
  }

  // ── Step 1: Delete old dummy categories ──
  console.log("\n   🗑️  Removing old dummy categories...")
  try {
    // Soft-delete all existing categories
    await pgConnection.raw(
      `UPDATE product_category SET deleted_at = NOW() WHERE deleted_at IS NULL`
    )
    console.log("   ✅ Old categories cleared")
  } catch (err: any) {
    console.warn(`   ⚠️  Could not clear old categories: ${err.message}`)
  }

  // ── Step 2: Sort categories by parent_path depth (number of slashes or path length) ──
  // shorter paths (roots/parents) will be processed first,
  // ensuring parent categories are ALWAYS created in Medusa before their children.
  odooCategories.sort((a, b) => {
    const depthA = (a.parent_path || "").split("/").filter(Boolean).length
    const depthB = (b.parent_path || "").split("/").filter(Boolean).length
    return depthA - depthB
  })

  console.log(`\n   📊 Total Odoo categories to process: ${odooCategories.length}`)

  let catsCreated = 0
  let catsNoImage = 0

  // Map Odoo category ID → Medusa category handle (for parent linking)
  const odooIdToHandle = new Map<number, string>()

  // ── Step 3: Create categories in hierarchy order ──
  console.log("\n   Creating categories...")
  for (const oCategory of odooCategories) {
    const parentOdooId = Array.isArray(oCategory.parent_id) ? oCategory.parent_id[0] : null
    const parentHandle = parentOdooId ? odooIdToHandle.get(parentOdooId) : null

    let parentMedusaId: string | null = null
    if (parentHandle) {
      const parentRows = await pgConnection.raw(
        `SELECT id FROM product_category WHERE handle = ? AND deleted_at IS NULL LIMIT 1`,
        [parentHandle]
      )
      parentMedusaId = parentRows.rows[0]?.id || null
    }

    // Fallback: look up parent by odoo_id in metadata
    if (!parentMedusaId && parentOdooId) {
      const parentByOdooId = await pgConnection.raw(
        `SELECT id FROM product_category WHERE metadata->>'odoo_id' = ? AND deleted_at IS NULL LIMIT 1`,
        [String(parentOdooId)]
      )
      parentMedusaId = parentByOdooId.rows[0]?.id || null
    }

    await createOrUpdateCategory(oCategory, parentMedusaId, pgConnection, productService, {
      odooIdToHandle,
      catsCreated: () => catsCreated++,
      catsNoImage: () => catsNoImage++,
    })
  }

  console.log(`\n   ✅ Created: ${catsCreated}`)
  console.log(`   ⚠️  No image (ask Odoo dev to add): ${catsNoImage}`)

  // ══════════════════════════════════════════════
  //  DONE
  // ══════════════════════════════════════════════

  console.log("\n" + "═".repeat(60))
  console.log("  ✅ SYNC COMPLETE")
  console.log("═".repeat(60))
  console.log(`   🏷️  Brands: ${brandsCreated} created, ${brandsUpdated} updated, ${brandsNoLogo} missing logo`)
  console.log(`   📁 Categories: ${catsCreated} created, ${catsNoImage} missing image`)
  if (brandsNoLogo > 0 || catsNoImage > 0) {
    console.log(`\n   📢 Action needed: Ask Odoo developer to add missing images.`)
    console.log(`      Then re-run: npx medusa exec ./src/scripts/sync-brands-categories.ts`)
  }
  console.log("═".repeat(60) + "\n")
}

// ─────────────────────────────────────────────────
//  HELPER — Create or update a single category
// ─────────────────────────────────────────────────

async function createOrUpdateCategory(
  oCategory: OdooPublicCategory,
  parentMedusaId: string | null,
  pgConnection: any,
  productService: any,
  counters: {
    odooIdToHandle: Map<number, string>
    catsCreated: () => void
    catsNoImage: () => void
  }
) {
  try {
    const handle = slugify(oCategory.name)
    counters.odooIdToHandle.set(oCategory.id, handle)

    // Save category image from base64
    let imageUrl: string | null = null
    if (oCategory.image_1920 && typeof oCategory.image_1920 === "string") {
      const filename = saveBase64Image(oCategory.image_1920, CATEGORIES_UPLOAD_DIR, `cat-${handle}`)
      if (filename) {
        imageUrl = `${CATEGORIES_URL_PREFIX}/${filename}`
        console.log(`   🖼️  Image saved: ${oCategory.name} → ${filename}`)
      } else {
        counters.catsNoImage()
        console.log(`   ⚠️  No image data for category: ${oCategory.name}`)
      }
    } else {
      counters.catsNoImage()
      console.log(`   ⚠️  Category "${oCategory.name}" has no image in Odoo`)
    }

    // Check if category already exists (even soft-deleted, we restore it)
    const existing = await pgConnection.raw(
      `SELECT id FROM product_category WHERE handle = ? LIMIT 1`,
      [handle]
    )

    const metadata = {
      image_url: imageUrl,
      odoo_id: oCategory.id,
    }

    if (existing.rows.length > 0) {
      // Restore + update
      await pgConnection.raw(
        `UPDATE product_category 
         SET name = ?, parent_category_id = ?, metadata = ?, is_active = true, deleted_at = NULL, updated_at = NOW()
         WHERE handle = ?`,
        [oCategory.name, parentMedusaId, JSON.stringify(metadata), handle]
      )
    } else {
      // Create new
      await productService.createProductCategories({
        name: oCategory.name,
        handle,
        parent_category_id: parentMedusaId,
        is_active: true,
        metadata,
      })
    }

    counters.catsCreated()
    console.log(`   ✅ ${parentMedusaId ? "  " : ""}${oCategory.name}${imageUrl ? " 🖼️" : " (no image)"}`)
  } catch (err: any) {
    console.warn(`   ❌ Category "${oCategory.name}" failed: ${err.message}`)
  }
}
