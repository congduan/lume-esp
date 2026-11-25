# r68 战报 — Retro classics 双刀：Invaders + Frogger

分支 `r68-retro`，worktree `/tmp/lume-r68-wt`，基线 `origin/main` HEAD
`3fb0e4e6f1c4aba3e401f9e29d4343b3e991e3fc`（开工前 `git fetch` 确认，未变）。
改动面收敛在 `examples/invaders/`、`examples/frogger/`、两份 tests、README /
roadmap / KNOWN-SIMPLIFICATIONS / 本战报、playground 四处同步及其生成产物。
**未推送**。固件 C / prelude / bridge ABI / 帧协议 / `.d.ts` / vendored 均未改。

## 开工前实证（假设先验证）

读了 `examples/mario/app.js`（spans 预计算 + 脏区先例）、
`examples/games_breakout/app.js`（编队/碰撞 + KV 先例）、
`examples/games_tetris/app.js`（pan 跟随 + KV try/catch 降级先例）、
`docs/roadmap.md`「经典 app 复刻生态」节、
`website/playground/runtime.js`、`tests/lib/prelude_runner.js`、
`tools/playground/{build,verify}.mjs`、`website/playground/{page.js,index.html}`。

三处简报前提被实证纠正并写进代码注释 / KNOWN-SIMPLIFICATIONS：

1. **KV key**：简报写 `hiscore.invaders`（16 字符），但固件
   `lume_kv.c:42-50` 的 NVS key 硬上限是 15 字符。改用 `hisc.invaders`（13）/
   `hisc.frogger`（12）。
2. **浏览器 runtime KV**：`runtime.js:75-79` 是 `get:()=>null, set:()=>0` 的
   no-op 桩（不是内存 map）；两 app 沿用 tetris 的 try/catch + 内存分兜底，
   KV 失败静默降级。24-app 浏览器 verify 全绿实证无 UI 中断。
3. **bridge 单帧脏区上限 8**：`lume_prelude.js` 断言 `1..8 dirty rects`，
   Frogger 13 行不能逐行独立下发；相邻行合并成 2–4 个带区间。

**停下条款核对**：未触发。编队重绘在 emu 无掉帧日志、无 INSN 飘移异常
（INSNs 高于 counter 是 spans 回放量更大的确定性结果，见下）；浏览器 KV /
手势与假设的偏差已由 try/catch + no-op 桩覆盖；IP 近似度按「原创近似」
自研口径实现，无需主控拍板。

## A. Invaders 实测

逻辑内核：5×11 = 55 成员，3 档原创精灵（顶排 8px / 中三排 11px / 底排
12px，spans 各两帧腿部动画）；编队 2px/tick 触边翻转下降一行；炮台 1 发同屏、
敌人随机落弹、UFO 顶部加分；分数/KV、全灭进下一波（周期 60→52→…→20 ms、
movePx 2→5）、3 命 game over 重开。Game Boy 三档墨绿 + 硬边 fillRect。

### 宿主 harness（11 条全绿，原始输出）

```text
PASS invaders formation direction flip at right edge
PASS invaders edge contact descends one row
PASS invaders bullet hit removes member + score
PASS invaders player hit loses lives / game over
PASS invaders UFO adds bonus score
PASS invaders wave speed-up and formation reset
PASS invaders last kill enters next wave
PASS invaders high-score KV + graceful failure
PASS invaders sprite spans precomputed once, stable across ticks
PASS invaders game over restart
PASS invaders canvas/dirty budget, pan follow, tap fire, swipe pause
ALL INVADERS HARNESS CASES PASSED
```

### `node tools/lume/lume.js check examples/invaders`（原始输出）

```text
lume check examples/invaders

[PASS] bundle   8832 bytes (23 ms)
[PASS] eval     2x "app eval ok; entering event loop"
[SKIP] layout   no layout expectations for invaders
[SKIP] perf     profile disabled

screenshot: artifacts/check/invaders/tft.png
RESULT: PASS (4 steps, 0 failed; exit 0)
```

### 10 s emu 冒烟（原始输出节选）

