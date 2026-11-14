# Build and development

## App Quick Start

### Host Simulator

From the repository root, run `node tools/simulator/sim.js examples/counter/app.js` and open `http://localhost:8765`. The 480×480 browser device frame replays the exact embedded prelude's UI messages. Saving the app file reruns it and resets the preview; clicking `Count` sends `onPress` back to the same Node VM and updates the screen. A project made with `lume create` can run `npm run sim` from its directory while this repository checkout is available. The simulator needs Node.js and a browser, with no simulator npm dependencies or board.

The runner reads `firmware/components/lume-engine/lume_scripts.c` as its prelude source. It supports the prelude's plain global-script app format; app imports requiring the CLI esbuild bundle step are outside this initial simulator slice. `Fs` has sample, in-memory entries for the files example. Images are gray placeholders. CSS flex, typography, scroll physics and Canvas rasterization approximate LVGL, so check final visuals and frame rate on hardware. See [known simplifications](KNOWN-SIMPLIFICATIONS.md).

Browser verification: `PLAYWRIGHT_MODULE=/path/to/playwright node tools/simulator/verify.js` runs five renderer assertions, checks counter/files/watch_launcher DOM, clicks the counter, and writes screenshots under `artifacts/simulator/`.

Requires Node.js 18 or newer and an ESP32-S3 with Lume firmware flashed. The CLI dependencies are installed once on the host:

```bash
npm ci --prefix tools/lume
node tools/lume/lume.js create my-app
node tools/lume/lume.js dev my-app
```

Edit `my-app/app.js`; `dev` bundles changed files with esbuild and sends the source over the board's USB Serial/JTAG port, then forwards serial logs. An unhandled `onBack` returns to the embedded demo. Press `p`, `r`, or `b` in an interactive dev terminal to send PAUS, RESM, or BACK; Ctrl+C exits. The firmware's embedded demo remains the boot and failed-reload fallback.

Use `node tools/lume/lume.js deploy my-app` for a single minified bundle and push. Both commands auto-detect a single Espressif USB port; if needed, specify `--port /dev/ttyACM0` (or the platform's serial path). The device's `RELOAD OK <length>` confirms that the JS source evaluated; `RELOAD ERR <reason>` is shown as a CLI error. `--help` and `--version` are available. Baud is set to 115200; USB CDC does not use it as a physical bit rate.

The scaffold uses `app.js` and a `package.json` `lume.entry` field. Apps use the prelude globals (`signal`, `View`, `Text`, `Button`, `lume`) directly. The CLI bundles imports from local modules via esbuild, emitting `iife`, `es2020` JavaScript source. The device's `JS_Eval(..., JS_EVAL_TYPE_GLOBAL)` accepts that source; it does not accept an ESM `export` statement or QuickJS bytecode. The CLI refuses empty or over 256 KiB bundles before opening the port. Development bundles are not minified, deployment bundles are.

## Frame protocol cross-check

Source of truth: the shared portable codec [lume_frame.h](../firmware/components/lume-hotreload/include/lume_frame.h) / [lume_frame.c](../firmware/components/lume-hotreload/lume_frame.c). **Both** push channels — the USB RX task and each WiFi-OTA TCP connection — feed their own instance of this codec, so the wire format is literally shared, not duplicated. The CLI encoder is [protocol.js](../tools/lume/protocol.js); the r26 [host harness](../tests/ota_protocol.c) feeds CLI-produced frames into the C decoder and asserts field-by-field equality.

| Field | Firmware source | CLI source |
|---|---|---|
| Magic `LUME`, 4 bytes | `LUME_FRAME_MAGIC`, `lume_frame_parser_feed()` | `protocol.js:23` |
| Payload length, u32 little endian, excludes 12-byte header | `lume_frame_encode()`, ST_HDR `load_le32` | `protocol.js:24` |
| CRC-32 of payload, u32 little endian | `lume_frame_crc32()` (== `esp_crc32_le(0,…)` == `zlib.crc32`) | `protocol.js:5-15`, `:25` |
| Payload bytes, 1..262144 | `LUME_FRAME_MAX_PAYLOAD` | `protocol.js:2`, `:17-27` |
| `BACK`, `PAUS`, `RESM` four-byte controls | `LUME_FRAME_CTRL_*` | `protocol.js:3` |
| Final `RELOAD OK/ERR` line | `lume_ota_reply()` (shared by USB + OTA) | `transport.js:24`, `ota.js` |

The C host harness is compiled on the host (no ESP-IDF stubs):

```bash
gcc -std=c11 -Wall -Wextra -Werror \
  -I firmware/components/lume-hotreload/include \
  tests/ota_protocol.c firmware/components/lume-hotreload/lume_frame.c \
  -o /tmp/lume_ota_protocol && /tmp/lume_ota_protocol
```

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
