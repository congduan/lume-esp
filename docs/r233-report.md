# r233 报告：方屏 app 边距收口刀（DESIGN-TOKENS 方屏条款 + 32 个 square app 批量收边）

## 0. 基线、实证修正与红线遵守

- **基线**：`origin/main a04862f`（2026-11-28），worktree `/tmp/lume-r233-margin-wt`，分支 `r233-square-margin`。开工前 `git worktree list` 确认与并行会话 `/tmp/lume-r232-wt`（`r232-modular-card-relayout`，改动 round app `watchface`）零交集。
- **源码实证修正（以 `website/playground/page.js` 为准）**：
  - 简报中提及的「43 个 square + 37 个 round」经逐行解析 `website/playground/page.js` 七元组第 7 字段实测，playground 清单共 **74 个 app**：**37 个 `square`** + **37 个 `round`**（`examples/` 其余 9 个目录为非 playground 样本：`ai_chat`、`device_monitor`、`games`、`launcher`、`net_check`、`nettest_open`、`typewriter_min`、`web_config`、`ws_echo`）。
  - 简报背景 grep 中提到的 `heart_curve`、`vec_demo`、`lcd_dual`、`timer_kit`、`dashboard`、`ipod_music` 六个 app 在 `page.js` 中均标为 `'round'`，按红线**一个未碰**。
- **改动面**：`docs/DESIGN-TOKENS.md`、32 个 `square` app 的 `examples/<app>/app.js`、11 个同步几何断言的 `tests/<app>.js`、`tools/playground/build.mjs` 重生成的 `website/playground/{apps,sources,sources.js}`、`artifacts/r233/` 与本报告。
- **红线校验（自动脚本实证）**：
  - `git diff --name-only origin/main -- firmware/ runtime/ tools/` = **0 文件**（未动 prelude / runtime / firmware / tools）
  - 37 个 `round` app 改动数 = **0**；`DESIGN-TOKENS.md` 原有圆屏条款一字未删改
  - 32 个改动 app 的代码字面量非 ASCII 字符数 = **0**
  - 玩法逻辑、数据源、KV key 零改动；未 push；git 身份 `congduan`
- **诚实口径**：本轮所有视觉与几何验收均基于 Playwright 浏览器 480×480 方屏渲染与 host prelude harness，属于 **host/browser 证据，非真机硬件验收**。真机 AMOLED 边缘观感、触控手感、PSRAM 与帧时延仍 deferred to board bring-up。

---

## 1. 任务一：`docs/DESIGN-TOKENS.md` 方屏（480×480 square）条款

在保留原有全部圆屏条款的前提下，补充方屏形态规范：

1. **§0.1 硬性红线按屏幕形态分治**：
   - **圆屏（round）**：原有 329px 内切正方形（`x/y ∈ [75, 405]`，圆几何防裁切约束）一字保留。
   - **方屏（480×480 square）**：页面级安全边距 = **44px**（内容区 `392×392px`，即 `x/y ∈ [44, 436]`，内容占宽 ≥80%，主内容距屏边 ≤48px 达标）；明确约束来源为**纯视觉呼吸约束**而非圆几何裁切，四角可用，禁止机械套用圆屏 75px 边距。
2. **§1.3 间距**：补「方屏（480×480 square）边距条款」，明示 44px 为 4/8 节奏放大档（`480 - 88 = 392px`），并将 round（几何裁切）与 square（视觉呼吸）两种约束来源并列对比。
3. **§3.2 布局与角标**：在原有 HUD 角标 `x/y ∈ [80, 400]` 后明确标注其为 **round 口径**，并补 **square 口径**（距屏边 24–44px、横向全宽与玩法画布可展开至 392px；受 230,400px 画布预算约束时保持原画布仅收拢元素/HUD 锚点）。
4. **§4 Vision 验收量化判据第 1 条**：按 `round` / `square` 分治写入量化门槛。

---

## 2. 任务二：37 个 square app 全量普查、收边明细与画布预算

### 2.1 保持不变的 5 个 square app（实证已达标或刻意单图标标本）

