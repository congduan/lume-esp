# r83 — 全屏精灵卷轴 POC（drawImage blit 的首个 app 层实战 + 滚动性能口径）

日期：2026-11-17。基线 `ac23133`（r81 sprite blit 已合入）。工作目录
`/tmp/lume-r83-wt`（分支 `r83-scroll`）。本刀**不推送**。纯 app / 工具层改动，
未改任何固件 C 文件。

## 0. 先实证、再写码（读码结论，附行号）

任务要求的「假设可能错先实证」逐条核对，不凭 r81 旧印象：

| 待核实项 | 实证结论 | 出处 |
|---|---|---|
| `retainImage` 签名/语义 | `(slot, w, h, Uint16Array)`，slot 1..8、尺寸 1..480、长度必须 `w*h`，返回 C 返回值（0 成功） | `runtime/types/lume.d.ts:142`；`firmware/components/lume-engine/lume_scripts.c:1163-1170` |
| `drawImage` 签名/语义 | `(slot, dx?, dy?, flip?)`，一次 JS 调用 → 一次 C blit；flip 仅水平镜像 | `lume.d.ts:147`；`lume_scripts.c:1171-1178` |
| 上传幂等 / 重定义 | C 端 define 对已占槽先 free 再替换；8 槽共享 460,800 B 预算 | `firmware/components/lume-ui-bridge/lume_ui_bridge.c:1083-1113` |
| 脏区发布语义 | draw 写 work buffer；dirty-rect invalidate 只把该矩形 `memcpy` 到 front，矩形外保留旧像素 | `lume_ui_bridge.c:1115-1132`（draw）、`:1139-1168`（publish） |
| onDraw 调用方式 | 每个被订阅的 signal 触发**一次** onDraw，返回 1..8 个脏矩形（超出抛错）；drawImage 不受矩形裁剪，按绝对坐标写 work buffer | `lume_scripts.c:1194-1207` |
| emu renderer 对 blit 的支持度 | 真固件 blit 在 C 侧执行，esp32sim 跑的是真实 image，无需 JS renderer 模拟；浏览器 `tools/simulator/renderer.js` 与 `website/playground/renderer.js` 原本是 JS 回放（后者缺 natives，且 spriteDraw 在 (dx,dy)≠(0,0) 时有 ImageData 越界 bug） | 见 §4 修复 |
| perf 步口径 | `lume check` 的 perf 步只读 `lume-perf:` profile 行；默认 `CONFIG_LUME_PERF_PROFILE` 关闭 → `[SKIP] perf profile disabled` | `tools/lume/check.js:88-110` |
| emu 指令数口径 | esp32sim 停机行输出 core0/core1 指令数、wall 秒数、`Minsn/s`、模拟秒数 | `tools/emu/run.sh:41-43` |
| JS 计时口径 | `Date.now()` → `esp_timer_get_time()/1000.0`，在 emu 里是模拟时间而非真实挂钟 | `firmware/components/lume-engine/lume_engine.c:576-580` |
| emu 触摸 | r74 已登记：模拟 touch IC 不满足 CST9220 驱动，emu 里触摸不可用；手势逻辑改在 host harness 用事件序列验证 | `docs/r74-realfw-report.md:53-69` |

## 1. 交付内容

`examples/scroller/app.js`：原创像素近似的横向卷轴 POC，不点名、不复刻任何商业作品。

- **8 个精灵槽一次上传**：slot 1 sky(480×352)、2 hill(48×40)、3 ground(48×62)、
  4 hero(16×20)、5 jump(16×20)、6 crouch(16×12)、7 spike(16×24)、8 coin(12×12)。
  角色/障碍/金币用 ASCII 行 → RLE spans → `Uint16Array` RGB565 预计算（r68 invaders
  先例，`spanBuilds=5`、`pixelBuilds=5`、`TOTAL_SPANS=85`）；三条背景带直接生成位图。
- **全 blit、零逐像素重画**：每帧 1 次 sky + 11 次 hill + 11 次 ground + 可见
  coin/spike + 英雄 = 36~41 次 `drawImage`；host harness 断言 `draw`（fillRect）消息为 0。
- **脏区 = 相机扫过的两条带 + 移动精灵包围盒**：hill 带 `480×40`、ground 带
  `480×62`，英雄 old∪new 盒，所有金币 old∪new 盒合成一个矩形（bridge 每帧
  最多 8 个矩形，两带已占 2 个）。稳态 4 个矩形。
