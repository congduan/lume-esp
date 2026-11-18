# Build and development

## App Quick Start

### One-command verification (`lume check`)

`lume check` is the preferred verification entry: it bundles the app, boots it
under the esp32s3 emulator (real firmware via `tools/emu/run.sh`), verifies the
eval, runs geometry assertions and prints a perf summary in a single shot. No
board is required; CI and AI agents rely on its exit code and `--json` output.

```bash
node tools/lume/lume.js check examples/counter
node tools/lume/lume.js check examples/counter --json          # machine-readable
node tools/lume/lume.js check my-app --no-emu                  # fast bundle-only check
node tools/lume/lume.js check my-app --timeout 180             # emu step limit (seconds, default 120)
```

Steps, in order:

1. **bundle** — esbuild via `tools/lume/bundle.js`; a syntax/size failure stops
   the run (fail fast). Reports bytes and elapsed ms.
2. **eval** — `tools/emu/run.sh` produces `tft.png` + `serial.log` under
   `artifacts/check/<app>/`; pass requires two `lume-engine: app eval ok`
   markers (one home boot, one reloaded app) and no `JS exception` /
   `reload/launch eval failed` / `RELOAD ERR`. On failure the raw message, the
   offending `lume.*` expression with its original-source line, and a
   nearest-neighbour spelling hint from `runtime/types/lume.d.ts` are reported
   (e.g. `did you mean lume.ai.chat? (available: setKey, chat)`). A timeout is
   a FAIL and includes the serial-log tail.
3. **layout** — only when `tools/emu/layout_expectations.json` has an entry for
   the app: `check_layout.py <tft.png> <spec> --app <name>` collects R1–R7.
   Skipped with a reason when there is no spec or `--no-emu` was used.
4. **perf** — collects `lume-perf:` profile lines when present; otherwise
   skipped as `profile disabled`. Never blocks.

`--json` prints a single object (`ok`, `app`, `steps[]`, `screenshot`) suitable
for agent parsing; validate with `python3 -m json.tool`. Exit code is **0 when
all executed steps pass, 1 when any fails** (skipped steps do not fail the run).
All check products live in `artifacts/check/<app>/` and `artifacts/emu/` is
left untouched. The emulator step needs the esp32s3 firmware images and
`esp32sim` (see `tools/emu/README.md`); `run.sh` builds the firmware with
`idf.py` unless they already exist. `--no-emu` needs only Node.js.

### Host Simulator

From the repository root, run `node tools/simulator/sim.js examples/counter/app.js` and open `http://localhost:8765`. The 480×480 browser device frame replays the exact embedded prelude's UI messages. Saving the app file reruns it and resets the preview; clicking `Count` sends `onPress` back to the same Node VM and updates the screen. A project made with `lume create` can run `npm run sim` from its directory while this repository checkout is available. The simulator needs Node.js and a browser, with no simulator npm dependencies or board.

The runner reads `firmware/components/lume-engine/lume_scripts.c` as its prelude source. It supports the prelude's plain global-script app format; app imports requiring the CLI esbuild bundle step are outside this initial simulator slice. `Fs` has sample, in-memory entries for the files example. Images are gray placeholders. CSS flex, typography, scroll physics and Canvas rasterization approximate LVGL, so check final visuals and frame rate on hardware. See [known simplifications](KNOWN-SIMPLIFICATIONS.md).

Browser verification: `PLAYWRIGHT_MODULE=/path/to/playwright node tools/simulator/verify.js` runs five renderer assertions, checks counter/files/device_monitor DOM, clicks the counter, and writes screenshots under `artifacts/simulator/`.

Requires Node.js 18 or newer and an ESP32-S3 with Lume firmware flashed. The CLI dependencies are installed once on the host:

```bash
npm ci --prefix tools/lume
node tools/lume/lume.js create my-app
node tools/lume/lume.js dev my-app
```

Edit `my-app/app.js`; `dev` bundles changed files with esbuild, installs the app on the device (LittleFS) and starts it, then sends each subsequent change over USB Serial/JTAG as a hot update, forwarding serial logs. Press `p`, `r`, or `b` in an interactive dev terminal to send PAUS, RESM, or BACK; Ctrl+C exits.

### Multiple apps on one device

The board stores a set of apps and runs **exactly one at a time**: switching apps tears the whole QuickJS runtime down and evaluates the target source in a fresh context (the same chain as a hot reload). Nothing is shared between apps and there is no background app.

