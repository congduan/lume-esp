# r34 实施与验证报告

基线 `0cd9c980ec5bf82e5fb3233dc5858e624148ae6f`。未推送；无真机验收。

## 变更与提交

1. `c84f299`：重载 staging 与事件投递在同一互斥区内完成；失败仅释放本调用仍持有的 buffer。
2. `d7270aa`：手势事件统一 FIFO；MOVE 在剩余 4 槽时丢弃，DOWN/UP/SWIPEDIR 等待队列可写。
3. `e6a69cd`：UI 文本上限 256 UTF-8 字节。0–63 字节内联；64–256 字节由 Queue A 持有独立 PSRAM payload，消费或丢弃后释放；投递失败由发送者释放。队列 384 条、每条不超过 128B，避免内联扩容额外约 74KiB。更新 ABI、类型与协议说明。
4. `7b6b214`：LVGL 创建失败经无丢失位图通知 engine；失败 id 在本 runtime 内保留并标记 dead。JS effect 被清理，后续 native 属性/绘制等调用 no-op，`lume.warn` 发一条 `ESP_LOGW`。
5. `0ccf841`、`6175c8a`、`74dda14`：并发 harness 追踪活分配并用原子屏障固定 A/B 交错，明确断言 A 失败后 B 仍能成功投递。
6. `2f1878f`：Queue A 接收端校验显式文本长度并终止载荷。

审计快照与基线代码描述一致。首次全测出现了本轮新增 harness 的误报：测试把 malloc 已释放地址的合法复用当成双重释放；上述测试提交修正后全绿。真机重载压力、手势手感、低 PSRAM 注入、长中文标签上屏留主控接板轮。

## 体积

同一 IDF 环境实测：基线 `Total image size: 2219049 bytes`，r34 `2220217 bytes`，增加 **1168 bytes**；bin 尺寸从 `0x21dca0` 到 `0x21e130`，同样增加 1168 bytes。DIRAM 增加 272 bytes，IRAM 不变。未超过 30 KiB 阈值。独立基线构建的 size 原始输出在本文末尾。

## 全部 host harness

执行要求的 `for t in tests/*.js; do node "$t" || echo "FAIL: $t"; done`；以下为带文件名复跑的原始输出，未出现 `FAIL:`。

```text

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
PASS onStart starts advertising and renders status
PASS interval poll drains one RX packet and echoes it
PASS Button press sends a ping and updates the counter
PASS negative read() status is handled by the app
PASS onPause / shutdown stops advertising
PASS failed start() is surfaced without starting the poll timer

$ node tests/canvas_mapping.js
PASS canvas create dimensions and fixed wire kind
PASS drawing command order and final invalidate
PASS signal change redraws once; equal value stays idle
PASS canvas is adopted into flex layout flow at fixed size
PASS dimensions/coordinates/color/text/point bounds reject
PASS injected 390x390 screen governs canvas size, budget and draw bounds
PASS embedded demo equals counter example message sequence
SAMPLE messages (first 12): [["create",1,0],["attr",1,12,12],["attr",1,0,"taps: 0"],["create",0,0],["attr",2,1,2377581],["attr",2,16,100],["attr",2,3,120],["attr",2,7,1],["attr",2,8,2],["attr",2,9,2],["attr",2,11,6],["attr",2,12,12]]
SAMPLE totals: {"create":7,"attr":42,"press":3}

$ node tests/create_failure.js
PASS: create-failed notice disposes signal effects and warns once
PASS: Canvas failure latches dead id and native attrs become no-op

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
EVIDENCE files seedTestEntries(): 1000 entries, 40 new nodes
PASS files example seeds 1000 entries without creating 1000 rows
PASS 10 list virtualization cases

$ node tests/power.js
PASS wake registration, unregister, and success-only dispatch
PASS touch feeds idle timer and wake resets activity
PASS shutdown clears wake callbacks

$ node tests/reload_staging.js
PASS: A post failure frees only A; B posts latest frame with pending set
PASS: successful post coalesces replacement and preserves latest frame

$ node tests/shell_components.js
PASS shell StatusBar getter follows signal
PASS shell StatusBar clock timer and disposal
PASS shell EdgeNavigation true handles back
PASS shell EdgeNavigation false forwards page swipe
PASS shell indicator draws and rebounds, mask toggles
PASS shell Launcher creates bounded virtual grid
PASS shell app press and edge gesture route independently
PASS shell dispose unregisters gestures and app close clears resources
PASS 8 shell component cases

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
PASS invalid percentage/metric/color/opacity rejected in prelude
PASS all style mapping cases
PASS embedded demo matches examples/counter/app.js messages

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

## 新增 harness 单独运行

```text
$ node tests/reload_staging.js
PASS: A post failure frees only A; B posts latest frame with pending set
PASS: successful post coalesces replacement and preserves latest frame
$ node tests/gesture_queue.js
PASS: DOWN MOVE UP retain FIFO order
PASS: MOVE pressure reserves capacity and UP reaches queue tail
$ node tests/text_payload.js
PASS: 240-byte Chinese and 256-byte ASCII text accepted; 257 bytes rejected
PASS: external text payload has sender rollback and receiver release paths
$ node tests/create_failure.js
PASS: create-failed notice disposes signal effects and warns once
PASS: Canvas failure latches dead id and native attrs become no-op
```

## CLI 单测

```text

