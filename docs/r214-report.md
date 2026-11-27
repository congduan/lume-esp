# r214 报告（合并）：圆屏安全区组件刀 + 官网视觉设计升级

> 本轮两条独立分支（r214-safearea-component / r214-site-design）各自产出报告，合并后并置于此。

# r214 报告：圆屏安全区组件刀（dashboard 指标卡 + app_manager 列表/触区）

## 0. 基线与口径

- 基线：`origin/main` `79cded0`（2026-11-27），分支 `r214-safearea-component`，开工时工作树干净。
- **工作树偏离登记（重要）**：派发脚本给出的 `/tmp/lume-r214-wt` 在 21:28 被并发的 `r214-site-design` 轮接管（同一路径被切分支为 `r214-site-design` 并 `reset --hard`，本机 git reflog 为 `79cded0 HEAD@{0}: reset: moving to HEAD`）。为避免覆盖他人工作，本轮按 r213 先例迁到独立 worktree `/tmp/lume-r214-safearea-wt`（同 HEAD `79cded0`、同分支 `r214-safearea-component`）重做全部改动与验证；并发轮的 `website/` 设计文件一律未触碰。
- 全部证据均为 **宿主 harness / prelude_runner / esbuild bundle**；无真机、无截图、未跑 `idf.py build`（本轮零 firmware 改动）。圆屏观感、触感、实际排版像素 deferred 到 board bring-up。

## 1. 实证方法（先实证，再改坐标）

1. 改前用 `tests/lib/prelude_runner.js` 跑真实 app 源码（前置 `runtime/shell.js`、按宿主 harness 惯例剥掉 ESM import 行），dump `create`/`attr` 消息得到真实 `x/y/w/h/text`。脚本随证据归档：`artifacts/r214/geometry_dump.js`，可重放。
2. 改前基线：`for t in tests/*.js` 全量回归 **0 FAIL**；两 app `lume check --no-emu` 均 **RESULT: PASS**；`tests/dashboard_round.js` 原样绿。
3. 改后用同一 dump 逐项对照，并跑全量回归、两 app `lume check`、ASCII、playground manifest、`check_website.py`。原始输出全部在 `artifacts/r214/`。
4. 实测与简报数字一致：`SAFE=40`（app_manager）、dashboard 四卡 `(24,80)/(252,80)/(24,220)/(252,220)` 且 `204x129`、标题 `(24,24)`、traceSpark `(44,44) 340x200`。无偏差需登记。

## 2. 改动前/后坐标对照表（实测 dump，非抄简报）

安全方块为 480 圆屏的 `[75,405]`；区间写作 `[x起点..x终点, y起点..y终点]`。

### 2.1 dashboard（`node N` 为 geometry dump 中的创建序号）

| 元素（node） | 改动前（实测） | 改动后（实测） |
|---|---|---|
| 环形 gauge（3） | `x=78 y=98 w=148 h=148` → `[78..226, 98..246]` | **不变**（按要求不动） |
| 指标卡 BATTERY（8） | `x=24 y=80 w=204 h=129` → `[24..228, 80..209]` | `x=84 y=124 w=150 h=114` → `[84..234, 124..238]` |
| 指标卡 TEMPERATURE（12） | `x=252 y=80 w=204 h=129` → `[252..456, 80..209]` | `x=246 y=124 w=150 h=114` → `[246..396, 124..238]` |
| 指标卡 USB POWER（16） | `x=24 y=220 w=204 h=129` → `[24..228, 220..349]` | `x=84 y=250 w=150 h=114` → `[84..234, 250..364]` |
| 指标卡 UPTIME（20） | `x=252 y=220 w=204 h=129` → `[252..456, 220..349]` | `x=246 y=250 w=150 h=114` → `[246..396, 250..364]` |
| 标题 `LUME HUB`（21） | `x=24 y=24 w=300 h=32` → `[24..324, 24..56]` | `x=84 y=84 w=312 h=32` → `[84..396, 84..116]` |
| 状态行（22） | `x=24 y=364 w=432 h=20` → `[24..456, 364..384]` | `x=84 y=376 w=312 h=20` → `[84..396, 376..396]` |
| `traceSpark`（26） | `x=44 y=44 w=340 h=200` → `[44..384, 44..244]` | `x=84 y=84 w=312 h=200` → `[84..396, 84..284]` |
| 满幅 backdrop（1） | `480x480` | **不变**（装饰性，红线 1 允许出界） |
| Canvas（2） | `x=40 y=40 w=400 h=360` | **不变**（绘图面，本刀未动） |
| 保留的 TRACE 网格 | canvas-local `x0=44 y0=44 w=340 h=200` → 屏幕 `[84..424, 84..284]` | canvas-local `w=312` → 屏幕 `[84..396, 84..284]`，与 sparkline 对齐且不再出界 |

