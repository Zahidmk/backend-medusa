const fetch = require('node-fetch');

async function test() {
  try {
    const res = await fetch("http://localhost:9000/store/odoo-handles?ids=50,111");
    if (!res.ok) {
      console.log("Error:", res.status, await res.text());
      return;
    }
    const data = await res.json();
    console.log("Handles:", data);
  } catch (e) {
    console.log("Fetch failed:", e.message);
  }
}
test();
