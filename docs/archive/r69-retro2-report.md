# r69 战报 — Retro classics 第三刀：Sokoban + LCD dual

分支 `r69-retro2`，worktree `/tmp/lume-r69-wt`，基线 `origin/main` HEAD
`7cc8cfad1bef0294da7404867b7612b11189c067`（开工前 `git fetch` 确认，未变）。
改动面收敛在 `examples/sokoban/`、`examples/lcd_dual/`、两份 tests、README /
roadmap / KNOWN-SIMPLIFICATIONS / 本战报、playground 四处同步及其生成产物、
`artifacts/emu/ui-refresh/` 截图。**未推送**。固件 C / prelude / bridge ABI /
帧协议 / `.d.ts` / vendored 均未改。

## 开工前实证（假设先验证）

读了 `examples/invaders/app.js`、`examples/frogger/app.js`（r68 像素口径、
spans 预计算、脏区带、`hisc.*` 短 key）、`tests/invaders.js`、`tests/frogger.js`、
`tests/lib/prelude_runner.js`、`firmware/components/lume-engine/lume_scripts.c`
（retainPath/retainSegments/drawPath、手势状态机）、`firmware/components/lume-ui-bridge/lume_ui_bridge.c`
（press/gesture 事件路由）、`tools/playground/{build,verify}.mjs`、
`website/playground/{page.js,index.html,runtime.js,renderer.js}`、
`docs/roadmap.md`「经典 app 复刻生态」与 `docs/KNOWN-SIMPLIFICATIONS.md` r68 条。

两处简报前提被实证纠正（与 r68 同款）：

1. **KV key**：简报写 `hisc.soko_progress`（18 字符），但
   `firmware/components/lume-storage/lume_kv.c:42-50` 实证 NVS key 上限 15 字符。
   收敛为 `hisc.soko_pg`（12 字符）；LCD 用 `hisc.lcd`（8）。
2. **MODE 交互**：原计划用 LVGL `Button` 的 `onPress`。emu 实测按钮吞掉触摸、
   CLICKED 不触发；浏览器里按钮 onPress 与画布根手势会双触发（切模式 + 误移
   棋子）。改为 MODE 画进画布、由单一手势目标的底部 tap 区处理（详见 C 节
   浏览器烟测）。此即简报「浏览器手势与 LCD 双游戏交互冲突」停下条款的核对：
   已实证化解，无需主控拍板。

`tools/lume/node_modules` 为断链软链老坑，开工先重挂到
`/home/ubuntu/lume/tools/lume/node_modules`（esbuild-wasm 就位）；esp32sim 与
`lume.bin` 复用主仓预编译产物（worktree 内为 gitignore 的本地副本）。

## A. Sokoban 推箱子实测

逻辑内核：标准推箱子规则（推单箱、不可拉、不可推两箱）；10 关内嵌 11×7
ASCII 常量（≤13×10），par = BFS 最优步数 `[2,9,1,10,8,7,9,14,15,4]`；
过关解锁下一关（KV `hisc.soko_pg` 存最高解锁关号）；swipe 四向推箱为主、
tap 相邻格为辅；墙/地板点阵/目标菱形/双态箱（在目标变色）/玩家全部 spans
硬边；箱入角非目标 → `STUCK` 徽章；玩家瞬移 + 高亮（r68 frogger 同款简化）。

### 宿主 harness（10 条全绿，原始输出）

```text
PASS sokoban single-box push + move counter
PASS sokoban no two-box push / no wall walk
PASS sokoban box cannot be pushed into wall
PASS sokoban goal coverage + all-boxes-home win
PASS sokoban corner deadlock + goal exemption
PASS sokoban all 10 levels BFS-solvable at stated par (data integrity)
PASS sokoban progress KV (<=15 char key, clamp, graceful failure)
PASS sokoban unlock + next/prev/restart navigation
PASS sokoban sprite spans precomputed once, stable across moves
PASS sokoban canvas/events, dirty budget, swipe push, tap push, reset button
ALL SOKOBAN HARNESS CASES PASSED
```

第 6 条是本轮核心价值：BFS 解算器在 vm 外运行，逐关断言「可解」且
`par == 最优玩家步数`。关卡数据若被改坏（例如箱/目标数量不符、墙封死），
失败的是数据断言而不是被放宽的断言。

### `node tools/lume/lume.js check examples/sokoban`（原始输出）

```text
lume check examples/sokoban

[PASS] bundle   7834 bytes (128 ms)
[PASS] eval     2x "app eval ok; entering event loop"
[SKIP] layout   no layout expectations for sokoban
[SKIP] perf     profile disabled

screenshot: artifacts/check/sokoban/tft.png
RESULT: PASS (4 steps, 0 failed; exit 0)
```

### 10 s emu 冒烟（原始输出节选）

