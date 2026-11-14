# Build and development

## App Quick Start

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

Source of truth: [hotreload header](../firmware/components/lume-hotreload/include/lume_hotreload.h) and [parser](../firmware/components/lume-hotreload/lume_hotreload.c). The CLI frame implementation is [protocol.js](../tools/lume/protocol.js).

| Field | Firmware source | CLI source |
|---|---|---|
| Magic `LUME`, 4 bytes | `lume_hotreload.c:32-35`, `:177` | `protocol.js:23` |
| Payload length, u32 little endian, excludes 12-byte header | `lume_hotreload.c:121-125`, `:197-202` | `protocol.js:24` |
| CRC-32 of payload, u32 little endian | `lume_hotreload.c:202`, `:239-245` | `protocol.js:5-15`, `:25` |
| Payload bytes, 1..262144 | `lume_hotreload.c:37`, `:204-215`, `:228-239` | `protocol.js:2`, `:17-27` |
| `BACK`, `PAUS`, `RESM` four-byte controls | `lume_hotreload.c:168-176` | `protocol.js:3` |
| Final `RELOAD OK/ERR` line | `lume_hotreload.c:51-60` | `transport.js:18-30` |

## Firmware build

ESP-IDF v5.5, board component `waveshare/esp32_s3_touch_amoled_2_16 ^2.0.1`, vendored QuickJS-NG and LVGL 9:

```bash
cd /opt/esp/esp-idf
env -u VIRTUAL_ENV IDF_PYTHON_ENV_PATH=/home/ubuntu/.espressif/python_env/idf5.5_py3.12_env bash -c '. ./export.sh >/dev/null 2>&1; cd /home/ubuntu/lume/firmware && idf.py build'
```

The CLI is under `tools/lume`; it does not enter a firmware component or affect its IRAM/flash size.
