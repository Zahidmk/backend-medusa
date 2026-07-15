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

  const searchPayload = {
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
        [[["name", "ilike", "PAWA Solid Car Charger Dual Port 48W"]]],
        {
          fields: [
            "id",
            "name",
            "default_code",
            "list_price",
            "retail_price"
          ],
          limit: 5,
        },
      ],
    },
    id: Math.floor(Math.random() * 1000000),
  };

  console.log("Fetching product...");
  const searchRes = await client.post("/jsonrpc", searchPayload);
  const products = searchRes.data?.result;

  if (products && products.length > 0) {
    products.forEach((p) => {
      console.log(`\nProduct found: ${p.name}`);
      console.log(`ID: ${p.id}`);
      console.log(`SKU: ${p.default_code}`);
      console.log(`list_price (Sales Price): ${p.list_price}`);
      console.log(`retail_price: ${p.retail_price}`);
    });
  } else {
    console.log("Product not found.", searchRes.data);
  }
}

checkProduct().catch(console.error);
