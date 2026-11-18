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

scan implementation note: `lume.net.scan()` (added with the settings demo) is a
**synchronous** all-channel active scan returning an RSSI-descending array of
`{ssid, rssi, auth}` (cap 20; ssid `""` = hidden AP; `auth` = wifi_auth_mode_t,
0 = open) or a negative error code. It **blocks the engine task for ~1.5-3 s**
— the same accepted tradeoff as the synchronous `httpGet()`, so touch /
hot-reload events stall during a scan. Requires the station started; the
driver may reject a scan during an ongoing association (`-2`). Real scan
results on hardware are deferred to the on-board round.

r57 WebSocket client: `lume.net.ws.connect(url, {headers?, onOpen?,
onMessage?, onClose?, onError?}, cb)` starts a `ws://` or `wss://` connection.
`cb(error, handle)` runs once, on open or connection failure; omit `cb` for a
`Promise<handle>`. The handle has `send(string | ArrayBuffer): number` and
`close(): number`. A string sends a text frame; an ArrayBuffer sends a binary
frame. `onMessage` receives a string or ArrayBuffer. All callbacks run on the
engine task; keep them short so touch and timers remain responsive. There are
two concurrent handles and a 64 KiB incoming message cap. Errors are negative
numbers (`-1` argument/handle, `-2` transport, `-3` no WiFi IP, `-4` slots
full). Events may be dropped when the engine queue is saturated. The example
is `examples/ws_echo/app.js`; board WiFi and TLS acceptance remains pending.

r71 implementation note — **local web server** (`lume.net.web`): the device is
a tiny LAN web-app server. C (`firmware/components/lume-net/lume_webserv.c`)
owns only the socket lifecycle and a minimal HTTP/1.0 parser; **every route and
page body is written by the running JS app** via
`lume.net.web.on(method, path, handler)` and hot-distributed with the bundle.
`start({ port?, token })` is explicit and token-mandatory, binds only while
`lume.net.status().state === GOT_IP`, and is auto-stopped on every app switch /
close / failed eval. `url()` returns `http://<ip>:<port>/?key=<token>` (null
when stopped / no IP) for the app to show on screen. `handler(req)` is invoked
synchronously on the engine task with `{ method, path, query: {k:v}, body }`
and must return `{ status, headers?, body }` in a few ms. Unmatched requests
get 404; GET `/` with no route shows a built-in welcome page listing routes.
A request without the matching `key` query is rejected with **403 before any
JS dispatch**; paths are never read as files. Body is capped at 8 KiB, at most
2 concurrent connections, one ~9 KiB shared PSRAM request buffer. There is NO
background web task: the engine's ~20 ms event loop polls the sockets and runs
the handler inline, avoiding a cross-task bridge into the single-threaded JS
runtime. HTTP/1.0 short connections only — no keep-alive / chunked / TLS
(mbedTLS server certificate is out of scope). The example is
`examples/web_config/app.js`; host evidence is `tests/webserver.js` (full
request→handler→response chain, mock C layer) and `tests/webserv_parse.c`
(pure parser). Real browser-over-WiFi acceptance is deferred to the board
round; see `docs/KNOWN-SIMPLIFICATIONS.md` (r71).

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

## Multi-app store (r30)

The device holds a set of apps on the LittleFS `storage` partition and runs
**exactly one of them at a time**. "Multi-app" is an installation/selection
feature, not a runtime isolation feature: there is no shared runtime, no
background app, no app-to-app messaging, and no per-app sandbox or permission
model.

```
/apps/<id>/app.js      bundled app source (JS_Eval, iife + es2020 text)
/apps/<id>/meta.json   one-line JSON: {"label","icon","color"}
/apps/.current         id started on the next boot (missing = built-in home)
```

`<id>` is 1..31 chars of `[A-Za-z0-9._-]` and must not start with `.`
(`lume-engine/include/lume_app_id.h`). The id is also the directory name, so
path traversal is rejected by construction.

### Switching model

`lume.apps.launch(id)` / `lume.apps.home()` only **post** a switch request to
the engine task. The current context keeps running until the JS call returns;
then the engine performs the same teardown as a hot reload — `__lume_shutdown`
(lifecycle + effects + timers + native animations + Canvas onDraw + press
handlers), UI reset, free context, free runtime — reads the target bundle from
LittleFS and evaluates prelude + target source in a **fresh** QuickJS runtime.
Any code after a `launch()` call in the old app does not run.

Boot: `.current` is started when that app is still installed; otherwise the
built-in home grid (`lume_scripts.c:lume_home_js`) renders one tile per
installed app. An app whose eval fails drops `.current` and falls back to home,
so a broken install cannot brick the device. An unhandled BACK returns to home.

### JS API