- 右列原右缘 `456 > 405`，右下角 `(456,349)` 圆距约 245 > 240 出圆，即 P0 裁切；改后四卡全部落在 `[84..396, 124..364] ⊂ [75,405]`。
- 列间水平 gap `246 - (84+150) = 12`，行间垂直 gap `250 - (124+114) = 12`，均 ≥8。
- 字号：标签 `13 → 14`、主数值保持 `24`、单位 `11 → 14`，全部落在 DESIGN-TOKENS 阶梯的 `fs-hud=14` / `fs-title=24`；主数值 ≥24，未降档。一屏仅 14/24 两级字号（标题亦为 24）。
- 卡片仍为 150 宽 / 114 高 / `padding:16` / `gap:8` / `borderRadius:12`，内部三行文本合计 `14+24+14+2*8=68 < 114-32=82`，无挤压。
- `traceSpark` 的 `min/max/strokeWidth/showLast/series`、信号 getter、`go()` 显隐逻辑、200 ms 循环、swipe/BOOT 翻页全部未动；仅把屏幕坐标与网格宽度收口。

### 2.2 app_manager（实测 `SAFE=40` 已确认，原右缘 `40+400=440 > 405`）

| 元素（node） | 改动前（实测） | 改动后（实测） |
|---|---|---|
| `< HOME` 按钮（2） | `w=76 h=30`（header 内 flex 定位，x≈50） | `w=88 h=48`（header 内 x≈94，y≈88） |
| header View（4） | `x=40 y=40 w=400 h=44` → `[40..440, 40..84]` | `x=84 y=84 w=312 h=56` → `[84..396, 84..140]` |
| List（5） | `x=40 y=92 w=400 h=348` → `[40..440, 92..440]` | `x=84 y=148 w=312 h=248` → `[84..396, 148..396]` |
| 行内 UNINSTALL/SURE 按钮 | `w=92 h=30`（源头样式） | `w=92 h=48`（源头样式） |
| 列表 spacer（6） | `w=1 h=0`（0 apps） | `w=1 h=0`（不变） |
| 满幅 backdrop（1） | `480x480` | **不变**（装饰性） |

- List 原本不仅右缘 `440 > 405`，底缘 `440 > 405` 也出圆；本刀一并收进 `[84..396, 148..396]`，使整个窗口（含行按钮）落在安全方块内。
- 触区：HOME `88x48`、行按钮 `92x48`，均 ≥48×48；行高 `itemHeight:48` 保持，`renderItem` 的 View 高仍为 48。
- **窗口化未破坏**：`shell.List` 的窗口由 `itemHeight` 与 `style.height` 计算，本轮只改 `style.width/height/x/y`，`itemHeight:48`、`overscan:1`、双次撤销确认 `askRemove()` 与 `lume.apps.home()` 均未动；248px 视口对应约 5 行可见 + overscan 1（原 348px 对应约 7 行 + 1），仍由组件自适应。
- 未改 `runtime/shell.js`（或任何 runtime/ 文件），全部用 app 层样式参数解决。

## 3. DESIGN-TOKENS.md §0 八条红线逐条自查

