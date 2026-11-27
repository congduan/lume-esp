# Lume r212 Report: Canvas Render Performance Audit & Top-5 Hotspot Optimization

- **Round**: r212
- **Baseline HEAD**: `3739af4` (`origin/main`, 2026-11-27)
- **Branch**: `r212-render-perf` (pure app / test / docs / playground build artifacts; **zero changes** to `firmware/`, `runtime/`, `tests/lib/prelude_runner.js`, or vendored sources)
- **Verification scope**: Host prelude runner (`tests/lib/prelude_runner.js`), browser playground + Playwright (`tools/playground/verify.mjs`), CLI unit tests (`npm test --prefix tools/lume`), full JS host regression (`111/111`), and deterministic `esp32sim` instruction-count A/B on the same `lume.bin` firmware image. **No real hardware board was attached; on-device frame rate, touch latency, PSRAM peak headroom, and AMOLED visual inspection remain deferred.**

---

## Task A: Full Canvas App Frame-Budget Audit (All 54 Canvas Apps)

Measured deterministically via `tests/lib/prelude_runner.js` using the `tests/skycombat.js` draw-call counter:

```js
draws(ms) = ms.reduce((n, m) => n + (m[0] === 'draw' ? 1 : m[0] === 'batch' ? m[2].length / 6 : 0), 0)
```

For each of the 54 apps in `examples/` that instantiate `Canvas(...)`, we measured:
1. **Boot**: draw calls emitted during initial evaluation (`runApp`).
2. **Anim / Action**: max per-frame draw calls across 20 timer ticks (after `__lume_start()`) or active interactive gesture (e.g. `sokoban` move + highlight, `minesweeper` dig, `memory` flip, `flapdot` run, `spectrum` listen, `storybook` page).
3. **Idle / Over / Paused**: max per-frame draw calls across 10 ticks in static / paused / game-over / stopped state.
4. **dt (ms)**: registered `setInterval` period(s) after `onStart`.
5. **Full Redraw?**: whether steady ticks emit full-canvas `clear()` / `fillRect(0,0,W,H)` or full-canvas `invalidate(id)`.
6. **Retained**: existing `retainPath`/`retainSegments` (`P`) and `retainImage` (`S`) slot usage; whether retained paths/sprites are applicable.
7. **Verdict (data-driven rule: `<=240` AND `idle == 0` -> no-op)**: apps already meeting `<=240` and `idle == 0` are marked **Pass (no-op)**; already-optimized reference apps from prior rounds are marked **Already optimized (untouched)**.

Raw JSON audit snapshot: [`artifacts/r212/audit-full.json`](../artifacts/r212/audit-full.json).

### 1. Hotspot Apps Failing `<=240` or `idle == 0` (Selected TOP 5 for Task B)

| Rank | App | Boot | Anim/Action | Idle/Over/Paused | dt (ms) | Full Redraw? | Retained Usable? | Verdict |
|---|---|---:|---:|---:|---|---|---|---|
| **1** | `invaders` | **877** | **901** | **880** (`paused`) | 60 | N (dirty) | Yes (`retainImage`, 8/8 sprites) | **TOP 1 — Optimized in Task B** |
| **2** | `frogger` | **347** | **315** | **300** (`over`) | 90 | N (dirty) | Yes (`retainImage`, 8/8 sprites) | **TOP 2 — Optimized in Task B** |
| **3** | `sokoban` | **2,774** | **1,388** (move/hl) | 0 (`idle`) | 120 | N (dirty) | Yes (`retainImage`, 6/8 sprites) | **TOP 3 — Optimized in Task B** |
| **4** | `minesweeper` | **602** | **371** (dig) | 0 (`idle`) | 1000 | N (dirty) | Yes (`retainImage`, 8/8 tiles + dirty cells) | **TOP 4 — Optimized in Task B** |
| **5** | `skyfire` | 47 | 47 (max 70) | **43** (`over` @ 33ms!) | 33 | Y (full) | Idle gate (`SF_IDLE_DT=100`, 0 draw) | **TOP 5 — Optimized in Task B** |

### 2. Secondary Boot-Only / Non-Continuous >240 Apps (Deferred, Not Modified in r212)

