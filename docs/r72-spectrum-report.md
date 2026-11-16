# r72 live microphone spectrum — implementation and verification

Baseline: `origin/main` at `0a9a2a7b134e19d77764b8b1ab64944a0f12c1a8`, fetched before work. Worktree/branch: `/tmp/lume-r72-wt`, `r72-spectrum`. No `lume-net` or vendored component changes. No push.

## Code path and lifecycle

`lume_audio_init()` already enables I2S RX (port 1, slave) and TX (port 0, master) continuously; legacy `record()` only blocks on `i2s_channel_read()`. r72 keeps that setup and adds one audio task which reads 16 kHz, 16-bit stereo blocks into a 64 KiB PSRAM circular buffer. Each completed block is copied to an owned PSRAM chunk and sent through a dedicated eight-item audio event queue. Its oldest entry is discarded if full; touch, lifecycle and WS events remain in the existing Queue B. The engine takes at most one chunk per 20 ms loop and calls `__lume_dispatchAudioChunk` on the engine task. `stopStream()` deactivates capture, increments generation, drains the audio queue and prevents a late chunk from reaching the current JS runtime. Teardown and failed eval do the same before freeing the runtime.

The RX slave shares BCLK/WS with TX master. Stream start waits for playback queue and DMA drain, then forces TX to 16 kHz. During capture, `playStream` at other rates and synchronous `record()` return `-3`. This guards the existing clock state without changing codec registers or DMA configuration. Full 16 kHz duplex and actual ES7210 data still need board validation.

## FFT and UI

Reusable `examples/spectrum/fft.js` implements radix-2 FFT with a Hann window and coherent-gain normalization. The example analyzes 512 samples from each 1024-frame callback by default; if a callback measures above 15 ms it switches to 256 samples. A 32-column logarithmic map, three hard color bands, decaying peak ticks, VU RMS and sample-rate/FPS/drop HUD render in a 400×200 canvas dirty rectangle. The callback computes numeric values and sets a signal; the timer creates HUD strings and triggers canvas redraw. Tap starts/stops; swipe up toggles 256/512. `SPEC fps=<n> drop=<k> peak=<hz>` is logged once per second.

## Evidence

Host harness command and raw result:

```text
$ node tests/spectrum.js
PASS spectrum single sine peak ±1 bin
PASS spectrum two tones produce two peaks
PASS spectrum Hann coherent gain normalization
PASS spectrum log groups strictly advance
PASS spectrum 256 FFT and 32 bars bounded
PASS spectrum tap starts one 1024-frame stream
PASS spectrum callback does not redraw canvas
PASS spectrum timer signal drives 400x200 dirty rect
PASS spectrum drop count and SPEC serial event
PASS spectrum stopStream clears callback and capture
```

Other host checks:

```text
$ node tests/ws.js
WebSocket host prelude: PASS
$ node tests/music_player.js
Scheduler: ticks=7 decoded=5 sent=4 retry=2 PASS
$ node tools/lume/lume.js check examples/spectrum --no-emu
[PASS] bundle   3828 bytes (25 ms)
[SKIP] eval     --no-emu
[SKIP] layout   requires emulator screenshot (--no-emu)
[SKIP] perf     profile disabled
RESULT: PASS (4 steps, 0 failed; exit 0)
$ npm test --prefix tools/lume
# tests 44
# pass 43
# fail 0
# skipped 1
```

The host simulator's synthetic 440 Hz PCM source ran through `recordStream` mock → prelude callback → FFT → canvas messages. Playwright captured [the rendered frame](r72-spectrum-browser.png); visual inspection found 32 columns with a 440 Hz peak, peak ticks, VU and HUD. Serial output included `[app] SPEC fps=15 drop=0 peak=438`. The host run showed `256 FFT 15fps drop 0`: a 512-point callback exceeded the 15 ms guard and the app reduced size, as designed. This timing is host Node VM behavior, not an ESP32 QuickJS measurement. The website playground runtime was not changed in this round; its app picker does not include spectrum.

Firmware and emu raw summary:

```text
$ idf.py build && idf.py size
Project build complete.
lume.bin binary size 0x2d8510 bytes. Smallest app partition is 0x640000 bytes. 0x367af0 bytes (54%) free.
│ Flash Code        │      2000684 │
│ DIRAM             │       230595 │    67.47 │         111165 │        341760 │
│ IRAM              │        16384 │    100.0 │              0 │         16384 │
$ EMU_BIN=/home/ubuntu/lume/tools/emu/.cache/bin/esp32sim node tools/lume/lume.js check examples/spectrum
[PASS] bundle   3828 bytes (46 ms)
[PASS] eval     2x "app eval ok; entering event loop"
[SKIP] layout   no layout expectations for spectrum
[SKIP] perf     profile disabled
screenshot: artifacts/check/spectrum/tft.png
RESULT: PASS (4 steps, 0 failed; exit 0)
```

The emu screenshot shows the idle spectrum screen. It cannot prove RX PCM because the ES7210 is only a register stub. The host screenshot is the synthetic-audio rendering evidence.

## Pending

ES7210 is a register stub in esp32sim, so real microphone capture cannot be claimed from emulator output. Board acceptance remains for PCM channels and amplitude, clock sharing during 16 kHz duplex, FFT callback time, sustained queue drops under UI/network load, touch/visual feel, and audio latency. No AEC, AGC or dB SPL calibration is present.

The first full `idf.py build` was interrupted with exit 143 while r71 was also building. A retry exposed one local forward-declaration compile error, which was fixed. The interrupted build had left a truncated generated `quickjs.c.obj`. Compiling this unchanged vendored object again stalled under swap pressure, so the final build reused the already compiled object from the read-only main checkout. `quickjs.c` SHA-256 and `sdkconfig` were identical in both worktrees; the archive, r72 components, final link, binary size and `idf.py size` were built in r72. No vendored source or main checkout file was edited. The emu executable was also read from the main checkout via `EMU_BIN`; r72 firmware images were used.