| Call | Returns |
|---|---|
| `lume.apps.list()` | `string[]` of installed ids (ascending), or a negative number |
| `lume.apps.meta(id)` | raw `meta.json` text, or a negative number |
| `lume.apps.entries()` | `{id,label,icon,color}[]` with meta merged (prelude helper) |
| `lume.apps.current()` | id of the running app, `''` for home, or a negative number |
| `lume.apps.launch(id)` | `0` queued / `-1` bad id, queue full, or no app.js |
| `lume.apps.home()` | `0` queued / negative |
| `lume.apps.remove(id)` | `0`, `-4` not found, `-6` (refused: that app is running) |
| `lume.apps.mounted()` | `true` when the store filesystem is mounted |

`lume.ui.shell.Launcher` defaults its app list to `lume.apps.entries()` and its
`onLaunch` to `lume.apps.launch(id)`; passing `apps` / `onLaunch` still wins.

### Optional shell safe area

After importing `runtime/shell.js`, `lume.ui.shell.safeInsets(shape, size)`
returns `{top,right,bottom,left}` in logical pixels. `shape` is `square` or
`round`; `size` is the logical screen side/diameter. Square returns zero
insets. Round uses a centered inscribed square of side
`floor(size / sqrt(2))`; for 466 the side is 329 with insets
`{top:68,right:69,bottom:69,left:68}`.

`lume.ui.shell.SafeArea({shape, size, parent?, children?})` returns a View
whose children occupy that rectangle. Shape defaults to `square`; size defaults
to the runtime screen width. The container has no padding or gap. A direct
child View with a known numeric width/height and x/y exceeding the round
bounds emits one `console.warn` per SafeArea call. Percent, auto and computed
sizes, other node types, and nested descendants cannot be checked before
layout; review those visually. A warning does not prevent rendering.

Pass the size in **logical coordinates**. In the r88 playground the 480 logical
canvas is scaled to a 466 round preview, so pass 480 there. On a native 466
logical screen, pass 466. See `docs/r104-safearea-report.md` for a counter
migration example.

### Command channel

Management operations travel as `LUMC` command frames on the same USB/WiFi
byte stream as app bundles (see `docs/build.md` for the wire table and
`lume-hotreload/include/lume_cmd.h` for the grammar). `STORE` is the only
command that writes an app; the firmware never parses `meta.json`.

### Verified on the board (r30)

CI-built firmware flashed over USB; boot resumed `dashboard` from `/apps`,
`lume apps list` listed three installed apps, `lume apps launch device_monitor`
switched and the previous app's timers stopped, `lume apps home` returned to the
grid and tapping a tile started that app again (a hardware reset then booted
back into it). One defect only surfaced here: `LIST` ran a 2 KiB id table on
the 4 KiB push-channel RX stack and reset the device before replying; the table
now lives in PSRAM and both RX stacks are 8 KiB. Host halves stay covered by
`tests/apps_protocol.c` (wire + grammar) and `tests/apps.js` (prelude +
launcher over the extracted prelude).

### Still deferred

LittleFS write endurance under repeated `lume dev` installs, install time for a
200 KiB bundle, switch latency numbers, home-grid visuals/touch feel and
long-running memory fragmentation. See `docs/KNOWN-SIMPLIFICATIONS.md` (r30).

## r34: HTTP requests and AI chat

`lume.net.httpRequest({url, method:'POST', headers, body, timeoutMs, caPem?, httpsInsecure?})`
returns `{status, body, contentLength, truncated}` or a negative error code. `body` is a string or ArrayBuffer (at most 16 KiB); response text is capped at 32 KiB and backed by PSRAM while in C. Headers are string values, at most 12 entries. Set `Content-Type` to `application/json` or `application/x-www-form-urlencoded` as appropriate. GET remains available through `httpGet`. Request timeout defaults to 30 seconds and is capped at 120 seconds. HTTPS verifies with IDF's certificate bundle by default; `caPem` supplies a custom CA. `httpsInsecure: true` deliberately skips certificate verification and should be used only for a controlled test endpoint. TLS needs a valid system clock for certificate date validation; the app or board should synchronize time with SNTP before a verified HTTPS request. HTTP status codes are returned in the response; `-1` means invalid input, `-2` transport failure, `-3` WiFi unavailable, and `-5` detected timeout.

