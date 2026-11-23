/* r65 host harness for examples/pet/app.js.
 *
 * Runs the exact C-embedded prelude plus the real app through
 * tests/lib/prelude_runner.js, injects a controllable clock + IMU + NVD-like
 * KV stand-in, and asserts:
 *   - state-machine transitions (pet / feed / startle / decay / sleep)
 *   - skin choice persisted in lume.storage.kv under a <=15 char key
 *   - precomputed fillRect spans and tight per-frame dirty boxes
 *   - sleeping does NOT repaint the canvas
 * No hardware claim: this is the same host path the other examples use. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { runApp } = require('./lib/prelude_runner');

const source = fs.readFileSync('examples/pet/app.js', 'utf8');
let cases = 0;
function check(name, fn) { fn(); cases++; console.log('PASS pet ' + name); }

/* A fresh app session with a fake clock, scripted IMU and a stateful KV. */
function session(options = {}) {
  const store = options.store || {};
  const kv = {
    set: (k, v) => {
      assert.ok(typeof k === 'string' && k.length <= 15, 'KV key <= 15 chars: ' + k);
      store[k] = v; return 0;
    },
    get: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    remove: k => { delete store[k]; return 0; },
    keys: () => Object.keys(store), clear: () => { for (const k of Object.keys(store)) delete store[k]; return 0; },
  };
  let sample = options.imu || { ax: 0, ay: 0, az: 9.81, gx: 0, gy: 0, gz: 0 };
  const logs = [];
  const s = runApp(source, {
    filename: 'examples/pet/app.js',
    kv,
    imu: { read: () => sample },
    onLog: (...a) => logs.push(a.join(' ')),
  });
  let now = Date.now();
  s.lume._nowMs = () => now;
  vm.runInContext(`var __now=${now}; Date.now=function(){return __now;};`, s.ctx);
  vm.runInContext('stop(); start();', s.ctx);
  return {
    s, store, logs, sceneId: () => vm.runInContext('scene', s.ctx),
    now: () => now,
    setImu: v => { sample = v; },
    advance(ms) { now += ms; vm.runInContext(`__now+=${ms}`, s.ctx); },
    tick(ms = 100) { this.advance(ms); vm.runInContext('__lume_tick()', s.ctx); },
    val: expr => vm.runInContext(expr, s.ctx),
    do: expr => vm.runInContext(expr, s.ctx),
    tapAt(x, y) {
      const id = this.sceneId(), t = now;
      s.gesture(id, 0, x, y, t); s.gesture(id, 2, x + 1, y, t + 90);
    },
    holdAt(x, y) {
      const id = this.sceneId(), t = now;
      s.gesture(id, 0, x, y, t); s.gesture(id, 1, x, y, t + 450); s.gesture(id, 2, x, y, t + 500);
    },
  };
}
const stateOf = h => h.val('care.state');

/* =======================================================================
 * 1. Load + precomputed spans
 * ===================================================================== */
