const knex = require('knex')({
  client: 'pg',
  connection: 'postgres://marqa_user:marqa123@localhost:5432/marqa_souq_dev'
});

require('dotenv').config();

const ODOO_BASE = (process.env.ODOO_URL || '').replace(/\/$/, '');

async function main() {
  // 1. Fix odoo images (pattern: odoo-XXXXX in filename)
  const images = await knex.raw("SELECT i.id, i.url, i.product_id FROM image i WHERE i.url LIKE '%odoo-%'");
  console.log('Odoo images to fix:', images.rows.length);

  let fixed = 0;
  for (const img of images.rows) {
    const match = img.url.match(/odoo-(\d+)/);
    if (!match) continue;
    const odooId = match[1];
    const newUrl = ODOO_BASE + '/web/image/product.template/' + odooId + '/image_1920';
    await knex('image').where('id', img.id).update({ url: newUrl });
    fixed++;
  }
  console.log('Fixed odoo images:', fixed);

  // 2. Fix product thumbnails with odoo pattern
  const thumbs = await knex.raw("SELECT id, thumbnail FROM product WHERE thumbnail LIKE '%odoo-%'");
  console.log('Odoo thumbnails to fix:', thumbs.rows.length);

  let fixedT = 0;
  for (const p of thumbs.rows) {
    const match = p.thumbnail.match(/odoo-(\d+)/);
    if (!match) continue;
    const odooId = match[1];
    const newUrl = ODOO_BASE + '/web/image/product.template/' + odooId + '/image_1920';
    await knex('product').where('id', p.id).update({ thumbnail: newUrl });
    fixedT++;
  }
  console.log('Fixed odoo thumbnails:', fixedT);

  // 3. Fix remaining localhost images (samsung etc) - use product metadata odoo_id
  const remaining = await knex.raw("SELECT i.id, i.url, i.product_id FROM image i WHERE i.url LIKE 'http://localhost:9000%' AND i.url NOT LIKE '%odoo-%'");
  console.log('Remaining localhost images:', remaining.rows.length);

  let fixedR = 0;
  for (const img of remaining.rows) {
    if (!img.product_id) continue;
    const prod = await knex('product').where('id', img.product_id).select('metadata').first();
    const odooId = prod?.metadata?.odoo_id;
    if (odooId) {
      const newUrl = ODOO_BASE + '/web/image/product.template/' + odooId + '/image_1920';
      await knex('image').where('id', img.id).update({ url: newUrl });
      fixedR++;
    } else {
      console.log('  No odoo_id for:', img.url);
    }
  }
  console.log('Fixed remaining images:', fixedR);

  // 4. Fix remaining localhost thumbnails
  const remThumb = await knex.raw("SELECT id, thumbnail, metadata FROM product WHERE thumbnail LIKE 'http://localhost:9000%' AND thumbnail NOT LIKE '%odoo-%'");
  console.log('Remaining localhost thumbnails:', remThumb.rows.length);

  let fixedRT = 0;
  for (const p of remThumb.rows) {
    const odooId = p.metadata?.odoo_id;
    if (odooId) {
      const newUrl = ODOO_BASE + '/web/image/product.template/' + odooId + '/image_1920';
      await knex('product').where('id', p.id).update({ thumbnail: newUrl });
      fixedRT++;
    } else {
      console.log('  No odoo_id for product:', p.id, p.thumbnail);
    }
  }
  console.log('Fixed remaining thumbnails:', fixedRT);

  // 5. Verify
  const check = await knex.raw("SELECT COUNT(*) as cnt FROM image WHERE url LIKE 'http://localhost%'");
  console.log('\nRemaining localhost images:', check.rows[0].cnt);
  const checkT = await knex.raw("SELECT COUNT(*) as cnt FROM product WHERE thumbnail LIKE 'http://localhost%'");
  console.log('Remaining localhost thumbnails:', checkT.rows[0].cnt);

  // Show sample
  const sample = await knex.raw("SELECT url FROM image LIMIT 5");
  console.log('\nSample URLs:', sample.rows.map(r => r.url));

  await knex.destroy();
}

main().catch(e => { console.error(e); process.exit(1); });
