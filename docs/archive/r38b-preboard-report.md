# r38b 接板前补强实施记录

基线 `5f02692`；开工执行 `git fetch origin && git status --short`，工作区为空。git 身份 `congduan <congduan@users.noreply.github.com>`。本轮不推送。

## A Canvas 连续线段合批

`onDraw` 内连续 `line`/`polyline` 自动按 32 段合批，遇到其他 Canvas 命令或绘制结束即 flush。消息头仍是固定拷贝；线段负载为 PSRAM owned payload，post 失败由 engine 释放，成功后由 LVGL drain 释放。保留线段顺序；长度和坐标在 JS/native 两层约束。桥接 ABI 新增 `LUME_OP_CANVAS_BATCH = 11`。

目标 Xtensa ABI：原记录 116 B，新记录仍 116 B，单线段 16 B。240 点折线有 239 段，从 239 条消息降到 8 条（32×7+15）；队列复制量从 `239×116 = 27,724 B` 降到 `8×116 = 928 B`。另有 `239×16 = 3,824 B` PSRAM payload，经队列只复制指针。含 payload 的合计写入量为 4,752 B；不计 JS 数组和分配器元数据。33 段拆成 32+1 的 harness 通过。

## B 录音 ArrayBuffer 移交

vendored QuickJS-NG 的 `JS_NewArrayBuffer(ctx, buf, len, max_len, realloc_func, opaque, is_shared)` 接受外部数据。其 finalizer 与 detach 对 `realloc_func(ptr, 0)` 调用一次；构造失败路径在所有权字段赋值前返回。录音成功后移交 PSRAM PCM，失败时由 C 释放。宿主 QuickJS 测试验证 640,000 B 原始字节无变化、finalizer 和 detach 各只释放一次。音频驱动本身需要真机，宿主测试没有模拟麦克风。

10 秒 16 kHz 双声道 16-bit PCM = 640,000 B：旧实现录音块 640,000 B + ArrayBuffer 拷贝 640,000 B，峰值约 1,280,000 B；新实现单块约 640,000 B，省约 640,000 B（均不含运行时元数据和其他音频缓冲）。

## C 音乐播放器

ID3v2.3/v2.4 提取 TIT2/TPE1/TALB；Latin-1、UTF-16 LE/BE BOM、UTF-8 转成播放器使用的 UTF-8，处理常见 unsynchronisation。没有 v2 标签时退到 ID3v1/文件名。曲库扫描 `/music` 至四层、最多 256 首，按 ID3 标题或文件名排序，库页每页四首，上一首/下一首沿排序结果。

歌词窗口显示当前行上下各两行，当前行高亮；无 LRC 显示「未找到歌词」。±0.5 秒按钮调整偏移。由于 NVS key 限制 15 字符，无法直接使用 `lrc.offset.<file>`，实际以 `lrc.offsets` 存文件到偏移的 JSON 映射。`music.last` 每五秒存文件和位置；重启恢复上次曲目，从头播放。按帧跳到记录位置需要逐帧解码，长曲可能拖慢启动，留待接板评估。逐字歌词和 APIC 封面未实现。

## 固件大小与构建（原始输出）

`idf.py build && idf.py size`，使用 docs/build.md 的 IDF 5.5 Python 环境。r37b bin `0x297830`，本轮 `0x2985c0`，增 `0xD80 = 3,456 B`。IRAM `16,384 B`，没有越过硬红线。

```text
lume.bin binary size 0x2985c0 bytes. Smallest app partition is 0x640000 bytes. 0x3a7a40 bytes (58%) free.
Project build complete. To flash, run:
                           Memory Type Usage Summary
┏━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━┳━━━━━━━━━━┳━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━┓
┃ Memory            ┃              ┃          ┃                ┃               ┃
┃ Type/Section      ┃ Used [bytes] ┃ Used [%] ┃ Remain [bytes] ┃ Total [bytes] ┃
┡━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━╇━━━━━━━━━━╇━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━┩
│ Flash Code        │      1744550 │          │                │               │
│    .text          │      1744550 │          │                │               │
│ Flash Data        │       828288 │          │                │               │
│    .rodata        │       828032 │          │                │               │
│    .appdesc       │          256 │          │                │               │
│ DIRAM             │       230239 │    67.37 │         111521 │        341760 │
│    .text          │       107915 │    31.58 │                │               │
│    .bss           │        98496 │    28.82 │                │               │
│    .data          │        23828 │     6.97 │                │               │
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
Total image size: 2721085 bytes (.bin may be padded larger)
Note: The reported total sizes may be smaller than those in the technical
reference manual due to reserved memory and application configuration. The total
flash size available for the application is not included by default, as it
cannot be reliably determined due to the presence of other data like the
bootloader, partition table, and application partition size.
Built target size
```

## 专项 harness（原始输出）

