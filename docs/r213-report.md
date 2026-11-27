2|# r213 报告：圆屏安全区 batch6 收口（mochi + sparkline_demo）
3|
4|## 0. 基线与口径
5|
6|- 基线：HEAD `6d55ef3`（`origin/main`，r210 已并入），分支 `r213-safearea-batch6`，开工时工作树干净。未 push、未 rebase、未改里程碑。
7|- **工作树偏离登记**：派发脚本给出的 `/tmp/lume-r213-wt` 在开工后被并发的 `r213-site-pro` 轮接管（分支被切走、`website/` 设计文件被其修改）。为避免覆盖他人工作，本轮把已改的两个 app.js 以 patch 迁到独立 worktree `/tmp/lume-r213-safearea-wt`（同 HEAD `6d55ef3`、同分支 `r213-safearea-batch6`）完成全部验证与提交；共享 worktree 中该轮的 website 改动一律未触碰。
8|- 全部证据均为**宿主 harness / prelude_runner / esbuild bundle**；无真机、无截图、未跑 `idf.py build`（本轮零 firmware 改动）。圆屏观感、触感、可点手感 deferred 到 board bring-up。
9|
10|## 1. 实证方法（先实证，再改坐标）
11|
12|1. 改前先用 `tests/lib/prelude_runner.js` 跑原始 app，dump `create`/`attr` 消息得到真实 `x/y/w/h/text`，确认简报数字与当前码一致；基线全量回归 0 FAIL、两 app `lume check --no-emu` 均 PASS 后才动手。
13|2. 改后用同一 runner dump 同一组属性，逐项对照。原始输出：
14|   - `artifacts/r213/geometry-before.txt`
15|   - `artifacts/r213/geometry-after.txt`
16|   - `artifacts/r213/full-regression-before.txt` / `full-regression-after.txt`
17|   - `artifacts/r213/check-mochi.txt` / `check-sparkline_demo.txt` / `ascii.txt` / `shell_sparkline.txt`
18|
19|## 2. 逐 app 改动前/后坐标对照表（实测，非抄简报）
20|
21|安全方块为 480 圆屏的 `[75,405]`；区间写作 `[x起点..x终点, y起点..y终点]`。
22|
23|### 2.1 mochi
24|
25|| 元素 | 改动前（实测 dump） | 改动后（实测 dump） |
26||---|---|---|
27|| Canvas `W×H` | `w=480 h=400`（装饰满幅，保留） | `w=480 h=400`（不变） |
28|| 根 View | `w=480 h=480`（100%） | `w=480 h=480`（不变） |
29|| 页码 `01 / 10` | `x=384 y=8 w=84 h=20` → `[384..468, 8..28]` | 不变（装饰性角落 HUD，红线 1 允许装饰出界） |
30|| name `Idle` | `x=16 y=408 w=280 h=24` → `[16..296, 408..432]` | `x=84 y=298 w=312 h=24` → `[84..396, 298..322]` |
31|| detail | `x=16 y=436 w=348 h=36` → `[16..364, 436..472]` | `x=84 y=322 w=312 h=24` → `[84..396, 322..346]` |
32|| `<` 按钮 | `x=376 y=410 w=46 h=58` → `[376..422, 410..468]` | `x=84 y=352 w=80 h=48` → `[84..164, 352..400]` |
33|| `>` 按钮 | `x=430 y=410 w=46 h=58` → `[430..476, 410..468]` | `x=316 y=352 w=80 h=48` → `[316..396, 352..400]` |
34|
35|- 原名/详情与两按钮整体在圆边外（`y>405`、`x<75`、`x>405`），按钮不可点；改后四个元素全部落在 `[84..396, 298..400] ⊂ [75,405]`。
36|- 两按钮触区由 `46×58` 改为 `80×48`（≥48×48），圆角 10 ≤12；`lume.gesture.on(mochiCanvas, 'swipe'/'tap')` 绑定完全未动，mascot 渲染与 pose 数学未动。
37|- name 显式 `fontSize:16`、detail 显式 `fontSize:12`，最长详情（34 字符）在 312px 宽内为易读的一行。
38|
39|### 2.2 sparkline_demo
40|
41|| 元素 | 改动前（实测 dump） | 改动后（实测 dump） |
42||---|---|---|
43|| 标题 `SPARKLINE DEMO` | `x=24 y=20 w=432 h=36` → `[24..456, 20..56]` | `x=84 y=88 w=312 h=24` → `[84..396, 88..112]` |
44|| 副标题 | `x=24 y=58 w=432 h=22` → `[24..456, 58..80]` | `x=84 y=112 w=312 h=16` → `[84..396, 112..128]` |
45|| `STATIC / 3 SERIES` | `x=24 y=92 w=432 h=20` → `[24..456, 92..112]` | `x=84 y=134 w=312 h=16` → `[84..396, 134..150]` |
46|| staticSpark | `x=24 y=116 w=432 h=88` → `[24..456, 116..204]` | `x=84 y=152 w=312 h=44` → `[84..396, 152..196]` |
47|| `LIVE / TIMER PUSH 300MS` | `x=24 y=216 w=300 h=20` → `[24..324, 216..236]` | `x=84 y=200 w=200 h=16` → `[84..284, 200..216]` |
48|| `N=8` | `x=332 y=216 w=124 h=20` → `[332..456, 216..236]` | `x=296 y=200 w=100 h=16` → `[296..396, 200..216]` |
49|| liveSpark | `x=24 y=240 w=432 h=88` → `[24..456, 240..328]` | `x=84 y=218 w=312 h=44` → `[84..396, 218..262]` |
50|| `FILLED / MIN 0 MAX 100` | `x=24 y=340 w=432 h=20` → `[24..456, 340..360]` | `x=84 y=266 w=312 h=16` → `[84..396, 266..282]` |
51|| filledSpark | `x=24 y=364 w=432 h=72` → `[24..456, 364..436]`（底边越界） | `x=84 y=284 w=312 h=40` → `[84..396, 284..324]` |
52|| PAUSE/RESUME 按钮 | `x=24 y=444 w=120 h=30` → `[24..144, 444..474]` | `x=84 y=340 w=96 h=48` → `[84..180, 340..388]` |
53|| 说明文本 | `x=156 y=444 w=300 h=30` → `[156..456, 444..474]` | `x=192 y=348 w=204 h=32` → `[192..396, 348..380]` |
54|
55|- 实证结论：原 filledSpark 底边 `436 > 405`，确实不在安全区内；且原按钮行 `y=444..474` 与它上下相邻，必须把 filledSpark 上移并收缩，才能给 48px 触区让位。因此按简报「先实证再决定是否需要微调」对标题/标签/三根图表做了整体收口，全部进入 `[84..396, 88..388] ⊂ [75,405]`。
56|- 按钮触区 `120×30 → 96×48`（≥48×48），圆角 8；`paused` 信号、300ms timer、`onPause` 清理、主题配色与 `globalThis.sparklineDemo` 导出全部未动。
57|- `tests/shell_sparkline.js` 是 `runtime/shell.js` 组件 harness，不含任何 app 坐标断言：改前原样跑即 `ALL SHELL SPARKLINE CASES PASSED (14 cases)`，**零改动**。全仓 `tests/` 中没有任何用例引用这两个 app 的坐标，故未改任何测试文件。
58|
59|## 3. DESIGN-TOKENS.md §0 八条红线逐条自查
60|
61|| # | 红线 | 自查结果 |
62||---|---|---|
63|| 1 | 圆屏安全区 `[75,405]` | **通过**：两 app 所有可交互元素与关键文本实测落在 `[84..396] × [88..400]`；mochi 的 480×400 Canvas 与角落页码为装饰性内容，按红线 1「装饰元素可出界」保留满幅。 |
64|| 2 | 卡片圆角 ≤12px | **通过**：mochi 按钮 10、sparkline 按钮 8，主题 radius 12，无新增更大圆角。 |
65|| 3 | 触区 ≥48×48 | **通过**：mochi `<`/`>` 各 80×48；sparkline PAUSE/RESUME 96×48。 |
66|| 4 | 对比度 ≥4.5:1 / 大字 ≥3:1 | **通过**：沿用既有调色板（主文 `#F2F7FB`/`#9EB3C6` 于 `#101418`/`#07111D`），未引入新色值；字号显式化不改变颜色。 |
67|| 5 | 无信息冗余 | **通过**：mochi 只有一组 name+detail 与一对导航按钮；sparkline 标题、副标题、三张图表各表达一件事，PAUSE 单一按钮。 |
68|| 6 | 状态机驱动按钮 | **通过**：sparkline 单按钮按 `paused` 在 PAUSE/RESUME 间切换，非法态不并存；mochi `<`/`>` 为恒合法的循环导航。 |
69|| 7 | 危险操作隔离 | **通过（N/A）**：两个 app 均无 RESET/删除类危险操作。 |
70|| 8 | 禁止字母占位图标 | **通过**：无字母占位图标；mochi 的 `<`/`>` 是既有的简单导航字形，置于主题按钮底色上，非 A-Z 占位。 |
71|
72|三层 token：本轮未新增 Primitive / Semantic / Component token，仅复用既有颜色、字号阶梯与 8px 网格（84/96/312/16/24/32/48 均为 4/8 的倍数），符合 §1.3。
73|
74|## 4. 验证证据汇总
75|
76|| artifact | 结果 |
77||---|---|
78|| `full-regression-before.txt` / `full-regression-after.txt` | `for t in tests/*.js` 全量回归改前、改后均 **0 FAIL**，末尾 `REGRESSION DONE` |
79|| `check-mochi.txt` | `RESULT: PASS (4 steps, 0 failed; exit 0)`，bundle 8483 bytes |
80|| `check-sparkline_demo.txt` | `RESULT: PASS (4 steps, 0 failed; exit 0)`，bundle 31539 bytes |
81|| `ascii.txt` | 两个 app.js 各 `grep -cPn '[^\x00-\x7F]'` = **0** |
82|| `geometry-before.txt` / `geometry-after.txt` | 改前/改后 `create`/`attr` 实测坐标 dump（见 §2） |
83|| `shell_sparkline.txt` | `ALL SHELL SPARKLINE CASES PASSED (14 cases)`，harness 零改动 |
84|
85|`--no-emu` 按 CLI 设计跳过 eval/layout/perf，因此布局结论来自宿主 harness 与坐标 dump，不冒充布局 lint 结果。
86|
87|## 5. 偏离登记
88|
89|- **工作树接管**：见 §0；已迁到独立 worktree，未 push、未覆盖并发轮改动。
90|- **生成镜像同步**：`tests/playground_manifest.js` 断言 `website/playground/sources/<app>.js` 与 `sources.js` 必须逐字节等于 `examples/<app>/app.js`。改 app.js 后同步了 `website/playground/sources/{mochi,sparkline_demo}.js` 与 `sources.js`（与 r210 的 `f0d4d9b` 同类 `chore(playground)` 提交）。仅动生成的应用源码镜像，**未动任何 website HTML/CSS/设计文件**；manifest 仍为 **74** 个 app（未变）。
91|- **ASCII**：mochi 原文件头注释里有一个既存 em-dash（`—`），为满足 `grep -cPn '[^\x00-\x7F]'` = 0 改为 `--`；UI 字面量原本即为 ASCII，未改任何字符串内容。
92|- 本轮未新建 harness、未改 firmware/runtime/prelude/tools/manifest/.d.ts、未跑 firmware build、未 push。
93|
94|## 6. 诚实口径
95|
96|所有结论仅由宿主 harness、`prelude_runner` 坐标 dump 与 esbuild bundle 支撑。圆屏上的实际观感、触控手感、文字换行后的像素效果均**未做真机验证**，deferred 到 board bring-up；本报告不构成硬件验收。

