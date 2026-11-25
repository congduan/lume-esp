# r64 — Modular watch face (5th face, zero canvas)

**Status: code complete, esp32sim + host verified. Not hardware-verified.**

## What landed

The watchface example gained a fifth swipeable face, "Modular": a large time
`Text`, a date line, and a 2×2 complication card grid (WEATHER / BATTERY /
CALENDAR / STEPS), all native `View`/`Text` widgets styled through
`lume.theme` (`radius` 16, `spacing` 12). Swipe order is now
digital → analog → activity rings → goals → modular → wraps.

Commits on `r64-modular` (not pushed): implementation + test, then docs.

## The r64a stop and the r64b decision

The first r64 attempt stopped with a real resource conflict, recorded in the
reverted commit `713fa40`: the four existing faces already reserve
**228,544 of the 230,400 px** shared canvas budget (digital 12² + analog
300² + rings 300² + goals 220²), so a fifth face with a clock-background
canvas cannot fit — the host harness raised `lume: canvas PSRAM budget
exceeded` before any device run. The r64b direction (master decision): build
the whole face from retained native widgets, zero canvas, and add a host
assertion pinning total canvas budget so any future face must pass the same
gate:

```
PASS watchface canvas budget 228544/230400 px; modular uses zero canvas
```

Takeaway for future watch-face authors: **canvas is a shared, nearly
exhausted budget in this app; declarative View/Text components are the
default, canvas is reserved for faces that must paint pixels.**

## Data sources and honest simplifications

- **Steps**: `lume.imu.read()` acceleration magnitude with debounce, sharing
  the goals face's estimator (`modularSteps` mirrors `goalSteps`). The IMU
  estimate is a motion proxy, not a real pedometer.
- **Battery**: `faceBatt` demo value (78%) as on the other faces; live PMIC
  sampling is not wired in this example.
- **Weather**: `lume.net.httpRequest` to `wttr.in/?format=j1`, polled on app
  start and every 10 minutes; any failure (error code, non-200, truncated
  body, malformed JSON) degrades to `--°` with a `lume.log` line. Text-only
  by design: the firmware font has no weather-symbol glyphs (U+00B7 and
  umbrella/cloud/sun render as tofu boxes — verified in a first emu
  capture), so the value text carries no icon characters. wttr.in picks the
  location from the request source; the example hard-codes no city.
- **Calendar/time**: device `Date` clock.

## Verification (raw outputs)

All evidence is host/esp32sim; no hardware claim.

- `node tools/lume/lume.js check examples/watchface` → exit 0:
  `RESULT: PASS (4 steps, 0 failed)` (bundle 8526 bytes, eval 2× "app eval ok").
- `node tests/watchface.js`: five-page swipe cycle, canvas budget assertion,
  weather updates only its own complication Text node, WiFi-down fallback
  `--°`, plus all pre-existing face assertions.
- Full `for t in tests/*.js` loop: no failures. `npm test --prefix tools/lume`:
  `# tests 44 / # pass 43 / # fail 0 / # skipped 1`.
- Emu face-5 frame (firmware unchanged, `EMU_SKIP_BUILD=1` with the main
  repo's 15:18 build triplet): `runtime up; eval app '<embedded-demo>'
  (8526 bytes)` → `app eval ok`. TFT capture shows the modular face:
  `LUME / MODULAR`, large clock, date, and the 2×2 grid with `--°` /
  `78% DEMO` / `周四 1月1日` / `1 步 IMU EST.` — no tofu glyphs.
- Emu swipe smoke: 4 scripted left swipes (touch down/move/up at t≈4.0–6.3 s)
  over the real touch pipeline ended on the modular face (TFT verified).

## Known limits

- Physical display, touch feel, weather over real WiFi, and PMIC battery
  remain pending board acceptance.
- The canvas budget is app-global; watchface now sits at 99.2% of it.
  Any pixel-painting future face requires budget reallocation, not addition.