| App | 改动前实测 | 保持原因 |
|---|---|---|
| `gravity_ball` | 480×480@(0,0) 全屏画布 | `BOUNDS = {left:0, top:0, right:480, bottom:480}`，物理球已满屏回弹，无安全区缩进 |
| `typewriter` | root `padding: 28`，L28 T28 R28 B28（宽 88%） | 四周边距已 ≤48px，内容占比 88% |
| `async_demo` | root `padding: 24`，L24 R24（宽 90%） | 极简 2 元素垂直居中 demo，左右边距已 24px |
| `fishtank` | 480×480@(0,0) 全屏画布 | 水草 x∈[45,437]、沙底 0..480、鱼游动范围 x∈[38,442]，已全屏铺满 |
| `svg_icon` | 9 行极简样本，80×80 Image 居中 | 专门验证 mini-SVG 光栅化的单图标标本，非圆屏安全区惯性缩进 |

### 2.2 批量收边的 32 个 square app（前后实测 + 画布预算 + 视觉自检）

DOM 实测来自 `artifacts/r233/audit-{before,after}.json`（Playwright 480×480 方屏模式）；`invaders`/`frogger`/`memory`/`minesweeper`/`flapdot` 的 DOM B 仅计顶栏 Text 节点，其实际下边缘由画布网格/地面决定，已在「说明 / 画布预算」列注明实测下界。

