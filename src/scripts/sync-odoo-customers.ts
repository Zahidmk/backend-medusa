import { ExecArgs } from "@medusajs/framework/types"
import axios from "axios"

/**
 * Sync Customers from Odoo to MedusaJS
 * 
 * This script imports customers from Odoo into MedusaJS.
 * Run with: yarn sync:customers
 */

interface OdooPartner {
  id: number
  name: string
  email: string | false
  phone: string | false
  mobile: string | false
  street: string | false
  street2: string | false
  city: string | false
  zip: string | false
  country_id: [number, string] | false
  customer_rank: number
  is_company: boolean
}

// Odoo configuration
const ODOO_URL = process.env.ODOO_URL || "https://oskarllc-new-31031096.dev.odoo.com"
const ODOO_DB = process.env.ODOO_DB_NAME || "oskarllc-new-31031096"
const ODOO_USERNAME = process.env.ODOO_USERNAME || "SYG"
const ODOO_PASSWORD = process.env.ODOO_PASSWORD || "S123456"

export default async function syncOdooCustomers({ container }: ExecArgs) {
  console.log("\n👥 Syncing Customers from Odoo to MedusaJS...")
  console.log("=".repeat(50))

  // 1. Authenticate with Odoo
  console.log("\n1️⃣  Authenticating with Odoo...")
  
  let uid: number
  try {
    const authResponse = await axios.post(`${ODOO_URL}/jsonrpc`, {
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "common",
        method: "authenticate",
        args: [ODOO_DB, ODOO_USERNAME, ODOO_PASSWORD, {}]
      },
      id: 1
    })
    
    uid = authResponse.data.result
    if (!uid) {
      console.error("❌ Authentication failed")
      return
    }
    console.log(`✅ Authenticated (UID: ${uid})`)
  } catch (error: any) {
    console.error("❌ Authentication failed:", error.message)
    return
  }

  // 2. Fetch customers from Odoo
  console.log("\n2️⃣  Fetching customers from Odoo...")
  
  let odooCustomers: OdooPartner[] = []
  try {
    const response = await axios.post(`${ODOO_URL}/jsonrpc`, {
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [
          ODOO_DB,
          uid,
          ODOO_PASSWORD,
          "res.partner",
          "search_read",
          [[["customer_rank", ">", 0], ["email", "!=", false]]],
          {
            fields: [
              "id", "name", "email", "phone", "mobile",
              "street", "street2", "city", "zip", "country_id",
              "customer_rank", "is_company"
            ],
            limit: 200
          }
        ]
      },
      id: 2
    })
    
    odooCustomers = response.data.result || []
    console.log(`✅ Found ${odooCustomers.length} customers in Odoo`)
  } catch (error: any) {
    console.error("❌ Failed to fetch customers:", error.message)
    return
  }

  if (odooCustomers.length === 0) {
    console.log("ℹ️  No customers with email found in Odoo")
    return
  }

  // 3. Get database connection
  const { Pool } = require("pg")
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || "postgres://marqa_user:marqa123@localhost:5432/marqa_souq_dev",
  })

  // 4. Check existing customers
  console.log("\n3️⃣  Checking existing customers in MedusaJS...")
  
  const existingCustomers = await pool.query(
    "SELECT id, email, metadata FROM customer WHERE deleted_at IS NULL"
  )
  
  const existingEmails = new Set(existingCustomers.rows.map((c: any) => c.email?.toLowerCase()))
  const existingOdooIds = new Set(
    existingCustomers.rows
      .filter((c: any) => c.metadata?.odoo_id)
      .map((c: any) => c.metadata.odoo_id)
  )
  
  console.log(`📊 Existing customers: ${existingCustomers.rows.length}`)

  // 5. Import customers
  console.log("\n4️⃣  Importing customers...")
  
  let imported = 0
  let skipped = 0
  let errors = 0

  for (const customer of odooCustomers) {
    const email = customer.email?.toString().toLowerCase().trim()
    
    if (!email || email === "false") {
      skipped++
      continue
    }

    // Skip if already exists
    if (existingEmails.has(email) || existingOdooIds.has(customer.id)) {
      skipped++
      continue
    }

    try {
      // Parse name into first/last
      const nameParts = (customer.name || "").trim().split(" ")
      const firstName = nameParts[0] || "Customer"
      const lastName = nameParts.slice(1).join(" ") || ""

      const customerId = `cus_odoo_${customer.id}_${Date.now()}`

      // Check if customer with this email already exists
      const existingCheck = await pool.query(
        "SELECT id FROM customer WHERE email = $1 AND deleted_at IS NULL LIMIT 1",
        [email]
      )
      
      if (existingCheck.rows.length > 0) {
        // Update existing customer with Odoo metadata
        await pool.query(`
          UPDATE customer 
          SET metadata = $1, updated_at = NOW()
          WHERE email = $2 AND deleted_at IS NULL
        `, [
          JSON.stringify({
            odoo_id: customer.id,
            odoo_name: customer.name,
            is_company: customer.is_company,
            synced_at: new Date().toISOString()
          }),
          email
        ])
        skipped++
        continue
      }

      // Insert new customer
      await pool.query(`
        INSERT INTO customer (id, email, first_name, last_name, phone, has_account, metadata, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, false, $6, NOW(), NOW())
      `, [
        customerId,
        email,
        firstName,
        lastName,
        customer.phone || customer.mobile || null,
        JSON.stringify({
          odoo_id: customer.id,
          odoo_name: customer.name,
          is_company: customer.is_company,
          synced_at: new Date().toISOString()
        })
      ])

      // Create address if available
      if (customer.street || customer.city) {
        const addressId = `addr_odoo_${customer.id}_${Date.now()}`
        await pool.query(`
          INSERT INTO customer_address (id, customer_id, first_name, last_name, address_1, address_2, city, postal_code, phone, metadata, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
        `, [
          addressId,
          customerId,
          firstName,
          lastName,
          customer.street || "",
          customer.street2 || "",
          customer.city || "",
          customer.zip || "",
          customer.phone || customer.mobile || "",
          JSON.stringify({ odoo_id: customer.id })
        ])
      }

      imported++
      console.log(`  ✅ ${imported}. ${customer.name} (${email})`)
      
    } catch (error: any) {
      if (error.message?.includes("duplicate")) {
        skipped++
      } else {
        errors++
        console.log(`  ❌ Error: ${customer.name} - ${error.message}`)
      }
    }
  }

  await pool.end()

  // Summary
  console.log("\n" + "=".repeat(50))
  console.log("📊 CUSTOMER SYNC SUMMARY")
  console.log("=".repeat(50))
  console.log(`✅ Imported: ${imported}`)
  console.log(`⏭️  Skipped: ${skipped}`)
  console.log(`❌ Errors: ${errors}`)
  console.log("\n✅ Customer sync completed!")
}
