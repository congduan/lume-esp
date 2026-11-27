# r219 报告：r218 Deferred 四项收口刀（StatusBar 圆屏收紧 + Piano 单八度 + Clock/Watchface 豁免登记）

## 0. 基线与口径

- **基线**：`origin/main` `8b74024`（2026-11-28，r218 安全区普查收官刀已合入推送），工作树 `/tmp/lume-r219-wt`，分支 `r219-safearea-deferred-closure`，开工时工作树干净。
- **本轮范围**：按主控决策一次性收口 `docs/r218-report.md` §3 登记的全部 4 项 deferred：
  1. `shell.StatusBar` round 形态收紧至 `[75, 405]` 安全方块内（采用方案 A），并同步适配 `examples/shell_demo/app.js` 与 2 份测试锚点；
  2. `examples/piano/app.js` 改单八度 7 白键 + 5 黑键落入 `[79..401]`（`IN_SAFE`），并迁移 `tests/piano.js` 锚点；
  3. `clock` 与 `watchface` 零代码改动，正式登记为方屏对照豁免项。
- **诚实口径**：全部结论仅由 **宿主机 harness（102 份 `tests/*.js` 全量回归）、esbuild IIFE + `prelude_runner` 几何 dump、Playwright 74-app playground 验证、`lume check --no-emu` 与 `scripts/check_website.py`** 支撑；**未动 `firmware/`、prelude 与 vendored，未跑 `idf.py build`，无真机验收**。480×480 AMOLED 圆屏上的实机观感、触控精度、音频 handoff 听感等一律 deferred 到 board bring-up；本报告不构成硬件验收。

---

## 1. 任务一：`shell.StatusBar` round 形态圆屏收紧（采用方案 A）

### 1.1 改动设计与级联范围实证

- **组件改动（`runtime/shell.js` L189–205、`runtime/types/lume.d.ts` L237）**：
  - 将 `StatusBar` 的 `margin` 由 `shape === 'round' ? 0 : 24` 调整为 `shape === 'round' ? 8 : 24`。
  - **严格限定影响面**：仅改变 `shape === 'round'`；`shape === 'square'`（含 `480×480` 经典 `432×56 @(24,24)` 与 `368×448` `320×56 @(24,24)`）字节级零改动；`SafeArea` / `safeInsets` 零改动，既有 `SafeArea` 消费方（`control_center`、`launcher_grid` 等 r200 视觉已 PASS 项）零改动。
  - **与 `Launcher` 天然像素对齐**：`runtime/shell.js` `Launcher({shape:'round'})` 的列表网格已采用 `listX = bx + 8`（`78`）、`listWidth = side - 16`（`323`）与 `roundTop = by + 56`（`126`）；收紧后圆屏 `StatusBar` 落于 `x=78, w=323`（`[78..401]`），当 `Launcher` 传入 `height: 48` 时底边恰好落于 `y = 78 + 48 = 126 === roundTop`，与 `edit` 按钮及列表区零重叠、左右齐平。
- **级联实测**：全量 102 份 `tests/*.js` 回归中，**仅 `tests/statusbar_round.js` 与 `tests/shell_components.js` 2 个文件受几何锚点变更影响**（远低于「≥3 个其他消费方测试退回方案 B」的熔断线），确认采用方案 A。
- **`examples/shell_demo/app.js` 适配**：传入 `shape: 'round'`，并将根 flex 容器调整为 `padding: 0, paddingTop: 144, paddingBottom: 76, gap: 10`，使居中内容列（`Home` / `page 1 / 3` / `Next` / `Dialog` / `Toast`，`y = 162..386`）与顶部 `StatusBar`（`y = 78..134`）保持 `28px` 间距、零压盖且全部 `IN_SAFE`。
  - 注：`shell_demo` 中 `EdgeNavigation` 的左右 24×64 侧滑指示画布（`[0..24, 208..272]`、`[456..480, 208..272]`，`Rmax=242.1`）在静态无拖拽时为全透明空画布，贴边捕获侧滑手势属 `EdgeNavigation` 组件设计意图（同 `docs/r218-report.md` §3 说明）。

### 1.2 实测几何 dump（原始输出见 `artifacts/r219/statusbar-round-dump.txt` 与 `artifacts/r219/geometry-after.txt`）

