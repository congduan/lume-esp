const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runApp } = require('./lib/prelude_runner');

async function main() {
  const script = fs.readFileSync(path.join(__dirname, '../examples/async_demo/app.js'), 'utf8');
  const logs = [];
  const app = runApp(script, { onLog: value => logs.push(value) });
  const press = app.messages.find(message => message[0] === 'press');
  assert.ok(press, 'async demo has a press callback');
  assert.equal(app.ctx.status(), 'Ready');

  app.press(press[1]);
  assert.equal(app.ctx.status(), 'Waiting');
  await Promise.resolve(); // Node vm microtasks; firmware execution is checked by esp32sim.
  assert.equal(app.ctx.status(), 'Done');
  assert.ok(app.messages.some(message => message[0] === 'attr' && message[2] === 0 && message[3] === 'Done'),
    'signal setter after await updates the Text node');
  assert.ok(logs.includes('ASYNC_DEMO_PRESS_AWAIT_OK'));

  const basic = runApp("var out = ''; (async function () { out = await Promise.resolve('ok'); })();");
  await Promise.resolve();
  assert.equal(basic.ctx.out, 'ok');
  console.log('async jobs host prelude: PASS');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
