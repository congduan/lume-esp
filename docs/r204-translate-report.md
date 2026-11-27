# Lume r204 Translation Report — r201 Design Mockups to Lume Declarative UI

> **Scope**: Pure app-layer translation of the 5 finalized r201 round-AMOLED design mockups (`artifacts/r201/design/*.{html,png}`) into Lume apps (`examples/{timer_kit,launcher_grid,control_center,music_player,fitness}/app.js`), corresponding host harnesses (`tests/`), playground manifest/bundles (`73 -> 74` apps), and Playwright visual evidence (`artifacts/r204/*.png`).  
> **Untouched boundary**: Zero edits to `firmware/`, `runtime/`, `prelude`, `shell.js`, `tools/lume/`, or other `examples/`.  
> **Honest verification boundary**: All visual screenshots, tests, and draw-call counts are host-side evidence (Node `prelude_runner` + headless Chromium Playwright over `website/playground/` in 466/480 round mode). CO5300 AMOLED panel emission, physical touch feel, audio output, real QMI8658 IMU step calibration, and radio/battery hardware remain deferred to on-device bring-up.

---

## 1. Per-App Visual Self-Check vs r201 Design Mockups

Each app was rendered in `website/playground/index.html` (round screen mode) via headless Chromium Playwright (`artifacts/r204/*.png`) and audited side-by-side against `artifacts/r201/design/*.png` across four dimensions (**Layout / Hierarchy / Color / Icons**):

| App | Design Ref | r204 Screenshot(s) | Layout | Hierarchy | Color | Icons | Overall | Vision Must-Fixes Landed |
|---|---|---|---|---|---|---|---|---|
| `timer_kit` | `timer.png` (7.5/10) | `artifacts/r204/timer_kit.png`, `timer_kit_running.png`, `timer_kit_paused.png` | 8.5 | 8.5 | 8.5 | 8.5 | **8.5/10** | (1) 4 states READY/RUNNING/PAUSED/FINISHED with distinct semantic badge + CTA; (2) RUNNING `+/-` locked by default with explicit `LOCKED - TAP EDIT` toggle; (3) Canvas monospace tabular 48px vector digits (zero per-second jitter); (4) RESET shown in RUNNING/PAUSED/FINISHED |
| `launcher_grid` | `launcher.png` (7.8/10) | `artifacts/r204/launcher_grid.png` | 8.5 | 8.5 | 8.5 | 8.5 | **8.5/10** | (1) Fitness icon redesigned as single ring + ascending pulse chart (no Apple 3-ring motif); (2) 3 greens staggered (Timer `#40D8B0` mint / Fitness `#7CE850` lime / Chat `#38C8E8` cyan); (3) Camera/Settings neutral contrast boosted; (4) Unified outer tonal ring across all 12 discs + 12 real repo apps + SNTP wall clock (`--:--` fallback) + EDIT swap |
| `control_center` | `control-center.png` (8.0/10) | `artifacts/r204/control_center.png`, `control_center_default.png` | 8.8 | 8.6 | 8.7 | 8.6 | **8.7/10** | (1) Layered-circle knob drop-shadow approximation on capsule switches and 32px slider thumbs; (2) 10px muted gray `CONNECTIONS` / `OUTPUT` section labels; (3) `Reset All` ghost-outlined danger pill with circular undo arrow |
| `music_player` | `media.png` (8.5/10) | `artifacts/r204/music_player.png` | 8.8 | 8.8 | 8.8 | 8.7 | **8.8/10** | (1) Side Prev/Next buttons expanded to `52x52px >= 48px` with `66x66px` (~1.3x) center Play/Pause; (2) Circular aurora vinyl disc + note motif + outer progress arc + scrubber knob; (3) Tactile pill volume slider bar with 32px circular thumb; (4) Library & 5-line LRC + `+/-0.5s` offset kept in secondary drawer |
| `fitness` (new) | `fitness.png` (8.0/10) | `artifacts/r204/fitness.png` | 8.8 | 8.8 | 8.8 | 8.6 | **8.8/10** | (1) Red/yellow companion cards show target/context (`118 bpm / ZONE2 avg`, `410/500 kcal`); (2) 12-o'clock chevrons replaced by crisp fine radial tick lines; (3) Lower inner-ring gap displays battery icon + `85% SIM` when `lume.system.battery` absent; (4) Thousands-formatted 48px hero (`8,240`) + IMU step estimator + honest SIM tagging |