check('app loads: IDLE, skin 0, precomputed sprite spans and one full paint', () => {
  const h = session();
  assert.equal(stateOf(h), 'IDLE');
  assert.equal(h.val('skinIndex'), 0);
  const kinds = h.val('Object.keys(SPRITES[0]).sort().join(",")');
  assert.equal(kinds, 'HAPPY,HUNGRY,IDLE,SLEEP,SURPRISED');
  const spanCount = h.val('SPRITES[0].IDLE[0].spans.length');
  assert.ok(spanCount > 20 && spanCount < 100, 'idle span count=' + spanCount);
  const inv = h.s.messages.filter(m => m[0] === 'invalidate');
  assert.equal(inv.length, 1, 'first paint invalidates the whole canvas');
  assert.equal(inv[0].length, 2, 'first invalidate has no dirty rect');
});
check('buildSpans merges runs and covers exactly the non-empty cells', () => {
  const h = session();
  /* pad to a full 16x16 grid; buildSpans always walks GRID rows/cols */
  const a = [[0, 1, 1, 1, 0], [2, 2, 2, 0, 3]];
  for (const row of a) while (row.length < 16) row.push(0);
  while (a.length < 16) a.push(new Array(16).fill(0));
  const spans = h.val('buildSpans(' + JSON.stringify(a) + ')');
  assert.equal(JSON.stringify(spans), JSON.stringify([[0, 1, 3, 1], [1, 0, 3, 2], [1, 4, 1, 3]]));
  /* every precomputed span stays inside the 16x16 grid */
  const ok = h.val(`(function(){for(var s=0;s<SKINS.length;s++)for(var k in SPRITES[s])
    for(var f=0;f<SPRITES[s][k].length;f++){var sp=SPRITES[s][k][f].spans;
    for(var i=0;i<sp.length;i++){var r=sp[i];if(r[1]<0||r[1]+r[2]>GRID||r[0]<0||r[0]>=GRID)return false;}}
    return true;})()`);
  assert.equal(ok, true, 'all spans inside grid');
});

/* =======================================================================
 * 2. State machine: pet / feed / startle / sleep / decay
 * ===================================================================== */
check('tap = pet: happy rises, state -> HAPPY (via gesture dispatch)', () => {
  const h = session();
  const before = h.val('care.happy');
  h.tapAt(200, 200);
  assert.equal(stateOf(h), 'HAPPY');
  assert.ok(h.val('care.happy') > before, 'happy ' + before + ' -> ' + h.val('care.happy'));
  const logs = h.logs.filter(l => l.indexOf('PET PET') >= 0);
  assert.ok(logs.length > 0, 'PET PET log line emitted');
  console.log('EVIDENCE ' + logs[0] + ' | state=' + stateOf(h));
});
check('longpress = feed: hunger drops (via gesture dispatch)', () => {
  const h = session();
  h.do('care.hunger = 60;');
  h.holdAt(200, 200);
  assert.ok(h.val('care.hunger') <= 15, 'hunger 60 -> ' + h.val('care.hunger'));
  const logs = h.logs.filter(l => l.indexOf('PET FEED') >= 0);
  assert.ok(logs.length > 0, 'PET FEED log line emitted');
  console.log('EVIDENCE ' + logs[0] + ' | state=' + stateOf(h));
});
check('IMU magnitude spike = startle: -> SURPRISED, then decays back', () => {
  const h = session();
  h.setImu({ ax: 0, ay: 0, az: 32, gx: 0, gy: 0, gz: 0 });
  h.tick(100);
  assert.equal(stateOf(h), 'SURPRISED');
  /* subsequent spikes are debounced (armed=false) until rest is observed */
  h.setImu({ ax: 0, ay: 0, az: 9.81, gx: 0, gy: 0, gz: 0 });
  h.tick(100);
  assert.equal(h.val('startleArmed'), true, 're-armed at rest');
  h.do('care.until = ' + h.now() + ';');
  h.tick(100);
  assert.equal(stateOf(h), 'IDLE', 'transient expired -> IDLE');
});
check('time decay drives hunger into HUNGRY and feeding resolves it', () => {
  const h = session();
  h.do('care.hunger = 69.9;');
  h.tick(100);                            /* +0.25 -> crosses 70 */
  assert.equal(stateOf(h), 'HUNGRY');
  h.do('doFeed()');
  assert.equal(stateOf(h), 'IDLE');
  assert.ok(h.val('care.hunger') < 30);
});
check('sleep is timer-driven; wake()/startle resumes, sleeping decays slowly', () => {
  const h = session();
  h.advance(16000); h.tick(100);           /* no interaction for 16 s */
  assert.equal(stateOf(h), 'SLEEP');
  const h0 = h.val('care.hunger');
  for (let i = 0; i < 20; i++) h.tick(1000);
  const dh = h.val('care.hunger') - h0;
  assert.ok(dh > 0 && dh < 30, 'sleep hunger decay ' + dh.toFixed(2) + ' over 20 s (half rate)');
  h.do('doStartle(20)');
  assert.equal(stateOf(h), 'SURPRISED', 'startle wakes from SLEEP');
});

