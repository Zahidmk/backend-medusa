const axios = require('axios');

require('dotenv').config();

async function testOdoo() {
  const url = (process.env.ODOO_URL || "").replace(/\/$/, "");
  const db = process.env.ODOO_DB_NAME || "";
  const username = process.env.ODOO_USERNAME || "";
  const password = process.env.ODOO_PASSWORD || process.env.ODOO_API_KEY || "";

  try {
    const authResult = await axios.post(`${url}/jsonrpc`, {
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "common",
        method: "authenticate",
        args: [db, username, password, {}],
      },
      id: 1,
    });
    
    const uid = authResult.data.result;
    if (!uid) {
      console.log("Auth failed", authResult.data);
      return;
    }
    console.log("Auth success, UID:", uid);

    const productResult = await axios.post(`${url}/jsonrpc`, {
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [
          db, uid, password,
          "product.template", "search_read",
          [[["name", "ilike", "Samsung"]]],
          { limit: 1 }
        ],
      },
      id: 2,
    });

    if (productResult.data.error) {
      console.log("Error fetching:", productResult.data.error);
      return;
    }

    const product = productResult.data.result[0];
    const keys = Object.keys(product);
    
    console.log("Medusa/Overview keys found:");
    const relevantKeys = keys.filter(k => k.includes('medusa') || k.includes('overview') || k.includes('x_studio_'));
    console.log(relevantKeys);
    
    // Also check if medusa_description or x_studio_medusa_description exists and their values
    relevantKeys.forEach(k => {
      console.log(`- ${k}: ${String(product[k]).substring(0, 50)}`);
    });

  } catch (err) {
    console.error("Error:", err.message);
  }
}

testOdoo();
