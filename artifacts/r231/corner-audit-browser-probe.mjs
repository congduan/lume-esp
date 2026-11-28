// r231 prototype: browser-DOM corner safety audit over native-466 round apps.
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
  const names = await page.evaluate(() => [...document.querySelectorAll('#app-list [data-app]')].map(b => b.dataset.app));
  const round = await page.evaluate(() => [...document.querySelectorAll('#app-list [data-app]')].filter(b => {
    const t = b.textContent || ''; return t.length >= 0;
  }).map(b => b.dataset.app));
  // shape from catalog file instead
  const fs = await import('node:fs');
  const pageSrc = fs.readFileSync(join(siteRoot, 'playground/page.js'), 'utf8');
  const block = pageSrc.match(/const examples = \[([\s\S]*?)\n  \];/);
  const roundNames = [];
  for (const line of block[1].split('\n')) {
    const m = line.match(/^\s*\['([^']+)'.*'round'\],?$/);
    if (m) roundNames.push(m[1]);
  }
  let total = 0;
  for (const name of roundNames.sort()) {
    await page.locator(`[data-app="${name}"]`).click();
    await page.locator('#device .lume-node').first().waitFor();
    await page.waitForTimeout(180);
    const risks = await page.evaluate(() => {
      const CX = 233, CY = 233, VIS = 233;
      const dev = document.querySelector('#device').getBoundingClientRect();
      const scale = dev.width / 466;
      const out = [];
      for (const el of document.querySelectorAll('#device .lume-node')) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
        if (el.querySelector('.lume-node')) continue; // container, not a leaf
        let r;
        if (el.classList.contains('kind-1') && el.firstChild) {
          const range = document.createRange(); range.selectNodeContents(el);
          r = range.getBoundingClientRect();
        } else r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const box = { x: (r.left - dev.left) / scale, y: (r.top - dev.top) / scale, w: r.width / scale, h: r.height / scale };
        if (box.w >= 460 && box.h >= 460) continue;
        const dx = Math.max(box.x - CX, 0, CX - (box.x + box.w));
        const dy = Math.max(box.y - CY, 0, CY - (box.y + box.h));
        const near = Math.hypot(dx, dy);
        const far = Math.max(...[[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]].map(([x, y]) => Math.hypot(x - CX, y - CY)));
        let level = '';
        if (near > VIS) level = 'FULL_CLIP';
        else if (far > VIS) level = 'PARTIAL_CLIP';
        if (!level) continue;
        const txt = (el.textContent || '').trim().slice(0, 24);
        out.push(`${level} #${el.dataset.nodeId} ${[...el.classList].filter(c => c.startsWith('kind-')).join('')} "${txt}" box=(${Math.round(box.x)},${Math.round(box.y)},${Math.round(box.w)}x${Math.round(box.h)}) near=${Math.round(near)} far=${Math.round(far)}`);
      }
      return out;
    });
    if (risks.length) {
      total += risks.length;
      console.log(`${name}: ${risks.length} risk(s)`);
      for (const r of risks.slice(0, 20)) console.log('  ' + r);
      if (risks.length > 20) console.log(`  ... +${risks.length - 20} more`);
    }
  }
  console.log(`TOTAL risks=${total} across ${roundNames.length} round apps`);
} finally { await browser.close(); server.close(); }
