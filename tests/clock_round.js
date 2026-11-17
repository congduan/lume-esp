const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { runApp } = require('./lib/prelude_runner');
const source = fs.readFileSync('examples/clock_round/app.js', 'utf8');
const pure = vm.createContext({});
vm.runInContext(source.split('/* GAME UI */')[0], pure);
function angles(h, m, s) { return JSON.parse(JSON.stringify(pure.clockAngles(h, m, s))); }
assert.deepEqual(angles(12, 0, 0), { hour: 0, minute: 0, second: 0 });
assert.equal(angles(3, 0, 0).hour, 90);
assert.equal(angles(6, 30, 0).minute, 180);
assert.equal(angles(6, 30, 0).hour, 195);
const ui = runApp(source);
assert.equal(ui.messages.filter(m => m[0] === 'invalidate').length > 0, true);
function budget() {
  const start = ui.messages.length;
  ui.ctx.clockTick();
  const frame = ui.messages.slice(start);
  const count = frame.reduce((n, m) => n + (m[0] === 'draw' ? 1 : m[0] === 'batch' ? m[2].length / 6 : 0), 0);
  assert.ok(count < 200, `clock draw calls ${count}`);
  assert.ok(frame.some(m => m[0] === 'invalidate'));
  assert.ok(!frame.some(m => JSON.stringify(m).includes('NaN')));
  return count;
}
const count = budget();
for (let i = 0; i < 60; i++) {
  const a = angles(12, 0, i);
  assert.equal(a.second, i * 6);
  assert.ok(Number.isFinite(a.hour) && Number.isFinite(a.minute));
  ui.ctx.clockState.set({ h: 12, m: 0, s: i });
  assert.ok(!ui.messages.slice(-150).some(m => JSON.stringify(m).includes('NaN')));
}
console.log(`PASS clock_round pure angles, prelude, ${count} calls/frame, 60-second tick smoke`);
