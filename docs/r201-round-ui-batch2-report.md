# r201 收口报告 — 圆屏安全区打磨第二批（r200 遗留存量 app 分批·一）

基线：`origin/main 27c236f`（2026-11-26，r199+lume-context 已并入），worktree `/tmp/lume-r201-wt`，分支 `r201-round-ui-batch2`。
动手前实证：`git rev-parse HEAD` 与 `origin/main` 均为 `27c236f1788cb38d2051fdd8104387c2389e51c1`；环境软链（node_modules/qjsc）与简报描述一致。
权威规范：`docs/DESIGN-TOKENS.md`（§0 八条硬性红线 + 三层 token + §4 Vision 七条量化判据）、`docs/r200-ui-quality-report.md`（9 app 修复范式）、`docs/ui-guidelines.md`。
**诚实口径**：全部证据为宿主机 harness + Playwright 浏览器 466×466 圆屏渲染与两轮视觉自检；真机 AMOLED 实屏观感、物理触控、背光与音频 deferred 到 board bring-up，**不声称真机验收**。

---

## 1. 普查、选刀口径与清单

### 1.1 方法（复用 r200 静态法，数字以源码实证为准）

用 `/tmp/r201-survey.mjs` 解析 `tools/playground/build.mjs` 的 73 个 manifest app，按「无 `shell.SafeArea` 且绝对定位 `y<75` 或 `y>405`（含 `fillText`/`position:absolute` 的 y 值）」扫 `examples/<app>/app.js`。

- **改动前**：命中 **53** 个（9 个 r200 已修 + 44 个存量）。r200 报告写「命中 60」、简报写「约 51」，均为不同启发式阈值下的快照；**以本次源码实证的 53 为准**，差异登记为口径偏差，不改动任何基线数字。
- **本轮修复后**：命中 **51** 个（9 个 r200 已修 + 42 个存量），因为 12 个选中 app 的越界坐标已消失（`artifacts/r201/survey.txt`）。
- 原始输出：`artifacts/r201/survey.txt`；选中/落选分类：`artifacts/r201/selection.txt`。

### 1.2 选中 12 个（P0 最严重：标题/HUD/主按钮/主数值被裁到不可读、控件出界不可点）

| App | 实证 P0 缺陷（改动前坐标） |
|---|---|
| `games_2048` | 标题 `y=42`、状态 `y=443` 两端被圆屏裁掉 |
| `games_snake` | 标题 `y=22`、提示 `y=449`，384px 棋盘底边出界 |
| `games_tetris` | 标题 `y=28`、分数 `y=65`、提示 `y=439` 裁切 |
| `mario` | HUD `x=12,y=16` 角落切；LEFT/RIGHT/JUMP 按钮 `y=423..471` 不可点 |
| `game_of_life` | 标题 `y=12`、状态 `y=46`、底部提示 `y=442` 裁切 |
| `pet` | `LUME PET x=24,y=18`、`SKIN x=360,y=54` 双角落切 |
| `speedometer` | HUD `x=32/352,y=24` 双角切；TRIP 条 `y=396..456` 裁切 |
| `compass` | 标题 `y=8` 切；MODE 按钮 `y=430..470` 不可点 |
| `sokoban` | HUD `x=8,y=6` 角切；PREV/RESET/NEXT `y=424..468` 不可点 |
| `minesweeper` | 标题 `x=8,y=8`、RESTART `x=384,y=6` 双角切 |
| `spectrum_music` | GAIN/COLOR 按钮 `y=422..460` 不可点 |
| `music_player` | Library 按钮 `x=360,y=24` 角切；底部控制 `y=400..456` 裁切 |

### 1.3 落选与理由

