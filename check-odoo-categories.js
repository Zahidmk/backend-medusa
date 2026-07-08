const http = require('https');

http.get('https://oskarllc-new-31031096.dev.odoo.com/api/categories', {
  headers: { 'Api-Key': 'your_api_key_here' }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const categories = JSON.parse(data);
      console.log(`Fetched ${categories.length} categories.`);
      const parent = categories.find(c => c.name === 'Mobile & Tablet');
      const child = categories.find(c => c.name === 'Mobiles');
      console.log('Parent:', parent);
      console.log('Child:', child);
    } catch(e) {
      console.error('Error parsing JSON or fetching:', data.substring(0, 500));
    }
  });
}).on('error', console.error);
