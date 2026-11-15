# r40b UI refresh verification

Ten examples were redesigned for the 480×480 watch-size panel. The source changes are in `examples/` and `runtime/shell.js`; the firmware source and binary were not changed. The old embedded counter demo remains a boot fallback, so host tests now check both demos' behavior instead of requiring identical UI messages.

Screenshots: `artifacts/emu/ui-refresh/<app>.png` for counter, power_demo, imu_poll, heart_curve, dashboard, device_monitor, files, file_manager, ai_chat and music_player. Before captures: `counter-before.png`, `power_demo-before.png`, `imu_poll-before.png`, `heart_curve-before.png`. Each after capture came from `EMU_SKIP_BUILD=1 tools/emu/run.sh examples/<app>` and a successful second `app eval ok` after RELOAD. The same firmware image is used for before and after, so these images compare JS UI changes.

The emulator runs with stub PMIC and no TF media or provisioned AI key, so the screenshots show those apps' default/empty states. The simulator does not establish physical display, touch, audio or power acceptance. `image_gallery` was not changed; its known blank image capture remains in r39b.

## Host harness output

```text
PASS tests/ai.js
PASS tests/animation_mapping.js
PASS tests/apps.js
PASS tests/ble.js
PASS tests/canvas_mapping.js
PASS tests/create_failure.js
PASS tests/files_dialog.js
PASS tests/games.js
PASS tests/gesture_queue.js
PASS tests/gestures.js
PASS tests/image_mapping.js
PASS tests/imu_ball.js
PASS tests/lifecycle.js
PASS tests/list_virtualization.js
PASS tests/music_player.js
PASS tests/power.js
PASS tests/reload_staging.js
PASS tests/shell_components.js
PASS tests/style_mapping.js
PASS tests/text_payload.js
PASS tests/theme_mapping.js
```

## CLI unit test output

