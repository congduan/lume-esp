# r202 收口报告 — 圆屏安全区打磨批次三（r201 遗留存量 app 分批·二）

基线：`origin/main c3f8aa4`（2026-11-26，r201 已并入），worktree `/tmp/lume-r202-wt`，分支 `r202-round-ui-batch3`。
动手前实证：`git rev-parse HEAD` 与 `origin/main` 均为 `c3f8aa40eb4224556c202a916b9034af6b8f1277`；工作树干净。
权威规范：`docs/DESIGN-TOKENS.md`（§0 八条红线 + 三层 token + §4 Vision 七条判据）、`docs/r200-ui-quality-report.md`、`docs/r201-round-ui-batch2-report.md`。
**诚实口径**：全部证据为宿主机 harness、Playwright 浏览器 466×466 圆屏渲染与两轮视觉自检；真机 AMOLED 实屏观感、物理触控、背光与音频 deferred 到 board bring-up，**不声称真机验收**。

---

## 1. 普查、选刀口径与清单

### 1.1 方法（复用 r201 静态法，数字以源码实证为准）

`/tmp/r201-survey.mjs` 复制为 `/tmp/r202-survey.mjs`（只把 root 改到本 worktree），解析 `tools/playground/build.mjs` 的 73 个 manifest app，按「无 `shell.SafeArea` 且绝对定位 `y<75` 或 `y>405`（含 `fillText`/`position:absolute` 的 y 值）」扫 `examples/<app>/app.js`。

- **改动前**：`TOTAL 73 | OUT-OF-SAFE 51 | CLEAN 22`；其中 9 个 r200 已修 + **42 个存量命中**（简报的「42」由源码实证确认）。
- **改动后**：`TOTAL 73 | OUT-OF-SAFE 46 | CLEAN 27`（`artifacts/r202/survey-after.txt`）。原始命中数只降 5 而不是 15，原因是该启发式把**嵌套 View 内的相对坐标**（如 weather 卡内 `y:6/26`、canvas 内 `y:2`）、**满幅 canvas 原点 `x:0,y:0`** 和**游戏状态坐标**（如 breakout 砖块 `y:22`、golf 逻辑 `y:60`）都当成绝对越界；这些是已知误报，不是本轮修复对象。真正的判据是 before/after 截图与 §5 两轮视觉自检。
- 原始输出：`artifacts/r202/survey-before.txt` / `survey-after.txt`；选中/落选逐项理由：`artifacts/r202/selection.txt`。

### 1.2 选中 15 个（P0 最严重：按钮不可点 > 主数值裁切 > 标题裁切 > 纯装饰性）

| # | App | 实证 P0 缺陷（改动前坐标） |
|---|---|---|
| 1 | `minigolf` | MODE/HIT/RESET/NEXT 四按钮 `y=432..472`，整行在圆屏下缘之外 **完全不可点**；HUD `y=2/22/42` 裁切 |
| 2 | `piano` | 三个八度按钮 `y=404..452` **不可点**；标题 `y=16`、副标题 `y=52` 裁切；DEMO 仅 44px 高 |
| 3 | `invaders` | HUD `y=6/24` + 提示 `y=462` 被圆边裁切（r200 skycombat 同型）；满幅 canvas 保留 |
| 4 | `lcd_dual` | MODE 绘制于 `y=418`、点击区 `e.y>=410`，落在圆外；HUD `y=6/24/46` 裁切 |
| 5 | `flapdot` | HUD `y=4/6/30` 顶部裁切；满幅 canvas 保留 |
| 6 | `particles` | STIR/MODE 按钮 `y=432..472` **不可点**；HUD `y=6/36/66` 裁切 |
| 7 | `scroller` | JUMP/DASH 按钮 `y=416..472` **不可点**；HUD 条 `x=4,y=4` 与文字 `y=8/28` 角落裁切 |
| 8 | `weather` | 刷新按钮 `x=368,y=26`（88×56）右上角裁切；城市/状态 `y=28/58`；三条预报行底到 `y=444` 裁切；gutter 24 |
| 9 | `games_breakout` | 与 r201 snake/2048 同 P0 类：标题 `y=22`、分数 `y=63`、提示 `y=449` 裁切；384×350 棋盘 `x=48..432` 出安全方块 |
| 10 | `raycast` | HUD `y=5`、横幅 `y=54`、底栏 `y=446` 裁切；小地图 `x=8,y=48`；三个 Text 全带 `style.background` → 渲染器暗字暗底（r201 陷阱） |
| 11 | `skyfire` | HUD `y=6` + 底栏 `y=448` 裁切；满幅 480×480 canvas 保留 |
| 12 | `abc123` | 顶栏 `y=18` + 提示 `y=440` 两条关键文本裁切；字形顶部 `y=64` 略切；整屏 tap 目标保留 |
| 13 | `spectrum` | 标题 `y=54`、HUD `y=102`、底栏 `y=417` 裁切；canvas `x=40..440` 出界；VU 主值 `x=40` |
| 14 | `keyboard_demo` | 输入框 `x=24,y=48`（432×56）角落裁切；结果 `x=24,y=120`、提示 `x=24,y=172` 均 x<75；`shell.Keyboard` 不动 |
| 15 | `golf` | 五条 HUD 文本 `y=4/6/28` 顶部成组裁切；满幅球场 canvas 保留 |