| # | 红线 | 自查结果 |
|---|---|---|
| 1 | 圆屏安全区 `[75,405]` | **通过（本刀范围）**：两 app 所有被改动的可交互元素与关键文本实测落在 `[84..396]`。dashboard 的 480×480 backdrop、400×360 Canvas 与环形 gauge（原位 `[78..226,98..246]`）按要求保留/未动；Canvas 内部按 canvas-local 绘制的 TRACE/GAUGE/SYSTEM 文本与底部三个 tab（原 `y=400..456`）是既存布局，不属本刀 P0，登记为 deferred（见 §5），本轮未引入新的出界元素。 |
| 2 | 卡片圆角 ≤12px | **通过**：dashboard 指标卡 12，app_manager header/List 10、按钮 8/7，主题 radius 12，无新增更大圆角。 |
| 3 | 触区 ≥48×48 | **通过**：HOME `88x48`、行按钮 `92x48`；dashboard 指标卡为展示卡非按钮，既有 tab 为 `136x56`（尺寸达标，位置遗留见 §5）。 |
| 4 | 对比度 ≥4.5:1 / 大字 ≥3:1 | **通过**：沿用既有调色板（dashboard `#F2F7FB`/`#9EB3C6` on `#132435`；app_manager `#E6EDF3` on `#161B22`），未引入新色；字号 14/24 属阶梯值。 |
| 5 | 无信息冗余 | **通过**：四张卡各一指标，状态行只显示充电态+提示；app_manager 状态文本与列表行各司其职，未新增重复表达。 |
| 6 | 状态机驱动按钮 | **通过**：app_manager UNINSTALL→SURE 的两段式确认未动；dashboard 三 tab 由 `view().page` 唯一高亮，未动。 |
| 7 | 危险操作隔离 | **通过（维持原状）**：UNINSTALL/SURE 次态用独立底色 `#3A1D1D` 且需二次点击，与主导航 HOME 分离；本轮未改颜色与交互。 |
| 8 | 禁止字母占位图标 | **通过**：`< HOME` / `UNINSTALL` / `SURE` / `LUME HUB` 均为文字标签而非 A-Z 图形占位；未新增图标。 |

**三层 token**：本轮未新增 Primitive / Semantic / Component token，仅复用既有色值与字号阶梯；间距 12/16/24/48 均在 §1.3 的 8px 网格内，列宽 150 采用简报给出的两列示例值（非网格倍数，已按简报明示），`84..396` 为安全方块内 9px 呼吸边距。

## 4. 验证证据汇总（原始输出见 `artifacts/r214/`）

| artifact | 结果 |
|---|---|
| `geometry-before.txt` / `geometry-after.txt` | 改前/改后 `create`/`attr` 实测坐标 dump（见 §2；脚本 `geometry_dump.js` 可重放） |
| `full-regression-before.txt` / `full-regression-after.txt` | `for t in tests/*.js` 全量回归改前、改后均 **0 FAIL**，末尾 `REGRESSION DONE` |
| `check-dashboard-before.txt` / `check-dashboard.txt` | `RESULT: PASS (4 steps, 0 failed; exit 0)`，bundle 36492 → 36494 bytes |
| `check-app_manager-before.txt` / `check-app_manager.txt` | `RESULT: PASS (4 steps, 0 failed; exit 0)`，bundle 1512 → 1515 bytes |
| `dashboard_round-before.txt` / `dashboard_round-after.txt` | `tests/dashboard_round.js` 属另一个 app（dashboard_round），改前/改后均原样绿、**零改动** |
| `ascii.txt` | 两个 app.js 的 `grep -cPn '[^\x00-\x7F]'` 均 = **0**（dashboard 原首行注释的 em-dash 按 r213 先例改为 `--`） |
| `playground-manifest.txt` | `PASS playground manifest 74 apps match generated sources and examples; removal/addition mutation caught` |
| `check-website.txt` | `API missing: none` / `API invented: none` / `API duplicates: none` / `API signatures not found in lume.d.ts: none` |

- 全量回归中 `tests/ota_consumers.js`、`tests/playground_manifest.js` 在镜像同步前因**逐字节镜像一致性**断言失败（非坐标断言），同步后全绿；**未改任何测试文件**。`tests/dashboard_round.js` 无任何 dashboard 坐标引用，无需同步。
- `--no-emu` 按 CLI 设计跳过 eval/layout/perf；布局结论来自坐标 dump 与宿主 harness，不冒充布局 lint 或真机截图。

## 5. 偏离与遗留登记

- **工作树接管**：见 §0，已迁到独立 worktree 重做；未 push、未覆盖并发轮改动。
- **生成镜像同步**：`tests/playground_manifest.js` 与 `tests/ota_consumers.js` 均断言 `website/playground/sources/<app>.js` 与 `sources.js` 逐字节等于 `examples/<app>/app.js`。改后同步了 `website/playground/sources/{dashboard,app_manager}.js` 与 `sources.js`（照抄 r213 `cbf8731` 的 `chore(playground)` 先例）；只动生成的应用源码镜像，**未动 website HTML/CSS/生成器**，manifest 仍为 **74** 个 app（未变）。
- **dashboard 既有出界项（本刀未处理）**：底部三个 tab 位于 `y=400..456`（`x=24/172/320`），Canvas 内 `drawGauge/drawTrace/drawSystem` 的文字按 canvas-local 坐标（如 `16,8` → 屏幕 `56,48`）绘制，部分落在安全方块外。这些是 r202 deferred 清单中的其他刀（导航/画布排版），本轮 P0 为指标卡右列裁切，按改动面红线未扩刀；`--no-emu` 无布局 lint，故未在报告中伪造其通过。若后续要收口，应单独立项重排 tab 行与画布内文字坐标系。
- **未做**：未新建 harness、未改 firmware/runtime/prelude/tools/manifest/.d.ts、未跑 firmware build、未 push。