`lume.ai.setKey(key)` saves a key in the NVS KV namespace under `ai_api_key`; the plaintext key must never be committed to a bundle or repository. `lume.ai.chat({messages, model?, baseUrl?, maxTokens?, temperature?, timeoutMs?})` sends a nonstreaming OpenAI-compatible `POST /chat/completions` and returns `{content, usage, finishReason}`. Defaults: DeepSeek base URL, `deepseek-flash`, 30 seconds. The current model name follows [DeepSeek's official first-call example](https://api-docs.deepseek.com/); the r34 brief used the older `deepseek-chat` name. Override `model` for a compatible provider. The chat call blocks the JS engine, so UI updates and touch delivery stall until the response or timeout. Errors: `-1` invalid request or missing key, `-2` network, `-3` non-2xx HTTP status, `-4` invalid or truncated JSON, `-5` detected timeout.

| Official DeepSeek Chat Completions field | Lume mapping |
|---|---|
| `POST /chat/completions`, `Content-Type: application/json`, Bearer key | `httpRequest` URL, headers, NVS key |
| `model`, `messages`, optional `max_tokens`, `temperature`, `stream` | Request payload; `stream: false` |
| `choices[0].message.content`, `choices[0].finish_reason`, `usage` | `content`, `finishReason`, `usage` result |

Contract source: [DeepSeek Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/). ESP-IDF transport source: [ESP HTTP Client v5.5](https://docs.espressif.com/projects/esp-idf/en/release-v5.5/esp32/api-reference/protocols/esp_http_client.html).

## Microphone stream (r72)

`lume.audio.recordStream({chunkSamples: 1024, onChunk(pcm, samples), onError?(code)})`
starts one 16 kHz signed 16-bit interleaved stereo RX stream. `chunkSamples`
accepts 512, 1024 (default), or 2048 frames. A 64 KiB PSRAM RX ring is filled
by an audio task. An eight-chunk engine queue transfers owned PCM to QuickJS;
when full, it discards the oldest audio chunk and increments
`lume.audio.recordStreamDropped()`. The JS callback runs on the engine task,
never on the I2S task. Return from it within a few milliseconds: do only small
FFT work or set a signal; defer string building, decoding, and rendering to a
timer tick. `lume.audio.stopStream()` stops capture and drains queued chunks.

Start returns `0`, `-1` for arguments, `-2` for codec/I2S failure, `-3` for
board unavailable or busy, and `-4` for allocation. Only one recording stream
may run. The RX slave uses TX master BCLK/WS: while recording, playback at a
rate other than 16 kHz is rejected with `-3`. The synchronous `record()` also
returns `-3` during a stream. `stopStream()` returns `-3` if no stream runs.

## RGB565 scaling (r84)

`lume.imgscale.scale(src, sw, sh, dst, dw, dh, mode?)` scales a `sw` x `sh`
RGB565 grid in a `Uint16Array` into a `dw` x `dh` region of another
`Uint16Array`. Both views are used directly through `JS_GetTypedArrayBuffer`:
no backing-store copy, and `subarray()` offsets are honoured. `mode` defaults
to `'nearest'`; `'bilinear'` samples R5/G6/B5 independently with 8-bit
fixed-point weights (components are never interpolated as a packed 16-bit
integer) and clamps source coordinates to the border. Destinations may be fed
straight into `ctx.retainImage(slot, dw, dh, dst)`.

Return codes follow the hardware-API convention: `0` success, `-1` bad
argument/type/mode, `-2` invalid dimensions, too-short views or buffer
overlap, `-3` internal failure. Each dimension must be an integer in 1..16384;
fractional dimensions return `-2` rather than being truncated. With identical
source/destination views and identical geometry, scaling is a safe in-place
copy; any other overlap of the same backing buffer is rejected with `-2` so a
write cannot clobber a source pixel still needed. Scaling is pure per-pixel
sampling: it does not interpret RGB565 `0x0000` transparency or any colour key
— those remain the `retainImage` / `drawImage` layer's responsibility.

## Image pixel export (r85)

`lume.image.decode(bytes, maxW?, maxH?)` decodes PNG/JPEG `ArrayBuffer` bytes
through the same native path used by `Image({src})` and returns
`{ width, height, pixels }` on success. `pixels` is a `Uint16Array` holding the
RGB565 colour plane (little-endian words, same bit layout as Image/retainImage)
in the QuickJS heap; the PSRAM decode buffer is copied and released before the
call returns. PNG's A8 plane is discarded — the export is colour only.

With no optional arguments the intrinsic size is returned. When **both** `maxW`
and `maxH` are supplied, the decoded grid is scaled in one step with nearest
sampling via the shared r84 core; each target dimension must be an integer in
1..16384. Supplying only one dimension is a bad argument. Raster inputs keep
the existing 480x480 cap enforced by the header parser. Return codes: `-1` for
a missing/non-ArrayBuffer argument, a single target dimension, or a coercion
error; `-2` for corrupt/unsupported data, an over-480x480 input, or an invalid
target dimension; `-3` for PSRAM allocation failure (propagated verbatim from
the native decoder). The result can be fed to `lume.imgscale.scale` or to
`ctx.retainImage(slot, w, h, pixels)`; `examples/image_gallery` uses the latter
for 96x96 TF-card thumbnails. Memory/quality caveats are recorded in
`KNOWN-SIMPLIFICATIONS.md`.