```bash
node tools/lume/lume.js deploy my-app                    # id = directory name
node tools/lume/lume.js deploy my-app --id clock
node tools/lume/lume.js deploy my-app --ephemeral        # run once, do not install
tools/lume/fetch-qjsc.sh                                 # once: build host qjsc from vendored QuickJS-NG
node tools/lume/lume.js deploy my-app --bytecode         # opt-in: push qjsc bytecode instead of source
node tools/lume/lume.js apps                             # list installed apps
node tools/lume/lume.js apps launch clock
node tools/lume/lume.js apps remove clock
node tools/lume/lume.js apps home                        # back to the built-in home grid
```

To use the optional launcher app, deploy `examples/launcher` with id
`launcher`. Its top-level `lume.apps.setBoot('launcher')` pins that app as the
power-on target. `setBoot('')` clears the pin. Open **EDIT** in the launcher and
tap **EXIT LAUNCHER MODE** to clear it and return to the built-in home grid.
The launcher can open `app_manager` when that example is installed.

`deploy` sends a `STORE` command frame (writes `/apps/<id>/app.js` + `meta.json`) and then a `LAUNCH` command frame. The optional `label` / `icon` / `color` shown by the launcher come from the app's `package.json`:

```json
{ "lume": { "entry": "app.js", "label": "时钟", "icon": "C", "color": "#1E88E5" } }
```

Boot behaviour: the device first tries `/apps/.boot`, an optional pinned app id,
when its `app.js` exists. Otherwise it tries `/apps/.current`, the last
successfully launched app, then the built-in home grid (`lume_home_js`).
`lume.apps.launch(id)` switches the runtime and updates `.current`; `home()`
clears `.current` and returns to the home grid. Neither clears `.boot`, so
`lume apps launch <app>` does **not** exit launcher mode. The launcher's edit
page provides the exit button. Another route is to deploy and start an app
that calls `lume.apps.setBoot('')`; a direct TF/CLI pin editor is still pending.
Devices that never call `setBoot` follow the original `.current` behaviour.
An app that fails to evaluate falls back to home; the existing `.current`
failure handling remains in place. An unhandled `onBack` returns from the
running app to the home grid; the built-in grid itself swallows BACK.
`--ephemeral` keeps the M1 behaviour: the pushed bundle only lives in RAM
until the next boot or reload.