```text
bundle /tmp/lume-r69-wt/examples/sokoban: source 7834 bytes; payload 7834 bytes; frame 7846 bytes (source)
I (1733) lume-engine: engine task up (pinned core 1), PSRAM free=5513268 bytes
I (2918) lume-engine: runtime up; eval app '<embedded-demo>' (7834 bytes)
I (3248) lume-engine: app eval ok; entering event loop
[emu] stop: Halted — core0 162925493 + core1 132275337 insns in 8.7s wall = 34.0 Minsn/s; emulated 10.000s (2400000000 cycles); 515744 exceptions, 28703 interrupts
TFT: /tmp/lume-r69-wt/artifacts/emu/sokoban/tft.png
```

串口事件（原始）：

```text
I (3113) lume-engine: js: SOKO L1 moves=0 boxes=0/1; FIRST PUSH par=2
I (6148) lume-engine: js: SOKO PERF js_avg_ms=0.00 js_max_ms=0
I (9148) lume-engine: js: SOKO PERF js_avg_ms=0.00 js_max_ms=0
```

满足 `SOKO L<n> moves=<m> boxes=<k>/<total>` 口径。每次成功移动另发
`L<n> moves=... boxes=...`，过关发 `WIN L<n> moves=... par=...`，死锁发
`STUCK L<n> moves=...`（harness 逐条断言）。串口无 `eval failed|RELOAD ERR`、
无掉帧日志。

### Vision 核验（`artifacts/emu/ui-refresh/sokoban.png`）

- 背景均匀暗橄榄，无黑块/补丁缝隙。
- 墙为绿色砖纹、地板为暗点阵、目标为亮绿菱形、箱子为棕色十字箱、玩家为
  黄色人形——五类元素逐一可辨；箱子不在目标时用棕色，推上目标切蓝色
  （双色状态，logic 层 `sokoOnGoalCount` + 渲染层 `boxGoal` sprite）。
- 顶栏 `SOKOBAN / L1/10 MV 0 PAR 2 BOX 0/1` 与关卡名行可读；底部
  `< PREV / RESET / NEXT >` 三按钮可见；硬边像素、无 AA。

## B. LCD 双游戏实测

诚实定位：**segment LCD style** 双游戏机——所有可能段位以极低对比度常显、
激活段高亮，仿非背光透传 LCD 物理特性（辨识度核心，代码首段注释先写物理
类比再写代码）。造型自研，**不复刻 Nintendo Game & Watch 任何原机**、不逐
像素复制任何原版位图或商标。GAME A 接面包（厨师左右移动接落下面包，3 段
式掉落/相位循环，漏 3 个结束）；GAME B 闪避（角色三车道上下切换躲障碍，
撞一次结束）。无音效（r68 两 app 同款，pending board）。

### 视觉实现

- 幽灵段：`ctx.retainSegments` 在首帧一次上传两条静态路径（GAME A 124 段 /
  GAME B 99 段，均 ≤240 上限），后续帧只 `ctx.drawPath` 回放，零 JS 几何。
- 激活段：正常色 `fillRect` 硬边，状态驱动重画。
- 底 ghost 色 `#122A12`（≈8% 点亮绿亮度），点亮 `#8CDA4A` / `#5FA832`；
  HUD 分数/最高分/MISS 数用 14px Montserrat（不换字体）。

### 宿主 harness（10 条全绿，原始输出）

```text
PASS lcd ghost geometry bounded (A=124, B=99) + lit/ghost split
PASS lcd dual state machines independent
PASS lcd bread catch + score
PASS lcd MISS count + 3-miss game over
PASS lcd bread 3-stage fall + phase wrap
PASS lcd lane collision = one-hit game over
PASS lcd lane clamp + dodge scoring
PASS lcd MODE switch cleanup + score preservation + reset
PASS lcd score KV (<=15 char key, graceful failure)
PASS lcd canvas/ghost-once/dirty budget, A+B swipes, MODE button
ALL LCD_DUAL HARNESS CASES PASSED
```

ghost 层断言包含：`pathDefine` 全程只 2 次、后续帧 `pathDraw` 回放、单帧脏区
≤ 0.5 全帧；两状态机独立（step A 不改 B、step B 不改 A）。

### `node tools/lume/lume.js check examples/lcd_dual`（原始输出）

```text
lume check examples/lcd_dual

[PASS] bundle   6980 bytes (23 ms)
[PASS] eval     2x "app eval ok; entering event loop"
[SKIP] layout   no layout expectations for lcd_dual
[SKIP] perf     profile disabled

screenshot: artifacts/check/lcd_dual/tft.png
RESULT: PASS (4 steps, 0 failed; exit 0)
```

### 10 s emu 冒烟（原始输出节选）

```text
bundle /tmp/lume-r69-wt/examples/lcd_dual: source 6980 bytes; payload 6980 bytes; frame 6992 bytes (source)
I (2992) lume-engine: runtime up; eval app '<embedded-demo>' (6980 bytes)
I (2992) lume-engine: app eval ok; entering event loop
[emu] stop: Halted — core0 752158024 + core1 90784380 insns in 23.7s wall = 35.6 Minsn/s; emulated 10.000s (2400000000 cycles); 486342 exceptions, 28605 interrupts
TFT: /tmp/lume-r69-wt/artifacts/emu/lcd_dual/tft.png
```

