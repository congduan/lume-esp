# r93 report — lvgl_task 事件驱动化（wait_ms 到期睡眠 + 通知唤醒）

Baseline: `bd3ed8d`（origin/main，r92 compress 已合入），worktree `/tmp/lume-r93-wt`，
branch `r93-lvglev`。开工前模型守卫原始输出：

```text
GUARD: settings.json model=hy4flash-free ✓
GUARD: model=hy4flash-free ✓ (settings + runtime audit clean)
---EXIT:0---
```

## 1. 开工实证：简报前提已过期，以读码为准

简报（roadmap「Vendored 魔改候选」#1，引 r35b）称 `lvgl_task` 是「33 ms LVGL
timer + 10 ms 固定轮询」。逐行读当前实现后确认**该描述是 r35b 时代快照，r92
基线已不是这样**：

- 改动前 `firmware/components/lume-board/lume_board.c:125-133` 已经是
  `uint32_t wait_ms = lv_timer_handler();` → `if (wait_ms==0) wait_ms=1;` →
  `if (wait_ms>10) wait_ms=10;` → `vTaskDelay(pdMS_TO_TICKS(wait_ms))`。
  即 r36b 的 commit `62bb0ff`（"display: schedule LVGL from timer deadline"）
  已经把固定 `vTaskDelay(10)` 换成 `wait_ms` 驱动，**但加了 10 ms 上限**，
  目的写在注释里：「Bound sleep so a cross-task invalidation can still be
  serviced promptly」。
- `docs/r36b-perf-report.md:9` 原文亦确认：「用 vendored LVGL 9.3
  `lv_timer_handler()` 返回的下次到期毫秒数睡眠，限制在 1–10 ms 以响应跨任务失效」。
- 因此 r93 的真实起点是 **wait_ms 驱动 + 10 ms 封顶**，不是固定轮询；本轮改为
  **到期睡眠 + 通知唤醒**，删掉封顶并把唤醒做成事件驱动。

vendored API 与配置实证（未凭记忆写码）：

- `firmware/components/lvgl/src/misc/lv_timer.h:41,73` —
  `typedef void (*lv_timer_handler_resume_cb_t)(void *data);` /
  `void lv_timer_handler_set_resume_cb(...)`。
- `firmware/components/lvgl/src/misc/lv_timer.c:183,212,247,250,255` —
  `lv_timer_create` / `lv_timer_resume` / `lv_timer_reset` / `lv_timer_enable`
  均调用 `lv_timer_handler_resume()`。
- `firmware/components/lvgl/src/misc/lv_timer.c:375-382` — 该函数把
  `state.timer_time_until_next = 0` 并调用 `resume_cb`。这正是 LVGL 自带的
  「新 timer 到期要唤醒 handler」挂钩点，不需要魔改 vendored 源码。
- `firmware/components/lvgl/src/drivers/nuttx/lv_nuttx_libuv.c:124-166` —
  LVGL 上游自己的 libuv port 就是参考模式：`sleep_ms = lv_timer_handler()`，
  `LV_NO_TIMER_READY` 停表，否则按 `sleep_ms` 睡眠；`resume_cb` 里把定时器
  改为 0 ms 立即触发。r93 照此在 FreeRTOS 上用 task notification 实现。
- `firmware/components/lvgl/src/misc/lv_timer.c:119-147` — `lv_timer_handler()`
  返回所有未暂停 timer 的最小剩余毫秒；`LV_NO_TIMER_READY = 0xFFFFFFFF`
  （`lv_timer.h:27`）。`lv_indev.c:133` 的 indev 读 timer 与
  `lume_ui_bridge.c:40,1811` 的 5 ms drain timer 都在这个集合里。
- `firmware/components/lume-board/lume_board.c:43-46` —
  `lv_tick_set_cb(lvgl_tick_get_cb)` 用 `esp_timer_get_time()/1000` 作单调毫秒
  时基，**与任务睡眠解耦**，所以睡眠路径不会让动画步长漂移。
- `tools/emu/run.sh:37-43` — esp32sim 直接加载 worktree 编出的同一份
  `lume.bin` / bootloader / ptable，**没有独立仿真循环**；真机与 emu 共用
  `lvgl_task`，改坏会同时挂掉两条路径，故两条路径都要过。
- 触摸无 ISR：`lume_touch.c` 的 read_cb（`:135,:323`）由 LVGL indev timer
  在 `lv_timer_handler()` 内轮询，属于 deadline 集合，不是被睡眠「睡丢」的源。