```text
1..17
# tests 17
# suites 0
# pass 17
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

## Emulator capture output

```text
counter OK
power_demo OK
imu_poll OK
heart_curve OK
dashboard OK
device_monitor OK
files OK
file_manager OK
ai_chat OK
music_player OK
```

## Raw JS harness output

```text
$ node tests/ai.js
request construction + key storage: PASS
HTTP error + timeout + bad JSON + truncation: PASS
Node local POST round trip: PASS
$ node tests/animation_mapping.js
PASS initial transition value uses SET_ATTR
PASS transition signal.set emits ANIMATE with omitted from and ease-out
PASS ANIMATE_CANCEL path
PASS onComplete registered and dispatched through reverse event hook
PASS same-property replacement discards old completion
PASS color animation rejected
$ node tests/apps.js
PASS apps entries merges meta.json and falls back per field
PASS apps entries tolerates a store without native metadata
PASS apps entries ignores malformed meta instead of throwing
PASS apps current() reports the running app id
PASS apps launch/home/remove return the native status codes
PASS apps Launcher defaults to the installed app set
PASS apps Launcher tap launches the app by default (no host callback)
PASS apps explicit apps + onLaunch still override the store
PASS apps Launcher rejects a non-array app list
PASS apps embedded home renders a clock and one tile per installed app
PASS apps embedded home launches a tile and keeps BACK at the root
PASS apps embedded home shows an empty state with no apps
PASS 12 multi-app cases
$ node tests/ble.js
PASS lume.ble wiring (header, CMake, sdkconfig, natives, types, docs)
PASS onStart advertises; first poll of a live link sends HELLO
PASS poll drains one RX packet, verifies the link and acks it
PASS Ping Button press sends a ping
PASS Ping counter Text reflects the press
PASS negative read() status is handled by the app
PASS onPause / shutdown stops advertising
PASS failed start() is surfaced without starting the poll timer
$ node tests/canvas_mapping.js
PASS canvas create dimensions and fixed wire kind
PASS drawing command order and final invalidate
PASS optional dirty rectangles preserve local coordinates
PASS signal change redraws once; equal value stays idle
PASS canvas is adopted into flex layout flow at fixed size
PASS dimensions/coordinates/color/text/point bounds reject
PASS injected 390x390 screen governs canvas size, budget and draw bounds
PASS counter example retains count and theme behavior
SAMPLE messages (first 12): [["create",1,0],["attr",1,12,12],["attr",1,0,"taps: 0"],["create",0,0],["attr",2,1,2377581],["attr",2,16,100],["attr",2,3,120],["attr",2,7,1],["attr",2,8,2],["attr",2,9,2],["attr",2,11,6],["attr",2,12,12]]
SAMPLE totals: {"create":7,"attr":42,"press":3}
PASS 33 contiguous lines split at 32
CANVAS 240 points: old=239 messages / 27724 queue bytes; new=8 messages / 928 queue bytes + 3824 payload bytes
PASS 240-point polyline uses eight batches
$ node tests/create_failure.js
PASS: create-failed notice disposes signal effects and warns once
PASS: Canvas failure latches dead id and native attrs become no-op
$ node tests/files_dialog.js
PASS files before: DEL -> status confirmation -> DEL -> remove
PASS files after: DEL -> Dialog -> Delete -> remove -> Toast
$ node tests/games.js
PASS 2048 left
PASS 2048 right
PASS 2048 up
PASS 2048 down
PASS 2048 no change
PASS 2048 game over
PASS snake turns
PASS snake eats
PASS snake wall
PASS snake body
PASS snake IMU threshold
PASS 2048 high score KV key
PASS snake high score KV key
PASS brkout high score KV key
PASS breakout wall rebound
PASS breakout brick
PASS breakout level
PASS breakout game over
$ node tests/gesture_queue.js
PASS: DOWN MOVE UP retain FIFO order
PASS: MOVE pressure reserves capacity and UP reaches queue tail
$ node tests/gestures.js
PASS tap: short press with small displacement -> one tap with end coords
PASS tap boundary: displacement >= tapMovePx(10) is NOT a tap
PASS tap boundary: duration >= tapMaxMs(400) is NOT a tap (becomes longpress)
PASS longpress boundary: fires while still down once t-start >= 400ms
PASS longpress suppresses tap AND swipe on release (no double-fire)
EVIDENCE pan stream types=["panstart","pan","pan","panend"] final dx/dy=35/2
PASS pan stream: panstart -> pan* -> panend, with dx/dy from press start
PASS swipe: LVGL gesture-dir hint (right=2) wins over axis inference
PASS swipe: axis fallback when no LVGL dir hint (vertical -> down)
PASS swipe speed gate: a 5s STATIONARY hold is a longpress, never a swipe
PASS r21-fix: a SLOW drag held past 400ms is pan, NEVER longpress (movement gate)
PASS r21-fix: a slow drag that ends fast stays swipe-eligible (no longpress steal)
PASS r21-fix: slow long drag (dist>=50px, vel<min) is neither longpress nor swipe
PASS swipeMinVel is a real, tunable gate (raise it -> slow drag stops swiping)
PASS scroll-cancelled UP: a List scroll wins, no tap/swipe/longpress
PASS tuning is centralized and tunable: swipeMinPx can be raised at runtime
PASS on() enables LVGL events once per node and rejects bad type/callback
PASS  dispatched GestureEvent reaches the right callback with coordinates
PASS unregister function is idempotent and stops future delivery
PASS longpress then release: no tap delivered; onPress (CLICKED) suppressed
PASS normal tap: onPress AND gesture tap both fire (no longpress latch)
PASS dispose clears per-node gesture state (removed node stops dispatching)
EVIDENCE demo tap -> status="tap (61,100)" taps=1
PASS examples/gestures/app.js evaluates and its tap counter responds
PASS example swipe changes page and longpress toggles color
PASS 20 r21 gesture cases
$ node tests/image_mapping.js
PASS Image create/source/size message order
PASS Image participates in View flex child adoption
PASS Image preserves aspect ratio for one explicit dimension
PASS Image propagates decoder error and removes failed node
PASS Image rejects invalid input and propagates header error
PASS embedded PNG 1x1 decodes to exact opaque red RGBA bytes
$ node tests/imu_ball.js
PASS imu_ball gravity accelerates and displaces
PASS imu_ball wall reflects normal velocity with restitution
PASS imu_ball hole event
PASS imu_ball goal requires entire ball inside
PASS imu_ball boundary clamps and reflects
PASS imu_ball dt cap limits delayed tick
PASS imu_ball resting contact has no sound impact
$ node tests/lifecycle.js
PASS registration, unregistration and start/pause/resume sequence
PASS onBack unregistered selects default
PASS onBack false selects default
PASS onBack true intercepts
PASS timeout once and interval skips missed periods
PASS timer clear is idempotent
PASS paused timer waits and resumes without catch-up burst
PASS hot replacement disposes effect, canvas onDraw, animation and timer
PASS shutdown clears lifecycle and timer registries
PASS replacement starts fresh app without old callbacks
$ node tests/list_virtualization.js
EVIDENCE 1000 items / 12 visible: actual created nodes=17 (15 rows + container + spacer)
PASS 1000 items, 12 visible: initial 15 rows, 17 total nodes
EVIDENCE 1000 items / 12 visible: middle window live nodes=20 (18 rows + 2 fixed)
PASS scroll maps to 18-row middle window
PASS scroll window reclaims old rows before creating replacements
PASS small scroll within same window does not churn nodes
PASS same-length items replacement rebuilds window and keeps offset
PASS length change rebuilds and resets scroll to top
PASS removed row loses press callback and signal effects
PASS 1000-item traversal stays within the 127-node table
PASS bridge throttle and overflow policy are present
EVIDENCE files seedTestEntries(): 1000 entries, 45 new nodes
PASS files example seeds 1000 entries without creating 1000 rows
PASS 10 list virtualization cases
$ node tests/music_player.js
LRC normal: PASS
LRC skip untimed: PASS
LRC sort: PASS
LRC bad GBK bytes: PASS
Scheduler: ticks=7 decoded=5 sent=4 retry=2 PASS
Scheduler: stop and negative-index wrap PASS
Lyrics: five-line window and missing LRC PASS
Library: recursive scan, ID3 title order, last track and offset KV PASS
Restart: last track and LRC offset restored, playback starts at zero PASS
$ node tests/power.js
PASS wake registration, unregister, and success-only dispatch
PASS touch feeds idle timer and wake resets activity
PASS shutdown clears wake callbacks
$ node tests/reload_staging.js
PASS: A post failure frees only A; B posts latest frame with pending set
PASS: successful post coalesces replacement and preserves latest frame
$ node tests/shell_components.js
PASS shell Card and IconButton expose watch-sized defaults
PASS shell StatusBar getter follows signal
PASS shell StatusBar clock timer and disposal
PASS shell EdgeNavigation true handles back
PASS shell EdgeNavigation false forwards page swipe
PASS shell indicator draws and rebounds, mask toggles
PASS shell Launcher creates bounded virtual grid
PASS shell app press and edge gesture route independently
PASS shell dispose unregisters gestures and app close clears resources
PASS shell spacing injects missing View padding and gap and follows theme changes
PASS shell explicit spacing wins and invalid token is atomic
PASS shell Dialog opens and close is idempotent
PASS shell Dialog stack ignores covered button and closes top first
PASS shell Dialog lifecycle pause removes overlays
PASS shell danger button follows theme danger token
PASS shell primary button follows theme primary token
PASS shell Toast replaces current and resets timer
PASS shell Toast fades then removes itself
PASS 18 shell component cases
$ node tests/style_mapping.js
PASS column + dimensions + color: [[1,728639],[16,100],[17,50],[7,1]]
PASS row: [[7,0]]
PASS row wrap: [[7,2]]
PASS column wrap: [[7,3]]
PASS justify start: [[8,0]]
PASS justify end: [[8,1]]
PASS justify center: [[8,2]]
PASS justify space-between: [[8,3]]
PASS justify space-around: [[8,4]]
PASS justify space-evenly: [[8,5]]
PASS stretch + gap + padding: [[9,3],[10,16],[11,8]]
PASS radius + border + opacity: [[12,12],[13,2],[14,11259375],[15,128]]
PASS pixel + legacy bg: [[1,1122867],[2,240],[3,120]]
PASS vertical scroll + auto scrollbar: [[20,1],[21,1]]
PASS horizontal scroll + on scrollbar: [[20,2],[21,2]]
PASS scroll disabled + scrollbar off: [[20,0],[21,0]]
PASS per-side padding overrides box shorthand: [[10,8],[30,2],[31,4],[32,6],[33,10]]
PASS margin box + per-side margin: [[34,4],[38,12]]
PASS margin sides only: [[35,2],[36,3],[37,5],[38,7]]
PASS flex grow inside a flex row: [[7,0],[39,1]]
PASS auto sizing: [[43,1],[44,1]]
PASS min/max size bounds: [[45,10],[46,200],[47,20],[48,40]]
PASS absolute position escapes the flow: [[23,1],[18,4],[19,8]]
PASS relative position sends nothing: []
PASS translate px + percent: [[49,6],[52,50]]
PASS text align + long mode: [[53,1],[54,1]]
PASS align string + alignTo + alignOffset: [[40,5],[41,-8],[42,-4],[4,6]]
PASS align center: [[4,0]]
PASS align top-left: [[4,1]]
PASS align top-mid: [[4,2]]
PASS align top-right: [[4,3]]
PASS align bottom-mid: [[4,4]]
PASS align bottom-left: [[4,5]]
PASS align bottom-right: [[4,6]]
PASS align left-mid: [[4,7]]
PASS align right-mid: [[4,8]]
PASS align numeric constant: [[4,4]]
PASS aligned to parent with an offset: [[40,0],[42,12],[4,2]]
PASS outside align below a base node: [[40,7],[4,13]]
PASS outside align above a base node: [[40,7],[4,10]]
PASS outside align right of a base node: [[40,7],[4,19]]
PASS outside align corner: [[40,7],[41,4],[4,18]]
PASS outside align numeric constant: [[4,20]]
PASS invalid align/alignTo/alignOffset/flexGrow/margin/position/translate/text rejected in prelude
PASS Row presets flex row: [[7,0]]
PASS Column presets flex column: [[16,100],[7,1]]
PASS fontSize/letterSpacing/lineHeight: [[55,20],[56,1],[57,-2]]
PASS fontSize snaps + scales via theme.fontScale: [[55,18]]
PASS fontScale below 1 keeps faces in range: [[55,22]]
PASS invalid percentage/metric/color/opacity rejected in prelude
PASS all style mapping cases
PASS embedded demo and refreshed counter both register buttons
$ node tests/text_payload.js
PASS: 240-byte Chinese and 256-byte ASCII text accepted; 257 bytes rejected
PASS: external text payload has sender rollback and receiver release paths
$ node tests/theme_mapping.js
PASS set/get returns an isolated snapshot
PASS named background and borderColor resolve
PASS hex literals remain valid
dark→light ATTR messages: [[1,1,15332090],[1,12,16],[1,14,2310751]]
PASS theme.set invalidates every named color and implicit radius
PASS unreferenced literal colors and explicit radius post no messages
PASS removing default radius clears inherited radius
PASS invalid theme is atomic
PASS disposed node stops receiving theme updates
PASS unknown token falls through to literal parser
demo dark→light ATTR messages: [[2,1,16777215],[7,1,15332090]]
PASS demo buttons recolor card, controls and full-screen root
```

## Raw CLI test output

```text
$ npm test --prefix tools/lume

