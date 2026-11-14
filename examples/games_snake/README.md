# Snake: swipe or tilt

Swipe to turn or tilt the board. The QMI8658 is polled every 50 ms; `IMU_THRESHOLD`, `IMU_X_SIGN`, and `IMU_Y_SIGN` at the top of `app.js` are **physical board tuning points**. The default threshold is 2.4 m/s². Opposite direction turns are ignored. Tap after a collision to restart.

The 24×24 grid fits a 384×384 Canvas. The previous Canvas pixels persist, so each tick repaints only the new head and vacated tail (and food after eating); initial draw paints the background once. Food increases score and speeds the fixed tick from 180 ms toward 80 ms. The best score is `hiscore.snake`. Short PCM beeps mark food and game over.

Run `node tests/games.js` and `node tools/simulator/sim.js examples/games_snake/app.js`. Screen axis signs, tilt threshold, redraw latency, and audio need board acceptance.