```text
bundle /tmp/lume-r68-wt/examples/invaders: source 8832 bytes; payload 8832 bytes; frame 8844 bytes (source)
I (1733) lume-engine: engine task up (pinned core 1), PSRAM free=5513268 bytes
I (1805) lume-engine: runtime up; eval app '<home>' (5127 bytes)
I (1923) lume-engine: app eval ok; entering event loop
I (2689) lume-engine: engine recv RELOAD -> recycle runtime
I (2918) lume-engine: runtime up; eval app '<embedded-demo>' (8832 bytes)
I (3049) lume-engine: app eval ok; entering event loop
[emu] stop: Halted — core0 254423187 + core1 1464051331 insns in 48.9s wall = 35.1 Minsn/s; emulated 10.000s (2400000000 cycles); 1996857 exceptions, 29595 interrupts
TFT: /tmp/lume-r68-wt/artifacts/emu/invaders/tft.png
serial: /tmp/lume-r68-wt/artifacts/emu/invaders/serial.log
```

串口事件（原始）：

```text
I (3048) lume-engine: js: INVADER WAVE1 alive=55 score=0
I (5832) lume-engine: js: INVADER PERF js_avg_ms=89.44 js_max_ms=100 dirty_max_px=75492
I (7089) lume-engine: js: INVADER DESCEND row=1
I (8629) lume-engine: js: INVADER PERF js_avg_ms=91.56 js_max_ms=94 dirty_max_px=88652
```

- 稳态脏区：308×196（编队）+ 36×28（炮台）= 61,376 px = 全帧 26.6%；首帧
  一次性 480×480 初始化不计入稳态。下降帧新旧包围盒并集升到 ~88k px。
- 20 ms emu tick 下串口无 `eval failed|RELOAD ERR`、无掉帧日志；唯一 `error`
  行是模拟器 PHY 校准噪声 `phy: error: pll_cal exceeds 2ms!!!`，与 app 无关。

### Vision 核验（`artifacts/emu/invaders/tft.png`，已复制到 ui-refresh）

- 背景为均匀墨绿、无黑块/补丁缝隙（首帧全屏初始化修复前曾有脏区外黑底，已修）。
- 编队 5 行 3 档造型可辨：顶排小「×」、中三排中型蟹形、底排大型蟹形。
- 炮台在底部中央可见，子弹可见；顶栏 `INVADERS / S 0 HI 0 L 3 W1`、
  底栏 `PAN MOVE TAP FIRE SWIPE UP PAUSE` 可读；硬边像素、无 AA。

## B. Frogger 实测

逻辑内核：13 行（顶窝 + 4 河 + 中线 + 5 公路 + 2 底安全），13 列；tap 相对
青蛙中心判四向单格跳；车辆撞死 / 浮木（含荷叶）承载横移 / 落水死 / 越界扫走；
5 窝填满过关、车木提速；3 命、game over 重开。NES 灰底低饱和彩块 + 硬边
fillRect；跳跃简化为瞬移 + 一帧高亮（登记取舍）。

### 宿主 harness（10 条全绿，原始输出）

```text
PASS frogger four-direction hop + boundary clamp
PASS frogger vehicle collision
PASS frogger log carry displacement
PASS frogger water death
PASS frogger home fill + level up
PASS frogger difficulty speed-up
PASS frogger high-score KV + graceful failure
PASS frogger sprite spans precomputed once, stable across ticks
PASS frogger game over restart
PASS frogger canvas/events + tap-direction hops
ALL FROGGER HARNESS CASES PASSED
```

### `node tools/lume/lume.js check examples/frogger`（原始输出）

```text
lume check examples/frogger

[PASS] bundle   8817 bytes (21 ms)
[PASS] eval     2x "app eval ok; entering event loop"
[SKIP] layout   no layout expectations for frogger
[SKIP] perf     profile disabled

screenshot: artifacts/check/frogger/tft.png
RESULT: PASS (4 steps, 0 failed; exit 0)
```

### 10 s emu 冒烟（原始输出节选）