---

## 7. 附录：r213-site-pro 轮报告（website 专业化，与本轮同基线 6d55ef3 并发完成，合并时原文保留）

98|# Lume r213 Report — Website Professionalization (Design-First Overhaul)
99|
100|- **Branch**: `r213-site-pro` (base `origin/main` @ `6d55ef3`)
101|- **Scope**: `website/` (excluding generated `website/playground/`, `website/wasm/`, `run.html`, `workbench.*`, `terminal.js`, `netmon.js`), `scripts/gen_examples_gallery.py`, `artifacts/r213/`, `docs/r213-report.md`
102|- **Verification environment**: Host Linux + Python 3 + Node.js + Playwright Chromium (local HTTP server serving `website/`). On-device acceptance remains pending per repository policy.
103|
104|---
105|
106|## 1. Defect Audit Closure Checklist
107|
108|| # | Production Audit Defect | Root Cause & Implemented Fix | Verification Evidence |
109||---|---|---|---|
110|| 1 | **Capabilities blank screen on `index.html`** | `style.css` previously hid `.reveal` at `opacity: 0` unconditionally until IntersectionObserver fired. Replaced with `opacity: 1` unconditionally in CSS; JS adds `html.js-reveal` + `.reveal-pending` only for subtle vertical elevation (`transform: translateY(10px) -> none`). | `artifacts/r213/shots/index-nojs.png` (`javaScriptEnabled: false`, `totalReveals=26 invisible=0 capsOpacity=["1","1","1"]`); unscrolled desktop JS load also has `hiddenReveals=0`. |
111|| 2 | **Zero product visual assets** | Extracted 39 strictly verified real esp32sim 480×480 firmware renders from `artifacts/emu/` (`ui-refresh/*.png`, `*/tft.png`) and `artifacts/r83/tft-scroller.png`, compressed via PIL to WebP in `website/assets/shots/` (12 featured @ 460px `quality=82`, 27 gallery @ 280px `quality=78`; total **186.0 KB** < 500 KB, max single file **12.2 KB** < 40 KB). Added 12-screen showcase on `index.html` and card thumbnails on `examples.html`. | Explicitly labeled `"Real firmware, rendered by esp32sim — not mockups"` (EN/ZH). Zero browser-sim captures or mockups used. |
112|| 3 | **Hero composition imbalance** | Tightened `.hero` grid (`1.12fr .88fr`) and H1 typography (`clamp(2.1rem, 3.25vw, 2.95rem)`, `text-wrap: balance`, two block spans for EN/ZH); set `.hero-actions` to `flex-wrap: nowrap` on desktop; refactored What's New wall of text into a compact `.whats-new-card` with scannable chips. | Playwright geometry check at 1440×900: `h1Lines=2 h1Height=103px btnYs=[402,402,402] sameRow=true`. |
113|| 4 | **No semantic status colors on Roadmap** | Added WCAG AA semantic tokens `--ok` (green), `--warn` (amber), `--prog` (sky-cyan) with tinted backgrounds, borders, and `::before` status dots for both dark and light themes (`Code checked` / `Mixed` / `In progress`). | Verified visually in both `index-desktop.png` (dark) and `index-desktop-light.png` (light). |
114|| 5 | **Examples cards lack visuals & metadata** | Upgraded `scripts/gen_examples_gallery.py` to emit: (a) esp32sim WebP thumbnail (`39` cards) or honest AMOLED icon tile `"Live in Playground"` (`35` cards), (b) semantic amber `Board hardware` pill strictly preserving existing `HW_TERMS`/`STUB_TERMS` logic (`12` cards), (c) compact `.path-row` with working Copy button, (d) primary `"Open in Playground"` + secondary `"View source"` CTAs. Added search & filter toolbar (`All apps` / `esp32sim captures` / `Hardware APIs`). | `python3 scripts/gen_examples_gallery.py --check` -> `examples.html gallery up to date (74 cards)`; Playwright interactive test `all=74 / 74 shot=39 / 74 hw=12 / 74 copyAfterClick=Copied`. |
115|| 6 | **Missing OSS trust signals & minimal footer** | Added static shields.io GitHub Stars badge in header + Stars & MIT badges in footer (no JS SDK). Unified top navigation across all pages (including `Playground` link on Guide/API/Examples/FAQ/404). Expanded footer into 4 columns (`lume.` brand, Documentation, Explore, Resources) + honest legal row. | Verified across `index.html`, `guide.html`, `api.html`, `examples.html`, `faq.html`, `404.html`; `check_website.py` checks every internal link & anchor. |
116|| 7 | **Code highlighting, architecture blend, disclaimer placement** | Added 6-token syntax palette (`--tok-kw/fn/str/num/cmt/prop`) in dark & light themes for hero demo and `guide.html` JS snippets; replaced abrupt architecture gradient with soft radial blend + 4 numbered horizontal pipeline cards; kept the USB hot-reload disclaimer intact in the hero demo card caption. | Verified visually on `index-desktop.png`, `index-desktop-light.png`, `guide-desktop.png`. |
117|
118|---
119|
120|## 2. Vision Self-Audit (Post-Redesign)
121|
122|Baseline production audit scores were **5.5/10 (index)** and **5.0/10 (examples)**. After inspecting every Playwright capture in `artifacts/r213/shots/`:
123|
124|| Page | Self-Score | Assessment & Remaining Honest Gaps |
125||---|---|---|
126|| `index.html` (desktop dark/light/ZH, mobile 375px, no-JS) | **8.6 / 10** | Crisp 2-line hero headline, single-row CTAs, scannable changelog card, 12 authentic esp32sim firmware renders with honest provenance labeling, smooth architecture flow, distinct semantic roadmap status pills in both dark & light themes, 4-column footer, 100% visible with JS disabled (`index-nojs.png`) and zero mobile nav clipping (`navScrollW=343 navClientW=343`). Remaining gap: hero demo screen remains an illustrative CSS preview (explicitly disclosed) rather than an embedded canvas; external shields.io badges rely on network access. |
127|| `examples.html` (desktop & mobile 375px) | **8.3 / 10** | Dramatic uplift from text-only boxes: 3-column grid with 39 genuine esp32sim thumbnails + 35 clean AMOLED icon tiles, live search & filter bar, working Copy path buttons, amber hardware badges, and dual Playground/source CTAs. Remaining gap: 35 apps do not yet have CI esp32sim PNG captures in `artifacts/emu/`; `"Open in Playground"` opens `playground/index.html` without per-app deep-linking because `website/playground/page.js` is out of scope. |
128|| `guide.html` (desktop 1440px) | **8.2 / 10** | Multi-token JS syntax highlighting across all walkthroughs, clean comparison & parameter tables, unified nav and multi-column footer, zero overflow. |
129|| `faq.html` (desktop 1440px) | **8.2 / 10** | First caveat expanded on load for immediate scannability, crisp typography, unified nav and multi-column footer. |
130|
131|---
132|
133|## 3. Raw Verification Outputs
134|
135|All raw logs are archived in `artifacts/r213/`.
136|
137|### 3.1 `python3 scripts/check_website.py` (`artifacts/r213/check-website.log`)
138|
139|```text
140|examples.html gallery up to date (74 cards)
141|HTML pages: 7; internal href/src and anchors checked
142|API: 162 catalog entries, 162 type declarations, 34 function namespaces
143|API missing: none
144|API invented: none
145|API duplicates: none
146|API signatures not found in lume.d.ts: none
147|```
148|
149|### 3.2 `python3 scripts/gen_api_docs.py --check` & `gen_examples_gallery.py --check`
150|
151|```text
152|api.html is up to date with lume.d.ts (162 entries)
153|examples.html gallery up to date (74 cards)
154|```
155|
156|### 3.3 ASCII-only & WebP Asset Budget Check (`artifacts/r213/ascii-and-assets.log`)
157|
158|```text
159|ASCII check website/assets/style.css: PASS
160|ASCII check website/assets/site.js: PASS
161|Shots count=39, total=186.0KB (<500KB), max=12.2KB (<40KB)
162|```
163|
164|### 3.4 Playwright Site Audit (`artifacts/r213/playwright-audit.log`)
165|
166|```text
167|[desktop-dark-unscrolled] index: overflow=false hiddenReveals=0 localImgs=12 brokenLocal=0
168|[desktop-dark-unscrolled] examples: overflow=false hiddenReveals=0 localImgs=39 brokenLocal=0
169|[desktop-dark-unscrolled] guide: overflow=false hiddenReveals=0 localImgs=0 brokenLocal=0
170|[desktop-dark-unscrolled] faq: overflow=false hiddenReveals=0 localImgs=0 brokenLocal=0
171|[hero-geometry] h1Lines=2 h1Height=103px btnYs=[402,402,402] sameRow=true
172|[i18n-zh] h1="屏幕由你定义，\n固件无需反复烧录。"
173|[examples-interactive] all=74 / 74 shot=39 / 74 hw=12 / 74 copyAfterClick=Copied
174|[mobile-375] index: docOverflow=false navScrollW=343 navClientW=343
175|[mobile-375] examples: docOverflow=false navScrollW=343 navClientW=343
176|[no-js] totalReveals=26 invisible=0 capsOpacity=["1","1","1"]
177|ALL PLAYWRIGHT AUDITS PASSED
178|```
179|
180|### 3.5 Playground Regression Check (`artifacts/r213/playground-verify.log`)
181|
182|Command: `NODE_PATH=/home/ubuntu/.npm/_npx/705bc6b22212b352/node_modules node tools/playground/verify.mjs`
183|
184|```text
185|PASS page loads without JavaScript errors
186|PASS counter has nonempty screen DOM
187|PASS games_snake has nonempty screen DOM
188|PASS games_2048 has nonempty screen DOM
189|PASS rounded square device frame
190|PASS editor compiles default and changed source, then reports syntax errors
191|PASS hash restores editor source and share copies reloadable URL
192|PASS oversized source keeps existing share hash
193|PASS counter button updates count without errors
194|PASS voice_assistant degrades to DEMO without audio/network and is tappable
195|PASS snake screen tap and swipe do not throw
196|PASS abc123 clears placeholder and redraws on five taps
197|PASS abc123 mobile touchscreen advances card
198|PASS all examples load without runtime errors
199|```
200|
201|(All 74 registered Playground apps loaded with non-empty screen DOM and zero runtime errors.)
202|
203|---
204|
205|## 4. Captured Screenshots (`artifacts/r213/shots/`)
206|
207|- `index-desktop.png` (1440×900 fullPage, dark)
208|- `index-desktop-light.png` (1440×900 fullPage, light)
209|- `index-desktop-zh.png` (1440×900 fullPage, Chinese)
210|- `index-nojs.png` (1440×900 fullPage, JavaScript disabled)
211|- `examples-desktop.png` (1440×900 fullPage, dark)
212|- `guide-desktop.png` (1440×900 fullPage, dark)
213|- `faq-desktop.png` (1440×900 fullPage, dark)
214|- `index-mobile.png` (375×812 fullPage, dark)
215|- `examples-mobile.png` (375×812 fullPage, dark)
