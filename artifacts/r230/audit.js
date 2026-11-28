/* r230: host audit of all 74 playground apps at native 466 / 480.
 * Reconstructs the r227 audit: generated bundles, real prelude, one frame tick,
 * with raycast / image host stubs so harness limits don't masquerade as app bugs.
 * Usage: node artifacts/r230/audit.js 466 [logfile]
 */
'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const { runApp } = require('../../tests/lib/prelude_runner');

const size = Number(process.argv[2] || 466);
const tag = size === 466 ? '466' : '480';

// Shape metadata from the checked-in playground catalog (r226 7-tuple).
const page = fs.readFileSync('website/playground/page.js', 'utf8');
const block = page.match(/const examples = \[([\s\S]*?)\n  \];/);
if (!block) throw new Error('cannot parse examples catalog');
const shapeOf = {};
for (const line of block[1].split('\n')) {
  const m = line.match(/^\s*\['([^']+)'.*'((?:round|square))'\],?$/);
  if (m) shapeOf[m[1]] = m[2];
}

// Decode window.LUME_APPS["name"] = "<bundle string>" from the generated file.
const sandbox = { window: { LUME_APPS: {} } };
for (const f of fs.readdirSync('website/playground/apps')) {
  if (f.endsWith('.js')) vm.runInNewContext(fs.readFileSync(`website/playground/apps/${f}`, 'utf8'), sandbox);
}
const apps = sandbox.window.LUME_APPS;

// Host stubs: no raycast module / image decoder on the host. Same as r218/r227.
const PRELUDE_STUB = `lume.raycast = { setMap: function(){return 0;}, setTextures: function(){return 0;}, render: function(){}, setText: function(){return 0;} };
lume.image.sizeOf = function(){ return {w:1,h:1}; };
lume.image.decode = function(){ return {pixels:new Uint16Array(1),w:1,h:1}; };
`;

let ok = 0, fail = 0;
const results = [];
for (const name of Object.keys(apps).sort()) {
  let err = '';
  try {
    const h = runApp(PRELUDE_STUB + apps[name], { screen: { w: size, h: size } });
    vm.runInContext('__lume_tick()', h.ctx);
  } catch (e) {
    err = (e && e.message ? e.message : String(e)).replace(/\n/g, ' ');
  }
  if (err) {
    fail++;
    results.push(`FAIL_${tag} ${name.padEnd(17)} shape=${shapeOf[name] || 'square'} err=${err}`);
  } else {
    ok++;
    results.push(`OK_${tag}   ${name.padEnd(17)} shape=${shapeOf[name] || 'square'}`);
  }
}
results.push(`SUMMARY_${tag} total=${ok + fail} ok=${ok} fail=${fail}`);
const out = results.join('\n') + '\n';
process.stdout.write(out);
if (process.argv[3]) fs.writeFileSync(process.argv[3], out);
process.exitCode = fail === 0 ? 0 : 1;