## 6. 诚实口径

所有结论仅由宿主 harness、`prelude_runner` 坐标 dump 与 esbuild bundle 支撑。圆屏上的实际观感、触控手感、卡片内文字换行后的像素效果均**未做真机验证**，deferred 到 board bring-up；本报告不构成硬件验收。

## 7. 提交拆分

- `ee484fd` feat(dashboard)：指标卡列重设计 + 标题/状态行/traceSpark 收口 + 网格宽度对齐
- `5583902` feat(app_manager)：List 收进安全方块 + 两处按钮触区 48px
- `e9606d5` chore(playground)：同步两个生成源码镜像与 `sources.js`
- `fa37065` chore(artifacts)：归档 r214 原始验证输出
- 本报告 `docs/r214-report.md` 单独 commit；未 push。

---

## 附录：r214-site-design 官网视觉设计升级（独立分支合并，报告原文）


- **Round**: r214 (pure design taste & visual craft upgrade; r213 functional baseline preserved)
- **Branch**: `r214-site-design` (from `origin/main` `79cded0`, post-r213 `c3bec0c`)
- **Design Direction**: *Terminal-grade engineering aesthetics* (Linear / Vercel / Raycast craft — elevated surface materiality, disciplined single-family phosphor accent, bento hierarchy, crisp fluid typography, zero consumer-SaaS fluff)
- **Scope**: `website/assets/style.css`, `website/index.html`, `website/examples.html`, `scripts/gen_examples_gallery.py`, `artifacts/r214/`, `docs/r214-report.md`
- **Red Lines Verified Untouched**: `website/playground/`, `website/wasm/`, `website/run.html`, `website/workbench.*`, `website/terminal.js`, `website/netmon.js`, `firmware/`, `runtime/`, `tests/`, `examples/`

---

### 1. Seven-Point Vision Audit Resolution & Self-Review

Baseline from master vision audit on r213: **6.5 / 10**.
r214 post-upgrade vision self-audit across all 11 Playwright screenshots (dark, light, mobile 375px, no-JS, subpages): **8.8 / 10**.

