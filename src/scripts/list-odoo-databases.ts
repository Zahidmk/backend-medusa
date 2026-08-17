/**
 * List Odoo Databases Script
 * Run with: npx ts-node src/scripts/list-odoo-databases.ts
 */

import axios, { AxiosInstance } from "axios"
import https from "https"

// Odoo server URLs to try
const URLS_TO_TRY = [
  (process.env.ODOO_URL || "").replace(/\/$/, ""),
  "https://me281a.odoo.com",
].filter(Boolean)

/**
 * Create axios client for Odoo JSON-RPC
 */
function createOdooClient(baseURL: string): AxiosInstance {
  return axios.create({
    baseURL,
    headers: {
      "Content-Type": "application/json",
    },
    httpsAgent: new https.Agent({
      rejectUnauthorized: false, // Allow self-signed certs for dev
    }),
  })
}

/**
 * List available databases on Odoo server
 */
async function listDatabases(baseURL: string): Promise<string[]> {
  const client = createOdooClient(baseURL)
  
  try {
    console.log(`\nTrying to list databases from: ${baseURL}`)
    
    // Method 1: Using /web/database/list
    const response = await client.post("/web/database/list", {
      jsonrpc: "2.0",
      method: "call",
      params: {},
      id: 1,
    })
    
    console.log("Response:", JSON.stringify(response.data, null, 2))
    
    if (response.data.result) {
      return response.data.result
    }
    return []
  } catch (error: any) {
    if (error.response) {
      console.log(`Status: ${error.response.status}`)
      console.log(`Data: ${JSON.stringify(error.response.data).slice(0, 500)}`)
    } else {
      console.log(`Error: ${error.message}`)
    }
    return []
  }
}

/**
 * Try to get database info via different methods
 */
async function getDatabaseInfo(baseURL: string): Promise<void> {
  const client = createOdooClient(baseURL)
  
  console.log(`\n--- Database Info for ${baseURL} ---`)
  
  // Try /web/database/selector
  try {
    console.log("\nTrying /web/database/selector...")
    const response = await client.get("/web/database/selector")
    console.log("Response:", response.data.slice(0, 500))
  } catch (error: any) {
    console.log(`Error: ${error.response?.status || error.message}`)
  }
  
  // Try /web/database/manager
  try {
    console.log("\nTrying /web/database/manager...")
    const response = await client.get("/web/database/manager")
    console.log("Response:", typeof response.data === 'string' ? response.data.slice(0, 500) : JSON.stringify(response.data).slice(0, 500))
  } catch (error: any) {
    console.log(`Error: ${error.response?.status || error.message}`)
  }
  
  // Try root to see redirect/info
  try {
    console.log("\nTrying root /...")
    const response = await client.get("/", { maxRedirects: 0 })
    console.log("Response:", typeof response.data === 'string' ? response.data.slice(0, 500) : JSON.stringify(response.data).slice(0, 500))
  } catch (error: any) {
    if (error.response) {
      console.log(`Status: ${error.response.status}`)
      console.log(`Headers: ${JSON.stringify(error.response.headers).slice(0, 500)}`)
      console.log(`Data: ${typeof error.response.data === 'string' ? error.response.data.slice(0, 500) : JSON.stringify(error.response.data).slice(0, 500)}`)
    }
  }
}

/**
 * Main function
 */
async function main() {
  console.log("🔍 Searching for Odoo databases...\n")
  
  for (const url of URLS_TO_TRY) {
    await getDatabaseInfo(url)
    const databases = await listDatabases(url)
    if (databases.length > 0) {
      console.log(`\n✅ Found databases on ${url}:`)
      databases.forEach((db) => console.log(`  - ${db}`))
    }
  }
  
  // Also try the exact URL from credentials
  console.log("\n--- Trying original URL ---")
  const originalUrl = (process.env.ODOO_URL || "").replace(/\/$/, "")
  if (originalUrl) {
    await getDatabaseInfo(originalUrl)
    await listDatabases(originalUrl)
  }
}

main()
