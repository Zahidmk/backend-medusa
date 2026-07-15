const { Client } = require('pg');

async function test() {
  const client = new Client({
    connectionString: 'postgres://postgres:marqa123@127.0.0.1:5433/marqa_souq_dev'
  });

  try {
    await client.connect();
    console.log("Connected to DB successfully.");
    const res = await client.query(`
      SELECT p.id, p.title, p.metadata->>'retail_price' as retail_price, p.metadata->>'list_price' as list_price,
             pr.amount as db_price, pr.currency_code
      FROM product p
      JOIN product_variant pv ON pv.product_id = p.id
      JOIN product_variant_price_set pvps ON pvps.variant_id = pv.id
      JOIN price pr ON pr.price_set_id = pvps.price_set_id
      ORDER BY p.updated_at DESC
      LIMIT 1
    `);
    
    if (res.rows.length > 0) {
      console.log("LATEST UPDATED PRODUCT:");
      console.log(JSON.stringify(res.rows[0], null, 2));
    } else {
      console.log("No products found.");
    }
  } catch (err) {
    console.error("Failed to connect or query:", err.message);
  } finally {
    await client.end();
  }
}

test();
