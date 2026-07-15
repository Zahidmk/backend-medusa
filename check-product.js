const axios = require('axios');
require('dotenv').config();

const ODOO_URL = process.env.ODOO_URL || "https://oskarllc-new-31031096.dev.odoo.com";
const ODOO_DB = process.env.ODOO_DB_NAME || "oskarllc-new-31031096";
const ODOO_USER = process.env.ODOO_USERNAME || "SYG";
const ODOO_PASS = process.env.ODOO_API_KEY || "2a420f7cb6d0c1c8f73368131f025f638c30704e";

async function checkProduct() {
  const client = axios.create({
    baseURL: ODOO_URL,
    headers: { "Content-Type": "application/json" },
  });

  console.log("Authenticating with Odoo...");
  const authPayload = {
    jsonrpc: "2.0",
    method: "call",
    params: {
      service: "common",
      method: "authenticate",
      args: [ODOO_DB, ODOO_USER, ODOO_PASS, {}],
    },
    id: Math.floor(Math.random() * 1000000),
  };

  const authRes = await client.post("/jsonrpc", authPayload);
  const uid = authRes.data?.result;

  if (!uid) {
    console.error("Failed to authenticate:", authRes.data);
    return;
  }
  console.log("Authenticated with UID:", uid);

  const searchTemplatePayload = {
    jsonrpc: "2.0",
    method: "call",
    params: {
      service: "object",
      method: "execute_kw",
      args: [
        ODOO_DB,
        uid,
        ODOO_PASS,
        "product.template",
        "search_read",
        [[["default_code", "=", "AMHCP14L2DCFR"]]],
        {
          fields: [
            "id",
            "name",
            "default_code",
            "list_price",
            "retail_price",
            "qty_available",
            "virtual_available",
            "free_qty"
          ],
          limit: 5,
        },
      ],
    },
    id: Math.floor(Math.random() * 1000000),
  };

  const searchProductPayload = {
    jsonrpc: "2.0",
    method: "call",
    params: {
      service: "object",
      method: "execute_kw",
      args: [
        ODOO_DB,
        uid,
        ODOO_PASS,
        "product.product",
        "search_read",
        [[["default_code", "=", "AMHCP14L2DCFR"]]],
        {
          fields: [
            "id",
            "name",
            "default_code",
            "list_price",
            "retail_price",
            "qty_available",
            "virtual_available",
            "free_qty"
          ],
          limit: 5,
        },
      ],
    },
    id: Math.floor(Math.random() * 1000000),
  };

  console.log("Fetching product.template...");
  const tplRes = await client.post("/jsonrpc", searchTemplatePayload);
  const templates = tplRes.data?.result;

  if (templates && templates.length > 0) {
    templates.forEach((p) => {
      console.log(`\n[TEMPLATE] found: ${p.name}`);
      console.log(`ID: ${p.id}, SKU: ${p.default_code}`);
      console.log(`qty_available: ${p.qty_available}, virtual_available: ${p.virtual_available}, free_qty: ${p.free_qty}`);
    });
  } else {
    console.log("[TEMPLATE] not found.", tplRes.data);
  }

  console.log("\nFetching product.product...");
  const prodRes = await client.post("/jsonrpc", searchProductPayload);
  const products = prodRes.data?.result;

  if (products && products.length > 0) {
    products.forEach((p) => {
      console.log(`\n[PRODUCT] found: ${p.name}`);
      console.log(`ID: ${p.id}, SKU: ${p.default_code}`);
      console.log(`qty_available: ${p.qty_available}, virtual_available: ${p.virtual_available}, free_qty: ${p.free_qty}`);
    });
  } else {
    console.log("[PRODUCT] not found.", prodRes.data);
  }
}

checkProduct().catch(console.error);
