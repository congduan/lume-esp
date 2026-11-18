/* r99: pure animation contract plus exact firmware-prelude integration. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { runApp } = require('./lib/prelude_runner');
const APP = fs.readFileSync('examples/aurora_clock/app.js', 'utf8');
const logic = vm.createContext({ Math, Date, isFinite, parseInt });
vm.runInContext(APP.split('/* GAME UI */')[0], logic);
const s = logic.acState();
for (let i = 0; i < 1600; i++) {
  const sample = i < 300 ? { ax: 9.81, ay: -9.81, az: 0 } : null;
  const old = s.phase;
  logic.acStep(s, sample);
  assert.ok(s.phase - old <= 0.0200001, 'active speed cap');
  for (let band = 0; band < 3; band++) for (let part = 0; part < 6; part++) {
    const [x, y] = logic.acCenter(s, band, part);
    assert.ok(x >= 0 && x < 480 && y >= 0 && y < 480, 'ellipse center in canvas');
  }
}
assert.ok(s.idle >= 1200, 'idle counter reaches 60 s');
const slow = s.phase;
logic.acStep(s, null);
assert.ok(Math.abs(s.phase - slow - 0.006) < 1e-9, 'idle drift is 0.3x');
logic.acWake(s);
const active = s.phase;
logic.acStep(s, null);
assert.ok(Math.abs(s.phase - active - 0.02) < 1e-9, 'touch wakes full speed');
console.log('PASS centers, 20 Hz speed cap, 60 s idle drift x0.3 and wake');
for (let theme = 0; theme < 3; theme++) for (let tick = 0; tick < 1400; tick++) {
  const row = logic.acPalette(theme, tick, tick % 3);
  assert.equal(row.length, 4);
  for (const color of row) assert.ok(logic.AC_LUT[theme].some(p => p.includes(color)));
}
assert.equal(logic.AC_LUT[0][0][0], logic.AC_KEYS[0][0][0]);
assert.notEqual(logic.AC_LUT[0][4][0], logic.AC_KEYS[0][0][0]);
assert.notEqual(logic.AC_LUT[0][4][0], logic.AC_KEYS[0][1][0]);
console.log('PASS palette lookup interpolates only precomputed colors');
const d0 = new Date(2026, 10, 18, 12, 34, 5);
assert.equal(logic.acClock(s, d0), true);
assert.equal(s.timeText, '12:34');
assert.equal(logic.acClock(s, new Date(2026, 10, 18, 12, 34, 59)), false);
assert.equal(logic.acClock(s, new Date(2026, 10, 18, 12, 35, 0)), true);
assert.equal(s.timeText, '12:35');
console.log('PASS clock text changes on minute boundary only');
const ui = runApp(APP);
const countDraw = messages => messages.filter(m => m[0] === 'draw' || m[0] === 'spriteDraw' || m[0] === 'pathDraw').length +
  messages.filter(m => m[0] === 'batch').reduce((n, m) => n + m[2].length / 6, 0);
assert.ok(ui.messages.some(m => m[0] === 'create'), 'prelude created UI');
assert.ok(countDraw(ui.messages) <= 35, 'initial draw call budget');
let maxCalls = 0;
for (let i = 0; i < 20; i++) {
  ui.ctx.acStep(ui.ctx.ac, null);
  const before = ui.messages.length;
  ui.ctx.acFrame.set(ui.ctx.acFrame() + 1);
  const frame = ui.messages.slice(before);
  const calls = countDraw(frame);
  maxCalls = Math.max(maxCalls, calls);
  assert.ok(calls <= 35, 'frame ' + i + ' draw calls=' + calls);
  assert.ok(frame.some(m => m[0] === 'invalidate'), 'frame invalidates canvas');
  assert.ok(!frame.some(m => m[0] === 'attr' && m[2] === 0), 'no per-frame text writes');
}
assert.ok(ui.ctx.ac.phase > 0, 'null IMU keeps animation alive');
const originalMinute = ui.ctx.ac.minute;
ui.ctx.acClock(ui.ctx.ac, new Date(2026, 10, 18, 10, 41));
assert.notEqual(ui.ctx.ac.minute, originalMinute);
const minuteBefore = ui.messages.length;
ui.ctx.acTime.set(ui.ctx.ac.timeText); ui.ctx.acDate.set(ui.ctx.ac.date);
ui.ctx.acFrame.set(ui.ctx.acFrame() + 1);
const minuteMessages = ui.messages.slice(minuteBefore);
assert.ok(minuteMessages.some(m => m[0] === 'attr' && m[2] === 0), 'minute writes Text');
assert.equal(minuteMessages.filter(m => m[0] === 'spriteDefine').length, 1, 'one glyph upload per minute');
assert.ok(countDraw(minuteMessages) <= 35, 'minute frame budget');
const oldTheme = ui.ctx.ac.theme;
ui.gesture(ui.ctx.acRoot, 0, 240, 240, 1000);
ui.gesture(ui.ctx.acRoot, 2, 240, 240, 1050);
assert.equal(ui.ctx.ac.theme, (oldTheme + 1) % 3, 'tap cycles theme');
assert.ok(ui.ctx.ac.ripple > 0, 'tap starts ripple');
const before = ui.messages.length;
ui.ctx.acFrame.set(ui.ctx.acFrame() + 1);
assert.ok(countDraw(ui.messages.slice(before)) <= 35, 'ripple budget');
console.log('PASS prelude/no IMU, per-frame draw calls max=' + maxCalls + ', ripple <=35');
console.log('ALL AURORA CLOCK CASES PASSED');
