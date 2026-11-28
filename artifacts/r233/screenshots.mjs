import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const siteRoot = join(root, 'website');
const outDir = join(root, 'artifacts/r233/shots');

const tag = process.argv[2] || 'before';
const filter = process.argv.slice(3);

const pageSrc = await readFile(join(siteRoot, 'playground/page.js'), 'utf8');
const block = pageSrc.match(/const examples = \[([\s\S]*?)\n  \];/);
const allSquare = [...block[1].matchAll(/^\s*\['([^']+)'.*'square'\],?$/gm)].map(m => m[1]);
const targets = filter.length ? filter : allSquare;

await mkdir(outDir, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = join(siteRoot, pathname);
    if (!file.startsWith(siteRoot + '/')) throw Error('bad');
    const ext = extname(file);
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' })[ext] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end('Not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await playwright.chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/playground/index.html`);
  await page.locator('#device .lume-node').first().waitFor();
  for (const name of targets) {
    await page.locator(`[data-app="${name}"]`).click();
    await page.locator('#device .lume-node').first().waitFor();
    await page.waitForTimeout(220);
    const isRound = await page.locator('.device-wrap').evaluate(el => el.classList.contains('round'));
    if (isRound) throw new Error(`${name} switched to round mode!`);
    const outPath = join(outDir, `${name}-${tag}.png`);
    await page.locator('.device-wrap').screenshot({ path: outPath });
    console.log(`SHOT ${name} -> ${name}-${tag}.png`);
  }
} finally {
  await browser.close();
  server.close();
}
