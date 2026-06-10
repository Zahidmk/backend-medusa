/**
 * Download real brand logos from Odoo via JSON-RPC
 * and save them to the Next.js public/brands/ folder on the server,
 * then update the brand table with the local path.
 *
 * Usage (run on server):
 *   node /var/www/marqa-souq/backend/backend-medusa/src/scripts/download-brand-logos.js
 */

const https = require('https');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ODOO_HOST = 'oskarllc-new-31031096.dev.odoo.com';
const ODOO_DB   = 'oskarllc-new-31031096';
const ODOO_USER = 'SYG';
const ODOO_KEY  = '2a420f7cb6d0c1c8f73368131f025f638c30704e';
const OUT_DIR   = '/var/www/marqa-souq/frontend/markasouq-web/public/brands';

let reqId = 0;

function jsonrpc(params) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ jsonrpc: '2.0', method: 'call', id: ++reqId, params });
    const options = {
      hostname: ODOO_HOST,
      path: '/jsonrpc',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      rejectUnauthorized: false,
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => {
        const r = JSON.parse(data);
        if (r.error) reject(new Error(JSON.stringify(r.error)));
        else resolve(r.result);
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function main() {
  // 1. Authenticate
  const uid = await jsonrpc({
    service: 'common', method: 'authenticate',
    args: [ODOO_DB, ODOO_USER, ODOO_KEY, {}],
  });
  if (!uid) { console.error('Odoo auth failed'); process.exit(1); }
  console.log('✅ Odoo UID:', uid);

  // 2. Fetch brands with logo field
  const brands = await jsonrpc({
    service: 'object', method: 'execute_kw',
    args: [ODOO_DB, uid, ODOO_KEY, 'product.brand', 'search_read', [[]], {
      fields: ['id', 'name', 'logo'],
      limit: 200,
    }],
  });
  console.log('Fetched brands from Odoo:', brands.length);

  let saved = 0;
  for (const b of brands) {
    const name = (b.name || '').trim();
    const img  = b.logo;

    if (!img || img === true || img.length < 200) {
      console.log('  ⚠️  No logo:', name);
      continue;
    }

    const fname = slugify(name) + '-brand.png';
    const fpath = path.join(OUT_DIR, fname);
    fs.writeFileSync(fpath, Buffer.from(img, 'base64'));
    const sz = fs.statSync(fpath).size;
    console.log(`  ✅ Saved: ${name} -> ${fname} (${sz} bytes)`);

    // Update DB
    const safeName = name.replace(/'/g, "''");
    try {
      execSync(
        `sudo -u postgres psql -d medusa -c "UPDATE brand SET logo_url='/brands/${fname}', updated_at=NOW() WHERE LOWER(TRIM(name))=LOWER('${safeName}')"`,
        { stdio: 'pipe' }
      );
      console.log(`  📝 DB updated: ${name}`);
    } catch (e) {
      console.error(`  ❌ DB update failed for ${name}:`, e.message);
    }

    saved++;
  }

  console.log(`\nDone! Saved ${saved} logos.`);
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