### 1.3 落选与理由（27 / 42，逐项见 `artifacts/r202/selection.txt`）

- `watchface`：**简报明令禁止**（canvas 预算 228,544/230,400 px 已满），零改动。
- r201 已修 10 个（`games_snake`/`games_2048`/`games_tetris`/`mario`/`pet`/`speedometer`/`compass`/`sokoban`/`minesweeper`/`spectrum_music`）：剩余命中是游戏状态坐标或不变 canvas 几何的**误报**，源码无新 P0。
- `memory`：DEAL 按钮 `y=424` 确为不可点，但 4×4 棋盘被 `tests/memory.js` 冻结在 `CELL=88/GAP=8`（并断言 `gridH<=424` 贴按钮行），376px 棋盘塞不进 330px 安全方块，动它就会改预算锚点 — 留专门刀。
- `color_demo`：`shell.ColorPicker` 是 300×360 @ (90,25)，`tests/color_demo.js` 以绝对坐标 (330,135)/(240,225)/(335,359) 点击；移动 picker 会破坏 harness 锚点 — 留紧凑 picker 组件刀。
- `wordring`：DEL/ENTER/NEW `y=4` 确为不可点，但 5×6 棋盘（GY=56..328）与字母环带（约 340..420）之间**没有空隙放 48px 按钮行**，需重排环带 — 留组件刀。
- `settings`：命中 (x:0,y:0 ×5) 是全屏遮罩背景，误报，无真实越界。
- `dashboard`：2×204px 卡片 + 标题 `y=24` 要重排成单列才能进 312px 安全宽，属布局刀；`dashboard_round`/`clock_round`/`aurora_clock` 仅小角标/纯 canvas 表盘，轻微装饰性裁切。
- `fishtank`/`plasma`：零 Text 节点（T0），纯装饰 canvas 边角。
- `voice_assistant`：TALK 按钮 `y=436` 确为不可点，但其 tap/longpress/pan 与根节点及 BLE/音频逻辑共用，移动按钮需重排手势热区 — 留一轮专门刀。
- `mochi`：两个导航按钮 `y=410..468` 角落裁切，但需与 Text 详情块一起重排成可点卡片。
- `files`：工具栏/预览标题在 `GUTTER=24` 的 flex 列里，预览页是次要页面，需 flex 布局刀。
- `app_manager`：列表行按钮高 30px 且用 `shell.List` 窗口化，可靠修复需列表行组件刀。
- `sparkline_demo`：底栏 `y=444` 仅轻微/cosmetic 裁切，无不可读主数值/按钮。
- `frogger`/`golf` 同型里只取了 `golf`（五条 HUD 成组裁切最重），其余 r200/r201 skycombat 同型重复范式按优先级让位给 15 个选中项。