串口事件（原始）：

```text
I (2991) lume-engine: js: LCD GAME=a score=0 miss=0
I (3396) lume-engine: js: LCD SPAWN col=0
I (4002) lume-engine: js: LCD GAME=a score=0 miss=0
I (4609) lume-engine: js: LCD MISS 1
I (5014) lume-engine: js: LCD GAME=a score=0 miss=1
I (5518) lume-engine: js: LCD PERF js_avg_ms=1.00 js_max_ms=1
I (7842) lume-engine: js: LCD MISS 3
```

满足 `LCD GAME=<a|b> score=<n> miss=<m>` 口径（每 10 tick + 每个得分/漏接
事件各一条）。MODE 切换另发 `LCD MODE b`，emu 注入底部 tap 实证：

```text
I (3798) lume-touch: touch p=(240,446) raw=(446,240)
I (4004) lume-engine: js: LCD MODE b
```

### Vision 核验

- **GAME A**（`artifacts/emu/ui-refresh/lcd_dual.png`）：顶部三行幽灵面包
  轮廓与底部五列幽灵厨师轮廓以暗绿常显、形状可辨；中央一列一个亮绿厨师
  点亮，幽灵/激活对比强烈；HUD `LCD DUAL / GAME A SCORE 0 HI 0 MISS 3/3`、
  `GAME OVER - TAP TO RESTART`、`GHOST SEGMENTS: dim = all positions, bright = driven`
  可读。
- **GAME B**（`artifacts/emu/ui-refresh/lcd_dual_game_b.png`，emu 注入 MODE tap
  后截图）：三条横向车道、各车道幽灵跑者/障碍槽位暗绿可辨；中央车道一个亮绿
  跑者、亮绿障碍块可见；MODE 切换帧做了一次全屏重绘，无旧模式亮段残留。
- 两图均无黑块/缝隙、无 AA，幽灵段可见性满足辨识度核心要求。

## C. 共同验收

### 全量 harness

```text
JS_HARNESS_COUNT=33 JS_HARNESS_FAILURES=0
```

### Playground 四处同步（原始输出节选）

`node tools/playground/build.mjs`：

```text
PASS bundle sokoban 7834 bytes
PASS bundle lcd_dual 6980 bytes
PASS esbuild-wasm assets and 26 editable sources
PASS prelude 60379 bytes; 26 apps
```

`PLAYWRIGHT_MODULE=/tmp/lume-playwright/node_modules/playwright node tools/playground/verify.mjs`：

```text
PASS page loads without JavaScript errors
PASS rounded square device frame
PASS editor compiles default and changed source, then reports syntax errors
PASS hash restores editor source and share copies reloadable URL
PASS oversized source keeps existing share hash
PASS counter button updates count without errors
PASS snake screen tap and swipe do not throw
  ...
  sokoban: 9 nodes
  lcd_dual: 7 nodes
PASS all examples load without runtime errors
```

四处：build.mjs apps 列表（24→26）、page.js picker（两行）、index.html
script 标签（两个 `apps/*.js`）、verify.mjs 计数 24→26；`sources.js` /
`apps/*.js` / `sources/*.js` 生成产物已更新并纳入提交。

### 浏览器交互烟测（独立临时脚本，原始输出）

```text
PASS sokoban swipe moves the box (HUD move counter increments)
PASS sokoban RESET button restores move counter
PASS lcd_dual loads GAME A and MODE tap switches to GAME B
PASS lcd_dual swipe up in GAME B does not throw
```

浏览器 runtime 纯 canvas + 手势 + KV no-op 桩兜底路径实测可跑；MODE tap 切
GAME B 无按钮/画布双触发（冲突化解实证）。

## 诚实登记

- **真机 pending board**：点屏/色彩、幽灵段真机可见度与对比、swipe/tap
  阈值手感、真机帧率、音效（两 app 未加）、KV 跨电源持久化、bundle 推送。
  host harness + `lume check` + 26-app 浏览器 verify/交互 + esp32sim 截图均
  ≠ 真机验收。
- **IP**：Sokoban 关卡为自研 ASCII 谜题，未复制商业关卡集；像素造型为自研
  近似。LCD 为「segment LCD style」自研造型，**不复制 Nintendo Game & Watch
  原机外形、不逐像素复刻原版位图、不使用商标**。文档只用自研口径、不点名
  原商标。
- **字体**：14px Montserrat 沿用，不换像素字体。
- **简化登记**：玩家瞬移+高亮、死锁仅角位检测、LCD 无音效、MODE 走画布
  tap 区而非 LVGL Button、幽灵段静态上传一次。详见
  `docs/KNOWN-SIMPLIFICATIONS.md`（r69 条）。
