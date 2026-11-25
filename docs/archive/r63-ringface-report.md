# r63 Activity Rings watch face

## Scope

Baseline `origin/main` = `1fcadf7d9c5d4c29e7ff6b99c88cb490d884a93e` after fetch. The existing `faceShow` cycle and swipe handlers matched the brief. `CanvasContext.arc` accepts native AA annulus geometry with color but no `track` parameter, so this face draws three dim tracks and three progress arcs with six native calls. The existing third face retains its PMIC battery ring; the fourth face shows a PMIC battery readout.

The fourth face uses a 220×220 canvas. Together with the two existing 300×300 canvases it requires 456,800 RGB565 bytes against the shared 460,800 byte budget. The three radii are 100, 81 and 62 px; width is 16 px, leaving 3 px clear between bands. Each redraw returns local dirty rectangle `(2,2,216,216)`, area **46,656 px**, or 20.25% of the full 480×480 display. It updates at 1 Hz. The clock and three numeric complications are text nodes above the canvas.

On no sensor, progress animates from demo values and clamps at 100%. Once QMI8658 acceleration samples cross a 1.35 m/s² magnitude deviation from gravity, a 300 ms debounced crossing counts as an estimated step. Kcal, exercise minutes and stand count are illustrative estimates from this signal, not measured health data. The PMIC reading falls back to a labelled 78% demo value when unavailable. The host and emulator checks do not establish activity accuracy or hardware appearance.

## Host verification

```
$ node tests/watchface.js
PASS watchface four-page swipe cycle
PASS watchface six native AA arcs; dirty area 46656 px
PASS watchface progress clamps 0..100

$ node tools/lume/lume.js check examples/watchface --no-emu
lume check examples/watchface

[PASS] bundle   6481 bytes (181 ms)
[SKIP] eval     --no-emu
[SKIP] layout   requires emulator screenshot (--no-emu)
[SKIP] perf     profile disabled

RESULT: PASS (4 steps, 0 failed; exit 0)

$ npm test --prefix tools/lume
1..44
# tests 44
# suites 0
# pass 43
# fail 0
# cancelled 0
# skipped 1
# todo 0
# duration_ms 9109.210505
```

`for f in tests/*.js; do node "$f" || exit 1; done` exited 0, producing 266 lines. Its watchface lines are shown above; final raw tail:

```
PASS weather dayAt falls back for out-of-range indexes
PASS weather icons issue the expected raster commands and repaint the whole canvas
PASS 10 weather logic cases
PASS weather refresh replaces the demo data
PASS weather request failure keeps the app usable
PASS weather non-200 response is reported
PASS 13 weather cases (10 logic + 3 UI)
WebSocket host prelude: PASS
```

Board acceptance remains open.

Final post-capture check after the typography fix:

```
$ node tools/lume/lume.js check examples/watchface
lume check examples/watchface

[PASS] bundle   6479 bytes (20 ms)
[PASS] eval     2x "app eval ok; entering event loop"
[SKIP] layout   no layout expectations for watchface
[SKIP] perf     profile disabled

screenshot: artifacts/check/watchface/tft.png
RESULT: PASS (4 steps, 0 failed; exit 0)
```

## Emulator capture

The specified `EMU_SKIP_BUILD=1 EMU_SECONDS=10 tools/emu/run.sh examples/watchface` completed with the original app. A second 10-second run loaded the same app with `faceShow(3);` appended through its `LUME` serial frame; this selected the fourth face for the image now at `artifacts/emu/ui-refresh/watchface.png`. The source app's default start page remains 0.

```
$ EMU_SKIP_BUILD=1 EMU_SECONDS=10 tools/emu/run.sh examples/watchface
I (2689) lume-engine: engine recv RELOAD -> recycle runtime
I (2919) lume-engine: runtime up; eval app '<embedded-demo>' (6481 bytes)
I (3016) lume-engine: app eval ok; entering event loop
[emu] stop: Halted — core0 415460919 + core1 95626577 insns in 12.9s wall = 39.7 Minsn/s; emulated 10.000s (2400000000 cycles); 405143 exceptions, 29564 interrupts
TFT: /tmp/lume-r63-wt/artifacts/emu/watchface/tft.png
serial: /tmp/lume-r63-wt/artifacts/emu/watchface/serial.log

$ EMU_SKIP_BUILD=1 EMU_SECONDS=10 EMU_OUTPUT_DIR=artifacts/emu/watchface-face4 tools/emu/run.sh /tmp/lume-r63-face4
I (2689) lume-engine: engine recv RELOAD -> recycle runtime
I (2919) lume-engine: runtime up; eval app '<embedded-demo>' (6484 bytes)
I (3016) lume-engine: app eval ok; entering event loop
[emu] stop: Halted — core0 421884909 + core1 95643560 insns in 12.9s wall = 40.1 Minsn/s; emulated 10.000s (2400000000 cycles); 410917 exceptions, 29550 interrupts
```

Visual inspection of the 480×480 capture: three concentric bands with smooth AA edges; clock, kcal, minutes and stand count legible. The first capture exposed missing middle-dot glyphs, replaced by ASCII slashes and confirmed in the final capture. The emulator's stationary IMU keeps the demo path active. The emulator PMIC stub did not return a usable percentage, so the footer explicitly shows `78% DEMO`.

The exact baseline firmware images and emulator executable were copied from `/tmp/lume-r62-wt`, an independent worktree at the same `1fcadf7` commit, after a local build from scratch reached 44% and was stopped. The copied `lume.bin` SHA-256 is `aa2ff896211ab0e389b4084d19dcca84d379220b5528cc73796d2fb33a081e85`. No firmware source changed in r63.
