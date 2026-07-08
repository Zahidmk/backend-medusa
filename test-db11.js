const { Client } = require('pg');
const client = new Client('postgres://postgres:marqa123@127.0.0.1:5433/marqa_souq_dev');
client.connect();
client.query("SELECT id, name, metadata FROM product_category WHERE name = 'Mobile & Tablet' OR name = 'Mobiles'")
  .then(res => {
    console.log(JSON.stringify(res.rows, null, 2));
    client.end();
  })
  .catch(console.error);
