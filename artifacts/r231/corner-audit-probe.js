/* r231 prototype: corner safety audit over native-466 round apps. */
'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const { runApp } = require('../../tests/lib/prelude_runner');

const SHELL = fs.readFileSync('runtime/shell.js', 'utf8');
const inlineShell = s => s.replace(/^\s*import\s+['"][^'"]*runtime\/shell\.js['"];?\s*$/m, SHELL);
const STUB = `lume.raycast={setMap:function(){return 0;},setTextures:function(){return 0;},render:function(){},setText:function(){return 0;}};\nlume.image.sizeOf=function(){return {w:1,h:1};};lume.image.decode=function(){return {pixels:new Uint16Array(1),w:1,h:1};};\n`;

const page = fs.readFileSync('website/playground/page.js', 'utf8');
const block = page.match(/const examples = \[([\s\S]*?)\n  \];/);
const round = [];
for (const line of block[1].split('\n')) {
  const m = line.match(/^\s*\['([^']+)'.*'round'\],?$/);
  if (m) round.push(m[1]);
}
const sandbox = { window: { LUME_APPS: {} } };
for (const f of fs.readdirSync('website/playground/apps')) {
  if (f.endsWith('.js')) vm.runInNewContext(fs.readFileSync(`website/playground/apps/${f}`, 'utf8'), sandbox);
}
const apps = sandbox.window.LUME_APPS;
const CX = 233, CY = 233, VIS = 233, SAFE = 233 - 466 * 0.15625; // 160.1875

function estimateTextWidth(text, fontSize) {
  let w = 0;
  for (const ch of String(text)) w += /[\u2E80-\u9FFF]/.test(ch) ? fontSize : fontSize * 0.55;
  return w;
}
function distToBox(box) {
  const dx = Math.max(box.x - CX, 0, CX - (box.x + box.w));
  const dy = Math.max(box.y - CY, 0, CY - (box.y + box.h));
  return Math.hypot(dx, dy);
}
function maxCornerDist(box) {
  return Math.max(...[[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]]
    .map(([x, y]) => Math.hypot(x - CX, y - CY)));
}

let totalRisks = 0;
for (const name of round.sort()) {
  let h;
  try { h = runApp(STUB + apps[name], { screen: { w: 466, h: 466 } }); }
  catch (e) { console.log(`ERR ${name}: ${e.message}`); continue; }
  const nodes = new Map();
  for (const m of h.messages) {
    if (m[0] === 'create') nodes.set(m[1], { id: m[1], kind: m[2], parent: m[3], w: m[4], h: m[5], attrs: {} });
    else if (m[0] === 'attr') { const n = nodes.get(m[1]); if (n) n.attrs[m[2]] = m[3]; }
  }
  function abs(id) {
    const n = nodes.get(id);
    if (!n) return { x: 0, y: 0, w: 466, h: 466 };
    const p = n.parent ? abs(n.parent) : { x: 0, y: 0, w: 466, h: 466 };
    let x = p.x + (n.attrs[18] || 0), y = p.y + (n.attrs[19] || 0);
    let w = n.attrs[2] !== undefined ? n.attrs[2] : (n.attrs[16] !== undefined ? p.w * n.attrs[16] / 100 : n.w || 0);
    let hh = n.attrs[3] !== undefined ? n.attrs[3] : (n.attrs[17] !== undefined ? p.h * n.attrs[17] / 100 : n.h || 0);
    if (n.kind === 1) {
      const fs = n.attrs[55] || 16;
      const text = n.attrs[0] === undefined ? '' : String(typeof n.attrs[0] === 'function' ? '' : n.attrs[0]);
      const ink = estimateTextWidth(text, fs);
      if (ink > 0) {
        const align = n.attrs[53] || 0;
        const ix = align === 1 ? x + (w - ink) / 2 : align === 2 ? x + w - ink : x;
        w = Math.min(w || ink, ink); x = ix;
        hh = Math.min(hh || fs * 1.2, fs * 1.2);
      }
    }
    return { x, y, w, h: hh };
  }
  const risks = [];
  for (const n of nodes.values()) {
    if (![1, 2, 4].includes(n.kind)) continue; // Text / Button / Image
    if (n.attrs[5] === 0) continue;
    const b = abs(n.id);
    if (!b.w || !b.h) continue;
    if (b.w >= 450 && b.h >= 450) continue;
    const near = distToBox(b), far = maxCornerDist(b);
    let level = '';
    if (near > VIS) level = 'FULL_CLIP';
    else if (far > VIS) level = 'PARTIAL_CLIP';
    if (!level) continue;
    const text = n.attrs[0] === undefined ? '' : String(n.attrs[0]).slice(0, 24);
    risks.push(`${level} #${n.id} k${n.kind} "${text}" box=(${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)}x${Math.round(b.h)}) near=${Math.round(near)} far=${Math.round(far)} safe=${Math.round(SAFE)}`);
  }
  if (risks.length) {
    totalRisks += risks.length;
    console.log(`${name}: ${risks.length} risk(s)`);
    for (const r of risks.slice(0, 12)) console.log('  ' + r);
    if (risks.length > 12) console.log(`  ... +${risks.length - 12} more`);
  }
}
console.log(`TOTAL risks=${totalRisks} across ${round.length} round apps`);
