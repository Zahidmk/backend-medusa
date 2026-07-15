const { Client } = require('pg');
async function run() {
  const client = new Client({ connectionString: 'postgres://postgres:marqa123@127.0.0.1:5433/marqa_souq_dev' });
  await client.connect();
  console.log('Connected.');
  
  // Update a product's retail_price and list_price in metadata
  await client.query(`
    UPDATE product 
    SET metadata = jsonb_set(
      jsonb_set(metadata, '{retail_price}', '"599.99"'::jsonb),
      '{list_price}', '"650.00"'::jsonb
    )
    WHERE id = 'prod_YTEEBZWRMS3XC81M8M4PVGPEAJ'
  `);
  
  // Also update the variant's price in Medusa so the frontend sees it
  const res = await client.query(`
    SELECT pvps.price_set_id
    FROM product_variant pv
    JOIN product_variant_price_set pvps ON pvps.variant_id = pv.id
    WHERE pv.product_id = 'prod_YTEEBZWRMS3XC81M8M4PVGPEAJ'
  `);
  
  if (res.rows.length > 0) {
    const priceSetId = res.rows[0].price_set_id;
    await client.query(`
      UPDATE price
      SET amount = 599990, raw_amount = '{"value": "599990", "precision": 20}'
      WHERE price_set_id = $1
    `, [priceSetId]);
    console.log('Successfully injected mock retail price of 599.99 for Nivea Cream.');
  }
  
  await client.end();
}
run();
