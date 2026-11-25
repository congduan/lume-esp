# r97 · Radial spectrum music box

## Scope and mode choice

`examples/spectrum_music/app.js` starts `recordStream({chunkSamples: 1024, onChunk})`. The callback copies only the left 16-bit PCM channel into a 4096-sample ring and sets a dirty signal. The 30 ms timer removes DC, applies a Hann window, calls `lume.fft.realfft` and `lume.fft.magnitude`, then maps bins 2–511 logarithmically onto 40 radial lines. Three gain levels and three color themes are available through on-screen buttons.

When `recordStream` returns a negative code or reports a stream error, DEMO generates a repeating four-chord, 16 kHz stereo PCM sequence. The same samples feed the playback queue and the FFT ring. This avoids requiring a TF card and a bundled MP3. The program continues showing the visualizer if `playStream` is unavailable or its queue is full; audio output then depends on the board's stream support.

## FFT benchmark and frame budget

Host prelude FFT stub, Node.js v22.23.1, 1024 samples, five groups of 100 full analyses (DC removal + Hann + realfft + magnitude + band mapping): median **2.447 ms/analysis** in an isolated run and **4.541 ms/analysis** during the full regression (CPU contention). Raw output is in `artifacts/r97/harness.txt`. The existing `tests/fft.js` host QuickJS/C harness separately measured 1024-point native FFT at 0.0440 ms versus JS butterflies at 4.5340 ms (1000 calls); its raw line appears in `artifacts/r97/regression.txt`. These are host reference results, not ESP32 timing. The 1024-point setting is retained provisionally because the measured host result is below the 20 ms threshold. Measure `smAnalyze()` on the board; switch to 512 points if its actual worst-case time exceeds 20 ms.

Per-frame draw budget observed in the prelude harness: **51 Canvas calls** (1 background rect, 2 guide circles, 40 thick radial lines, 1 center fill circle, 1 center outline, 3 text calls, 2 level bar rects, 1 energy label). The 2 buttons are persistent UI nodes, not per-frame Canvas calls. Assertion limit: 200. The host run produced:

```
PASS Hann window finite, coherent sum=511.50
PASS prelude starts DEMO after microphone error
PASS native-API stub FFT finite; sine peak bin=32 band=20
PASS radial index to angle linear
PASS DEMO audible PCM and visible FFT, draw calls=51
PASS MIC callback defers analysis and drawing
BENCH host prelude FFT+window+magnitude+bands 1024: median 2.343 ms/analysis, 5x100
ALL SPECTRUM MUSIC CASES PASSED
```

## Verification

`node tools/lume/lume.js check examples/spectrum_music --no-emu`:

```
lume check examples/spectrum_music

[PASS] bundle   3165 bytes (21 ms)
[SKIP] eval     --no-emu
[SKIP] layout   requires emulator screenshot (--no-emu)
[SKIP] perf     profile disabled

RESULT: PASS (4 steps, 0 failed; exit 0)
```

`node tools/playground/build.mjs` reports **38 editable sources / 38 apps** (`artifacts/r97/build-playground.txt`). The host simulator renders DEMO mode in [frame 1](../artifacts/r97/01-demo-square.png), [frame 2](../artifacts/r97/02-demo-motion.png), and [sunset theme](../artifacts/r97/03-demo-sunset.png). Its microphone stub was forced to return -3 through an external preload; the simulator source was unchanged. Screenshot log: `artifacts/r97/simulator-shots.txt`. Full host harness output is in `artifacts/r97/regression.txt` (all `tests/*.js`, exit 0, no FAIL). Browser playground verification is in `artifacts/r97/verify-playground.txt`.

## Board acceptance and tuning

No physical board was used. Confirm microphone channel orientation, capture gain, 30 ms tick latency, FFT worst-case duration, PCM playback queue behavior, speaker output, visual orientation, and touch targets on device. Adjust microphone gain and the logarithmic bin-to-band mapping against real speech/music; current scaling and 2–511 bin range are host-tuned. The host emulator and browser screenshots establish API and rendering behavior only.
