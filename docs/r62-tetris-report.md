# r62 Tetris: first P0 classic game

Implementation: `3bfa796` (`examples/games_tetris/app.js`, `tests/games.js`). The app is a standalone global script with a 10×20 board and standard I/O/T/S/Z/J/L shapes. `pan` follows columns using the gesture's cumulative `dx`; `tap` rotates clockwise with ±1 column kicks; a 50–119 px downward swipe moves one row and a ≥120 px swipe drops to lock. Lines score 100/300/500/800 times the pre-clear level; gravity starts at 700 ms and floors at 80 ms. `hiscore.tetris` is 14 bytes and KV exceptions leave a volatile best score.

The 160×320 board canvas draws changed cells and invalidates their bounding rectangle. A separate 80×80 next canvas redraws only when a new piece spawns, so preview changes never force a board repaint. There is no line animation. The emu touch smoke cleared one row and logged the actual board invalidation: `48,640 px` (`160×304`), 21.1% of a full 480×480 frame (`230,400 px`). A normal one-row piece move is much smaller; the worst clear can invalidate the full board (`51,200 px`). The 80 ms gravity floor is below the 20–30 fps canvas pacing budget; no physical-board frame rate has been measured.

## Verification

`node tools/lume/lume.js check examples/games_tetris`:

```text
[PASS] bundle   5906 bytes (68 ms)
[PASS] eval     2x "app eval ok; entering event loop"
[SKIP] layout   no layout expectations for games_tetris
[SKIP] perf     profile disabled
screenshot: artifacts/check/games_tetris/tft.png
RESULT: PASS (4 steps, 0 failed; exit 0)
```

`EMU_SKIP_BUILD=1 EMU_SECONDS=10 tools/emu/run.sh examples/games_tetris`:

```text
I (2998) lume-engine: app eval ok; entering event loop
[emu] stop: Halted — core0 146878013 + core1 76313149 insns in 6.2s wall = 36.3 Minsn/s; emulated 10.000s (2400000000 cycles); 394391 exceptions, 28560 interrupts
TFT: /tmp/lume-r62-wt/artifacts/emu/games_tetris/tft.png
```

The screenshot was visually checked: grid, current piece, NEXT preview, score, best, level and lines are visible. It was copied to `artifacts/emu/ui-refresh/games_tetris.png`. README's Games table header and separator were expanded from five to six columns before adding the sixth cell; a column-count check returned `6 / 6 / 6`.

Emu input smoke used the same app in a temporary directory with a near-full bottom row and scripted `touch` down/move/up; the temporary seed is not in the repo. Raw serial evidence:

```text
I (3003) lume-engine: js: TETRIS KV set=0 get=42
I (4388) lume-engine: js: TETRIS LINE 1 dirty_px=48640
I (8055) lume-engine: js: TETRIS KV after=100
```

`for t in tests/*.js; do node "$t" || exit; done` exited `0`; the Tetris lines in the raw output were:

```text
PASS tetris clockwise wall kick
PASS tetris line clear, score and speed floor
PASS tetris lock scores cleared row
PASS tetris high score KV and graceful failure
PASS tetris canvas, tap rotation, pan follow, soft and hard drop, line log
```

The initial full `lume check` attempt timed out while building absent firmware images. A local firmware build then completed after adding `-g0` to the ignored QuickJS build flags to avoid the documented debug-symbol assembler swap stall; optimization and source were unchanged. The successful check above used that newly built image. Emu and host evidence do not establish on-device touch feel, visual orientation, storage persistence across power cycles or frame rate; board acceptance remains pending.
