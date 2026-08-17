#!/usr/bin/env node
/**
 * Debug: Check all available image fields on Odoo categories
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
    args: [ODOO_DB, uid, ODOO_PASS, 'product.public.category', 'fields_get', [], { attributes: ['string', 'type'] }],
  });

  console.log('\n=== All fields on product.public.category ===');
  const imageFields = [];
  for (const [name, info] of Object.entries(fields)) {
    if (info.type === 'binary' || name.includes('image') || name.includes('logo') || name.includes('icon')) {
      imageFields.push(name);
      console.log(`  ${name} (${info.type}): ${info.string}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