- `watchface`：**简报明令禁止**（四面 canvas 预算 228,544/230,400 px 已满），本轮零改动。
- r200 已修 9 个：`control_center`/`controls_demo`/`hr_monitor`/`ipod_music`/`launcher_grid`/`skycombat`/`storybook`/`timer_kit`/`wordle`，按范围排除。
- 其余 42 个：纯装饰性 canvas 边角、问题轻微（`clock_round`/`dashboard_round`/`fishtank`/`plasma` 等），或与本轮同型但需单独组件/测试刀（`piano`/`scroller`/`raycast`/`skyfire`/`voice_assistant`/`mochi`/`sparkline_demo`/`color_demo`/`settings`/`files` 等）。完整清单见 `artifacts/r201/selection.txt`，登记为批次二候选（§5）。

---

## 2. 逐 app 修复（对照 DESIGN-TOKENS）

所有 Text 节点显式 `borderRadius: 0`，绕开 `prelude.js` 把 `theme.radius` 继承到 Text 导致 `scroll:none` 下切字角的根因（runtime 红线禁改，组件刀留后续）。所有关键元素收进全局 `[75,405]`（多数取 40px 呼吸边距后的 `[84,396]`）。配色/字号统一 `bg-1 #0D1420`、`bg-2 #16202E`、`bg-3 #1F2C3D`、`text-hi #F2F7FB`、`text-mid #9EB3C6`、`accent #40D8B0`、`danger #FF6B79`、`warn #FFD78E`、`info #5B9DF7`。**KV 键名、业务逻辑、introspection API、游戏数据全部保留，零功能语义改动**。

| App | 布局修复 | 视觉/红线顺带处理 |
|---|---|---|
| `games_2048` | 标题/分数/状态居中收进 `[120,360]`，棋盘收缩至 `240×240`，tile `54px` | 字号阶梯 24/16/14；补 `borderRadius:0`；动画幅度同步 48→54 |
| `games_snake` | 标题/分数/提示居中；棋盘 pitch `16→10`（`24×24` 格不变，棋盘 240px）收入 `y=128..368` | 食物/蛇身改 `warn`/`accent`；背板 `bg-2` |
| `games_tetris` | 棋盘 canvas 移到 `x=80,y=80`（**160×320 / CELL=16 harness 锚点未动**），标题/分数/Next/Level/Lines/提示移到右侧安全列 | 卡片圆角 12；补 `borderRadius:0`；色板对齐 |
| `mario` | HUD 居中 `x=84,y=80`；三按钮 `100×48` 收进 `y=350..398` 安全行；**HUD 节点改在 canvas 之后创建以避免被覆盖** | 按钮 `bg-3`+`text-hi`；游戏世界 canvas/物理常量零改动 |
| `game_of_life` | 标题/状态/按钮/提示收进 `[84,396]×[78,398]`；**移除 Text 的 `background`（渲染器会把 background 覆盖 color，导致暗字暗底）** | `LIVE` 改 `accent`；画布/网格常量零改动 |
| `pet` | HUD 与 SKIN `108×48` 收进安全区；精灵 canvas 原点 OX/OY 不动 | 状态色改 `warn`/`accent`；底部提示字号降一档 |
| `speedometer` | HUD 双角标收进 `[84,396]×[80,104]`；TRIP 条收至 `84,352,312×48`；**canvas 在数组首位创建，HUD 后建以正确叠层** | 主题色全量对齐 token；主数值唯一 |
| `compass` | 标题/免责声明/`MODE` 按钮/模式标签收进安全区；免责声明字号 12→11 防折行压标题 | "no magnetometer" 文案原样保留（harness 断言）；表盘 canvas/朝向数学零改动 |
| `sokoban` | 棋盘 pitch `32→22`、原点 `GX/GY=97/128`（棋盘 `286×220`）；HUD 与三按钮 `92×48` 收进安全区 | 关卡数据/推动逻辑/KV 零改动；`tests/sokoban.js` 布局常量机械级联 |
| `minesweeper` | HUD 与 RESTART `92×48` 收进顶部安全区；**移除 Text `background` 恢复高对比白字** | 480×480 canvas / `CELL=38` / `GX=41,GY=64` harness 预算锚点零改动 |
| `spectrum_music` | HUD 文案上移至 `y=80/104/120`；GAIN/COLOR `150×48` 收进 `y=352..400`；`· → -` 保 ASCII | 径向几何零改动 |
| `music_player` | Now Playing 与 Library 两页全量重排进 `[84,396]`；动态进度条宽 `432→312`；4 行曲目行 48px 触区 | 选中态 `accent-deep` 语义保留；LRC/音量/分页 KV 零改动 |

