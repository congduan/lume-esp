<div align="center">

# Lume

**Write your entire ESP32-S3 AMOLED app in JavaScript. No C, no rebuild, no heavyweight framework on the developer's side.**

*Declarative UI · Signals reactivity · Flex layout · Hot reload · Full hardware access — powered by QuickJS-NG + LVGL under the hood*

> **Mission**: bring the most modern frontend technology (declarative components, signals reactivity, flex layout, hot reload, TypeScript tooling) to ESP32 — using the *least* possible device resources (QuickJS bytecode, dirty-rect LVGL rendering, PSRAM-managed heaps) — to deliver the *best* embedded development experience (seconds to see a change, zero C toolchain on the app developer's machine).

</div>

---

## Why Lume

Traditional embedded UI development on the ESP32-S3 looks like this: C/C++, a full
rebuild-and-flash cycle for every change, and an imperative UI API (LVGL) where every
widget is created, styled, positioned, and destroyed by hand.

Lume replaces that loop:

| | Traditional (C + LVGL) | Lume |
|---|---|---|
| Language | C/C++ | **JavaScript / TypeScript** |
| UI style | Imperative widget tree | **Declarative + signals (state → view)** |
| Layout | Manual coordinate math | **CSS-style flex (column/row/justify/gap/padding/%)** |
| Iteration | Rebuild + flash (minutes) | **Hot reload over USB (seconds)** |
| Hardware access | ESP-IDF APIs | **Clean JS APIs: GPIO/PWM/ADC/Power/IMU/Audio/WiFi/HTTP/KV/Files** |
| Runtime overhead | none | QuickJS-NG on 8MB PSRAM — fine for app-layer UI |

## Architecture

```
┌────────────────────────────────────────────────────┐
│  Your app — pure JS/TS                             │
│    declarative UI (signals → view)                 │
│    hardware APIs (gpio/imu/audio/power/net/storage)│
├────────────────────────────────────────────────────┤
│  Lume runtime (C, ESP-IDF components)              │
│    QuickJS-NG engine (PSRAM heap, event loop)      │
│    signals prelude · declarative → LVGL bridge     │
│    hot-reload channel (USB serial)                 │
├────────────────────────────────────────────────────┤
│  LVGL (render backend, hidden) · ESP-IDF           │
│    CO5300 QSPI AMOLED · CST9220 touch · AXP2101    │
│    QMI8658 IMU · ES8311/ES7210 audio · WiFi · TF   │
└────────────────────────────────────────────────────┘
```

LVGL never leaks into app code. It is a rendering backend, the way UIKit sits behind
React Native.

## Quick Start

With Node.js 18+ and Lume firmware on the board:

```bash
npm ci --prefix tools/lume
node tools/lume/lume.js create my-app
node tools/lume/lume.js dev my-app
```

Edit `my-app/app.js` to see each saved change on screen. Use `--port /dev/ttyACM0` if the USB Serial/JTAG port is not detected automatically. For a one-time push, run `node tools/lume/lume.js deploy my-app`. See [build and development](docs/build.md) for protocol details and controls.

## Examples

### 1. Hello Lume — signals-driven counter

The "hello world" that proves the whole loop: touch → signal → screen.

```js
const count = signal(0);

View({ style: {
  display: 'flex', flexDirection: 'column',
  justifyContent: 'center', alignItems: 'center',
  width: '100%', height: '100%', gap: 16,
  background: '#0B1E3F', borderRadius: 12,
}}, [
  Text({ text: () => 'taps: ' + count(), style: { color: '#FFFFFF' } }),
  Button({ title: '+1', onPress: () => count.set(count() + 1) }),
]);
```

No `setState`, no re-render, no diff on the hot path: `count.set()` flows straight
into a native text update. Signals connect reactive values to on-screen attributes
directly.

### 2. Battery dashboard — hardware telemetry as UI

PMIC readings rendered with flex layout and percent sizing.

```js
const bat = signal(0);

function refresh() {
  bat.set(lume.pmic.battPercent());   // AXP2101 telemetry, ~µs native call
}

View({ style: { display: 'flex', flexDirection: 'column', padding: 24, gap: 12 } }, [
  Text({ text: 'Power', style: { color: '#88CCFF' } }),
  Text({ text: () => 'battery: ' + bat() + '%', style: { color: '#FFFFFF' } }),
  View({ style: { width: bat() > 20 ? '100%' : '20%', height: 8,
                  background: bat() > 20 ? '#44CC66' : '#CC4444', borderRadius: 4 } }),
  Button({ title: 'refresh', onPress: refresh }),
]);

refresh();
```

### 3. Motion lamp — IMU-driven color

QMI8658 accelerometer tilts the background color in real time.

```js
const bg = signal('#101010');
const tilt = signal(0);

View({ style: { width: '100%', height: '100%',
                background: () => bg(),          // signal-bound style
                display: 'flex', alignItems: 'center' } }, [
  Text({ text: () => 'tilt: ' + tilt(), style: { color: '#FFFFFF' } }),
]);

// read the IMU on a timer; each signal.set() updates only the bound attributes
function poll() {
  const s = lume.imu.read();            // { acc:[x,y,z], gyro:[x,y,z] } | null
  if (s) {
    const t = Math.min(255, Math.abs(Math.round(s.acc[0] * 100)));
    tilt.set(t);
    bg.set('#0000' + t.toString(16).padStart(2, '0'));
  }
}
```

### 4. Weather card — WiFi + HTTP in five lines

Station connect, synchronous GET, declarative render.

```js
lume.net.init();
lume.net.connect('SSID', 'password');
// connect is non-blocking: poll status() until GOT_IP, then:
const res = lume.net.httpGet('http://api.example.com/weather', { timeoutMs: 8000 });
if (typeof res === 'object' && res.status === 200) {
  Text({ text: 'temp: ' + JSON.parse(res.body).temp + '°C',
         style: { color: '#FFFFFF' } });
} else {
  Text({ text: 'weather unavailable', style: { color: '#FF6666' } });
}
```

### 5. Voice memo — mic record + TF-card file + playback

ES7210 mic → PSRAM buffer → LittleFS on the 32GB TF card → ES8311 speaker.

```js
const clip = lume.audio.record(5);        // 5s @ 16kHz/16-bit stereo, ~320KB in PSRAM
if (typeof clip !== 'number') {
  lume.storage.Fs.write('/memo_001.pcm', clip);           // persisted on the TF card
  // ... later, on any screen:
  const data = lume.storage.Fs.readBinary('/memo_001.pcm');
  lume.audio.setVolume(80);
  lume.audio.play(data);                                   // out the speaker
}
```

### 6. Settings persistence — KV store

NVS-backed key-value storage that survives reboot and power loss.

```js
lume.storage.kv.set('brightness', 70);
const v = lume.storage.kv.get('brightness');   // 70
lume.storage.kv.set('user', { name: 'dc', theme: 'dark' });  // objects are JSON-serialised
```

All hardware namespaces follow the same contract: `0` = success, negative = error
code, and every failure mode is documented in `runtime/types/lume.d.ts`.

## Hardware target

First-class board support:

- **Waveshare ESP32-S3-Touch-AMOLED-2.16** (ESP32-S3, 16MB flash, 8MB PSRAM,
  2.16" 480×480 QSPI AMOLED CO5300, CST9220 touch, AXP2101 PMIC, QMI8658 IMU,
  ES8311 codec + ES7210 mic, 32GB TF card over SPI)

The board layer is abstracted; more boards are welcome.

## Status

🚧 Active development.

- [x] **M1 — minimal loop**: QuickJS-NG on target, touch → JS, declarative button via
      LVGL bridge, signals, hot reload over USB *(on-device acceptance pending board)*
- [x] **M2 — hardware API surface**: GPIO/PWM/ADC, AXP2101 power, QMI8658 IMU,
      WiFi + HTTP, NVS KV, LittleFS files, ES8311/ES7210 audio *(code complete;
      on-device acceptance pending board)*
- [ ] **M3 — declarative UI completeness**: flex layout + style resolution ✅,
      lists & virtualization, animation, gestures
- [ ] **M4 — tooling**: `lume` CLI (create / dev / deploy), host simulator
- [ ] **M5 — ecosystem**: component library, docs site, board abstraction

Full milestone detail: [docs/roadmap.md](docs/roadmap.md) · Reactivity & rendering
design: [docs/reactivity-design.md](docs/reactivity-design.md)

## License

Apache-2.0
