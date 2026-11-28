/* r231: round-screen corner safety audit, reusable regression harness.
 *
 * Two layers:
 *   1. Host-only (always runs, no browser dependency): locks the five
 *      watchface corner labels to adaptive coordinates inside the native 466
 *      visible circle (centre 233,233 r=233), using the real prelude message
 *      stream at screen 466. This is the load-bearing guard in tests/*.js.
 *   2. Browser DOM audit (runs when Playwright resolves): loads all 37 round
 *      playground apps at native 466, reads real rendered bounding rects of
 *      leaf content nodes (Text / Button / Image; text ink via Range), and
 *      reports FULL_CLIP / PARTIAL_CLIP risks against the visible circle.
 *      The CORNER band uses the playground safe-circle radius 160.1875 px
 *      (inset 15.625%). Set PLAYWRIGHT_MODULE=/path/to/playwright to enable.
 *
 * Exits 1 only when a guard fails; detected risks elsewhere are reported,
 * not failed (see docs/KNOWN-SIMPLIFICATIONS.md r231 for accepted cases).
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { runApp } = require('./lib/prelude_runner');

const ROOT = path.resolve(__dirname, '..');
const CX = 233, CY = 233, VISIBLE = 233, SAFE = 160.1875;
let failures = 0;
function check(label, fn) {
  try { fn(); console.log('PASS ' + label); }
  catch (e) { failures++; console.error('FAIL ' + label + ': ' + (e && e.message ? e.message : String(e))); }
}
function assert(cond, message) { if (!cond) throw new Error(message); }
const dist = (box) => {
  const far = Math.max(...[[box.x, box.y], [box.x + box.w, box.y],
    [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]]
    .map(([x, y]) => Math.hypot(x - CX, y - CY)));
  const dx = Math.max(box.x - CX, 0, CX - (box.x + box.w));
  const dy = Math.max(box.y - CY, 0, CY - (box.y + box.h));
  return { far, near: Math.hypot(dx, dy) };
};

// ---- catalog: 37 round apps, from the checked-in playground metadata ----
const pageSrc = fs.readFileSync(path.join(ROOT, 'website/playground/page.js'), 'utf8');
const block = pageSrc.match(/const examples = \[([\s\S]*?)\n  \];/);
assert(block, 'cannot parse playground examples catalog');
const roundApps = [];
for (const line of block[1].split('\n')) {
  const m = line.match(/^\s*\['([^']+)'.*'round'\],?$/);
  if (m) roundApps.push(m[1]);
}
check('round catalog has 37 apps', () => assert(roundApps.length === 37, `got ${roundApps.length}`));

// ---- layer 1: host-only structural + geometry guard ----
const LABELS = [
  ['digital', 'LUME / DIGITAL', 80, 84],
  ['analog', 'LUME / ANALOG', 80, 72],
  ['rings', 'LUME / ACTIVITY', 80, 72],
  ['goals', 'LUME / GOALS', 80, 78],
  ['modular', 'LUME / MODULAR', 80, 78],
];
const src = fs.readFileSync(path.join(ROOT, 'examples/watchface/app.js'), 'utf8');
check('watchface labels use explicit __A_SX/__A_SY once', () => {
  assert(src.includes('function __A_cornerLabel('), 'missing __A_cornerLabel helper');
  assert(src.includes('x: __A_SX(x)') && src.includes('y: __A_SY(y)'), 'helper does not scale');
  assert(!/__A_Text\(\{[^}]*LUME \/ /.test(src), 'label still routed through __A_Text (double scale)');
  for (const [face, text, x, y] of LABELS) {
    const needle = `__A_cornerLabel(${face}, '${text}', ${x}, ${y}`;
    assert(src.includes(needle), `missing ${needle}`);
  }
});
check('watchface labels inside native 466 visible circle (host geometry)', () => {
  const sandbox = { window: { LUME_APPS: {} } };
  const bundleDir = path.join(ROOT, 'website/playground/apps');
  for (const f of fs.readdirSync(bundleDir)) {
    if (f.endsWith('.js')) vm.runInNewContext(fs.readFileSync(path.join(bundleDir, f), 'utf8'), sandbox);
  }
  const h = runApp(sandbox.window.LUME_APPS.watchface, { screen: { w: 466, h: 466 } });
  const nodes = new Map();
  for (const m of h.messages) {
    if (m[0] === 'create') nodes.set(m[1], { attrs: {} });
    else if (m[0] === 'attr') { const n = nodes.get(m[1]); if (n) n.attrs[m[2]] = m[3]; }
  }
  const found = [];
  for (const n of nodes.values()) {
    const t = n.attrs[0];
    if (typeof t !== 'string' || !t.startsWith('LUME / ')) continue;
    const x = n.attrs[18], y = n.attrs[19];
    assert(typeof x === 'number' && typeof y === 'number', `${t}: no positioned attrs`);
    // 14px ASCII ink ~= 7.7px/char; height ~= 16px (measured on the 466 DOM).
    const ink = { x, y, w: t.length * 7.7, h: 16 };
    const { far, near } = dist(ink);
    assert(far <= VISIBLE - 2, `${t}: ink reaches r=${far.toFixed(1)} > ${VISIBLE - 2}`);
    assert(x >= CX - SAFE, `${t}: x=${x} outside the inscribed safe square`);
    found.push(`${t}@(${x},${y}) near=${near.toFixed(0)} far=${far.toFixed(0)}`);
  }
  assert(found.length === 5, `expected 5 labels, got ${found.length}`);
  console.log('  ' + found.join('\n  '));
});

// ---- layer 2: browser DOM audit (optional, needs Playwright) ----
let playwright = null;
try {
  if (process.env.PLAYWRIGHT_MODULE) playwright = require(process.env.PLAYWRIGHT_MODULE);
  else playwright = require('playwright');
} catch { playwright = null; }

(async () => {
  if (!playwright) {
    console.log('SKIP browser round audit: Playwright unavailable (set PLAYWRIGHT_MODULE)');
    process.exitCode = failures ? 1 : 0;
    return;
  }
  const { createServer } = require('node:http');
  const siteRoot = path.join(ROOT, 'website');
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const file = path.join(siteRoot, pathname);
      if (!file.startsWith(siteRoot + '/')) throw Error('invalid path');
      const ext = path.extname(file);
      res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' })[ext] || 'application/octet-stream');
      res.end(fs.readFileSync(file));
    } catch { res.statusCode = 404; res.end('Not found'); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await playwright.chromium.launch({ headless: true });
  let totalRisks = 0, visited = 0;
  const watchfaceRisks = [];
  const collect = (page) => page.evaluate(() => {
    const CX = 233, CY = 233, VIS = 233, SAFE = 160.1875;
    const dev = document.querySelector('#device').getBoundingClientRect();
    const scale = dev.width / 466;
    const out = [];
    for (const el of document.querySelectorAll('#device .lume-node')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
      if (el.querySelector('.lume-node')) continue; // container, not content
      const kind = [...el.classList].find(c => /^kind-\d+$/.test(c));
      if (!['kind-1', 'kind-2', 'kind-4'].includes(kind)) continue;
      let r;
      if (kind === 'kind-1' && el.firstChild) {
        const range = document.createRange(); range.selectNodeContents(el);
        r = range.getBoundingClientRect();
      } else r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const box = { x: (r.left - dev.left) / scale, y: (r.top - dev.top) / scale, w: r.width / scale, h: r.height / scale };
      const mx = box.x + box.w / 2, my = box.y + box.h / 2;
      if (mx > CX - 4 && mx < CX + 4 && my > CY - 4 && my < CY + 4) continue; // centre content
      const dx = Math.max(box.x - CX, 0, CX - (box.x + box.w));
      const dy = Math.max(box.y - CY, 0, CY - (box.y + box.h));
      const near = Math.hypot(dx, dy);
      const far = Math.max(...[[box.x, box.y], [box.x + box.w, box.y],
        [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]]
        .map(([x, y]) => Math.hypot(x - CX, y - CY)));
      const level = near > VIS ? 'FULL_CLIP' : (far > VIS + 2 ? 'PARTIAL_CLIP' : '');
      if (!level) continue;
      const text = (el.textContent || '').trim().slice(0, 24);
      out.push({ level, band: near > SAFE ? 'CORNER' : 'EDGE', text,
        box: `${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.w)}x${Math.round(box.h)}`,
        near: Math.round(near), far: Math.round(far) });
    }
    return out;
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await page.goto(`http://127.0.0.1:${server.address().port}/playground/index.html`);
    await page.locator('#device .lume-node').first().waitFor();
    await page.locator('[data-screen-shape="round"]').click();
    const swipe = async () => {
      const b = await page.locator('#device').boundingBox();
      const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
      await page.mouse.move(cx + 120, cy); await page.mouse.down();
      for (let s = 1; s <= 6; s++) await page.mouse.move(cx + 120 - s * 40, cy);
      await page.mouse.up(); await page.waitForTimeout(200);
    };
    for (const name of roundApps.slice().sort()) {
      visited++;
      await page.locator(`[data-app="${name}"]`).click();
      await page.locator('#device .lume-node').first().waitFor();
      await page.waitForTimeout(180);
      let risks = await collect(page);
      const groups = risks.length ? [['', risks]] : [];
      if (name === 'watchface') {
        for (let f = 1; f < 5; f++) {
          await swipe();
          const more = await collect(page);
          if (more.length) groups.push([`face${f}`, more]);
        }
      }
      for (const [prefix, rs] of groups) {
        for (const r of rs) {
          totalRisks++;
          const line = `${name}${prefix ? '/' + prefix : ''} ${r.level}/${r.band} "${r.text}" box=(${r.box}) near=${r.near} far=${r.far}`;
          console.log('RISK ' + line);
          if (name === 'watchface') watchfaceRisks.push(r.text);
        }
      }
    }
    check('browser audit visited all 37 round apps', () => assert(visited === 37, `visited ${visited}`));
    // Accepted: modular bottom card date text needs a layout redesign, not a
    // one-line coordinate change (registered in KNOWN-SIMPLIFICATIONS r231).
    const accepted = new Set(['周六', '11月28日']);
    const unexpected = watchfaceRisks.filter(t => !accepted.has(t));
    check('watchface corner labels/status clear of the arc', () =>
      assert(unexpected.length === 0, `unexpected watchface risks: ${[...new Set(unexpected)].join(' | ')}`));
    console.log(`AUDIT round_apps=${roundApps.length} risks=${totalRisks} watchface=${watchfaceRisks.length} accepted=${watchfaceRisks.length - unexpected.length}`);
  } finally { await browser.close(); server.close(); }
  process.exitCode = failures ? 1 : 0;
})().catch(e => { failures++; console.error('FAIL browser audit: ' + (e.stack || e)); process.exitCode = 1; });