> @lume/cli@0.1.0 test
> node --test

TAP version 13
# Subtest: frame bytes match firmware wire layout and CRC-32
ok 1 - frame bytes match firmware wire layout and CRC-32
  ---
  duration_ms: 22.480111
  type: 'test'
  ...
# Subtest: create writes complete offline scaffold and bundles with prelude globals
ok 2 - create writes complete offline scaffold and bundles with prelude globals
  ---
  duration_ms: 206.907294
  type: 'test'
  ...
# Subtest: esbuild iife runs in global-script host; esm syntax does not
ok 3 - esbuild iife runs in global-script host; esm syntax does not
  ---
  duration_ms: 20.996832
  type: 'test'
  ...
# Subtest: bundle rejects oversize output before opening serial
ok 4 - bundle rejects oversize output before opening serial
  ---
  duration_ms: 76.044505
  type: 'test'
  ...
# Subtest: OTA auth preamble + default port match the firmware wire format
ok 5 - OTA auth preamble + default port match the firmware wire format
  ---
  duration_ms: 0.735546
  type: 'test'
  ...
# Subtest: OTA push reuses the USB frame() bytes (right-token path)
ok 6 - OTA push reuses the USB frame() bytes (right-token path)
  ---
  duration_ms: 91.363984
  type: 'test'
  ...
# Subtest: OTA wrong token is rejected (AUTH ERR path)
ok 7 - OTA wrong token is rejected (AUTH ERR path)
  ---
  duration_ms: 36.357839
  type: 'test'
  ...
# Subtest: OTA RELOAD ERR is surfaced as a push error
ok 8 - OTA RELOAD ERR is surfaced as a push error
  ---
  duration_ms: 24.159428
  type: 'test'
  ...
# Subtest: command frame uses LUMC magic, same header and CRC as app frames
ok 9 - command frame uses LUMC magic, same header and CRC as app frames
  ---
  duration_ms: 1.317613
  type: 'test'
  ...
# Subtest: STORE payload layout: verb, id, one-line meta, then raw source
ok 10 - STORE payload layout: verb, id, one-line meta, then raw source
  ---
  duration_ms: 3.586663
  type: 'test'
  ...
# Subtest: OTA command round trip: STORE + LIST + LAUNCH ACKs
ok 11 - OTA command round trip: STORE + LIST + LAUNCH ACKs
  ---
  duration_ms: 40.850385
  type: 'test'
  ...
# Subtest: CLI apps usage, sub-command and id validation
ok 12 - CLI apps usage, sub-command and id validation
  ---
  duration_ms: 3517.361132
  type: 'test'
  ...
# Subtest: OTA no-board path: connection refused is a clear error
ok 13 - OTA no-board path: connection refused is a clear error
  ---
  duration_ms: 16.437419
  type: 'test'
  ...
# Subtest: CLI --ota usage, arg validation and no-board error output
ok 14 - CLI --ota usage, arg validation and no-board error output
  ---
  duration_ms: 2157.137085
  type: 'test'
  ...
