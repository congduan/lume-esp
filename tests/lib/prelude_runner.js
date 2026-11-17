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

  function fftStub() {
    const isFloat32 = value => Object.prototype.toString.call(value) === '[object Float32Array]';
    const valid = n => n >= 2 && n <= 4096 && (n & (n - 1)) === 0;
    return {
      realfft(input, output = input) {
        if (!(isFloat32(input)) || !(isFloat32(output))) return -1;
        const n = input.length;
        if (!valid(n) || output.length !== n) return -2;
        if (output !== input) output.set(input);
        const im = new Float32Array(n);
        let j = 0;
        for (let i = 1; i < n; i++) {
          let bit = n >> 1;
          while (j & bit) { j ^= bit; bit >>= 1; }
          j ^= bit;
          if (i < j) { const tmp = output[i]; output[i] = output[j]; output[j] = tmp; }
        }
        for (let width = 2; width <= n; width <<= 1) {
          const angle = -2 * Math.PI / width;
          const stepRe = Math.cos(angle), stepIm = Math.sin(angle);
          for (let start = 0; start < n; start += width) {
            let twRe = 1, twIm = 0;
            for (let k = 0; k < width / 2; k++) {
              const a = start + k, b = a + width / 2;
              const vr = twRe * output[b] - twIm * im[b];
              const vi = twRe * im[b] + twIm * output[b];
              const ur = output[a], ui = im[a];
              output[a] = ur + vr; im[a] = ui + vi;
              output[b] = ur - vr; im[b] = ui - vi;
              const nextRe = twRe * stepRe - twIm * stepIm;
              twIm = twRe * stepIm + twIm * stepRe;
              twRe = nextRe;
            }
          }
        }
        const nyquist = output[n / 2];
        for (let k = n / 2 - 1; k > 0; k--) {
          output[2 * k] = output[k]; output[2 * k + 1] = im[k];
        }
        output[1] = nyquist;
        return 0;
      },
      magnitude(out, re, im) {
        if (!(isFloat32(out)) || !(isFloat32(re)) ||
            (im !== undefined && !(isFloat32(im)))) return -1;
        const split = im !== undefined, n = split ? re.length * 2 : re.length;
        if (!valid(n) || out.length !== n / 2 || (split && im.length !== re.length)) return -2;
        const overlaps = x => out.buffer === x.buffer &&
          out.byteOffset < x.byteOffset + x.byteLength && x.byteOffset < out.byteOffset + out.byteLength;
        if (overlaps(re) || (split && overlaps(im))) return -2;
        out[0] = Math.abs(re[0]);
        for (let k = 1; k < n / 2; k++)
          out[k] = Math.hypot(split ? re[k] : re[2 * k], split ? im[k] : re[2 * k + 1]);
        return 0;
      },
    };
  }