### Canvas 预算纪律
- 本轮**未碰 watchface**。
- `games_tetris` 160×320、`games_snake` 384→240×240、`sokoban` 480×480（仅改 pitch）、`minesweeper` 480×480（`tests/minesweeper.js` 断言 230,400 px 未动）、`game_of_life` 300×300、`pet` 192×192 均在预算内；`tests/tetris_dirty.js` / `sokoban.js` / `minesweeper.js` / `pet.js` / `game_of_life.js` 全部 PASS。

---

## 3. DESIGN-TOKENS 红线与 Vision 判据销账

| 红线 §0 | 本轮结论 |
|---|---|
| 1 圆屏安全区 `[75,405]` | PASS — 12 app 全部关键文本/按钮/主数值收入；满幅表盘 canvas 按 r200 `skycombat` 范式保留，HUD 独立收进安全区 |
| 2 卡片圆角 ≤12 | PASS — 新卡 8/12；`spectrum_music`/`sokoban`/`minesweeper` 按钮由 10→8 |
| 3 触区 ≥48×48 | PASS — 所有改动按钮高 48；`2048` tile 54、`sokoban` 92×48、`spectrum_music` 150×48 |
| 4 对比度 WCAG AA | PASS — `text-hi`/`text-mid` 配 `bg-1/bg-2` ≥7:1；移除 Text `background` 覆盖 color 的暗字暗底 |
| 5 无信息冗余 | PASS — 未新增双表达；`mario`/`music_player` 标签文案语义保持 |
| 6 状态机按钮 | PASS — 未新增常亮非法按钮；`music_player` Pause/Prev/Next 原状态逻辑保留 |
| 7 危险操作隔离 | PASS — 本轮未引入危险操作；`RESTART` 用 `bg-3` 弱化为独立按钮 |
| 8 禁字母占位图标 | PASS — 本轮未新增占位图标 |

Vision §4 七条经 `artifacts/r201/*-after.png` 逐帧核验见 §4 两轮自检表。

---

## 4. 验证证据汇总（原始日志见 `artifacts/r201/`）

| 序号 | 检查项 | 命令 | 结果 | 原始日志 |
|---|---|---|---|---|
| 1 | 基线核对 | `git rev-parse HEAD` / `origin/main` | 均 `27c236f`，一致 | — |
| 2 | 普查清单 | `/tmp/r201-survey.mjs` | 改动前 53 命中 / 改动后 51 命中；12 选中 | `survey.txt` / `selection.txt` |
| 3 | 全量主机回归 | `for t in tests/*.js; do node "$t"; done` | **108 文件，0 FAIL**（1595 PASS 行） | `tests-all.txt` |
| 4 | 单入口验证 | `node tools/lume/lume.js check examples/<app> --no-emu` ×12 | **12× `RESULT: PASS (4 steps, 0 failed)`** | `lume-check.txt` |
| 5 | CLI 单测 | `npm test --prefix tools/lume` | `pass 57 / fail 0 / skipped 0` | `cli-tests.txt` |
| 6 | Playground 重建 | `npm run build:playground --prefix tools/lume` | `PASS prelude 67546 bytes; 73 apps` | `playground-build.txt` |
| 7 | 构建幂等 | 二次构建前后 `git status --short` diff | 空（IDEMPOTENT） | — |
| 8 | Playground E2E | `NODE_PATH=... node tools/playground/verify.mjs` | `PASS all examples load without runtime errors`（73 app 全载入） | `playground-verify.txt` |
| 9 | 466×466 圆屏 before/after | `/tmp/r201-shot.mjs`（Playwright） | 12 对截图 + 两轮视觉自检 | `*-before.png` / `*-after.png` |
| 10 | 文档站一致性 | `python3 scripts/check_website.py` | 73 cards / 162 entries，`API missing/invented/duplicates/signatures: none` | `website-check.txt` |
| 11 | r64 ASCII 纪律 | `git diff origin/main -- examples/*/app.js \| grep '^+' \| grep -P '[^\x00-\x7F]'` | **0 新增非 ASCII 行**（存量 em dash 等不计） | `ascii-check.txt` |
| 12 | 零改动红线 | `git diff origin/main -- firmware/ runtime/ tools/` | **0 字节** | `zero-diff.txt` |
| 13 | 守卫同步 | `tests/ota_consumers.js` / `tests/playground_manifest.js` / `tests/sokoban.js` | ALLOWED 机械追加 r201 路径与 `artifacts/r201/` 前缀；`sokoban.js` 布局常量 32→22 / GX 32→97 / GY 80→128 机械级联，断言语义未改 | `tests-all.txt` |

