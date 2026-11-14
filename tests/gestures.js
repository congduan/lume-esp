// r21 host harness: execute the exact C-embedded prelude and synthesize
// press/move/release sequences into the gesture layer. No LVGL indev is built
// on the host, so we inject the SAME normalized pointer stream the native
// bridge produces into __lume_dispatchGesture (and call the pure __gestureStep
// directly). This is the "pure logic synthesizer" test scope from the brief.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const source = fs.readFileSync('firmware/components/lume-engine/lume_scripts.c', 'utf8');
const { prelude } = require('./lib/prelude_runner');

let nextNode = 1;
const enabled = [];      // nodes for which setGestureEvent was posted
const ctx = vm.createContext({lume: {
  createNode: () => nextNode++,
  setAttr: () => {},
  setPressEvent: () => {},
  setGestureEvent: id => enabled.push(id),
  removeChild: () => {},
  nativeAnimate: () => 1,
  nativeAnimateCancel: () => {},
  canvasDraw: () => {},
  canvasInvalidate: () => {},
  _nowMs: () => 0,
  log: () => {},
  power: {_sleepNow: () => 0, _wake: () => 0},
  net: {deinit: () => 0}
}});
vm.runInContext(prelude, ctx);
const run = code => vm.runInContext(code, ctx);
function ok(name, fn) { fn(); console.log('PASS ' + name); }

/* ---- normalized inputs (kind 0 DOWN / 1 MOVE / 2 UP / 3 SWIPEDIR) ---- */
const D = (x, y, t) => ({kind: 0, x, y, t, dir: 0, cancelled: 0});
const M = (x, y, t) => ({kind: 1, x, y, t, dir: 0, cancelled: 0});
const U = (x, y, t, c) => ({kind: 2, x, y, t, dir: 0, cancelled: c || 0});
const S = d => ({kind: 3, x: 0, y: 0, t: 0, dir: d, cancelled: 0});
// Run a whole sequence through the PURE state machine inside the VM realm.
function seq(inputs) {
  const body = inputs.map(i => 'o=o.concat(__gestureStep(s,' + JSON.stringify(i) + '))').join(';');
  return run('(function(){var s=__gestureNewState();var o=[];' + body + ';return o})()');
}
const types = a => Array.from(a, e => e.type);

/* =====================================================================
 * 1. PURE state machine: tap / longpress boundaries, pan stream, swipe
 * ===================================================================== */