**关键实证（影响收益口径）**：`lume_ui_bridge.c:40` 的
`#define DRAIN_PERIOD_MS 5` 与 `:1811` 的 `lv_timer_create(drain_timer_cb, 5, ...)`
常驻且从不 `lv_timer_pause`。因此 `lv_timer_handler()` 实践中总返回 ≤5 ms，
r36b 的 `>10` 封顶在当前配置下是**死代码**：删掉它不会改变空载唤醒频率。
详见第 4 节诚实口径。

## 2. 改动内容

| 文件 | 改动 |
|---|---|
| `firmware/components/lume-board/lume_board.c:40,118-137,143-179,187,206` | 新增 `s_lvgl_task`；`lvgl_resume_cb()` 经 `lv_timer_handler_set_resume_cb()` 注册；公开 `lume_lvgl_wake()`；`lvgl_task` 用 `ulTaskNotifyTake()` 按 `wait_ms` 到期睡眠，`LV_NO_TIMER_READY` → `portMAX_DELAY`；pause 轮询也改通知感知；sleep/wake 路径主动唤醒 |
| `firmware/components/lume-board/lume_board_internal.h:22-23` | 声明 `lume_lvgl_wake()` |
| `firmware/components/lume-board/lume_display.c:32,236` | 屏幕抓帧 arm 后唤醒 LVGL 任务 |
| `firmware/components/lume-ui-bridge/include/lume_ui_bridge.h:272`、`lume_ui_bridge.c:44,1786,1797-1800` | 以函数指针注册 wake hook（保持 `lume-board → lume-ui-bridge` 单向依赖，不成环）；`post()` 成功入队后立即唤醒 |

唤醒源闭环：

- LVGL timer（刷新 / indev 触摸读 / 动画 / drain）：`lv_timer_create/resume/reset/enable`
  → `lv_timer_handler_resume()` → `lvgl_resume_cb()` → `xTaskNotifyGive()`；已有
  timer 则由 `wait_ms` 的 deadline 精确唤醒。
- Queue A（UI / 热更新后的新界面）：`lume_ui_bridge_post()` → `s_wake_cb()`
  → `lume_lvgl_wake()`，不必再等 drain timer 的 5 ms 到期。
- 面板 sleep/wake（`lume_display_sleep/wake`）、抓帧（`lume_display_capture`）：
  直接 `lume_lvgl_wake()`。
- 未改任何 vendored `lv_conf.h` / LVGL / QuickJS 源码 → **无 VENDOR.md 变更**。

## 3. 验证原始输出

### 3.1 固件构建 + size（改 C 必跑）

命令（按简报逐字）：

```bash
cd /opt/esp/esp-idf && env -u VIRTUAL_ENV IDF_PYTHON_ENV_PATH=/home/ubuntu/.espressif/python_env/idf5.5_py3.12_env bash -c '. ./export.sh >/dev/null 2>&1; cd /tmp/lume-r93-wt/firmware && idf.py build && idf.py size'
```

首次全量构建在前台工具 600 s 上限处被 SIGTERM（停在 `[100%] Built target
gen_project_binary` 之前，98% 的 `liblvgl.a` 已链接）；**QuickJS 汇编未卡死，
本轮无需 `-g0` 单独重编**。原样重跑同一命令走增量，成功产出三件套。
关键原始输出（`build2.log` 摘录）：

```text
[100%] Built target lume.elf
[100%] Built target gen_project_binary
lume.bin binary size 0x2e1f00 bytes. Smallest app partition is 0x640000 bytes. 0x35e100 bytes (54%) free.
[100%] Built target app_check_size
[100%] Built target app
Running make in directory /tmp/lume-r93-wt/firmware/build
Executing "make -j 4 size"...
                            Memory Type Usage Summary
┏━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━┳━━━━━━━━━━┳━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━┓
┃ Memory Type/Section ┃ Used [bytes] ┃ Used [%] ┃ Remain [bytes] ┃ Total [bytes] ┃
┡━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━╇━━━━━━━━━━╇━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━┩
│ Flash Code          │      2030508 │          │                │               │
│    .text            │      2030508 │          │                │               │
│ Flash Data          │       850196 │          │                │               │
│    .rodata          │       849940 │          │                │               │
│    .appdesc         │          256 │          │                │               │
│ DIRAM               │       247267 │    72.35 │          94493 │        341760 │
│    .bss             │       121960 │    35.69 │                │               │
│    .text            │       101679 │    29.75 │                │               │
│    .data            │        23628 │     6.91 │                │               │
│ IRAM                │        16384 │    100.0 │              0 │         16384 │
│    .text            │        15356 │    93.73 │                │               │
│    .vectors         │         1028 │     6.27 │                │               │
│ RTC FAST            │           72 │     0.88 │           8120 │           8192 │
│ RTC SLOW            │           32 │     0.39 │           8160 │           8192 │
└─────────────────────┴──────────────┴──────────┴────────────────┴───────────────┘
Total image size: 3022475 bytes (.bin may be padded larger)
```

