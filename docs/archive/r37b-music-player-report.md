# r37b music player: host verification

## Implementation

- `mp3_decoder` vendors minimp3 at `ea99364f61c14656440e8d77e9c233ccf3124633`.
  The brief's `asmusso/helix_mp3` repository and registry URL returned 404;
  `ultraembedded/libhelix-mp3` was reachable. minimp3 was selected as a
  single-header C port and compiled under IDF 5.5.5.
- TF card mount is SPI3/FAT at `/lume_sd` with GPIO1/2/3/41 from Waveshare's
  board documentation. This is separate from LittleFS `Fs`; `Fs.readBinary`
  still has a 64 KiB cap. MP3 input uses a 4096-byte window and never holds
  an entire song or PCM copy in PSRAM. The decoder object and input window
  live in internal heap. Audio queue copies at most 16 x 4608 = 73728 bytes
  into PSRAM. At 44.1 kHz stereo 16-bit this is 418 ms queued PCM; the I2S
  driver owns an additional DMA ring. Actual DMA buffer sizing needs board
  measurement.
- The engine callback decodes and enqueues at most one frame per 20 ms tick.
  A 1152-sample 44.1 kHz frame represents 26.1 ms, leaving nominal 6.1 ms
  for decoding and UI per tick before steady-state pressure. The queue-full
  status `-3` keeps the same frame for a later tick. This avoids the previous
  whole-song synchronous `play()` freeze; first TF mount and each frame decode
  still run on the engine task and need timing measurements on hardware.
- `streamFinished()` waits for no queued/active writes plus one conservative
  DMA ring duration. The IDF write call returns after DMA copy, so exact final
  codec drain timing still needs on-device measurement.

## Simplifications and pending acceptance

ID3v2 metadata, GBK LRC, seeking and position resume are not implemented.
ID3v1 high bytes are interpreted as Latin-1. LRC is UTF-8 only; malformed
bytes are decoded with replacement characters. Duration is estimated from
current bitrate and file length, so VBR progress can drift. `lume.audio.mp3`
exposes one active decoder. The player shows four sorted library entries.
A frame decode and FAT read can exceed the 20 ms timer budget; no hardware
latency figure is claimed. There is no streaming progress callback.

On-device audio output, 44.1 kHz codec clock behavior, TF mount reliability,
lyrics synchronization, pause/skip behavior and long-track stability remain
unverified. The same limitations are also recorded in `docs/KNOWN-SIMPLIFICATIONS.md`.

## Final host output (raw excerpts)

Baseline HEAD: `191bf5b` (r36b final bin `0x2857e0`). Final bin is
`0x297830`, an increase of `0x12050` = 73,808 bytes. The decoder object alone
has 18,750 bytes `.text`, 0 `.data`, 8 `.bss` (`xtensa-esp32s3-elf-size`);
the overall bin increase also includes FAT/SDSPI dependencies and bindings.

```text
$ idf.py build
lume.bin binary size 0x297830 bytes. Smallest app partition is 0x640000 bytes. 0x3a87d0 bytes (59%) free.
[100%] Built target app_check_size
[100%] Built target app
Project build complete. To flash, run:

$ idf.py size
│ Flash Code        │      1741638 │          │                │               │
│ Flash Data        │       827728 │          │                │               │
│ DIRAM             │       230239 │    67.37 │         111521 │        341760 │
│ IRAM              │        16384 │    100.0 │              0 │         16384 │
Total image size: 2717613 bytes (.bin may be padded larger)

$ xtensa-esp32s3-elf-size build/esp-idf/mp3_decoder/CMakeFiles/__idf_mp3_decoder.dir/mp3_decoder.c.obj
   text    data     bss     dec     hex filename
  18750       0       8   18758    4946 build/esp-idf/mp3_decoder/CMakeFiles/__idf_mp3_decoder.dir/mp3_decoder.c.obj

$ /tmp/lume-mp3-test
MP3 decoder: frames=11 sampleRate=44100 channels=2 samples=12672 PASS

$ node tests/music_player.js
LRC normal: PASS
LRC skip untimed: PASS
LRC sort: PASS
LRC bad GBK bytes: PASS
Scheduler: ticks=7 decoded=5 sent=4 retry=2 PASS
Scheduler: stop and negative-index wrap PASS

$ PLAYWRIGHT_MODULE=/tmp/lume-playwright/node_modules/playwright node tools/simulator/verify_music_player.js
PASS library screenshot=artifacts/simulator/MusicLibrary.png
PASS playing lyrics screenshot=artifacts/simulator/MusicPlaying.png

$ npm test --prefix tools/lume
# tests 17
# pass 17
# fail 0
```

Simulator captures: [library](../artifacts/simulator/MusicLibrary.png),
[playing with second lyric highlighted](../artifacts/simulator/MusicPlaying.png).
Other host regressions: `tests/apps.js`, `games.js`, `lifecycle.js`,
`files_dialog.js` passed; `gen_api_docs.py --check`, `check_website.py`, and
`git diff --check` passed. These do not establish board playback.
