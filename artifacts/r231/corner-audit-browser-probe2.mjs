// r231 prototype v2: browser-DOM corner safety audit (content nodes only).
import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
const require = createRequire(import.meta.url);
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const siteRoot = join(root, 'website');
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = join(siteRoot, pathname);
    if (!file.startsWith(siteRoot + '/')) throw Error('invalid path');
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' })[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end('Not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await playwright.chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/playground/index.html`);
  await page.locator('#device .lume-node').first().waitFor();
  await page.locator('[data-screen-shape="round"]').click();
  const fs = await import('node:fs');
  const pageSrc = fs.readFileSync(join(siteRoot, 'playground/page.js'), 'utf8');
  const block = pageSrc.match(/const examples = \[([\s\S]*?)\n  \];/);
  const roundNames = [];
  for (const line of block[1].split('\n')) {
    const m = line.match(/^\s*\['([^']+)'.*'round'\],?$/);
    if (m) roundNames.push(m[1]);
  }
  const collect = () => page.evaluate(() => {
    const CX = 233, CY = 233, VIS = 233, SAFE = 160.1875;
    const dev = document.querySelector('#device').getBoundingClientRect();
    const scale = dev.width / 466;
    const out = [];
    for (const el of document.querySelectorAll('#device .lume-node')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
      if (el.querySelector('.lume-node')) continue;
      const kind = [...el.classList].find(c => /^kind-\d+$/.test(c));
      if (!['kind-1', 'kind-2', 'kind-4'].includes(kind)) continue;
      let r;
      if (kind === 'kind-1' && el.firstChild) {
        const range = document.createRange(); range.selectNodeContents(el);
        r = range.getBoundingClientRect();
      } else r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const box = { x: (r.left - dev.left) / scale, y: (r.top - dev.top) / scale, w: r.width / scale, h: r.height / scale };
      const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
      if (cx > CX - 4 && cx < CX + 4 && cy > CY - 4 && cy < CY + 4) continue; // centre content
      const dx = Math.max(box.x - CX, 0, CX - (box.x + box.w));
      const dy = Math.max(box.y - CY, 0, CY - (box.y + box.h));
      const near = Math.hypot(dx, dy);
      const far = Math.max(...[[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]].map(([x, y]) => Math.hypot(x - CX, y - CY)));
      let level = '';
      if (near > VIS) level = 'FULL_CLIP';
      else if (far > VIS + 2) level = 'PARTIAL_CLIP';
      if (!level) continue;
      const txt = (el.textContent || '').trim().slice(0, 24);
      const band = near > SAFE ? 'CORNER' : 'EDGE';
      out.push(`${level}/${band} #${el.dataset.nodeId} ${kind} "${txt}" box=(${Math.round(box.x)},${Math.round(box.y)},${Math.round(box.w)}x${Math.round(box.h)}) near=${Math.round(near)} far=${Math.round(far)}`);
    }
    return out;
  });
  let total = 0;
  const swiper = async () => {
    const box = await page.locator('#device').boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.mouse.move(cx + 120, cy); await page.mouse.down();
    for (let s = 1; s <= 6; s++) await page.mouse.move(cx + 120 - s * 40, cy);
    await page.mouse.up(); await page.waitForTimeout(220);
  };
  for (const name of roundNames.sort()) {
    await page.locator(`[data-app="${name}"]`).click();
    await page.locator('#device .lume-node').first().waitFor();
    await page.waitForTimeout(180);
    let risks = await collect();
    const groups = [];
    if (risks.length) groups.push(['', risks]);
    if (name === 'watchface') {
      for (let f = 1; f < 5; f++) {
        await swiper();
        const r = await collect();
        if (r.length) groups.push([`face${f}`, r]);
      }
    }
    if (groups.length) {
      const n = groups.reduce((s, g) => s + g[1].length, 0);
      total += n;
      console.log(`${name}: ${n} risk(s)`);
      for (const [label, rs] of groups) {
        for (const r of rs) console.log(`  ${label ? label + ' ' : ''}${r}`);
      }
    }
  }
  console.log(`TOTAL risks=${total} across ${roundNames.length} round apps`);
} finally { await browser.close(); server.close(); }
