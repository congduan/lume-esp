#!/usr/bin/env node
// Browser verification. Set PLAYWRIGHT_MODULE to an installed Playwright path.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '../..');
const shots = path.join(root, 'artifacts/simulator');
fs.mkdirSync(shots, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function server(app, port) {
  const child = spawn(process.execPath, ['tools/simulator/sim.js', `examples/${app}/app.js`],
    { cwd: root, env: { ...process.env, LUME_SIM_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', b => output += b);
  child.stderr.on('data', b => output += b);
  for (let n = 0; n < 50; n++) {
    if (output.includes('Host Simulator http://')) return child;
    if (child.exitCode !== null) throw Error(output);
    await sleep(100);
  }
  throw Error('server timeout: ' + output);
}
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 600, height: 640 }, deviceScaleFactor: 1 });
    // Unit cases use the real DOM and canvas, independent of any example app.
    await page.goto('about:blank');
    await page.addScriptTag({ path: path.join(__dirname, 'renderer.js') });
    const unit = await page.evaluate(() => {
      const host = document.createElement('div'); document.body.append(host);
      const r = new LumeRenderer(host);
      r.replay([['create',1,0,0,0,0],['create',2,1,1,0,0],['attr',2,0,'hello']]);
      const create = host.querySelector('[data-node-id="1"] [data-node-id="2"]').textContent === 'hello';
      r.replay([['attr',1,7,1],['attr',1,8,3],['attr',1,9,2],['attr',1,10,8],['attr',1,16,100],['attr',1,14,0xabcdef]]);
      const style = r.nodes.get(1).style;
      const attr = style.flexDirection === 'column' && style.justifyContent === 'space-between' && style.alignItems === 'center' && style.padding === '8px' && style.width === '100%' && style.borderColor === 'rgb(171, 205, 239)';
      r.apply(['animate',1,15,255,128,300,2]);
      const animate = Math.abs(Number(style.opacity) - 128/255) < .001 && style.transition.includes('300ms ease-out');
      r.apply(['create',3,3,1,8,8]); r.apply(['draw',3,1,0,0,8,8,0xff0000,1]);
      const canvas = [...r.nodes.get(3).getContext('2d').getImageData(2,2,1,1).data].join(',') === '255,0,0,255';
      r.apply(['remove',1]);
      const remove = host.children.length === 0 && r.nodes.size === 0;
      return { create, attr, remove, animate, canvas };
    });
    for (const [name, okay] of Object.entries(unit)) { assert.ok(okay, name); console.log('PASS renderer ' + name); }
    for (const [app, port, expected] of [
      ['counter', 8766, 'taps: 0'], ['files', 8767, 'demo.txt'],
      ['watch_launcher', 8768, 'battery 80%'], ['shell_demo', 8769, 'Shell demo'],
    ]) {
      const child = await server(app, port);
      try {
        await page.goto(`http://localhost:${port}/`);
        await page.locator('#device [data-node-id]').first().waitFor();
        await page.getByText(expected, { exact: false }).first().waitFor({ timeout: 5000 });
        const count = await page.locator('#device [data-node-id]').count();
        assert.ok(count >= (app === 'watch_launcher' ? 40 : 6), app + ' nodes');
        if (app === 'counter') {
          await page.getByText('Count', { exact: true }).click();
          await page.getByText('taps: 1', { exact: true }).waitFor();
        }
        if (app === 'watch_launcher') {
          assert.ok(await page.locator('#device canvas').count() >= 12, 'watch canvas icons');
          assert.ok(await page.getByText('Lume', { exact: true }).count(), 'Launcher title');
        }
        if (app === 'shell_demo') {
          assert.ok(await page.getByText('page 1 / 3', { exact: true }).count(), 'StatusBar and page rendered');
          const edges = await (await fetch(`http://localhost:${port}/messages`)).json();
          const left = edges.messages.find(m => m[0] === 'gesture')[1];
          const inject = input => fetch(`http://localhost:${port}/input`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
          });
          await inject({ type: 'gesture', id: left, kind: 0, x: 10, y: 200, t: 0 });
          await inject({ type: 'gesture', id: left, kind: 1, x: 85, y: 200, t: 50 });
          await page.waitForTimeout(250);
          assert.ok(await page.locator('#device canvas').count() >= 2, 'EdgeNavigation indicator canvas');
          await page.locator('#device').screenshot({ path: path.join(shots, 'EdgeNavigation.png') });
          await inject({ type: 'gesture', id: left, kind: 2, x: 85, y: 200, t: 100 });
          await page.getByText('page 3 / 3', { exact: true }).waitFor();
          console.log('PASS shell_demo injected edge swipe advances page screenshot=artifacts/simulator/EdgeNavigation.png');
        }
        await page.locator('#device').screenshot({ path: path.join(shots, app + '.png') });
        if (app === 'shell_demo') await page.locator('#device').screenshot({ path: path.join(shots, 'StatusBar.png') });
        if (app === 'watch_launcher') await page.locator('#device').screenshot({ path: path.join(shots, 'Launcher.png') });
        console.log(`PASS ${app} DOM nodes=${count} expected=${JSON.stringify(expected)} screenshot=artifacts/simulator/${app}.png`);
      } finally { child.kill('SIGTERM'); }
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
