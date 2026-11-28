// r230 evidence: native-466 round-mode screenshots for the migrated apps.
// At least 4 of the 11 (priority: launcher_grid, weather, music_player, control_center).
import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname } from 'node:path';
const require = createRequire(import.meta.url);
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const siteRoot = join(root, 'website');
const shots = join(here, 'shots');
await mkdir(shots, { recursive: true });
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
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.address().port}/playground/index.html`);
  await page.locator('#device .lume-node').first().waitFor();
  // Force native-466 round mode before selecting the first target app.
  await page.locator('[data-screen-shape="round"]').click();
  await page.waitForTimeout(200);
  const targets = ['launcher_grid', 'weather', 'music_player', 'control_center', 'files', 'img_view'];
  for (const name of targets) {
    await page.locator(`[data-app="${name}"]`).click();
    await page.locator('#device .lume-node').first().waitFor();
    await page.waitForTimeout(400);
    const geo = await page.evaluate(() => {
      const wrap = document.querySelector('.device-wrap');
      const device = document.querySelector('#device');
      return { round: wrap.classList.contains('round'), wrap: wrap.clientWidth,
        device: getComputedStyle(device).width, transform: getComputedStyle(device).transform,
        error: document.querySelector('#error').hidden ? '' : document.querySelector('#error').textContent };
    });
    if (!geo.round || geo.wrap !== 466 || geo.device !== '466px' ||
        geo.transform !== 'matrix(1, 0, 0, 1, 0, 0)' || geo.error) throw Error(name + ': ' + JSON.stringify(geo));
    const file = join(shots, name + '-round-466.png');
    await page.locator('.device-wrap').screenshot({ path: file });
    console.log(`PASS shot ${name} round=true wrap=466 device=466px transform=${geo.transform} -> ${file}`);
  }
  if (errors.length) throw Error('pageerror: ' + errors.join(' | '));
} finally { await browser.close(); server.close(); }
