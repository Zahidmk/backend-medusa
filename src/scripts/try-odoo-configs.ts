/**
 * Try multiple Odoo configurations
 * Run with: npx ts-node src/scripts/try-odoo-configs.ts
 */

import axios, { AxiosInstance } from "axios"
import https from "https"

const ODOO_USERNAME = "admin"
const ODOO_API_KEY = "bcbf8f1f9949b7bb66203265b7b88ebfd84b248f"

interface Config {
  url: string
  db: string
}

// All possible configurations to try
const CONFIGS: Config[] = [
  { url: (process.env.ODOO_URL || "").replace(/\/$/, ""), db: process.env.ODOO_DB_NAME || "" },
  { url: "https://me281a.odoo.com", db: "me281a" },
]

/**
 * Create axios client
 */
function createClient(baseURL: string): AxiosInstance {
  return axios.create({
    baseURL,
    headers: { "Content-Type": "application/json" },
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    timeout: 10000,
  })
}

/**
 * Test authentication
 */
async function testAuth(config: Config): Promise<boolean> {
  const client = createClient(config.url)
  
  try {
    const response = await client.post("/web/session/authenticate", {
      jsonrpc: "2.0",
      method: "call",
      params: {
        db: config.db,
        login: ODOO_USERNAME,
        password: ODOO_API_KEY,
      },
      id: 1,
    })

    if (response.data.result?.uid) {
      console.log(`✅ SUCCESS: ${config.url} with db="${config.db}"`)
      console.log(`   User ID: ${response.data.result.uid}`)
      console.log(`   Name: ${response.data.result.name}`)
      return true
    }
    
    if (response.data.error) {
      const errorMsg = response.data.error.message || response.data.error.data?.message || 'Unknown error'
      console.log(`❌ FAILED: ${config.url} / ${config.db}`)
      console.log(`   Error: ${errorMsg.slice(0, 100)}`)
    } else {
      console.log(`❓ UNKNOWN: ${config.url} / ${config.db}`)
      console.log(`   Response: ${JSON.stringify(response.data).slice(0, 100)}`)
    }
    return false
  } catch (error: any) {
    const status = error.response?.status || 'N/A'
    const msg = error.message || 'Unknown'
    console.log(`❌ ERROR: ${config.url} / ${config.db}`)
    console.log(`   Status: ${status}, Message: ${msg.slice(0, 80)}`)
    return false
  }
}

/**
 * Main
 */
async function main() {
  console.log("🔍 Trying multiple Odoo configurations...\n")
  
  for (const config of CONFIGS) {
    await testAuth(config)
    console.log("")
  }
  
  console.log("\n📋 Please verify your Odoo credentials:")
  console.log("   - Confirm the exact URL from your Odoo instance")
  console.log("   - Confirm the database name (usually shown in Odoo URL or settings)")
  console.log("   - Ensure the API key is valid and has proper permissions")
  console.log("\nYou can find the database name by:")
  console.log("   1. Logging into Odoo web interface")
  console.log("   2. Going to Settings > Database Manager")
  console.log("   3. Or check the URL after login (e.g., /web?db=DATABASE_NAME)")
}

main()
