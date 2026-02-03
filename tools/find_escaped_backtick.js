const fs = require('fs');
const path = require('path');

function walk(dir) {
  const res = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const stat = fs.statSync(p);
    if (stat.isDirectory()) res.push(...walk(p));
    else if (p.endsWith('.js')) res.push(p);
  }
  return res;
}

const files = walk(path.join(__dirname, '..', 'src'));
let found = 0;
for (const f of files) {
  const txt = fs.readFileSync(f, 'utf8');
  const lines = txt.split('\n');
  lines.forEach((line, idx) => {
    if (line.includes('\\`')) {
      console.log(`${f}:${idx+1}: ${line}`);
      found++;
    }
  });
}
if (found === 0) console.log('No escaped backtick occurrences found in src JS files.');
else console.log(`Found ${found} lines with escaped backticks.`);
