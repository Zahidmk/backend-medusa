#!/usr/bin/env node
/**
 * bulk-sync-odoo-to-medusa.js
 * ===========================
 * FAST BULK SYNC: Pulls ALL products from Odoo (6000+) and inserts/updates
 * them directly into the production Medusa PostgreSQL database.
 *
 * Features:
 *  - Fetches ALL Odoo products in batches of 100 (pagination)
 *  - Skips products already in Medusa (checks by odoo_id in metadata)
 *  - Creates product + variant + price_set + price + sales_channel link
 *  - Auto-creates/links brands
 *  - Robust error handling — one failure won't stop the whole batch
 *  - Detailed progress reporting
 *
 * Usage (local):
 *   node bulk-sync-odoo-to-medusa.js
 *
 * Usage (on production server):
 *   DATABASE_URL="postgres://medusa_user:Medusa1234@127.0.0.1:5432/medusa" \
 *   node bulk-sync-odoo-to-medusa.js
 *
 * To resume from a specific offset (if it crashed):
 *   RESUME_OFFSET=1500 node bulk-sync-odoo-to-medusa.js
 */

'use strict';

const https = require('https');
const { Client } = require('pg');

// ─── ODOO CONFIG (production server credentials from .env) ──────────────────
const ODOO_CONFIG = {
  url:      process.env.ODOO_URL?.replace(/\/$/, '') || 'https://oskarllc-new-35045199.dev.odoo.com',
  db:       process.env.ODOO_DB_NAME || 'oskarllc-new-35045199',
  username: process.env.ODOO_USERNAME || 'SYG',
  // Support both ODOO_API_KEY and ODOO_PASSWORD env var names
  apiKey:   process.env.ODOO_API_KEY || process.env.ODOO_PASSWORD || '123',
};

// ─── DB CONFIG ────────────────────────────────────────────────────────────────
const DB_URL = process.env.DATABASE_URL ||
  'postgres://medusa_user:Medusa1234@127.0.0.1:5432/medusa';

// ─── SYNC CONFIG ──────────────────────────────────────────────────────────────
const BATCH_SIZE    = 100;   // Products per Odoo API call
const RESUME_OFFSET = parseInt(process.env.RESUME_OFFSET || '0', 10);
const MAX_ERRORS    = 200;   // Stop if too many errors in a row
const CURRENCY_CODE = 'kwd'; // Medusa currency code for all prices
// KWD has 3 decimal places → multiply price by 1000 for smallest unit
const CURRENCY_MULTIPLIER = 1000;