| # | Audit Finding (r213 6.5/10) | r214 Design Upgrade Implemented | Score | Verification Evidence |
|---|---|---|---|---|
| 1 | **Flat card materiality** (plain 1px gray border, flat fill, no specular highlight, no shadow depth, no hover glow) | Dual-background gradient border (`--surface-grad` padding-box + `--border-grad` border-box), 1px top inner specular highlight (`inset 0 1px 0 var(--highlight)`), two-tier contact + ambient depth shadow, and GPU-composited (`opacity` + `transform` only) hover phosphor top sheen (`::before`) & outer halo (`::after`) applied across `.card`, `.demo`, `.arch-node`, `.changelog-strip`, `.examples-toolbar`, `.table-scroll`, and `pre`. | 9.0 / 10 | `artifacts/r214/shots/index-1440.png`, `index-1440-light.png`, `guide-1440.png` |
| 2 | **Unpackaged clashing screenshots** (12 bare frames with clashing palettes + loud `esp32sim` pills) | Unified AMOLED bezel media packaging on `.shot-frame` and `.example-thumb`: 1px gradient glass bezel, subtle inner phosphor rim (`rgba(46, 230, 214, .11)`), radial edge vignette + soft bottom fade scrim (`::after`) that tames high-key captures (2048, Platformer, Breakout) into the obsidian system without distorting firmware pixels. Honest `esp32sim` watermark retained on every real-firmware shot but de-emphasized to resting `opacity: 0.48` (rises to `0.88` on hover). | 8.8 / 10 | `artifacts/r214/shots/index-1440.png`, `examples-1440-top.png`, `examples-1440-featured.png` |
| 3 | **Uniform 4x3 grid without visual anchor** | Upgraded `index.html` 12-shot gallery to an exact gap-free 4x5 asymmetric Bento Grid (`grid-auto-flow: dense`): **Speedometer** (`2x2` top-left) and **Watchface** (`2x2` mid-right) act as circular-dial visual anchors with subtle hover scale (`scale(1.012)`), balanced by 8 standard `1x1` cards and a horizontal `2x1` closing pair (**Weather** + **Raycast 3D**). Mobile 375px flows with zero orphans (Speedometer & Watchface full-width `span 2`, remaining 10 cards in 5 exact pairs). Synced `scripts/gen_examples_gallery.py` with `data-featured="1"` for `speedometer` and `watchface` (2-col horizontal featured cards on `examples.html` while keeping `class="example-card card reveal"` exact for `tests/examples_gallery.js`). | 9.2 / 10 | `artifacts/r214/shots/index-1440.png`, `examples-1440-featured.png`, `index-375.png`, `gen_examples_gallery_check.log` |
| 4 | **Generic cyan + 3 competing accent hues** | Defined signature Lume phosphor cyan -> electric teal brand spectrum (`#48f3e2 -> #16c7d9 -> #0ea5c6` dark; `#087885 -> #066978 -> #06596e` light). Reserved `--brand-grad` strictly for hero/key primary CTAs, `.brand-mark`, and active nav indicator, with true color/luminance shift on `:hover`/`:active`. Converged `.shots-honest-badge` from competing mint green into neutral glass + single phosphor dot, converged `--prog` into the accent family, and restrained 74 `examples.html` card buttons to a crisp accent-tinted surface so the gallery isn't flooded with bright gradients. | 8.8 / 10 | `artifacts/r214/shots/index-1440-hero.png`, `index-1440-light.png`, `examples-1440-featured.png`, `wcag_contrast.log` |
| 5 | **Unbalanced hero & faded H1 line 2** | Extracted What's New out of `.hero-copy` into a full-width horizontal `.changelog-strip` beneath the hero grid (`heroH=321px` vs `demoH=406px`, centered equilibrium). Lifted H1 line 2 ("The firmware stays put.") from muted gray to high-contrast secondary gradient (`#dbe9f2 -> #9eb6c5`, 9.51:1–13.16:1 WCAG AAA on obsidian; `#1b3440 -> #3d5a68` in light). Added multi-layer `.hero-band` atmosphere (radial phosphor spotlight + 40px architectural grid texture at `opacity ~0.035` masked to fade smoothly) + machined bezel specular highlight & ambient phosphor floor glow beneath `.device`. | 9.0 / 10 | `artifacts/r214/shots/index-1440-hero.png`, `index-1440-light.png` |
| 6 | **Micro-typography & scale tension** | Tightened display tracking (`-0.04em` on hero H1, `-0.03em` on section H2, `-0.02em` on H3), separated H1/H2 hierarchy (`46.8px` hero H1 locked cleanly to 2 unbroken lines at 1440px vs `31.68px` section H2 = ~1.48x ratio; subpage H1 `53.6px`), set `white-space: nowrap` on chips/eyebrows/pills, constrained lead/prose measure to `58ch–70ch`, and aligned `faq.html` accordion flush-left with `.page-intro`. | 8.6 / 10 | `artifacts/r214/shots/index-1440-hero.png`, `guide-1440.png`, `faq-1440.png` |
| 7 | **Abrupt section transitions & spacing** | Raised section vertical rhythm to `112px–128px` on desktop (`64px` on mobile). Replaced harsh full-width borders on `.architecture`, `.shots-footer`, and `.site-footer` with luminous center-peaked gradient hairlines (`--hairline-glow`) and soft atmospheric radial blending. | 8.5 / 10 | `artifacts/r214/shots/index-1440.png`, `index-1440-light.png` |

**Honest gaps kept in view (why 8.8/10 and not 10/10)**:
- System font stack is preserved by design (performance red line: zero external webfont downloads).
- Local offline Playwright screenshots abort external `img.shields.io` badge requests; live GitHub Pages renders the SVG badges normally.
- Real-board visual/hardware acceptance remains deferred and honestly disclosed across the site.

---

### 2. Hard Verification Evidence (Raw Outputs)

All raw logs and screenshots are saved under `artifacts/r214/`.

#### 2.1 Website, Gallery & API Doc Checks

