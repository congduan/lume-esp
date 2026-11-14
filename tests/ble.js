// Host harness for the r25 BLE first slice. Standalone CommonJS script:
//   node tests/ble.js
// Two layers: (1) static wiring checks so the C component / QuickJS natives /
// sdkconfig / .d.ts / docs cannot drift apart on a host without ESP-IDF;
// (2) the shipped example running against an injected lume.ble stand-in.
// This is NOT a firmware build and proves nothing about the radio.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert');
const { runApp } = require('./lib/prelude_runner');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

// --- 1. wiring -----------------------------------------------------------
const header = read('firmware/components/lume-ble/include/lume_ble.h');
for (const macro of ['LUME_BLE_OK', 'LUME_BLE_ERR_ARG', 'LUME_BLE_ERR_DRIVER',
                     'LUME_BLE_ERR_STATE', 'LUME_BLE_PAYLOAD_MAX',
                     'LUME_BLE_RX_SLOTS', 'LUME_BLE_NAME_MAX']) {
  assert.match(header, new RegExp('#define\\s+' + macro + '\\b'),
               'lume_ble.h is missing ' + macro);
}
assert.match(header, /LUME_BLE_PAYLOAD_MAX\s+20/);
assert.match(header, /int lume_ble_read\(/);
assert.match(read('firmware/components/lume-ble/CMakeLists.txt'), /REQUIRES bt nvs_flash/);
assert.match(read('firmware/components/lume-engine/CMakeLists.txt'), /lume-ble/);
assert.match(read('firmware/main/CMakeLists.txt'), /lume-ble/);

const defaults = read('firmware/sdkconfig.defaults');
for (const cfg of ['CONFIG_BT_ENABLED=y', 'CONFIG_BT_NIMBLE_ENABLED=y',
                   'CONFIG_BT_BLUEDROID_ENABLED=n']) {
  assert.ok(defaults.includes(cfg), 'sdkconfig.defaults is missing ' + cfg);
}

const engine = read('firmware/components/lume-engine/lume_engine.c');
assert.ok(engine.includes('#include "lume_ble.h"'));
for (const fn of ['init', 'start', 'stop', 'status', 'write', 'read']) {
  assert.match(engine, new RegExp('JS_SetPropertyStr\\(ctx, ble, "' + fn + '"'),
               'lume.ble.' + fn + ' is not registered');
}
for (const constant of ['IDLE', 'ADVERTISING', 'CONNECTED', 'MAX_PAYLOAD']) {
  assert.ok(engine.includes('"' + constant + '"'), 'missing constant ' + constant);
}
assert.ok(!/register_bindings[\s\S]{0,20000}?lume_ble_init\(\);/.test(
  engine.slice(engine.indexOf('static void register_bindings'))),
  'BLE stack must stay lazy (no lume_ble_init() in register_bindings)');

const dts = read('runtime/types/lume.d.ts');
assert.match(dts, /declare namespace lume\.ble \{/);
assert.match(dts, /const ble: typeof lume\.ble;/);
const bleBlock = dts.slice(dts.indexOf('declare namespace lume.ble {'))
  .split('\n}\n')[0];
for (const fn of ['init', 'start', 'stop', 'status', 'write', 'read']) {
  assert.match(bleBlock, new RegExp('function\\s+' + fn + '\\('),
               'lume.d.ts is missing lume.ble.' + fn);
}
for (const member of ['state', 'connected', 'subscribed', 'mtu', 'pending']) {
  assert.match(bleBlock, new RegExp(member + '[?:]'), 'BleStatus is missing ' + member);
}
assert.match(read('docs/hardware-api.md'), /r25 implementation note/);
assert.match(read('docs/KNOWN-SIMPLIFICATIONS.md'), /## r25 \/ BLE peripheral first slice/);
console.log('PASS lume.ble wiring (header, CMake, sdkconfig, natives, types, docs)');

// --- 2. example behaviour against a host stand-in ------------------------
// The example walks OFF -> advertising -> connected -> LINKED: on the first
// poll of a live link it sends the "HELLO" handshake, and every inbound RX
// packet completes/keeps the link verified and is acked with "OK <msg>".
function makeSession(overrides = {}) {
  const calls = [];
  const ble = {
    start: name => { calls.push(['start', name]); return 0; },
    stop: () => { calls.push(['stop']); return 0; },
    status: () => ({ state: 2, connected: true, subscribed: true, mtu: 23, pending: 0 }),
    read: () => null,
    write: data => { calls.push(['write', data]); return 0; },
    ...overrides,
  };
  const session = runApp(read('examples/ble_uart/app.js'), { ble });
  let now = 0;
  session.lume._nowMs = () => now;
  return {
    session, calls,
    run: src => vm.runInContext(src, session.ctx),
    setNow: n => { now = n; },
    attrs: () => session.messages.filter(m => m[0] === 'attr').map(m => String(m[3])),
  };
}

const basic = makeSession();
basic.run('__lume_start()');
assert.deepStrictEqual(basic.calls, [['start', 'Lume']]);
assert.strictEqual(basic.calls.filter(c => c[0] === 'write').length, 0,
                   'nothing must be sent before the first poll tick');
basic.setNow(100);
basic.run('__lume_tick()');
assert.ok(basic.calls.some(c => c[0] === 'write' && c[1] === 'HELLO'),
          'the first poll of a live link must send the HELLO handshake');
assert.ok(basic.attrs().some(v => v.includes('connected')),
          'status() should feed the reactive link status Text');
console.log('PASS onStart advertises; first poll of a live link sends HELLO');

let incoming = null;
const echo = makeSession({
  read: () => { const v = incoming; incoming = null; return v; },
});
echo.run('__lume_start()');
incoming = 'hello';
echo.setNow(100);
echo.run('__lume_tick()');
assert.ok(echo.calls.some(c => c[0] === 'write' && c[1] === 'OK hello'),
          'the inbound handshake reply must be acked with OK <msg>');
assert.ok(echo.attrs().some(v => v.includes('hello')),
          'inbound RX packet must update the reactive last-rx Text');
assert.ok(echo.attrs().some(v => v.includes('verified')),
          'completing the handshake must update the link status Text');
console.log('PASS poll drains one RX packet, verifies the link and acks it');

const button = echo.session.messages.find(m => m[0] === 'create' && m[2] === 2);
assert.ok(button, 'example must create a Button node (the first is Ping)');
echo.session.press(button[1]);
assert.ok(echo.calls.some(c => c[0] === 'write' && c[1] === 'ping'),
          'Ping Button onPress must send a ping');
console.log('PASS Ping Button press sends a ping');

const fresh = makeSession();
fresh.run('__lume_start()');
const freshButton = fresh.session.messages.find(m => m[0] === 'create' && m[2] === 2);
fresh.session.press(freshButton[1]);
assert.ok(fresh.attrs().some(v => v === '1'),
          'Ping Button press must update the pings counter Text');
console.log('PASS Ping counter Text reflects the press');

incoming = -3;
echo.setNow(200);
echo.run('__lume_tick()');
assert.ok(echo.attrs().some(v => v.includes('BLE read error: -3')),
          'a negative read() result must be rendered, not thrown');
console.log('PASS negative read() status is handled by the app');

echo.run('__lume_shutdown()');
assert.ok(echo.calls.some(c => c[0] === 'stop'),
          'onPause must stop advertising before light sleep');
console.log('PASS onPause / shutdown stops advertising');

const failed = makeSession({ start: () => -2 });
failed.run('__lume_start()');
assert.ok(failed.attrs().some(v => v.includes('BLE start error: -2')),
          'a failed start() must be surfaced in the UI');
assert.strictEqual(failed.calls.filter(c => c[0] === 'write').length, 0);
console.log('PASS failed start() is surfaced without starting the poll timer');
