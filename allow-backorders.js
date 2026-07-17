require('dotenv').config();
const { Client } = require('pg');
const DB_URL = process.env.DATABASE_URL;

async function updateVariants() {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  
  try {
    const res = await db.query(`
      UPDATE product_variant 
      SET allow_backorder = true;
    `);
    console.log(`Updated ${res.rowCount} variants to TRUE (Backend now bypasses stock check)`);
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await db.end();
  }
}

updateVariants();