From `artifacts/r214/check_website.log`, `artifacts/r214/gen_examples_gallery_check.log`, `artifacts/r214/gen_api_docs_check.log`:

```text
examples.html gallery up to date (74 cards)
HTML pages: 7; internal href/src and anchors checked
API: 162 catalog entries, 162 type declarations, 34 function namespaces
API missing: none
API invented: none
API duplicates: none
API signatures not found in lume.d.ts: none
examples.html gallery up to date (74 cards)
api.html is up to date with lume.d.ts (162 entries)
```

#### 2.2 Gallery Contract & Mutation Harness (`node tests/examples_gallery.js`)

From `artifacts/r214/examples_gallery_test.log`:

```text
PASS examples_gallery: gallery card count equals manifest app count
PASS examples_gallery: one card per app, in manifest order
PASS examples_gallery: every card title / description / link comes from page.js metadata
PASS examples_gallery: every card description keeps bilingual data-en / data-zh attributes
PASS examples_gallery: no stale "Seven" headline or meta description remains
PASS examples_gallery: hardware badge appears exactly where metadata states a board dependency
PASS examples_gallery mutation: one card disappears -> FAIL as expected
PASS examples_gallery mutation: a card drifts out of manifest order -> FAIL as expected
PASS examples_gallery mutation: a card invents a title -> FAIL as expected
PASS examples_gallery mutation: a card loses its bilingual attributes -> FAIL as expected
PASS examples_gallery mutation: the old Seven headline returns -> FAIL as expected
PASS examples_gallery mutation: a hardware badge is dropped from a dependency card -> FAIL as expected
ALL EXAMPLES GALLERY CASES PASSED (74 apps / 74 cards)
```

#### 2.3 CSS/JS Size Budget & ASCII-Only Compliance

From `artifacts/r214/ascii_and_size.log`:

```text
website/assets/style.css: 44075 bytes (delta vs r213 31203B = +12872B), non-ASCII bytes=0
website/assets/site.js: 9962 bytes, non-ASCII bytes=0
```

- Net CSS addition: **+12,872 bytes (~12.57 KiB)** — within `< 15 KB` budget.
- Zero non-ASCII bytes in `style.css` and `site.js`.
- Zero external fonts, images, or JS libraries added; hover/reveal transitions use `transform` and `opacity` only.

#### 2.4 WCAG AA Contrast Verification (Dark & Light Themes)

From `artifacts/r214/wcag_contrast.log` (all 31 foreground/background pairs including brand gradient stops and muted/subtle grayscale):

```text
PASS 18.41:1  DARK text / bg           (#f0f6fa on #05080c)
PASS 13.16:1  DARK text-2 / bg         (#c2d4df on #05080c)
PASS  9.51:1  DARK text-2-end / bg     (#9eb6c5 on #05080c)
PASS  7.84:1  DARK muted / bg          (#8ea5b5 on #05080c)
PASS  7.40:1  DARK muted / surface     (#8ea5b5 on #0b1118)
PASS  6.85:1  DARK muted / surface2    (#8ea5b5 on #111a24)
PASS  6.50:1  DARK subtle / bg         (#7e96a6 on #05080c)
PASS  6.14:1  DARK subtle / surface    (#7e96a6 on #0b1118)
PASS 12.81:1  DARK accent / bg         (#2ee6d6 on #05080c)
PASS 12.10:1  DARK accent / surface    (#2ee6d6 on #0b1118)
PASS 13.51:1  DARK ink / grad-start    (#031518 on #48f3e2)
PASS  9.08:1  DARK ink / grad-mid      (#031518 on #16c7d9)
PASS  6.42:1  DARK ink / grad-end      (#031518 on #0ea5c6)
PASS 11.22:1  DARK ok / surface        (#3ee0a8 on #0b1118)
PASS 11.36:1  DARK warn / surface      (#fbbf24 on #0b1118)
PASS 11.58:1  DARK prog / surface      (#38e0d8 on #0b1118)
PASS 17.08:1  LIGHT text / bg          (#09171e on #f5f8fa)
PASS 10.69:1  LIGHT text-2 / bg        (#243d4a on #f5f8fa)
PASS  6.60:1  LIGHT muted / bg         (#455c68 on #f5f8fa)
PASS  7.04:1  LIGHT muted / surface    (#455c68 on #ffffff)
PASS  6.22:1  LIGHT muted / surface2   (#455c68 on #ebf2f5)
PASS  5.84:1  LIGHT subtle / bg        (#4d6470 on #f5f8fa)
PASS  6.23:1  LIGHT subtle / surface   (#4d6470 on #ffffff)
PASS  5.60:1  LIGHT accent / bg        (#066e7a on #f5f8fa)
PASS  5.97:1  LIGHT accent / surface   (#066e7a on #ffffff)
PASS  5.20:1  LIGHT ink / grad-start   (#ffffff on #087885)
PASS  6.36:1  LIGHT ink / grad-mid     (#ffffff on #066978)
PASS  7.89:1  LIGHT ink / grad-end     (#ffffff on #06596e)
PASS  5.48:1  LIGHT ok / surface       (#047857 on #ffffff)
PASS  7.09:1  LIGHT warn / surface     (#92400e on #ffffff)
PASS  5.97:1  LIGHT prog / surface     (#066e7a on #ffffff)
ALL 31 DARK/LIGHT WCAG AA PAIRS PASSED (>=4.5:1)
```

