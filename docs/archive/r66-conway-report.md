# r66 — Conway's Game of Life (P1 replica)

**Status: code complete, host + esp32sim verified. Not hardware-verified.**

## What landed

New `examples/game_of_life/app.js` (self-contained single file) + new
`tests/game_of_life.js`. README **Apps** gallery entry, roadmap P1 Conway row
marked landed, and this report. Screenshot at
`artifacts/emu/ui-refresh/game_of_life.png`.

The firmware C sources, prelude C string, bridge ABI, frame protocol,
`runtime/types/lume.d.ts` and vendored quickjs-ng/lvgl were **not** touched.
No push; commits stay on `r66-conway`. No hiscore (`lume.storage.kv`) — this app
has no score semantics.

## Sizing decision (brief contradiction, resolved empirically)

The brief asked for **60×60 torus grid + 9px cells** *and* a hard **single
canvas ≤300×300**. These are mutually exclusive: 60 × 9px = 540px, which
exceeds both the 480px display and the 90,000px canvas budget. The only reading
that honours all "写死" numbers is to treat "≤60×60" as the ceiling and size the
grid to the canvas:

- **GRID = 33**, `CELL = 9` (8px cell + 1px gap) → 33 × 9 = 297px inside
  `CW = CH = 300` → **90,000px**, leaving 140,400px of the 230,400px app-wide
  budget unused.
- Retained static geometry = `(33+1)×2` grid lines + 4 frame edges =
  **72 segments**, well under the 240-segment/path cap. The brief's stop
  condition (60+60=120 would fit) is therefore not triggered at any size.

This is recorded in the roadmap row and asserted by the harness.

## Two-layer rendering

- **Static layer**: grid lines + inset HUD frame are built once into
  `GRID_SEGMENTS` and uploaded with `ctx.retainSegments(...)` on the **first**
  `onDraw` only (`if (!ctx.gridPath)`). Every subsequent redraw replays it from
  C with `ctx.drawPath(ctx.gridPath)` — zero JS geometry cost.
- **Live layer**: the canvas is a persistent bitmap. On generation N the app
  computes `lifeChangedBox(prev, next)` and, in `onDraw`, clears **only that
  box** to background, replays the static grid path to restore grid lines in
  the cleared strip, then `fillRect`s only the live cells inside the box.
  Dead cells are never painted; there is no `ctx.clear()` after the first
  frame. The box is returned as a single dirty rect so the bridge flushes only
  that region (pet/tetris pattern).
- HUD is native `View`/`Text`/`Button` (no canvas font glyphs): title,
  `GEN n   ALIVE k   200/350/500MS   RUN/PAUSE`, `PATTERN` button, hint row.

## Interactions

Tap seeds (dead cell → 5-cell glider placed around the tap; live cell → toggle
it off), swipe up toggles play/pause, swipe left/right cycles the 200/350/500ms
timer, longpress clears. Gesture events carry absolute screen px
(`lv_indev_get_point`), so the tap handler subtracts the canvas origin before
cell-picking. The `PATTERN` button cycles glider → LWSS → pulsar(48 cells) →
random(25% density). Boot state: glider seeded, running at 350ms, so the demo
self-evolves without input.

## Verification (raw outputs)

All evidence is host or esp32sim; no hardware claim. Firmware was unchanged, so
`EMU_SKIP_BUILD=1` was used with the pinned esp32sim and firmware images copied
from the main repo build into the worktree's gitignored `firmware/build/`.

### One-command check — `node tools/lume/lume.js check examples/game_of_life`

```
lume check examples/game_of_life

[PASS] bundle   4674 bytes (77 ms)
[PASS] eval     2x "app eval ok; entering event loop"
[SKIP] layout   no layout expectations for game_of_life
[SKIP] perf     profile disabled

screenshot: artifacts/check/game_of_life/tft.png
RESULT: PASS (4 steps, 0 failed; exit 0)
```

### Host harness — `node tests/game_of_life.js`

```
PASS life budget: GRID<=60, 9px cells, single canvas <=300x300
PASS life B3 birth: dead cell with exactly 3 live neighbours comes alive
PASS life B3/S23 survival 2-3, death 0-1 and 4+
PASS life stable 2x2 block is unchanged
PASS life torus edges wrap neighbour counts across all four borders
PASS life boot: glider seeded, RUN at 350ms, LIFE READY logged
PASS life STATIC layer: retainSegments uploaded exactly once (72 segments)
PASS life LIVE layer: each generation logs LIFE GEN and invalidates <30% of frame
PASS life glider translates while conserving 5 live cells
PASS life tap: empty cell plants glider; live cell toggles off
PASS life swipe up toggles play/pause; left/right cycle 200/350/500ms
PASS life longpress clears the grid
PASS life PATTERN cycles GLIDER -> LWSS -> PULSAR(48) -> RANDOM
life harness: 13 cases passed
```

The layering assertions count native `pathDefine` messages (exactly 1, even
after many generations) and inspect `invalidate` dirty rects per generation.

### Full host harness suite

