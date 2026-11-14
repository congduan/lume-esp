# Hardware API design

This document defines the JS-facing hardware API surface that Lume's native layer
exposes. All APIs are asynchronous-first where the underlying operation can block
(I2C transactions, WiFi, audio), synchronous where cheap (GPIO, battery telemetry).

Target board: Waveshare ESP32-S3-Touch-AMOLED-2.16.

| Peripheral | Chip | Interface | Notes |
|---|---|---|---|
| Display | CO5300 | QSPI (GPIO4/5/6/7, 38, 12, rst 39) | 480×480, driven by LVGL |
| Touch | CST9220 | I2C (SDA 15 / SCL 14) | int → event loop → JS callback |
| PMIC | AXP2101 | I2C (shared bus) | battery/charging/power rails |
| IMU | QMI8658 | I2C (addr 0x6B) | accel + gyro, optional FIFO |
| Audio out | ES8311 | I2S (MCLK 42, SCLK 9, LRCK 45, DOUT 8) | speaker |
| Audio in | ES7210 | I2S / shared codec path | mic |
| Expansion | header GPIOs | GPIO/PWM/ADC | full JS access |

## Module layout

```
lume/gpio       DigitalIn, DigitalOut, Pwm, Adc
lume/i2c        I2c bus + generic register access
lume/board      Power (AXP2101), Imu (QMI8658), Audio (ES8311/ES7210),
                Touch, Display
lume/imu        QMI8658 accel + gyro: read() polled; motion / data-ready INT
                deferred until an INT pin is defined in lume_pins.h (r9)
lume/net        Wifi, Http
lume/ble        Ble (NimBLE GATT peripheral: advertise, RX write / TX notify)
lume/storage    Kv (NVS), Fs (LittleFS partition)
lume/system     sleep, reboot, time, timers, log
lume/ui         App, View, Text, Button, Image, List, ... (declarative)
```

r10 implementation note: only `lume.storage.kv` (the NVS KV store) is implemented
this round — `set/get/remove/keys/clear` over string / int / boolean / small
ArrayBuffer, backed by the `nvs` partition (24 KB @ 0x9000) with a fixed
namespace `lume` and 15-char keys. `lume.storage.Fs` (LittleFS on the `storage`
partition) is a **later round**; the "NVS KV store + LittleFS partition" roadmap
line stays unchecked. See `docs/KNOWN-SIMPLIFICATIONS.md` (r10 section) for the
namespace/key/blob tradeoffs and the NVS partition evidence.

r11 implementation note: `lume/net` is now implemented as the **WiFi station +
basic HTTP client** part of the `lume/net` row (Wifi + Http; Ble remains a
design-only entry). New component `firmware/components/lume-net/`, natives
self-register under `lume.net` (`init/deinit/connect/disconnect/status`,
`DISCONNECTED/CONNECTING/CONNECTED/GOT_IP`, `httpGet`) and `lume.net.http.get`
(alias of `httpGet`); prelude unchanged. Station-only / WPA2-PSK only,
`connect()` is non-blocking and `status()` polls the event-driven state
(`{state, ip}`). `httpGet()` is a **synchronous** oneshot GET returning
`{status, body, contentLength, truncated}` (body = string or ArrayBuffer),
with a timeout and a 32 KB body cap. All APIs degrade to the r10-style
negative error codes (`-1` arg, `-2` driver, `-3` state) when WiFi is not up /
has no IP. Verified facts before coding: NVS init timing (register_bindings),
WIFI/IP event handlers run on the dedicated `sys_evt` task (core 0), not the
engine task (core 1) — state is guarded by a portMUX critical section. WiFi's
IRAM speed optimizations are disabled in sdkconfig so the 16 KB IRAM stays at
16384 bytes (100% full at the r10 baseline). Credentials (password) and urls
are never logged. Real association / HTTP transfer is **not** verified this
round (compile + size + ESP-IDF v5.5.5 header/example self-check only); the
roadmap line stays unchecked for the on-board round. See
`docs/KNOWN-SIMPLIFICATIONS.md` (r11 section) for the full tradeoff list.

r25 implementation note: the design-only `Ble` entry from the r11 note is now
implemented as a **separate `lume.ble` namespace** (not under `lume.net`), so
the WiFi/HTTP contract stays untouched. New component
`firmware/components/lume-ble/`; natives self-register under `lume.ble`
(`init/start/stop/status/write/read`, `IDLE/ADVERTISING/CONNECTED`,
`MAX_PAYLOAD`); prelude unchanged. Role = **NimBLE GATT peripheral** with one
Nordic-UART-Service-shaped 128-bit service (RX write / write-no-rsp, TX
notify), one connection, no pairing/bonding, 20-byte unfragmented UTF-8 text
packets. `start(name?)` starts advertising (lazy radio init on the first
call); `status()` returns `{state, connected, subscribed, mtu, pending}`;
`read()` pops a bounded 8-packet FIFO (`string | null | negative`), `write()`
notifies. **No JS callbacks this round**: apps poll from
`lume.system.setInterval()`, so the NimBLE host task never enters QuickJS;
GAP/GATT callbacks only write flags and copy <= 20 bytes under a portMUX
critical section. All APIs degrade to the r10-style negative error codes
(`-1` arg, `-2` driver, `-3` state). Device names and BLE payloads are never
logged. `CONFIG_BT_ENABLED=y` and the NimBLE host were added to
`firmware/sdkconfig.defaults`, and `firmware/sdkconfig` was regenerated with
`idf.py` (ESP-IDF v5.5.5) so a plain `idf.py build` keeps Bluetooth enabled.
**Firmware build + size verified on the host**: build links cleanly, IRAM
16384/16384 (100%, no overflow), DIRAM 227975, Flash Code 1657930,
Total image 2183301 bytes; app partition still 67% free. Real advertising,
GATT discovery, notify throughput, WiFi+BLE coexistence and sleep current are
**NOT verified** — no board, on-device acceptance is deferred. See
`docs/KNOWN-SIMPLIFICATIONS.md` (r25 section).

## Conventions

- Pin numbers are board constants exported from `lume/board` (e.g. `Pins.I2C_SDA`),
  raw numbers allowed for expansion headers.
- Expected failures return typed `Result`-style values; unexpected ones throw.
- Event callbacks run on the JS task; native drivers push events into the QuickJS
  event loop (never call JS from ISR directly).
- Bytecode, not source, is what ships to the device (esbuild → qjs bytecode).

## Hot reload

The runtime exposes a small loader over USB CDC and (optionally) WiFi TCP:

```
push bundle.lumepak → validate header → mount → engine reload → app restart
```

Native peripherals stay alive across reloads; only the JS engine state is reset.