| # | App | Before (L/T/R/B, 宽%) | After (L/T/R/B, 宽%) | 画布预算 (px / 230,400) | 改动摘要与视觉自检 |
|---|---|---|---|---|---|
| 1 | `counter` | 76/74/76/76 (68%) | 44/42/44/44 (82%) | 无画布 | root `padding: 76→44`，card `h: 176→224`。PASS：满而不挤，无裁切 |
| 2 | `power_demo` | 76/76/76/76 (68%) | 44/44/44/44 (82%) | 无画布 | root `padding: 76→44`，card `h: 184→232`。PASS |
| 3 | `ble_uart` | 76/76/76/76 (68%) | 44/44/44/44 (82%) | 无画布 | root `padding: 76→44`，行高 `28→32`，gap `4→6`。PASS |
| 4 | `gestures` | 76/76/76/76 (68%) | 44/44/44/44 (82%) | 无画布 | root `padding: 76→44`，gap `8→10`，2×2 flex 卡自动撑满 392px。PASS |
| 5 | `imu_poll` | 76/76/76/76 (68%) | 44/44/44/44 (82%) | 无画布 | root `padding: 76→44`，3 轴卡 `w: 104→124`（`3×124+2×10=392`），`h: 120→152`。PASS |
| 6 | `calculator` | 76/76/76/78 (68%) | 44/44/44/48 (82%) | 15,792 (376×42) | root `padding: 76→44`，`DISP_W/H: 312×34→376×42`，`KEY_H: 48→56`（总高 388≤392）。PASS |
| 7 | `games_snake` | 120/80/120/80 (50%) | 48/16/48/12 (80%) | 147,456 (384×384) | 恢复 `CELL: 10→16`（24×16=384 方盘 `@(48,52)`），单行顶栏+底注。PASS |
| 8 | `games_2048` | 120/80/120/68 (50%) | 44/16/44/12 (82%) | 无画布 | 棋盘 `240×240→384×384@(48,52)`，tile `54→86`（`4×86+5×8=384`），单行顶栏。PASS |
| 9 | `games_breakout` | 84/78/84/76 (65%) | 44/36/44/34 (82%) | 123,872 (392×316) | 玩法画布 `312×244→392×316@(44,74)`，砖块 `46×18→58×22` 保持 6×6。PASS |
| 10 | `games_tetris` | 78/78/80/78 (67%) | 44/38/44/38 (82%) | 89,216 (200×400+96×96) | `CELL: 16→20`（主画布 `200×400@(46,40)` + 预览 `96×96`），侧栏 `x=266..436`。PASS |
| 11 | `mario` | 84/80/84/82 (65%) | 44/18/44/20 (82%) | 168,960 (480×352 不变) | 画布上移至 `y=52`，HUD 移入顶部黑带 `y=18`，3 键移入底栏 `y=412` 占宽 392px，不再遮挡地面。PASS |
| 12 | `storybook` | 80/78/80/84 (67%) | 44/44/44/44 (82%) | 94,080 (392×240) | 书架与阅读页全宽 `320→392`（`x=44`），阅读画布 `320×196→392×240@(44,80)`。PASS |
| 13 | `pet` | 84/80/84/78 (65%) | 44/40/44/40 (82%) | 230,400 (480×480 顶满) | 画布满预算保持 480×480；HUD/SKIN 键外扩至 `[44,436]`，精灵居中 `OY=136`（保持 `CELL=12` 守住 `tests/pet.js` `hh<=12` 脏区预算）。PASS |
| 14 | `piano` | 79/78/79/84 (67%) | 44/40/44/48 (82%) | 无画布 | `WHITE_W: 46→56`（`7×56=392` 整除对齐 `[44,436]`），`WHITE_H: 190→248`，底 4 键铺满 392px。PASS |
| 15 | `skyfire` | 84/80/84/82 (65%) | 44/24/44/26 (82%) | 230,400 (480×480 顶满) | 画布满预算保持；HUD 移至 `y=24`、底注移至 `y=428`，顺带消除了旧版底注叠压飞船的视觉冲突。PASS |
| 16 | `skycombat` | HUD 84..396/76..404 | HUD 44..436/24..444 (82%) | 230,400 (480×480 顶满) | 画布满预算保持；顶/底 HUD 条扩宽至 `x=44, w=392`（`y=24 / 416`），机头回落至 `y=348`。PASS |
| 17 | `invaders` | 84/80/84 (65%) | 44/32/44 (82%; 底线 y=436) | 230,400 (480×480 顶满) | `PLAY_L/R: 80..400→44..436`，`CELL_W/H: 26→30`，`GROUND_Y: 396→436`，HUD 移至 `y=32`。PASS |
| 18 | `frogger` | 84/80/84 (65%) | 45/16/45 (81%; 网格底 y=452) | 230,400 (480×480 顶满) | 13×13 网格 `CELL: 21→30`（`390×390@(45,62)`），HUD 移至 `y=16/38`。PASS |
| 19 | `abc123` | 80/64/80/76 (67%) | 44/36/44/36 (82%) | 无画布 (SVG Image) | 字形 Image `320×320→360×360@(60,36)`，底部两行文案移至 `x=44, w=392, y=402/424`。PASS |
| 20 | `sokoban` | 84/78/84/80 (65%) | 44/36/44/44 (82%) | 230,400 (480×480 顶满) | 恢复 `CELL: 22→32`（与 32×32 retained sprites 1:1 对齐，顺带消除旧版贴图互叠！），棋盘居中 `@(64,124)`，HUD/3 键占宽 392px。PASS |
| 21 | `memory` | 80/76/168/76 (48%) | 44/18/44 (82%; 网格底 y=462) | 230,400 (480×480 顶满) | `DEAL` 移入顶栏右侧，4×4 棋盘恢复 `CELL: 52→90, GAP: 4→8`（`384×384@(48,78)`，`TS=10` 原比例像素画）。PASS |
| 22 | `minesweeper` | 84/78/84 (65%) | 44/18/44 (82%; 网格底 y=463) | 230,400 (480×480 顶满) | 10×10 网格 `CELL: 25→36, GAP: 2→3`（`387×387@(46,76)`，sprite 缩放 3→4），顶栏顺带消除旧版 `FLAGS` 与 `TAP TO DIG` 文字重叠。PASS |
| 23 | `scroller` | 84/76/84/84 (65%) | 44/6/44/14 (82%) | 168,960 (480×352 不变) | HUD 条移入画布上方黑带 `y=6..52`，双控制键移入下方黑带 `y=418..466`，横版卷轴视口零遮挡。PASS |
| 24 | `raycast` | 84/80/84/84 (65%) | 44/24/44/28 (82%) | 230,016 (480×460+96×96 顶满) | 两画布合计已达 230,016px 保持尺寸不变；HUD/banner/minimap/footer 外扩至 `[44,436]`（`y=24/54/86/428`）。PASS |
| 25 | `particles` | 84/80/84/84 (65%) | 44/32/44/36 (82%) | 230,400 (480×480 顶满) | 顶栏上提至 `y=32..108`，顺带消除旧版 `TAP=BURST` 压住粒子群顶部的重叠；底双键扩至 `w=190, y=396`。PASS |
| 26 | `voice_assistant` | 84/76/84/80 (65%) | 44/40/44/40 (82%) | 70,560 (392×180) | 波形画布 `320×160→392×180@(44,142)`，回答文本下移至画布下方 `y=328` 不再压波形，`TALK` `y=366`。PASS |
| 27 | `flapdot` | 84/80/84 (65%) | 44/20/44 (82%; 画布底 y=480) | 192,000 (480×400 不变) | HUD 移入 `FY=80` 上方黑带（`x=44..436, y=20/48`），蓝天玩法区零遮挡。PASS |
| 28 | `keyboard_demo` | 11/80/11/58 (95%) | 11/44/11/46 (95%) | 无画布 | 顶输入框与提示扩至 `x=44, w=392, y=44..194`，键盘微调至 `y=232`（T44 B46）。PASS |
| 29 | `wordle` | 16/75/16/40 (93%) | 16/32/16/40 (93%) | 58,016 (392×148) | HUD 上提 `y=32..76`（消除旧版与网格轻触），画布 `320×128→392×148@(44,86)`，`CELL: 19→22`，键盘不动。PASS |
| 30 | `mochi` | 84/80/84/80 (65%) | 44/32/44/44 (82%) | 192,000 (480×400 不变) | 页码 `x=352, y=32`，状态文案居中 `x=44, w=392, y=324/352`，`<` / `>` 键扩至 `w=96, y=388`。PASS |
| 31 | `sparkline_demo` | 84/88/84/92 (65%) | 44/44/44/44 (82%) | 70,560 (3×392×60) | 三条迷你折线图 `312×44→392×60`（`x=44`），底栏 `PAUSE` 键落 `y=384..436`。PASS |
| 32 | `app_manager` | 84/84/84/84 (65%) | 44/44/44/44 (82%) | 无画布 | `SAFE: 84→44, CONTENT_W: 312→392`，List 视口高度 `248→324`（`itemHeight=48` / `overscan=1` 不变）。PASS |

