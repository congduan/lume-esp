# r36b 性能快赢实施记录

基线：`bca1e29`；工作区开工前 `git fetch origin && git status --short` 为空。构建机无 `/dev/ttyACM*` 或 `/dev/ttyUSB*`，本报告没有真机 FPS、功耗、触摸延迟或实测 A/B 数据。

## 实施与测量口径

- `CONFIG_LUME_PERF_PROFILE` 默认关闭。开启时每秒打印有实际刷新的帧数、flush 回调数、提交的 panel IO 参数/颜色 API 调用数、PSRAM 最大连续块、空闲和最低空闲水位，以及 DMA 内存最大连续块、最低空闲水位、LVGL/engine 栈最低余量、QuickJS `memory_used_size`，并对 render、flush、drain、JS eval、GC 打印样本数、均值、最大耗时（微秒）。render 是 LVGL 的 `RENDER_START`→`RENDER_READY`；flush 是回调开始→`tx_color` 提交完成，**不含异步 DMA 完成时间**。后者需接板另测；`tx` 是 panel IO API 调用计数，不直接等于底层 SPI 物理事务数。GC 在 QuickJS `JS_RunGC` 入口/出口测量。统计是每秒近似快照，跨秒边界的并发事件可落入相邻窗口。
- `CONFIG_LUME_DRAW_BUF_LINES` 可设 20 或 48。48 行双缓冲各 46,080 B，共 92,160 B；分配前检查最大 DMA 连续块，两个内部 DMA SRAM 分配有任一失败则释放并告警、重试双 20 行。20 行配置的两个分配失败则返回 `ESP_ERR_NO_MEM`，不再静默退到 PSRAM。最终默认仍为 20 行，因为缺少板上可用连续块和 FPS 数据。
- `CONFIG_LUME_REFRESH_PERIOD_MS` 可设 33、15、10；用 vendored LVGL 9.3 `lv_timer_handler()` 返回的下次到期毫秒数睡眠，限制在 1–10 ms 以响应跨任务失效。`lv_display_get_refr_timer` 与 `lv_timer_set_period` 均为 vendored API。最终默认仍为 33 ms，接板后比较 15/10 ms。
- Canvas `onDraw` 可返回一个 `{x,y,w,h}` 或最多八个矩形。缺省返回仍使整个 Canvas 失效；桥接使用 Canvas 本地坐标换算成屏幕坐标，再裁到对象边界。Snake 提交 14×14 格子；Breakout 提交球/挡板旧与新矩形。首帧仍全量失效。该初级实现没有跨消息的脏区合并或帧事务保证。

## A/B 表：静态推演，待接板填实测列

| 配置 | 全屏最少 flush | 全屏最少 panel IO 调用 | 双 DMA SRAM | 空载定时上限 | 实测 FPS/耗时 |
|---|---:|---:|---:|---:|---|
| 20 行、33 ms | 24 | 72 | 38,400 B | 30.3/s | 无板，待测 |
| 48 行、15 ms | 10 | 30 | 92,160 B | 66.7/s | 无板，待测 |
| 48 行、10 ms | 10 | 30 | 92,160 B | 100/s | 无板，待测 |

48 行相对 20 行理论少 14 次 flush 和 42 次 panel IO 调用（58.3%），多占 53,760 B 内部 SRAM。满屏 40 MHz QSPI 净像素传输下限仍为 23.04 ms，不能把定时上限当成实测帧率。

### Canvas 传输面积静态推演

| 场景 | 原整块 RGB565 | 新脏区 RGB565 上界 | 理论缩减 |
|---|---:|---:|---:|
| Snake 常态 2 格，按偶/奇坐标向外扩至每格最多 16×16 | 294,912 B | 1,024 B | 99.65% |
| Snake 吃食物 3 格 | 294,912 B | 1,536 B | 99.48% |
| Breakout 常态：旧球 14×14、新球 10×10、旧挡板 72×12、新挡板 72×10；每维最多扩 2 像素 | 268,800 B | 4,648 B | 98.27% |

以上为四块互不合并时的保守像素上界；窗口命令、LVGL 合并、其他对象失效和面板传输耗时未算入。真实传输面积须从板上 flush 区域日志核实。

## 验证与未完成的板上验收

- 已运行所有 20 个 `tests/*.js` harness（超过简报所述 12 个），以及 CLI 17 个单测；原始输出见下方。
- 固件使用简报指定的 `env -u VIRTUAL_ENV` 与 Python 3.12 环境构建。48/15 试验配置构建成功；最终 20/33 构建结果与 `idf.py size` 见下方。IRAM 硬线为 16,384 B。
- 因无串口设备，无法开 profile 跑 counter 数秒，也无法贴真实每秒摘要或实测 20/48、15/10 比较。接板时在 `idf.py menuconfig` 的 `Lume performance experiments` 中逐档设置并开启 profile；相同画面/亮度运行 counter、Snake、Breakout，各档至少 60 s，采集 `lume-perf` 原始日志、触摸响应与功耗。示例字段名见源码 `lume_perf.c`；此处不伪造样例值。

