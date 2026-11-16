# r71 local web server report

Base: `origin/main` `c1faee1093b15eab6e055129c9edc3f8fde780dc` (fetched before edits). Worktree: `/tmp/lume-r71-wt`, branch `r71-webserv`. Existing CodeBuddy WIP in the engine, prelude and network component was reviewed and retained, then corrected at the protocol and lifetime edges.

## Design and security

The engine task polls `select` with zero timeout once per loop, accepts up to two sockets, reads with `MSG_DONTWAIT`, invokes the JS handler synchronously, and streams its response. This uses the same IPv4 gate, bind/listen/select/accept/close lifecycle as the WiFi OTA listener. A separate web task would need a queue and a blocked waiter for the single JS engine; direct polling avoids that cross-task deadlock. The app switch teardown closes the listener and clients before freeing the JS runtime. An explicit token is required to start; requests missing the matching `key` are rejected in C before dispatch. No path is used as a filesystem path.

The HTTP subset is request line, Content-Length, Connection, and bounded body. The server always closes each response. Chunked requests, keep-alive, multipart parsing, compression and TLS are outside this slice. The 8 KiB body and 1 KiB header caps use one 9 KiB PSRAM request buffer shared across two connections. Response bodies are sent from JS memory in 512-byte chunks within a five-second connection deadline measured from accept. A handler that has already exceeded five seconds gets 504 on return; synchronous JS cannot be preempted inside the handler, so handlers must remain short. The 9 KiB figure is the C intermediate surface; the JS body string is separately allocated by QuickJS. This combined peak has not been measured on hardware and remains a board acceptance item.

WIP review fixes include correct 413/431 status handling, duplicate `Content-Length` and chunked-request rejection, a bounded total send deadline, a single close per rejected socket, JS property-atom cleanup, and retaining an ArrayBuffer response owner through the final send.

`examples/web_config/app.js` shows the address and token on screen; its browser form chooses card mode and starting letter, POSTs to `/api/config`, and saves `card.mode` / `card.start` in KV. The app contains placeholder WiFi credentials and token to edit before deploying. `abc123` itself is unchanged.

## Verification

Host JavaScript route / mock HTTP chain:

```text
PASS default closed and token required
PASS start, URL, and duplicate start
PASS token gate before JS dispatch
PASS exact route, welcome fallback, 404
PASS query decode and response framing
PASS 8 KiB request body cap and full POST to KV
PASS stop lifecycle
PASS built-in welcome and handler exception
webserver: 8 cases PASS
```

Pure C parser (`gcc -std=c11 -Wall -Wextra -Werror`):

```text
webserv_parse: 51 checks PASS
```

All `tests/*.js` harnesses (raw output):

```text
PASS tests/abc123.js
PASS tests/ai.js
PASS tests/animation_mapping.js
PASS tests/apps.js
PASS tests/async_jobs.js
PASS tests/ble.js
PASS tests/canvas_mapping.js
PASS tests/compass.js
PASS tests/create_failure.js
PASS tests/files_dialog.js
PASS tests/frogger.js
PASS tests/game_of_life.js
PASS tests/games.js
PASS tests/gesture_queue.js
PASS tests/gestures.js
PASS tests/gravity_ball.js
PASS tests/image_mapping.js
PASS tests/invaders.js
PASS tests/lifecycle.js
PASS tests/list_virtualization.js
PASS tests/music_player.js
PASS tests/pet.js
PASS tests/piano.js
PASS tests/power.js
PASS tests/reload_staging.js
PASS tests/shell_components.js
PASS tests/style_mapping.js
PASS tests/text_payload.js
PASS tests/theme_mapping.js
PASS tests/watchface.js
PASS tests/weather.js
PASS tests/webserver.js
PASS tests/ws.js
```

`npm test --prefix tools/lume` (raw summary):

```text
1..44
# tests 44
# suites 0
# pass 43
# fail 0
# cancelled 0
# skipped 1
# todo 0
# duration_ms 6419.065715
```

`lume check examples/web_config --no-emu`:

```text
lume check examples/web_config

[PASS] bundle   2186 bytes (226 ms)
[SKIP] eval     --no-emu
[SKIP] layout   requires emulator screenshot (--no-emu)
[SKIP] perf     profile disabled

RESULT: PASS (4 steps, 0 failed; exit 0)
```

The checked in esp32sim setup maps display, touch, I2C, IMU and serial injection; its patch and README expose no WiFi or host TCP loopback model. The simulator binary/cache is absent in this worktree. A network round-trip assertion in esp32sim is therefore unavailable; the C parser unit test and JS route/mock HTTP chain provide the two independent host evidence paths. Real browser-over-WiFi and memory peak await board validation.

## Firmware build and size

The first build collided with another build in the same worktree and failed at an archive race (`xtensa-esp-elf-ranlib: 'libpthread.a': No such file`). A subsequent clean, single-owner build completed successfully. The final build tail was:

```text
[100%] Generating binary image from built executable
esptool.py v4.13.0
Creating esp32s3 image...
Merged 3 ELF sections
Successfully created esp32s3 image.
Generated /tmp/lume-r71-wt/firmware/build/lume.bin
[100%] Built target gen_project_binary
lume.bin binary size 0x2da850 bytes. Smallest app partition is 0x640000 bytes. 0x3657b0 bytes (54%) free.
[100%] Built target app_check_size
[100%] Built target app
```

`idf.py size` completed with exit 0. Raw summary:

```text
│ Flash Code        │      2005872 │          │                │               │
│ Flash Data        │       844452 │          │                │               │
│ DIRAM             │       230675 │     67.5 │         111085 │        341760 │
│ IRAM              │        16384 │    100.0 │              0 │         16384 │
Total image size: 2992079 bytes (.bin may be padded larger)
Built target size
```

IRAM is exactly 16,384 / 16,384 bytes, with no overflow. The build did not exercise real WiFi or an on-device browser.
