/**
 * Odoo Sync Admin API
 * Endpoints for syncing products from Odoo to MedusaJS
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import OdooSyncService from "../../../../modules/odoo-sync/service"

const odooService = new OdooSyncService()

interface SyncResult {
  success: boolean
  synced: number
  updated: number
  failed: number
  errors: string[]
  products: any[]
}

/**
 * POST /admin/odoo/sync
 * Sync products from Odoo to MedusaJS
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  try {
    const { limit = 100, dryRun = true } = req.body as {
      limit?: number
      dryRun?: boolean
    }

    if (!odooService.isConfigured()) {
      res.status(400).json({
        success: false,
        error: "Odoo is not configured. Please set environment variables.",
      })
      return
    }

    console.log(`Starting Odoo sync (dryRun: ${dryRun}, limit: ${limit})`)

    // Fetch products from Odoo
    const odooProducts = await odooService.fetchProducts(limit, 0)
    console.log(`Fetched ${odooProducts.length} products from Odoo`)

    const result: SyncResult = {
      success: true,
      synced: 0,
      updated: 0,
      failed: 0,
      errors: [],
      products: [],
    }

    // Get the product service from the container
    const productService = req.scope.resolve(Modules.PRODUCT)

    for (const odooProduct of odooProducts) {
      try {
        const medusaProduct = odooService.convertToMedusaProduct(odooProduct)
        result.products.push(medusaProduct)

        if (!dryRun) {
          // Check if product already exists by SKU
          const existingProducts = await productService.listProducts({
            q: medusaProduct.variants[0].sku,
          })

          const existingProduct = existingProducts.find(
            (p: any) =>
              p.variants?.some(
                (v: any) => v.sku === medusaProduct.variants[0].sku
              )
          )

          if (existingProduct) {
            // Update existing product
            // Title, description and status are managed in Medusa — only refresh Odoo metadata
            await productService.updateProducts(existingProduct.id, {
              metadata: { ...((existingProduct as any).metadata || {}), ...(medusaProduct.metadata || {}) },
            })
            result.updated++
          } else {
            // Create new product
            const productData = {
              title: medusaProduct.title as string,
              description: medusaProduct.description,
              handle: medusaProduct.handle,
              status: medusaProduct.status as "draft" | "published" | "proposed" | "rejected",
              weight: medusaProduct.weight,
              metadata: medusaProduct.metadata,
            }
            await productService.createProducts(productData)
            result.synced++
          }
        } else {
          result.synced++
        }
      } catch (error: any) {
        result.failed++
        result.errors.push(
          `Product ${odooProduct.name} (ID: ${odooProduct.id}): ${error.message}`
        )
      }
    }

    res.json({
      success: result.success,
      data: {
        dryRun,
        totalFetched: odooProducts.length,
        synced: result.synced,
        updated: result.updated,
        failed: result.failed,
        errors: result.errors,
        products: dryRun ? result.products : undefined,
      },
    })
  } catch (error: any) {
    console.error("Sync error:", error)
    res.status(500).json({
      success: false,
      error: error.message,
    })
  }
}

/**
 * GET /admin/odoo/sync
 * Get sync status and history
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  try {
    const isConfigured = odooService.isConfigured()
    const config = odooService.getConfig()

    let odooStatus = null
    if (isConfigured) {
      try {
        const connectionTest = await odooService.testConnection()
        odooStatus = connectionTest
      } catch (error: any) {
        odooStatus = {
          success: false,
          message: error.message,
        }
      }
    }

    res.json({
      success: true,
      data: {
        configured: isConfigured,
        config: {
          url: config.url,
          dbName: config.dbName,
          username: config.username,
        },
        odooStatus,
        endpoints: {
          products: "/admin/odoo/products",
          categories: "/admin/odoo/categories",
          inventory: "/admin/odoo/inventory",
          sync: "/admin/odoo/sync (POST)",
        },
      },
    })
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    })
  }
}
