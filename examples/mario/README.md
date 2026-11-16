# Mario style single-screen platform demo

Run `node tools/lume/lume.js check examples/mario` or deploy `app.js` with the Lume CLI. The app is one standalone global script and creates six UI nodes: a root, one HUD Text, one Canvas, and three Buttons. All level objects and sprites are painted inside the Canvas.

## Controls and objective

- Tap **LEFT** or **RIGHT** to accelerate in that direction for a short burst. Hold for a longer burst.
- Tap **JUMP** for a short jump. Hold for a higher jump. A slight drag inside JUMP starts a held jump immediately; releasing that drag while ascending cuts its height.
- Collect coins, hit brown bricks from below, jump across the gap, and stomp the patrolling enemy from above. Reach the red flag to advance to the next level. Levels reuse the single-screen layout. Falling into the gap or touching the enemy costs a life.

Only one touch is available, so movement has brief momentum after releasing its button. This lets a jump cross the gap. The HUD shows score, coins, lives, and level in one label.

## Rendering and measured cost

The 8x10 player has two walking poses, a jumping pose, and horizontal flipping. Its colored row spans are decoded once from compact strings and drawn with `fillRect`. The level is repainted only under the old and new entity rectangles, plus a small area for a collected coin or broken brick. Teleporting after a fall paints the old and new rectangles separately. The first frame paints the whole canvas once.

In a stationary 10-second esp32sim run, the app logged `MARIO PERF js_avg_ms=15.00 js_max_ms=15 dirty_max_px=920` for each 25-frame sample. The 40 ms timer requests 25 fps; those samples arrived about every 1.38 emulated seconds, roughly 18 rendered fps in this emulator. The final run stopped at `core0 164201052 + core1 542723210 insns` over 10 emulated seconds. The steady dirty maximum of 920 pixels is below the 5,000-pixel budget and below gravity_ball's documented 2,500–3,080 pixels per frame. JS milliseconds are measured around each `tick()` including the signal-triggered draw; they are coarse `Date.now()` readings. Insns include the firmware and both cores, so they are not a per-frame JS instruction count.

`run.sh` normally writes `artifacts/emu/mario/tft.png` and `serial.log`; this round's captures were preserved under `/tmp/lume-r51-artifacts/mario/` to keep the repository working tree clean. A separate touch script in `/tmp/lume-r51-artifacts/mario_smoke/actions.txt` produced `MARIO BRICK score=25`, `MARIO COIN score=35`, `MARIO STOMP score=85`, and `MARIO LEVEL 2 score=185` in its serial log. Its largest reported dynamic dirty area was 2,752 pixels. esp32sim confirms rendering and touch injection, not physical display orientation, touch feel, or frame rate on the board. Those remain **pending board**.

## Browser simulator verification

`tools/simulator/verify_mario.js` is a Playwright end-to-end check of this app
in the browser host simulator (`sim.js`, port 8799). It runs without a board:

```bash
# PLAYWRIGHT_MODULE points at an installed Playwright (locate it with e.g.
#   find /home/ubuntu -maxdepth 6 -name 'playwright*' -type d 2>/dev/null | head
PLAYWRIGHT_MODULE=<path-to-playwright> node tools/simulator/verify_mario.js
```

It asserts the initial HUD `S 0  C 0  L 3  LV 1`, the six UI nodes (root, HUD
Text, Canvas, LEFT/RIGHT/JUMP Buttons) and that Canvas pixels are painted into
`#device`. It then drives the three Buttons: a RIGHT + JUMP click breaks the
brown brick (`BRICK score=25`), and a partial RIGHT + HIGH jump (a `longpress`
gesture injected on JUMP) + LEFT air-control collects a coin (`COIN score=35`,
`C 1`). Score assertions read the HUD Text node's text rather than diffing
canvas pixels; the final `#device` screenshot (HUD + Canvas) is written to
`artifacts/simulator/mario.png`.

Division of labor with the esp32sim evidence above: the headless chip-simulator
`actions.txt` leg is deterministic, timed touch injection and additionally
reached `STOMP score=85` / `LEVEL 2 score=185`. This browser leg reproduces the
`25` / `35` brick+coin scores (values observed, not forced) but stops there;
`sim.js` pumps `__lume_tick()` on a real 50 ms wall-clock timer, so its physics
is not cycle-deterministic. Neither leg is on-device acceptance, and the
browser check is a manual, non-CI step (see `docs/KNOWN-SIMPLIFICATIONS.md`,
r50/r55).

## Limits

This is one fixed 480x480 screen with a 480x352 play canvas; it has no horizontal scrolling. Sprites are `fillRect` pixels because the Canvas API has no image blit. A firmware `drawImage` blit could later support image sprites and a scrolling world. Level variety, sound, and on-device acceptance remain future work.
