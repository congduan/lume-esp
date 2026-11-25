# r94 report — 流体粒子沙盒（`examples/particles`，纯 app 层）

Baseline `3090bcd`（r93 lvgl_task 已合入 main），worktree `/tmp/lume-r94-wt`，
branch `r94-particles`。开工守卫：

```text
GUARD: settings.json model=hy4flash-free ✓
GUARD: model=hy4flash-free ✓ (settings + runtime audit clean)
---EXIT:0---
```

基线确认（worktree）：

```text
3090bcd Merge r93-lvglev: lvgl_task deadline sleep + LVGL resume/notify wake (event-driven main loop)
---BRANCH---
r94-particles
---STATUS---
(clean)
```

## 1. 开工实证（先读码再写）

- `runtime/types/lume.d.ts:524-535`：`lume.imu.read()` 返回 `{ax,ay,az,gx,gy,gz}`
  或 `null`；加速度单位 **m/s^2**，静止 +Z 约 9.81。简报的「别按 g 阈值写」
  落实为 `imuDeviation()` 与 9.80665 直接比较、shake 阈值 4 m/s^2。
- `lume.d.ts:101-164`：Canvas 预算 460,800 B（480x480x2），**一个 480x480
  canvas 恰满全 app 预算**；`onDraw` 返回 1..8 个整数 dirty rect。
- `firmware/components/lume-engine/lume_scripts.c:1090`：`fillRect` 每次发一个
  `canvasDraw` → harness 的 `draw` 消息计数；`line` 走 `canvasBatch`。
  故选择 fillRect 小方块（PN+1 个 draw/帧）并按 harness <250 锁上限。
- `lume_scripts.c:1240-1300`：手势 kind 0=DOWN / 2=UP，swipe 在 UP 合成，
  `swipeMinPx=50`、`swipeMinVel=0.1`；harness 据此构造 DOWN/UP。
- `examples/memory`、`gravity_ball`、`pet`、`fishtank`、`compass` 的
  预计算 spans / 脏区 / demo fallback / harness 模式均已读，照先例实现。
- 结论：无新 API，不碰 `runtime/types/lume.d.ts`。

## 2. 实现取舍

- **220 粒子**，单个 480x480 canvas（230,400 px = 全预算）。物理是
  `Float32Array(220*4)` 平地数组 + 预分配 grid 链表，无逐帧分配。
- **渲染**：每帧 1 次 clear（旧+新位点的 union dirty box）+ 220 次
  `fillRect(6x6)`，`fillColor` 取预计算调色板；**逐帧绘制调用恒为 221**，
  无 fillCircle、无全屏重画叠加。
- **物理简化**：3x3 网格邻域的**位置式**分离（capped，非 SPH 压力求解）+
  速度阻尼 + 限速 + 四壁回弹 + 重力来自 IMU；demo 模式为模长 9.81、
  方向慢转的合成重力。目标只是「可辨的流体感」，不追求真实流体。
- **输入**：`lume.imu.read()` 的 ax/ay 直接映射为 px/s^2（`GAIN=18`），
  静止补一个 `STATIC_G=2 m/s^2` 避免失重；`|a-9.80665|>4 m/s^2` 判甩动
  （带 arming 去抖，非 g 阈值）。无 IMU → demo 模式（compass 先例）。
  `tap`=径向爆发、`swipe`=方向速度场、`STIR` 按钮走同一个 onPress 路径。
- **KV 加分**：`pt.mode`（7 字符）保存 `auto`/`demo` 偏好，`MODE` 按钮切换。

## 3. 验证（全部原始输出）

### 3.1 新 harness `node tests/particles.js`

```text
PASS particle count 220 in [200,300]; array length 880
PASS IMU m/s^2 mapping, null fallback and m/s^2 shake deviation
PASS 30 s demo smoke: bounded/finite, constant length, moved=220/220
PASS touch velocity field: touched=119 vx=31.5 vy=-0.2
PASS prelude integration: draw calls/frame 221..221 (<250), dirty rects, no IMU -> demo
PASS gesture swipe+tap inject velocity: target 209 vx 22.0 -> 308.8
ALL PARTICLES HARNESS CASES PASSED
---EXIT:0---
```