---

## 2. 逐 app 修复（对照 DESIGN-TOKENS）

所有改动 Text 显式 `borderRadius: 0`，绕开 `prelude.js` 把 `theme.radius` 继承到 Text 导致 `scroll:none` 下切字角的根因（runtime 红线禁改）。所有关键文本/按钮/主数值收进全局 `[75,405]`（多数取 40px 呼吸后的 `[84,396]`）。配色统一 `bg-1 #0D1420` / `bg-2 #16202E` / `bg-3 #1F2C3D` / `text-hi #F2F7FB` / `text-mid #9EB3C6` / `accent #40D8B0` / `danger #FF6B79` / `warn #FFD78E` / `info #5B9DF7`；卡片圆角 ≤12；按钮高 48。**KV 键名、业务逻辑、游戏数据、harness 预算锚点（canvas 尺寸、CELL、GX/GY、picker 点击坐标、字形 320×320 等）全部零改动**，仅做布局/配色级联。

| App | 布局修复 | 视觉/红线顺带处理 |
|---|---|---|
| `minigolf` | HUD 四行收进 `[84,396]`；四按钮改单行 `y=348, h=48, x=84/164/244/324, w=72` | 按钮 `bg-3`+`text-hi`；标题 accent / 提示 warn；球场几何/挥杆物理零改动 |
| `piano` | 键盘 `KEY_Y 160→150`、`WHITE_H 230→190`；标题/副标题 `y=76/108`；DEMO + 三八度按钮共用 `y=348` 安全行（各 72×48） | **白键 x 节距 `KB_X/WHITE_W` 是 harness 锚点，零改动**；删贴边底栏提示；字号 24/16/14 |
| `invaders` | HUD/提示移入 `x=84,y=80/104`；满幅 canvas 与 GROUND_Y/CANNON 物理不动 | 标题 accent、分数 mid、提示 warn；补 `borderRadius:0` |
| `lcd_dual` | HUD 四行移入 `[84,396]`；canvas 内 MODE affordance `y=418→348`、点击区 `e.y>=410→>=344` | 游戏 A/B 几何与 KV 零改动；MODE 文案 warn |
| `flapdot` | HUD 四行移入 `x=84/188/296, y=80/104` | 满幅 canvas 与 GAP 难度曲线零改动；补 `borderRadius:0` |
| `particles` | HUD 三行 `y=80/110/134`；STIR/MODE `148×48 @ y=348, x=84/240` | 粒子物理零改动；按钮 `bg-3` |
| `scroller` | HUD 条/标记/文字及两按钮全移入 `[84,396]`；**HUD 节点改到 canvas 之后创建以正确叠层** | 世界/物理常量零改动；按钮 148×48 |
| `weather` | gutter `24→84`；header 按钮 `x=368,y=26→x=308,y=76,88×48`；hero 卡 `y=132,h=116, radius12`；三指标卡 `96×52 @ x=84/192/300`；三预报行 `y=324+i*28`（末行底 404） | 卡片圆角 20→12；所有 Text 补 `borderRadius:0`；**中文文案原样保留，只改 ASCII 样式行**（r64 ASCII diff 0 新增非 ASCII 行） |
| `games_breakout` | 标题 `y=22→76`；分数/提示移到 `y=356/382`；**HUD 节点改到 canvas/bricks 之后创建以正确叠层** | 根背景与球/板色改 token；384×350 棋盘、物理、砖块数据零改动 |
| `raycast` | HUD/横幅/底栏移入 `x=84,y=80/114/372`；小地图 `x=8,y=48→84,150`；**移除全部三个 Text 的 `style.background`**（r201 渲染器把 background 当 color 的陷阱） | 满幅 480×460 场景 canvas 与 raycast 数学零改动 |
| `skyfire` | HUD `y=6→80`、底栏 `y=448→372`，均 `x=84,w=312` | 满幅 canvas、波次逻辑与实体池零改动 |
| `abc123` | 顶/底两条文字改到字形下方 `y=368/386`（避开白字压白字形）；字形 320×320 与 tap 分区零改动 | harness `yOf` 断言机械级联 `[18,440]→[368,386]`；卡片/洗牌数据零改动 |
| `spectrum` | 标题/HUD/VU/底栏 `x=84,w=312, y=80/114/352/382` | 400×200 canvas 是 harness dirty-rect 锚点，零改动 |
| `keyboard_demo` | 输入框/结果/提示移入 `x=84,y=80/144/188`；**用 View 作输入框底板而非 `Text background`**（同 r201 陷阱） | `shell.Keyboard` 组件本体不动（键宽/底行圆屏裁切属组件刀） |
| `golf` | 五条 HUD 移入 `x=84/160/312, y=80/104/126` | 满幅球场 canvas、挥杆物理与 KV 零改动 |