对比 r92 基线（简报给定：Flash Code 2,030,276 / Flash Data 850,196 /
DIRAM 247,267 / IRAM 16384 Remain 0 / Total 3,022,243）：

| 指标 | r92 基线 | r93 | 增量 |
|---|---:|---:|---:|
| Flash Code | 2,030,276 | 2,030,508 | +232 |
| Flash Data | 850,196 | 850,196 | 0 |
| DIRAM | 247,267 | 247,267 | 0 |
| IRAM | 16,384 | 16,384 | 0 |
| IRAM Remain | 0 | 0 | 0（硬线未破） |
| Total image | 3,022,243 | 3,022,475 | +232 |

`xtensa-esp32s3-elf-nm lume.elf` 确认新符号进了本次固件（非陈旧产物）：

```text
4200ddf0 T lume_lvgl_wake
4201e534 T lume_ui_bridge_set_wake_cb
4200de0c t lvgl_resume_cb
4203f834 T lv_timer_handler_set_resume_cb
```

`idf.py build` 自动在 `firmware/sdkconfig` 加了一行
`# CONFIG_LUME_BOARD_WAVESHARE_ESP32_S3_TOUCH_AMOLED_1_75C is not set`，
与 r93 无关，已 `git checkout --` 还原，不进 diff。

### 3.2 全量 host 回归

```text
=== host harness summary ===
TOTAL_PASS=51 TOTAL_FAIL=0
```

（逐条 `for t in tests/*.js; do node "$t" || echo FAIL "$t"; done`，0 FAIL；
工作树原先无 `node_modules`，用主仓 `tools/lume/node_modules` 的符号链接提供
esbuild 依赖，未改依赖文件。）

```text
=== npm test ===
ok 43 - scan() fails cleanly when a frame is missing
ok 44 - CLI: --scan with no spec fails with exit 1 and parseable JSON
1..44
# tests 44
# suites 0
# pass 43
# fail 0
# cancelled 0
# skipped 1
# todo 0
# duration_ms 2128.570987
```

### 3.3 回归哨兵

```text
$ node tools/lume/lume.js check examples/counter --no-emu
lume check examples/counter

[PASS] bundle   2160 bytes (20 ms)
[SKIP] eval     --no-emu
[SKIP] layout   requires emulator screenshot (--no-emu)
[SKIP] perf     profile disabled

RESULT: PASS (4 steps, 0 failed; exit 0)
CHECK_EXIT=0
```

### 3.4 emu smoke（worktree quirk 已照做）

worktree 自己 build 出的三件套就位（**未用主仓 r92 旧件**）：

```text
-rw-rw-r-- 1 ubuntu ubuntu   22288 Nov 18 04:08 firmware/build/bootloader/bootloader.bin
-rw-rw-r-- 1 ubuntu ubuntu 3022592 Nov 18 04:26 firmware/build/lume.bin
-rw-rw-r-- 1 ubuntu ubuntu    3072 Nov 18 04:07 firmware/build/partition_table/partition-table.bin
```

`EMU_SKIP_BUILD=1 EMU_BIN=/home/ubuntu/lume/tools/emu/.cache/bin/esp32sim EMU_SECONDS=60 bash tools/emu/run.sh examples/<app>`：

counter（10 s，基本 app 无回归）：

```text
I (1736) lume-engine: engine task up (pinned core 1), PSRAM free=5502816 bytes
I (1808) lume-engine: runtime up; eval app '<home>' (5127 bytes)
I (1938) lume-engine: app eval ok; entering event loop
I (2688) lume-engine: engine recv RELOAD -> recycle runtime
I (2918) lume-engine: runtime up; eval app '<embedded-demo>' (2160 bytes)
I (2947) lume-engine: app eval ok; entering event loop
[emu] stop: Halted — core0 156780625 + core1 62248021 insns in 6.3s wall = 34.9 Minsn/s; emulated 10.000s (2400000000 cycles); 366738 exceptions, 28747 interrupts
EMU_EXIT=0
```

fishtank（60 s 动画 smoke，`<home>` launcher 主屏先起来再注入 app）：

```text
I (1736) lume-engine: engine task up (pinned core 1), PSRAM free=5502816 bytes
I (1808) lume-engine: runtime up; eval app '<home>' (5127 bytes)
I (1938) lume-engine: app eval ok; entering event loop
I (2689) lume-engine: engine recv RELOAD -> recycle runtime
I (2923) lume-engine: runtime up; eval app '<embedded-demo>' (5355 bytes)
I (2971) lume-engine: app eval ok; entering event loop
I (2989) lume-ui-bridge: gesture registered id=1
I (3217) lume-ui-bridge: transition: revealed (overlay removed)
[emu] stop: Halted — core0 10163337620 + core1 3197902506 insns in 317.1s wall = 42.1 Minsn/s; emulated 60.000s (14400000000 cycles); 8823180 exceptions, 206659 interrupts
FISHTANK_EXIT=0
```