```
tests/ai.js                             PASS
tests/animation_mapping.js              PASS
tests/apps.js                           PASS
tests/async_jobs.js                     PASS
tests/ble.js                            PASS
tests/canvas_mapping.js                 PASS
tests/create_failure.js                 PASS
tests/files_dialog.js                   PASS
tests/game_of_life.js                   PASS
tests/games.js                          PASS
tests/gesture_queue.js                  PASS
tests/gestures.js                       PASS
tests/gravity_ball.js                   PASS
tests/image_mapping.js                  PASS
tests/lifecycle.js                      PASS
tests/list_virtualization.js            PASS
tests/music_player.js                   PASS
tests/pet.js                            PASS
tests/power.js                          PASS
tests/reload_staging.js                 PASS
tests/shell_components.js               PASS
tests/style_mapping.js                  PASS
tests/text_payload.js                   PASS
tests/theme_mapping.js                  PASS
tests/watchface.js                      PASS
tests/weather.js                        PASS
tests/ws.js                             PASS
=== exit: 0 ===
```

`npm test --prefix tools/lume`: 44 tests, 43 pass, 1 skipped, 0 fail.

### 10s emu session — screenshot + serial event log

```
$ EMU_SKIP_BUILD=1 EMU_SECONDS=10 tools/emu/run.sh examples/game_of_life
bundle /tmp/lume-r66-wt/examples/game_of_life: source 4674 bytes; payload 4674 bytes; frame 4686 bytes (source)
I (1730) lume-engine: engine task up (pinned core 1), PSRAM free=5588036 bytes
I (1802) lume-engine: runtime up; eval app '<home>' (5127 bytes)
I (1916) lume-engine: app eval ok; entering event loop
I (2685) lume-engine: engine recv RELOAD -> recycle runtime
I (2914) lume-engine: runtime up; eval app '<embedded-demo>' (4674 bytes)
I (2963) lume-engine: app eval ok; entering event loop
[emu] stop: Halted — core0 385252718 + core1 324349641 insns in 17.7s wall = 40.1 Minsn/s; emulated 10.000s (2400000000 cycles); 368958 exceptions, 28571 interrupts
TFT: /tmp/lume-r66-wt/artifacts/emu/game_of_life/tft.png
serial: /tmp/lume-r66-wt/artifacts/emu/game_of_life/serial.log
```

Sample of the 20 `LIFE GEN` events (following the tetris `TETRIS LINE` pattern):

```
I (2962) lume-engine: js: LIFE READY grid=33 canvas=300x300 speed=350
I (3375) lume-engine: js: LIFE GEN 1 alive=5 dirty_px=648
I (3730) lume-engine: js: LIFE GEN 2 alive=5 dirty_px=729
I (4085) lume-engine: js: LIFE GEN 3 alive=5 dirty_px=648
...
I (9765) lume-engine: js: LIFE GEN 19 alive=5 dirty_px=648
I (10120) lume-engine: js: LIFE GEN 20 alive=5 dirty_px=729
```

**Vision self-check** (480×480 PNG, inspected):
- full 33×33 grid of hairlines visible, inset frame intact;
- a 5-cell bright teal glider visible mid-grid, generation 20 position differs
  from boot — evolution is live;
- HUD readable: `GAME OF LIFE`, `GEN 20   ALIVE 5   350MS RUN`, `PATTERN`
  button, and the `TAP seed … HOLD clear` hint row. No overlap or clipping.

### Performance self-attestation

- **Per-generation invalidate area: 648–729px** of a 90,000px frame =
  **0.72–0.81%**, far below the 30% target (the glider changes only 8–9 cells
  per step). Confirmed in both the host harness and the emu `dirty_px` log.
- **500ms-tier JS cost, emu instruction relative comparison (NOT real
  hardware):** three 10s esp32sim runs with only the boot `speedIndex` changed
  (temp copies in `/tmp`, not in the repo) gave:

  | tier | generations | core0 insns | core1 insns | total |
  |---|---:|---:|---:|---:|
  | 200ms | 33 | 531,478,950 | 493,854,809 | 1,025,333,759 |
  | 350ms | 20 | 385,252,718 | 324,349,641 | 709,602,359 |
  | 500ms | 13 | 306,492,396 | 239,012,739 | 545,505,135 |

  Linear fit over the three points: slope ≈ **2.40×10⁷ instructions per
  generation**, fixed boot/loop cost ≈ 2.34×10⁸ insns. The 350ms point is
  predicted within 0.6%, so the per-generation cost is stable across tiers.
  This instruction count includes the C-side retained-path replay, raster and
  dirty flush — it is a relative emulator metric, **not** a JS-only profile,
  a frame time, or a real-board measurement. No physical fps was measured.

## Deferred / not verified

- On-device touch feel, display orientation and real frame rate (board
  bring-up not done — applies to every Lume app).
- The drawings are exercised through esp32sim's frame buffer and host harness,
  not a physical AMOLED panel.
- Speed/tap/swipe/pattern interactions are covered by the host harness; the
  emu session exercises boot + automatic evolution only (no touch injected).
