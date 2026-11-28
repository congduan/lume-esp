# r231 报告：watchface 五面角标圆屏裁切修复 + 圆屏角落安全区审计收口

## 0. 基线、边界与诚实口径

- **基线**：`origin/main cf81dd7`（2026-11-28，r230 已推送），worktree `/tmp/lume-r231-wt`，分支 `r231-round-corner-safety`。开工时 `git status --short` 为空，`HEAD == origin/main`，无残留改动。
- **改动面**：`examples/watchface/app.js`、`examples/game_of_life/app.js`（审计发现的一处纯坐标裁切）、两者对应的 playground bundle/source 生成物、新 harness `tests/round_corner_audit.js`、`artifacts/r231/`，以及本报告 / `KNOWN-SIMPLIFICATIONS.md` / `roadmap.md` 的追加段。app 数量仍为 74（不注册、不删除）。
- **红线遵守**：`git diff origin/main -- firmware/ runtime/ tools/lume/` **0 字节**，故未跑 `idf.py build`。未改 prelude、bridge ABI、帧协议、vendored 组件、`.d.ts`。ASCII 纪律保持：新增 UI 字面量 0，存量中文文案未动。未 push。
- **证据口径**：本轮视觉结论来自 Playwright 浏览器原生 466 圆屏截图（`.device-wrap.round` / `device=466px` / transform 恒等），是 **host/browser 证据，不是真机验收**。AMOLED 真机色彩、触控命中、边缘观感仍 deferred to board bring-up。

## 1. 修复前实证（先截图确认，再动坐标）

沿用 r229/r230 的 `screenshots.mjs` 工法，新增 `artifacts/r231/screenshots.mjs`：强制 `round=true wrap=466 device=466px transform=matrix(1,0,0,1,0,0)`，选中 watchface 后用 6 步快速左划依次切到五面，各存一张 `artifacts/r231/shots/before/`。原始输出见 `artifacts/r231/screenshots-before-console.log`，五面全部 PASS。

目视（修复前）：

| 面 | 角标实际可见 | 结论 |
|---|---|---|
| digital | `DIGITAL` | `LUME / ` 被左圆弧整段裁掉 |
| analog | `ANALOG` | 同上 |
| rings | `ACTIVITY` | 同上 |
| goals | `OALS` | `LUME / G` 也被裁（y=34 更靠上） |
| modular | `ODULAR` | `LUME / M` 也被裁 |

角落审计基线（`artifacts/r231/corner-audit-browser-before2.txt`，37 个 round app、原生 466、浏览器真实 DOM bbox）：**13 处风险**，其中 watchface 12 处（五面角标 + 五面共享的 `NO WIFI` 状态 + modular 底部日历卡两行文字），`game_of_life` 1 处（底部提示行）。

```
watchface: 12 risk(s)
  PARTIAL_CLIP/CORNER #3 kind-1 "LUME / DIGITAL" box=(32,43,107x16) near=198 far=277
  FULL_CLIP/CORNER #44 kind-1 "NO WIFI" box=(8,11,52x15) near=270 far=316
  face1 PARTIAL_CLIP/CORNER #9 kind-1 "LUME / ANALOG" box=(32,43,111x16) near=196 far=277
  face2 PARTIAL_CLIP/CORNER #13 kind-1 "LUME / ACTIVITY" box=(32,43,115x16) near=194 far=277
  face3 PARTIAL_CLIP/CORNER #18 kind-1 "LUME / GOALS" box=(32,37,100x16) near=207 far=281
  face4 PARTIAL_CLIP/CORNER #25 kind-1 "LUME / MODULAR" box=(32,37,123x16) near=196 far=281
  face4 PARTIAL_CLIP/CORNER #38 kind-1 "周六" box=(48,371,48x28) near=194 far=249
  face4 PARTIAL_CLIP/CORNER #39 kind-1 "11月28日" box=(48,408,64x16) near=213 far=266
game_of_life: 1 risk(s)
  PARTIAL_CLIP/EDGE #5 kind-1 "TAP seed  SWIPE UP play/" box=(84,382,315x31) near=149 far=245
TOTAL risks=13 across 37 round apps
```