#### 2.5 Playwright Multi-Page / Mobile / No-JS Captures

From `artifacts/r214/playwright_shots.log` (all captures zero horizontal overflow, zero page errors):

```text
SHOT index-1440.png (1440x900, js=true, theme=dark): overflowX=0 scrollH=5418 h1=46.8px h2=31.68px heroH=321 demoH=406 errs=0
SHOT index-1440-hero.png (1440x900, js=true, theme=dark): overflowX=0 scrollH=5418 h1=46.8px h2=31.68px heroH=321 demoH=406 errs=0
SHOT index-1440-light.png (1440x900, js=true, theme=light): overflowX=0 scrollH=5418 h1=46.8px h2=31.68px heroH=321 demoH=406 errs=0
SHOT guide-1440.png (1440x900, js=true, theme=dark): overflowX=0 scrollH=9102 h1=53.6px h2=31.68px heroH=null demoH=null errs=0
SHOT faq-1440.png (1440x900, js=true, theme=dark): overflowX=0 scrollH=1288 h1=53.6px h2=null heroH=null demoH=null errs=0
SHOT 404-1440.png (1440x900, js=true, theme=dark): overflowX=0 scrollH=826 h1=53.6px h2=null heroH=null demoH=null errs=0
SHOT examples-1440-top.png (1440x900, js=true, theme=dark): overflowX=0 scrollH=16618 h1=53.6px h2=18.4px heroH=null demoH=null errs=0
SHOT examples-1440-featured.png (1440x900, js=true, theme=dark): overflowX=0 scrollH=16618 h1=53.6px h2=18.4px heroH=null demoH=null errs=0
SHOT index-375.png (375x812, js=true, theme=dark): overflowX=0 scrollH=8812 h1=34.5px h2=24.8px heroH=450 demoH=666 errs=0
SHOT examples-375.png (375x812, js=true, theme=dark): overflowX=0 scrollH=43444 h1=36px h2=18.4px heroH=null demoH=null errs=0
SHOT index-nojs-1440.png (1440x900, js=false, theme=dark): overflowX=0 scrollH=5418 h1=46.8px h2=31.68px heroH=321 demoH=406 errs=0
```

#### 2.6 Playground Regression Verification (`node tools/playground/verify.mjs`)

From `artifacts/r214/playground_verify.log`:

```text
PASS page loads without JavaScript errors
PASS counter has nonempty screen DOM
PASS games_snake has nonempty screen DOM
PASS games_2048 has nonempty screen DOM
PASS rounded square device frame
PASS editor compiles default and changed source, then reports syntax errors
PASS hash restores editor source and share copies reloadable URL
PASS oversized source keeps existing share hash
PASS counter button updates count without errors
PASS voice_assistant degrades to DEMO without audio/network and is tappable
PASS snake screen tap and swipe do not throw
PASS abc123 clears placeholder and redraws on five taps
PASS abc123 mobile touchscreen advances card
PASS all examples load without runtime errors (74/74 apps)
```

---

### 3. Scope Separation (Host vs On-Device)

This round modified only static website design assets (`website/`, `scripts/gen_examples_gallery.py`). All checks above are host-side browser/static verifications; physical ESP32-S3-Touch-AMOLED-2.16 board acceptance remains deferred as documented in `docs/KNOWN-SIMPLIFICATIONS.md` and `docs/roadmap.md`.