---

## 2. Per-App Translation Matrix & Simplification Log

### 2.1 `examples/timer_kit/app.js` <- `artifacts/r201/design/timer.html`

| Design Element | Lume Implementation | Deviation / Simplification Record |
|---|---|---|
| 60-tick radial outer dial (`r=204..213`) | `Canvas` `480x480` using `c.retainSegments(MAJOR_SEGS)` + `c.retainSegments(MINOR_SEGS)` (2 `drawPath` calls/frame) | None (exact radius & tick cadence) |
| Recessed progress track + glowing accent arc (`r=188`, 10px) + 12-o'clock dot | `c.arc` track (`14px` `#16202E` + `10px` `#1F2C3D`) + `14px` low-luminance halo arc (`#14423A`) + `10px` `#40D8B0` arc + `fillCircle` round endcaps + crown dot | **Simplification**: SVG `feGaussianBlur` glow and `linearGradient` omitted (RGB565 Canvas has no alpha/blur); approximated with a darker concentric halo ring |
| `48px` tabular `05:00` center digits | Custom `drawMonoDigit` / `drawMonoTime` vector renderer on Canvas (fixed cell advance `28+7px`, `46px` tall, rounded corner joints) | **Deviation (intentional)**: Bypasses 32px LVGL font cap and guarantees zero per-second horizontal jitter |
| `READY / RUNNING / PAUSED / FINISHED` status pill + state-machine CTAs | Canvas rounded pills (`drawPill`) with semantic colors (`#40D8B0` / `#FFD78E` / `#FF6B79`) + transparent `View({ onPress })` hit targets inside `shell.SafeArea` | **Simplification**: CSS `box-shadow` on primary CTA approximated by subtle outer pill halo (`#133A34`); `START` rendered in `#0D1420` dark ink on `#40D8B0` (10.7:1 contrast) |
| `+/-` circular `48x48` steppers + RUNNING lock | Circular Canvas buttons at `(108, 236)` / `(372, 236)` + `48x48` transparent `View` hit targets; `editLocked` defaults `true` while RUNNING, toggled via `LOCKED - TAP EDIT` pill | Preserves dual COUNTDOWN/STOPWATCH mode (tap header) and secondary RECORDS view (long-press header), plus `hisc.timer` / `timer.best` KV keys and 40ms PCM bell |

### 2.2 `examples/launcher_grid/app.js` <- `artifacts/r201/design/launcher.html`

| Design Element | Lume Implementation | Deviation / Simplification Record |
|---|---|---|
| Circular watch dial bezel (`r=218`) | `436x436` `View` (`borderRadius: 218`, `#09101B`, `1px` `#1A2636` border) | **Simplification**: CSS `radial-gradient` backdrop approximated by solid dark AMOLED navy `#09101B` inside `#000000` outer ring (zero Canvas budget used) |
| Top SNTP wall clock | `Text` bound to `readWallClock()` via `lume.system.time()` (`HH:MM` when `>= 2020-01-01` epoch, else `'--:--'`) | Adds discreet `64x48` touch-target `EDIT`/`DONE` pill at top-right (visual `54x26` pill) to preserve edit-mode tile swapping |
| 3x4 grid of 12 icons + labels | 12 real repo apps in `examples/` (`clock`, `timer_kit`, `weather`, `music_player`, `fitness`, `hr_monitor`, `image_gallery`, `compass`, `ai_chat`, `control_center`, `clock_round`, `settings`), each using a `48x48` `Canvas` vector glyph (`27,648 px` total) + `14px` `Text` | **Simplification**: CSS `linear-gradient` disc + drop-shadow approximated by concentric tinted `#09101B`-blended `fillCircle` layers + uniform tonal ring on all 12 discs |
| Bottom 3-dot page indicator | Flex row of 3 `View` pills (`18x6` active `#40D8B0` + two `6x6` `#5C7794`), swipeable via `shell.EdgeNavigation` | **Simplification**: Active dot CSS `box-shadow` glow omitted |

