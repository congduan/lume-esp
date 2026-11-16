/* Browser host based on tests/lib/prelude_runner.js. Hardware APIs return host stand-ins. */
(function (global) {
  function createSession(script, options = {}) {
    const messages = [];
    let nextId = 0, token = 0, alive = true;
    const emit = (...message) => {
      if (!alive) return;
      messages.push(message);
      options.onMessage?.(message);
    };
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
    image: {
      /* Browser SVG support: sizeOf parses width/height attrs (default 100x100
       * viewBox convention); _setSource rasterises the SVG via an <img> and
       * hands the bitmap to the renderer through LUME_IMAGE_BITMAPS[nodeId]. */
      sizeOf: bytes => {
        try {
          const text = new TextDecoder().decode(bytes);
          const w = /width\s*=\s*"(\d+)/.exec(text), h = /height\s*=\s*"(\d+)/.exec(text);
          return { width: w ? +w[1] : 100, height: h ? +h[1] : 100 };
        } catch (e) { return -2; }
      },
      _setSource: (id, bytes) => {
        try {
          const text = new TextDecoder().decode(bytes);
          const img = new Image();
          img.onload = () => {
            const c = document.createElement('canvas');
            c.width = img.width || 100; c.height = img.height || 100;
            c.getContext('2d').drawImage(img, 0, 0);
            if (!globalThis.LUME_IMAGE_BITMAPS) globalThis.LUME_IMAGE_BITMAPS = {};
            globalThis.LUME_IMAGE_BITMAPS[id] = c;
            const mount = () => {
              const host = document.querySelector('#device [data-node-id="' + id + '"]');
              if (host && !host.querySelector('canvas')) { host.textContent = ''; host.appendChild(c.cloneNode ? c : c); }
            };
            mount();
            setTimeout(mount, 100); setTimeout(mount, 400); /* node may attach after decode */
          };
          img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text);
          return 0;
        } catch (e) { return -2; }
      },
    },
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

    const __lumeScreen = { w: 480, h: 480 };
    // Prelude and app share one function scope, like the firmware global script.
    // The only injected names are the native bindings and screen size.
    const evaluate = new Function('lume', 'Fs', '__lumeScreen', 'setTimeout', 'clearTimeout',
      global.LUME_PRELUDE + '\n' + script + '\n' +
      'return { press: __lume_dispatchPress, scroll: __lume_dispatchScroll, ' +
      'gesture: __lume_dispatchGesture, tick: __lume_tick, shutdown: __lume_shutdown, start: __lume_start };');
    const api = evaluate(lume, Fs, __lumeScreen, setTimeout, clearTimeout);
    api.start();
    const tick = setInterval(() => {
      if (!alive) return;
      try { api.tick(); } catch (error) { alive = false; clearInterval(tick); options.onError?.(error); }
    }, 20);
    return {
      messages,
      press: id => alive && api.press(Number(id)),
      scroll: (id, y) => alive && api.scroll(Number(id), Number(y)),
      gesture: (id, kind, x, y, t, dir = 0, cancelled = 0) =>
        alive && api.gesture(...[id, kind, x, y, t, dir, cancelled].map(Number)),
      destroy: () => { if (!alive) return; alive = false; clearInterval(tick); api.shutdown(); },
    };
  }
  global.LumePlaygroundSession = createSession;
})(window);
