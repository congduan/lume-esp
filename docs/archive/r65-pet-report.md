# r65 — Desktop pet (pixel electronic pet, final P0 replica)

**Status: code complete, host + esp32sim verified. Not hardware-verified.**

## What landed

New `examples/pet/app.js` + `tests/pet.js`; README gallery row and roadmap P0
registration. The firmware C sources, the prelude C string, bridge ABI, frame
protocol, `runtime/types/lume.d.ts` and vendored quickjs-ng/lvgl were **not**
touched. No push; commits stay on `r65-pet`.

The pet is a 16×16 pixel creature on a full-screen 480×480 canvas with native
`View`/`Text`/`Button` HUD widgets. Interactions are exactly the roadmap's
single-touch + IMU set: **tap = pet** (`happy+`, → HAPPY), **longpress = feed**
(`hunger−`), **wrist flip = startle** (IMU magnitude deviation from ~9.81 m/s²,
debounced, → SURPRISED, wakes from sleep). A 20 Hz timer drives need decay and
a 16 s no-interaction auto-sleep. Two skins (CAT / SLIME) swap both palette and
pixel geometry; the choice is persisted in `lume.storage.kv` under `pet.skin`
(8 chars) and restored on the next runtime.

## State machine (pure JS)

`IDLE / HAPPY / HUNGRY / SURPRISED / SLEEP`. `careStep(care, now, dtSec)` is the
pure transition rule: hunger rises 2.5/s (half rate while asleep), happiness
falls 1.2/s; HAPPY (2.5 s) and SURPRISED (1.5 s) hold until `care.until`, then
fall back to HUNGRY when `hunger ≥ 70` else IDLE; SLEEP holds until an explicit
`wake()` (pet / feed / startle). Feeding from HUNGRY returns to IDLE. Values
are demo tuning, not a real pet-growth model.

`lume.imu.read()` is `{ax,ay,az}` in m/s² (gravity included, ~9.81 at rest)
plus `{gx,gy,gz}` in deg/s, or `null` on no board. `sampleImu()` mirrors the
watchface `goalSample` debounce: re-arm when `|mag−9.81| < 1.2`, fire once when
`|mag−9.81| > 4`. A near-zero vector (< 5) is ignored — esp32sim emits one at
boot, and treating it as a flip startled the pet on every boot (fixed and
re-verified: `PET STARTLE` count 0 in the final `lume check`).

## Pixel spans + dirty-rect raster

The sprite is a 2-D palette-index grid (`buildCat` / `buildSlime` + per-state
`makeVariant`). `buildSpans(grid)` merges each row's consecutive same-colour
cells into `[y, x, width, colour]` fillRects, precomputed once for every
(skin, state, frame) pair at load. `changedBox(prev, next)` returns the tight
cell bounding box of cells whose colour differs (or the full sprite box when
the HAPPY bob offset changes). On repaint, only that box is cleared with the
background colour and only spans intersecting it are re-emitted; the returned
dirty rect is the pixel-space equivalent. The four IDLE frames change only the
eye rows, so the harness measures **72–96 × 12 px** dirty rects. SLEEP is one
static frame and the tick does not bump the redraw signal: 40 sleep ticks
produced 0 draw and 0 invalidate commands. This keeps this app well inside the
20–30 fps canvas budget; no physical frame rate was measured.

## Hot reload = skin store demo

Switching a skin is pure data (pixel table + palette) plus one KV write — no C
rebuild. That is the selling point documented in README for app authors: new
skins ship as a hot-reload `lume dev` push, "no reflash to change pet/outfit".
This round demonstrates a second in-app skin and persistence; it does **not**
implement an online store, OTA fetch or preview/purchase flow. `kv.get()`
negative values are ambiguous (stored number vs error code, per the d.ts), so
the app only accepts `=== 1` and falls back to skin 0 otherwise.

## Verification (raw outputs)

All evidence is host or esp32sim; no hardware claim.

### One-command check — `node tools/lume/lume.js check examples/pet`