| App | Boot | Anim/Action | Idle | dt (ms) | Full Redraw? | Retained Usable? | Notes |
|---|---:|---:|---:|---|---|---|---|
| `wordring` | 918 | 0 | 0 | none | N (dirty) | Event-driven (no timer) | Static wheel render on boot/input only |
| `memory` | 514 | 253 (flip) | 0 | 150 | N (dirty) | Yes (`retainImage` card back + dirty cards) | Marginal >240 on flip; 0 idle; deferred |
| `settings` | 482 | 0 | 0 | 600 | N (full) | 19 small icon canvases at boot | One-time boot icons; 0 steady draws |
| `games_tetris` | 405 | 101 | 0 | 700 | Y (dirty) | Steady frames already 20–101 (`<=240`) | Boot-only full board paint |
| `wordle` | 302 | 0 | 0 | none | N (dirty) | Event-driven (no timer) | One-time grid paint; 0 steady draws |

### 3. Passing Non-OPT Canvas Apps (`<=240` AND `idle == 0`, No-Op by Data-Driven Rule)

| App | Boot | Anim/Action | Idle | dt (ms) | Full Redraw? | Retained | Verdict |
|---|---:|---:|---:|---|---|---|---|
| `adc_meter` | 31 | 27 | 0 | 250 | Y (full) | 0 | Pass (no-op) |
| `aurora_clock` | 8 | 8 | 0 | 50 | Y (dirty) | P0/S3 | Pass (no-op) |
| `calculator` | 8 | 0 | 0 | none | boot | 0 | Pass (no-op) |
| `clock` | 104 | 104 | 0 | 1000 | Y (full) | 0 (retainSegments usable) | Pass (`<=240`, 1Hz; no-op) |
| `color_demo` | 88 | 0 | 0 | none | boot | 0 | Pass (no-op) |
| `control_center` | 177 | 0 | 0 | none | boot | 0 | Pass (no-op) |
| `device_monitor` | 39 | 0 | 0 | 500 | N | 0 | Pass (no-op) |
| `fishtank` | 135 | 135 | 0 | 33 | N (dirty) | 0 | Pass (no-op) |
| `fitness` | 112 | 112 | 0 | 1000 | Y (full) | 0 | Pass (no-op) |
| `flapdot` | 31 | 57 (`run`) | 5 (`ready` bob) | 33 | N (dirty) | 0 | Pass (intentional r185 5fps ready bob) |
| `games_breakout` | 2 | 4 | 0 | 40 | N (dirty) | 0 | Pass (no-op) |
| `games_snake` | 5 | 2 | 0 | 180, 50 | N (dirty) | 0 | Pass (no-op) |
| `golf` | 50 | 0 | 0 | 50 | N (dirty) | 0 | Pass (no-op) |
| `image_gallery` | 0 | 0 | 0 | none | N | 0 | Pass (no-op) |
| `img_view` | 10 | 0 | 0 | none | boot | P0/S1 | Pass (no-op) |
| `ipod_music` | 7 | 0 | 0 | 1000 | N | 0 | Pass (no-op) |
| `launcher_grid` | 140 | 0 | 0 | 15000 | N | 0 | Pass (no-op) |
| `luna` | 35 | 0 | 0 | 60000 | N | P0/S1 | Pass (no-op) |
| `mario` | 63 | 43 | 0 | 40 | N (dirty) | 0 | Pass (no-op) |
| `mochi` | 132 | 138 | 0 | 50 | Y (full) | 0 (dirty bbox usable) | Pass (`<=240`, 0 paused; no-op) |
| `music_player` | 79 | 28 | 0 | 20 | Y (full) | 0 | Pass (no-op) |
| `particles` | 221 | 221 | 0 | 50 | N (dirty) | 0 | Pass (no-op) |
| `pet` | 48 | 25 | 0 | 100 | N (dirty) | 0 | Pass (r65 sleep 0 redraw; no-op) |
| `plasma` | 46 | 46 | 0 | 50 | Y (full) | 0 | Pass (no-op) |
| `raycast` | 36 | 36 | 0 | 40 | Y (full) | C raycast | Pass (no-op) |
| `scroller` | 0 | 0 (+36 `drawImage`) | 0 | 50 | N (dirty) | P0/S8 | Pass (r83 sprite POC; no-op) |
| `spectrum` | 33 | 33 (`listen`) | 0 (`stopped`) | none/50 | N (dirty) | 0 | Pass (no-op) |
| `spectrum_music` | 51 | 51 | 0 | 30 | Y (dirty) | 0 | Pass (no-op) |
| `speedometer` | 35 | 5 | 0 | 20 | N (dirty) | 0 (paint-once dial) | Pass (r48 native arc + dirty needle) |
| `storybook` | 17 | 34 (`page`) | 0 (`shelf`) | 35 | N | 0 (decode slot) | Pass (no-op) |
| `vec_demo` | 25 | 25 | 0 | 50 | Y (full) | 0 | Pass (no-op) |
| `voice_assistant` | 18 | 18 | 0 | 300, 80 | Y (dirty) | 0 | Pass (no-op) |
| `weather` | 85 | 0 | 0 | 1500 | N | 0 | Pass (no-op) |