Both commands auto-detect a single Espressif USB port; if needed, specify `--port /dev/ttyACM0` (or the platform's serial path). The device's `RELOAD OK <length>` confirms that the JS source evaluated; `RELOAD ERR <reason>` is shown as a CLI error. `--help` and `--version` are available. Baud is set to 115200; USB CDC does not use it as a physical bit rate.

The scaffold uses `app.js` and a `package.json` `lume.entry` field. Apps use the prelude globals (`signal`, `View`, `Text`, `Button`, `lume`) directly. The CLI bundles imports from local modules via esbuild, emitting `iife`, `es2020` JavaScript source. The default source path is the device's `JS_Eval(..., JS_EVAL_TYPE_GLOBAL)`; it does not accept an ESM `export` statement. Since r43b, `lume deploy --bytecode` is an **opt-in** second path: the CLI compiles the bundle with a host `qjsc` built from the vendored QuickJS-NG sources (`tools/lume/fetch-qjsc.sh`, no external dependency) and pushes `LUMB`-framed bytecode; the device loads it with `JS_ReadObject` + `JS_EvalFunction`. Both paths coexist; the CLI queries the device engine version (`VER`) before a bytecode push and refuses locally on a mismatch. The CLI refuses empty or over 256 KiB bundles before opening the port. Development bundles are not minified, deployment bundles are. See `docs/r43b-bytecode-report.md`.

## Frame protocol cross-check

Queue A UI text: `lume_ui_msg_t` carries up to 63 UTF-8 bytes inline. Text of
64–256 bytes has a separate PSRAM payload; ownership transfers on successful
post and the LVGL drain frees it after applying or dropping the message. Queue
A remains 384 fixed records of at most 128 bytes each (at most 48 KiB of queue
storage); a 257-byte string is rejected before posting.

Source of truth: the shared portable codec [lume_frame.h](../firmware/components/lume-hotreload/include/lume_frame.h) / [lume_frame.c](../firmware/components/lume-hotreload/lume_frame.c). **Both** push channels — the USB RX task and each WiFi-OTA TCP connection — feed their own instance of this codec, so the wire format is literally shared, not duplicated. The CLI encoder is [protocol.js](../tools/lume/protocol.js); the r26 [host harness](../tests/ota_protocol.c) feeds CLI-produced frames into the C decoder and asserts field-by-field equality. r96 extends the same portable layer with the auth wire helpers (`lume_ota_challenge_line`, `lume_ota_auth_parse`, `lume_ota_mac_verify`) used by both the firmware HMAC provider and the host harness.

The r96 WiFi-OTA auth handshake (`lume deploy --host <ip>`, legacy `--ota`) is `CHALLENGE <32hex>` from the device (16 bytes from `esp_random`, fresh per connection) -> `AUTH <64hex>` = HMAC-SHA256(key = raw 16 token bytes, msg = ASCII bytes of the 32-hex challenge) computed by `node:crypto` in the CLI and by `mbedtls_md_hmac` on the device -> `AUTH OK`/`AUTH ERR`. The token is never sent on the wire; a captured reply fails against the next challenge. Frames flow only after `AUTH OK`, using the exact codec below.

| Field | Firmware source | CLI source |
|---|---|---|
| Magic `LUME`, 4 bytes | `LUME_FRAME_MAGIC`, `lume_frame_parser_feed()` | `protocol.js:MAGIC_DATA` |
| Payload length, u32 little endian, excludes 12-byte header | `lume_frame_encode()`, ST_HDR `load_le32` | `protocol.js:frame()/build()` |
| CRC-32 of payload, u32 little endian | `lume_frame_crc32()` (== `esp_crc32_le(0,…)` == `zlib.crc32`) | `protocol.js:crc32()`, `build()` |
| Payload bytes, 1..262144 | `LUME_FRAME_MAX_PAYLOAD` | `protocol.js:MAX_PAYLOAD`, `build()` |
| `BACK`, `PAUS`, `RESM` four-byte controls | `LUME_FRAME_CTRL_*` | `protocol.js:CONTROL` |
| Final `RELOAD OK/ERR` line | `lume_ota_reply()` (shared by USB + OTA) | `transport.js:24`, `ota.js` |
| Command magic `LUMC`, same 12-byte header + CRC | `LUME_FRAME_CMD_MAGIC`, `LUME_FRAME_EV_CMD` | `protocol.js:cmdFrame()` |
| Command text grammar (`STORE`/`LAUNCH`/`REMOVE`/`META`/`LIST`/`HOME`/`SHOT`/`VER`) | `lume_cmd.h` / `lume_cmd.c` | `protocol.js:storeCommand()/storeCommandBuffer()/simpleCommand()` |
| `CMD OK` / `CMD ERR` lines | `lume_hotreload.c:cmd_reply()` | `transport.js`, `ota.js` |
| Bytecode magic `LUMB`, same 12-byte header + CRC (r43b) | `LUME_FRAME_BYTECODE_MAGIC`, `LUME_FRAME_EV_BYTECODE`, `lume_frame_encode_bytecode()` | `protocol.js:bytecodeFrame()` |
| `LQBC` 16-byte payload header (QJS version + BC_VERSION + body_len) | `lume_bytecode.h`, `lume_engine.c:eval_bytecode_buf()` | `protocol.js:bytecodePayload()/parseBytecodePayload()` |
| `VER` -> `CMD OK ver <MAJOR.MINOR.PATCH>` | `lume_cmd.c` / `lume_engine_version()` | `bytecode.js:queryEngineVersion()/assertEngineVersion()` |
| Screenshot reply (`SHOT <w> <h> <bytes> <crc>` + `S64<base64>` lines + `SHOT OK`) | `lume_hotreload.c:handle_shot()`, `lume_display.c` | `shot.js:decodeShot()` |
| REPL magic `LUMR`, same 12-byte header + CRC (r115) | `LUME_FRAME_REPL_MAGIC`, `LUME_FRAME_EV_REPL`, `lume_frame_encode_repl()` | `protocol.js:MAGIC_REPL`, `replFrame()` |
| REPL request = one UTF-8 JS expression | `lume_hotreload.c:on_frame_event()` -> `lume_engine_request_repl()` | `lume repl [--eval]`, `transport.js:repl()` |
| REPL reply (`REPL OK/ERR <len> <trunc>` + `R64<base64>` lines + `REPL END`) | `lume_hotreload.c:repl_reply()` | `transport.js:consumeLine()`, `protocol.js:decodeReplLines()` |
| REPL output bound (`LUME_REPL_OUT_CAP`=2048, truncation marker) | `lume_frame.h:lume_repl_clamp()` | `protocol.js:clampReplOutput()` |

Four frame kinds share one byte stream: `LUME` payloads are evaluated as app source, `LUMC` payloads are management commands and are never evaluated, `LUMB` payloads (r43b) are a `LQBC` header plus a raw qjsc bytecode blob staged through the same reload slot (the engine dispatches on the payload header at eval time, so the source path is unchanged), and `LUMR` payloads (r115) are ONE JS expression evaluated synchronously on the **current app context** without recycling the runtime (so REPL sees app globals/signals). A command frame is answered with `CMD OK …` / `CMD ERR <reason>`; `LAUNCH`/`HOME` are answered with the engine's `RELOAD OK/ERR` because the outcome is only known after the target app evaluated. `LIST` sends one `APP\t<id>\nMETA\t<id>\t<json>\n` block per app before `CMD OK list <n>`. Old firmware treats `LUMB`/`LUMR` as a bad magic and re-syncs; it answers `VER` with `CMD ERR verb`, which the CLI surfaces as a "update firmware" hint before any bytecode is pushed.

## Device REPL (`lume repl`)

`lume repl` evaluates one JS expression per line **inside the running app's QuickJS context** over the same USB/TCP channel (same trust/auth model: USB serial, or WiFi TCP behind the existing HMAC handshake). No runtime recycle, no second port:

```bash
node tools/lume/lume.js repl --port /dev/ttyACM0          # interactive; Ctrl+C or "exit" quits
node tools/lume/lume.js repl --eval "lume.battery()" --port /dev/ttyACM0   # one-shot, scriptable
node tools/lume/lume.js repl --eval "1+2" --host 192.168.1.9 --token <32hex>
```

The device evals on the engine task at the inner event-loop dispatch point (never on the RX task, never from LVGL/touch), converts the result with `JS_ToString`, and returns it through the existing reply sink. A thrown exception is caught and returned as error text (no crash, no hang). Each result is clamped to `LUME_REPL_OUT_CAP` (2048 bytes) before base64-chunked reply lines; the CLI prints `[output truncated]` when the `trunc` flag is set. There is no multi-line continuation, bracket completion, or history — see [known simplifications](KNOWN-SIMPLIFICATIONS.md).

## Debug screenshot (`lume screenshot`)

The `SHOT` command captures one full-frame RGB565 snapshot of what the panel is currently showing and streams it back as text lines on the same channel (USB serial or WiFi TCP), so no extra port or protocol is needed:

```bash
node tools/lume/lume.js screenshot                      # -> ./screenshot.bmp
node tools/lume/lume.js screenshot shot.bmp --port /dev/ttyACM0
node tools/lume/lume.js screenshot shot.bmp --ota <ip> --token <t>
```

Reply grammar (firmware `lume_hotreload.c:handle_shot()`, decoder `tools/lume/shot.js`):

- `SHOT <w> <h> <bytes> <crc32-8hex>\n` — header, always the first line.
- `S64<base64>\n` — one data line per 240 raw bytes (320 base64 chars; the `S64` sentinel keeps interleaved device log lines out of the payload).
- `SHOT OK\n` — footer. Any `CMD ERR <reason>` line aborts (`shot-busy` / `shot-oom` / `shot-timeout` / `shot-failed` / `shot-encode`).

The payload is little-endian row-major RGB565, `w*h*2` bytes, no stride padding: `flush_cb` copies each flushed area into a PSRAM shadow buffer BEFORE the panel byte swap (see `lume_display.c:capture_copy_area`). The capture is armed from the CLI, completed on the LVGL task's next refresh cycle (`LV_EVENT_REFR_READY`, forced by a full-screen invalidate). A paused display completes the capture only after wake; the CLI surfaces the device's `shot-timeout` after 5 s. The CLI verifies the CRC and writes a 24-bit BMP.

The C host harnesses are compiled on the host (no ESP-IDF stubs):

```bash
# r96: OTA codec + HMAC auth harness (real mbedTLS SHA-256 HMAC, r91 config)
node tests/ota_auth.js
```

gcc -std=c11 -Wall -Wextra -Werror \
  -I firmware/components/lume-hotreload/include \
  -I firmware/components/lume-engine/include \
  tests/apps_protocol.c \
  firmware/components/lume-hotreload/lume_frame.c \
  firmware/components/lume-hotreload/lume_cmd.c \
  -o /tmp/lume_apps_protocol && /tmp/lume_apps_protocol
```

The other two C host harnesses (r27 note: `lume_image_header.c` now pulls the
board profile through `lume_pins.h`, so its host compile needs the board dir on
the include path):

```bash
gcc -std=c11 -Wall -Wextra -Werror \
  -I firmware/components/lume-ui-bridge/include \
  -I firmware/components/lume-hotreload/include \
  -I firmware/components/lume-engine/include \
  tests/bridge_protocol.c -o /tmp/lume_bridge_protocol && /tmp/lume_bridge_protocol

gcc -std=c11 -Wall -Wextra -Werror \
  -I firmware/components/lume-engine/include \
  -I firmware/components/lume-svg/include \
  -I firmware/components/lume-board/include \
  -I firmware/boards/waveshare_esp32_s3_touch_amoled_2_16 \
  tests/image_header.c \
  firmware/components/lume-engine/lume_image_header.c \
  firmware/components/lume-engine/lume_image_pixels.c \
  firmware/components/lume-svg/lume_svg.c -lm \
  -o /tmp/lume_image_header && /tmp/lume_image_header

gcc -std=c11 -Wall -Wextra -Werror \
  -I firmware/components/lume-svg/include \
  tests/lume_svg_test.c firmware/components/lume-svg/lume_svg.c -lm \
  -o /tmp/lume_svg_test && /tmp/lume_svg_test
```

The JS harnesses are standalone CommonJS scripts (`node tests/<harness>.js`),
and the CLI unit tests are `npm test --prefix tools/lume`.

## WiFi OTA deploy (`lume deploy --ota`)

Once the board is on WiFi with an IP, push a bundle over TCP instead of USB. The device generates a random token on first boot, stores it in NVS and prints it on the serial console every boot (`lume-ota: WiFi OTA token: <32 hex>`):

```bash
node tools/lume/lume.js deploy my-app --ota 192.168.1.42 --token <32-hex-token>
# non-default port (firmware CONFIG_LUME_OTA_PORT):
node tools/lume/lume.js deploy my-app --ota 192.168.1.42 --token <t> --ota-port 9000
```

The OTA server listens only while `lume.net.status().state === GOT_IP`; it stops on disconnect and restarts after reconnect. `--ota` needs `--token` and is mutually exclusive with the serial `--port`. The OTA channel reuses the exact same frame codec and `RELOAD OK/ERR` replies as USB; the only extra step is a one-line `AUTH <token>` preamble before frames. `lume.net.otaStatus()` returns `{running, wifiReady, tokenReady, port, token}`.

Security boundary: the token is plaintext on a trusted LAN and CRC-32 gives integrity only (no signature). Do not expose the port to an untrusted network; TLS / ed25519 signing are deferred — see [known simplifications](KNOWN-SIMPLIFICATIONS.md) (r26). Real-device WiFi push is verified on the board round, not here.

## CI firmware release

`.github/workflows/firmware.yml` builds with `espressif/esp-idf-ci-action@v1` (image `espressif/idf:v5.5.5`, target `esp32s3`, `path: firmware`). A push to `main` touching `firmware/**` uploads `lume-firmware-<run_number>` as an artifact only; pushing a `vX.Y.Z` tag additionally publishes a GitHub Release; `workflow_dispatch` builds manually. GitHub Actions does not evaluate `paths` for tag pushes, so branch path filtering and tag releases coexist under one `push` trigger.

The three binaries are flattened into `dist/` and `flash_args` is rewritten to basenames during collection, so `esptool.py write_flash @flash_args` resolves against the flat artifact **and** the flat Release assets. `README-flash.txt` also lists the explicit offsets (`0x0 bootloader.bin`, `0x8000 partition-table.bin`, `0x10000 lume.bin`) for manual flashing. CI runs the build + collection only; the host harnesses and CLI tests are host-side checks.

## Firmware build

ESP-IDF v5.5, board component `waveshare/esp32_s3_touch_amoled_2_16 ^2.0.1`, vendored QuickJS-NG and LVGL 9:

```bash
cd /opt/esp/esp-idf
env -u VIRTUAL_ENV IDF_PYTHON_ENV_PATH=/home/ubuntu/.espressif/python_env/idf5.5_py3.12_env bash -c '. ./export.sh >/dev/null 2>&1; cd /home/ubuntu/lume/firmware && idf.py build'
```

The CLI is under `tools/lume`; it does not enter a firmware component or affect its IRAM/flash size.