断言覆盖：粒子数 200..300、数组长度恒定、30 s（600 tick）demo 步进
无 NaN/无出界、触摸速度场生效、每帧 draw calls <250、dirty rect、
手势经真实 prelude 到达活动速度场。

### 3.2 全量回归 `for t in tests/*.js; do node "$t" || echo FAIL "$t"; done`

52 个 harness 全部运行，`TOTAL_FAIL=0`，无 `FAIL` 行。原始输出节选：

```text
PASS 62 SVG outlines and 26 Aa pairs have valid structure
PASS 36-card deck, words and digit dot counts
PASS Image glyph and auxiliary Canvas nodes
PASS page advance, Z-to-0 transition and Image bounce
PASS four-mode cycle, random bag and vertical Aa source
PASS number-dot Canvas draws three filled arcs
ALL ABC123 HARNESS CASES PASSED
request construction + key storage: PASS
HTTP error + timeout + bad JSON + truncation: PASS
Node local POST round trip: PASS
...(52 files)...
PASS built-in welcome and handler exception
webserver: 8 cases PASS
WebSocket host prelude: PASS
TOTAL_FAIL=0
```

### 3.3 `npm test --prefix tools/lume`

```text
# Subtest: scan() engine runs assertions over injected captured frames
ok 42 - scan() engine runs assertions over injected captured frames
...
# Subtest: CLI: --scan with no spec fails with exit 1 and parseable JSON
ok 44 - CLI: --scan with no spec fails with exit 1 and parseable JSON
1..44
# tests 44
# suites 0
# pass 43
# fail 0
# cancelled 0
# skipped 1
# todo 0
# duration_ms 2279.768757
---EXIT:0---
```

### 3.4 `node tools/lume/lume.js check examples/particles --no-emu`

```text
lume check examples/particles

[PASS] bundle   5318 bytes (22 ms)
[SKIP] eval     --no-emu
[SKIP] layout   requires emulator screenshot (--no-emu)
[SKIP] perf     profile disabled

RESULT: PASS (4 steps, 0 failed; exit 0)
---EXIT:0---
```

### 3.5 Playground 重生成（35 → 36 apps）

`tools/playground/build.mjs` 的 apps 数组、`website/playground/page.js`
examples 列表、`website/playground/index.html` 的 `<script defer>` 列表
各加 `particles`；`tools/playground/verify.mjs` 原硬编码
`names.length !== 31`（基线 page.js 已有 35 条，属**过期断言**）改为从
`window.LUME_SOURCES` 取期望值，避免再次僵化。

```text
PASS bundle particles 5318 bytes
PASS esbuild-wasm assets and 36 editable sources
PASS prelude 67016 bytes; 36 apps
```

`PLAYWRIGHT_MODULE=/home/ubuntu/.npm/_npx/705bc6b22212b352/node_modules/playwright node tools/playground/verify.mjs`（节选）：

```text
PASS all examples load without runtime errors
  ...
  fishtank: 2 nodes
  particles: 7 nodes
PASS all examples load without runtime errors
```

### 3.6 docs / website 检查

```text
api.html is up to date with lume.d.ts (135 entries)
---WEBSITE---
HTML pages: 7; internal href/src and anchors checked
API: 135 catalog entries, 135 type declarations, 32 function namespaces
API missing: none
API invented: none
API duplicates: none
API signatures not found in lume.d.ts: none
---EXIT:0---
```

### 3.7 emu 真跑（60 s，worktree）

固件未改，无需重编。主仓 `/home/ubuntu/lume/firmware/build/` 本轮为空，
故从 `/tmp/lume-r93-wt/firmware/build/` 拷三件套（bootloader.bin 22K /
partition-table.bin 3.0K / lume.bin 2.9M）；`git diff --stat 86e063c 3090bcd -- firmware/`
为空，证明 r93 worktree 与基线 3090bcd 的固件源码逐字节同一，三件套等价。
`EMU_SKIP_BUILD=1 EMU_SECONDS=60 EMU_BIN=/home/ubuntu/lume/tools/emu/.cache/bin/esp32sim EMU_OUTPUT_DIR=artifacts/check/particles/emu bash tools/emu/run.sh examples/particles`：