| 形态 / 场景 | 改前坐标与 `Rmax` | 改后实测坐标与 `Rmax` | 判据 |
|---|---|---|---|
| `StatusBar(round, h=56, 480×480)` | `339×56 abs=[70..409,70..126] Rmax=240.4`（微出圆 0.4px） | **`323×56 abs=[78..401,78..134] Rmax=229.1`** | `IN_SAFE [75,405]`, `IN_R233`, `IN_R240` |
| `StatusBar(round, Launcher h=48, 480×480)` | `339×48 abs=[70..409,70..118] Rmax=240.4` | **`323×48 abs=[78..401,78..126] Rmax=229.1`** | `IN_SAFE`, 对齐 `Launcher` `[78..401]` 与 `roundTop=126` |
| `StatusBar(round, h=56, 1.75C 466×466)` | `329×56 abs=[68..397,68..124] Rmax=233.3` | **`313×56 abs=[76..389,76..132] Rmax=222.0`** | 严格落于 466px `R=233` 圆内与 `SafeArea` 内 |
| `StatusBar(square, 480×480)` | `432×56 abs=[24..456,24..80]` | **`432×56 abs=[24..456,24..80]`** | 零回归 |
| `StatusBar(square, 368×448)` | `320×56 abs=[24..344,24..80]` | **`320×56 abs=[24..344,24..80]`** | 零回归 |
| `shell_demo` 内容列 & 3 按钮 | `StatusBar` `Rmax=305.5`；按钮 `180×48` | `StatusBar` `Rmax=229.1 IN_SAFE`；`Home`..`Toast` `[150..330,162..386]` `Rmax=171.5 IN_SAFE`，3×`180×48` `r=12` | 无压盖，全部内容/交互 `IN_SAFE` |

---

## 2. 任务二：`examples/piano/app.js` 单八度改造 + 数学豁免登记

### 2.1 方案与几何实测（原始输出见 `artifacts/r219/piano-keys-dump.txt` 与 `artifacts/r219/geometry-after.txt`）

- **单八度布局**：由双八度 14 白键 + 10 黑键（`476px` 宽，外侧 `C`/`B` 键 `Rmax=258.2 OUT_R240`）改为单八度 **7 白键（C/D/E/F/G/A/B）+ 5 黑键（C#/D#/F#/G#/A#）**：
  - 白键：`KB_X = 79, WHITE_W = 46, KEY_Y = 148, WHITE_H = 190`；总宽 `7 × 46 = 322 px`，精确居中于 `[79..401, 148..338]`，外侧键 `Rmax = 188.5`，全部 `IN_SAFE [75,405]`、`r=6 ≤ 12`、高 `190px ≥ 2×48px`。
  - 黑键：`BLACK_W = 28, BLACK_H = 114`，坐落于 `C/D/F/G/A` 键缝（`[111..139]` 至 `[341..369]`，`y = [148..262]`），外侧 `Rmax = 158.4`，全部 `IN_SAFE`、`r=5 ≤ 12`、高 `114px ≥ 2×48px`。
  - 命中判定增强：`semitoneAt(x, y)` 在下半白键区（`y > KEY_Y + BLACK_H = 262`）直接命中完整 `46px` 白键，上半区（`y <= 262`）优先命中黑键，避免点按白键底部误触黑键。
  - HUD 与底栏 4 控制键：`TOUCH PIANO` `[130..350, 78..106]`、`OCT C4   LAST --` `[84..396, 112..136]`；`DEMO` / `C3` / `C4` / `C5` 共 4 枚按钮（`72×48`, `r=8`, `[84..396, 348..396]`, `Rmax=220.6`），全部 `≥48×48`、`r≤12`、`IN_SAFE`。
  - 清理 `examples/piano/app.js` 与 `tests/piano.js` 注释中的 3 处非 ASCII 破折号，实现全文件 `ASCII = 0`。
  - `artifacts/r218/audit.js` 复审结果：`piano` 状态由 `OUT_R240(6) OUT_SAFE(12) NON_ASCII(2) MAX_R=258.2` 变为 **`CLEAN (MAX_R=220.6, OUT240=0, OUTSAF=0, T<48=0, R>12=0, NASC=0)`**。

### 2.2 键宽 `<48px` 数学豁免证明（沿用 r217 10 列 QWERTY 先例）

1. **白键宽几何上限**：480×480 圆屏安全方块 `[75, 405]` 的总宽度为 $W_{\text{safe}} = 405 - 75 = 330\text{ px}$（目标收紧区间 `[76, 404]` 为 `328 px`）。单八度 7 枚白键水平单行排列，设单键宽为 $w$、键间距为 $g \ge 0$，必满足：
   $$7w + 6g \le 330 \implies w \le \left\lfloor \frac{330}{7} \right\rfloor = 47\text{ px} < 48\text{ px}$$
   若要求 $w \ge 48\text{ px}$，则 $7 \times 48 = 336\text{ px} > 330\text{ px}$，数学上无法落入 `[75, 405]` 安全方块内。本轮取最大对称偶整数键宽 **`46 px`**（居中 `[79..401]`，仅差 2px 达 48px，高于 r217 QWERTY 的 44px 键宽），配合 `190 px` 键高（`3.96 × 48 px`）与下半区纯白键命中，诚实登记 `2 px` 宽度数学豁免。
