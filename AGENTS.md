# AGENTS.md — Working Instructions for the Lume Repository

For AI agents and contributors working in this repository. **Code and the empirical evidence in `docs/` reports are the source of truth**: several documents are snapshots of earlier milestones (see §4). When they conflict with the implementation, read the implementation before changing anything.

## 1. Project

Lume lets you write the entire app for an ESP32-S3 AMOLED board in JavaScript — no C, no rebuild-and-flash cycle for every change.

- Target board: Waveshare ESP32-S3-Touch-AMOLED-2.16 (ESP32-S3, 16MB flash, 8MB PSRAM, CO5300 480x480 QSPI AMOLED, CST9220 touch, AXP2101 PMIC, QMI8658 IMU, ES8311/ES7210 audio, TF card).
- Three layers: app JS/TS (declarative UI + signals + `lume.*` hardware APIs) -> C runtime (QuickJS-NG engine, prelude, UI-to-LVGL bridge, hot reload, ESP-IDF components) -> LVGL / ESP-IDF / board drivers.
- **LVGL is only a rendering backend and must not leak into app code**; app developers should not need a C toolchain.
- Status: M1–M3 code complete; M4 tooling in progress (CLI and simulator exist, WiFi OTA pending); M5 has started — optional JS shell components (`runtime/shell.js`: `StatusBar`, `EdgeNavigation`, `Launcher`) and the bilingual docs site have landed, while board abstraction is not started. **On-device acceptance has not happened**: visuals, touch feel, sleep current, radio, etc. are deferred to board bring-up. A green build / green host harness is not the same as working hardware — never claim hardware verification.

See `README.md` and `docs/roadmap.md`.

## 2. Directory map

| Path | Contents |
|---|---|
| `firmware/` | ESP-IDF project (`main/`, `CMakeLists.txt`, `sdkconfig*`, `partitions.csv`) |
| `firmware/components/lume-*` | Feature components: engine / board / ui-bridge / hotreload / gpio / adc / pmic / power / imu / net / storage / audio |
| `firmware/components/quickjs-ng/`, `lvgl/` | Vendored third-party sources; keep changes minimal and documented |
| `runtime/` | Public JS API surface: `types/*.d.ts` (autocomplete / contract), `shell.js` (optional JS-only shell components, bundled by the CLI). **The prelude is not here** |
| `tools/lume/` | `lume` CLI (create / dev / deploy), frame protocol, serial transport, unit tests |
| `tools/simulator/` | Browser simulator and Playwright verification script |
| `examples/` | Nine sample apps, each with `app.js` as its entry point |
| `tests/` | Host harnesses: `*.js` (Node scripts), `*.c` (ABI static assertions), `lib/prelude_runner.js` |
| `docs/` | Design notes, hardware API contract, per-round reports, roadmap, known simplifications |
| `website/`, `scripts/` | Documentation site (GitHub Pages), site-check scripts |
| `.hermes/brief-m1-engine.md` | Historical M1 task brief (build environment quirks and discipline; paths refer to a remote Linux machine) |

## 3. Common commands

Prerequisites: Node.js >= 18. `lume dev/deploy` needs a board flashed with Lume firmware connected over USB Serial/JTAG.

```bash
# CLI dependencies (once)
npm ci --prefix tools/lume

# App development: create scaffolds, dev hot-reloads, deploy pushes once
node tools/lume/lume.js create my-app
node tools/lume/lume.js dev my-app [--port /dev/ttyACM0]
node tools/lume/lume.js deploy my-app
node tools/lume/lume.js --help | --version

# Preview without a board
node tools/simulator/sim.js examples/counter/app.js   # http://localhost:8765
PLAYWRIGHT_MODULE=/path/to/playwright node tools/simulator/verify.js

# Tests
node tests/<harness>.js                 # JS host harnesses, run individually
npm test --prefix tools/lume           # node --test, CLI unit tests
python3 scripts/gen_api_docs.py        # regenerate website/api.html from runtime/types/lume.d.ts (--check verifies freshness)
python3 scripts/check_website.py
```

Interactive `dev` keys: `p` / `r` / `b` -> PAUS / RESM / BACK; `Ctrl+C` exits. `RELOAD OK <length>` from the device means the JS source evaluated; `RELOAD ERR <reason>` means failure.

