const http = require('https');

function checkImage(id) {
  const url = `https://oskarllc-new-31031096.dev.odoo.com/web/image/product.public.category/${id}/image_1920`;
  http.get(url, (res) => {
    console.log(`Category ${id}: Status ${res.statusCode}, Content-Type: ${res.headers['content-type']}, Content-Length: ${res.headers['content-length']}`);
    let data = [];
    res.on('data', chunk => data.push(chunk));
    res.on('end', () => {
      const buffer = Buffer.concat(data);
      console.log(`Category ${id}: Downloaded ${buffer.length} bytes.`);
    });
  }).on('error', console.error);
}

checkImage(23); // Parent
checkImage(147); // Sub