> @lume/cli@0.1.0 test
> node --test

TAP version 13
# Subtest: frame bytes match firmware wire layout and CRC-32
ok 1 - frame bytes match firmware wire layout and CRC-32
  ---
  duration_ms: 3.228917
  type: 'test'
  ...
# Subtest: create writes complete offline scaffold and bundles with prelude globals
ok 2 - create writes complete offline scaffold and bundles with prelude globals
  ---
  duration_ms: 36.61932
  type: 'test'
  ...
# Subtest: esbuild iife runs in global-script host; esm syntax does not
ok 3 - esbuild iife runs in global-script host; esm syntax does not
  ---
  duration_ms: 8.497093
  type: 'test'
  ...
# Subtest: bundle rejects oversize output before opening serial
ok 4 - bundle rejects oversize output before opening serial
  ---
  duration_ms: 16.821352
  type: 'test'
  ...
# Subtest: OTA auth preamble + default port match the firmware wire format
ok 5 - OTA auth preamble + default port match the firmware wire format
  ---
  duration_ms: 0.491644
  type: 'test'
  ...
# Subtest: OTA push reuses the USB frame() bytes (right-token path)
ok 6 - OTA push reuses the USB frame() bytes (right-token path)
  ---
  duration_ms: 14.757226
  type: 'test'
  ...
