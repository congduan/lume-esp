# r87 electronic fish tank

## Design

`examples/fishtank/app.js` is a plain global JS app with one 480 x 480 Canvas. Six fish use three body sizes and color palettes. Each fish owns a wander target, heading, speed, tail phase, and short post-feeding burst. Every 33 ms step blends its current speed toward a target speed, limits heading change to 0.075 rad, adds a soft edge force before the hard center bounds, and adds a pairwise separation force inside 38 px. Food pellets sink after a tap. Nearby fish steer toward the closest pellet; eating removes it and raises speed for 42 ticks. Tail phase advances by `0.12 + speed * 0.19`, so a faster fish visibly beats its tail faster.

The firmware Canvas API has no `ellipse`, filled polygon, gradient, or alpha operation. Each oval body therefore uses five variable-width line strokes, with a separate swinging triangular tail, fins, highlight, and eye. Broad color bands make the water gradient; short low-contrast strokes suggest moving light patches. Sand, five swaying plants, and ten rising bubbles complete the scene. Everything is drawn through Canvas; there are no image assets.

## Draw budget

The fixed frame has 15 fillRect calls (12 water bands, 3 sand bands), 3 light strokes, 15 plant strokes, 10 bubble circles, and 72 fish strokes/circles: **115 calls**. Food adds at most 20 circles, for a **135-call maximum** under the 200-call limit. The prelude batches line messages, so the harness expands each batch into its individual strokes when counting. The canvas still redraws all 480 x 480 pixels every frame; 30 fps is a target, not a measured board result.

## Verification

Raw command output is in `artifacts/r87/`.

- `node tests/fishtank.js`: PASS. The 60-second, 1,800-tick smoke checked finite positions, center bounds, <2.5 px single-frame movement, and the 0.075 rad turn cap. Feeding pursuit, pellet consumption, burst speed, tail phase, prelude execution, touch dispatch, and per-frame draw count passed. Peak observed count: 115.
- `npm test --prefix tools/lume`: 43 passed, 1 skipped, 0 failed. See `cli-tests.log`.
- `node tools/lume/lume.js check examples/fishtank`: bundle PASS (4,513 bytes); emu timed out after 120 s during ESP-IDF environment activation, before JS evaluation. The command returned failure. See `lume-check.log`.
- `node tools/lume/lume.js check examples/fishtank --no-emu`: PASS; bundle 4,516 bytes after the final visual edit. Eval and layout were skipped by `--no-emu`. There are no layout expectations for `fishtank`, so R1-R7 layout acceptance is not available for this app. See `lume-check-no-emu.log`.
- `node tools/simulator/sim.js examples/fishtank/app.js`: started and loaded with 51 initial messages, with no JS error. Browser rendering captured three screenshots at about 0, 2, and 5 seconds; the browser reported zero page errors. See `simulator.log`, `screenshots.log`, and `fishtank-{0,2,5}.png`. The screenshots differ by 15,588 and 15,787 pixels in consecutive pairs, confirming visible motion.

## Board acceptance and tuning

On-device acceptance remains pending. Check actual 30 fps throughput, canvas queue pressure, display color and contrast on AMOLED, touch coordinates and feeding feel, fish speed and turn radius, tail beat frequency, and readability of the small fish and low-contrast light patches. Adjust `targetSpeed`, turn cap, body colors, and tail phase gain after observing the board.