### 4. Already-Optimized Reference Apps (Untouched)

| App | Boot | Anim | Idle | dt (ms) | Retained | Status |
|---|---:|---:|---:|---|---|---|
| `clock_round` | 28 | 14 | 0 | 1000 | P3/S0 | Already optimized (untouched) |
| `compass` | 10 | 9 | 0 | 50 | P3/S0 | Already optimized (untouched) |
| `dashboard` | 21 | 21 | 0 | 200 | P1/S0 | Already optimized (untouched) |
| `dashboard_round` | 173 | 87 | 0 | 100 | P4/S0 | Already optimized (untouched) |
| `game_of_life` | 6 | 6 | 0 | 350 | P1/S0 | Already optimized (untouched) |
| `gravity_ball` | 51 | 50 | 0 | 50 | 0 (cached spans + dirty) | Already optimized (untouched) |
| `lcd_dual` | 15 | 10 | 0 | 100 | P2/S0 | Already optimized (untouched) |
| `minigolf` | 7 | 0 | 0 | 50 | P6/S0 | Already optimized (untouched) |
| `skycombat` | 117 | 158 | 0 | 33/100 | 0 (benchmark) | Already optimized (untouched) |
| `timer_kit` | 89 | 0 | 0 | none | P2/S0 | Already optimized (untouched) |
| `watchface` | 186 | 188 | 0 | 1000/100 | P5/S0 | Already optimized (untouched) |

---

## Task B: Top-5 Hotspot Optimizations & Before/After Comparison

All 5 optimizations are pure app-layer changes in `examples/<app>/app.js`, preserving logic functions above the `/* GAME UI */` split verbatim and adding frame-budget + idle-0-draw assertions to `tests/<app>.js`.

### Summary of Techniques Applied

1. **`examples/invaders/app.js`**:
   - Pre-baked all 8 sprites (`smallA`, `smallB`, `medA`, `medB`, `largeA`, `largeB`, `cannon`, `ufo`) once into 2x RGB565 `Uint16Array` bitmaps (~4.7 KiB PSRAM) and uploaded them once via `ctx.retainImage(1..8, ...)`; replayed per frame via `ctx.drawImage(...)` with off-canvas bounds guard.
   - Added `paused`/`over` 0-draw gate in `tick()` and stopped/restarted the timer on pause/resume swipe.
2. **`examples/frogger/app.js`**:
   - Pre-baked all 8 sprites (`frog`, `carR`, `carY`, `carU`, `truckR`, `truckU`, `log`, `lily`) once into 2x RGB565 `Uint16Array` bitmaps (~10.7 KiB PSRAM) and uploaded them once via `ctx.retainImage(1..8, ...)`; replayed per frame via `ctx.drawImage(...)` plus crisp `BAND.safe` side-margin masks (`[0, GX)` and `[GX+COLS*CELL, IW)`).
   - Guarded `tick()` on `state.over` / `'idle'` so game-over emits 0 canvas calls.
3. **`examples/sokoban/app.js`**:
   - Pre-baked all 6 sprites (`wall`, `floor`, `goal`, `box`, `boxGoal`, `player`) once into 32x32 RGB565 `Uint16Array` bitmaps (~12 KiB PSRAM) via `ctx.retainImage(1..6, ...)`.
   - Skipped redundant `floor` under 100%-opaque `wall` tiles, tightened steady dirty rect to `s.level.w*CELL+10 x s.level.h*CELL+10`, and removed the duplicate boot `frame.set(frame()+1)`.
4. **`examples/minesweeper/app.js`**:
   - Pre-baked 8 opaque 38x38 RGB565 tile sprites (`hidden`, `flagged`, `rev0`, `mine`, `boom`, `rev1`, `rev2`, `rev3`, ~23.1 KiB PSRAM) via `ctx.retainImage(1..8, ...)`; rare digits `4..8` overlay spans onto `rev0`.
   - Added per-cell state snapshot (`prevSnap`) for incremental dirty-cell redraws (1..8 changed cells -> 1..8 exact 38x38 dirty rects; >8 changed cells -> single union dirty rect repainting only changed cells) and removed the duplicate boot `frame.set(frame()+1)`.
