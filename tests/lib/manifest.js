const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');

function readManifest(source = fs.readFileSync(path.join(root, 'tools/playground/build.mjs'), 'utf8')) {
  const block = source.match(/const apps = \[([\s\S]*?)\];/);
  if (!block) throw new Error('playground manifest missing');
  const apps = [...block[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  if (!apps.length || new Set(apps).size !== apps.length) throw new Error('playground manifest empty or duplicated');
  return apps;
}

module.exports = { readManifest };
