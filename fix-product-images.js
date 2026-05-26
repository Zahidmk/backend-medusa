#!/usr/bin/env node
/**
 * fix-product-images.js
 * =====================
 * Sets product thumbnails by pointing directly to Odoo's image URL.
 * Format: https://odoo-url/web/image/product.template/{odoo_id}/image_1920
 *
 * This is instant — no image download required. The Odoo URL serves images publicly.
 *
 * Usage (production server):
 *   DATABASE_URL="postgres://medusa_user:Medusa1234@localhost:5432/medusa" \
 *   ODOO_URL="https://oskarllc-new-31031096.dev.odoo.com" \
 *   node fix-product-images.js
 */

'use strict';

const { Client } = require('pg');

const DB_URL   = process.env.DATABASE_URL || 'postgres://medusa_user:Medusa1234@localhost:5432/medusa';
const ODOO_URL = (process.env.ODOO_URL || 'https://oskarllc-new-31031096.dev.odoo.com').replace(/\/$/, '');
const BATCH    = 500; // products per UPDATE batch

async function main() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║   SET PRODUCT THUMBNAILS FROM ODOO URLS       ║');
  console.log('╚═══════════════════════════════════════════════╝');
  console.log(`Odoo URL: ${ODOO_URL}`);
  console.log(`DB:       ${DB_URL.replace(/:([^:@]+)@/, ':***@')}\n`);

  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  // Count how many products need thumbnails
  const { rows: [{ missing }] } = await db.query(`
    SELECT COUNT(*) AS missing
    FROM product
    WHERE deleted_at IS NULL
      AND (thumbnail IS NULL OR thumbnail = '')
      AND metadata->>'odoo_id' IS NOT NULL
  `);
  console.log(`📷 Products missing thumbnails: ${missing}`);

  // Count already have thumbnails
  const { rows: [{ has_thumb }] } = await db.query(`
    SELECT COUNT(*) AS has_thumb
    FROM product
    WHERE deleted_at IS NULL
      AND thumbnail IS NOT NULL AND thumbnail != ''
  `);
  console.log(`✅ Products already have thumbnails: ${has_thumb}`);

  if (parseInt(missing) === 0) {
    console.log('\n🎉 All products already have thumbnails!');
    await db.end();
    return;
  }

  console.log(`\n🚀 Setting thumbnails for ${missing} products...`);
  const startTime = Date.now();

  // Bulk UPDATE: set thumbnail = odoo_url/web/image/product.template/{odoo_id}/image_1920
  // Do it in one shot using a SQL expression
  const { rowCount } = await db.query(`
    UPDATE product
    SET
      thumbnail = '${ODOO_URL}/web/image/product.template/' || (metadata->>'odoo_id') || '/image_1920',
      updated_at = NOW()
    WHERE deleted_at IS NULL
      AND (thumbnail IS NULL OR thumbnail = '')
      AND metadata->>'odoo_id' IS NOT NULL
  `);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Updated ${rowCount} product thumbnails in ${elapsed}s`);

  // Also insert image records into the image table if it exists
  // (Medusa uses product.images[] for gallery display)
  console.log('\n🖼️  Inserting image records...');
  try {
    // First check if image table exists
    const { rows: tables } = await db.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'image'
    `);

    if (tables.length > 0) {
      // Insert image rows for products that don't have any
      const { rowCount: imgCount } = await db.query(`
        INSERT INTO image (id, url, product_id, rank, created_at, updated_at)
        SELECT
          'img_' || gen_random_uuid()::text,
          '${ODOO_URL}/web/image/product.template/' || (p.metadata->>'odoo_id') || '/image_1920',
          p.id,
          0,
          NOW(),
          NOW()
        FROM product p
        WHERE p.deleted_at IS NULL
          AND p.metadata->>'odoo_id' IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM image i WHERE i.product_id = p.id AND i.deleted_at IS NULL
          )
        ON CONFLICT DO NOTHING
      `);
      console.log(`✅ Inserted ${imgCount} image records`);
    } else {
      console.log('ℹ️  image table not found — skipping (thumbnail field is sufficient)');
    }
  } catch (imgErr) {
    console.log(`⚠️  Image table insert skipped: ${imgErr.message}`);
  }

  // Verify final state
  const { rows: [{ final_with_thumb }] } = await db.query(`
    SELECT COUNT(*) AS final_with_thumb
    FROM product
    WHERE deleted_at IS NULL
      AND thumbnail IS NOT NULL AND thumbnail != ''
  `);

  console.log('\n════════════════════════════════════════');
  console.log('  COMPLETE');
  console.log('════════════════════════════════════════');
  console.log(`  📊 Products with thumbnails: ${final_with_thumb}`);
  console.log(`  ⏱️  Time: ${elapsed}s`);
  console.log('\n✅ Done! Restart Medusa: pm2 restart medusa-backend');

  await db.end();
}

main().catch((err) => {
  console.error('❌ Fatal:', err.message || err);
  process.exit(1);
});