/* =======================================================================
 * 3. Skin store: KV persistence
 * ===================================================================== */
check('skin switch writes pet.skin (<=15 chars) and wraps modulo 2', () => {
  const h = session();
  h.do('selectSkin(1)');
  assert.equal(h.store['pet.skin'], 1);
  assert.equal(h.val('skinIndex'), 1);
  h.do('selectSkin(2)');                   /* index 2 wraps to 0 (as the button does with +1) */
  assert.equal(h.val('skinIndex'), 0);
  assert.equal(h.store['pet.skin'], 0);
  console.log('EVIDENCE skin KV keys=' + JSON.stringify(Object.keys(h.store)));
});
check('a fresh runtime restores the persisted skin on boot', () => {
  const store = { 'pet.skin': 1 };
  const h = session({ store });
  assert.equal(h.val('skinIndex'), 1, 'skin restored from KV');
  assert.equal(h.val('SKINS[skinIndex].name'), 'SLIME');
});
check('bad KV values fall back to skin 0 (no negative-number discriminator)', () => {
  for (const bad of [-2, 7, 'x', null]) {
    const h = session({ store: { 'pet.skin': bad } });
    assert.equal(h.val('skinIndex'), 0, 'fallback for ' + JSON.stringify(bad));
  }
});

/* =======================================================================
 * 4. Rendering budget: tight dirty boxes, no repaint while asleep
 * ===================================================================== */
check('idle animation repaints only the eye rows (<=96px wide, 12px tall)', () => {
  const h = session();
  let boxes = [];
  let maxCalls = 0;
  for (let i = 0; i < 24; i++) {
    const from = h.s.messages.length;
    h.tick(100);
    const chunk = h.s.messages.slice(from);
    boxes = boxes.concat(chunk.filter(m => m[0] === 'invalidate' && m.length === 6));
    maxCalls = Math.max(maxCalls, chunk.filter(m => m[0] === 'draw').length);
  }
  assert.ok(boxes.length >= 8, 'animation produced ' + boxes.length + ' dirty rects');
  assert.equal(boxes.length, 24, '10 Hz idle animation paints once per 100 ms tick');
  assert.ok(maxCalls > 0 && maxCalls <= 100, 'per-paint draw budget ' + maxCalls);
  for (const m of boxes) {
    const [, , x, y, w, hh] = m;
    assert.ok(w <= 96 && hh <= 12, 'dirty rect ' + w + 'x' + hh + ' too large');
    assert.ok(x >= 0 && y >= 0 && x + w <= 480 && y + hh <= 480, 'rect inside canvas');
  }
  console.log('EVIDENCE idle dirty rects=' + boxes.length +
    ' widths=' + boxes.map(m => m[4]).join(','));
  console.log('EVIDENCE pet idle 10 paints/s, sleep 0 paints/s; max ' + maxCalls + ' draw calls/paint');
});
check('sleeping never repaints the canvas across many ticks', () => {
  const h = session();
  h.do('enterSleep()');
  const from = h.s.messages.length;
  for (let i = 0; i < 40; i++) h.tick(100);
  const chunk = h.s.messages.slice(from);
  const draws = chunk.filter(m => m[0] === 'draw').length;
  const inv = chunk.filter(m => m[0] === 'invalidate').length;
  assert.equal(draws, 0, 'no draw commands while asleep');
  assert.equal(inv, 0, 'no invalidates while asleep');
  assert.equal(stateOf(h), 'SLEEP');
  console.log('EVIDENCE sleep 40 ticks -> draws=' + draws + ' invalidates=' + inv);
});

console.log('PASS ' + cases + ' pet host cases');
