# r169 — Playground single-source alignment + unregistered example audit

## Baseline (empirical, differs from the brief)

The brief names `origin/main d2bc31a` and a 48-item page. The worktree actually sits at
`5e51789` (`origin/main`), a merge of r170 that also contains r171 (manifest single-source)
and r172 (StoryBook). Measured before any edit:

- `tools/playground/build.mjs` apps: **66** (already contains all 18 "gap" names)
- `website/playground/sources.js` `LUME_SOURCES`: **66**
- `website/playground/page.js` `examples`: **49** (not 48 — r172 added `storybook`)
- `website/playground/index.html`: bundle `<script>` tags for only the old 49 names
- Baseline `verify.mjs`: **FAIL `expected 66 examples, got 49`** (`artifacts/r169/baseline-verify.txt`)

`storybook` was added by r172 directly to `sources.js`/`apps/` without touching the manifest;
r171's later rebuild (`b24fd98`) regenerated `sources.js` from the 66-app manifest and dropped
it. r172's own report describes the same mismatch and explicitly left it untouched.

## Task 1 (primary) — dual source eliminated

### Chosen fix: structural, not "fill the array only"

`renderList()` and the editor `<select>` now both derive their names from
`catalogNames()`, which is driven by `Object.keys(LUME_SOURCES)`. The `examples` array is
now **metadata only** (`icon / en / cn / descriptionEn / descriptionZh`), looked up via
`meta(name)` with a fallback. Consequence: `.app-item` count is *structurally* equal to
`LUME_SOURCES` count; a future manifest addition can no longer leave an invisible app.

Editor-tab logic was checked and is unaffected: `select()` still gates on `LUME_APPS`, the
source picker still reads `LUME_SOURCES[value]`, `setMode()`/`renderList()` now use the same
`meta()` lookup, and `sourceCode` still defaults to `LUME_SOURCES.counter`. Because display
order follows the curated `examples` order (filtered to catalog names), existing visual order
is preserved; only genuinely new entries are appended.

### The 18 gap entries (metadata added, all 18 already in manifest)

`wordring, image_gallery, files, adc_meter, crypto_check, archive_view, img_view, vec_demo,
settings, hr_monitor, keyboard_demo, wordle, controls_demo, timer_kit, control_center,
launcher_grid, minigolf, color_demo`.

Each got a six-tuple written from the actual `examples/<name>/app.js` header/UI strings — no
invented features. All 20 new rows (these 18 plus the two task-two registrations) use ASCII
icons / English names / English descriptions; Chinese is confined to the `cn` and
`descriptionZh` fields (r64 discipline).

Also added the 18 matching `<script defer src="apps/...">` tags to `index.html` — without
them `select()` would raise `Missing bundle` even though the list entry existed (this was the
other half of the r168/r172 gap).

### Adjacent fixes required to make the catalog actually load