function runApp(script, options = {}) {
  const messages = [];
  let nextId = 0, token = 0;
  const emit = (...message) => { messages.push(message); options.onMessage?.(message); };
  const files = options.files || { '/': ['demo.txt', 'photos'], '/photos/': ['image.raw'] };
  const Fs = {
    mounted: () => true,
    list: p => [...(files[p] || [])],
    exists: p => p in files || (!p.endsWith('/') && Object.values(files).some(a => a.includes(p.split('/').at(-1)))),
    remove: p => { const dir = p.slice(0, p.lastIndexOf('/') + 1); files[dir] = (files[dir] || []).filter(n => n !== p.slice(dir.length)); return 0; },
    read: () => -2, write: () => -2, append: () => -2, mkdir: () => 0,
    readBinary: () => -2,
  };
  // r30 multi-app store stand-in: options.apps = { id: {label,icon,color} }.
  const installedApps = { ...(options.apps || {}) };
  let currentApp = options.currentApp || '';
  let bootPin = options.bootPin || '';
  const lume = {
    fft: fftStub(),
    createNode: (kind, parent = 0, width = 0, height = 0) => { const id = ++nextId; emit('create', id, kind, parent, width, height); return id; },
    setAttr: (id, attr, value) => emit('attr', id, attr, value),
    removeChild: id => emit('remove', id),
    setPressEvent: id => emit('press', id),
    setGestureEvent: id => emit('gesture', id),
    canvasDraw: (...args) => emit('draw', ...args),
    canvasBatch: (id, lines) => emit('batch', id, [...lines]),
    // Retained paths: DEFINE uploads geometry once, DRAW replays it in C.
    canvasPathDefine: (id, path, lines) => emit('pathDefine', id, path, [...lines]),
    canvasPathDraw: (id, path, dx, dy) => emit('pathDraw', id, path, dx, dy),
    // Same arity as the native: (id) for a full canvas, (id, x, y, w, h) for a
    // dirty rect. Harnesses rely on the rect to check the redraw budget.
    canvasInvalidate: (...args) => emit('invalidate', ...args),
    nativeAnimate: (...args) => { emit('animate', ...args); return ++token; },
    nativeAnimateCancel: (...args) => emit('cancelAnimate', ...args),
    _nowMs: () => Date.now(), log: (...args) => options.onLog?.(...args),
    warn: (...args) => options.onWarn?.(...args),
    // Host-side IMU stand-in: read() returns null (no sensor) unless a harness
    // injects samples, mirroring the native failure contract.
    imu: { read: () => null, ...(options.imu || {}) },
    pmic: {
      battPercent: () => 80, battVoltageMv: () => 3980, vbusVoltageMv: () => 5020,
      usbConnected: () => 1, chargingStatus: () => 2, dieTempRaw: () => 6900,
      powerOff: () => 0,
    },
    power: { _sleepNow: () => 0, _wake: () => 0 },
    net: {
      DISCONNECTED: 0, CONNECTING: 1, CONNECTED: 2, GOT_IP: 3,
      init: () => 0, deinit: () => 0, connect: () => 0, disconnect: () => 0,
      status: () => ({ state: 0, ip: null }),
      otaStatus: () => ({ running: false, wifiReady: false, tokenReady: false, port: 8765, token: '' }),
      httpGet: () => -3,
      ws: { _connect: () => -3, _send: () => -1, _close: () => -1 },
      // r71 local web server natives (mock C layer); harnesses override via
      // options.net.web. The prelude adds public start/stop/on/url on top.
      web: { _start: () => 0, _stop: () => 0, _url: () => null },
      // Host-side scan stand-in (no radio): two fake APs, RSSI-sorted.
      scan: () => [
        { ssid: 'Demo-AP', rssi: -42, auth: 3 },
        { ssid: 'OpenNet', rssi: -60, auth: 0 },
      ],
      httpRequest: () => -3,
      ...(options.net || {}),
    },
    // Host-side BLE stand-in: no radio, no stack. Harnesses can override any
    // method with options.ble (see tests/ble.js); the simulator uses these.
    ble: {
      IDLE: 0, ADVERTISING: 1, CONNECTED: 2, MAX_PAYLOAD: 20,
      init: () => 0, start: () => 0, stop: () => 0,
      status: () => ({ state: 1, connected: false, subscribed: false, mtu: 23, pending: 0 }),
      write: () => 0, read: () => null,
      ...(options.ble || {}),
    },
    storage: {
      Fs, mounted: () => true,
      kv: { set: () => 0, get: () => null, remove: () => 0, keys: () => [], clear: () => 0,
            ...(options.kv || {}) },
    },
    // Host-side multi-app stand-in. list()/meta() mirror the native contract
    // (meta returns the JSON text, -4 when absent); launch()/home() only RECORD
    // the request — the host harness never tears a runtime down.
    apps: {
      list: () => Object.keys(installedApps),
      meta: id => (id in installedApps ? JSON.stringify(installedApps[id]) : -4),
      current: () => currentApp,
      setBoot: id => {
        if (typeof id !== 'string' ||
            (id !== '' && !/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,30}$/.test(id))) return -5;
        if (options.setBootStatus != null) return options.setBootStatus;
        bootPin = id;
        emit('setBoot', id);
        return 0;
      },
      launch: id => { emit('launch', id); currentApp = id; options.onLaunch?.(id); return 0; },
      home: () => { emit('home'); currentApp = ''; return 0; },
      remove: id => {
        if (!(id in installedApps)) return -4;
        delete installedApps[id];
        return 0;
      },
      mounted: () => true,
    },
    gpio: {
      setPin: () => 0, write: () => 0, read: () => 1, toggle: () => 0,
      pwmAttach: () => 0, pwmDuty: () => 0, pwmFree: () => 0,
    },
    image: { sizeOf: bytes => -1, _setSource: (id, bytes, width, height) => -1 },
    audio: {
      play: () => 0, record: () => -3, setVolume: () => 0, stop: () => 0,
      playStream: () => 0, streamFinished: () => true,
      streamPause: () => 0, streamReset: () => 0,
      mp3: {
        list: path => path === '/music' ? ['demo-one.mp3', 'demo-two.mp3'] : -2,
        open: () => 0, close: () => 0,
        decode: () => ({pcm:new ArrayBuffer(4608),samples:1152,
          sampleRate:44100,channels:2,bitrateKbps:128,
          byteOffset:1024,fileBytes:65536}),
        id3v1: p => ({title:p.includes('one') ? 'Demo One' : 'Demo Two',artist:'Lume Demo'}),
        id3v2: () => null,
        readText: () => '[00:00.00]First line\n[00:01.00]Second line\n[00:02.00]Third line',
      },
      ...(options.audio || {}),
    },
  };
  // Mirror the native global injected after bindings and before prelude eval.
  // The simulator uses this runner too; tests may supply another board size.
  const __lumeScreen = options.screen || { w: 480, h: 480 };
  // DataView is a QuickJS built-in on the board and the PCM beeps use it; the
  // host context must provide it or an app's tick path throws only on host.
  const ctx = vm.createContext({ lume, Fs, console, setTimeout, clearTimeout, ArrayBuffer, DataView, Uint8Array, __lumeScreen });
  vm.runInContext(prelude, ctx, { filename: 'lume_prelude.js' });
  vm.runInContext(script, ctx, { filename: options.filename || 'app.js' });
  return {
    messages, ctx, lume,
    bootPin: () => bootPin,
    press: id => vm.runInContext(`__lume_dispatchPress(${Number(id)})`, ctx),
    scroll: (id, y) => vm.runInContext(`__lume_dispatchScroll(${Number(id)},${Number(y)})`, ctx),
    gesture: (id, kind, x, y, t, dir = 0, cancelled = 0) =>
      vm.runInContext(`__lume_dispatchGesture(${[id,kind,x,y,t,dir,cancelled].map(Number).join(',')})`, ctx),
    removed: id => vm.runInContext(`__lume_dispatchRemove(${Number(id)})`, ctx),
  };
}
module.exports = { extract, prelude, demo, runApp };
