#!/usr/bin/env node
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
    const body = await readFile(file);
    res.setHeader('Content-Type', ({'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm'})[extname(file)] || 'application/octet-stream');
    res.end(body);
  } catch { res.statusCode = 404; res.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const pageUrl = `http://127.0.0.1:${server.address().port}/playground/index.html`;
const browser = await playwright.chromium.launch({ headless: true });
let failures = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack || String(error)));
  async function check(name, fn) {
    try { await fn(); console.log('PASS ' + name); }
    catch (error) { failures++; console.error('FAIL ' + name + ': ' + (error.stack || error)); }
  }
  await check('page loads without JavaScript errors', async () => {
    await page.goto(pageUrl);
    await page.locator('#device .lume-node').first().waitFor();
    if (errors.length) throw Error(errors.join('\n'));
    if (await page.locator('#error').isVisible()) throw Error(await page.locator('#error').textContent());
  });
  for (const [name, label] of [['counter','Counter'],['games_snake','Snake'],['games_2048','2048']]) {
    await check(`${name} has nonempty screen DOM`, async () => {
      await page.locator(`[data-app="${name}"]`).click();
      const count = await page.locator('#device .lume-node').count();
      if (count <= 0) throw Error(`DOM nodes=${count}`);
      if (await page.locator('#error').isVisible()) throw Error(await page.locator('#error').textContent());
      if (errors.length) throw Error(errors.join('\n'));
      console.log(`  ${label}: ${count} nodes`);
    });
  }
  await check('rounded square device frame', async () => {
    const radius = await page.locator('.device-wrap').evaluate(el => getComputedStyle(el).borderRadius);
    console.log(`  border-radius: ${radius}`);
    if (radius === '50%' || radius === '0px') throw Error(`unexpected border radius: ${radius}`);
  });
  await check('editor compiles default and changed source, then reports syntax errors', async () => {
    await page.locator('#editor-tab').click();
    await page.locator('#run').click();
    await page.locator('#device').getByText('TOTAL TAPS').waitFor();
    const source = await page.locator('#source-code').inputValue();
    await page.locator('#source-code').fill(source.replace('TOTAL TAPS', 'EDITED TAPS'));
    await page.locator('#run').click();
    await page.locator('#device').getByText('EDITED TAPS').waitFor();
    await page.locator('#source-code').fill('function {');
    await page.locator('#run').click();
    await page.locator('#error').waitFor({ state: 'visible' });
    if (!/error|unexpected/i.test(await page.locator('#error').textContent())) throw Error('no compile error');
    if (errors.length) throw Error(errors.join('\n'));
  });
  await page.locator('#examples-tab').click();
  await check('hash restores editor source and share copies reloadable URL', async () => {
    const sample = "View({style:{width:480,height:480,background:'#111111'}},[Text({text:'Shared test'})]);";
    await page.goto(pageUrl + '#code0=' + encodeURIComponent(sample));
    await page.reload();
    await page.locator('#editor-tab[aria-selected=true]').waitFor();
    await page.locator('#device').getByText('Shared test').waitFor();
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.locator('#share').click();
    await page.locator('#share-status').getByText('Link copied!').waitFor();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    if (!copied.includes('#code=')) throw Error('compressed hash missing');
    if (copied !== page.url()) throw Error('clipboard URL mismatch');
    await page.reload();
    await page.locator('#editor-tab[aria-selected=true]').waitFor();
    await page.locator('#device').getByText('Shared test').waitFor();
    console.log(`  share hash: ${new URL(copied).hash.length} chars`);
    if (errors.length || await page.locator('#error').isVisible()) throw Error(errors.join('\n') || await page.locator('#error').textContent());
  });
  await check('oversized source keeps existing share hash', async () => {
    const before = await page.evaluate(() => location.hash);
    let seed = 1;
    const large = Array.from({length: 20000}, () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return String.fromCharCode(33 + ((seed >>> 0) % 90)); }).join('');
    await page.locator('#source-code').fill(large);
    await page.locator('#share').click();
    await page.locator('#share-status').getByText('Source too large').waitFor();
    if (await page.evaluate(() => location.hash) !== before) throw Error('oversized hash was written');
  });
  await page.locator('#examples-tab').click();
  await check('counter button updates count without errors', async () => {
    await page.locator('[data-app="counter"]').click();
    await page.getByText('Add one', { exact: true }).click();
    await page.locator('#device').getByText('1', { exact: true }).waitFor();
    if (errors.length || await page.locator('#error').isVisible()) throw Error(errors.join('\n') || await page.locator('#error').textContent());
  });
  await check('snake screen tap and swipe do not throw', async () => {
    await page.locator('[data-app="games_snake"]').click();
    const box = await page.locator('.device-wrap').boundingBox();
    if (!box) throw Error('missing device');
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.click(x, y);
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y - 70, { steps: 5 }); await page.mouse.up();
    if (errors.length || await page.locator('#error').isVisible()) throw Error(errors.join('\n') || await page.locator('#error').textContent());
  });
  await check('all examples load without runtime errors', async () => {
    const names = await page.locator('.app-item').evaluateAll(items => items.map(item => item.dataset.app));
    if (names.length !== 25) throw Error(`expected 25 examples, got ${names.length}`);
    for (const name of names) {
      await page.locator(`[data-app="${name}"]`).click();
      const count = await page.locator('#device .lume-node').count();
      if (!count) throw Error(`${name}: empty screen`);
      if (await page.locator('#error').isVisible()) throw Error(`${name}: ${await page.locator('#error').textContent()}`);
      console.log(`  ${name}: ${count} nodes`);
    }
    if (errors.length) throw Error(errors.join('\n'));
  });
} finally { await browser.close(); server.close(); }
if (failures) process.exitCode = 1;
