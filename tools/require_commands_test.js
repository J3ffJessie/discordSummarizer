const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'src', 'commands');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
let ok = true;
for (const f of files) {
  const p = path.join(dir, f);
  try {
    const mod = require(p);
    console.log(`${f}: OK (exports: ${Object.keys(mod).join(',')})`);
  } catch (err) {
    console.error(`${f}: ERR ->`, err && err.stack ? err.stack.split('\n')[0] : err);
    ok = false;
  }
}
process.exit(ok ? 0 : 1);
