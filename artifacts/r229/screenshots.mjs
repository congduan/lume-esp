// r229 evidence: native-466 round-mode screenshots at a 466px viewport.
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
const shots = join(here, 'shots');
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
  await page.goto(`http://127.0.0.1:${server.address().port}/playground/index.html`);
  await page.locator('#device .lume-node').first().waitFor();
  for (const name of ['watchface', 'clock_round', 'files']) {
    await page.locator(`[data-app="${name}"]`).click();
    await page.locator('#device .lume-node').first().waitFor();
    await page.waitForTimeout(400);
    const geo = await page.evaluate(() => {
      const wrap = document.querySelector('.device-wrap');
      const device = document.querySelector('#device');
      return { round: wrap.classList.contains('round'), wrap: wrap.clientWidth, device: getComputedStyle(device).width, transform: getComputedStyle(device).transform, error: document.querySelector('#error').hidden ? '' : document.querySelector('#error').textContent };
    });
    if (!geo.round || geo.wrap !== 466 || geo.device !== '466px' || geo.transform !== 'matrix(1, 0, 0, 1, 0, 0)' || geo.error) throw Error(name + ': ' + JSON.stringify(geo));
    const file = join(shots, name + '-round-466.png');
    await page.locator('.device-wrap').screenshot({ path: file });
    console.log('PASS shot ' + name + ' ' + JSON.stringify(geo) + ' -> ' + file);
    if (name === 'clock_round') {
      await page.locator('#safe-area-toggle').click();
      await page.waitForTimeout(200);
      const guide = join(shots, 'clock-round-safe-466.png');
      await page.locator('.device-wrap').screenshot({ path: guide });
      const inset = await page.locator('.device-wrap').evaluate(el => getComputedStyle(el, '::after').inset);
      console.log('PASS shot safe-guide inset=' + inset + ' -> ' + guide);
      await page.locator('#safe-area-toggle').click();
    }
  }
} finally { await browser.close(); server.close(); }