Firmware unchanged, so `lume check` auto-set `EMU_SKIP_BUILD=1` (images present
in the worktree, copied from the main repo's 15:18 build); `EMU_BIN` points at
the pinned esp32sim. Exit code 0:

```
lume check examples/pet

[PASS] bundle   7001 bytes (20 ms)
[PASS] eval     2x "app eval ok; entering event loop"
[SKIP] layout   no layout expectations for pet
[SKIP] perf     profile disabled

screenshot: artifacts/check/pet/tft.png
RESULT: PASS (4 steps, 0 failed; exit 0)
EXIT_CODE=0
```

Full serial proof of reload/eval (no spurious startle after the guard):

```
I (1730) lume-engine: engine task up (pinned core 1), PSRAM free=5588036 bytes
I (1802) lume-engine: runtime up; eval app '<home>' (5127 bytes)
I (1916) lume-engine: app eval ok; entering event loop
I (2686) lume-engine: engine recv RELOAD -> recycle runtime
I (2919) lume-engine: runtime up; eval app '<embedded-demo>' (7001 bytes)
I (3003) lume-engine: js: PET READY skin=0 CAT state=IDLE
I (3003) lume-engine: app eval ok; entering event loop
[emu] stop: Halted — core0 152787702 + core1 90136056 insns in 6.6s wall = 36.8 Minsn/s; emulated 8.000s (1920000000 cycles); 387261 exceptions, 23748 interrupts
```

### Emu screenshots — idle / sleep / skin swap

Three `EMU_SKIP_BUILD=1` captures with distinct `EMU_OUTPUT_DIR`s (temp app
copies in `/tmp` only — not in the repo). Each was visually inspected at
480×480:

- **Idle** (`artifacts/check/pet/tft.png`, also `artifacts/emu/ui-refresh/pet.png`):
  HUD `LUME PET` / `IDLE` / `CAT`, yellow cat sprite with ears, eyes and belly,
  `HUNGER 28  HAPPY 50`, hint rows. Serial: `PET READY skin=0 CAT state=IDLE`.
- **Sleep** (`/tmp/lume-r65-emu/sleep/tft.png`): HUD `SLEEP`, eyes drawn as
  closed horizontal pixel lines, a small pixel Zzz at the sprite's top-right.
  Serial: `PET STATE SLEEP` / `PET SLEEP hunger=18`. No font glyph used for Zzz.
- **Skin 2** (`/tmp/lume-r65-emu/skin2/tft.png`): HUD top-right `SLIME`, teal
  round-tuft creature instead of the yellow cat — both palette and geometry
  changed. Serial: `PET SKIN 1 SLIME kv=0`.

### Touch input smoke (direct esp32sim, independent /tmp actions)

`run.sh` overwrites `EMU_OUTPUT_DIR/actions.txt`, so the script was written to
an independent `/tmp` path and esp32sim invoked directly with run.sh's exact
argument line. Tap = `touch x y 1` (down) → `touch x2 y 1` (move) → `touch x2 y 0`
(up), injected through the real CST9220 touch pipeline:

```
=== actions.txt ===
2.5 serial-file /tmp/lume-r65-wt/artifacts/check/pet/app.frame
4.0 touch 240 210 1
4.15 touch 241 210 1
4.3 touch 241 210 0
```

```
[script] t=2.500s serial-file (7013 bytes)
[script] t=4.000s Touch(240, 210, true)
[script] t=4.150s Touch(241, 210, true)
[script] t=4.300s Touch(241, 210, false)
I (3003) lume-engine: js: PET READY skin=0 CAT state=IDLE
I (4489) lume-engine: js: PET WAKE pet
I (4492) lume-engine: js: PET STATE HAPPY
I (4492) lume-engine: js: PET PET happy=75 state=HAPPY
```

Capturing at `--max-seconds 5.2` shows the HAPPY frame (HUD `HAPPY`, wider
smile with cheek pixels, `HAPPY 74`); at 8 s the 2.5 s HAPPY window has expired
and the frame is IDLE again. Longpress feed and IMU startle are covered by the
host harness below, not by this touch script.

### Host harness — `node tests/pet.js`

Real prelude + `runApp`, fake clock, injected IMU and a stateful KV stand-in:

```
PASS pet app loads: IDLE, skin 0, precomputed sprite spans and one full paint
PASS pet buildSpans merges runs and covers exactly the non-empty cells
EVIDENCE PET PET happy=77 state=HAPPY | state=HAPPY
PASS pet tap = pet: happy rises, state -> HAPPY (via gesture dispatch)
EVIDENCE PET FEED hunger=15 state=IDLE | state=IDLE
PASS pet longpress = feed: hunger drops (via gesture dispatch)
PASS pet IMU magnitude spike = startle: -> SURPRISED, then decays back
PASS pet time decay drives hunger into HUNGRY and feeding resolves it
PASS pet sleep is timer-driven; wake()/startle resumes, sleeping decays slowly
EVIDENCE skin KV keys=["pet.skin"]
PASS pet skin switch writes pet.skin (<=15 chars) and wraps modulo 2
PASS pet a fresh runtime restores the persisted skin on boot
PASS pet bad KV values fall back to skin 0 (no negative-number discriminator)
EVIDENCE idle dirty rects=12 widths=72,84,96,96,72,84,96,96,72,84,96,96
PASS pet idle animation repaints only the eye rows (<=96px wide, 12px tall)
EVIDENCE sleep 40 ticks -> draws=0 invalidates=0
PASS pet sleeping never repaints the canvas across many ticks
PASS 12 pet host cases
```

### Full regression

```
$ for t in tests/*.js; do node "$t" || exit; done
LOOP_EXIT=0        # includes all 12 pet cases above

$ npm test --prefix tools/lume
1..44
# tests 44
# suites 0
# pass 43
# fail 0
# cancelled 0
# skipped 1
# todo 0
# duration_ms 2092.482883
NPM_EXIT=0
```

## Known limits

- No physical display, touch feel, wrist-flip feel/axis/threshold, sleep
  current, bundle push or KV persistence across power cycles was verified.
  esp32sim's IMU is stationary (boot emits a near-zero vector that the app
  ignores), so the startle path has host-injected-sample evidence only.
- Need-decay numbers and thresholds are demo tuning, not calibrated behaviour.
- Skins are hard-coded in `app.js`; the "store" is a hot-reload demonstration
  for app authors, not an online catalogue.
- See `docs/KNOWN-SIMPLIFICATIONS.md` (r65 section) for the full deferred list.