5. **`examples/skyfire/app.js`**:
   - Applied the `skycombat` r177 idle-cadence pattern (`SF_IDLE_DT = 100`, `sfSchedule()`, `sfOverPainted`): game-over paints once, drops the timer from 33ms to 100ms, emits **0** draws across subsequent ticks, and restores 33ms on `sfRestart()`.

### Host Draw-Call & Total-Op Comparison (BEFORE vs AFTER)

*Note: `draws` = `draw` + `batch` line segments (`tests/skycombat.js` formula); `total ops` = `draws` + `spriteDraw` (honest accounting of retained blits).*

| App | Stage | BEFORE (`draws`) | AFTER (`draws` / `total ops`) | Reduction (`draws` / `total ops`) | Host RGB565 Pixel Diff |
|---|---|---:|---:|---|---|
| **`invaders`** | Boot | 877 | **2** / **58** (8 `spriteDefine` once) | **-99.8%** / **-93.4%** | **0 / 230,400 px** (bit-identical) |
| **`invaders`** | Active (30-tick max) | 901 | **3** / **59** (0 re-uploads) | **-99.7%** / **-93.5%** | **0 / 230,400 px** (bit-identical) |
| **`invaders`** | Paused / Over (10 ticks) | 880 / 880 | **0** / **0** | **-100%** | — |
| **`frogger`** | Boot | 347 | **21** / **53** (8 `spriteDefine` once) | **-93.9%** / **-84.7%** | **0 px inside playfield** (margins masked clean) |
| **`frogger`** | Active (30-tick max) | 315 | **16** / **48** (0 re-uploads) | **-94.9%** / **-84.8%** | **0 px inside playfield** |
| **`frogger`** | Over (10 ticks) | 300 | **0** / **0** | **-100%** | — |
| **`sokoban`** | Boot | 2,774 | **1** / **81** (6 `spriteDefine` once) | **-99.96%** / **-97.1%** | **0 / 230,400 px** (bit-identical) |
| **`sokoban`** | Move / Highlight-off | 1,388 / 1,387 | **2** / **82** ; **1** / **81** | **-99.9%** / **-94.1%** | **0 / 230,400 px** (bit-identical) |
| **`sokoban`** | Idle (10 ticks) | 0 | **0** / **0** | kept 0 | — |
| **`minesweeper`** | Boot | 602 | **1** / **101** (8 `spriteDefine` once) | **-99.8%** / **-83.2%** | **0 / 230,400 px** (bit-identical) |
| **`minesweeper`** | Dig (flood) / Flag | 371 / 309 | **0** / **22** ; **0** / **1** | **-100%** / **-94.1%..-99.7%** | **0 / 230,400 px** (bit-identical) |
| **`minesweeper`** | Idle (10 ticks) | 0 | **0** / **0** | kept 0 | — |
| **`skyfire`** | Active (60s smoke max) | 70 | **70** / **70** (`<=240`) | unchanged gameplay | bit-identical |
| **`skyfire`** | Over (10 ticks) | 43 @ 33ms | **0** @ 100ms (`SF_IDLE_DT`) | **-100%** idle draws, 3x slower poll | bit-identical |

---

## Task C: `esp32sim` Deterministic Instruction-Count A/B

Using the restored firmware trio from `/home/ubuntu/lume/website/wasm/fw/` (`bootloader.bin`, `partition-table.bin`, `lume.bin`) + `esp32s3_rev0_rom.elf` + `esp32sim`, **identical firmware image** for BEFORE and AFTER, fixed `EMU_SECONDS=8` (`1,920,000,000` cycles). Every run reloaded cleanly (`RELOAD_ERR=0`, `eval_ok=2`, `tft.png` written).

Raw logs: [`artifacts/r212/emu/`](../artifacts/r212/emu/), [`artifacts/r212/emu-ab-summary.txt`](../artifacts/r212/emu-ab-summary.txt), [`artifacts/r212/emu-png-diff.txt`](../artifacts/r212/emu-png-diff.txt).