### 构建与大小原始输出

```text
$ git fetch origin && git status --short && git log -1 --oneline
bca1e29 docs: add r35b performance audit report
$ ls /dev/ttyACM* /dev/ttyUSB*
No /dev/ttyACM* or /dev/ttyUSB* device
$ idf.py build   # 48 lines / 15 ms, profile off
Generated /home/ubuntu/lume/firmware/build/lume.bin
[100%] Built target gen_project_binary
lume.bin binary size 0x2858b0 bytes. Smallest app partition is 0x640000 bytes. 0x3ba750 bytes (60%) free.
[100%] Built target app_check_size
[100%] Built target app

Project build complete. To flash, run:
 idf.py flash
or
 idf.py -p PORT flash
or
 python -m esptool --chip esp32s3 -b 460800 --before default_reset --after hard_reset write_flash --flash_mode dio --flash_size 16MB --flash_freq 80m 0x0 build/bootloader/bootloader.bin 0x8000 build/partition_table/partition-table.bin 0x10000 build/lume.bin
or from the "/home/ubuntu/lume/firmware/build" directory
 python -m esptool --chip esp32s3 -b 460800 --before default_reset --after hard_reset write_flash "@flash_args"
$ idf.py size    # 48 lines / 15 ms
┏━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━┳━━━━━━━━━━┳━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━┓
┃ Memory            ┃              ┃          ┃                ┃               ┃
┃ Type/Section      ┃ Used [bytes] ┃ Used [%] ┃ Remain [bytes] ┃ Total [bytes] ┃
┡━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━╇━━━━━━━━━━╇━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━┩
│ Flash Code        │      1687486 │          │                │               │
│    .text          │      1687486 │          │                │               │
│ Flash Data        │       808536 │          │                │               │
│    .rodata        │       808280 │          │                │               │
│    .appdesc       │          256 │          │                │               │
│ DIRAM             │       229863 │    67.26 │         111897 │        341760 │
│    .text          │       107687 │    31.51 │                │               │
│    .bss           │        98368 │    28.78 │                │               │
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
Total image size: 2644021 bytes (.bin may be padded larger)
Note: The reported total sizes may be smaller than those in the technical
reference manual due to reserved memory and application configuration. The total
flash size available for the application is not included by default, as it
cannot be reliably determined due to the presence of other data like the
bootloader, partition table, and application partition size.
Built target size
```

### JS harness 原始输出

```text
$ for f in tests/*.js; do node "$f" || exit 1; done
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

### CLI 单测原始输出

```text
$ npm test --prefix tools/lume

> @lume/cli@0.1.0 test
> node --test

TAP version 13
# Subtest: frame bytes match firmware wire layout and CRC-32
ok 1 - frame bytes match firmware wire layout and CRC-32
  ---
  duration_ms: 5.686725
  type: 'test'
  ...
# Subtest: create writes complete offline scaffold and bundles with prelude globals
ok 2 - create writes complete offline scaffold and bundles with prelude globals
  ---
  duration_ms: 90.553002
  type: 'test'
  ...
# Subtest: esbuild iife runs in global-script host; esm syntax does not
ok 3 - esbuild iife runs in global-script host; esm syntax does not
  ---
  duration_ms: 18.524951
  type: 'test'
  ...
# Subtest: bundle rejects oversize output before opening serial
ok 4 - bundle rejects oversize output before opening serial
  ---
  duration_ms: 59.887542
  type: 'test'
  ...
# Subtest: OTA auth preamble + default port match the firmware wire format
ok 5 - OTA auth preamble + default port match the firmware wire format
  ---
  duration_ms: 0.601394
  type: 'test'
  ...
# Subtest: OTA push reuses the USB frame() bytes (right-token path)
ok 6 - OTA push reuses the USB frame() bytes (right-token path)
  ---
  duration_ms: 44.860749
  type: 'test'
  ...
# Subtest: OTA wrong token is rejected (AUTH ERR path)
ok 7 - OTA wrong token is rejected (AUTH ERR path)
  ---
  duration_ms: 23.667111
  type: 'test'
  ...
# Subtest: OTA screenshot round trips the RGB565 frame past log noise
ok 8 - OTA screenshot round trips the RGB565 frame past log noise
  ---
  duration_ms: 57.962237
  type: 'test'
  ...