---

## 3. Harness 几何断言同步清单（11 份测试，玩法逻辑断言一条未动）

全部 11 份测试均在修改 app 后先复现几何断言 FAIL，再仅同步对应的尺寸/坐标/像素预算断言：

| 测试文件 | 旧断言（圆屏口径） | 新断言（方屏口径） |
|---|---|---|
| `tests/abc123.js` | `yOf` `[368, 386]`；glyph `320×320` | `yOf` `[402, 424]`；glyph `360×360` |
| `tests/frogger.js` | `CELL=21, GX=104, GY=124` | `CELL=30, GX=45, GY=62` |
| `tests/games.js` | tetris canvas `160×320`、dirty `<51200`、pan `x=212` (+32px=2×16) | `200×400`、dirty `<80000`、pan `x=220` (+40px=2×20) |
| `tests/tetris_dirty.js` | `CELL=16`，canvas width `160` | `CELL=20`，canvas width `200` |
| `tests/invaders.js` | `PLAY_L/R 80..400`、`CELL 26`、`CANNON_Y 372`、`UFO_Y 124` | `PLAY_L/R 44..436`、`CELL 30`、`CANNON_Y 410`、`UFO_Y 86` |
| `tests/memory.js` | `CELL=52, GAP=4`，`gridW<=405, gridH<=356` | `CELL=90, GAP=8`，`GX>=44 && gridW<=436, GY>=76 && gridH<=468` |
| `tests/minesweeper.js` | 网格宽 `268`（10×25+9×2），`[75,405]` | 网格宽 `387`（10×36+9×3），`GX>=44 && gridR<=436, GY>=76 && gridB<=468` |
| `tests/piano.js` | `WHITE_W=46, KB_X=79, 7×46=322`，圆屏 `R<=233`，tap `x=102/125/148/...` | `WHITE_W=56, KB_X=44, 7×56=392`，方屏 `[44,436]`，tap `x=72/100/128/...` |
| `tests/sokoban.js` | `CELL=22, GX=97, GY=128` | `CELL=32, GX=64, GY=124` |
| `tests/voice_assistant.js` | `canvas=51200`、`320 * 160` | `canvas=70560`、`392 * 180` |
| `tests/wordle.js` | `40960`、`[0,0,320,128]`、smoke bounds `320×128` | `58016`、`[0,0,392,148]`、smoke bounds `392×148`（键盘 `44/0/16/240` 锁未动） |