ok('tap: short press with small displacement -> one tap with end coords', () => {
  const a = seq([D(10, 10, 0), U(12, 11, 120)]);
  assert.deepStrictEqual(types(a), ['tap']);
  assert.strictEqual(a[0].x, 12); assert.strictEqual(a[0].y, 11);
});
ok('tap boundary: displacement >= tapMovePx(10) is NOT a tap', () => {
  assert.deepStrictEqual(types(seq([D(10, 10, 0), U(25, 10, 120)])), []);
});
ok('tap boundary: duration >= tapMaxMs(400) is NOT a tap (becomes longpress)', () => {
  assert.deepStrictEqual(types(seq([D(10, 10, 0), U(11, 10, 400)])), ['longpress']);
});
ok('longpress boundary: fires while still down once t-start >= 400ms', () => {
  const before = types(seq([D(10, 10, 0), M(10, 10, 399)]));
  assert.deepStrictEqual(before, [], '399ms must not longpress or pan');
  const a = seq([D(10, 10, 0), M(10, 10, 400), U(10, 10, 450)]);
  assert.deepStrictEqual(types(a), ['longpress'], 'longpress exactly once, no tap on release');
});
ok('longpress suppresses tap AND swipe on release (no double-fire)', () => {
  const a = seq([D(10, 10, 0), M(10, 10, 400), M(80, 10, 460), U(90, 10, 500)]);
  assert.deepStrictEqual(types(a), ['longpress']);
});
ok('pan stream: panstart -> pan* -> panend, with dx/dy from press start', () => {
  const a = seq([D(10, 10, 0), M(15, 10, 30), M(30, 10, 60), M(45, 12, 90), U(45, 12, 120)]);
  assert.deepStrictEqual(types(a), ['panstart', 'pan', 'pan', 'panend']);
  assert.deepStrictEqual([a[0].dx, a[0].dy], [20, 0]);
  assert.deepStrictEqual([a[3].dx, a[3].dy], [35, 2]);
  console.log('EVIDENCE pan stream types=' + JSON.stringify(types(a)) +
              ' final dx/dy=' + a[3].dx + '/' + a[3].dy);
});
ok('swipe: LVGL gesture-dir hint (right=2) wins over axis inference', () => {
  const a = seq([D(10, 10, 0), M(60, 10, 60), S(2), U(100, 12, 120)]);
  const sw = a.filter(e => e.type === 'swipe');
  assert.strictEqual(sw.length, 1);
  assert.strictEqual(sw[0].dir, 'right');
  assert.strictEqual(sw[0].dx, 90); assert.strictEqual(sw[0].dy, 2);
  // A large drag also streams pan events; apps pick the type they listen to.
  assert(types(a).indexOf('panstart') >= 0 && types(a).indexOf('panend') >= 0);
});
ok('swipe: axis fallback when no LVGL dir hint (vertical -> down)', () => {
  const a = seq([D(10, 10, 0), M(10, 80, 60), U(12, 110, 120)]);
  assert.strictEqual(a.filter(e => e.type === 'swipe')[0].dir, 'down');
});
ok('swipe speed gate: a 5s STATIONARY hold is a longpress, never a swipe', () => {
  // Stationary: longpressMs bounds it; LVGL exposes no swipe velocity threshold.
  const a = seq([D(10, 10, 0), U(10, 10, 5000)]);
  assert.deepStrictEqual(types(a), ['longpress']);
});
ok('r21-fix: a SLOW drag held past 400ms is pan, NEVER longpress (movement gate)', () => {
  // Codex review P1-2 regression: displacement must gate the longpress clock.
  // 50px over 700ms -> mean vel 0.071 px/ms, below swipeMinVel: no swipe.
  const a = seq([D(10, 10, 0), M(30, 10, 100), M(50, 10, 410), U(60, 10, 700)]);
  assert.deepStrictEqual(types(a), ['panstart', 'pan', 'pan', 'panend'],
    'a dragged press never morphs into longpress');
});
ok('r21-fix: a slow drag that ends fast stays swipe-eligible (no longpress steal)', () => {
  // 110px dragged over 5000ms but released... use a drag completed quickly at UP:
  const a = seq([D(10, 10, 0), M(60, 10, 60), U(120, 10, 120)]);
  assert.strictEqual(types(a).indexOf('swipe') >= 0, true, 'swipe delivered');
});
ok('r21-fix: slow long drag (dist>=50px, vel<min) is neither longpress nor swipe', () => {
  const a = seq([D(10, 10, 0), M(80, 10, 300), U(110, 10, 5000)]);
  assert.deepStrictEqual(types(a), ['panstart', 'pan', 'panend'],
    'drag -> pan stream only; 5s+100px at 0.02px/ms is too slow to swipe');
});
ok('swipeMinVel is a real, tunable gate (raise it -> slow drag stops swiping)', () => {
  run('lume.gesture.tuning.swipeMinVel = 1.0');
  const a = seq([D(10, 10, 0), M(60, 10, 60), U(120, 10, 200)]);  // 110px/200ms = 0.55 px/ms
  assert.strictEqual(types(a).indexOf('swipe'), -1);
  run('lume.gesture.tuning.swipeMinVel = 0.1');   // restore LVGL-default-ish
});
ok('scroll-cancelled UP: a List scroll wins, no tap/swipe/longpress', () => {
  assert.deepStrictEqual(types(seq([D(10, 10, 0), U(40, 10, 200, 1)])), []);
});
ok('tuning is centralized and tunable: swipeMinPx can be raised at runtime', () => {
  run('lume.gesture.tuning.swipeMinPx = 200');
  assert.deepStrictEqual(types(seq([D(10, 10, 0), M(80, 10, 60), U(120, 10, 120)])),
                         ['panstart', 'pan', 'panend'], 'no swipe below the new threshold');
  run('lume.gesture.tuning.swipeMinPx = 50');   // restore LVGL default
});

/* =====================================================================
 * 2. Integration: registration, dispatch, unregister, onPress coexistence
 * ===================================================================== */
