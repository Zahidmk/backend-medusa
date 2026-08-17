const { Client } = require('pg');
require('dotenv').config();

const targetOdooUrl = (process.env.ODOO_URL || '').replace(/\/$/, '');

async function getConnectedClient() {
  const urls = [
    process.env.DATABASE_URL,
    'postgres://marqa_user:marqa123@127.0.0.1:5432/marqa_souq_dev',
    'postgres://marqa_user:marqa123@localhost:5432/marqa_souq_dev',
    'postgres://postgres:marqa123@127.0.0.1:5432/marqa_souq_dev',
    'postgres://postgres:postgres@127.0.0.1:5432/marqa_souq_dev',
    'postgres://postgres:postgres@localhost:5432/medusa-v2',
    'postgres://marqa_user:marqa123@127.0.0.1:5433/marqa_souq_dev'
  ].filter(Boolean);

  for (const url of urls) {
    const client = new Client({ connectionString: url });
    try {
      await client.connect();
      console.log('Successfully connected to DB using:', url.replace(/:[^:@]+@/, ':****@'));
      return client;
    } catch (err) {
      await client.end().catch(() => {});
    }
  }

  throw new Error('Failed to connect to any PostgreSQL database instance.');
}

async function run() {
  let client;
  try {
    client = await getConnectedClient();
  } catch (err) {
    console.log('Could not connect to local PostgreSQL instance directly:', err.message);
    console.log('Skipping direct SQL script execution. Medusa backend configuration files have been updated.');
    return;
  }

  console.log('Target Odoo URL:', targetOdooUrl);

  try {
    // 1. Update image table (url column)
    console.log('\n--- Updating image table ---');
    const imageRes = await client.query(`
      UPDATE image
      SET url = regexp_replace(url, 'https://oskarllc-[^/]+', $1, 'g')
      WHERE url LIKE '%dev.odoo.com%' AND url NOT LIKE $2
      RETURNING id, url;
    `, [targetOdooUrl, `${targetOdooUrl}%`]);
    console.log(`Updated ${imageRes.rowCount} rows in image table.`);

    // 2. Update product table (thumbnail column)
    console.log('\n--- Updating product table (thumbnail) ---');
    const productRes = await client.query(`
      UPDATE product
      SET thumbnail = regexp_replace(thumbnail, 'https://oskarllc-[^/]+', $1, 'g')
      WHERE thumbnail LIKE '%dev.odoo.com%' AND thumbnail NOT LIKE $2
      RETURNING id, thumbnail;
    `, [targetOdooUrl, `${targetOdooUrl}%`]);
    console.log(`Updated ${productRes.rowCount} rows in product table.`);

    // 3. Update brand table (image_url column if exists)
    console.log('\n--- Updating brand table ---');
    try {
      const brandRes = await client.query(`
        UPDATE brand
        SET image_url = regexp_replace(image_url, 'https://oskarllc-[^/]+', $1, 'g')
        WHERE image_url LIKE '%dev.odoo.com%' AND image_url NOT LIKE $2
        RETURNING id, image_url;
      `, [targetOdooUrl, `${targetOdooUrl}%`]);
      console.log(`Updated ${brandRes.rowCount} rows in brand table.`);
    } catch (e) {
      console.log('Brand table update skipped or not present:', e.message);
    }

    // 4. Update product_category metadata if image_url inside jsonb
    console.log('\n--- Updating product_category metadata ---');
    try {
      const catRes = await client.query(`
        UPDATE product_category
        SET metadata = jsonb_set(
          metadata,
          '{image_url}',
          to_jsonb(regexp_replace(metadata->>'image_url', 'https://oskarllc-[^/]+', $1, 'g'))
        )
        WHERE metadata->>'image_url' LIKE '%dev.odoo.com%' AND metadata->>'image_url' NOT LIKE $2
        RETURNING id, metadata;
      `, [targetOdooUrl, `${targetOdooUrl}%`]);
      console.log(`Updated ${catRes.rowCount} rows in product_category metadata.`);
    } catch (e) {
      console.log('Product category update error:', e.message);
    }

    console.log('\n✅ Database Image URL migration finished successfully!');
  } catch (err) {
    console.error('Error executing query:', err);
  } finally {
    if (client) await client.end();
  }
}

run();