```text
bundle /tmp/lume-r68-wt/examples/frogger: source 8817 bytes; payload 8817 bytes; frame 8829 bytes (source)
I (1733) lume-engine: engine task up (pinned core 1), PSRAM free=5513268 bytes
I (1805) lume-engine: runtime up; eval app '<home>' (5127 bytes)
I (1923) lume-engine: app eval ok; entering event loop
I (2689) lume-engine: engine recv RELOAD -> recycle runtime
I (2918) lume-engine: runtime up; eval app '<embedded-demo>' (8817 bytes)
I (3021) lume-engine: app eval ok; entering event loop
[emu] stop: Halted — core0 322341536 + core1 618673417 insns in 26.6s wall = 35.4 Minsn/s; emulated 10.000s (2400000000 cycles); 1238004 exceptions, 29809 interrupts
TFT: /tmp/lume-r68-wt/artifacts/emu/frogger/tft.png
serial: /tmp/lume-r68-wt/artifacts/emu/frogger/serial.log
```

串口事件（原始）：

```text
I (3020) lume-engine: js: FROGGER LANE12 hop=start state=alive
I (5482) lume-engine: js: FROGGER PERF js_avg_ms=29.48 js_max_ms=30 dirty_max_px=187489
I (7791) lume-engine: js: FROGGER PERF js_avg_ms=29.68 js_max_ms=30 dirty_max_px=148086
I (10047) lume-engine: js: FROGGER PERF js_avg_ms=30.20 js_max_ms=31 dirty_max_px=148086
```

- 启动 hop 事件满足 `FROGGER LANE<n> hop=<dir> state=<...>` 口径；harness 另证
  `hop=up/down/left/right` 与 `state=dead/home/blocked`。
- 横列脏区按相邻行合并为 2–4 个 band（bridge 上限 8）；首帧全屏初始化
  187,489 px，稳态 ~148,086 px。串口无错误/掉帧日志。

### Vision 核验（`artifacts/emu/frogger/tft.png`，已复制到 ui-refresh）

- 背景均匀、无黑色竖边（首帧全屏填充修复前曾有 25px 左右黑边，已修）。
- 行带可辨：顶窝绿湾 → 蓝河区（棕浮木 + 绿荷叶）→ 绿色中线 → 灰公路区
  （红/黄/蓝车与卡车）→ 底部双安全区；青蛙在底安全区可见。
- HUD `FROGGER / S 0 HI 0 L 3 LV 1`、`HOMES 0/5 TAP AROUND FROG TO HOP` 可读。

## C. 共同验收

### Playground 四处同步（原始输出节选）

`node tools/playground/build.mjs`：

```text
PASS bundle invaders 8945 bytes
PASS bundle frogger 8892 bytes
PASS esbuild-wasm assets and 24 editable sources
PASS prelude 60379 bytes; 24 apps
```

`PLAYWRIGHT_MODULE=/tmp/lume-playwright/node_modules/playwright node tools/playground/verify.mjs`：

```text
PASS page loads without JavaScript errors
...
  invaders: 5 nodes
  frogger: 5 nodes
PASS all examples load without runtime errors
```

四处：build.mjs apps 列表（22→24）、page.js picker（两行）、index.html
script 标签（两个 apps/*.js）、verify.mjs 计数 22→24；`sources.js` /
`apps/*.js` / `sources/*.js` 生成产物已更新并纳入提交。浏览器 runtime 实测两
app 均 5 节点、无异常，KV no-op 桩与手势路径不打断加载。

## 诚实登记

- **真机 pending board**：点屏/色彩、pan/tap 手感与阈值、20 ms tick 真机帧率与
  编队重绘是否掉帧、音效（两 app 未加音效）、KV 跨电源持久化、bundle 推送。
  host harness + `lume check` + 浏览器 verify + esp32sim 截图均 ≠ 真机验收。
- **IP**：像素造型为原创近似的街机风格，非官方复刻；未逐像素复制任何原始精灵
  位图，文档只用「arcade-style」自研口径、不点名原商标。
- **字体**：14px Montserrat 沿用，不换像素字体。
- 详见 `docs/KNOWN-SIMPLIFICATIONS.md`（r68 条）。