```text
cc -Wall -Wextra -Ifirmware/components/mp3_decoder/include tests/id3v2.c firmware/components/mp3_decoder/id3v2.c -o /tmp/lume-id3v2-test && /tmp/lume-id3v2-test
ID3v2.3 encoding: title=Hi artist=Béat album=Album PASS
ID3v2.4 encoding: title=BE artist=Béat album=Album PASS
ID3v2.4 encoding: title=Café artist=Béat album=Album PASS
ID3v2.3 unsync: title=Fÿx artist=Béat album=Album PASS
/tmp/lume-record-test
Record backing: 640000 bytes intact, finalizer and detach release once PASS
cc -Ifirmware/components/lume-ui-bridge/include -c tests/bridge_protocol.c -o /tmp/lume-bridge-protocol-host.o
bridge_protocol host static assertions: PASS
xtensa-esp32s3-elf-gcc -Ifirmware/components/lume-ui-bridge/include -c tests/bridge_protocol.c -o /tmp/lume-bridge-protocol.o
bridge_protocol target static assertions: PASS
xtensa-esp32s3-elf-nm -S /tmp/lume-size-target.o
00000074 00000010 B lume_line_size
00000000 00000074 B lume_record_size
```

QuickJS host test was linked against the vendored `quickjs.c`, `libregexp.c`, `libunicode.c`, `dtoa.c` object files built with the host C compiler.

## 回归原始输出

### 21 个 JS host harness（`for f in tests/*.js; do node "$f" || exit 1; done`）

```text
request construction + key storage: PASS
HTTP error + timeout + bad JSON + truncation: PASS
Node local POST round trip: PASS
PASS initial transition value uses SET_ATTR
PASS transition signal.set emits ANIMATE with omitted from and ease-out
PASS ANIMATE_CANCEL path
PASS onComplete registered and dispatched through reverse event hook
PASS same-property replacement discards old completion
PASS color animation rejected
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
PASS lume.ble wiring (header, CMake, sdkconfig, natives, types, docs)
PASS onStart advertises; first poll of a live link sends HELLO
PASS poll drains one RX packet, verifies the link and acks it
PASS Ping Button press sends a ping
PASS Ping counter Text reflects the press
PASS negative read() status is handled by the app
PASS onPause / shutdown stops advertising
PASS failed start() is surfaced without starting the poll timer
PASS canvas create dimensions and fixed wire kind
PASS drawing command order and final invalidate
PASS optional dirty rectangles preserve local coordinates
PASS signal change redraws once; equal value stays idle
PASS canvas is adopted into flex layout flow at fixed size
PASS dimensions/coordinates/color/text/point bounds reject
PASS injected 390x390 screen governs canvas size, budget and draw bounds
PASS embedded demo equals counter example message sequence
SAMPLE messages (first 12): [["create",1,0],["attr",1,12,12],["attr",1,0,"taps: 0"],["create",0,0],["attr",2,1,2377581],["attr",2,16,100],["attr",2,3,120],["attr",2,7,1],["attr",2,8,2],["attr",2,9,2],["attr",2,11,6],["attr",2,12,12]]
SAMPLE totals: {"create":7,"attr":42,"press":3}
PASS 33 contiguous lines split at 32
CANVAS 240 points: old=239 messages / 27724 queue bytes; new=8 messages / 928 queue bytes + 3824 payload bytes
PASS 240-point polyline uses eight batches
PASS: create-failed notice disposes signal effects and warns once
PASS: Canvas failure latches dead id and native attrs become no-op
PASS files before: DEL -> status confirmation -> DEL -> remove
PASS files after: DEL -> Dialog -> Delete -> remove -> Toast
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
PASS: DOWN MOVE UP retain FIFO order
PASS: MOVE pressure reserves capacity and UP reaches queue tail
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
PASS Image create/source/size message order
PASS Image participates in View flex child adoption
PASS Image preserves aspect ratio for one explicit dimension
PASS Image propagates decoder error and removes failed node
PASS Image rejects invalid input and propagates header error
PASS embedded PNG 1x1 decodes to exact opaque red RGBA bytes
PASS imu_ball gravity accelerates and displaces
PASS imu_ball wall reflects normal velocity with restitution
PASS imu_ball hole event
PASS imu_ball goal requires entire ball inside
PASS imu_ball boundary clamps and reflects
PASS imu_ball dt cap limits delayed tick
PASS imu_ball resting contact has no sound impact
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
LRC normal: PASS
LRC skip untimed: PASS
LRC sort: PASS
LRC bad GBK bytes: PASS
Scheduler: ticks=7 decoded=5 sent=4 retry=2 PASS
Scheduler: stop and negative-index wrap PASS
Lyrics: five-line window and missing LRC PASS
Library: recursive scan, ID3 title order, last track and offset KV PASS
Restart: last track and LRC offset restored, playback starts at zero PASS
PASS wake registration, unregister, and success-only dispatch
PASS touch feeds idle timer and wake resets activity
PASS shutdown clears wake callbacks
PASS: A post failure frees only A; B posts latest frame with pending set
PASS: successful post coalesces replacement and preserves latest frame
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
PASS 17 shell component cases
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
PASS embedded demo matches examples/counter/app.js messages
PASS: 240-byte Chinese and 256-byte ASCII text accepted; 257 bytes rejected
PASS: external text payload has sender rollback and receiver release paths
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

### CLI 17 项（`npm test --prefix tools/lume`）

```text

