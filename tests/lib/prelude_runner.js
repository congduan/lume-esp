// Shared host entry point: extract the firmware's exact prelude, run an app,
// and retain the native message stream for harnesses and the browser simulator.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'firmware/components/lume-engine/lume_scripts.c'), 'utf8');
function extract(name, next) {
  const start = `const char ${name}[] =\n`;
  const part = source.split(start)[1];
  if (!part) throw new Error(`missing ${name}`);
  const block = next ? part.split(`\n\nconst char ${next}`)[0] : part.split(';\n')[0];
  return [...block.matchAll(/^"(?:\\.|[^"\\])*"/gm)].map(m => JSON.parse(m[0])).join('');
}
const prelude = extract('lume_prelude_js', 'lume_demo_js');
const demo = extract('lume_demo_js');

function runApp(script, options = {}) {
  const messages = [];
  let nextId = 0, token = 0;
  const emit = (...message) => { messages.push(message); options.onMessage?.(message); };
  const files = options.files || { '/': ['demo.txt', 'photos'], '/photos/': ['image.raw'] };
  const Fs = {
    list: p => [...(files[p] || [])],
    exists: p => p in files || (!p.endsWith('/') && Object.values(files).some(a => a.includes(p.split('/').at(-1)))),
    remove: p => { const dir = p.slice(0, p.lastIndexOf('/') + 1); files[dir] = (files[dir] || []).filter(n => n !== p.slice(dir.length)); return 0; },
    read: () => -2, write: () => -2,
  };
  const lume = {
    createNode: (kind, parent = 0, width = 0, height = 0) => { const id = ++nextId; emit('create', id, kind, parent, width, height); return id; },
    setAttr: (id, attr, value) => emit('attr', id, attr, value),
    removeChild: id => emit('remove', id),
    setPressEvent: id => emit('press', id),
    setGestureEvent: id => emit('gesture', id),
    canvasDraw: (...args) => emit('draw', ...args),
    canvasInvalidate: id => emit('invalidate', id),
    nativeAnimate: (...args) => { emit('animate', ...args); return ++token; },
    nativeAnimateCancel: (...args) => emit('cancelAnimate', ...args),
    _nowMs: () => Date.now(), log: (...args) => options.onLog?.(...args),
    imu: { read: () => null },
    pmic: {
      battPercent: () => 80, battVoltageMv: () => 3980, vbusVoltageMv: () => 5020,
      usbConnected: () => 1, chargingStatus: () => 2, dieTempRaw: () => 6900,
      powerOff: () => 0,
    },
    power: { _sleepNow: () => 0, _wake: () => 0 }, net: { deinit: () => 0 },
    // Host-side BLE stand-in: no radio, no stack. Harnesses can override any
    // method with options.ble (see tests/ble.js); the simulator uses these.
    ble: {
      IDLE: 0, ADVERTISING: 1, CONNECTED: 2, MAX_PAYLOAD: 20,
      init: () => 0, start: () => 0, stop: () => 0,
      status: () => ({ state: 1, connected: false, subscribed: false, mtu: 23, pending: 0 }),
      write: () => 0, read: () => null,
      ...(options.ble || {}),
    },
    storage: { Fs, mounted: () => true },
    image: { sizeOf: () => -1, _setSource: () => -1 },
  };
  const ctx = vm.createContext({ lume, Fs, console, setTimeout, clearTimeout, ArrayBuffer, Uint8Array });
  vm.runInContext(prelude, ctx, { filename: 'lume_prelude.js' });
  vm.runInContext(script, ctx, { filename: options.filename || 'app.js' });
  return {
    messages, ctx, lume,
    press: id => vm.runInContext(`__lume_dispatchPress(${Number(id)})`, ctx),
    scroll: (id, y) => vm.runInContext(`__lume_dispatchScroll(${Number(id)},${Number(y)})`, ctx),
    gesture: (id, kind, x, y, t, dir = 0, cancelled = 0) =>
      vm.runInContext(`__lume_dispatchGesture(${[id,kind,x,y,t,dir,cancelled].map(Number).join(',')})`, ctx),
    removed: id => vm.runInContext(`__lume_dispatchRemove(${Number(id)})`, ctx),
  };
}
module.exports = { extract, prelude, demo, runApp };