- **相机/玩法**：相机每 tick +3px，swipe down 触发 20 tick 冲刺（+6px/tick）并下蹲；
  tap 跳（重力 0.55），金币一次性拾取，尖刺碰撞扣命 + 24 tick 无敌，3 命耗尽
  game over，tap 重开。hiscore 走 KV key `hisc.scroller`（13 字符 ≤ NVS 15 上限）。
- **文案纯 ASCII**：`SCROLLER` / `TAP JUMP   SWIPE DOWN DASH   HOLD TO RUN` 等，
  无装饰 Unicode。

配套：`tests/scroller.js`（9 例）、`tools/emu/layout_expectations.json` 新增
`scroller` R1-R7 契约、playground 31-app 清单与 bundle/source 重生成、浏览器
renderer 的 sprite natives 与偏移 bug 修复（§4）。

## 2. host / C 回归（原始输出）

```
$ for t in tests/*.js; do node "$t" || echo FAIL "$t"; done
TOTAL_JS=43   FAIL_MARKERS=0   PASS_LINES=436
（原 r81 为 42 个脚本；本轮 +tests/scroller.js = 43）
$ node tests/scroller.js
PASS scroller camera advance + 20-tick dash/crouch
PASS scroller jump impulse + gravity landing
PASS scroller one-shot coin pickup + score
PASS scroller spike collision + invulnerability window
PASS scroller game over + restart reset
PASS scroller KV hiscore (13-char key) + offline fallback
PASS scroller sprite spans -> Uint16Array precomputed once
PASS scroller integration: 8 uploads (idempotent), 2327 blits, 0 fillRect, 4 rects / 63872 px
PASS scroller tap jump + swipe-down dash + 2 buttons
ALL SCROLLER HARNESS CASES PASSED
```

上传幂等断言不弱：初始化后恰好 8 条 `spriteDefine`（槽 1..8 齐全，每条
`w*h == pixels.length`），再驱动 60 帧后仍恰好 8 条，且 `spriteDraw` 单调增长、
`draw`（fillRect）恒为 0。

```
$ gcc -std=c11 -Wall -Wextra -Werror -I firmware/components/lume-ui-bridge/include tests/canvas_blit.c -o /tmp/lume_canvas_blit && /tmp/lume_canvas_blit
PASS opaque 4x4 blit lands exactly at (2,3)
PASS 0x0000 colour key is transparent
PASS blit clips at all four surface edges
PASS flip mirrors the sprite horizontally
PASS NULL/zero-size blit is a no-op
PASS fully off-surface blit is a no-op
canvas_blit: all cases PASS

$ gcc ... tests/canvas_aa.c -o /tmp/lume_canvas_aa -lm && /tmp/lume_canvas_aa
ALL CANVAS AA HOST TESTS PASSED   (19/19)

$ gcc ... tests/bridge_protocol.c -o /tmp/lume_bridge_protocol && /tmp/lume_bridge_protocol
BRIDGE_EXIT=0

$ npm test --prefix tools/lume
# tests 44 / # pass 43 / # fail 0 / # skipped 1     NPM_EXIT=0
```

## 3. `lume check`（含 emu eval + R1-R7 layout）

```
$ node tools/lume/lume.js check examples/counter --timeout 180
[PASS] bundle   2160 bytes (19 ms)
[PASS] eval     2x "app eval ok; entering event loop"
[PASS] layout   R1 PASS  R2 PASS  R3 PASS  R4 PASS  R5 PASS  R6 PASS  R7 PASS
[SKIP] perf     profile disabled
RESULT: PASS (4 steps, 0 failed; exit 0)        CHECK_COUNTER_EXIT=0

$ node tools/lume/lume.js check examples/scroller --timeout 180
[PASS] bundle   7805 bytes (23 ms)
[PASS] eval     2x "app eval ok; entering event loop"
[PASS] layout   R1 PASS  R2 PASS  R3 PASS  R4 PASS  R5 PASS  R6 PASS  R7 PASS
[SKIP] perf     profile disabled
RESULT: PASS (4 steps, 0 failed; exit 0)        CHECK_SCROLLER_EXIT=0
```

perf 步按口径如实 SKIP（profile 关闭，未开启 `CONFIG_LUME_PERF_PROFILE`，
也未为此单独重建 profile 固件）。截图 `artifacts/r83/tft-scroller.png` 已人工检视：
蓝天/云纹、绿色远山带、黄色金币、英雄、尖刺、棕色地面带、HUD 与两枚按钮
均正确渲染，无黑块/错位。

