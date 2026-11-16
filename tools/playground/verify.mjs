#!/usr/bin/env node
import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const pageUrl = pathToFileURL(join(root, 'website/playground/index.html')).href;
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
  await check('all 16 examples load without runtime errors', async () => {
    const names = await page.locator('.app-item').evaluateAll(items => items.map(item => item.dataset.app));
    if (names.length !== 16) throw Error(`expected 16 examples, got ${names.length}`);
    for (const name of names) {
      await page.locator(`[data-app="${name}"]`).click();
      const count = await page.locator('#device .lume-node').count();
      if (!count) throw Error(`${name}: empty screen`);
      if (await page.locator('#error').isVisible()) throw Error(`${name}: ${await page.locator('#error').textContent()}`);
      console.log(`  ${name}: ${count} nodes`);
    }
    if (errors.length) throw Error(errors.join('\n'));
  });
} finally { await browser.close(); }
if (failures) process.exitCode = 1;