> @lume/cli@0.1.0 test
> node --test

TAP version 13
# Subtest: frame bytes match firmware wire layout and CRC-32
ok 1 - frame bytes match firmware wire layout and CRC-32
  ---
  duration_ms: 14.641587
  type: 'test'
  ...
# Subtest: create writes complete offline scaffold and bundles with prelude globals
ok 2 - create writes complete offline scaffold and bundles with prelude globals
  ---
  duration_ms: 78.778124
  type: 'test'
  ...
# Subtest: esbuild iife runs in global-script host; esm syntax does not
ok 3 - esbuild iife runs in global-script host; esm syntax does not
  ---
  duration_ms: 13.005375
  type: 'test'
  ...
# Subtest: bundle rejects oversize output before opening serial
ok 4 - bundle rejects oversize output before opening serial
  ---
  duration_ms: 25.920629
  type: 'test'
  ...
# Subtest: OTA auth preamble + default port match the firmware wire format
ok 5 - OTA auth preamble + default port match the firmware wire format
  ---
  duration_ms: 0.509727
  type: 'test'
  ...
# Subtest: OTA push reuses the USB frame() bytes (right-token path)
ok 6 - OTA push reuses the USB frame() bytes (right-token path)
  ---
  duration_ms: 19.837458
  type: 'test'
  ...
# Subtest: OTA wrong token is rejected (AUTH ERR path)
ok 7 - OTA wrong token is rejected (AUTH ERR path)
  ---
  duration_ms: 7.405865
  type: 'test'
  ...
# Subtest: OTA screenshot round trips the RGB565 frame past log noise
ok 8 - OTA screenshot round trips the RGB565 frame past log noise
  ---
  duration_ms: 47.885111
  type: 'test'
  ...
# Subtest: decodeShot rejects a corrupted payload and a CRC mismatch
ok 9 - decodeShot rejects a corrupted payload and a CRC mismatch
  ---
  duration_ms: 3.310184
  type: 'test'
  ...
# Subtest: bmpFromRgb565 produces a valid bottom-up 24-bit BMP
ok 10 - bmpFromRgb565 produces a valid bottom-up 24-bit BMP
  ---
  duration_ms: 3.184611
  type: 'test'
  ...
# Subtest: OTA RELOAD ERR is surfaced as a push error
ok 11 - OTA RELOAD ERR is surfaced as a push error
  ---
  duration_ms: 20.477793
  type: 'test'
  ...
# Subtest: command frame uses LUMC magic, same header and CRC as app frames
ok 12 - command frame uses LUMC magic, same header and CRC as app frames
  ---
  duration_ms: 0.540134
  type: 'test'
  ...
# Subtest: STORE payload layout: verb, id, one-line meta, then raw source
ok 13 - STORE payload layout: verb, id, one-line meta, then raw source
  ---
  duration_ms: 0.469941
  type: 'test'
  ...
# Subtest: OTA command round trip: STORE + LIST + LAUNCH ACKs
ok 14 - OTA command round trip: STORE + LIST + LAUNCH ACKs
  ---
  duration_ms: 25.062979
  type: 'test'
  ...
# Subtest: CLI apps usage, sub-command and id validation
ok 15 - CLI apps usage, sub-command and id validation
  ---
  duration_ms: 1227.225841
  type: 'test'
  ...
# Subtest: OTA no-board path: connection refused is a clear error
ok 16 - OTA no-board path: connection refused is a clear error
  ---
  duration_ms: 6.679422
  type: 'test'
  ...
# Subtest: CLI --ota usage, arg validation and no-board error output
ok 17 - CLI --ota usage, arg validation and no-board error output
  ---
  duration_ms: 808.12884
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
# duration_ms 2679.83656
```

### 播放器模拟器（`PLAYWRIGHT_MODULE=/tmp/lume-playwright/node_modules/playwright node tools/simulator/verify_music_player.js`）

```text
PASS library screenshot=artifacts/simulator/MusicLibrary.png
PASS playing lyrics screenshot=artifacts/simulator/MusicPlaying.png
```

## 文档与未验收项

```text
python3 scripts/gen_api_docs.py --check
api.html is up to date with lume.d.ts (108 entries)
python3 scripts/check_website.py
HTML pages: 6; internal href/src and anchors checked
API: 108 catalog entries, 108 type declarations, 24 function namespaces
API missing: none
API invented: none
API duplicates: none
API signatures not found in lume.d.ts: none
```

真机音频、歌词同步/观感、TF 子目录可靠性、NVS 持久化、FPS、队列水位与录音峰值均未验证。D Gauge/Toggle 属可选项，本轮未实施。已将简化项与接板验收记录到 `docs/KNOWN-SIMPLIFICATIONS.md`。
