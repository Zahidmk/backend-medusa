/**
 * Test Odoo Connection Script
 * Run with: npx ts-node src/scripts/test-odoo-connection.ts
 */

import xmlrpc from "xmlrpc"
import axios from "axios"
import https from "https"

// Disable SSL verification for dev Odoo instances
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"

// Odoo credentials from environment
const ODOO_URL = (process.env.ODOO_URL || "").replace(/\/$/, "")
const ODOO_DB_NAME = process.env.ODOO_DB_NAME || ""
const ODOO_USERNAME = process.env.ODOO_USERNAME || ""
const ODOO_API_KEY = process.env.ODOO_API_KEY || process.env.ODOO_PASSWORD || ""

interface OdooProduct {
  id: number
  name: string
  default_code: string | false
  list_price: number
  standard_price: number
  description_sale: string | false
  description: string | false
  categ_id: [number, string] | false
  weight: number
  qty_available: number
  virtual_available: number
  active: boolean
  image_1920: string | false
  barcode: string | false
  type: string
}

/**
 * Create XML-RPC client for Odoo
 */
function createOdooClient(path: string): xmlrpc.Client {
  const url = new URL(path, ODOO_URL)
  const isSecure = url.protocol === "https:"
  
  const clientOptions: any = {
    host: url.hostname,
    port: isSecure ? 443 : (parseInt(url.port) || 80),
    path: url.pathname,
    rejectUnauthorized: false, // Allow self-signed certs for dev
  }
  
  if (isSecure) {
    return xmlrpc.createSecureClient(clientOptions)
  }
  return xmlrpc.createClient(clientOptions)
}

/**
 * Authenticate with Odoo and get user ID
 */
async function authenticateOdoo(): Promise<number | false> {
  return new Promise((resolve, reject) => {
    const client = createOdooClient("/xmlrpc/2/common")
    
    client.methodCall(
      "authenticate",
      [ODOO_DB_NAME, ODOO_USERNAME, ODOO_API_KEY, {}],
      (error, uid) => {
        if (error) {
          console.error("Authentication error:", error)
          reject(error)
          return
        }
        resolve(uid as number | false)
      }
    )
  })
}

/**
 * Check Odoo version
 */
async function getOdooVersion(): Promise<any> {
  return new Promise((resolve, reject) => {
    const client = createOdooClient("/xmlrpc/2/common")
    
    client.methodCall("version", [], (error, result) => {
      if (error) {
        console.error("Version check error:", error)
        reject(error)
        return
      }
      resolve(result)
    })
  })
}

/**
 * Execute Odoo method
 */
async function executeOdoo(
  uid: number,
  model: string,
  method: string,
  args: any[],
  kwargs: Record<string, any> = {}
): Promise<any> {
  return new Promise((resolve, reject) => {
    const client = createOdooClient("/xmlrpc/2/object")
    
    client.methodCall(
      "execute_kw",
      [ODOO_DB_NAME, uid, ODOO_API_KEY, model, method, args, kwargs],
      (error, result) => {
        if (error) {
          console.error(`Error executing ${model}.${method}:`, error)
          reject(error)
          return
        }
        resolve(result)
      }
    )
  })
}

/**
 * Fetch products from Odoo
 */
async function fetchProducts(uid: number): Promise<OdooProduct[]> {
  // Get product IDs
  const productIds = await executeOdoo(
    uid,
    "product.product",
    "search",
    [[["active", "=", true]]],
    { limit: 100 }
  )
  
  console.log(`Found ${productIds.length} products`)
  
  if (productIds.length === 0) {
    return []
  }
  
  // Fetch product details
  const products = await executeOdoo(
    uid,
    "product.product",
    "read",
    [productIds],
    {
      fields: [
        "id",
        "name",
        "default_code",
        "list_price",
        "standard_price",
        "description_sale",
        "description",
        "categ_id",
        "weight",
        "qty_available",
        "virtual_available",
        "active",
        "barcode",
        "type",
        "image_1920",
      ],
    }
  )
  
  return products as OdooProduct[]
}

/**
 * Fetch inventory/stock levels from Odoo
 */
async function fetchInventory(uid: number): Promise<any[]> {
  // Get stock quants (inventory levels)
  const quantIds = await executeOdoo(
    uid,
    "stock.quant",
    "search",
    [[["quantity", ">", 0]]],
    { limit: 100 }
  )
  
  console.log(`Found ${quantIds.length} stock quants`)
  
  if (quantIds.length === 0) {
    return []
  }
  
  // Fetch quant details
  const quants = await executeOdoo(
    uid,
    "stock.quant",
    "read",
    [quantIds],
    {
      fields: [
        "id",
        "product_id",
        "location_id",
        "quantity",
        "reserved_quantity",
      ],
    }
  )
  
  return quants
}

/**
 * Fetch categories from Odoo
 */
async function fetchCategories(uid: number): Promise<any[]> {
  const categoryIds = await executeOdoo(
    uid,
    "product.category",
    "search",
    [[]],
    { limit: 100 }
  )
  
  console.log(`Found ${categoryIds.length} categories`)
  
  if (categoryIds.length === 0) {
    return []
  }
  
  const categories = await executeOdoo(
    uid,
    "product.category",
    "read",
    [categoryIds],
    {
      fields: ["id", "name", "parent_id", "complete_name"],
    }
  )
  
  return categories
}

/**
 * Main test function
 */
async function main() {
  console.log("🔄 Testing Odoo Connection...")
  console.log(`URL: ${ODOO_URL}`)
  console.log(`Database: ${ODOO_DB_NAME}`)
  console.log(`Username: ${ODOO_USERNAME}`)
  console.log("---")
  
  try {
    // Check version
    console.log("\n📋 Checking Odoo version...")
    const version = await getOdooVersion()
    console.log("Odoo Version:", JSON.stringify(version, null, 2))
    
    // Authenticate
    console.log("\n🔐 Authenticating...")
    const uid = await authenticateOdoo()
    
    if (!uid) {
      console.error("❌ Authentication failed - invalid credentials")
      return
    }
    
    console.log(`✅ Authentication successful! User ID: ${uid}`)
    
    // Fetch categories
    console.log("\n📁 Fetching categories...")
    const categories = await fetchCategories(uid)
    console.log("Categories sample:", JSON.stringify(categories.slice(0, 5), null, 2))
    
    // Fetch products
    console.log("\n📦 Fetching products...")
    const products = await fetchProducts(uid)
    console.log("Products sample:")
    products.slice(0, 5).forEach((p) => {
      console.log(`  - ${p.name} (SKU: ${p.default_code || "N/A"}) - Price: ${p.list_price} - Stock: ${p.qty_available}`)
    })
    
    // Fetch inventory
    console.log("\n📊 Fetching inventory...")
    const inventory = await fetchInventory(uid)
    console.log("Inventory sample:", JSON.stringify(inventory.slice(0, 5), null, 2))
    
    // Summary
    console.log("\n" + "=".repeat(50))
    console.log("📈 SUMMARY")
    console.log("=".repeat(50))
    console.log(`Total Categories: ${categories.length}`)
    console.log(`Total Products: ${products.length}`)
    console.log(`Total Stock Quants: ${inventory.length}`)
    
    // Save products to JSON for review
    const fs = await import("fs")
    const outputPath = "./odoo-products-export.json"
    fs.writeFileSync(
      outputPath,
      JSON.stringify({ categories, products, inventory }, null, 2)
    )
    console.log(`\n💾 Full data exported to: ${outputPath}`)
    
  } catch (error) {
    console.error("❌ Error:", error)
  }
}

main()