曾试过宿主消息流重建 bbox 的工法（`artifacts/r231/corner-audit-probe.js`，164 处风险），实证发现 flex 布局节点的绝对坐标无法从 `attr` 消息可靠还原（大量 `box=(0,0,…)` 假阳性），故**弃用**并改用浏览器真实 DOM bbox，与 brief 允许的「浏览器 session」一致。

## 2. 落地改动

### 2.1 watchface 五面角标（`examples/watchface/app.js`）

- 新增 `__A_cornerLabel(parent, text, x, y, width)`：用**裸 `Text` + 显式 `__A_SX/__A_SY`** 各缩放一次。实证发现若把已缩放值再交给 `__A_Text → __A_style`，`x/y/width/height` 会被第二次乘 `466/480`（`80 → 75`），因此这里不走 `__A_Text`；480 下 `__A_SX/__A_SY` 恒等，480 行为不变。
- 锚点（480 逻辑坐标）：digital `(80,84)`、analog `(80,72)`、rings `(80,72)`、goals `(80,78)`、modular `(80,78)`。`width` 分别为 280 / 280 / 280 / 280 / 300，按 `__A_SX` 缩放；文案原样保留。
- analog / rings 从建议的 `y=84` 再上提到 `y=72`：**截图实证**首轮 `y=84` 时两个 300×300 画布（逻辑 `y=96` 起、不透明背景）盖住标签下半截（`artifacts/r231/shots/after/` 的首轮中间产物未保留，目视记录在本节）；上提后标签墨迹底边在画布顶边之上。goals / modular 没有该遮挡，保留 `y=78`。
- 共享 `NO WIFI` / `SYNCING` 状态：从 `(8,8)`（审计为 `FULL_CLIP`）移到逻辑 `(300,84)`，与角标同带、水平分开，不覆盖任何面的表盘/时间文字。`__A_Text` 的 `__A_style` 会自动缩放这一次，故这里写逻辑坐标。

宿主几何断言（`tests/round_corner_audit.js`，真实 prelude 消息流、screen 466）：

```
  LUME / DIGITAL@(78,82) near=143 far=216
  LUME / ANALOG@(78,70) near=157 far=225
  LUME / ACTIVITY@(78,70) near=152 far=225
  LUME / GOALS@(78,76) near=154 far=221
  LUME / MODULAR@(78,76) near=149 far=221
```

五者 `far ≤ 225 < 233`（可见圆半径），全文墨迹完整落在圆内。Canvas 未动：`tests/watchface.js` 的 183,472/230,400 px、4 canvas、1x 面集合断言全部继续通过。

### 2.2 `game_of_life`（审计发现的纯坐标级修复）

底部 `PATTERN` 按钮 `y: 330 → 310`、提示行 `y: 380 → 360`（480 逻辑坐标，两行坐标改动，无布局重构）。审计风险从 `far=245` 降到不可检出。画布尺寸/网格逻辑/手势映射未动。

### 2.3 新 harness `tests/round_corner_audit.js`

- **层 1（始终运行、无浏览器依赖）**：锁定 37 个 round app 的清单数量；校验五个角标走 `__A_cornerLabel` 且显式 `__A_SX/__A_SY`、不再走会二次缩放的 `__A_Text`；用 `prelude_runner` 在 466 下取真实消息流，断言五条标签墨迹 bbox 的 `far ≤ 231` 且 `x ≥ 233-160.1875`。
- **层 2（Playwright 可用时）**：逐个加载 37 个 round app，watchface 额外划过五面，用 `getBoundingClientRect()` / `Range.getBoundingClientRect()` 取叶子内容节点（Text/Button/Image）真实 bbox，按可见圆 `(233,233,233)` 分级 `FULL_CLIP` / `PARTIAL_CLIP`，并按安全圆 `r=160.1875`（`inset:15.625%`）标 `CORNER`/`EDGE`。Playwright 不可用时打印 `SKIP` 并 exit 0，不会让 `tests/*.js` 全量循环误报。
- 已登记的例外只有 modular 底部日历卡两行文字；watchface 出现任何**新**风险即 exit 1。

## 3. 修复后实证

### 3.1 五张 native 466 圆屏截图（核心验收）

`artifacts/r231/shots/after/`，原始输出 `artifacts/r231/screenshots-after-console.log`；五张均为 `round=true wrap=466 device=466px transform=matrix(1,0,0,1,0,0)`。目视结论：

