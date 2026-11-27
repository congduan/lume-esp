/*
 * r109 host harness: StatusBar equal-width strategy on square vs round screens.
 *
 * Run: node tests/statusbar_round.js
 *
 * Pure JS - loads the real runtime/shell.js through the firmware-exact prelude
 * runner. No firmware image, no board, no emulator. The bridge attr keys are
 * the same ones tests/safearea.js uses: 2=width, 3=height, 18=x, 19=y.
 *
 * The bug this locks down: StatusBar used to hard-code width 432 / x,y 24,
 * which overflows a 368px-wide screen and the 329px inscribed safe square of
 * the 466px round 1.75C panel. The fix derives geometry from __lumeScreen and
 * reuses shell.safeInsets(); a round bar is equal-width with an r104 SafeArea
 * View. Square 480 (2.16) keeps the exact legacy layout.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { runApp } = require('./lib/prelude_runner');

const shell = fs.readFileSync('runtime/shell.js', 'utf8');
let cases = 0;
function check(name, fn) { fn(); cases++; console.log('PASS statusbar-round ' + name); }

function app(code, screen) { return runApp(shell + '\n' + code, {screen}); }
function evaluate(s, code) { return vm.runInContext(code, s.ctx); }
function attr(s, id, key) {
  return s.messages.findLast(m => m[0] === 'attr' && m[1] === id && m[2] === key)?.[3];
}
function metrics(s, id) {
  return {x: attr(s, id, 18), y: attr(s, id, 19), w: attr(s, id, 2), h: attr(s, id, 3)};
}

check('2.16 square 480 keeps legacy 432 wide at (24,24) - no regression', () => {
  const s = app('globalThis.bar=lume.ui.shell.StatusBar({left:"a",right:"b"});', {w:480,h:480});
  assert.deepEqual(metrics(s, s.ctx.bar), {x:24, y:24, w:432, h:56});
});

check('1.8 square 368 clamps the bar to the screen - no overflow', () => {
  const s = app('globalThis.bar=lume.ui.shell.StatusBar({});', {w:368,h:448});
  const m = metrics(s, s.ctx.bar);
  assert.deepEqual(m, {x:24, y:24, w:320, h:56});
  assert.ok(m.x + m.w <= 368, 'bar right edge within the 368px board');
  // Negative assertion: the old hard-coded 432 would have overflowed.
  assert.ok(24 + 432 > 368, 'legacy 432 bar would have overflowed 368 - bug reproduced in the assertion');
});

check('1.75C round 466 bar stays 8px inside the SafeArea inscribed square', () => {
  const s = app(
    'globalThis.bar=lume.ui.shell.StatusBar({shape:"round"});' +
    'globalThis.safe=lume.ui.shell.SafeArea({shape:"round",size:466});',
    {w:466,h:466});
  const bar = metrics(s, s.ctx.bar);
  const safe = metrics(s, s.ctx.safe);
  assert.deepEqual(safeInsetsRound466(s), {top:68,right:69,bottom:69,left:68});
  assert.equal(safe.w, 329);
  assert.equal(bar.w, 313, 'round bar is safe.w - 16 (8px inner margin per side)');
  assert.equal(bar.w, safe.w - 16, '8px inner margin inside SafeArea width');
  assert.deepEqual([bar.x, bar.y], [76, 76], 'bar starts 8px inside safe insets');
  // Top corners must stay strictly inside the 466px circle (R <= 233).
  assert.ok(Math.hypot(bar.x - 233, bar.y - 233) <= 233, 'top-left corner inside R=233');
  assert.ok(Math.hypot(bar.x + bar.w - 233, bar.y - 233) <= 233, 'top-right corner inside R=233');
  // Negative assertions: legacy bar was 432 wide at x=24 -> right edge 456,
  // well past the safe right edge 397 (466 - 69).
  assert.notEqual(bar.w, 432, 'legacy fixed width is gone on round screens');
  assert.ok(bar.x + bar.w <= 466 - 69, 'bar right edge within the round safe square');
  assert.ok(24 + 432 > 466 - 69, 'legacy 432/24 bar overflowed the safe square - bug reproduced');
});

check('480 round bar stays strictly inside [75,405] safe box and R<=240', () => {
  const s = app('globalThis.bar=lume.ui.shell.StatusBar({shape:"round"});', {w:480,h:480});
  const bar = metrics(s, s.ctx.bar);
  assert.deepEqual(bar, {x:78, y:78, w:323, h:56});
  assert.ok(bar.x >= 75 && bar.x + bar.w <= 405, 'horizontal bounds inside [75,405]');
  assert.ok(bar.y >= 75 && bar.y + bar.h <= 405, 'vertical bounds inside [75,405]');
  assert.ok(Math.hypot(bar.x - 240, bar.y - 240) <= 233, 'top-left clears 466px bezel');
  assert.ok(Math.hypot(bar.x + bar.w - 240, bar.y - 240) <= 233, 'top-right clears 466px bezel');
});
function safeInsetsRound466(s) {
  return JSON.parse(evaluate(s, 'JSON.stringify(lume.ui.shell.safeInsets("round",466))'));
}

check('custom x/y still override derived geometry', () => {
  const s = app('globalThis.bar=lume.ui.shell.StatusBar({shape:"round",x:7,y:9});', {w:466,h:466});
  assert.deepEqual([metrics(s, s.ctx.bar).x, metrics(s, s.ctx.bar).y], [7,9]);
});

check('invalid shape throws TypeError (square and round are the only shapes)', () => {
  const s = app('', {w:466,h:466});
  assert.throws(() => evaluate(s, 'lume.ui.shell.StatusBar({shape:"oval"})'),
    error => error.name === 'TypeError' && /StatusBar shape/.test(error.message));
});

check('round bar keeps signal getters and clock disposal behaviour', () => {
  const s = app(
    'globalThis.v=signal(1);globalThis.bar=lume.ui.shell.StatusBar({shape:"round",left:()=>"L"+v(),clock:true});',
    {w:466,h:466});
  assert.ok(s.messages.some(m => m[0] === 'attr' && m[2] === 0 && m[3] === 'L1'));
  evaluate(s, 'v.set(2)');
  assert.ok(s.messages.some(m => m[0] === 'attr' && m[2] === 0 && m[3] === 'L2'));
  assert.equal(evaluate(s, 'Object.keys(__timers).length'), 1);
  evaluate(s, 'lume.ui.shell.dispose(bar)');
  assert.equal(evaluate(s, 'Object.keys(__timers).length'), 0);
});

console.log('PASS ' + cases + ' statusbar-round cases');
