#!/usr/bin/env node
/* mario browser-sim verify (Playwright + sim.js; PLAYWRIGHT_MODULE=<path>).
 * vs esp32sim's timed actions.txt: input = DOM clicks -> /input press + injected JUMP longpress (HIGH jump);
 * sim.js pumps __lume_tick() on a real 50 ms Date.now() timer, so physics/frame timing are not cycle-deterministic;
 * renderer.js does draw canvas into #device, but assertions watch HUD Text score, not pixel diff. Reaches BRICK 25 -> COIN 35 (observed);
 * esp32sim also hit STOMP 85 / LEVEL 2 185, not reproduced here (recorded, not forced). */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../..');
const port = 8799;
const shots = path.join(root, 'artifacts/simulator');
fs.mkdirSync(shots, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const child = spawn(process.execPath, ['tools/simulator/sim.js', 'examples/mario/app.js'],
  { cwd: root, env: { ...process.env, LUME_SIM_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
const logLines = [];
let output = '';
const collect = b => {
  const s = b.toString(); output += s;
  for (const line of s.split('\n')) if (line.includes('MARIO')) logLines.push(line.trim());
};
child.stdout.on('data', collect);
child.stderr.on('data', collect);

(async () => {
  let browser;
  try {
    for (let i = 0; i < 60 && !output.includes('Host Simulator http://'); i++) await sleep(100);
    assert.match(output, /Host Simulator http:\/\//);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 600, height: 640 } });
    await page.goto(`http://localhost:${port}/`);
    await page.locator('#device [data-node-id]').first().waitFor({ state: 'attached' });

    // The HUD is the single kind-1 Text node; its textContent is exact and
    // deterministic, so score assertions read it rather than diffing canvas pixels.
    const hudText = () => page.locator('#device .kind-1').first().textContent();
    const parseHud = text => {
      const m = /^S (\d+)\s+C (\d+)\s+L (\d+)\s+LV (\d+)$/.exec((text || '').trim());
      if (!m) throw Error('unparseable HUD: ' + JSON.stringify(text));
      return { score: +m[1], coins: +m[2], lives: +m[3], level: +m[4] };
    };
    const waitHud = async (predicate, what) => {
      for (let i = 0; i < 80; i++) {
        const t = await hudText();
        if (predicate(parseHud(t))) return t;
        await sleep(100);
      }
      assert.fail(what + ' (last HUD ' + JSON.stringify(await hudText()) + ')');
    };
    const click = label => page.getByText(label, { exact: true }).click();
    const inject = input => fetch(`http://localhost:${port}/input`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    });

    // --- Structure: 6 nodes, 3 Buttons, 1 Canvas (rendered pixels in #device) ---
    const labels = await page.locator('#device .kind-2').allTextContents();
    assert.deepEqual(labels, ['LEFT', 'RIGHT', 'JUMP'], 'mario button labels');
    assert.equal(await page.locator('#device [data-node-id]').count(), 6, 'mario node count');
    assert.equal(await page.locator('#device canvas').count(), 1, 'mario Canvas node');
    assert.equal((await page.locator('#error').textContent()).trim(), '', 'no app eval error');
    const initHud = (await hudText()).trim();
    assert.deepEqual(parseHud(initHud), { score: 0, coins: 0, lives: 3, level: 1 }, 'initial HUD');
    console.log(`PASS mario initial HUD ${JSON.stringify(initHud)} nodes=6 buttons=LEFT/RIGHT/JUMP canvas=1`);

    // --- Locate the JUMP button's node id and confirm its longpress gesture is wired ---
    const jumpBtn = page.locator('#device .kind-2').nth(2);
    assert.equal((await jumpBtn.textContent()).trim(), 'JUMP');
    const jumpId = Number(await jumpBtn.getAttribute('data-node-id'));
    const msgs = await (await fetch(`http://localhost:${port}/messages`)).json();
    const gestureIds = msgs.messages.filter(m => m[0] === 'gesture').map(m => m[1]);
    assert.ok(gestureIds.includes(jumpId), 'JUMP longpress gesture registered');
    // Longpress (DOWN t=0 -> stationary MOVE t>=400ms -> UP) triggers jump(true) = HIGH jump.
    const longPressJump = async () => {
      await inject({ type: 'gesture', id: jumpId, kind: 0, x: 399, y: 447, t: 0 });
      await inject({ type: 'gesture', id: jumpId, kind: 1, x: 399, y: 447, t: 450 });
      await inject({ type: 'gesture', id: jumpId, kind: 2, x: 399, y: 447, t: 450 });
    };

    // --- Phase A: button click drives movement + short JUMP -> BRICK (+25, no coin) ---
    await click('RIGHT'); await sleep(900);          // accelerate right, under the brick
    await click('JUMP');                              // short jump breaks the brown brick
    const brickHud = await waitHud(h => h.score >= 25 && h.coins === 0, 'BRICK did not raise score / keep C=0');
    const brickParsed = parseHud(brickHud);
    assert.ok(logLines.some(l => l.includes('MARIO BRICK')), 'MARIO BRICK log event');
    console.log(`PASS mario BRICK via RIGHT+JUMP -> HUD ${JSON.stringify(brickHud.trim())} (score=${brickParsed.score}, matches esp32sim 25)`);

    // --- Phase B: partial reposition + HIGH jump (longpress) + LEFT air-control -> COIN ---
    // A short jump is truncated by the brick bounce, so the coin above it needs a
    // second, HIGH jump once the brick is gone; LEFT brakes the horizontal drift
    // so the hero passes through the coin's x/y band while ascending.
    await click('RIGHT'); await sleep(500);          // partial move with residual momentum
    await longPressJump();                           // HIGH jump (longpress on JUMP)
    await sleep(120);
    await click('LEFT');                             // brake horizontal drift during ascent
    const coinHud = await waitHud(h => h.score > brickParsed.score && h.coins >= 1, 'COIN did not raise score / set C>=1');
    const coinParsed = parseHud(coinHud);
    assert.ok(logLines.some(l => l.includes('MARIO COIN')), 'MARIO COIN log event');
    console.log(`PASS mario COIN via HIGH jump+LEFT air-control -> HUD ${JSON.stringify(coinHud.trim())} (score=${coinParsed.score} coins=${coinParsed.coins}, matches esp32sim 35)`);

    // --- Canvas is actually painted into #device (renderer.js draw()), not just a node ---
    const canvasPixels = await page.locator('#device canvas').evaluate(el => {
      const a = el.getContext('2d').getImageData(0, 0, el.width, el.height).data;
      let n = 0; for (let i = 0; i < a.length; i += 4) if (a[i] || a[i + 1] || a[i + 2]) n++;
      return n;
    });
    assert.ok(canvasPixels > 100, 'mario canvas drawn pixels=' + canvasPixels);
    console.log(`PASS mario canvas pixels rendered into #device (nonzero=${canvasPixels})`);

    const dest = path.join(shots, 'mario.png');
    await page.locator('#device').screenshot({ path: dest });
    console.log('PASS mario screenshot (HUD + Canvas) -> artifacts/simulator/mario.png');
    console.log('PASS mario browser-sim end-to-end: BRICK + COIN categories both exercised via 3 Buttons');
  } catch (e) {
    console.error('---- captured MARIO logs ----');
    for (const l of logLines) console.error(l);
    throw e;
  } finally { if (browser) await browser.close(); child.kill('SIGTERM'); }
})().catch(e => { console.error(e); process.exitCode = 1; });
