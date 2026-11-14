# Breakout

Drag or tap to place the paddle. Clear 6×6 bricks to advance to a faster level. Three missed balls end the run; tap to restart. Score is saved as `hiscore.brkout` (NVS keys are limited to 15 characters).

Bricks are Views above a 384×350 Canvas. Removing a brick hides its View; the Canvas repaints only old and new ball/paddle rectangles. AABB checks handle paddle and brick contact. The 40 ms timer targets 25 ticks/s; collision physics are deliberately simple. Beeps last 12–40 ms.

Run `node tests/games.js` and `node tools/simulator/sim.js examples/games_breakout/app.js`. Touch tracking, layered rendering and frame pacing need board acceptance.
