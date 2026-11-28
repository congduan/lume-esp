// r229 evidence: read the *current* round-mode geometry before editing page.js.
import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
const require = createRequire(import.meta.url);
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const siteRoot = join(root, 'website');
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = join(siteRoot, pathname);
    if (!file.startsWith(siteRoot + '/')) throw Error('invalid path');
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end('Not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await playwright.chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/playground/index.html`);
  await page.locator('#device .lume-node').first().waitFor();
  const read = () => page.evaluate(() => {
    const wrap = document.querySelector('.device-wrap');
    const device = document.querySelector('#device');
    const s = getComputedStyle(device);
    return {
      shape: wrap.classList.contains('round') ? 'round' : 'square',
      wrapWidth: wrap.clientWidth,
      deviceWidth: s.width, deviceHeight: s.height,
      transform: s.transform,
      safeInset: getComputedStyle(wrap, '::after').inset,
      appCount: Object.keys(window.LUME_SOURCES).length,
    };
  });
  console.log('SQUARE ' + JSON.stringify(await read()));
  await page.locator('[data-app="watchface"]').click();
  console.log('ROUND  ' + JSON.stringify(await read()));
} finally { await browser.close(); server.close(); }
