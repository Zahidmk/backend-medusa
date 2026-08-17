/**
 * Central Odoo Integration Configuration
 * Single source of truth loaded from environment variables.
 */

export const ODOO_CONFIG = {
  get url(): string {
    return (process.env.ODOO_URL || "").replace(/\/$/, "")
  },
  get dbName(): string {
    return process.env.ODOO_DB_NAME || ""
  },
  get db(): string {
    return process.env.ODOO_DB_NAME || ""
  },
  get username(): string {
    return process.env.ODOO_USERNAME || ""
  },
  get password(): string {
    return process.env.ODOO_PASSWORD || ""
  },
  get apiKey(): string {
    return process.env.ODOO_API_KEY || ""
  },
  get webhookSecret(): string {
    return process.env.ODOO_WEBHOOK_SECRET || ""
  },
}

export default ODOO_CONFIG