| 面 | 截图 | 目视结论 |
|---|---|---|
| digital | `1-digital-round-466.png` | `LUME / DIGITAL` 全文可见、无裁切；与 `NO WIFI`、时间、中文日期均不重叠 |
| analog | `2-analog-round-466.png` | `LUME / ANALOG` 全文可见、墨迹完整位于表盘上方，不与画布或刻度重叠 |
| rings | `3-rings-round-466.png` | `LUME / ACTIVITY` 全文可见，位于活动环上方，无遮挡 |
| goals | `4-goals-round-466.png` | `LUME / GOALS` 全文可见，进度环在下方，无重叠 |
| modular | `5-modular-round-466.png` | `LUME / MODULAR` 全文可见，与 48px 大时间 `14:05` 不重叠；底部日历卡中文仍被弧线裁（见 §5） |

### 3.2 角落审计对照

`artifacts/r231/corner-audit-browser-after2.txt`：

```
watchface: 2 risk(s)
  face4 PARTIAL_CLIP/CORNER #38 kind-1 "周六" box=(48,371,48x28) near=194 far=249
  face4 PARTIAL_CLIP/CORNER #39 kind-1 "11月28日" box=(48,408,64x16) near=213 far=266
TOTAL risks=2 across 37 round apps
```

对照：13 → 2；watchface 五面角标与共享状态全部清零，`game_of_life` 清零；剩余 2 处为同一处已登记未修项（§5）。harness 原始输出：`artifacts/r231/round-corner-audit.log`（末尾 `AUDIT round_apps=37 risks=2 watchface=2 accepted=2`，exit 0）。

## 4. 验证（原始输出均在 `artifacts/r231/`）

| 项 | 结果 | 原始输出 |
|---|---|---|
| 466 audit | `SUMMARY_466 total=74 ok=74 fail=0` | `audit-466.log` |
| 480 audit | `SUMMARY_480 total=74 ok=74 fail=0` | `audit-480.log` |
| `tests/*.js`（含新 harness，共 113 份） | `TESTS_DONE count=113 fails=0`（0 条 `FAIL`） | `tests-loop-summary.log`、`tests-loop.log` |
| `npm test --prefix tools/lume` | `# tests 87 / # pass 87 / # fail 0` | `npm-test.log` |
| `tools/playground/verify.mjs` | 18 PASS / 0 FAIL（含「all 74 examples load at native 466」） | `verify.log` |
| `python3 scripts/check_website.py` | API missing / invented / duplicates / signatures not found：四类 `none`；7 pages；gallery 74 | `website-check.log` |
| `node tools/lume/lume.js check … --no-emu` | watchface / game_of_life 均 `RESULT: PASS` | `lume-check-watchface.log`、`lume-check-gameoflife.log` |
| `git diff origin/main -- firmware/ runtime/ tools/lume/` | 0 字节 → 未跑 `idf.py build` | 本报告 §0 |
| canvas 预算 | `tests/watchface.js` 全绿，183,472/230,400 px 断言未改 | `tests-loop-summary.log` |
| playground 生成物 | `node tools/playground/build.mjs` 重建，74 sources/apps，仅两个改动 app 的生成物变化 | `playground-build.log` |

断言同步：本轮**没有**修改任何既有测试断言（watchface / game_of_life 相关 harness 未锁角标坐标），因此不存在「先复现失败再改断言」的步骤；新 harness 是新增文件，不是放宽既有门禁。

## 5. 审计发现但登记不修的项

`watchface` modular 面底部 `CALENDAR` 卡的 `周六` / `11月28日` 两行文字被右下圆弧裁切。这不是一行坐标能解决：底部两卡各 202×104，位于 `y=326`；若上移会与 `y=210` 的上排卡片重叠，若右移则与 `x=246` 的右卡重叠，必须重排四卡尺寸/布局。属改动面大的布局重构，按 brief **登记不修**，写入 `docs/KNOWN-SIMPLIFICATIONS.md` r231 节，不为凑零硬改。harness 把这两条文本列为唯一 accepted 例外，出现第三条即失败。

## 6. 仍未验收

真机 CO5300 466 观感、触摸命中与手感、帧时间、PSRAM 峰值、WiFi/持久化等一律 deferred to board bring-up；浏览器截图和宿主断言不构成硬件验收。未 push；commits 按 feat / test / docs 拆分；git 身份 `congduan`。
