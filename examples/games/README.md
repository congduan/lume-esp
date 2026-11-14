# Games helpers

`shared.js` is the reference copy of four small helpers: fixed timer, `hiscore.<game>` storage, short stereo PCM beep, and AABB intersection. Each game keeps these lines inside its own `app.js`, so `lume deploy examples/games_<name>` and the simulator can use one self-contained source file. When changing a helper, update all three copies.
