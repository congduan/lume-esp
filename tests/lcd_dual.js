/*
 * r69 host harness for examples/lcd_dual (logic + host simulator).
 *
 *   node tests/lcd_dual.js
 *
 * Logic is split at the GAME-UI marker into a bare vm context (like the r68
 * harnesses); integration uses tests/lib/prelude_runner.js to check that the
 * ghost layer is registered with retainSegments only ONCE and replayed with
 * drawPath on later frames, plus gestures / MODE button / dirty budget.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { runApp } = require('./lib/prelude_runner');

function logic() {
  const src = fs.readFileSync('examples/lcd_dual/app.js', 'utf8').split('/* GAME UI */')[0];
  const ctx = vm.createContext({});
  vm.runInContext(src, ctx);
  return ctx;
}
const L = logic();
const ROOT = 1, IW = 480, IH = 480;

// 1. ghost segment geometry vs lit spans: ghost includes 'G', lit never does
{
  assert.equal(L.spanBuilds, 7);
  assert.equal(Object.keys(L.SPANS).length, 7);
  assert.ok(L.SPANS.chef.length > 0 && L.SPANS.bread0.length > 0 && L.SPANS.runner.length > 0);
  assert.deepEqual(plain(L.SPANS.breadGhost), [], 'bread ghost template has no lit segments');
  assert.ok(L.GHOST_A.length >= 1 && L.GHOST_A.length <= 240, 'retained path A segment cap');
  assert.ok(L.GHOST_B.length >= 1 && L.GHOST_B.length <= 240, 'retained path B segment cap');
  // breadGhost contributes 'G' cells to the ghost geometry (the unlit loaf)
  const ghostCell = L.ghostSprite('breadGhost', 0, 0);
  assert.ok(ghostCell.length > 0, 'ghost layer contains the faint loaf outline');
  console.log('PASS lcd ghost geometry bounded (A=' + L.GHOST_A.length + ', B=' + L.GHOST_B.length + ') + lit/ghost split');
}

// 2. two state machines are independent: stepping one never mutates the other
{
  const s = L.lcdState();
  s.b.obstacles = [{x: 300, lane: 0}];
  const bBefore = JSON.stringify(s.b), chefBefore = s.a.chef;
  L.lcdStepA(s); L.lcdMoveChef(s, 1);
  assert.equal(JSON.stringify(s.b), bBefore, 'stepping A left B untouched');
  s.a.bread = 3; s.a.row = 2;
  const aBefore = JSON.stringify(s.a), chefBeforeStepB = s.a.chef;
  L.lcdStepB(s); L.lcdMoveLane(s, -1);
  assert.equal(s.a.chef, chefBeforeStepB);
  assert.equal(JSON.stringify(s.a), aBefore, 'stepping B left A untouched');
  console.log('PASS lcd dual state machines independent');
}

// 3. bread caught when the chef is in the landing column
{
  const s = L.lcdState();
  s.a.chef = 2; s.a.bread = 2; s.a.row = L.AR - 1; s.a.drop = 1; s.a.spawn = 0;
  const r = L.lcdStepA(s);
  assert.equal(r, 'stage');
  assert.equal(s.a.score, 1);
  assert.equal(s.a.miss, 0);
  assert.equal(s.a.bread, null);
  assert.ok(s.events.some(e => e.startsWith('CATCH col=2 score=1')));
  console.log('PASS lcd bread catch + score');
}

// 4. three misses end GAME A
{
  const s = L.lcdState();
  s.a.chef = 2; s.a.miss = 2; s.a.bread = 4; s.a.row = L.AR - 1; s.a.drop = 1; s.a.spawn = 0;
  L.lcdStepA(s);
  assert.equal(s.a.miss, 3);
  assert.equal(s.a.over, true);
  assert.ok(s.events.some(e => e.startsWith('MISS 3')));
  assert.ok(s.events.some(e => e.startsWith('OVER score=0 miss=3')));
  console.log('PASS lcd MISS count + 3-miss game over');
}

