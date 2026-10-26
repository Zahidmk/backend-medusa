/**
 * Prices are stored in fils (1000 = KWD 1.000) but the stock Medusa admin
 * treats stored amounts as whole KWD, so it shows "KWD 1,000.000".
 * Patch the dashboard's shared money formatters to divide KWD by 1000.
 * Idempotent; run before `medusa build` (node_modules is replaced on install).
 */
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'node_modules', '@medusajs', 'dashboard', 'dist');
const MARK = '/*kwd-fils*/';
const FIX = `${MARK} if (String(currencyCode).toLowerCase() === "kwd") amount = amount / 1000;`;
const defs = /((?:var\s+)?(?:getLocaleAmount|getStylizedAmount)\s*=\s*\(amount,\s*currencyCode\)\s*=>\s*\{)/g;

let patched = 0;
for (const file of fs.readdirSync(distDir)) {
  if (!/\.m?js$/.test(file)) continue;
  const p = path.join(distDir, file);
  const src = fs.readFileSync(p, 'utf8');
  defs.lastIndex = 0;
  if (!defs.test(src) || src.includes(MARK)) continue;
  defs.lastIndex = 0;
  fs.writeFileSync(p, src.replace(defs, `$1\n${FIX}`));
  patched++;
  console.log(`  ✅ KWD fils patch applied to ${file}`);
}
if (!patched) console.log('  KWD fils patch already applied or formatter not found');
