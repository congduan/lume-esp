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
  await check('round app auto-switches frame, manual override holds on restart, and safe-area guide toggles cleanly', async () => {
    await page.locator('[data-app="watchface"]').click();
    const isRound = await page.locator('.device-wrap').evaluate(el => el.classList.contains('round'));
    const roundPressed = await page.locator('[data-screen-shape="round"]').getAttribute('aria-pressed');
    const roundRadius = await page.locator('.device-wrap').evaluate(el => getComputedStyle(el).borderRadius);
    if (!isRound || roundPressed !== 'true' || roundRadius !== '50%') {
      throw Error(`watchface did not auto-switch to round: class=${isRound} pressed=${roundPressed} radius=${roundRadius}`);
    }
    if (await page.locator('#error').isVisible()) throw Error(await page.locator('#error').textContent());
    // Safe-area guide toggle is visible in round mode, off by default, and non-blocking when on.
    const safeBtn = page.locator('#safe-area-toggle');
    if (await safeBtn.isHidden()) throw Error('safe-area toggle hidden in round mode');
    if (await safeBtn.getAttribute('aria-pressed') !== 'false') throw Error('safe-area toggle should default off');
    await safeBtn.click();
    const safeStyle = await page.locator('.device-wrap').evaluate(el => {
      const s = getComputedStyle(el, '::after');
      return { hasClass: el.classList.contains('show-safe'), opacity: parseFloat(s.opacity), pe: s.pointerEvents };
    });
    if (!safeStyle.hasClass || !(safeStyle.opacity > 0 && safeStyle.opacity <= 0.15) || safeStyle.pe !== 'none') {
      throw Error('unexpected safe-area overlay style: ' + JSON.stringify(safeStyle));
    }
    await safeBtn.click();
    // Manual override to square survives restart, then switching apps auto-aligns again.
    await page.locator('[data-screen-shape="square"]').click();
    if (await page.locator('.device-wrap').evaluate(el => el.classList.contains('round'))) {
      throw Error('manual switch to square failed');
    }
    await page.locator('#restart').click();
    if (await page.locator('.device-wrap').evaluate(el => el.classList.contains('round'))) {
      throw Error('restart clobbered manual square override');
    }
    await page.locator('[data-app="clock_round"]').click();
    if (!(await page.locator('.device-wrap').evaluate(el => el.classList.contains('round')))) {
      throw Error('clock_round did not auto-switch back to round');
    }
    await page.locator('[data-app="counter"]').click();
    if (await page.locator('.device-wrap').evaluate(el => el.classList.contains('round'))) {
      throw Error('counter did not auto-switch back to square');
    }
    if (errors.length || await page.locator('#error').isVisible()) throw Error(errors.join('\n') || await page.locator('#error').textContent());
    console.log('  watchface -> round (50%), safe-area opacity=' + safeStyle.opacity + ', manual square + restart held, clock_round -> round, counter -> square');
  });
  await check('runtime.js honors custom 466x466 __lumeScreen option', async () => {
    const probed = await page.evaluate(() => {
      const seen = [];
      const sess = window.LumePlaygroundSession(
        "Text({ text: 'SCREEN:' + __lumeScreen.w + 'x' + __lumeScreen.h });",
        { screen: { w: 466, h: 466 }, onMessage: m => seen.push(m) }
      );
      const out = { screen: sess.screen, texts: seen.filter(m => m[0] === 'attr' && m[2] === 0).map(m => m[3]) };
      sess.destroy();
      return out;
    });
    if (probed.screen.w !== 466 || probed.screen.h !== 466 || !probed.texts.includes('SCREEN:466x466')) {
      throw Error('466x466 __lumeScreen injection failed: ' + JSON.stringify(probed));
    }
    console.log('  __lumeScreen injected: ' + probed.texts.join(', '));
  });
  await check('round mode runs the live app at native 466x466 (no 466/480 mapping)', async () => {
    // Intercept the *page's* own session creation (not a detached probe) so the
    // assertion covers what page.js actually passes for the selected app.
    await page.evaluate(() => {
      const original = window.LumePlaygroundSession;
      window.__lumeOriginalSession = original;
      window.__lumeCaptured = null;
      window.LumePlaygroundSession = function (script, options) {
        const sess = original(script, options);
        window.__lumeCaptured = {
          screen: options?.screen ? { ...options.screen } : null,
          sessionScreen: sess.screen ? { ...sess.screen } : null,
        };
        return sess;
      };
    });
    try {
      await page.locator('[data-app="watchface"]').click();
      const probe = await page.evaluate(() => {
        const captured = window.__lumeCaptured;
        if (!captured) return { screen: null };
        const texts = [];
        const p = window.__lumeOriginalSession(
          "Text({ text: 'LIVE:' + __lumeScreen.w + 'x' + __lumeScreen.h });",
          { screen: captured.screen, onMessage: m => { if (m[0] === 'attr' && m[2] === 0) texts.push(m[3]); } }
        );
        p.destroy();
        const device = document.querySelector('#device');
        const s = getComputedStyle(device);
        return { ...captured, texts, deviceWidth: s.width, deviceHeight: s.height, transform: s.transform };
      });
      if (!probe.screen) throw Error('page.js did not create an app session: ' + JSON.stringify(probe));
      const same = (a, w, h) => a && a.w === w && a.h === h;
      if (!same(probe.screen, 466, 466)) throw Error('page.js passed non-native screen: ' + JSON.stringify(probe.screen));
      if (!same(probe.sessionScreen, 466, 466)) throw Error('live session screen is not 466x466: ' + JSON.stringify(probe.sessionScreen));
      if (!probe.texts.includes('LIVE:466x466')) throw Error('__lumeScreen was not injected as 466: ' + JSON.stringify(probe.texts));
      if (probe.deviceWidth !== '466px' || probe.deviceHeight !== '466px' || probe.transform !== 'matrix(1, 0, 0, 1, 0, 0)') {
        throw Error('round viewport still maps 480 into 466: ' + JSON.stringify(probe));
      }
      console.log('  live session screen=' + JSON.stringify(probe.screen) + ', __lumeScreen=' + probe.texts.join(', ') + ', device=466px transform=' + probe.transform);
    } finally { await page.evaluate(() => { window.LumePlaygroundSession = window.__lumeOriginalSession; }); }
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
  await check('voice_assistant degrades to DEMO without audio/network and is tappable', async () => {
    await page.locator('[data-app="voice_assistant"]').click();
    await page.locator('#device').getByText('MODE DEMO', { exact: false }).first().waitFor();
    if (await page.locator('#error').isVisible()) throw Error(await page.locator('#error').textContent());
    const box = await page.locator('.device-wrap').boundingBox();
    if (!box) throw Error('missing device');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.locator('#device').getByText('LISTEN', { exact: true }).waitFor({ timeout: 5000 });
    console.log('  DEMO badge + tap -> LISTEN');
    if (errors.length || await page.locator('#error').isVisible()) throw Error(errors.join('\n'));
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
  await check('abc123 clears placeholder and redraws on five taps', async () => {
    await page.locator('[data-app="abc123"]').click();
    const glyph = page.locator('#device .kind-4');
    await glyph.locator('canvas').waitFor();
    const background = await glyph.evaluate(el => getComputedStyle(el).backgroundColor);
    if (background === 'rgb(119, 119, 119)') throw Error('gray placeholder remains');
    if (await glyph.evaluate(el => el.classList.contains('image-placeholder'))) throw Error('placeholder class remains');
    const target = await glyph.locator('canvas').evaluate(el => el.closest('[data-node-id]')?.dataset.nodeId);
    if (!target) throw Error('glyph canvas does not reach a node');
    const box = await page.locator('.device-wrap').boundingBox();
    if (!box) throw Error('missing device');
    let bitmap = await glyph.locator('canvas').evaluate(el => el.toDataURL());
    for (const [letter, word] of [['B','Ball'],['C','Cat'],['D','Dog'],['E','Egg'],['F','Fish']]) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height * 200 / 480);
      const hint = `${letter} is for ${word}`;
      await page.locator('#device').getByText(hint, { exact: true }).waitFor();
      await page.waitForFunction(previous => {
        const canvas = document.querySelector('#device .kind-4 canvas');
        return canvas && canvas.toDataURL() !== previous;
      }, bitmap);
      bitmap = await glyph.locator('canvas').evaluate(el => el.toDataURL());
      console.log(`  ${hint}`);
    }
    console.log(`  glyph background: ${background}; canvas node: ${target}`);
    if (errors.length || await page.locator('#error').isVisible()) throw Error(errors.join('\n') || await page.locator('#error').textContent());
  });
  await check('abc123 mobile touchscreen advances card', async () => {
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    try {
      await mobile.goto(pageUrl);
      await mobile.locator('[data-app="abc123"]').click();
      await mobile.locator('.device-wrap').scrollIntoViewIfNeeded();
      await mobile.locator('#device .kind-4 canvas').waitFor();
      const box = await mobile.locator('.device-wrap').boundingBox();
      if (!box) throw Error('missing mobile device');
      await mobile.touchscreen.tap(box.x + box.width / 2, box.y + box.height * 200 / 480);
      await mobile.locator('#device').getByText('B is for Ball', { exact: true }).waitFor();
      console.log('  mobile tap: B is for Ball');
    } finally { await mobile.close(); }
  });
  await check('all examples load without runtime errors', async () => {
    const names = await page.locator('.app-item').evaluateAll(items => items.map(item => item.dataset.app));
    const expected = await page.evaluate(() => Object.keys(window.LUME_SOURCES).length);
    if (names.length !== expected) throw Error(`expected ${expected} examples, got ${names.length}`);
    for (const name of names) {
      await page.locator(`[data-app="${name}"]`).click();
      const count = await page.locator('#device .lume-node').count();
      if (!count) throw Error(`${name}: empty screen`);
      if (await page.locator('#error').isVisible()) throw Error(`${name}: ${await page.locator('#error').textContent()}`);
      console.log(`  ${name}: ${count} nodes`);
    }
    if (errors.length) throw Error(errors.join('\n'));
  });
  // r229: keep the auto-shape 74/74 guard above intact; add an independent
  // native-466 pass so both 480 (auto) and 466 (forced round) are covered.
  await check('all 74 examples load at native 466 without runtime errors', async () => {
    const names = await page.locator('.app-item').evaluateAll(items => items.map(item => item.dataset.app));
    const expected = await page.evaluate(() => Object.keys(window.LUME_SOURCES).length);
    if (names.length !== expected) throw Error(`expected ${expected} examples, got ${names.length}`);
    for (const name of names) {
      await page.locator(`[data-app="${name}"]`).click();
      await page.locator('[data-screen-shape="round"]').click();
      if (!(await page.locator('.device-wrap').evaluate(el => el.classList.contains('round')))) throw Error(`${name}: round mode not active`);
      const count = await page.locator('#device .lume-node').count();
      if (!count) throw Error(`${name}: empty screen at native 466`);
      if (await page.locator('#error').isVisible()) throw Error(`${name}: ${await page.locator('#error').textContent()}`);
      console.log(`  ${name}: ${count} nodes (466)`);
    }
    if (errors.length) throw Error(errors.join('\n'));
  });
} finally { await browser.close(); server.close(); }
if (failures) process.exitCode = 1;
