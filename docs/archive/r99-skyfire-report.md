# r99 Skyfire host report

## Implementation

`examples/skyfire/app.js` is an original 480x480 portrait shooter. The pure rules end at `/* GAME UI */`; the lower section binds the firmware prelude, gestures, Canvas, HUD and programmatically generated stereo PCM. All three sound buffers last at most 48 ms at 16 kHz. A pan starts firing and moving the craft; pan end stops firing. The player center stays within x=18..462 and y=165..455.

## Projectile and particle pools

Each pool allocates its objects once: eight enemies, 32 friendly shots, 32 hostile shots, 40 particles. `sfTake` reuses the first inactive slot. A shot or particle is deactivated on collision, expiry, or leaving the screen; capacity prevents further emission. Explosions have a separate four-entry ring list and last four frames. This bounds live objects and avoids per-shot allocations. The 60-second host smoke asserts each pool's active count and every live coordinate on each tick.

## Difficulty curve

| Parameter | Wave 1 | Rule | Cap |
|---|---:|---|---:|
| Wave interval | 220 ticks (7.26 s) | minus 11 ticks per wave | 90 ticks (2.97 s) |
| Base dive speed | 1.75 px/tick | plus 0.19 px/tick per wave | 5.1 px/tick |
| Ordinary wave size | 3 | grows by one every two waves | 7 |
| Elite | wave 5 | every fifth wave, one elite | 1 |
| Patrol aimed shot interval | 76 ticks | fixed | 76 |
| Elite three-shot fan interval | 32 ticks | fixed | 32 |
| Player shot interval | 7 ticks while dragging | fixed | 7 |

Kills score 50/120/300 for scout/patrol/elite multiplied by the wave number. The elite always drops a pickup. Pickups rotate double shot, triple shot, shield, then double shot. A hit starts 30 ticks (990 ms) of invulnerability; a shield absorbs one hit.

## Draw budget

Full redraw upper bound: background 1 + parallax stars 42 + eight aircraft at four primitives 32 + both shot pools 64 + particles 40 + four explosion rings at two circles 8 + pickup 2 + player and shield 6 = **195 calls/frame**, below 250. The prelude harness observed **70 calls/frame maximum** during its 60-second scripted smoke. The host result is a call-count bound, not an ESP32-S3 frame-time measurement.

## Verification

- `node tests/skyfire.js`: collision, wave gate, upgrade loop, invulnerability, player/enemy bounds, real-prelude draw budget and 60-second smoke passed. Raw output: `artifacts/r99/skyfire-test.txt`.
- `node tools/lume/lume.js check examples/skyfire --no-emu`: bundle passed (7161 bytes), emulator/layout/perf skipped by `--no-emu`. Raw output: `artifacts/r99/lume-check.txt`.
- `node tools/playground/build.mjs`: 38 apps and editable sources. Raw output: `artifacts/r99/playground-build.txt`.
- Three browser playground screenshots: `artifacts/r99/01-opening.png`, `02-mid-barrage.png`, `03-elite.png`. The latter two use scripted state setup in the source editor to capture deterministic combat scenes.
- Full host harness output: `artifacts/r99/all-tests.txt`.

The existing playground browser verifier reports 40 picker entries against 38 regenerated source entries because `clock_round` and `dashboard_round` were already listed and bundled on the page but absent from `build.mjs` before r99. Its raw output is `artifacts/r99/playground-verify.txt`; the r99 app itself loaded and captured successfully.

## Board acceptance still pending

Measure touch follow latency and whether the 33 ms tick and 30-tick immunity feel right on the Waveshare panel. Tune enemy shot speed and fan spread against real display visibility and touch occlusion. Verify PCM level, canvas frame time, touch orientation, and power behavior on hardware. No board run was performed here.
