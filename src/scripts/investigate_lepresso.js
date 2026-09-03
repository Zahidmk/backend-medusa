const axios = require('axios');
const knex = require('knex')({
  client: 'pg',
  connection: process.env.DATABASE_URL || 'postgres://postgres:marqa123@127.0.0.1:5433/marqa_souq_dev'
});

async function investigate() {
  console.log("================ INVESTIGATING LEPRESSO ================");

  // 1. Search in Medusa Postgres DB
  try {
    const medusaRes = await knex.raw(`
      SELECT p.id, p.title, p.handle, p.status, p.deleted_at, p.metadata->>'odoo_id' as odoo_id, p.metadata->>'odoo_sku' as odoo_sku
      FROM product p
      WHERE p.title ILIKE '%lepresso%' OR p.title ILIKE '%espresso%'
    `);

    console.log(`\n1. Found ${medusaRes.rows.length} product(s) in Medusa DB matching 'LePresso/Espresso':`);
    for (const r of medusaRes.rows) {
      console.log(`- ID: ${r.id} | Title: "${r.title}" | Handle: "${r.handle}" | Status: ${r.status} | Deleted: ${r.deleted_at} | Odoo ID: ${r.odoo_id}`);
      
      // Check sales channel link
      const scRes = await knex.raw(`SELECT sales_channel_id FROM product_sales_channel WHERE product_id = ?`, [r.id]);
      console.log(`  Sales Channels:`, scRes.rows.map(s => s.sales_channel_id).join(', ') || 'NONE');

      // Check variant count & stock
      const varRes = await knex.raw(`SELECT id, sku, barcode FROM product_variant WHERE product_id = ? AND deleted_at IS NULL`, [r.id]);
      console.log(`  Variants (${varRes.rows.length}):`, varRes.rows.map(v => `${v.id} (${v.sku})`).join(', '));
    }
  } catch (err) {
    console.error("Error querying Medusa DB:", err.message);
  }

  // 2. Search Odoo via JSON-RPC
  try {
    const ODOO_URL = process.env.ODOO_URL || "https://oskarllc-new-36501645.dev.odoo.com";
    const ODOO_DB = process.env.ODOO_DB || "oskarllc-new-36501645";
    const ODOO_USER = process.env.ODOO_USER || "zahid.mk@oskar.com";
    const ODOO_PASSWORD = process.env.ODOO_PASSWORD || "123456";

    // Authenticate
    const authRes = await axios.post(`${ODOO_URL}/jsonrpc`, {
      jsonrpc: "2.0", method: "call",
      params: { service: "common", method: "login", args: [ODOO_DB, ODOO_USER, ODOO_PASSWORD] }
    });

    const uid = authRes.data.result;
    console.log(`\n2. Odoo Authenticated (UID: ${uid})`);

    // Search product.template
    const odooRes = await axios.post(`${ODOO_URL}/jsonrpc`, {
      jsonrpc: "2.0", method: "call",
      params: {
        service: "object", method: "execute_kw",
        args: [
          ODOO_DB, uid, ODOO_PASSWORD,
          "product.template", "search_read",
          [[["name", "ilike", "LePresso"]]],
          { fields: ["id", "name", "default_code", "is_published", "active", "sale_ok", "list_price", "qty_available"] }
        ]
      }
    });

    const odooProds = odooRes.data.result || [];
    console.log(`Found ${odooProds.length} product(s) in Odoo matching 'LePresso':`);
    for (const op of odooProds) {
      console.log(`- Odoo ID: ${op.id} | Name: "${op.name}" | SKU: ${op.default_code} | Published: ${op.is_published} | Active: ${op.active} | SaleOK: ${op.sale_ok} | Price: ${op.list_price} | Stock: ${op.qty_available}`);
    }

  } catch (err) {
    console.error("Error querying Odoo:", err.message);
  }

  knex.destroy();
}

investigate();
