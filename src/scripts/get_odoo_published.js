const axios = require('axios');

async function getPublishedOdooProducts() {
  const ODOO_URL = process.env.ODOO_URL || 'https://oskarllc-new-36501645.dev.odoo.com';
  const ODOO_DB = process.env.ODOO_DB_NAME || 'oskarllc-new-36501645';
  const ODOO_USER = process.env.ODOO_USERNAME || 'SYG';
  const ODOO_PASSWORD = process.env.ODOO_PASSWORD || '123';

  console.log('🔍 Querying Odoo for products with is_published = true or website_published = true...\n');

  try {
    const authRes = await axios.post(`${ODOO_URL}/jsonrpc`, {
      jsonrpc: '2.0', method: 'call',
      params: { service: 'common', method: 'login', args: [ODOO_DB, ODOO_USER, ODOO_PASSWORD] }
    });
    const uid = authRes.data.result;

    const res = await axios.post(`${ODOO_URL}/jsonrpc`, {
      jsonrpc: '2.0', method: 'call',
      params: {
        service: 'object', method: 'execute_kw',
        args: [
          ODOO_DB, uid, ODOO_PASSWORD,
          'product.template', 'search_read',
          ['|', ['is_published', '=', true], ['website_published', '=', true]],
          { fields: ['id', 'name', 'default_code', 'barcode', 'list_price', 'qty_available', 'categ_id', 'custom_brand_id', 'is_published', 'website_published'] }
        ]
      }
    });

    const products = res.data.result || [];
    console.log(`Total Published Products in Odoo: ${products.length}\n`);

    products.forEach((p, idx) => {
      const brand = Array.isArray(p.custom_brand_id) ? p.custom_brand_id[1] : 'N/A';
      const category = Array.isArray(p.categ_id) ? p.categ_id[1] : 'N/A';
      console.log(`${idx + 1}. [Odoo ID: ${p.id}] "${p.name}"`);
      console.log(`   - SKU: ${p.default_code || 'N/A'} | Barcode: ${p.barcode || 'N/A'}`);
      console.log(`   - Price: ${p.list_price} KWD | Stock: ${p.qty_available} units`);
      console.log(`   - Brand: ${brand} | Category: ${category}`);
      console.log(`   - is_published: ${p.is_published} | website_published: ${p.website_published}\n`);
    });

  } catch (err) {
    console.error('Error fetching published products from Odoo:', err.message);
  }
}

getPublishedOdooProducts();
