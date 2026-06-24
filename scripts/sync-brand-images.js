#!/usr/bin/env node
/**
 * Sync Brand Images from Odoo
 * 
 * Fetches brand logos from Odoo's custom.product.brand model
 * and saves them to the frontend public/brands/ directory,
 * then updates the brand DB records with the correct logo_url.
 * 
 * IMPORTANT: Uses `context: { bin_size: false }` to force Odoo to return
 * actual base64 image data instead of just `true` (size marker).
 * 
 * Run: node scripts/sync-brand-images.js
 */

const axios = require('axios');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// ── Config ──
const ODOO_URL = process.env.ODOO_URL || 'https://oskarllc-new-31031096.dev.odoo.com';
const ODOO_DB = process.env.ODOO_DB_NAME || 'oskarllc-new-31031096';
const ODOO_USER = process.env.ODOO_USERNAME || 'SYG';
const ODOO_PASS = process.env.ODOO_API_KEY || '2a420f7cb6d0c1c8f73368131f025f638c30704e';

const IS_PROD = fs.existsSync('/var/www/marqa-souq/frontend/markasouq-web/public/brands');
const OUT_DIR = IS_PROD
  ? '/var/www/marqa-souq/frontend/markasouq-web/public/brands'
  : path.join(__dirname, '..', 'frontend', 'markasouq-web', 'public', 'brands');

// PostgreSQL — read from .env
const dotenvPath = IS_PROD
  ? '/var/www/marqa-souq/backend/backend-medusa/.env'
  : path.join(__dirname, '..', '.env');

let DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL && fs.existsSync(dotenvPath)) {
  const envContent = fs.readFileSync(dotenvPath, 'utf8');
  const match = envContent.match(/DATABASE_URL\s*=\s*"?([^\s"]+)"?/);
  if (match) DATABASE_URL = match[1];
}

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not found');
  process.exit(1);
}

// ── Odoo JSON-RPC helpers ──
const odooClient = axios.create({
  baseURL: ODOO_URL,
  headers: { 'Content-Type': 'application/json' },
  httpsAgent: new https.Agent({ rejectUnauthorized: false }),
  timeout: 120000,
});

let requestId = 0;
let uid = null;

async function jsonRpc(url, method, params) {
  const res = await odooClient.post(url, {
    jsonrpc: '2.0',
    method,
    params,
    id: ++requestId,
  });
  if (res.data.error) {
    throw new Error(`Odoo Error: ${res.data.error.message || res.data.error.data?.message}`);
  }
  return res.data.result;
}

async function authenticate() {
  uid = await jsonRpc('/jsonrpc', 'call', {
    service: 'common',
    method: 'authenticate',
    args: [ODOO_DB, ODOO_USER, ODOO_PASS, {}],
  });
  if (!uid || typeof uid !== 'number') {
    throw new Error('Odoo authentication failed');
  }
  console.log('✅ Odoo authenticated, UID:', uid);
}

/**
 * Read specific brand records by ID with bin_size=false
 * This forces Odoo to return the actual base64 image data
 * instead of just `true` (which means "has image but data not included").
 */
async function readBrandsWithImages(model, ids) {
  return jsonRpc('/jsonrpc', 'call', {
    service: 'object',
    method: 'execute_kw',
    args: [
      ODOO_DB, uid, ODOO_PASS,
      model, 'read',
      [ids],
      { fields: ['id', 'name', 'image_1920'], context: { bin_size: false } }
    ],
  });
}

async function searchRead(model, domain, fields, limit = 500) {
  return jsonRpc('/jsonrpc', 'call', {
    service: 'object',
    method: 'execute_kw',
    args: [ODOO_DB, uid, ODOO_PASS, model, 'search_read', [domain], { fields, limit }],
  });
}