| App | Stage | core0 insns | core1 insns | Total insns | Delta (core0 / core1 / total) | Eval Time | TFT PNG Diff (230,400 px) |
|---|---|---:|---:|---:|---|---:|---|
| `counter` (smoke) | baseline | 154,053,792 | 59,024,748 | 213,078,540 | smoke baseline (`RELOAD_ERR=0`) | 29 ms | — |
| **`invaders`** | BEFORE | 384,470,269 | 1,046,272,408 | 1,430,742,677 | — | 130 ms | — |
| **`invaders`** | AFTER | **252,751,425** | **307,067,818** | **559,819,243** | **core0 -34.3% / core1 -70.7% / total -60.9%** | 74 ms | 11,794 px (animated frame phase) |
| **`frogger`** | BEFORE | 345,465,831 | 480,583,548 | 826,049,379 | — | 107 ms | — |
| **`frogger`** | AFTER | **278,296,585** | **129,236,924** | **407,533,509** | **core0 -19.4% / core1 -73.1% / total -50.7%** | 96 ms | 11,391 px (animated scroll phase + clean margins) |
| **`sokoban`** | BEFORE | 170,385,163 | 130,769,665 | 301,154,828 | — | 326 ms | — |
| **`sokoban`** | AFTER | **155,833,939** | **71,402,313** | **227,236,252** | **core0 -8.5% / core1 -45.4% / total -24.5%** | 77 ms | **0 / 230,400 px (BIT-IDENTICAL)** |
| **`minesweeper`** | BEFORE | 151,712,946 | 78,507,478 | 230,220,424 | — | 109 ms | — |
| **`minesweeper`** | AFTER | **146,646,988** | **74,763,014** | **221,410,002** | **core0 -3.3% / core1 -4.8% / total -3.8%** | 93 ms | **0 / 230,400 px (BIT-IDENTICAL)** |

Raw stop lines (`artifacts/r212/emu-ab-summary.txt`):
```text
counter-smoke:      core0 154053792 + core1  59024748 insns in  7.2s wall; RELOAD_ERR=0 | eval_ok=2
invaders-before:    core0 384470269 + core1 1046272408 insns in 41.6s wall; RELOAD_ERR=0 | eval_ok=2
invaders-after:     core0 252751425 + core1  307067818 insns in 15.6s wall; RELOAD_ERR=0 | eval_ok=2
frogger-before:     core0 345465831 + core1  480583548 insns in 24.0s wall; RELOAD_ERR=0 | eval_ok=2
frogger-after:      core0 278296585 + core1  129236924 insns in 10.9s wall; RELOAD_ERR=0 | eval_ok=2
sokoban-before:     core0 170385163 + core1  130769665 insns in  9.3s wall; RELOAD_ERR=0 | eval_ok=2
sokoban-after:      core0 155833939 + core1   71402313 insns in  6.2s wall; RELOAD_ERR=0 | eval_ok=2
minesweeper-before: core0 151712946 + core1   78507478 insns in  6.4s wall; RELOAD_ERR=0 | eval_ok=2
minesweeper-after:  core0 146646988 + core1   74763014 insns in  6.0s wall; RELOAD_ERR=0 | eval_ok=2
```

---

## Verification Evidence (Host & Emulator Only)

Raw full output: [`artifacts/r212/verify-host.log`](../artifacts/r212/verify-host.log).

- **5 updated harnesses** (`node tests/{invaders,frogger,sokoban,minesweeper,skyfire}.js`): all PASS with new `EVIDENCE` frame-budget & idle-0-draw assertions.
- **Full JS regression** (`for t in tests/*.js; do node "$t" ...`): **`TOTAL_JS=111 FAIL_JS=0`**.
- **CLI tests** (`npm test --prefix tools/lume`): **`# tests 76 / # pass 76 / # fail 0 / # skipped 0`**.
- **Playground build** (`node tools/playground/build.mjs`): **`PASS prelude 67986 bytes; 74 apps`**.
- **Playground Playwright verify** (`NODE_PATH=/home/ubuntu/.npm/_npx/705bc6b22212b352/node_modules node tools/playground/verify.mjs`): all checks PASS including **`PASS all examples load without runtime errors`**.
- **Website API check** (`python3 scripts/check_website.py`): `API missing: none / API invented: none / API duplicates: none / API signatures not found in lume.d.ts: none`.
- **Forbidden-path diff check** (`git diff --name-only HEAD -- firmware/ runtime/ tests/lib/prelude_runner.js`): empty (zero changes; `idf.py build` not run).
- **ASCII discipline**: zero non-ASCII characters in any added/modified code or string literals.

## Deferred (Pending Board Bring-Up)

- Real-device FPS (`lume-perf` p95/p99), QSPI flush smoothness, AMOLED sprite color fidelity, touch responsiveness, and PSRAM headroom during multi-app reload cycles are **not verified on hardware** and remain deferred to board bring-up.
- Secondary non-continuous / boot-only >240 apps (`wordring`, `memory`, `settings`, `games_tetris`, `wordle`) are documented in Task A and deferred to future targeted slices if needed.