# Subtest: OTA wrong token is rejected (AUTH ERR path)
ok 7 - OTA wrong token is rejected (AUTH ERR path)
  ---
  duration_ms: 4.527362
  type: 'test'
  ...
# Subtest: OTA screenshot round trips the RGB565 frame past log noise
ok 8 - OTA screenshot round trips the RGB565 frame past log noise
  ---
  duration_ms: 44.537396
  type: 'test'
  ...
# Subtest: decodeShot rejects a corrupted payload and a CRC mismatch
ok 9 - decodeShot rejects a corrupted payload and a CRC mismatch
  ---
  duration_ms: 0.972176
  type: 'test'
  ...
# Subtest: bmpFromRgb565 produces a valid bottom-up 24-bit BMP
ok 10 - bmpFromRgb565 produces a valid bottom-up 24-bit BMP
  ---
  duration_ms: 0.828792
  type: 'test'
  ...
# Subtest: OTA RELOAD ERR is surfaced as a push error
ok 11 - OTA RELOAD ERR is surfaced as a push error
  ---
  duration_ms: 8.114906
  type: 'test'
  ...
# Subtest: command frame uses LUMC magic, same header and CRC as app frames
ok 12 - command frame uses LUMC magic, same header and CRC as app frames
  ---
  duration_ms: 0.386656
  type: 'test'
  ...