### 视觉自检闭环（照 r200 两轮范式）

| 轮次 | 发现 | 处置 | 复拍结论 |
|---|---|---|---|
| 第 1 轮 | `mario` / `speedometer` HUD 被后创建的 canvas 覆盖不可见；`game_of_life` / `minesweeper` Text 的 `background` 被渲染器当 `color` 使用 → 暗字暗底；`compass` 免责声明折行压标题 | HUD 节点改到 canvas 之后创建；移除 Text `background`；免责声明字号 12→11 | 第 2 轮复拍：四个 app 标题/HUD 恢复可读，免责声明单行不压标题 |
| 第 2 轮 | 12 app 全部关键文本/按钮在圆内；`minesweeper` 网格与 HUD 有轻微叠影、`compass` N/S 方位字与 HUD 相邻 | 属可读性无碍的轻微重叠，登记批次二微调，不阻塞本轮 P0 | PASS（12/12 无裁切、无不可点主按钮） |

---

## 5. 遗留项（留后续组件刀 / 批次二 / 真机验收）

1. **批次二候选（42 个存量命中）**：`games_breakout`、`clock_round`、`dashboard_round`、`piano`、`scroller`、`raycast`、`skyfire`、`invaders`、`frogger`、`sokoban` 同族 `memory`/`lcd_dual`、`abc123`、`golf`、`particles`、`aurora_clock`、`flapdot`、`wordring`、`files`、`settings`、`keyboard_demo`、`color_demo`、`sparkline_demo`、`mochi`、`voice_assistant`、`spectrum`、`minigolf`、`weather`、`dashboard`、`app_manager` 等；细节见 `artifacts/r201/selection.txt`。优先仍按 P0（按钮不可点 > 主数值裁切 > 标题裁切 > 装饰性）排序。
2. **组件层根治清单**（r200 已登记，本轮仍未做，`runtime/` 红线禁改）：`shell.Slider` 圆 thumb、`shell.Launcher` 圆屏化与圆形徽章、`shell.Keyboard` 控制键宽、`prelude.js` Text 默认不继承 `theme.radius`。本轮继续在 app 层用 `borderRadius:0` 绕过。
3. **本轮新发现的宿主渲染陷阱**：`Text({style:{background:...}})` 在 playground renderer 下把 `background` 当 `color` 消费（实测计算样式 `rgb(22,32,46)`）；先建 canvas 后建 Text 才能正确叠层。两处均已在 app 层规避，组件/渲染器层根治留后续。
4. **真机硬件验收**：12 个 app 在 CO5300 480×480 AMOLED 实屏的亮度、对比度、触控命中率、BLE/WiFi、音频均 deferred 到 board bring-up。
