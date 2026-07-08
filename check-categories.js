const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://marqa_user:marqa123@localhost:5432/marqa_souq_dev',
});

async function checkCategories() {
  try {
    console.log("Checking categories in database...");
    const res = await pool.query(`
      SELECT id, name, handle, parent_category_id, metadata 
      FROM product_category 
      WHERE deleted_at IS NULL 
      ORDER BY created_at DESC
    `);

    console.log(`\nFound ${res.rows.length} active categories.\n`);
    
    // Display the first 20 categories
    const displayCount = Math.min(20, res.rows.length);
    for (let i = 0; i < displayCount; i++) {
      const cat = res.rows[i];
      console.log(`[${cat.id}] ${cat.name} (Handle: ${cat.handle})`);
      console.log(`   Parent: ${cat.parent_category_id || 'None (Root Category)'}`);
      console.log(`   Metadata: ${JSON.stringify(cat.metadata || {})}`);
      console.log('---');
    }

    if (res.rows.length > displayCount) {
      console.log(`... and ${res.rows.length - displayCount} more categories.`);
    }

  } catch (error) {
    console.error("Error checking categories:", error);
  } finally {
    await pool.end();
  }
}

checkCategories();