# Subtest: STORE payload layout: verb, id, one-line meta, then raw source
ok 13 - STORE payload layout: verb, id, one-line meta, then raw source
  ---
  duration_ms: 0.323551
  type: 'test'
  ...
# Subtest: OTA command round trip: STORE + LIST + LAUNCH ACKs
ok 14 - OTA command round trip: STORE + LIST + LAUNCH ACKs
  ---
  duration_ms: 7.826014
  type: 'test'
  ...
# Subtest: CLI apps usage, sub-command and id validation
ok 15 - CLI apps usage, sub-command and id validation
  ---
  duration_ms: 567.029519
  type: 'test'
  ...
# Subtest: OTA no-board path: connection refused is a clear error
ok 16 - OTA no-board path: connection refused is a clear error
  ---
  duration_ms: 2.361777
  type: 'test'
  ...
# Subtest: CLI --ota usage, arg validation and no-board error output
ok 17 - CLI --ota usage, arg validation and no-board error output
  ---
  duration_ms: 414.002029
  type: 'test'
  ...
1..17
# tests 17
# suites 0
# pass 17
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1275.262447
```

## Raw emulator command output

```text
$ EMU_SKIP_BUILD=1 tools/emu/run.sh examples/counter
bundle /home/ubuntu/lume/examples/counter: 2136 bytes; frame 2148 bytes
I (1752) lume-engine: engine task up (pinned core 1), PSRAM free=5786452 bytes
I (1825) lume-engine: runtime up; eval app '<home>' (5127 bytes)
I (1924) lume-engine: app eval ok; entering event loop
I (2697) lume-engine: engine recv RELOAD -> recycle runtime
I (2710) lume-engine: runtime up; eval app '<embedded-demo>' (2136 bytes)
I (2811) lume-engine: app eval ok; entering event loop
[emu] stop: Halted — core0 76001976 + core1 73533199 insns in 4.2s wall = 35.2 Minsn/s; emulated 8.000s (1920000000 cycles); 550712 exceptions, 23095 interrupts
TFT: artifacts/emu/ui-refresh/run-counter/tft.png
serial: artifacts/emu/ui-refresh/run-counter/serial.log
$ EMU_SKIP_BUILD=1 tools/emu/run.sh examples/power_demo
bundle /home/ubuntu/lume/examples/power_demo: 1782 bytes; frame 1794 bytes
I (1752) lume-engine: engine task up (pinned core 1), PSRAM free=5786452 bytes
I (1825) lume-engine: runtime up; eval app '<home>' (5127 bytes)
I (1924) lume-engine: app eval ok; entering event loop
I (2697) lume-engine: engine recv RELOAD -> recycle runtime
I (2710) lume-engine: runtime up; eval app '<embedded-demo>' (1782 bytes)
I (2809) lume-engine: app eval ok; entering event loop
[emu] stop: Halted — core0 74786204 + core1 73342662 insns in 5.5s wall = 27.0 Minsn/s; emulated 8.000s (1920000000 cycles); 550783 exceptions, 23075 interrupts
TFT: artifacts/emu/ui-refresh/run-power_demo/tft.png
serial: artifacts/emu/ui-refresh/run-power_demo/serial.log
$ EMU_SKIP_BUILD=1 tools/emu/run.sh examples/imu_poll
bundle /home/ubuntu/lume/examples/imu_poll: 1990 bytes; frame 2002 bytes
I (1752) lume-engine: engine task up (pinned core 1), PSRAM free=5786452 bytes
I (1825) lume-engine: runtime up; eval app '<home>' (5127 bytes)
I (1924) lume-engine: app eval ok; entering event loop
I (2697) lume-engine: engine recv RELOAD -> recycle runtime
I (2710) lume-engine: runtime up; eval app '<embedded-demo>' (1990 bytes)
I (2813) lume-engine: app eval ok; entering event loop
[emu] stop: Halted — core0 78805612 + core1 75405538 insns in 4.4s wall = 35.1 Minsn/s; emulated 8.000s (1920000000 cycles); 570033 exceptions, 23254 interrupts
TFT: artifacts/emu/ui-refresh/run-imu_poll/tft.png
serial: artifacts/emu/ui-refresh/run-imu_poll/serial.log
$ EMU_SKIP_BUILD=1 tools/emu/run.sh examples/heart_curve
bundle /home/ubuntu/lume/examples/heart_curve: 1795 bytes; frame 1807 bytes
I (1752) lume-engine: engine task up (pinned core 1), PSRAM free=5786452 bytes
I (1825) lume-engine: runtime up; eval app '<home>' (5127 bytes)
I (1924) lume-engine: app eval ok; entering event loop
I (2697) lume-engine: engine recv RELOAD -> recycle runtime
I (2710) lume-engine: runtime up; eval app '<embedded-demo>' (1795 bytes)
I (2813) lume-engine: app eval ok; entering event loop
[emu] stop: Halted — core0 77815054 + core1 74248202 insns in 4.4s wall = 34.4 Minsn/s; emulated 8.000s (1920000000 cycles); 548114 exceptions, 22784 interrupts
TFT: artifacts/emu/ui-refresh/run-heart_curve/tft.png
serial: artifacts/emu/ui-refresh/run-heart_curve/serial.log
$ EMU_SKIP_BUILD=1 tools/emu/run.sh examples/dashboard
bundle /home/ubuntu/lume/examples/dashboard: 6646 bytes; frame 6658 bytes
I (1752) lume-engine: engine task up (pinned core 1), PSRAM free=5786452 bytes
I (1825) lume-engine: runtime up; eval app '<home>' (5127 bytes)
I (1924) lume-engine: app eval ok; entering event loop
I (2700) lume-engine: engine recv RELOAD -> recycle runtime
I (2712) lume-engine: runtime up; eval app '<embedded-demo>' (6646 bytes)
I (2851) lume-engine: app eval ok; entering event loop
[emu] stop: Halted — core0 231488629 + core1 96871210 insns in 8.5s wall = 38.5 Minsn/s; emulated 8.000s (1920000000 cycles); 763121 exceptions, 26401 interrupts
TFT: artifacts/emu/ui-refresh/run-dashboard/tft.png
serial: artifacts/emu/ui-refresh/run-dashboard/serial.log
$ EMU_SKIP_BUILD=1 tools/emu/run.sh examples/device_monitor
bundle /home/ubuntu/lume/examples/device_monitor: 5192 bytes; frame 5204 bytes
I (1752) lume-engine: engine task up (pinned core 1), PSRAM free=5786452 bytes
I (1825) lume-engine: runtime up; eval app '<home>' (5127 bytes)
I (1924) lume-engine: app eval ok; entering event loop
I (2699) lume-engine: engine recv RELOAD -> recycle runtime
I (2711) lume-engine: runtime up; eval app '<embedded-demo>' (5192 bytes)
I (2843) lume-engine: app eval ok; entering event loop
[emu] stop: Halted — core0 87181271 + core1 85948821 insns in 4.9s wall = 35.4 Minsn/s; emulated 8.000s (1920000000 cycles); 619255 exceptions, 25902 interrupts
TFT: artifacts/emu/ui-refresh/run-device_monitor/tft.png
serial: artifacts/emu/ui-refresh/run-device_monitor/serial.log
$ EMU_SKIP_BUILD=1 tools/emu/run.sh examples/files
bundle /home/ubuntu/lume/examples/files: 12211 bytes; frame 12223 bytes
I (1752) lume-engine: engine task up (pinned core 1), PSRAM free=5786452 bytes
I (1825) lume-engine: runtime up; eval app '<home>' (5127 bytes)
I (1924) lume-engine: app eval ok; entering event loop
I (2703) lume-engine: engine recv RELOAD -> recycle runtime
I (2715) lume-engine: runtime up; eval app '<embedded-demo>' (12211 bytes)
I (2858) lume-engine: app eval ok; entering event loop
[emu] stop: Halted — core0 77712991 + core1 85083587 insns in 4.7s wall = 34.3 Minsn/s; emulated 8.000s (1920000000 cycles); 632948 exceptions, 23368 interrupts
TFT: artifacts/emu/ui-refresh/run-files/tft.png
serial: artifacts/emu/ui-refresh/run-files/serial.log
$ EMU_SKIP_BUILD=1 tools/emu/run.sh examples/file_manager
bundle /home/ubuntu/lume/examples/file_manager: 5102 bytes; frame 5114 bytes
I (1752) lume-engine: engine task up (pinned core 1), PSRAM free=5786452 bytes
I (1825) lume-engine: runtime up; eval app '<home>' (5127 bytes)
I (1924) lume-engine: app eval ok; entering event loop
I (2699) lume-engine: engine recv RELOAD -> recycle runtime
I (2711) lume-engine: runtime up; eval app '<embedded-demo>' (5102 bytes)
I (2826) lume-engine: app eval ok; entering event loop
[emu] stop: Halted — core0 86540808 + core1 78262838 insns in 4.6s wall = 35.6 Minsn/s; emulated 8.000s (1920000000 cycles); 589436 exceptions, 23595 interrupts
TFT: artifacts/emu/ui-refresh/run-file_manager/tft.png
serial: artifacts/emu/ui-refresh/run-file_manager/serial.log
$ EMU_SKIP_BUILD=1 tools/emu/run.sh examples/ai_chat
bundle /home/ubuntu/lume/examples/ai_chat: 2891 bytes; frame 2903 bytes
I (1752) lume-engine: engine task up (pinned core 1), PSRAM free=5786452 bytes
I (1825) lume-engine: runtime up; eval app '<home>' (5127 bytes)
I (1924) lume-engine: app eval ok; entering event loop
I (2698) lume-engine: engine recv RELOAD -> recycle runtime
I (2710) lume-engine: runtime up; eval app '<embedded-demo>' (2891 bytes)
I (2814) lume-engine: app eval ok; entering event loop
[emu] stop: Halted — core0 76802413 + core1 74984961 insns in 4.4s wall = 34.8 Minsn/s; emulated 8.000s (1920000000 cycles); 561060 exceptions, 23058 interrupts
TFT: artifacts/emu/ui-refresh/run-ai_chat/tft.png
serial: artifacts/emu/ui-refresh/run-ai_chat/serial.log
$ EMU_SKIP_BUILD=1 tools/emu/run.sh examples/music_player
bundle /home/ubuntu/lume/examples/music_player: 8433 bytes; frame 8445 bytes
I (1752) lume-engine: engine task up (pinned core 1), PSRAM free=5786452 bytes
I (1825) lume-engine: runtime up; eval app '<home>' (5127 bytes)
I (1924) lume-engine: app eval ok; entering event loop
I (2701) lume-engine: engine recv RELOAD -> recycle runtime
I (2713) lume-engine: runtime up; eval app '<embedded-demo>' (8433 bytes)
I (3022) lume-engine: app eval ok; entering event loop
[emu] stop: Halted — core0 88367711 + core1 115716915 insns in 6.9s wall = 29.4 Minsn/s; emulated 8.000s (1920000000 cycles); 680495 exceptions, 25482 interrupts
TFT: artifacts/emu/ui-refresh/run-music_player/tft.png
serial: artifacts/emu/ui-refresh/run-music_player/serial.log
```

The per-run emulator output directories were removed after their PNGs were copied to the flat `ui-refresh` directory; the raw command output above preserves the reload result and source output paths.