### 测试守卫机械级联

- `tests/abc123.js`：`yOf` 期望 `[18,440] → [368,386]`（坐标级联，四态/卡牌/静态背景断言语义未改）。
- `tests/ota_consumers.js`：ALLOWED 机械追加 r202 的 15 个 app 路径、15 对 playground `apps/`+`sources/` 生成物、`sources.js`、报告文档，并追加 `artifacts/r202/` 前缀白名单；`BASE` 与全部断言谓词未动。
- 其余 14 个选中 app 的 harness 均不读取布局坐标，零级联。

---

## 3. DESIGN-TOKENS 红线与 Vision 判据销账

| 红线 §0 | 本轮结论 |
|---|---|
| 1 圆屏安全区 `[75,405]` | PASS — 15 app 全部关键文本/按钮/主数值收入，多数取 `[84,396]`；满幅游戏 canvas 按 r200 skycombat 范式保留，HUD 独立收进安全区 |
| 2 卡片圆角 ≤12 | PASS — weather hero 卡 20→12，新增面板 8；其余按钮 8 |
| 3 触区 ≥48×48 | PASS — 所有改动按钮高 48；minigolf/piano 72×48、particles/scroller 148×48、weather 88×48（shell.Keyboard 固有 40px 属组件刀） |
| 4 对比度 WCAG AA | PASS — `text-hi`/`text-mid` 配 `bg-1/bg-2/bg-3`；移除 raycast 的暗字暗底 `background`；abc123 白字避开白字形 |
| 5 无信息冗余 | PASS — 未新增双表达；删 piano 贴边底栏提示 |
| 6 状态机按钮 | PASS — 未新增常亮非法按钮；原游戏状态逻辑保留 |
| 7 危险操作隔离 | PASS — 本轮未引入危险操作 |
| 8 禁字母占位图标 | PASS — 本轮未新增占位图标 |

Vision §4 七条经 `artifacts/r202/*-after.png` 逐帧核验见 §5。

---

## 4. 验证证据汇总（原始日志见 `artifacts/r202/`）

