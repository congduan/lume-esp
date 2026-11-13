<div align="center">

# Lume

**Write your entire ESP32-S3 AMOLED app in JavaScript. No C, no rebuild, no heavyweight framework on the developer's side.**

*Declarative UI · Hot reload · Full hardware access — powered by QuickJS-NG + LVGL under the hood*

> **Mission**: bring the most modern frontend technology (declarative components, virtual-DOM diffing, hot reload, TypeScript tooling) to ESP32 — using the *least* possible device resources (QuickJS bytecode, dirty-rect LVGL rendering, PSRAM-managed heaps) — to deliver the *best* embedded development experience (seconds to see a change, zero C toolchain on the app developer's machine).

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
| UI style | Imperative widget tree | **Declarative (state → view)** |
| Iteration | Rebuild + flash (minutes) | **Hot reload over USB/WiFi (seconds)** |
| Hardware access | ESP-IDF APIs | **Clean JS APIs: GPIO/I2C/IMU/Audio/Power/WiFi/BLE/KV** |
| Runtime overhead | none | QuickJS-NG bytecode on 8MB PSRAM — fine for app-layer UI |

## Architecture

```
┌────────────────────────────────────────────────────┐
│  Your app — pure JS/TS                             │
│    declarative UI (state → view diff)              │
│    hardware APIs (gpio/i2c/imu/audio/power/...)    │
├────────────────────────────────────────────────────┤
│  Lume runtime (C, ESP-IDF component)               │
│    QuickJS-NG engine (bytecode, PSRAM heap)        │
│    declarative → LVGL bridge (diff → lv_obj ops)   │
│    hot-reload channel (USB serial / WiFi)          │
├────────────────────────────────────────────────────┤
│  LVGL (render backend, hidden)                     │
│    CO5300 QSPI AMOLED driver · CST9220 touch       │
│    AXP2101 PMIC · QMI8658 IMU · ES8311/ES7210 audio│
└────────────────────────────────────────────────────┘
```

LVGL never leaks into app code. It is a rendering backend, the way UIKit sits behind
React Native.

## Hardware target

First-class board support:

- **Waveshare ESP32-S3-Touch-AMOLED-2.16** (ESP32-S3, 16MB flash, 8MB PSRAM,
  2.16" 480×480 QSPI AMOLED CO5300, CST9220 touch, AXP2101, QMI8658, ES8311/ES7210)

The board layer is abstracted; more boards are welcome.

## Status

🚧 Early development. Milestones:

- [ ] **M1 — minimal loop**: QuickJS-NG boots on target, touch events reach JS,
      declarative button renders via LVGL bridge, hot reload over USB
- [ ] **M2 — hardware API surface**: GPIO/PWM/I2C/Power/IMU/Audio/WiFi bindings
- [ ] **M3 — declarative UI completeness**: layout engine, lists, animation, images
- [ ] **M4 — tooling**: `lume` CLI (create / dev / deploy), host simulator
- [ ] **M5 — ecosystem**: component library, app store format, docs site

## Example (target API shape)

```js
import { App, View, Text } from 'lume/ui';
import { Power } from 'lume/board';

const app = new App({
  render() {
    const bat = Power.battery(); // native call, ~µs
    return (
      <View style={{ padding: 24, background: '#000' }}>
        <Text style={{ fontSize: 48 }}>{bat.percent}%</Text>
        <Button title="Reboot" onPress={() => Power.reboot()} />
      </View>
    );
  },
});

app.start();
```

## License

Apache-2.0
