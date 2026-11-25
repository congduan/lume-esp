# r166 ColorPicker and color_demo

## Scope and API

`lume.ui.shell.ColorPicker({parent,x,y,initialHex,onChange,onConfirm,onDismiss})` returns one 300x360 Canvas node. `shell.dispose(node)` removes the Canvas, its `tap`/`pan`/`panend` listeners, and its pause subscription. App pause also disposes it. Each mount owns its own HSV value, callback clock, signal, and subscriptions; no picker selection is global. `initialHex` accepts exactly `#RRGGBB`; invalid input warns and falls back to `#40D8B0`. The Canvas draws a 96x48 preview and ASCII HEX text. `hsvToHex` and `hexToHsv` are pure shell helpers exposed for use and testing.

## HSV math and interaction

`hexToHsv` normalizes RGB by 255, takes `hi=max(r,g,b)`, `lo=min(...)`, and `d=hi-lo`. `V=hi`, `S=d/hi` (zero for black). Hue comes from the maximal channel's six-sector formula and is normalized to `[0,360)`. `hsvToHex` computes `C=V*S`, `X=C*(1-|((H/60)%2)-1|)`, and `m=V-C`; the six sectors select the RGB permutation, then add `m` and round to 8-bit channels. Fourteen standard colors, including red/orange/yellow/green/cyan/blue/purple/black/white/gray, round-trip with channel error at most 1/255.

The ring center is local `(150,110)` with a 90 px stroke radius and 16 px width. Its 24 `ctx.arc` calls cover 15 degrees each, starting at red on the right and proceeding clockwise through yellow, green, cyan, blue, and purple. Touches with radius 82..98 map to `H=(atan2(y-110,x-150)*180/pi+360)%360`. Two 240x36 strips at local `x=30..270`, `y=213..249` and `263..299` independently map `S` and `V` to `(x-30)/240`. Two strips cost less than adding a two-mode slider state and keep both values visible. Touches outside these regions and the two buttons do nothing. Preview text uses dark or light ink according to the selected color's weighted RGB brightness.

A changed tap emits `onChange` immediately. A drag updates the Canvas on every changed sample, emits the first `onChange` immediately, and emits at most once per next 100 ms. `panend` flushes the final pending HEX so the app receives the released selection. SAVE flushes any pending value and calls `onConfirm(hex)`; CLOSE disposes and calls `onDismiss()`.

## Consumer

`examples/color_demo/app.js` restores `demo.color` from KV, with the accent fallback for absent or invalid saved data. `onChange` drives the lower HEX label, circle, rectangle, and Canvas text tint through a signal. SAVE writes `demo.color` and changes the toast line to `SAVED` after a successful `kv.set` return. The next app launch restores the stored color. The app uses no IMU or board hardware APIs.

## Evidence and limits

- [Full picker](../artifacts/r166/colorpicker-full.png): ring, both strips, preview, and HEX.
- [Applied color](../artifacts/r166/color-demo-applied.png): selected green applied to circle, rectangle, text, and `SAVED` line.
- `artifacts/r166/colorpicker.log` and `color_demo.log`: host behavior and mutation proofs.
- `artifacts/r166/host-summary.log`: all standalone host harnesses; `host-logs.tar.gz` holds their individual raw outputs.
- `artifacts/r166/cli-tests.log`, `lume-check.log`, `api-check.log`, `website.log`, and `playground-build.log`: CLI, bundle, generated docs, site, and playground gates.

Existing historical scope guards were updated with exact r166 paths. Their earlier failures listed `runtime/shell.js` and `runtime/types/lume.d.ts`; `ota_consumers` also needed the generated `website/playground/apps/controls_demo.js` path, and anticipates the new example, two harnesses, and this report after commit. The guard mutations now use an unexpected firmware path, so a new out-of-scope change still fails. No firmware, prelude, or CLI tool file changed.

The repository's current playground builder lists 61 apps, despite the brief's older 57-app count. It rebuilt all 61 and regenerated the shell-dependent bundles. The new demo is verified with `lume check --no-emu` and the simulator; it is outside the existing hard-coded playground list, which cannot be edited under this round's `tools/` restriction.

These are host and simulator results. Device visuals, real touch feel, KV persistence on flash, and timing on hardware remain pending board acceptance.

### Raw gate excerpts

```text
lume check examples/color_demo
[PASS] bundle   24207 bytes (77 ms)
[SKIP] eval     --no-emu
[SKIP] layout   requires emulator screenshot (--no-emu)
[SKIP] perf     profile disabled
RESULT: PASS (4 steps, 0 failed; exit 0)

api.html is up to date with lume.d.ts (161 entries)
PASS esbuild-wasm assets and 61 editable sources
PASS prelude 67428 bytes; 61 apps
98 host harnesses: PASS 98, FAIL 0
CLI tests: PASS 49, FAIL 0, SKIP 1
```