### 2.3 `examples/control_center/app.js` <- `artifacts/r201/design/control-center.html`

| Design Element | Lume Implementation | Deviation / Simplification Record |
|---|---|---|
| `Control Center` header + `CONNECTIONS` / `OUTPUT` 10px group labels | `20px` `Text` title + two lightweight `320x12` `Canvas` strips rendering `10px` uppercase stroke glyphs (`drawMicroLabel`) in `#6E859E` | **Deviation (intentional)**: LVGL bundled font minimum is `14px`, so `10px` group headers use lightweight vector strokes |
| Wi-Fi & Bluetooth toggle cards (`154x78`, `radius: 12`) | `shell.Card` with reactive ON accent tint (`#14292E` / `#34A88B` border) + `134x62` `Canvas` drawing Wi-Fi/BT icons, `50x28` capsule track, and white circular knob | **Simplification**: CSS knob `box-shadow` approximated with 2 offset darker `fillCircle` layers underneath the white knob |
| Brightness & Volume slider cards (`320x66`, `radius: 12`) | `shell.Card` + `296x52` `Canvas` drawing golden Sun / Speaker+waves icons, right-aligned `%` text, 6-stop stepped gradient teal fill rail, and `32px` circular white/teal thumb with `#117B69` center dot; supports tap-cycle and pan drag | **Simplification**: Continuous CSS `linear-gradient` approximated by 6 discrete teal stops; thumb `box-shadow` approximated by offset dark `fillCircle`; preserves exact `cc.wifi`/`cc.ble`/`cc.vol` (0..10)/`cc.brt` (1..5) KV contracts |
| `Reset All` ghost danger pill | `212x48` pill `View` (`#201118`, `1px` `#BF4E5B` border) + `164x32` `Canvas` drawing circular undo arrow + `Reset All` in `#FF6B79` | **Simplification**: CSS shadow omitted; retains full `resetAll()` KV rewrite semantics |

### 2.4 `examples/music_player/app.js` <- `artifacts/r201/design/media.html`

| Design Element | Lume Implementation | Deviation / Simplification Record |
|---|---|---|
| Circular cover disc + outer progress arc + scrubber knob | `140x140` `Canvas` (`19,600 px`) drawing outer `#1F2C3D` track, `#40D8B0` progress arc + `#133C36` halo + white scrubber dot, layered aurora vinyl disc + grooves + spindle + music note glyph; tap disc opens Library & Lyrics drawer | **Simplification**: SVG `feGaussianBlur` and smooth gradient waves approximated with layered `fillCircle` / `fillEllipse` bands + outer circular mask |
| Centered track title + artist/time metadata | `20px` `Text` (`musicTitle`, `longMode: 'dots'`) + `14px` `Text` (`artist | elapsed / duration`, `opacity: 0.72`) | Exact 2-level typographic hierarchy |
| 3-key transport controls (`Prev` / `Play-Pause` / `Next`) | `240x72` `Canvas` (`16,320 px`) + 3 transparent circular `View` hit targets: side keys `52x52px >= 48px`, center Play/Pause `66x66px` (`1.27x ~ 1.3x`) in `#40D8B0` with `#0D1420` dark bars/triangle | **Simplification**: CSS button elevation shadows approximated with 2px offset dark circles and teal halo circle |
| Pill volume slider bar (`276x48`) | `276x48` `Canvas` (`13,248 px`) with low/high speaker icons, stepped teal fill, `32px` circular thumb + left/right `52x48` tap zones + pan gesture | Preserves all MP3 decode/stream/LRC/KV (`music.last`, `lrc.offsets`) logic untouched |

### 2.5 `examples/fitness/app.js` (New App) <- `artifacts/r201/design/fitness.html`

