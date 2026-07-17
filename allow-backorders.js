require('dotenv').config();
const { Client } = require('pg');
const DB_URL = process.env.DATABASE_URL || 'postgres://postgres:marqa123@127.0.0.1:5433/marqa_souq_dev';

async function updateVariants() {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  
  try {
    const res = await db.query(`
      UPDATE product_variant 
      SET allow_backorder = true;
    `);
    console.log(`Updated ${res.rowCount} variants to allow backorders`);
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await db.end();
  }
}

updateVariants();