// ── Main ──
async function main() {
  console.log('🔄 Syncing brand images from Odoo...');
  console.log(`   Output dir: ${OUT_DIR}`);

  // Ensure output directory
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  // 1. Authenticate with Odoo
  await authenticate();

  // 2. First get brand IDs (without heavy image data)
  let brandModel = 'custom.product.brand';
  let brandList = [];
  try {
    brandList = await searchRead(brandModel, [], ['id', 'name'], 500);
    console.log(`📦 Found ${brandList.length} brands in Odoo (${brandModel})`);
  } catch (e) {
    brandModel = 'product.brand';
    try {
      brandList = await searchRead(brandModel, [], ['id', 'name'], 500);
      console.log(`📦 Found ${brandList.length} brands in Odoo (${brandModel})`);
    } catch (e2) {
      console.error('❌ Neither custom.product.brand nor product.brand model found');
      return;
    }
  }

  if (!brandList.length) {
    console.log('No brands found in Odoo.');
    return;
  }

  // 3. Connect to PostgreSQL
  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();
  console.log('✅ Connected to PostgreSQL');

  // 4. Get brand IDs that need images (those without logo_url in DB or file missing)
  const brandsNeedingImages = [];
  const brandMap = new Map(); // name -> { id in medusa, current_logo }

  for (const odooBrand of brandList) {
    const name = (odooBrand.name || '').trim();
    if (!name) continue;

    const existing = await pg.query(
      'SELECT id, logo_url FROM brand WHERE LOWER(name) = $1',
      [name.toLowerCase()]
    );

    if (existing.rows.length === 0) continue;

    const brandId = existing.rows[0].id;
    const currentLogo = existing.rows[0].logo_url;

    // Check if we already have a working logo file
    let hasWorkingLogo = false;
    if (currentLogo) {
      const logoPath = currentLogo.startsWith('/brands/')
        ? path.join(OUT_DIR, currentLogo.replace('/brands/', ''))
        : null;
      hasWorkingLogo = logoPath && fs.existsSync(logoPath);
    }

    if (!hasWorkingLogo) {
      brandsNeedingImages.push(odooBrand.id);
      brandMap.set(odooBrand.id, { name, medusaId: brandId, currentLogo });
    }
  }

  console.log(`\n🔍 ${brandsNeedingImages.length} brands need images. Fetching with bin_size=false...`);

  if (brandsNeedingImages.length === 0) {
    console.log('All brands already have images!');
    await pg.end();
    return;
  }

  // 5. Fetch brands with actual image data (bin_size=false)
  //    Process in batches of 10 to avoid timeout
  let synced = 0;
  let noImage = 0;
  const BATCH_SIZE = 10;

  for (let i = 0; i < brandsNeedingImages.length; i += BATCH_SIZE) {
    const batchIds = brandsNeedingImages.slice(i, i + BATCH_SIZE);
    let brandsWithImages;
    try {
      brandsWithImages = await readBrandsWithImages(brandModel, batchIds);
    } catch (e) {
      console.error(`   ❌ Failed to fetch batch ${i}:`, e.message);
      continue;
    }

    for (const brand of brandsWithImages) {
      const info = brandMap.get(brand.id);
      if (!info) continue;

      const img = brand.image_1920;

      if (!img || img === false || (typeof img === 'string' && img.length < 200)) {
        console.log(`   ⚠  "${info.name}" has no image in Odoo`);
        noImage++;
        continue;
      }

      try {
        const buf = Buffer.from(img, 'base64');
        
        // Check if it's an SVG (starts with <svg or <?xml)
        const isSvg = buf.slice(0, 100).toString('utf8').trim().startsWith('<svg') || 
                      buf.slice(0, 100).toString('utf8').trim().startsWith('<?xml');
        
        const ext = isSvg ? '.svg' : '.png';
        const fname = `${slug}-brand${ext}`;
        const fpath = path.join(OUT_DIR, fname);

        fs.writeFileSync(fpath, buf);
        const logoUrl = `/brands/${fname}`;

        await pg.query('UPDATE brand SET logo_url = $1, updated_at = NOW() WHERE id = $2', [
          logoUrl,
          info.medusaId,
        ]);

        console.log(`   ✅ "${info.name}" → ${logoUrl} (${(buf.length / 1024).toFixed(1)}KB)`);
        synced++;
      } catch (e) {
        console.error(`   ❌ Failed to save image for "${info.name}":`, e.message);
      }
    }
  }

  await pg.end();
  console.log(`\n🎉 Done! Synced: ${synced}, No image in Odoo: ${noImage}`);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