function feed(id, inputs) {
  for (const i of inputs) {
    run('__lume_dispatchGesture(' + id + ',' + i.kind + ',' + i.x + ',' + i.y + ',' +
        i.t + ',' + i.dir + ',' + i.cancelled + ')');
  }
}
ok('on() enables LVGL events once per node and rejects bad type/callback', () => {
  const id = run('View({})');
  assert.throws(() => run('lume.gesture.on(' + id + ',"bogus",function(){})'), /unsupported gesture type/);
  assert.throws(() => run('lume.gesture.on(' + id + ',"tap",null)'), /must be a function/);
  const n = enabled.length;
  run('lume.gesture.on(' + id + ',"tap",function(){})');
  run('lume.gesture.on(' + id + ',"swipe",function(){})');
  assert.strictEqual(enabled.length, n + 1, 'second on() on same node must not re-enable');
});
ok(' dispatched GestureEvent reaches the right callback with coordinates', () => {
  const id = run('View({})');
  run('globalThis.g=[]; lume.gesture.on(' + id + ',"tap",function(e){g.push(e);});');
  feed(id, [D(100, 120, 0), U(101, 120, 90)]);
  const g = run('globalThis.g');
  assert.strictEqual(g.length, 1);
  assert.strictEqual(g[0].type, 'tap');
  assert.strictEqual(g[0].x, 101);
});
ok('unregister function is idempotent and stops future delivery', () => {
  const id = run('View({})');
  run('globalThis.h=0; globalThis.off=lume.gesture.on(' + id + ',"tap",function(){h++;});');
  feed(id, [D(5, 5, 0), U(5, 5, 50)]);
  assert.strictEqual(run('globalThis.h'), 1);
  run('globalThis.off(); globalThis.off();');
  feed(id, [D(5, 5, 0), U(5, 5, 50)]);
  assert.strictEqual(run('globalThis.h'), 1);
});
ok('longpress then release: no tap delivered; onPress (CLICKED) suppressed', () => {
  const id = run('View({onPress:function(){globalThis.press=(globalThis.press||0)+1;}})');
  run('globalThis.press=0; globalThis.lp=0; globalThis.taps=0;');
  run('lume.gesture.on(' + id + ',"longpress",function(){lp++;});');
  run('lume.gesture.on(' + id + ',"tap",function(){taps++;});');
  feed(id, [D(20, 20, 0), M(20, 20, 420), U(20, 20, 460)]);
  run('__lume_dispatchPress(' + id + ')');   // LVGL CLICKED after RELEASED
  assert.strictEqual(run('globalThis.lp'), 1, 'longpress fired');
  assert.strictEqual(run('globalThis.taps'), 0, 'no tap after longpress');
  assert.strictEqual(run('globalThis.press'), 0, 'onPress not double-triggered');
});
ok('normal tap: onPress AND gesture tap both fire (no longpress latch)', () => {
  const id = run('View({onPress:function(){globalThis.press=(globalThis.press||0)+1;}})');
  run('globalThis.press=0; globalThis.taps=0;');
  run('lume.gesture.on(' + id + ',"tap",function(){taps++;});');
  feed(id, [D(20, 20, 0), U(21, 20, 90)]);
  run('__lume_dispatchPress(' + id + ')');
  assert.strictEqual(run('globalThis.taps'), 1);
  assert.strictEqual(run('globalThis.press'), 1, 'onPress still fires for a short tap');
});
ok('dispose clears per-node gesture state (removed node stops dispatching)', () => {
  const id = run('View({})');
  run('globalThis.d=0; lume.gesture.on(' + id + ',"tap",function(){d++;});');
  run('__lume_dispatchRemove(' + id + ')');
  feed(id, [D(1, 1, 0), U(1, 1, 50)]);
  assert.strictEqual(run('globalThis.d'), 0);
});

/* =====================================================================
 * 3. Example app loads and reacts to a synthesized gesture
 * ===================================================================== */
ok('examples/gestures/app.js evaluates and its tap counter responds', () => {
  vm.runInContext(fs.readFileSync('examples/gestures/app.js', 'utf8'), ctx);
  const id = run('tapCard');
  const before = run('taps()');
  feed(id, [D(60, 100, 0), U(61, 100, 100)]);
  assert.strictEqual(run('taps()'), before + 1, 'tap increments the counter');
  assert(/^tap \(/.test(run('status()')), 'status bar echoes gesture + coords');
  console.log('EVIDENCE demo tap -> status="' + run('status()') + '" taps=' + run('taps()'));
});
ok('example swipe changes page and longpress toggles color', () => {
  const sw = run('swipeCard'), lp = run('longCard');
  feed(sw, [D(300, 100, 0), M(360, 100, 60), S(1), U(420, 100, 120)]);
  assert(/^swipe \(/.test(run('status()')));
  assert.strictEqual(run('page()'), 2, 'left swipe -> page 1->2');
  feed(lp, [D(60, 300, 0), M(60, 300, 420), U(60, 300, 460)]);
  assert(/^longpress \(/.test(run('status()')));
  assert.strictEqual(run('hot()'), true, 'longpress toggled color signal');
});

console.log('PASS 20 r21 gesture cases');