1..14
# tests 14
# suites 0
# pass 14
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 7027.320674
```

## 固件构建末尾

执行 `cd /opt/esp/esp-idf && env -u VIRTUAL_ENV IDF_PYTHON_ENV_PATH=/home/ubuntu/.espressif/python_env/idf5.5_py3.12_env bash -c '. ./export.sh >/dev/null 2>&1; cd /home/ubuntu/lume/firmware && idf.py build && idf.py size'`。

```text
[100%] Built target lume.elf
[100%] Generating binary image from built executable
esptool.py v4.13.0
Creating esp32s3 image...
Merged 3 ELF sections
Successfully created esp32s3 image.
Generated /home/ubuntu/lume/firmware/build/lume.bin
[100%] Built target gen_project_binary
lume.bin binary size 0x21e130 bytes. Smallest app partition is 0x640000 bytes. 0x421ed0 bytes (66%) free.
[100%] Built target app_check_size
[100%] Built target app
Running make in directory /home/ubuntu/lume/firmware/build
Executing "make -j 4 size"...
```

## `idf.py size` 完整原始输出

```text
                           Memory Type Usage Summary                            
┏━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━┳━━━━━━━━━━┳━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━┓
┃ Memory            ┃              ┃          ┃                ┃               ┃
┃ Type/Section      ┃ Used [bytes] ┃ Used [%] ┃ Remain [bytes] ┃ Total [bytes] ┃
┡━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━╇━━━━━━━━━━╇━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━┩
│ Flash Code        │      1677134 │          │                │               │
│    .text          │      1677134 │          │                │               │
│ Flash Data        │       395084 │          │                │               │
│    .rodata        │       394828 │          │                │               │
│    .appdesc       │          256 │          │                │               │
│ DIRAM             │       229823 │    67.25 │         111937 │        341760 │
│    .text          │       107687 │    31.51 │                │               │
│    .bss           │        98328 │    28.77 │                │               │
│    .data          │        23808 │     6.97 │                │               │
│ IRAM              │        16384 │    100.0 │              0 │         16384 │
│    .text          │        15356 │    93.73 │                │               │
│    .vectors       │         1028 │     6.27 │                │               │
│ RTC FAST          │          112 │     1.37 │           8080 │          8192 │
│    .text          │           84 │     1.03 │                │               │
│    .rtc_reserved  │           24 │     0.29 │                │               │
│    .force_fast    │            4 │     0.05 │                │               │
│ RTC SLOW          │           32 │     0.39 │           8160 │          8192 │
│    .force_slow    │           32 │     0.39 │                │               │
└───────────────────┴──────────────┴──────────┴────────────────┴───────────────┘
Total image size: 2220217 bytes (.bin may be padded larger)
Note: The reported total sizes may be smaller than those in the technical 
reference manual due to reserved memory and application configuration. The total
flash size available for the application is not included by default, as it 
cannot be reliably determined due to the presence of other data like the 
bootloader, partition table, and application partition size.
Built target size
```

## 基线 `idf.py size` 完整原始输出

```text
                           Memory Type Usage Summary                            
┏━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━┳━━━━━━━━━━┳━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━┓
┃ Memory            ┃              ┃          ┃                ┃               ┃
┃ Type/Section      ┃ Used [bytes] ┃ Used [%] ┃ Remain [bytes] ┃ Total [bytes] ┃
┡━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━╇━━━━━━━━━━╇━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━┩
│ Flash Code        │      1676174 │          │                │               │
│    .text          │      1676174 │          │                │               │
│ Flash Data        │       394876 │          │                │               │
│    .rodata        │       394620 │          │                │               │
│    .appdesc       │          256 │          │                │               │
│ DIRAM             │       229551 │    67.17 │         112209 │        341760 │
│    .text          │       107687 │    31.51 │                │               │
│    .bss           │        98056 │    28.69 │                │               │
│    .data          │        23808 │     6.97 │                │               │
│ IRAM              │        16384 │    100.0 │              0 │         16384 │
│    .text          │        15356 │    93.73 │                │               │
│    .vectors       │         1028 │     6.27 │                │               │
│ RTC FAST          │          112 │     1.37 │           8080 │          8192 │
│    .text          │           84 │     1.03 │                │               │
│    .rtc_reserved  │           24 │     0.29 │                │               │
│    .force_fast    │            4 │     0.05 │                │               │
│ RTC SLOW          │           32 │     0.39 │           8160 │          8192 │
│    .force_slow    │           32 │     0.39 │                │               │
└───────────────────┴──────────────┴──────────┴────────────────┴───────────────┘
Total image size: 2219049 bytes (.bin may be padded larger)
Note: The reported total sizes may be smaller than those in the technical 
reference manual due to reserved memory and application configuration. The total
flash size available for the application is not included by default, as it 
cannot be reliably determined due to the presence of other data like the 
bootloader, partition table, and application partition size.
Built target size
```