| 序号 | 检查项 | 命令 | 结果 | 原始日志 |
|---|---|---|---|---|
| 1 | 基线核对 | `git rev-parse HEAD` / `origin/main` | 均 `c3f8aa4`，一致 | — |
| 2 | 普查清单 | `/tmp/r202-survey.mjs` | 改动前 51 / 改动后 46（42 存量中选中 15）；误报口径见 §1.1 | `survey-before.txt` / `survey-after.txt` / `selection.txt` |
| 3 | 全量主机回归 | `for t in tests/*.js; do node "$t"; done` | **108 文件，0 FAIL**（`done`，退出 0） | `tests-all.txt` |
| 4 | 单入口验证 | `node tools/lume/lume.js check examples/<app> --no-emu` ×15 + counter | **16× `RESULT: PASS (4 steps, 0 failed; exit 0)`** | `lume-check.txt` |
| 5 | CLI 单测 | `npm test --prefix tools/lume` | `tests 57 / pass 57 / fail 0 / skipped 0` | `cli-tests.txt` |
| 6 | Playground 重建 | `npm run build:playground --prefix tools/lume` | `PASS prelude 67546 bytes; 73 apps` | `playground-build.txt` |
| 7 | 构建幂等 | 二次构建前后 `git status --short` diff | 空（IDEMPOTENT） | — |
| 8 | Playground E2E | `NODE_PATH=... node tools/playground/verify.mjs` | `PASS all examples load without runtime errors`（73 app 全载入，0 page error） | `playground-verify.txt` |
| 9 | 466×466 圆屏 before/after | `/tmp/r202-shot.mjs`（Playwright） | 15 对截图 + 两轮视觉自检 | `*-before.png` / `*-after.png`、`screenshots-before.log` / `screenshots-after.log` |
| 10 | 文档站一致性 | `python3 scripts/check_website.py` | 73 cards / 162 entries，`API missing/invented/duplicates/signatures: none` | `website-check.txt` |
| 11 | r64 ASCII 纪律 | `git diff origin/main -- examples/ \| grep '^+' \| grep -P '[^\x00-\x7F]'` | **0 新增非 ASCII 行** | `ascii-check.txt` |
| 12 | 零改动红线 | `git diff origin/main -- firmware/ runtime/ tools/` | **0 字节** | `zero-diff.txt` |
| 13 | 守卫同步 | `tests/abc123.js` / `tests/ota_consumers.js` | 坐标机械级联 + ALLOWED 追加 r202 路径与前缀，断言语义未改 | `tests-all.txt` |

### 视觉自检闭环（照 r200/r201 两轮范式）

| 轮次 | 发现 | 处置 | 复拍结论 |
|---|---|---|---|
| 第 1 轮（after 首拍） | `scroller` HUD 条被后创建的 canvas 覆盖不可见；`weather` 三指标卡从 x=0 起排、首卡被圆边切；`games_breakout` 分数压在砖块上；`abc123` 白字压在白字形上 | HUD 节点改到 canvas 之后创建；`metricLeft` 起点 0→84；分数移到 `y=356`；两条文字移到字形下方 `y=368/386`（不新增背景 View，避免 harness 节点计数断言） | 第 2 轮复拍：四处问题全部消失 |
| 第 2 轮（after 复拍） | 15 app 关键文本/按钮均落在圆内；`keyboard_demo` 的 `shell.Keyboard` 底行、`invaders`/`golf` HUD 与游戏实体有轻微叠影、谱图 canvas 侧边按锚点保留 | 属组件层/锚点约束下的可读性无碍叠影，登记 §6，不阻塞本轮 P0 | **PASS（15/15 无裁切、无不可点主按钮）** |

---

## 5. 遗留项（留后续组件刀 / 真机验收）

1. **组件层根治清单**（r200 已登记，本轮仍未做，`runtime/` 红线禁改）：`shell.Slider` 圆 thumb、`shell.Keyboard` 控制键宽与圆屏底行、`shell.ColorPicker` 紧凑版、`prelude.js` Text 默认不继承 `theme.radius`。本轮继续在 app 层用 `borderRadius:0` / View 底板绕过。
2. **本轮复踩的宿主渲染陷阱**：`Text({style:{background:...}})` 把 background 当 color 消费（raycast/keyboard_demo 已规避）；**先建 canvas 后建 Text 才能正确叠层**（scroller/games_breakout 本轮再次实证）。
3. **剩余 27 个存量命中**：逐项理由见 `artifacts/r202/selection.txt`；优先仍按 P0（按钮不可点 > 主数值裁切 > 标题裁切 > 装饰性）排序，其中 `voice_assistant`/`wordring`/`memory`/`color_demo` 需先解决手势热区/环带/预算锚点/组件尺寸约束。
4. **静态普查口径**：`/tmp/r202-survey.mjs` 不识别嵌套相对坐标与游戏状态坐标，剩余 46 命中含大量误报；后续若做门禁 lint 需换成理解父子坐标的 AST 版，不应直接拿该数字当缺陷数。
5. **真机硬件验收**：15 个 app 在 CO5300 480×480 AMOLED 实屏的亮度、对比度、触控命中率、BLE/WiFi、音频均 deferred 到 board bring-up。