```text
bundle /tmp/lume-r94-wt/examples/particles: source 5318 bytes; payload 5318 bytes; frame 5330 bytes (source)
I (1736) lume-engine: engine task up (pinned core 1), PSRAM free=5502816 bytes
I (1808) lume-engine: runtime up; eval app '<home>' (5127 bytes)
I (1938) lume-engine: app eval ok; entering event loop
I (2689) lume-engine: engine recv RELOAD -> recycle runtime
I (2923) lume-engine: runtime up; eval app '<embedded-demo>' (5318 bytes)
I (2991) lume-engine: app eval ok; entering event loop
[emu] stop: Halted — core0 719817357 + core1 12152566301 insns in 353.7s wall = 36.4 Minsn/s; emulated 60.000s (14400000000 cycles); 5028223 exceptions, 284589 interrupts
TFT: /tmp/lume-r94-wt/artifacts/check/particles/emu/tft.png
serial: /tmp/lume-r94-wt/artifacts/check/particles/emu/serial.log
EMU_EXIT=0
```

统计（raw grep）：

```text
=== COUNTS ===
app eval ok: 2
engine recv RELOAD: 1
RELOAD ERR / eval failed: 0
ui queue full (any case): 0
runtime up: 2
=== LINES/BYTES ===
  215 11956 serial.log
```

`PERF` 全序列（见 3.8 的诚实口径）：

```text
I (4975) lume-engine: js: PARTICLES PERF js_avg_ms=57.40 js_max_ms=58
I (6978) lume-engine: js: PARTICLES PERF js_avg_ms=59.96 js_max_ms=68
I (9763) lume-engine: js: PARTICLES PERF js_avg_ms=91.16 js_max_ms=115
I (13905) lume-engine: js: PARTICLES PERF js_avg_ms=145.56 js_max_ms=190
I (20742) lume-engine: js: PARTICLES PERF js_avg_ms=253.24 js_max_ms=297
I (27678) lume-engine: js: PARTICLES PERF js_avg_ms=257.16 js_max_ms=295
I (32960) lume-engine: js: PARTICLES PERF js_avg_ms=191.20 js_max_ms=217
I (37023) lume-engine: js: PARTICLES PERF js_avg_ms=142.44 js_max_ms=164
I (40469) lume-engine: js: PARTICLES PERF js_avg_ms=117.72 js_max_ms=127
I (43697) lume-engine: js: PARTICLES PERF js_avg_ms=109.08 js_max_ms=117
I (48120) lume-engine: js: PARTICLES PERF js_avg_ms=156.68 js_max_ms=199
I (54014) lume-engine: js: PARTICLES PERF js_avg_ms=215.64 js_max_ms=228
I (58799) lume-engine: js: PARTICLES PERF js_avg_ms=171.32 js_max_ms=207
```

末尾 20 行（raw）：

```text
I (43697) lume-engine: js: PARTICLES PERF js_avg_ms=109.08 js_max_ms=117
I (48120) lume-engine: js: PARTICLES PERF js_avg_ms=156.68 js_max_ms=199
I (54014) lume-engine: js: PARTICLES PERF js_avg_ms=215.64 js_max_ms=228
I (58799) lume-engine: js: PARTICLES PERF js_avg_ms=171.32 js_max_ms=207

[emu] stop: Halted — core0 719817357 + core1 12152566301 insns in 353.7s wall = 36.4 Minsn/s; emulated 60.000s (14400000000 cycles); 5028223 exceptions, 284589 interrupts
[irq] per core, cpu-int: count (peripheral sources mapped to it)
  core0 int2          2  sources [59]
  core0 int3     154377  sources [79]
  core0 int5      59601  sources [57]
  core0 int9       3899  sources [42]
  core0 int12      1109  sources []
  core0 int13      4509  sources [96]
  core1 int0       1185  sources [80]
  core1 int1       59907  sources [58]

[emu] i2s frames out: 0 (i2s0 @ 44100 Hz) 0 (i2s1 @ 44100 Hz)
[emu] crypto: 0 AES blocks, 47576 SHA blocks, 0 RSA/MPI operations
[emu] blocks: 60997 built (0 cache flushes) core0, 753498 (3) core1; jit: 0 compiled, 0 KB code
[emu] wrote /tmp/lume-r94-wt/artifacts/check/particles/emu/tft.png
```

