# r182 Luna — host implementation report

## Scope and source

Luna is a JS app (`examples/luna/`) with no firmware, prelude, or runtime changes. The delivered 256×128 RGB565 image is downsampled from NASA SVS's [CGI Moon Kit LROC WAC 2K color map](https://svs.gsfc.nasa.gov/4720/). The NASA endpoint was unreachable from this workspace; the [physics-lab mirror](https://github.com/MaxwellLee/physics-lab/blob/main/assets/textures/SOURCES.md) documents its `moon_2048.jpg` as a recompressed copy of that NASA file. Downloaded mirror SHA-256: `ec98386c3b39ad2dab5970db5b5aecb8946db3f450aee4d78ce7382e0060bf87`. The original NASA asset was not byte-comparable here, so provenance relies on the mirror's documentation. NASA SVS credits Ernie Wright, Noah Petro, and the LRO/LROC teams.

`node tools/luna-mktex/generate.js <src.jpg>` invokes ImageMagick `convert` to resize and decode a JPEG, packs RGB565 little endian, and embeds 65,536 bytes as base64. If the file or decoder fails, or `--builtin` is passed, a pure Node fallback draws approximate maria centered at Oceanus Procellarum, Imbrium, Tranquillitatis, and Crisium. That fallback is visibly marked as approximate in the generated header and is not represented as LRO data. Final `moon_tex.js` is **87,519 bytes**, below the 100KB cap; minified app bundle is **92,417 bytes**, below 256KB.

Raw generation output (`artifacts/r182/texture-builtin.log`, `texture-nasa.log`):

```text
BUILTIN /tmp/lume-r182-wt/examples/luna/moon_tex.js 87537 bytes; RGB565 13ad53ad33add2a413ad74b5f2a4b19c
NASA /tmp/lume-r182-wt/examples/luna/moon_tex.js 87519 bytes; RGB565 badebadebadebadebadebadedadedade
```

## Astronomy

`moonPhase(jd)` uses simplified Meeus style mean lunar and solar ecliptic longitudes and the dominant periodic lunar terms (6.289° anomaly, 1.274° evection, 0.658° variation, smaller anomaly/latitude terms). Their wrapped longitude difference divided by 360 gives phase; zero is new and 0.5 is full. Moon age is phase × 29.530588853 days, with the 2000-01-06 18:14 UTC / JD 2451550.26 new-moon epoch serving as the stated reference for the synodic interval. Eight phase labels have 45° sectors. Distance is a 27.55455-day cosine over 356,500–406,700 km, anchored to the 2024-04-07 perigee window. These are educational approximations, not ephemerides; harness tolerance is ±0.02 phase or roughly one day. The distance curve has no perturbations beyond this anomalistic cycle.

`lume.system.time()` supplies Unix milliseconds. A value before 2020 is treated as unset and the view says `CLOCK NOT SET`, using a fixed 0.38 example phase. When WiFi is connected, the app attempts `setTimeNtp()` and polls the wall clock at 60-second intervals. A valid clock shows `LIVE`; the minute poll causes no Canvas redraw unless phase or validity changes. The solar vector gives the familiar waxing-right, waning-left orientation with north up. Observer-dependent sky rotation, libration, and local rise/set geometry are not available from the current app API and are not claimed.

## Rendering and interaction

One 480×480 Canvas contains a 320×320 centred moon and 40 fixed star positions. The image is built in 2×2 pixel blocks, one pair of rows at a time:

```text
for each two-row strip and horizontal 2-pixel block inside the sphere:
    inverse-project screen x/y to sphere x/y/z
    rotate sphere normal by pitch (clamped to ±30°)
    derive longitude/latitude; wrap longitude to the equirectangular texture
    bilinearly sample four RGB565 texels
    shade from solar-normal dot product across a ±0.28 cosine twilight band
    reduce brightness toward the limb
    write four RGB565 output pixels
retainImage(320×320 buffer); drawImage once
```

The texture is sampled into a JS buffer, so the Canvas submission costs two image calls instead of one draw call per pixel. The frame call ledger is: background 2, 40 stars at most, backdrop 1, image define/draw 2, HUD 2, information card at most 8 = **≤55 Canvas calls**, under the 220 cap. The 320×320 frame occupies 204,800 bytes; source texture 65,536 bytes. The browser screenshot demonstrates textured maria, curved limb falloff, and a smooth terminator. True device frame time and memory headroom are unmeasured.

Pan converts horizontal displacement into longitude and vertical displacement into pitch. The native gesture `dx/dy` values are cumulative, so adjacent events are differenced. A 50ms timer exists only during inertia; speed decays by 0.72 per tick and stops below 0.1. The brief's `v*=0.95` and “10 to <0.1 in 20 frames” cannot both hold mathematically (`10×0.95^20≈3.58`); the implementation chooses the 20-frame stopping requirement. Tap toggles the card; a second tap within 350ms resets the default view.

## Host evidence and limits

- `node tests/luna.js`: 14 checks including negative mutation controls for each, recorded in `artifacts/r182/luna.log`. The harness covers three known phase dates, eight phase labels, distance, texture seam, latitude mapping, inertia, call cap, idle draw discipline, unset clock, pan, and double tap.
- `node tools/lume/lume.js check examples/luna --no-emu`: `RESULT: PASS (4 steps, 0 failed; exit 0)` in `artifacts/r182/lume-check.log`; emulator eval/layout/perf were skipped by `--no-emu`.
- `node tools/playground/build.mjs`: `PASS esbuild-wasm assets and 70 editable sources`; the current worktree manifest had 69 before Luna, so the brief's 68-app count is stale. See `artifacts/r182/playground-build.log`.
- `PLAYWRIGHT_MODULE=/tmp/lume-playwright/node_modules/playwright node tools/playground/verify.mjs`: all examples loaded without runtime errors; `artifacts/r182/playground-verify.log`.
- `npm test --prefix tools/lume`: 51 passed, 0 failed, 1 skipped; `artifacts/r182/cli-tests.log`.
- `python3 scripts/check_website.py`: 7 HTML pages and 161 API entries checked; `artifacts/r182/website.log`.
- All 110 `tests/*.js` host harnesses passed (`TOTAL_FAIL=0`); raw results are in `artifacts/r182/host-regression.log`.

Screenshots: [live default view](../artifacts/r182/luna-default.png), [rotated hemisphere](../artifacts/r182/luna-rotating.png), [information card](../artifacts/r182/luna-card.png), and [controlled first-quarter visual check](../artifacts/r182/luna-quarter-preview.png). The controlled preview alters only a temporary `/tmp` copy of `app.js` to set phase 0.25 after clock read; it is not the delivered live default. Host screenshots are visual evidence only. On-device display, touch feel, 20fps inertia, PSRAM/heap headroom, SNTP connection, and current draw remain deferred.
