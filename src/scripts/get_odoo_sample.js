const axios = require('axios');

async function getOdooProductSample() {
  const ODOO_URL = process.env.ODOO_URL || 'https://oskarllc-new-36501645.dev.odoo.com';
  const ODOO_DB = process.env.ODOO_DB_NAME || 'oskarllc-new-36501645';
  const ODOO_USER = process.env.ODOO_USERNAME || 'SYG';
  const ODOO_PASSWORD = process.env.ODOO_PASSWORD || '123';

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
          [[['active', '=', true], ['sale_ok', '=', true]]],
          { limit: 10, fields: ['id', 'name', 'default_code', 'barcode', 'list_price', 'qty_available', 'categ_id', 'custom_brand_id', 'is_published', 'website_published'] }
        ]
      }
    });

    const products = res.data.result || [];
    console.log('Sample Active Saleable Products in Odoo (Total: 7,030):\n');
    products.forEach((p, idx) => {
      console.log(`${idx + 1}. [ID: ${p.id}] "${p.name}" | SKU: ${p.default_code || 'N/A'} | is_published: ${p.is_published}`);
    });

  } catch (err) {
    console.error('Error:', err.message);
  }
}

getOdooProductSample();