## 4. 浏览器配套修复（被本 app 首次暴露）

- `website/playground/runtime.js`：补 `canvasSpriteDefine` / `canvasSpriteDraw`
  natives（原先只有 retained path，调用 `retainImage` 直接 TypeError）。
- `website/playground/renderer.js`、`tools/simulator/renderer.js`：补
  `spriteDefine` / `spriteDraw` 回放；同时修正 r81 原实现把
  `createImageData(w,h)` 当整屏缓冲、在 `(dx,dy)≠(0,0)` 时越界写导致精灵
  只画在左上角的 bug —— 改为离屏 canvas + `drawImage`，flip 用 transform。
- `tools/playground/verify.mjs`：期望 app 数 29 → 31（HEAD 时已因 golf 少算 1）。
- `tools/playground/build.mjs`、`website/playground/page.js`、`index.html`：
  新增 `scroller`（30 → 31 个 app）。

```
$ PLAYWRIGHT_MODULE=... node tools/playground/verify.mjs
... scroller: 9 nodes
PASS all examples load without runtime errors       PLAYGROUND_VERIFY_EXIT=0
$ PLAYWRIGHT_MODULE=... node tools/simulator/verify.js
PASS renderer canvas ... PASS shell_demo DOM nodes=14     SIM_VERIFY_EXIT=0
$ python3 scripts/check_website.py
HTML pages: 7 ... API missing: none / invented: none / duplicates: none    WEB_EXIT=0
```

## 5. 性能口径（本轮核心交付）

所有数字来自本轮 emu 原始日志 `artifacts/r83/perf-lines.log` /
`emu-stop.log`，以及 host 实测 `host-perf.log`；**没有真机数据**。

### 5.1 每帧脏区与 canvas span 统计

emu 每 25 tick 输出一条 `SCROLLER PERF`（tick 间隔 50ms = 20fps 目标）：

```
I (4654) lume-engine: js: SCROLLER PERF js_avg_ms=9.92 js_max_ms=10 dirty_avg_px=59441 dirty_max_px=60800 blits_avg=36.6 dirty_n=4 spans=85
I (5920) lume-engine: js: SCROLLER PERF js_avg_ms=10.00 js_max_ms=10 dirty_avg_px=61718 dirty_max_px=62336 blits_avg=38.7 dirty_n=4 spans=85
I (7183) lume-engine: js: SCROLLER PERF js_avg_ms=10.32 js_max_ms=11 dirty_avg_px=63991 dirty_max_px=64800 blits_avg=41.2 dirty_n=4 spans=85
```

| 指标 | 实测 | 说明 |
|---|---|---|
| 脏区 px/帧（avg） | 59,441 / 61,718 / 63,991 | 画布 480×352=168,960 px 的 **35.2% / 36.5% / 37.9%**；整屏 230,400 px 的 25.8%~27.8% |
| 脏区 px/帧（max） | 60,800 / 62,336 / 64,800 | 峰值 38.4% 画布 |
| 固定两带成本 | 48,960 px | hill 480×40 + ground 480×62 = 29.0% 画布；其余 10k~15.8k 为精灵扫过的包围盒 |
| 矩形数/帧 | 4 | bridge 上限 8，余量 4 |
| `drawImage` 次数/帧 | 36.6 / 38.7 / 41.2 | 1 sky + 11 hill + 11 ground + 可见金币/尖刺 + 英雄 |
| 源 spans | 85 | 5 个 ASCII 精灵 RLE 一次预计算，跨 tick 不变（harness 断言） |
| 精灵槽上传 | 8 | 仅初始化一次，60 帧后仍 8（harness 断言） |

### 5.2 tick 预算占用

- 目标 20fps → 每 tick 预算 **50ms**。emu 实测 JS 段
  `js_avg_ms = 9.92 / 10.00 / 10.32`，`js_max_ms = 10 / 10 / 11`，
  约占预算 **20%**，余量约 40ms。
- **口径警告**：该值由 emu 的 `esp_timer` 模拟时钟测得（`lume_engine.c:576-580`），
  本轮观测粒度很粗（多次恰好 10ms、最大 11ms），只能当作**上界估计**，
  不是 ESP32-S3 真实执行时间。host 侧另测 200 帧 onDraw：
  `136.37 ms 总计 / 0.682 ms 每帧`（Node vm 真实挂钟）。两者不可直接相加或互换。