Firmware builds require Linux + ESP-IDF v5.5 and are not available on a macOS host:

```bash
cd firmware
idf.py set-target esp32s3
idf.py build flash monitor
idf.py size             # size / memory are key project metrics
```

Build environment quirks (leaked `VIRTUAL_ENV`, `IDF_PYTHON_ENV_PATH` pointing at the py3.12 env) and the full command template are in `docs/build.md`, section "Firmware build".

## 4. Key invariants (read before editing)

- **The single source of truth for the JS prelude is `firmware/components/lume-engine/lume_scripts.c`** (a C-embedded source string). `tests/lib/prelude_runner.js` and every harness extract the JS from that file and run it in a Node `vm` — change UI behavior there and update the host harnesses too. `runtime/README.md` describes an early `prelude/index.ts` -> esbuild -> bytecode plan that no longer matches the code; do not use it as a guide.
- **App API contract**: globals `signal` / `View` / `Text` / `Button` / `Canvas` / `List` / `Image` etc. plus the `lume.*` namespaces. Hardware APIs uniformly return `0` for success and a negative error code for failure; signatures and failure modes are in `runtime/types/lume.d.ts` and `docs/hardware-api.md`.
- **Bridge ABI**: numeric ATTR / OP IDs in the prelude map one-to-one to `firmware/components/lume-ui-bridge/include/lume_ui_bridge.h`. Changing an ID or the queue record requires updating the `_Static_assert`s in `tests/bridge_protocol.c`. For UI/protocol changes also check whether `.d.ts`, `examples/`, `tests/`, and `docs/` need to follow.
- **Hot-reload channel**: the CLI emits `iife` + `es2020` **JS source** via esbuild. The device uses `JS_Eval(..., JS_EVAL_TYPE_GLOBAL)` and accepts neither ESM `export` nor QuickJS bytecode. Empty bundles and bundles over 256 KiB are rejected before the port is opened. Frame = magic `LUME` (4B) + payload length u32 LE + CRC-32 u32 LE + payload; controls are `BACK` / `PAUS` / `RESM`. Source of truth: `lume_hotreload.h/.c` and `tools/lume/protocol.js`; cross-check table in `docs/build.md`.
- **Vendored components** (`quickjs-ng/`, `lvgl/`): for platform incompatibilities prefer macro trimming or a minimal stub over large edits to engine sources; record every change in the corresponding `VENDOR.md`.
- **Syntax conventions**: `examples/*/app.js` and the firmware-embedded demo use conservative `var` / `function` plain global scripts (no `import` / `export`); CLI output may contain esbuild-transpiled code; `tools/lume/` is ESM (`"type": "module"`); `tests/*.js` are standalone CommonJS scripts (not `node --test`).

## 5. Change and verification workflow

1. Locate the real source before editing. Assumptions may be wrong — verify with search and the line numbers cited in reports rather than inferring from docs. Keep diffs minimal; do not refactor unrelated files along the way.
2. Run the relevant checks: affected `node tests/*.js` (plus existing harness regressions), `npm test --prefix tools/lume`, and where relevant `idf.py build` + `idf.py size`. Paste **raw output** in reports instead of just saying "passed".
3. Clearly separate host verification from on-device acceptance. All board-level metrics (display/touch orientation, bundle push, audio, sleep current, WiFi, persistence, etc.) stay deferred; record them in `docs/KNOWN-SIMPLIFICATIONS.md` or the matching `docs/rN-*-report.md`.
4. **Do not change the milestone definitions in `docs/roadmap.md`**; newly accepted simplifications and pending acceptance items go into `KNOWN-SIMPLIFICATIONS.md`.
5. Split commits by logical change. Do not push, rewrite git identity/config, or run destructive operations unless explicitly asked.
6. For new features, consider whether `.d.ts` types, examples, host harnesses, and the docs site FAQ/API need updating too.

## 6. Reference entry points

- `README.md` — overview, examples, milestone status
- `docs/build.md` — CLI / simulator / firmware build and frame protocol cross-check
- `docs/hardware-api.md` — hardware API contract
- `docs/reactivity-design.md` — signals design
- `docs/KNOWN-SIMPLIFICATIONS.md` — accepted simplifications and pending acceptance metrics
- `docs/roadmap.md` — milestones and per-round verification status
- Online docs: https://congduan.github.io/lume-esp/