### 3.8 浏览器截图与 vision 自查

`sim.js` + Playwright（`/tmp/r94_shots.js`，不入 git）跑 1.2 s 后截图、
注入 swipe+tap 后 0.5 s 再截图，产物：

- `artifacts/check/particles/demo-initial.png`
- `artifacts/check/particles/after-perturb.png`
- `artifacts/check/particles/after-settle.png`

运行输出（含 host PERF）：

```text
[app] PARTICLES READY n=220 mode=auto imu=absent
sim loaded /tmp/lume-r94-wt/examples/particles/app.js: 280 messages
[app] PARTICLES PERF js_avg_ms=2.48 js_max_ms=14
nodes 7 text "FLUID PARTICLES\nDEMO (no IMU)  N=220\nTAP=BURST  SWIPE=STIR  SHAKE DEVICE\nSTIR\nMODE"
shot demo-initial.png
gesture node id 1
shot after-perturb.png
[app] PARTICLES PERF js_avg_ms=1.48 js_max_ms=4
shot after-settle.png
```

Vision 自查（逐张查看）：初始帧为右中区域一片**可逐颗辨认的青/蓝小方块**，
背景干净、无拖影/残影、HUD 文本清晰；扰动后粒子整体向右铺开、部分贴右边界，
仍是离散方块，无连片糊块或异常空白；`after-settle` 保持离散。**粒子形态可辨，
通过**。

### 3.9 固件 build / size（本轮条件不满足，未跑）

任务第 6 项限定「固件若意外改了 C 才跑」。本刀零固件改动
（`git status --short` 仅 app/test/docs/playground 文件），故未跑
`idf.py build && idf.py size`；IRAM 16384(Remain 0) 硬线无新代码触碰。
QuickJS 汇编 host swap 未发生，无需 `-g0` 单独重编。

## 4. 诚实口径与 pending

- **emu JS 时长超参考预算**：host 测得 `js_avg_ms≈1.5–2.5`（50 ms 预算内），
  但 esp32sim 报 57–257 ms。emu `jit: 0 compiled`、无 JIT 的 QuickJS 解释执行
  下 221 次 `canvasDraw` 边界调用被显著放大；参考先例 invaders 同口径
  93.72 ms（`/tmp/lume-r93-wt/artifacts/emu/invaders/serial.log`）。
  本轮**不宣称 20 fps 稳定已达标**；可证事实是 60 s emu 全程
  eval_ok=2 / RELOAD ERR=0 / ui queue full=0、无崩溃无泄漏。真机帧率/观感
  仍 deferred 到接板验收。
- **物理是近似**：非 SPH、无黏性/压力投影，分离是 capped 位置式推离；
  视觉「流体感」不等于物理正确。
- **未做接板验收**：IMU 甩动方向/阈值、触摸手感、AMOLED 观感、功耗均待
  main controller 上板；simulator 的 IMU 返回 null（demo 模式），未覆盖 IMU 分支的真机数据。
- **磁盘纪律**：artifacts 仅保留 `artifacts/check/particles/` 下三张截图 +
  emu `serial.log`/`tft.png`/`app.frame`/`actions.txt`；`firmware/build/`
  三件套与 `tools/lume/node_modules` 符号链接均不进 git。

详见 `docs/roadmap.md` 的 r94 result 小节与 `docs/KNOWN-SIMPLIFICATIONS.md`
的 r94 段。
