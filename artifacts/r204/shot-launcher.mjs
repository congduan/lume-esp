#!/usr/bin/env node
// r204 launcher round-screen capture. Usage:
//   NODE_PATH=/home/ubuntu/.npm/_npx/705bc6b22212b352/node_modules \
//     node artifacts/r204/shot-launcher.mjs before|after
// The launcher example is not in the playground manifest, so inject its source
// and esbuild bundle into the served sources.js without touching the site tree.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const require = createRequire(new URL('../../tools/lume/package.json', import.meta.url));
const { buildSync } = require('esbuild');
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const siteRoot = '/tmp/lume-r204-wt/website';
const outDir = '/tmp/lume-r204-wt/artifacts/r204';
const appPath = '/tmp/lume-r204-wt/examples/launcher/app.js';
const phase = process.argv[2] || 'before';
if (phase !== 'before' && phase !== 'after') throw Error('phase must be before|after');

const source = await readFile(appPath, 'utf8');
const code = buildSync({ entryPoints: [appPath], bundle: true, format: 'iife',
  platform: 'neutral', target: 'es2020', charset: 'utf8', write: false }).outputFiles[0].text;
const injection = '\nwindow.LUME_SOURCES.launcher = ' + JSON.stringify(source) +
  ';\nwindow.LUME_APPS.launcher = ' + JSON.stringify(code) + ';\n';

const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = join(siteRoot, pathname);
    if (!file.startsWith(siteRoot + '/')) throw Error('invalid path');
    let body = await readFile(file);
    if (pathname === '/playground/sources.js') body = Buffer.concat([body, Buffer.from(injection)]);
    res.setHeader('Content-Type', ({'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.png':'image/png'})[extname(file)] || 'application/octet-stream');
    res.end(body);
  } catch { res.statusCode = 404; res.end('Not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/playground/index.html`;
const browser = await playwright.chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => errors.push(e.stack || String(e)));
await page.goto(url);
await page.locator('#device .lume-node').first().waitFor();
await page.locator('[data-screen-shape="round"]').click();
await page.locator('[data-app="launcher"]').click();
await page.waitForTimeout(600);
const visible = await page.locator('#error').isVisible();
const errText = visible ? await page.locator('#error').textContent() : '';
await page.locator('.device-wrap').screenshot({ path: join(outDir, `launcher-${phase}.png`) });
if (errors.length || errText) console.log(`WARN launcher-${phase}: ${errText || errors.join(' | ').slice(0, 300)}`);
else console.log(`PASS launcher-${phase}.png`);
await browser.close();
server.close();