# Subtest: decodeShot rejects a corrupted payload and a CRC mismatch
ok 9 - decodeShot rejects a corrupted payload and a CRC mismatch
  ---
  duration_ms: 5.504617
  type: 'test'
  ...
# Subtest: bmpFromRgb565 produces a valid bottom-up 24-bit BMP
ok 10 - bmpFromRgb565 produces a valid bottom-up 24-bit BMP
  ---
  duration_ms: 5.249463
  type: 'test'
  ...
# Subtest: OTA RELOAD ERR is surfaced as a push error
ok 11 - OTA RELOAD ERR is surfaced as a push error
  ---
  duration_ms: 31.805279
  type: 'test'
  ...
# Subtest: command frame uses LUMC magic, same header and CRC as app frames
ok 12 - command frame uses LUMC magic, same header and CRC as app frames
  ---
  duration_ms: 3.017209
  type: 'test'
  ...
# Subtest: STORE payload layout: verb, id, one-line meta, then raw source
ok 13 - STORE payload layout: verb, id, one-line meta, then raw source
  ---
  duration_ms: 0.56744
  type: 'test'
  ...
# Subtest: OTA command round trip: STORE + LIST + LAUNCH ACKs
ok 14 - OTA command round trip: STORE + LIST + LAUNCH ACKs
  ---
  duration_ms: 28.121325
  type: 'test'
  ...
# Subtest: CLI apps usage, sub-command and id validation
ok 15 - CLI apps usage, sub-command and id validation
  ---
  duration_ms: 2051.611699
  type: 'test'
  ...
# Subtest: OTA no-board path: connection refused is a clear error
ok 16 - OTA no-board path: connection refused is a clear error
  ---
  duration_ms: 7.025152
  type: 'test'
  ...
# Subtest: CLI --ota usage, arg validation and no-board error output
ok 17 - CLI --ota usage, arg validation and no-board error output
  ---
  duration_ms: 1466.979349
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
# duration_ms 4271.795191
```

### Profile 开启路径语法编译原始输出

使用 `compile_commands.json` 中 ESP-IDF 真实编译命令，为六个相关 C 文件追加 `-DCONFIG_LUME_PERF_PROFILE=1 -fsyntax-only`；这验证开关路径能编译，不能代替启用配置后的链接及板上日志。

```text
$ python3 /tmp/lume_profile_syntax.py
CHECK /home/ubuntu/lume/firmware/components/lume-perf/lume_perf.c
OK
CHECK /home/ubuntu/lume/firmware/components/quickjs-ng/quickjs.c
OK
CHECK /home/ubuntu/lume/firmware/components/lume-ui-bridge/lume_ui_bridge.c
OK
CHECK /home/ubuntu/lume/firmware/components/lume-board/lume_board.c
OK
CHECK /home/ubuntu/lume/firmware/components/lume-board/lume_display.c
OK
CHECK /home/ubuntu/lume/firmware/components/lume-engine/lume_engine.c
OK
```

### 最终默认配置构建与 size 原始输出（20 行 / 33 ms / profile 关闭）

```text
$ idf.py build && idf.py size
lume.bin binary size 0x2857e0 bytes. Smallest app partition is 0x640000 bytes. 0x3ba820 bytes (60%) free.
[100%] Built target app_check_size
[100%] Built target app

                           Memory Type Usage Summary
┏━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━┳━━━━━━━━━━┳━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━┓
┃ Memory            ┃              ┃          ┃                ┃               ┃
┃ Type/Section      ┃ Used [bytes] ┃ Used [%] ┃ Remain [bytes] ┃ Total [bytes] ┃
┡━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━╇━━━━━━━━━━╇━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━┩
│ Flash Code        │      1687374 │          │                │               │
│    .text          │      1687374 │          │                │               │
│ Flash Data        │       808440 │          │                │               │
│    .rodata        │       808184 │          │                │               │
│    .appdesc       │          256 │          │                │               │
│ DIRAM             │       229863 │    67.26 │         111897 │        341760 │
│    .text          │       107687 │    31.51 │                │               │
│    .bss           │        98368 │    28.78 │                │               │
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
Total image size: 2643813 bytes (.bin may be padded larger)
Note: The reported total sizes may be smaller than those in the technical
reference manual due to reserved memory and application configuration. The total
flash size available for the application is not included by default, as it
cannot be reliably determined due to the presence of other data like the
bootloader, partition table, and application partition size.
Built target size
```

r35b 基线 bin `0x2853c0`；本轮最终 bin `0x2857e0`，增加 `0x420 = 1,056 B`。48 行/15 ms 试验构建 bin `0x2858b0`，增加 `0x4f0 = 1,264 B`。两档 IRAM 都是 16,384 B，恰在硬线上，没有余量。以上是编译产物差异，不是运行时内部 DMA SRAM 可用量。
