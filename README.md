<div align="center">

# Lume

**Write your entire ESP32-S3 AMOLED app in JavaScript. No C, no rebuild, no heavyweight framework on the developer's side.**

*Declarative UI · Signals reactivity · Flex layout · Canvas · Animations · Gestures · Themes · Hot reload · Full hardware access — powered by QuickJS-NG + LVGL under the hood*

> **Mission**: bring the most modern frontend technology (declarative components, signals reactivity, flex layout, canvas, animations, hot reload, TypeScript tooling) to ESP32 — using the *least* possible device resources (QuickJS bytecode, dirty-rect LVGL rendering, PSRAM-managed heaps) — to deliver the *best* embedded development experience (seconds to see a change, zero C toolchain on the app developer's machine).

🌐 **[Live documentation site](https://congduan.github.io/lume-esp/)** — API reference, examples gallery, FAQ (bilingual EN/中文)

<img src="images/demo.jpg" alt="Lume running on the ESP32-S3 AMOLED board" width="480">
<img src="images/demo1.jpg" alt="Lume UI built with declarative JS components" width="480">

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
| Custom visuals | Custom C drawing code | **Canvas widget with a JS drawing context** |
| Motion | Hand-tuned lv_anim calls | **CSS-style transitions + `lume.anim` tweens** |
| Iteration | Rebuild + flash (minutes) | **Hot reload over USB (seconds)** + host simulator |
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
│    lifecycle · themes · gestures · animations      │
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

Edit `my-app/app.js` to see each saved change on screen. Use `--port /dev/ttyACM0` if the
USB Serial/JTAG port is not detected automatically. For a one-time push, run
`node tools/lume/lume.js deploy my-app`. Once the board is on WiFi, the same bundle can be
pushed over TCP with `node tools/lume/lume.js deploy my-app --ota <ip> --token <t>` (the
token is printed on the device serial log at boot; `--ota-port` selects a non-default port).
See [build and development](docs/build.md) for protocol details, controls, and the WiFi OTA /
CI release notes.

### Host Simulator

Preview without a board: `node tools/simulator/sim.js examples/counter/app.js`, then open
`http://localhost:8765`. Created projects can use `npm run sim` while this repository
checkout is available. The browser replays prelude UI messages, updates on save, and sends
button clicks back to the app. Final visual and performance checks still need the device;
see [simulator details](docs/build.md#host-simulator).

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

### 2. Apple Watch style launcher — honeycomb grid with Canvas icons

Virtualized grid (only on-screen icons exist as real nodes) with canvas-drawn icons.

```js
List({ style: { width: '100%', height: '100%', scroll: 'vertical' },
       items: rows, itemHeight: 104, overscan: 2,
       renderItem: (rowApps, rowIndex) =>
         View({ style: { display: 'flex', flexDirection: 'row',
                         justifyContent: 'space-evenly', width: '100%' } },
              rowApps.map(app => View({ onPress: () => launch(app.id) }, [
                Canvas({ width: 48, height: 48,
                         onDraw: c => { c.circle(24, 24, 22, app.color); } }),
                Text({ text: app.label }),
              ]))) });
```

1000 apps? The virtualized list still only creates ~20 nodes. Full source:
[examples/watch_launcher/app.js](examples/watch_launcher/app.js).

The launcher now reads the installed set from `lume.apps.entries()` and a tap
switches the single live app (`lume deploy <dir> --id <app-id>`, see
[docs/build.md](docs/build.md#multiple-apps-on-one-device)).

### 3. Files — a complete file manager app

TF-card directory browsing with Fs API, selection highlighting via signal-bound styles,
lifecycle-aware refresh, theme colors.

```js
function loadDir(path) {
  const list = Fs.list(path);
  if (typeof list === 'number') { status.set('read failed: ' + list); return; }
  entries.set(list.map(name => ({ name, isDir: isDirPath(path + name) })));
  cwd.set(path);
}
```

Full source: [examples/files/app.js](examples/files/app.js).

### 4. Hardware one-liners

```js
// Battery telemetry → UI
Text({ text: () => 'battery: ' + lume.pmic.battPercent() + '%' });

// IMU tilt → reactive style
const s = lume.imu.read();            // { acc:[x,y,z], gyro:[x,y,z] } | null

// Voice memo: mic → PSRAM → TF card → speaker
const clip = lume.audio.record(5);
if (typeof clip !== 'number') {
  lume.storage.Fs.write('/memo.pcm', clip);
  lume.audio.play(lume.storage.Fs.readBinary('/memo.pcm'));
}

// WiFi + HTTP
lume.net.connect('SSID', 'password');
const res = lume.net.httpGet('http://api.example.com/weather');

// BLE peripheral (NimBLE, Nordic UART Service shape) — poll, no callbacks
lume.ble.start('Lume');
lume.system.setInterval(() => {
  const msg = lume.ble.read();   // string | null (empty) | negative error code
  if (typeof msg === 'string') lume.ble.write('echo:' + msg.slice(0, 12));
}, 100);

// Settings that survive power loss
lume.storage.kv.set('brightness', 70);

// Auto-sleep with touch wake
lume.power.sleepNow();                // touch the screen to wake up
```

All hardware namespaces follow the same contract: `0` = success, negative = error
code, and every failure mode is documented in [`runtime/types/lume.d.ts`](runtime/types/lume.d.ts).

## Feature highlights

- **Signals reactivity** — value changes flow straight to on-screen attributes; no VDOM
  diff on the hot path ([design notes](docs/reactivity-design.md))
- **CSS-style flex layout** — flexDirection/justifyContent/alignItems/gap/padding and
  percentage sizing, mapped to LVGL flex under the hood
- **Canvas** — JS drawing context (rects/lines/circles/text) inside the flex layout,
  signal-driven repaint, PSRAM-backed buffer
- **Animations** — CSS-style `transition` on signal-bound attributes plus imperative
  `lume.anim.to()` tweens with completion callbacks
- **Gestures** — tap / swipe / longpress / pan streams with scroll coexistence
- **Lifecycle** — onStart/onPause/onResume/onBack; bundles are fully disposed on hot reload
- **Themes** — named color tokens, one-call dark/light switch that repaints referenced attrs
- **Auto-sleep** — idle timeout into light sleep, touch wakes the screen (ext0 on the
  touch INT pin)

## Hardware target

First-class board support:

- **Waveshare ESP32-S3-Touch-AMOLED-2.16** (ESP32-S3, 16MB flash, 8MB PSRAM,
  2.16" 480×480 QSPI AMOLED CO5300, CST9220 touch, AXP2101 PMIC, QMI8658 IMU,
  ES8311 codec + ES7210 mic, 32GB TF card over SPI)

Board support currently targets the Waveshare ESP32-S3-Touch-AMOLED-2.16 only;
a board abstraction layer for additional targets is not implemented yet.

## Status

Active development — M1/M2/M3 code complete; M4 tooling and the first M5 shell
components are in progress.

| Milestone | State |
|---|---|
| **M1 — minimal loop** (engine, touch→JS, declarative UI, hot reload) | ✅ code complete |
| **M2 — hardware API surface** (GPIO/PWM/ADC, power, IMU, WiFi+HTTP, KV, files, audio) | ✅ code complete |
| **M3 — declarative UI completeness** (flex, styles, animation, canvas, gestures, lifecycle, themes, virtualized lists, images) | ✅ code complete |
| **M4 — tooling** (`lume` CLI ✅, host simulator ✅, WiFi OTA code complete / board check pending) | 🚧 |
| **M5 — ecosystem** (component library, launcher shell, board abstraction) | 🚧 optional JS shell components + bilingual docs site landed; board abstraction not started |

> **Honesty note**: "code complete" means compiles green, host-tested, and reviewed.
> On-device acceptance (visuals, touch feel, sleep current, radio range) is pending
> board bring-up and tracked per-item in [docs/roadmap.md](docs/roadmap.md).

Documentation: [docs/roadmap.md](docs/roadmap.md) ·
[reactivity design](docs/reactivity-design.md) ·
[hardware API contract](docs/hardware-api.md) ·
[known simplifications](docs/KNOWN-SIMPLIFICATIONS.md)

## License

MIT