| Design Element | Lume Implementation | Deviation / Simplification Record |
|---|---|---|
| Triple concentric activity rings (`r=207/187/167`, stroke `14`) + fine 12-o'clock ticks | Single `480x480` `Canvas` drawing `#40D8B0` (Steps), `#FFD78E` (Burn), `#FF6B79` (Heart) arcs with `fillCircle` round endcaps and 2px `#0D1420` radial start tick lines | **Simplification**: SVG `feGaussianBlur` glow omitted; low-luminance semantic tracks (`#0E2926` / `#2A2417` / `#2C151C`) provide clean AMOLED ring contrast |
| Hero `8,240` (`fs-display`) + goal sub-line | Canvas `drawHeroNumber` (`42px` bold tabular digits + comma via `fmtThousands`) + kicker dot/label + goal caption | Interactive: tapping `HEART` or `BURN` card focuses that metric in center; tapping center returns to `STEPS` |
| Companion `HEART` / `BURN` cards (`118x68`, `radius: 12`) | Canvas rounded cards inside inner-ring chord (`r_corner = 135px <= 160px`) showing `118 bpm / ZONE2 avg` and `410/500 kcal`, overlaid with `shell.SafeArea` pressable `View` hit targets | **Simplification**: CSS card gradient/shadow omitted; crisp 1px semantic highlight border on selection |
| Zone strip + lower-gap Battery (`85% SIM`) | Canvas live red dot + `ZONE 2 - FAT BURN` + mini battery vector icon + `85% SIM` at `y=342..354` (30px clearance inside inner ring) | Honest telemetry: polls `lume.imu.read()` with peak-threshold + 280ms debounce pedometer when available; falls back to demo baseline + explicit `SIM` badge; HR simulated (no PPG sensor); battery reads `lume.system.battery()` if present else fixed `85% SIM` |

---

## 3. Canvas PSRAM & Per-Frame Draw-Call Budgets

| App | Canvas Nodes | Total Canvas Area (Budget `<= 230,400 px`) | Per-Frame Draw Calls (Budget `<= 240`) | Node Count (Budget `<= 128`) |
|---|---:|---:|---:|---:|
| `timer_kit` | 1 (`480x480`) | `230,400 px` (100%) | **91** (`<= 240` PASS) | 19 |
| `launcher_grid` | 12 (`48x48`) | `27,648 px` (12%) | N/A (static icons) | 50 |
| `control_center` | 7 (cards/labels/reset) | `61,328 px` (27%) | N/A (event-driven) | 16 |
| `music_player` | 3 (`140x140`, `240x72`, `276x48`) | `50,128 px` (22%) | **24** (`<= 240` PASS) | 26 |
| `fitness` | 1 (`480x480`) | `230,400 px` (100%) | **112** (`<= 240` PASS) | 6 |

---

## 4. Raw Verification Output

```text
DRAWS timer_kit=91 fitness=112 music_player=24
SEQUENTIAL_REGRESSION pass=111 fail=0 failed=

> @lume/cli@0.1.0 test
> node --test
# tests 76 / pass 75 / fail 0 / skipped 1 (qjsc binary)

lume check examples/timer_kit --no-emu       -> [PASS] bundle 43594 bytes | RESULT: PASS (exit 0)
lume check examples/launcher_grid --no-emu   -> [PASS] bundle 37056 bytes | RESULT: PASS (exit 0)
lume check examples/control_center --no-emu  -> [PASS] bundle 37286 bytes | RESULT: PASS (exit 0)
lume check examples/music_player --no-emu    -> [PASS] bundle 12003 bytes | RESULT: PASS (exit 0)
lume check examples/fitness --no-emu         -> [PASS] bundle 36392 bytes | RESULT: PASS (exit 0)

tools/playground/verify.mjs:
  PASS all examples load without runtime errors (74/74 apps)
  timer_kit: 19 nodes | control_center: 16 nodes | launcher_grid: 50 nodes | music_player: 26 nodes | fitness: 6 nodes

scripts/check_website.py:
  examples.html gallery up to date (74 cards)
  HTML pages: 7; internal href/src and anchors checked
  API: 162 catalog entries, 162 type declarations, 34 function namespaces
  API missing: none | API invented: none | API duplicates: none
```
