# 2048

Swipe the 4×4 board in any direction. Equal tiles merge once per move; a new 2 (90%) or 4 (10%) appears after a successful move. Tap after game over to restart.

The board uses static Views and reactive Text; no Canvas buffer is allocated. Merge tiles get a short width transition. `hiscore.2048` persists the best score. Tile colors follow the familiar 2048 palette. The grid is 304×304 px inside the round display's safe area. A 30 ms PCM beep marks a move or merge.

Run `node tests/games.js` for logic and `node tools/simulator/sim.js examples/games_2048/app.js` for a preview. Touch feel and transition timing need board acceptance.
