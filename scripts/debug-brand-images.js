#!/usr/bin/env node
/**
 * Debug: Check all available image fields on Odoo brands
 */
const axios = require('axios');
const https = require('https');

require('dotenv').config();

const ODOO_URL = (process.env.ODOO_URL || '').replace(/\/$/, '');
const ODOO_DB = process.env.ODOO_DB_NAME || '';
const ODOO_USER = process.env.ODOO_USERNAME || '';
const ODOO_PASS = process.env.ODOO_API_KEY || process.env.ODOO_PASSWORD || '';

const client = axios.create({
  baseURL: ODOO_URL,
  headers: { 'Content-Type': 'application/json' },
  httpsAgent: new https.Agent({ rejectUnauthorized: false }),
  timeout: 60000,
});

let requestId = 0;

async function jsonRpc(url, method, params) {
  const res = await client.post(url, { jsonrpc: '2.0', method, params, id: ++requestId });
  if (res.data.error) throw new Error(`Odoo Error: ${JSON.stringify(res.data.error)}`);
  return res.data.result;
}

async function main() {
  // Auth
  const uid = await jsonRpc('/jsonrpc', 'call', {
    service: 'common', method: 'authenticate',
    args: [ODOO_DB, ODOO_USER, ODOO_PASS, {}],
  });
  console.log('UID:', uid);

  // 1. First get the model fields to see what image fields exist
  const fields = await jsonRpc('/jsonrpc', 'call', {
    service: 'object', method: 'execute_kw',
    args: [ODOO_DB, uid, ODOO_PASS, 'custom.product.brand', 'fields_get', [], { attributes: ['string', 'type'] }],
  });

  console.log('\n=== All fields on custom.product.brand ===');
  const imageFields = [];
  for (const [name, info] of Object.entries(fields)) {
    if (info.type === 'binary' || name.includes('image') || name.includes('logo')) {
      imageFields.push(name);
      console.log(`  ${name} (${info.type}): ${info.string}`);
    }
  }

  // 2. Fetch a few brands with ALL image fields to see which ones have data
  const fieldsToFetch = ['id', 'name', ...imageFields];
  const brands = await jsonRpc('/jsonrpc', 'call', {
    service: 'object', method: 'execute_kw',
    args: [ODOO_DB, uid, ODOO_PASS, 'custom.product.brand', 'search_read', [[]], { fields: fieldsToFetch, limit: 100 }],
  });

  console.log(`\n=== ${brands.length} brands, image field check ===`);
  const missing = [];
  for (const b of brands) {
    const hasImages = {};
    for (const f of imageFields) {
      const val = b[f];
      hasImages[f] = val && val !== false && val !== true && (typeof val === 'string' ? val.length > 100 : false);
    }
    const anyImage = Object.values(hasImages).some(v => v);
    if (!anyImage) {
      missing.push(b.name);
    }
    console.log(`  ${b.name}: ${JSON.stringify(hasImages)}`);
  }

  console.log(`\n=== ${missing.length} brands with NO image in any field ===`);
  missing.forEach(n => console.log(`  - ${n}`));
}

main().catch(e => { console.error(e); process.exit(1); });