2. **黑键宽几何约束**：相邻黑键（如 `C#`/`D#`、`F#`/`G#`/`A#`）中心步距等于白键宽 `46 px < 48 px`，若黑键宽 `≥46 px` 将在物理上彼此重叠；取 `28 × 114 px`（约 `0.61 × WHITE_W`，符合钢琴黑键比例且高度 `≥ 2×48 px`），相邻黑键净间距 `18 px`，登记同类几何豁免。

### 2.3 Piano 逐键实测坐标摘要（摘自 `artifacts/r219/piano-keys-dump.txt`）

| 类别 | 数量 | 尺寸 (`W×H`) | 坐标范围 `[x0..x1, y0..y1]` | `Rmax` | 判据 |
|---|---|---|---|---|---|
| 白键 `C..B` | 7 | `46×190` | `[79..125]` .. `[355..401]`, `y=[148..338]` | `188.5` | `IN_SAFE`, `h≥96`, 宽 `46px` 数学豁免 |
| 黑键 `C#..A#` | 5 | `28×114` | `[111..139]` .. `[341..369]`, `y=[148..262]` | `158.4` | `IN_SAFE`, `h≥96`, 宽 `28px` 几何豁免 |
| 控制键 `DEMO`/`C3`/`C4`/`C5` | 4 | `72×48` | `[84..156]`, `[164..236]`, `[244..316]`, `[324..396]`, `y=[348..396]` | `220.6` | `IN_SAFE`, 4/4 `≥48×48`, `r=8≤12` |

---

## 3. 任务三：方屏对照豁免登记（`clock` / `watchface`，零代码改动）

按主控决策，以下 2 项 `docs/r218-report.md` §3 deferred 正式登记为**方屏设计意图对照豁免**，不改 app 代码、不改既有测试：

| App | r218 实测指标 | 豁免理由（对照 r218 §3 与 r205） | 对应圆屏替代品 | 代码/测试改动 |
|---|---|---|---|---|
| **`clock`** | `Rmax=267.7`, `OUT_R240=2`（`300×300` 表盘下方数字时间/日期行延至 `y=418`） | 保留为 480 方屏模拟+数字时钟对照样本（与 `mario`/`golf` 满幅场景同属设计意图豁免），且受 `tests/sntp_consumers.js` 守卫。 | `clock_round`（r205，刻度 `Rmax=178.5`） | **0 改动** |
| **`watchface`** | `Rmax=328.1`, `OUT_R240=2`（`SYNCING` `(8,8)` 与 `modular` 四宫格方屏表盘） | `tests/watchface.js` 硬锁 canvas 像素预算 `228544 / 230400`、retained-path 节点 ID `10`/`14` 及中文化显示断言（`'23°'`/`11月28日`/`步`）；改动成本高且与全文件 ASCII 门禁冲突，保留为方屏多表盘对照样本。 | `clock_round`、`aurora_clock`（r205） | **0 改动** |

至此，r218 遗留的 4 项 deferred 全部收口完毕（2 项代码修复清零 + 2 项正式登记方屏豁免）。

---

## 4. `tests/` 断言迁移对照（语义零弱化）

| 测试文件 | 迁移位置 | 旧锚点 | 新锚点 | 语义检查 |
|---|---|---|---|---|
| `tests/statusbar_round.js` | L48–75 | 466 圆屏 `bar.w === 329 === safe.w`, `(68, 68)` | 466 圆屏 `bar.w === 313 === safe.w - 16`, `(76, 76)` + 角点 `R≤233` 断言；**新增** 480 圆屏 `323×56 @(78,78)`、`[75,405]` 与 `R≤233` 断言 | 保留全部负向/异常/signal/dispose 断言，只增不减 |
| `tests/shell_components.js` | L61–65 | `Launcher({shape:'round'})` bar `w=339, x=70, y=70` | bar `w=323, x=78, y=78`（与 `listX=78` 一致） | 其余 19 项与 edit/list/badge 断言原样不变 |
| `tests/piano.js` | L46–108 | 14 白 + 10 黑、`WHITE_W*14 === 476`、`KB_X+476<=480`、点击 `x=240`→`C5`、`whiteNodes[7]`、`octaveLabel()==='C5-C6'` | 7 白 + 5 黑、`WHITE_W===46`、`WHITE_W*7===322`、`KB_X===79`、白/黑键 `IN_SAFE [75,405]` + `h≥96` + 四角 `R≤233` 断言；点击 `C4` (`102,275`) 与黑键 `C#4` (`125,200`)；`whiteNodes[0]` in-place 高亮；4 键滑音去重（含同键重复采样）；八度切换 `C4→C3/C5` | 10/10 断言组完整保留，新增黑键点按与 `IN_SAFE`/`R≤233` 硬约束 |