### 5.3 emu 指令数/秒（r54 口径）

```
scroller: [emu] stop: Halted — core0 514667513 + core1 386131266 insns in 22.8s wall = 39.6 Minsn/s; emulated 8.000s (1920000000 cycles); 617452 exceptions, 24288 interrupts
counter : [emu] stop: Halted — core0 150598860 + core1  58400743 insns in  5.7s wall = 36.6 Minsn/s; emulated 8.000s (1920000000 cycles); 332252 exceptions, 23684 interrupts
```

| 口径 | scroller | counter（同机同 8s 模拟） | 比值 |
|---|---|---|---|
| 总指令数 | 900,798,779 | 208,999,603 | **4.31×** |
| 每模拟秒指令数 | 112.6 Minsn/s | 26.1 Minsn/s | 4.31× |
| `Minsn/s`（wall） | 39.6（22.8s wall） | 36.6（5.7s wall） | ~1.08×（**不可比**） |

wall `Minsn/s` 受宿主负载影响很大（r54 counter 同机曾为 15.6），不能当性能
回归指标；可比的是「每模拟秒指令数」：本卷轴 app 约为 counter 的 4.3 倍，
增量主要来自每帧 ~38 次 C blit 在 LVGL task（core1）上搬约 20 万像素
（core1 指令 58.4M → 386M）。这是**模拟器指令计数**，不是真机 MIPS。

### 5.4 「滚动类 @20fps 是否可行」的结论性数据

- **host/emu 侧：可行，且余量不小。** 20fps 预算 50ms，emu JS 段实测约 10ms
  （粗粒度上界）；每帧只发布约 6 万 px 而非整屏，按 r35b 的 QSPI 理论口径
  `60,000×2 B×20 = 2.4 MB/s`，占 40MHz 理论 20 MB/s 的 **12%**（整屏则是
  9.2 MB/s / 46%）。blit 与脏区发布都在既有 C 路径内，无新固件瓶颈。
- **真机侧：未验，不得声称可行。** emu 的 `esp_timer`/指令计数、LVGL task
  调度、PSRAM 位图带宽、CO5300 实际刷屏与触摸手感都未测；r74 已登记 emu
  触摸不可用。故 P1 flappy 立项所需的 spike 数据只能给出「host/emu 口径支持
  20fps」这一半结论，**接板测量仍是硬门槛**。
- 建议接板验收口径：同画面跑 60s，采 `lume-perf` 的 render/flush/eval 分布与
  p95/p99、实测 fps、PSRAM 余量、tap/swipe 响应，再决定 flappy 的 tick 周期。

## 6. 固件构建 / size

本轮**未改任何固件 C 文件**（`git diff` 仅 app/工具/文档/website），按任务口径
不强制重跑 `idf.py build && idf.py size`。emu 所需镜像直接复用 r81-wt 在同
基线 `ac23133` 上的构建产物，sha256 与 r83 worktree 内副本完全一致：

```
45c663cc7d0f91221ac30646a73b5ed68b01a435aec61c32a48627eb95b49029  /tmp/lume-r81-wt/firmware/build/lume.bin
45c663cc7d0f91221ac30646a73b5ed68b01a435aec61c32a48627eb95b49029  firmware/build/lume.bin
```

因此 Flash Code / IRAM 相对 r81（2,021,204 B / 16,384 B 满线）为零增量；
若后续为任何 C 改动重建，须重新采 size 并与 r81 基线比对。

## 7. 已登记取舍与待验

- 卷轴实现为「全 work-buffer 重画 + 两条水平带脏区发布」，不是硬件 framebuffer
  平移；真平移需新 C 原语，本轮不做。
- 金币包围盒合成一个大矩形（bridge 8 矩形上限），因此矩形内可能含未变化像素；
  换来的是稳定 4 矩形/帧。
- `js_avg_ms` 为 emu 模拟时钟粗粒度值；真机 JS 执行时间未测。
- 真机帧率、色彩、PSRAM 批量 define 余量、触摸手感、sleep current 全部 pending
  board；host + emu 绿不等于硬件验收。
- 未做 flappy 同构 mini demo（留 P1 评估）；本轮只交 scroller 一刀。

原始证据总目录：`artifacts/r83/`（仅最终日志与截图；未纳入 git）。