// 5. three-stage fall: one row per two ticks, phase cycles 0->1->2
{
  const s = L.lcdState();
  s.a.bread = 1; s.a.row = 0; s.a.phase = 0; s.a.drop = 0; s.a.spawn = 0;
  L.lcdStepA(s);
  assert.equal(s.a.row, 0, 'first tick only primes the drop');
  assert.equal(s.a.phase, 0);
  L.lcdStepA(s);
  assert.equal(s.a.row, 1);
  assert.equal(s.a.phase, 1);
  L.lcdStepA(s); L.lcdStepA(s);
  assert.equal(s.a.row, 2);
  assert.equal(s.a.phase, 2);
  L.lcdStepA(s); L.lcdStepA(s);
  assert.equal(s.a.phase, 0, 'phase wraps after three stages');
  console.log('PASS lcd bread 3-stage fall + phase wrap');
}

// 6. one lane collision ends GAME B
{
  const s = L.lcdState();
  s.b.lane = 1; s.b.obstacles = [{x: L.PX, lane: 1}]; s.b.spawn = 0;
  const r = L.lcdStepB(s);
  assert.equal(r, 'run');
  assert.equal(s.b.over, true);
  assert.equal(s.b.miss, 1);
  assert.ok(s.events.some(e => e.startsWith('HIT lane=1 score=0')));
  console.log('PASS lcd lane collision = one-hit game over');
}

// 7. lane switching clamps to 3 lanes; a passed obstacle scores a dodge
{
  const s = L.lcdState();
  assert.equal(L.lcdMoveLane(s, -1), 'move'); assert.equal(s.b.lane, 0);
  assert.equal(L.lcdMoveLane(s, -1), 'blocked'); assert.equal(s.b.lane, 0);
  assert.equal(L.lcdMoveLane(s, 1), 'move'); assert.equal(s.b.lane, 1);
  assert.equal(L.lcdMoveLane(s, 1), 'move'); assert.equal(s.b.lane, 2);
  assert.equal(L.lcdMoveLane(s, 1), 'blocked'); assert.equal(s.b.lane, 2);
  s.b.obstacles = [{x: 40, lane: 0}]; s.b.spawn = -100; s.b.lane = 1;
  for (let i = 0; i < 20 && s.b.score === 0; i++) L.lcdStepB(s);
  assert.equal(s.b.score, 1);
  assert.ok(s.events.some(e => e.startsWith('DODGE score=1')));
  console.log('PASS lcd lane clamp + dodge scoring');
}

// 8. MODE switch cleans transient state and preserves each machine's score
{
  const s = L.lcdState();
  s.a.score = 7; s.b.score = 4;
  s.a.bread = 2; s.a.row = 3; s.a.drop = 1;
  s.b.obstacles = [{x: 300, lane: 0}]; s.b.miss = 1; s.b.over = true;
  assert.equal(L.lcdSwitchMode(s, 'b'), 'b');
  assert.deepEqual(plain(s.b.obstacles), [], 'incoming B obstacles cleaned');
  assert.equal(s.b.miss, 0); assert.equal(s.b.over, false);
  assert.equal(s.b.score, 4, 'score kept');
  assert.equal(s.a.bread, 2, 'outgoing A state kept');
  L.lcdSwitchMode(s, 'a');
  assert.equal(s.a.bread, null, 'incoming A bread cleaned');
  assert.equal(s.a.score, 7);
  L.lcdReset(s);
  assert.equal(s.a.score, 0);
  console.log('PASS lcd MODE switch cleanup + score preservation + reset');
}