---

## 5. 验收硬指标汇总（原始输出见 `artifacts/r219/`）

| # | 验收项 | Artifact 文件 | 实测结果 |
|---|---|---|---|
| 1 | 改前全量回归 | `full-regression-before.txt` | `for t in tests/*.js`：**`TOTAL_FAIL=0`（`REGRESSION DONE`）** |
| 2 | 改后全量回归 | `full-regression-after.txt` | `for t in tests/*.js`：**`TOTAL_FAIL=0`（`REGRESSION DONE`）** |
| 3 | StatusBar round 几何 dump | `statusbar-round-dump.txt`、`geometry-after.txt` | `480×480` round：`323×56 abs=[78..401,78..134] Rmax=229.1 IN_R=true IN_SAFE=true`；`466×466` round：`313×56 abs=[76..389,76..132] Rmax=222.0` |
| 4 | Piano 单八度几何 dump | `piano-keys-dump.txt`、`geometry-after.txt` | 7 白键 `46×190`（`[79..401,148..338]`, `Rmax=188.5`）、5 黑键 `28×114`（`Rmax=158.4`）、4 控制键 `72×48`（`Rmax=220.6`），`audit.js` 判定 **`CLEAN`** |
| 5 | `lume check --no-emu` | `check-shell_demo.txt`、`check-piano.txt` | `shell_demo`（`30335 bytes`）与 `piano`（`4417 bytes`）均 **`RESULT: PASS (4 steps, 0 failed; exit 0)`** |
| 6 | Playwright 74-app Playground | `playground-verify.txt` | `NODE_PATH=... node tools/playground/verify.mjs` 全部 **PASS**（74/74 apps 加载零错，含 `piano: 34 nodes`、`shell_demo: 14 nodes`） |
| 7 | 网站一致性检查 | `check-website.txt` | `examples.html gallery up to date (74 cards)`；`API missing / invented / duplicates / signatures not found: none` |
| 8 | ASCII 门禁 | `ascii.txt` | 8 份涉改 JS 文件（`runtime/shell.js`、`examples/{shell_demo,piano}/app.js`、`tests/{statusbar_round,shell_components,piano}.js`、`website/playground/sources/{shell_demo,piano}.js`）`grep -cPn '[^\x00-\x7F]'` 全部 = **0**（注：`runtime/types/lume.d.ts` 新增行 L237 为纯 ASCII，文件其余 12 处为既有历史注释未动） |
| 9 | Manifest + OTA 守卫（回退后） | `playground-manifest.txt`、`ota-consumers.txt` | 回退 `website/playground/apps/` 后 `tests/playground_manifest.js`（74 apps）与 `tests/ota_consumers.js`（18 正向 + 18 mutation）全部 **PASS** |

---

## 6. 范围纪律与提交拆分

- **改动面**：`runtime/shell.js`、`runtime/types/lume.d.ts`、`examples/shell_demo/app.js`、`examples/piano/app.js`、`tests/{statusbar_round,shell_components,piano}.js`、`website/playground/sources.js`、`website/playground/sources/{shell_demo,piano}.js`、`artifacts/r219/`、`docs/r219-report.md`。按 r216 `d4cd368` 先例回退 `website/playground/apps/` 编译包。
- **零越界**：`firmware/`、prelude、vendored、`examples/clock/`、`examples/watchface/` 全部 **0 改动**；未跑 `idf.py build`；未 push；git 身份 `congduan`。
- **提交拆分**：
  1. `feat(shell): tighten round StatusBar 8px inside SafeArea and adapt shell_demo`
  2. `feat(piano): convert piano to single-octave 7x46px layout inside [75,405] safe area`
  3. `test(r219): migrate StatusBar round and single-octave piano geometry anchors`
  4. `chore(playground): re-sync generated source mirrors and sources.js for r219`
  5. `chore(artifacts): record r219 regression, geometry dumps and verification evidence`
  6. `docs(r219): report r218 deferred closure, StatusBar round fix, single-octave piano and exemptions`