// ─── ODOO FIELDS TO FETCH ─────────────────────────────────────────────────────
const ODOO_FIELDS = [
  'id', 'name', 'default_code', 'barcode', 'active', 'sale_ok',
  'list_price', 'standard_price', 'currency_id',
  'description_sale', 'description_ecommerce', 'description',
  'brand_id', 'categ_id', 'x_studio_brand_1',
  'qty_available', 'is_storable', 'weight', 'allow_out_of_stock_order',
  'seo_name', 'website_meta_title', 'website_meta_description',
  'is_published', 'website_ribbon_id', 'is_favorite', 'website_sequence',
  'sales_count', 'rating_avg', 'rating_count',
  'create_date', 'write_date',
  'custom_brand_id',   // custom brand field some installs use
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────

let requestId = 0;

/** Generic JSON-RPC call over HTTPS */
function jsonRpc(path, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      method: 'call',
      params,
      id: ++requestId,
    });

    const url = new URL(ODOO_CONFIG.url);
    const options = {
      hostname: url.hostname,
      port: 443,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      rejectUnauthorized: false, // Allow self-signed certs
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            const msg = parsed.error.data?.message || parsed.error.message || 'Odoo error';
            reject(new Error(msg));
          } else {
            resolve(parsed.result);
          }
        } catch (e) {
          reject(new Error(`JSON parse failed: ${data.substring(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(90000, () => {
      req.destroy(new Error('Request timeout (90s)'));
    });
    req.write(body);
    req.end();
  });
}

let odooUid = null;

async function authenticate() {
  console.log('🔐 Authenticating with Odoo...');
  console.log(`   URL:      ${ODOO_CONFIG.url}`);
  console.log(`   DB:       ${ODOO_CONFIG.db}`);
  console.log(`   Username: ${ODOO_CONFIG.username}`);
  console.log(`   API Key:  ${ODOO_CONFIG.apiKey?.substring(0, 8)}...`);

  const result = await jsonRpc('/jsonrpc', {
    service: 'common',
    method: 'authenticate',
    args: [ODOO_CONFIG.db, ODOO_CONFIG.username, ODOO_CONFIG.apiKey, {}],
  });

  if (!result || typeof result !== 'number' || result <= 0) {
    console.error(`\n❌ Authentication returned: ${JSON.stringify(result)}`);
    console.error('   Possible causes:');
    console.error('   1. API key expired/revoked → Go to Odoo > Settings > Technical > API Keys');
    console.error('   2. Wrong ODOO_USERNAME — current value: ' + ODOO_CONFIG.username);
    console.error('   3. Wrong ODOO_DB_NAME  — current value: ' + ODOO_CONFIG.db);
    console.error('   4. Wrong ODOO_URL      — current value: ' + ODOO_CONFIG.url);
    throw new Error(`Odoo authentication failed: ${JSON.stringify(result)}`);
  }
  odooUid = result;
  console.log(`✅ Authenticated! UID: ${odooUid}`);
  return odooUid;
}

function executeKw(model, method, args, kwargs = {}) {
  return jsonRpc('/jsonrpc', {
    service: 'object',
    method: 'execute_kw',
    args: [ODOO_CONFIG.db, odooUid, ODOO_CONFIG.apiKey, model, method, args, kwargs],
  });
}

async function getTotalCount() {
  return executeKw('product.template', 'search_count', [
    [['active', '=', true], ['sale_ok', '=', true]],
  ]);
}

async function fetchBatch(offset, limit) {
  return executeKw(
    'product.template',
    'search_read',
    [[['active', '=', true], ['sale_ok', '=', true]]],
    {
      fields: ODOO_FIELDS,
      limit,
      offset,
      order: 'id asc',
    }
  );
}

/** Generate a Medusa-compatible ULID-style ID */
function genId(prefix) {
  const chars = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let id = prefix + '_';
  for (let i = 0; i < 26; i++) id += chars[Math.floor(Math.random() * 32)];
  return id;
}

/** Build a URL-safe handle from product name + odoo_id */
function buildHandle(product) {
  const base = (product.seo_name && typeof product.seo_name === 'string')
    ? product.seo_name
    : product.name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 80);
  // Append odoo ID to guarantee uniqueness across 6k products
  return `${base}-${product.id}`;
}

/** Strip HTML tags from a string */
function stripHtml(html) {
  if (!html || typeof html !== 'string') return null;
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || null;
}

/** Get description text from Odoo product */
function getDescription(product) {
  if (product.description_sale && typeof product.description_sale === 'string')
    return product.description_sale;
  if (product.description_ecommerce && typeof product.description_ecommerce === 'string')
    return stripHtml(product.description_ecommerce);
  if (product.description && typeof product.description === 'string')
    return product.description;
  return null;
}

// ─── MAIN SYNC ────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║        BULK ODOO → MEDUSA PRODUCT SYNC               ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');

  // 1. Authenticate with Odoo
  await authenticate();

  // 2. Get total count
  const totalOdoo = await getTotalCount();
  console.log(`📦 Total products in Odoo: ${totalOdoo}`);
  console.log(`📥 Batch size: ${BATCH_SIZE}`);
  console.log(`⏩ Starting offset: ${RESUME_OFFSET}`);
  console.log('');

  // 3. Connect to Medusa DB
  console.log('🗄️  Connecting to Medusa database...');
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  console.log(`✅ Connected to DB\n`);

  // 4. Load existing product odoo_ids to skip duplicates
  console.log('📋 Loading existing Medusa products (to skip duplicates)...');
  const { rows: existingRows } = await db.query(`
    SELECT metadata->>'odoo_id' AS odoo_id, id
    FROM product
    WHERE deleted_at IS NULL
      AND metadata->>'odoo_id' IS NOT NULL
  `);
  const existingOdooIds = new Map(); // odoo_id(string) → medusa product id
  for (const row of existingRows) {
    if (row.odoo_id) existingOdooIds.set(String(row.odoo_id), row.id);
  }
  console.log(`   Already in Medusa: ${existingOdooIds.size} products with odoo_id\n`);

  // 5. Load existing handles to avoid conflicts
  const { rows: handleRows } = await db.query(
    `SELECT handle FROM product WHERE deleted_at IS NULL`
  );
  const existingHandles = new Set(handleRows.map((r) => r.handle));

  // 6. Get the default sales channel ID
  const { rows: scRows } = await db.query(
    `SELECT id FROM sales_channel WHERE deleted_at IS NULL LIMIT 1`
  );
  const salesChannelId = scRows[0]?.id || null;
  console.log(`🛒 Sales Channel ID: ${salesChannelId || '⚠️  NONE FOUND'}\n`);

  // 6b. Get the default stock location ID (needed for inventory levels)
  const { rows: locRows } = await db.query(
    `SELECT id FROM stock_location WHERE deleted_at IS NULL LIMIT 1`
  );
  const stockLocationId = locRows[0]?.id || null;
  console.log(`📦 Stock Location ID: ${stockLocationId || '⚠️  NONE FOUND'}\n`);

  // 7. Load/cache brand map { brandName(lower) → brandId }
  const { rows: brandRows } = await db.query(
    `SELECT id, name, slug FROM brand WHERE deleted_at IS NULL`
  );
  const brandSlugMap = new Map(); // slug → id
  const brandNameMap = new Map(); // name(lower) → id
  for (const b of brandRows) {
    brandSlugMap.set(b.slug, b.id);
    brandNameMap.set(b.name.toLowerCase(), b.id);
  }

  // ── Ensure system_config table exists for tracking ──
  await db.query(`
    CREATE TABLE IF NOT EXISTS system_config (
      key VARCHAR(255) PRIMARY KEY,
      value TEXT,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `).catch(() => {});

  // ─── SYNC LOOP ─────────────────────────────────────────────────────────────
  let offset         = RESUME_OFFSET;
  let totalCreated   = 0;
  let totalUpdated   = 0;
  let totalSkipped   = 0;
  let totalErrors    = 0;
  let consecutiveErrors = 0;
  const startTime    = Date.now();

  console.log('🚀 Starting sync...\n');

  while (offset < totalOdoo) {
    if (consecutiveErrors >= MAX_ERRORS) {
      console.error(`\n❌ Too many consecutive errors (${MAX_ERRORS}). Stopping.`);
      break;
    }

    // Fetch batch from Odoo
    let products;
    try {
      products = await fetchBatch(offset, BATCH_SIZE);
    } catch (err) {
      console.error(`❌ Failed to fetch batch at offset ${offset}: ${err.message}`);
      consecutiveErrors++;
      // Wait 5s and retry
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }

    if (!products || products.length === 0) {
      console.log(`\n✅ No more products at offset ${offset}. Done!`);
      break;
    }

    consecutiveErrors = 0;

    const batchNum = Math.floor(offset / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(totalOdoo / BATCH_SIZE);
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const pct = Math.round((offset / totalOdoo) * 100);

    process.stdout.write(
      `\r📦 Batch ${batchNum}/${totalBatches} | Offset: ${offset} | ` +
      `✅${totalCreated} 🔄${totalUpdated} ⏭️${totalSkipped} ❌${totalErrors} | ${elapsed}s | ${pct}%  `
    );

    for (const product of products) {
      try {
        const odooIdStr = String(product.id);

        // ── Brand name ──
        const brandName = product.brand_id?.[1] ||
          product.custom_brand_id?.[1] ||
          product.x_studio_brand_1 ||
          null;

        // ── Check if already exists ──
        if (existingOdooIds.has(odooIdStr)) {
          // Update metadata + thumbnail if missing (fast)
          const existingMedusaId = existingOdooIds.get(odooIdStr);
          const thumbUrl = `${ODOO_CONFIG.url}/web/image/product.template/${product.id}/image_1920`;
          await db.query(`
            UPDATE product
            SET metadata = metadata ||
              jsonb_build_object(
                'odoo_write_date', $2::text,
                'odoo_stock', $3::int,
                'synced_at', now()::text
              ),
              thumbnail = COALESCE(NULLIF(thumbnail, ''), $4),
              updated_at = NOW()
            WHERE id = $1
          `, [
            existingMedusaId,
            product.write_date || null,
            Math.floor(product.qty_available || 0),
            thumbUrl,
          ]);

          // ── Auto-create / link brand on UPDATE ──
          if (brandName && typeof brandName === 'string' && brandName.trim()) {
            try {
              const brandSlug = brandName
                .toLowerCase()
                .replace(/[^a-z0-9\s-]/g, '')
                .replace(/\s+/g, '-')
                .substring(0, 100);

              let brandId = brandSlugMap.get(brandSlug) || brandNameMap.get(brandName.toLowerCase());

              if (!brandId) {
                brandId = genId('brand');
                const brandOdooId = product.brand_id?.[0] || product.custom_brand_id?.[0] || null;
                const brandImageUrl = brandOdooId
                  ? `${ODOO_CONFIG.url}/web/image/custom.product.brand/${brandOdooId}/image_1920`
                  : null;

                await db.query(`
                  INSERT INTO brand (id, name, slug, is_active, is_special, logo_url, created_at, updated_at)
                  VALUES ($1, $2, $3, true, false, $4, NOW(), NOW())
                  ON CONFLICT DO NOTHING
                `, [brandId, brandName.substring(0, 200), brandSlug, brandImageUrl]);

                // Re-read actual ID
                const { rows: br } = await db.query(
                  `SELECT id FROM brand WHERE slug = $1 AND deleted_at IS NULL LIMIT 1`,
                  [brandSlug]
                );
                brandId = br[0]?.id || brandId;
                brandSlugMap.set(brandSlug, brandId);
                brandNameMap.set(brandName.toLowerCase(), brandId);
              }

              await db.query(`
                INSERT INTO product_brand (id, product_id, brand_id, created_at, updated_at)
                VALUES ($1, $2, $3, NOW(), NOW())
                ON CONFLICT DO NOTHING
              `, [genId('pbr'), existingMedusaId, brandId]);
            } catch (brandErr) {
              // Non-fatal: brand link failure shouldn't rollback the product
            }
          }

          // ── Inventory stock level update on UPDATE ──
          try {
            const stockQty = Math.max(0, Math.round(product.qty_available || 0));
            const sku = product.default_code || `ODOO-${product.id}`;

            // Get the variant for this product
            const { rows: varRows } = await db.query(
              `SELECT pv.id as vid FROM product_variant pv WHERE pv.product_id = $1 AND pv.deleted_at IS NULL LIMIT 1`,
              [existingMedusaId]
            );

            if (varRows.length > 0) {
              const vid = varRows[0].vid;

              // Get or create inventory_item
              let { rows: invRows } = await db.query(
                `SELECT id FROM inventory_item WHERE sku = $1 LIMIT 1`,
                [sku]
              );

              let invItemId;
              if (invRows.length === 0) {
                invItemId = genId('iitem');
                await db.query(
                  `INSERT INTO inventory_item (id, sku, title, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
                  [invItemId, sku, product.name.substring(0, 500)]
                );
                const { rows: reRead } = await db.query(`SELECT id FROM inventory_item WHERE sku = $1 LIMIT 1`, [sku]);
                invItemId = reRead[0]?.id || invItemId;
              } else {
                invItemId = invRows[0].id;
              }

              // Ensure variant is linked to inventory item
              await db.query(
                `INSERT INTO product_variant_inventory_item (id, variant_id, inventory_item_id, required_quantity, created_at, updated_at)
                 VALUES ($1, $2, $3, 1, NOW(), NOW()) ON CONFLICT DO NOTHING`,
                [genId('pvitem'), vid, invItemId]
              );

              // Update or create inventory level
              if (stockLocationId) {
                const { rows: lvlRows } = await db.query(
                  `SELECT id FROM inventory_level WHERE inventory_item_id = $1 AND location_id = $2 LIMIT 1`,
                  [invItemId, stockLocationId]
                );
                if (lvlRows.length > 0) {
                  await db.query(
                    `UPDATE inventory_level SET stocked_quantity = $1, updated_at = NOW() WHERE id = $2`,
                    [stockQty, lvlRows[0].id]
                  );
                } else if (stockQty > 0) {
                  await db.query(
                    `INSERT INTO inventory_level (id, inventory_item_id, location_id, stocked_quantity, reserved_quantity, incoming_quantity, created_at, updated_at)
                     VALUES ($1, $2, $3, $4, 0, 0, NOW(), NOW()) ON CONFLICT DO NOTHING`,
                    [genId('iloc'), invItemId, stockLocationId, stockQty]
                  );
                }
              }
            }
          } catch (invErr) {
            // Non-fatal
          }

          totalUpdated++;
          continue;

        }

        // ── Build handle (unique) ──
        let handle = buildHandle(product);
        if (existingHandles.has(handle)) {
          handle = `${handle}-${Math.random().toString(36).substring(2, 6)}`;
        }
        existingHandles.add(handle);

        // ── Determine status ──
        const status = (product.active && product.sale_ok) ? 'published' : 'draft';

        // ── Description ──
        const description = getDescription(product);

        // Brand name is now derived at the top of the loop

        // ── Price (KWD fils) ──
        const priceKwd = Math.round((product.list_price || 0) * CURRENCY_MULTIPLIER);

        // ── Thumbnail URL (direct Odoo image endpoint — no download needed) ──
        const thumbnailUrl = `${ODOO_CONFIG.url}/web/image/product.template/${product.id}/image_1920`;

        // ── Full metadata ──
        const metadata = JSON.stringify({
          odoo_id:           product.id,
          odoo_sku:          product.default_code || null,
          odoo_barcode:      product.barcode || null,
          odoo_category_id:  product.categ_id ? product.categ_id[0] : null,
          odoo_category_name:product.categ_id ? product.categ_id[1] : null,
          brand:             brandName,
          brand_id:          product.brand_id ? product.brand_id[0] : null,
          cost_price:        product.standard_price || 0,
          currency:          product.currency_id ? product.currency_id[1] : 'KWD',
          odoo_stock:        Math.floor(product.qty_available || 0),
          is_storable:       product.is_storable || false,
          seo_title:         product.website_meta_title || null,
          seo_description:   product.website_meta_description || null,
          is_featured:       product.is_favorite || false,
          display_order:     product.website_sequence || 0,
          total_sold:        product.sales_count || 0,
          rating:            product.rating_avg || 0,
          reviews_count:     product.rating_count || 0,
          is_published_odoo: product.is_published || false,
          odoo_write_date:   product.write_date || null,
          synced_at:         new Date().toISOString(),
        });

        // ── SKU ──
        const sku = product.default_code
          ? String(product.default_code).substring(0, 100)
          : `ODOO-${product.id}`;

        // ── Insert product ──
        await db.query('BEGIN');
        try {
          const productId = genId('prod');

          await db.query(`
            INSERT INTO product (
              id, title, handle, subtitle, description, thumbnail, status,
              is_giftcard, discountable, weight, metadata,
              created_at, updated_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7,
              false, true, $8, $9::jsonb,
              NOW(), NOW()
            )
          `, [
            productId,
            product.name.substring(0, 500),
            handle,
            brandName ? brandName.substring(0, 200) : null,
            description ? description.substring(0, 5000) : null,
            status,
            Math.max(0, product.weight || 0),
            metadata,
          ]);

          // ── Insert variant ──
          const variantId = genId('variant');
          await db.query(`
            INSERT INTO product_variant (
              id, product_id, title, sku, barcode,
              manage_inventory, allow_backorder, variant_rank,
              metadata, created_at, updated_at
            ) VALUES (
              $1, $2, 'Default', $3, $4,
              $5, $6, 0,
              $7::jsonb, NOW(), NOW()
            )
          `, [
            variantId,
            productId,
            sku,
            product.barcode ? String(product.barcode).substring(0, 100) : null,
            product.is_storable || false,
            product.allow_out_of_stock_order || false,
            JSON.stringify({
              odoo_product_id: product.id,
              odoo_price: product.list_price || 0,
              odoo_currency: CURRENCY_CODE,
            }),
          ]);

          // ── Insert price_set + price (if price > 0) ──
          if (priceKwd > 0) {
            const priceSetId = genId('pset');
            await db.query(
              `INSERT INTO price_set (id, created_at, updated_at) VALUES ($1, NOW(), NOW())`,
              [priceSetId]
            );
            await db.query(`
              INSERT INTO product_variant_price_set (id, variant_id, price_set_id, created_at, updated_at)
              VALUES ($1, $2, $3, NOW(), NOW())
              ON CONFLICT DO NOTHING
            `, [genId('pvps'), variantId, priceSetId]);

            const rawAmount = JSON.stringify({ value: String(priceKwd), precision: 20 });
            await db.query(`
              INSERT INTO price (
                id, price_set_id, currency_code, amount, raw_amount, rules_count,
                created_at, updated_at
              ) VALUES ($1, $2, $3, $4, $5, 0, NOW(), NOW())
            `, [genId('price'), priceSetId, CURRENCY_CODE, priceKwd, rawAmount]);
          }

          // ── Link to sales channel ──
          if (salesChannelId) {
            await db.query(`
              INSERT INTO product_sales_channel (id, product_id, sales_channel_id, created_at, updated_at)
              VALUES ($1, $2, $3, NOW(), NOW())
              ON CONFLICT (product_id, sales_channel_id) DO NOTHING
            `, [genId('psc'), productId, salesChannelId]);
          }

          // ── Inventory item + level (so stock shows in Medusa admin) ──
          if (product.is_storable || product.qty_available > 0) {
            try {
              const stockQty = Math.max(0, Math.round(product.qty_available || 0));
              const invItemId = genId('iitem');

              await db.query(`
                INSERT INTO inventory_item (id, sku, title, created_at, updated_at)
                VALUES ($1, $2, $3, NOW(), NOW())
                ON CONFLICT DO NOTHING
              `, [invItemId, sku, product.name.substring(0, 500)]);

              // Re-read the actual ID (in case ON CONFLICT happened)
              const { rows: existInv } = await db.query(
                `SELECT id FROM inventory_item WHERE sku = $1 LIMIT 1`,
                [sku]
              );
              const realInvId = existInv[0]?.id || invItemId;

              // Link variant → inventory item
              await db.query(`
                INSERT INTO product_variant_inventory_item (id, variant_id, inventory_item_id, required_quantity, created_at, updated_at)
                VALUES ($1, $2, $3, 1, NOW(), NOW())
                ON CONFLICT DO NOTHING
              `, [genId('pvitem'), variantId, realInvId]);

              // Create inventory level at the default stock location
              if (stockLocationId && stockQty > 0) {
                await db.query(`
                  INSERT INTO inventory_level (id, inventory_item_id, location_id, stocked_quantity, reserved_quantity, incoming_quantity, created_at, updated_at)
                  VALUES ($1, $2, $3, $4, 0, 0, NOW(), NOW())
                  ON CONFLICT DO NOTHING
                `, [genId('iloc'), realInvId, stockLocationId, stockQty]);
              }
            } catch (invErr) {
              // Non-fatal — don't stop the sync for an inventory error
            }
          }


          if (brandName && typeof brandName === 'string' && brandName.trim()) {
            try {
              const brandSlug = brandName
                .toLowerCase()
                .replace(/[^a-z0-9\s-]/g, '')
                .replace(/\s+/g, '-')
                .substring(0, 100);

              let brandId = brandSlugMap.get(brandSlug) || brandNameMap.get(brandName.toLowerCase());

              if (!brandId) {
                brandId = genId('brand');
                const brandOdooId = product.brand_id?.[0] || product.custom_brand_id?.[0] || null;
                const brandImageUrl = brandOdooId
                  ? `${ODOO_CONFIG.url}/web/image/custom.product.brand/${brandOdooId}/image_1920`
                  : null;

                await db.query(`
                  INSERT INTO brand (id, name, slug, is_active, is_special, logo_url, created_at, updated_at)
                  VALUES ($1, $2, $3, true, false, $4, NOW(), NOW())
                  ON CONFLICT DO NOTHING
                `, [brandId, brandName.substring(0, 200), brandSlug, brandImageUrl]);

                // Re-read actual ID
                const { rows: br } = await db.query(
                  `SELECT id FROM brand WHERE slug = $1 AND deleted_at IS NULL LIMIT 1`,
                  [brandSlug]
                );
                brandId = br[0]?.id || brandId;
                brandSlugMap.set(brandSlug, brandId);
                brandNameMap.set(brandName.toLowerCase(), brandId);
              }

              await db.query(`
                INSERT INTO product_brand (id, product_id, brand_id, created_at, updated_at)
                VALUES ($1, $2, $3, NOW(), NOW())
                ON CONFLICT DO NOTHING
              `, [genId('pbr'), productId, brandId]);
            } catch (brandErr) {
              // Non-fatal: brand link failure shouldn't rollback the product
            }
          }

          await db.query('COMMIT');
          existingOdooIds.set(odooIdStr, productId);
          totalCreated++;
        } catch (innerErr) {
          await db.query('ROLLBACK');
          throw innerErr;
        }
      } catch (productErr) {
        totalErrors++;
        consecutiveErrors++;
        if (totalErrors <= 20 || totalErrors % 100 === 0) {
          console.error(`\n   ❌ [Odoo #${product.id}] ${product.name?.substring(0, 40)}: ${productErr.message}`);
        }
      }
    }

    offset += products.length;

    // Save progress checkpoint
    await db.query(`
      INSERT INTO system_config (key, value, updated_at)
      VALUES ('bulk_sync_offset', $1, NOW())
      ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
    `, [String(offset)]).catch(() => {});
  }

  // ─── FINAL REPORT ──────────────────────────────────────────────────────────
  const totalElapsed = Math.round((Date.now() - startTime) / 1000);
  const mins = Math.floor(totalElapsed / 60);
  const secs = totalElapsed % 60;

  console.log('\n\n════════════════════════════════════════════');
  console.log('  BULK SYNC COMPLETE');
  console.log('════════════════════════════════════════════');
  console.log(`  ✅ Created:  ${totalCreated}`);
  console.log(`  🔄 Updated:  ${totalUpdated}`);
  console.log(`  ⏭️  Skipped:  ${totalSkipped}`);
  console.log(`  ❌ Errors:   ${totalErrors}`);
  console.log(`  ⏱️  Duration: ${mins}m ${secs}s`);
  console.log('');

  // Final count
  try {
    const { rows: [countRow] } = await db.query(
      `SELECT COUNT(*) AS c FROM product WHERE deleted_at IS NULL`
    );
    console.log(`  📊 Total products in Medusa now: ${countRow.c}`);
  } catch (_) {}

  // Ensure all products are on sales channel
  if (salesChannelId) {
    console.log('\n🔗 Linking any orphaned products to Sales Channel...');
    const { rowCount } = await db.query(`
      INSERT INTO product_sales_channel (id, product_id, sales_channel_id, created_at, updated_at)
      SELECT
        'psc_' || gen_random_uuid()::text,
        p.id,
        $1,
        NOW(),
        NOW()
      FROM product p
      WHERE p.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM product_sales_channel psc2
          WHERE psc2.product_id = p.id
            AND psc2.sales_channel_id = $1
        )
    `, [salesChannelId]).catch(() => ({ rowCount: 0 }));
    console.log(`   → Linked ${rowCount} additional products to sales channel`);
  }

  console.log('\n✅ Sync finished! Restart Medusa: pm2 restart backend-medusa');
  await db.end();
}

main().catch((err) => {
  console.error('\n💥 FATAL ERROR:', err.message || err);
  process.exit(1);
});