// 9. score KV with <=15-char key and graceful failure
{
  let stored, value = null;
  L.lume = { storage: { kv: {
    get: key => { stored = key; return value; },
    set: (key, v) => { stored = key; value = v; return 0; },
  } } };
  value = 12;
  assert.equal(L.lcdHigh(), 12);
  assert.equal(stored, 'hisc.lcd');
  assert.ok(stored.length <= 15);
  assert.equal(L.lcdSave(20, 12), 20);
  assert.equal(L.lcdSave(5, 20), 20);
  L.lume.storage.kv.get = () => { throw Error('offline'); };
  L.lume.storage.kv.set = () => { throw Error('offline'); };
  assert.equal(L.lcdHigh(), 0);
  assert.equal(L.lcdSave(9, 3), 9);
  console.log('PASS lcd score KV (<=15 char key, graceful failure)');
}

// 10. integration: ghost registered once, replayed; nodes/events, gestures, MODE
{
  const events = [];
  const ui = runApp(fs.readFileSync('examples/lcd_dual/app.js', 'utf8'), { onLog: m => events.push(String(m)) });
  assert.equal(ui.messages.filter(m => m[0] === 'create' && m[2] === 3).length, 1); // one Canvas
  assert.equal(ui.messages.filter(m => m[0] === 'pathDefine').length, 2, 'ghost paths uploaded once');
  assert.ok(ui.messages.some(m => m[0] === 'pathDraw')); // replayed on draw
  assert.ok(events.some(e => e.startsWith('LCD GAME=a score=0 miss=0')));
  const rects = ui.messages.filter(m => m[0] === 'invalidate');
  assert.deepEqual(rects[0].slice(2), [0, 0, 480, 480]);
  // many frames later: still exactly two ghost uploads, no per-frame redefine
  for (let i = 0; i < 6; i++) ui.ctx.frame.set(ui.ctx.frame() + 1);
  assert.equal(ui.messages.filter(m => m[0] === 'pathDefine').length, 2, 'no ghost re-registration');
  const draws = ui.messages.filter(m => m[0] === 'pathDraw');
  assert.ok(draws.length >= 7, 'ghost replayed each frame');
  for (const m of ui.messages.filter(m => m[0] === 'invalidate').slice(1)) {
    const area = m.length >= 6 ? m[4] * m[5] : 480 * 480;
    assert.ok(area > 0 && area <= 0.5 * IW * IH, 'per-frame dirty budget ' + area);
  }

  // GAME A: swipe left moves the chef one column to the left
  const chef0 = ui.ctx.state.a.chef;
  ui.gesture(ROOT, 0, 240, 300, 0); ui.gesture(ROOT, 1, 170, 300, 10); ui.gesture(ROOT, 2, 170, 300, 20);
  assert.equal(ui.ctx.state.a.chef, chef0 - 1);
  // vertical swipes are ignored in GAME A (independent modes)
  const lane0 = ui.ctx.state.b.lane;
  ui.gesture(ROOT, 0, 240, 300, 100); ui.gesture(ROOT, 1, 240, 220, 110); ui.gesture(ROOT, 2, 240, 220, 120);
  assert.equal(ui.ctx.state.b.lane, lane0);
  assert.equal(ui.ctx.state.mode, 'a');

  // MODE tap zone switches to B and cleans B's transients (no Button onPress:
  // a single gesture target avoids the button/canvas double-fire conflict)
  assert.equal(ui.messages.filter(m => m[0] === 'press').length, 0);
  ui.gesture(ROOT, 0, 240, 446, 300); ui.gesture(ROOT, 2, 240, 446, 330);
  assert.equal(ui.ctx.state.mode, 'b');
  assert.ok(events.some(e => e.includes('LCD MODE b')));

  // GAME B: swipe up now moves the lane up
  ui.gesture(ROOT, 0, 240, 300, 200); ui.gesture(ROOT, 1, 240, 220, 210); ui.gesture(ROOT, 2, 240, 220, 220);
  assert.equal(ui.ctx.state.b.lane, 0);
  console.log('PASS lcd canvas/ghost-once/dirty budget, A+B swipes, MODE button');
}

function plain(v) { return JSON.parse(JSON.stringify(v)); }
console.log('ALL LCD_DUAL HARNESS CASES PASSED');