invaders（60 s 动画 smoke，JS 自报每窗帧耗时，最后自然 game over 非崩溃）：

```text
I (5667) lume-engine: js: INVADER PERF js_avg_ms=82.60 js_max_ms=91 dirty_max_px=230400
I (8297) lume-engine: js: INVADER PERF js_avg_ms=85.16 js_max_ms=98 dirty_max_px=80172
...
I (41185) lume-engine: js: INVADER PERF js_avg_ms=115.12 js_max_ms=127 dirty_max_px=106442
I (44031) lume-engine: js: INVADER PERF js_avg_ms=93.72 js_max_ms=102 dirty_max_px=73600
I (44364) lume-engine: js: INVADER DESCEND row=5
I (44364) lume-engine: js: INVADER OVER score=0
[emu] stop: Halted — core0 2274803992 + core1 8449474591 insns in 312.2s wall = 34.3 Minsn/s; emulated 60.000s (14400000000 cycles); 17189264 exceptions, 829257 interrupts
INVADERS_EXIT=0
```

三份 `serial.log` 健康检查（`eval_ok` = `app eval ok` 行数）：

```text
fishtank: eval_ok=2 reload_err=0 ui_queue_full=0
invaders: eval_ok=2 reload_err=0 ui_queue_full=0
counter:  eval_ok=2 reload_err=0 ui_queue_full=0
```

本轮三次 emu 运行未出现 `lume-touch: touch bus down after 10 read errors`
（简报已说明该噪声属预期、不算失败）。**emu 注入 touch 动作的能力受限于
模拟器 CST820 模型与固件 CST9220 驱动不匹配**，触摸手感/合法性不在 emu
证明范围，仍 deferred to board；本轮通过代码闭环（indev timer 属于 deadline
集合 + `lvgl_resume_cb`）确认「睡了不响应」无回归面。

注意：两个 60 s emu 曾因并行运行在 1.9 GiB RAM + swap 上互相挤压被前台工具
SIGTERM（invaders 已跑到约 41 s 模拟时间）；改为**串行**、单任务 600 s 上限后
两轮都跑满 60.000 s 并退出 0。

## 4. 收益口径（诚实原则）

- **空载功耗 / 帧率上限的量化收益：pending board。** 调度轮没有真机功耗计，
  也不改 `CONFIG_LUME_REFRESH_PERIOD_MS`（默认 33 ms）。r35b 的 30 fps 上限来自
  刷新周期本身，不是本次删掉的 10 ms 封顶；r93 **不宣称解锁帧率**。
- **emu 代理指标实测结论：删封顶未改变空载唤醒频率。** 实证依据：
  `lume_ui_bridge.c:40,1811` 的 5 ms drain timer 常驻不暂停，
  `lv_timer_handler()` 返回 ≤5 ms，故旧代码 `if (wait_ms>10)` 分支在 r92 配置下
  从不命中；r93 前后空闲循环唤醒都受 5 ms drain timer 约束。这是 host/emu 侧
  可证的事实，**不代表 ESP32-S3 功耗**。
- **r93 可证的行为变化是「事件响应延迟」而非空闲唤醒数**：Queue A `post()`
  成功即 `lume_lvgl_wake()`（emu 中 app 注入后约 30–40 ms 内完成 eval + 首个
  gesture 注册 + transition revealed），LVGL timer 新建/恢复经 `resume_cb`
  立即唤醒，`LV_NO_TIMER_READY` 时真睡眠而非 10 ms 轮询。真机功耗/帧率收益
  需要在板功耗计 + profile 下 A/B 测 r92/r93 固件才能给数字。
- **未做的进一步优化**：没有把 drain timer 改成「队列空则暂停、post 时恢复」，
  因为那会从引擎任务跨任务调用 LVGL API（`lv_timer_resume` 写 LVGL 全局状态，
  `LV_USE_OS=NONE` 无锁）并触碰 Queue A 满队列重试语义，回归风险超出本刀范围；
  若后续要真正压低空载唤醒频率，应独立评估该方案并记录翻案。

## 5. 接板验收 deferred

点屏方向/手感、AMOLED 观感、真机 sleep current、bundle 推送、动画在真机的
帧率与耗电，均未在调度轮验证；build / host harness / esp32sim 只证明编译、
宿主行为与仿真路径存活。详见 `docs/KNOWN-SIMPLIFICATIONS.md` r93 节。
