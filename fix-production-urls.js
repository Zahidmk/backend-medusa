require('dotenv').config();
const { Client } = require('pg');
const DB_URL = process.env.DATABASE_URL;

async function fixUrls() {
  if (!DB_URL) {
    console.error('DATABASE_URL is not set in .env');
    process.exit(1);
  }

  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  console.log('Connected to DB:', DB_URL.split('@')[1]); // Log host/db safely

  try {
    const OLD_URL = 'https://oskarllc-new-31031096.dev.odoo.com';
    const NEW_URL = 'https://oskarllc-new-35045199.dev.odoo.com';

    // 1. Fix product thumbnails
    const resProducts = await db.query(`
      UPDATE product
      SET thumbnail = REPLACE(thumbnail, $1, $2)
      WHERE thumbnail LIKE '%' || $1 || '%'
    `, [OLD_URL, NEW_URL]);
    console.log(`✅ Updated ${resProducts.rowCount} product thumbnails`);

    // 2. Fix product images
    const resImages = await db.query(`
      UPDATE image
      SET url = REPLACE(url, $1, $2)
      WHERE url LIKE '%' || $1 || '%'
    `, [OLD_URL, NEW_URL]);
    console.log(`✅ Updated ${resImages.rowCount} product gallery images`);

    // 3. Fix brand logos
    try {
      const resBrands = await db.query(`
        UPDATE brand
        SET logo_url = REPLACE(logo_url, $1, $2),
            banner_url = REPLACE(banner_url, $1, $2)
        WHERE logo_url LIKE '%' || $1 || '%' OR banner_url LIKE '%' || $1 || '%'
      `, [OLD_URL, NEW_URL]);
      console.log(`✅ Updated ${resBrands.rowCount} brand logos and banners`);
    } catch (e) {
      console.log('⚠️ Could not update brand table (maybe not using it)');
    }

    // 4. Fix banners
    try {
      const resBanners = await db.query(`
        UPDATE banner
        SET image_url = REPLACE(image_url, $1, $2)
        WHERE image_url LIKE '%' || $1 || '%'
      `, [OLD_URL, NEW_URL]);
      console.log(`✅ Updated ${resBanners.rowCount} banner images`);
    } catch (e) {
      console.log('⚠️ Could not update banner table (maybe not using it)');
    }

    console.log('\n🎉 ALL DONE! Please clear frontend cache or restart Medusa/Next.js if needed.');
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await db.end();
  }
}

fixUrls();