- **StoryBook restoration** — added `storybook` back to the manifest (66 → 67) and regenerated
  `apps/storybook.js` / `sources/storybook.js` (byte-identical to r172's copies; no diff). This
  undo-r171 regression is why the final count starts above the brief's 66. Without it the
  structural fix would silently hide a working, script-tagged app.
- **Browser `lume.adc` stub (new bug item)** — `adc_meter` was already a registered manifest app
  but had no `lume.adc` in `website/playground/runtime.js`, so merely listing it made `eval`
  throw (`Cannot read properties of undefined`). Added an `adcStub()` mirroring the native
  return-code contract (`config`/`readRaw`/`readMv` → `-3` unsupported, `free` → `0`), matching
  the existing `cryptoStub()`/`compressStub()` pattern. `adc_meter` now renders `err -3` as
  ASCII text (16 nodes in verify). No app source or firmware/prelude changed.

## Task 2 — 13 unregistered examples audit

Each `examples/<name>/app.js` was read; classification is by browser degradability, not by
name guessing.

| App | Decision | Reason |
|---|---|---|
| `mochi` | **Register** | Pure Canvas mascot renderer + `lume.gesture.on` / `setInterval`; all stubbed. Renders 7 nodes in verify. |
| `shell_demo` | **Register** | `shell.StatusBar` / `shell.EdgeNavigation` demo, pure JS via bundled `shell.js`. Renders 14 nodes in verify. |
| `ai_chat` | Skip | Requires a provisioned API key, WiFi and `lume.ai.chat`; browser runtime has no `lume.ai` stub. Needs a real AI service. |
| `app_manager` | Skip | Operates the device app registry (`lume.apps.remove/entries/home`); in-browser `remove()` would mutate the host stub's app table — not a browser demo. |
| `device_monitor` | Skip | Its entire purpose is live PMIC rails, die temperature, IMU and BLE telemetry. Browser stubs return fixed synthetic values; registering would present fabricated hardware readings. |
| `games` | Skip | No `app.js` — only `README.md` + `shared.js`, a shared library for the already-registered `games_*` apps. Not a standalone app. |
| `imu_poll` | Skip | `lume.imu.read()` stub returns `null`, so it only shows "IMU unavailable" plus a ticking second; redundant with the registered `compass` / `gravity_ball` IMU demos. |
| `launcher` | Skip | Real-device app switcher (`setBoot`/`launch`/`home`) and a near-duplicate of registered `launcher_grid` (shell.Launcher). |
| `net_check` | Skip | Headless acceptance harness; needs flash-injected `__NETCHECK_CONFIG` and an HTTP endpoint. |
| `nettest_open` | Skip | ESP-EMU WiFi association test; needs a real radio / AP. |
| `typewriter_min` | Skip | Minimal variant of the already-registered `typewriter`. |
| `web_config` | Skip | `lume.net.web` LAN config server plus hardcoded placeholder WiFi credentials/token. |
| `ws_echo` | Skip | Needs WiFi and an external WebSocket echo endpoint (`wss://echo.websocket.org`). |

Net: 2 registrations (`mochi`, `shell_demo`); 11 skips. No app was registered to hit a number.

### Manifest cascade

Final manifest count: **69** = 66 baseline + `storybook` (restored) + `mochi` + `shell_demo`.
The brief's anticipated `ota_consumers.js` count cascade was **checked and not needed**: r171
already removed fixed `=== 6x` manifest-count literals (verified by grep across `tests/` and
`tools/playground/`); the surviving assertions are membership/shape checks (`apps.length > 0`,
`includes('dashboard')`, set equality in `tests/playground_manifest.js`). `tests/ota_consumers.js`
was updated only to allowlist the new r169 files in its scope guard.

## Verification (raw output in `artifacts/r169/`)

- `build.txt` — 69/69 `PASS bundle` lines; `PASS esbuild-wasm assets and 69 editable sources`;
  `PASS prelude 67428 bytes; 69 apps`.
- `verify.txt` — `NODE_PATH=/home/ubuntu/.npm/_npx/705bc6b22212b352/node_modules node
  tools/playground/verify.mjs` exits **0**, 14 `PASS` checks, no `FAIL`. Includes per-app node
  counts for all 69 items (`all examples load without runtime errors`), notably `mochi: 7`,
  `shell_demo: 14`, `adc_meter: 16`, `storybook: 20`.
- `regression.txt` — `for t in tests/*.js; do node $t; done`: **100 tests, 0 FAIL** (one PASS
  summary line per harness).
- `guard.txt` — `node tests/ota_consumers.js`: `ALL OTA CONSUMERS HARNESS CASES PASSED`.
- `website.txt` — `python3 scripts/check_website.py` exit 0; API missing/invented/duplicates: none.
- `baseline-verify.txt` — pre-fix `FAIL expected 66 examples, got 49`.

All checks are host-side. No board/radio/touch verification is claimed; on-device acceptance
stays deferred per AGENTS.md.

## Scope

Changed: `tools/playground/build.mjs`, `website/playground/{page.js,index.html,runtime.js,sources.js,
apps/,sources/}`, `tests/ota_consumers.js`, this report, `artifacts/r169/`.
Unchanged: `firmware/`, repo-root `runtime/`, prelude, every `examples/*/app.js`. No push.