---

## 4. 验收与回归证据（原始产物均在 `artifacts/r233/`）

### 4.1 视觉对比产物

- 前后对照单图（共 32×2 = 64 张 + 5 个未动 app 基线图）：`artifacts/r233/shots/<app>-{before,after}.png`
- 4 张高分辨率拼图（每张 8 个 app 左 before / 右 after，全量 32 app 人工 vision 自检完毕）：
  - `artifacts/r233/contact-sheet-1.png`（counter, games_snake, games_2048, games_breakout, mario, calculator, storybook, power_demo）
  - `artifacts/r233/contact-sheet-2.png`（games_tetris, pet, piano, skyfire, skycombat, invaders, frogger, abc123）
  - `artifacts/r233/contact-sheet-3.png`（sokoban, memory, minesweeper, scroller, raycast, particles, voice_assistant, ble_uart）
  - `artifacts/r233/contact-sheet-4.png`（gestures, flapdot, keyboard_demo, wordle, mochi, sparkline_demo, app_manager, imu_poll）
- 整体观感结论：32 个改边 square app 全部从「四周 76–120px 留白、内容缩在中央 50%–68%」转为「边距 16–48px、内容占宽 80%–95%、满而不挤、零裁切、零重叠」，同时顺带清除了旧版圆屏挤压导致的 5 处视觉重叠（`sokoban` 贴图互叠、`minesweeper` 顶栏字重叠、`particles` 提示压粒子、`skyfire` 底注压飞船、`wordle` 提示轻触网格）。

### 4.2 自动化回归原始输出

| 检查项 | 原始结果 | 日志文件 |
|---|---|---|
| `node tools/playground/build.mjs` | `PASS esbuild-wasm assets and 74 editable sources` / `PASS prelude 68299 bytes; 74 apps` | `artifacts/r233/playground-build.log` |
| `python3 scripts/check_website.py` | `HTML pages: 7; API: 162 catalog entries; missing/invented/duplicates/mismatch: none; examples.html gallery up to date (74 cards)` | 终端实测 exit 0 |
| `python3 scripts/gen_examples_gallery.py --check` | `examples.html gallery up to date (74 cards)` | 终端实测 exit 0 |
| `tools/playground/verify.mjs` | **18 PASS / 0 FAIL**（含 74/74 square + 74/74 native-466 加载无报错） | `artifacts/r233/verify.log` |
| `npm test --prefix tools/lume` | `# tests 87 / # pass 87 / # fail 0` | `artifacts/r233/npm-test.log` |
| `for t in tests/*.js`（全量 113 份） | **`TESTS_DONE count=113 fails=0`**（含 `tests/round_corner_audit.js` 实时浏览器 37 round app 审计 PASS） | `artifacts/r233/tests-loop-summary.log`、`artifacts/r233/tests-loop.log` |
| 红线检查（round=0 / forbidden=0 / ASCII=0） | `Changed examples: 32; Round touched: 0; Forbidden dirs touched: 0; Non-ASCII literals: 0` | 本报告 §0 |

---

## 5. 仍未验收（真机 deferred）

真机 Waveshare ESP32-S3-Touch-AMOLED 实屏观感、触控热区手感、QMI8658 / 音频 / 帧率与 PSRAM 峰值均未在板子上验证，保持 deferred to board bring-up。
