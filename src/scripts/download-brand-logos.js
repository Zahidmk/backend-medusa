/**
 * Download real brand logos from Odoo via JSON-RPC
 * and save them to the Next.js public/brands/ folder on the server,
 * then update the brand table with the local path.
 *
 * Usage (run on server):
 *   node /var/www/marqa-souq/backend/backend-medusa/src/scripts/download-brand-logos.js
 */

const https = require('https');
const http = require('http');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ── Read environment from .env ──
const IS_PROD = fs.existsSync('/var/www/marqa-souq/frontend/markasouq-web/public/brands');
const dotenvPath = IS_PROD
  ? '/var/www/marqa-souq/backend/backend-medusa/.env'
  : path.join(__dirname, '..', '..', '.env');

if (fs.existsSync(dotenvPath)) {
  const envContent = fs.readFileSync(dotenvPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*"?([^"\r\n]+)"?/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2];
    }
  });
}

const rawOdooUrl = process.env.ODOO_URL || 'https://oskarllc-new-35045199.dev.odoo.com';
const ODOO_DB   = process.env.ODOO_DB_NAME || 'oskarllc-new-35045199';
const ODOO_USER = process.env.ODOO_USERNAME || 'SYG';
const ODOO_KEY  = process.env.ODOO_API_KEY || '2a420f7cb6d0c1c8f73368131f025f638c30704e';

const OUT_DIR = IS_PROD
  ? '/var/www/marqa-souq/frontend/markasouq-web/public/brands'
  : path.join(__dirname, '..', '..', '..', 'markasouq-web', 'public', 'brands');

const parsedUrl = new URL(rawOdooUrl);
const ODOO_HOST = parsedUrl.hostname;
const ODOO_PROTO = parsedUrl.protocol;

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
    const reqLib = ODOO_PROTO === 'https:' ? https : http;
    const req = reqLib.request(options, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => {
        try {
          const r = JSON.parse(data);
          if (r.error) reject(new Error(JSON.stringify(r.error)));
          else resolve(r.result);
        } catch (e) {
          reject(new Error(`Odoo response error (${res.statusCode}): ${data.substring(0, 150)}`));
        }
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
  console.log(`Connecting to Odoo at ${ODOO_PROTO}//${ODOO_HOST} (DB: ${ODOO_DB})...`);

  // Ensure output directory exists
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  // 1. Authenticate
  const uid = await jsonrpc({
    service: 'common', method: 'authenticate',
    args: [ODOO_DB, ODOO_USER, ODOO_KEY, {}],
  });
  if (!uid) { console.error('Odoo auth failed'); process.exit(1); }
  console.log('✅ Odoo UID:', uid);

  // 2. Fetch brands using custom.product.brand with bin_size = false context
  let modelName = 'custom.product.brand';
  let brands = [];
  try {
    brands = await jsonrpc({
      service: 'object', method: 'execute_kw',
      args: [
        ODOO_DB, uid, ODOO_KEY,
        modelName, 'search_read',
        [[]],
        {
          fields: ['id', 'name', 'image_1920'],
          context: { bin_size: false },
          limit: 500,
        }
      ],
    });
    console.log(`Got ${brands.length} brands from ${modelName} (with bin_size=false)`);
  } catch (e) {
    console.error('Error fetching custom.product.brand:', e.message);
    modelName = 'product.brand';
    try {
      brands = await jsonrpc({
        service: 'object', method: 'execute_kw',
        args: [
          ODOO_DB, uid, ODOO_KEY,
          modelName, 'search_read',
          [[]],
          {
            fields: ['id', 'name', 'image_1920'],
            context: { bin_size: false },
            limit: 500,
          }
        ],
      });
      console.log(`Got ${brands.length} brands from ${modelName} (with bin_size=false)`);
    } catch (e2) {
      console.error('Failed to fetch brands:', e2.message);
      process.exit(1);
    }
  }

  let saved = 0;
  for (const b of brands) {
    const name = (b.name || '').trim();
    let img = b.image_1920;

    // If search_read returned true / boolean size marker, do explicit read with bin_size=false
    if (!img || img === true || (typeof img === 'string' && img.length < 200)) {
      try {
        const readResult = await jsonrpc({
          service: 'object', method: 'execute_kw',
          args: [
            ODOO_DB, uid, ODOO_KEY,
            modelName, 'read',
            [[b.id]],
            {
              fields: ['id', 'name', 'image_1920'],
              context: { bin_size: false }
            }
          ]
        });
        if (Array.isArray(readResult) && readResult[0]) {
          img = readResult[0].image_1920;
        }
      } catch (err) {
        // Ignore read fallback error
      }
    }

    if (!img || img === true || (typeof img === 'string' && img.length < 200)) {
      console.log(`  ⚠️  No logo in Odoo for "${name}" (type: ${typeof img})`);
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

  console.log(`\nDone! Saved ${saved} logos to ${OUT_DIR}`);
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
