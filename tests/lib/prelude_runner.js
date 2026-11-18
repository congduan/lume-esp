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

  function imgscaleStub() {
    const isU16 = value => Object.prototype.toString.call(value) === '[object Uint16Array]';
    const MAX = 16384, FP = 256;
    const axisNearest = (d, dsize, ssize) => {
      let pos = Math.floor((2 * d + 1) * ssize / (2 * dsize));
      return pos < 0 ? 0 : pos >= ssize ? ssize - 1 : pos;
    };
    const axisBilinear = (d, dsize, ssize) => {
      let pos = Math.floor((2 * d + 1) * ssize * FP / (2 * dsize)) - FP / 2;
      const hi = (ssize - 1) * FP;
      return pos < 0 ? 0 : pos > hi ? hi : pos;
    };
    const lerp = (p00, p10, p01, p11, fx, fy) => {
      const gx = FP - fx, gy = FP - fy;
      const w00 = gx * gy, w10 = fx * gy, w01 = gx * fy, w11 = fx * fy;
      const ch = (shift, mask) => {
        const v = (((p00 >> shift) & mask) * w00 + ((p10 >> shift) & mask) * w10 +
          ((p01 >> shift) & mask) * w01 + ((p11 >> shift) & mask) * w11 + 32768) >> 16;
        return v < 0 ? 0 : v > mask ? mask : v;
      };
      return ((ch(11, 31) << 11) | (ch(5, 63) << 5) | ch(0, 31)) & 0xffff;
    };
    return {
      scale(src, sw, sh, dst, dw, dh, mode) {
        if (!isU16(src) || !isU16(dst)) return -1;
        if (mode !== undefined && mode !== 'nearest' && mode !== 'bilinear') return -1;
        const [swi, shi, dwi, dhi] = [sw, sh, dw, dh].map(d => Number(d));
        if ([swi, shi, dwi, dhi].some(d => !Number.isInteger(d) || d < 1 || d > MAX)) return -2;
        if (swi > src.length || shi > Math.floor(src.length / swi) ||
            dwi > dst.length || dhi > Math.floor(dst.length / dwi)) return -2;
        const overlap = src.buffer === dst.buffer &&
          src.byteOffset < dst.byteOffset + dwi * dhi * 2 &&
          dst.byteOffset < src.byteOffset + swi * shi * 2;
        const inPlace = src.buffer === dst.buffer && src.byteOffset === dst.byteOffset &&
          swi === dwi && shi === dhi;
        if (overlap && !inPlace) return -2;
        const bilinear = mode === 'bilinear';
        for (let y = 0; y < dhi; y++) {
          if (!bilinear) {
            const sy = axisNearest(y, dhi, shi);
            for (let x = 0; x < dwi; x++) dst[y * dwi + x] = src[sy * swi + axisNearest(x, dwi, swi)];
          } else {
            const sy = axisBilinear(y, dhi, shi);
            const y0 = sy >> 8, fy = sy & 255, y1 = Math.min(y0 + 1, shi - 1);
            for (let x = 0; x < dwi; x++) {
              const sx = axisBilinear(x, dwi, swi);
              const x0 = sx >> 8, fx = sx & 255, x1 = Math.min(x0 + 1, swi - 1);
              dst[y * dwi + x] = lerp(src[y0 * swi + x0], src[y0 * swi + x1],
                src[y1 * swi + x0], src[y1 * swi + x1], fx, fy);
            }
          }
        }
        return 0;
      },
    };
  }

// No PNG/JPEG decoder in the host stub: deterministic RGB565 pattern with the
// same shape/marshalling contract as the native lume.image.decode binding.
function imageDecodeStub() {
  const isAB = v => Object.prototype.toString.call(v) === '[object ArrayBuffer]';
  const dim = d => Number.isInteger(d) && d >= 1 && d <= 16384;
  return (bytes, maxW, maxH) => {
    if (!isAB(bytes) || bytes.byteLength === 0) return -2;
    const hasW = maxW !== undefined && maxW !== null;
    const hasH = maxH !== undefined && maxH !== null;
    if (hasW !== hasH) return -1;
    if (hasW && (!dim(maxW) || !dim(maxH))) return -2;
    const w = hasW ? maxW : 1, h = hasH ? maxH : 1;
    const pixels = new Uint16Array(w * h);
    for (let i = 0; i < pixels.length; i++)
      pixels[i] = (((i * 7) & 31) << 11) | (((i * 11) & 63) << 5) | ((i * 13) & 31);
    return {width: w, height: h, pixels};
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
  // r91: mbedTLS does not exist in the host prelude. Keep the lume.crypto
  // shape and return -3 (internal/unsupported) instead of faking
  // cryptographic results; pass options.crypto to inject an implementation.
  function cryptoStub() {
    const unsupported = name => () => {
      options.onWarn?.(`lume.crypto.${name} unsupported in host (no mbedTLS); returning -3`);
      return -3;
    };
    return {
      sha256: unsupported('sha256'),
      hmacSha256: unsupported('hmacSha256'),
      crc32: unsupported('crc32'),
      aesCtr: unsupported('aesCtr'),
      ...(options.crypto || {}),
    };
  }
  // r92: no synchronous DEFLATE decoder is wired into the host prelude. Keep
  // the lume.compress shape and return -3 (unsupported); pass options.compress
  // to inject an implementation. The authoritative path is the native build.
  function compressStub() {
    return {
      inflate: () => {
        options.onWarn?.('lume.compress.inflate unsupported in host (no native inflate); returning -3');
        return -3;
      },
      ...(options.compress || {}),
    };
  }
  const lume = {
    fft: fftStub(),
    imgscale: imgscaleStub(),
    crypto: cryptoStub(),
    compress: compressStub(),
    // r96: no real OTA channel in the host runner; status() mirrors net.otaStatus.
    ota: {
      status: () => ({ running: false, wifiReady: false, tokenReady: false, hmac: true, port: 8765, token: '' }),
      setToken: () => -3,
    },
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
    // r81 retained sprites: DEFINE uploads RGB565 pixels once, DRAW replays.
    canvasSpriteDefine: (id, sprite, w, h, px) => emit('spriteDefine', id, sprite, w, h, [...px]),
    canvasSpriteDraw: (id, sprite, dx, dy, flip) => emit('spriteDraw', id, sprite, dx, dy, flip),
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
      otaStatus: () => ({ running: false, wifiReady: false, tokenReady: false, hmac: true, port: 8765, token: '' }),
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
    image: { sizeOf: bytes => -1, decode: imageDecodeStub(), _setSource: (id, bytes, width, height) => -1 },
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
  // Uint16Array is injected so stub-produced typed arrays (lume.image.decode /
  // imgscale results) share a constructor with the app's instanceof checks.
  const ctx = vm.createContext({ lume, Fs, console, setTimeout, clearTimeout, ArrayBuffer, DataView, Uint8Array, Uint16Array, __lumeScreen });
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
