# r218 报告：圆屏安全区全量普查收官刀（74 apps 全量审计 + 10 个真实 P0 清零）

## 0. 基线与口径

- **基线**：`origin/main` `253aa83`（2026-11-28，r217 Keyboard 触区刀已合入），工作树 `/tmp/lume-r218-wt`，分支 `r218-safearea-audit-closure`，开工时工作树干净。
- **Manifest 核实**：`tools/playground/build.mjs` manifest 实测共 **74** 个 app，与简报一致；本轮 74/74 全部跑通实测审计，0 跳过、0 运行失败。
- **诚实口径**：全部结论仅由 **宿主机 harness、esbuild IIFE + `prelude_runner` 坐标 dump、Playwright 74-app playground 验证与 `lume check --no-emu`** 支撑；**未动 `firmware/`、`runtime/`、prelude、vendored 与 `tests/`，未跑 `idf.py build`，无真机验收**。480×480 AMOLED 圆屏实机观感、触控手感与亮度表现一律 deferred 到 board bring-up；本报告不构成硬件验收。

---

## 1. 任务一：74 App 全量几何审计（实测分类）

统一审计脚本 `artifacts/r218/audit.js` 复用 `tests/lib/manifest.js`、`tools/lume/node_modules/esbuild`（与 `tools/playground/build.mjs` 一致的 IIFE 打包路径，完整覆盖 `runtime/shell.js` 及本地相对导入如 `abc123`/`luna`）与 `tests/lib/prelude_runner.js`（执行一次 `__lume_tick()` 展开虚拟列表），完整解析 `ATTR_PARENT=6` 重挂载、绝对定位、`ALIGN`、`flexDirection`/`justify`/`align`/`flexGrow`/百分比宽高、每边 padding 与 Canvas `text`/`spriteDraw` 边界。

判据：480×480 圆屏圆心 `(240, 240)`、半径 `R = 240`；安全方块 `[75, 405]`；交互热区 `≥ 48×48`；卡片圆角 `≤ 12`；UI 字符串与涉改文件 ASCII-only。

改前全量回归：`for t in tests/*.js` **0 FAIL**（`artifacts/r218/full-regression-before.txt`）。

### 1.1 全量 74 App 分类汇总

完整机器可读与人读台账见 `artifacts/r218/audit.json` 与 `artifacts/r218/audit.txt`。

| 分类 | 数量 | App 名单与判据说明 |
|---|---|---|
| **合规（严格 `IN_SAFE`）** | **38** | `games_snake`, `games_breakout`, `games_tetris`, `game_of_life`, `pet`, `weather`, `music_player`, `invaders`, `frogger`, `sokoban`, `lcd_dual`, `memory`, `minesweeper`, `raycast`, `particles`, `voice_assistant`, `spectrum_music`, `skyfire`, `skycombat`, `image_gallery`, `files`, `adc_meter`, `crypto_check`, `archive_view`, `img_view`, `settings`, `hr_monitor`, `controls_demo`, `timer_kit`, `minigolf`, `ipod_music`, `color_demo`, `svg_icon`, `storybook`, `sparkline_demo`, `app_manager`, `fitness`, `dashboard_round` — 全部可见内容与交互控件均严格落在 `[75, 405]`、热区 `≥48×48`、卡片圆角 `≤12`。 |
| **合规（`IN_R240` 轻微越方块、无出圆、热区达标）** | **8** | `games_2048`（提示底边 `y=406` 越 1px, `Rmax=204.8`）、`control_center`（`SafeArea` 70px inset 标题 `y=70`, `Rmax=233.5`, r200 视觉已 PASS）、`launcher_grid`（`SafeArea` 70px inset `EDIT` `y=70`, `Rmax=232.1`, r200 视觉已 PASS）、`abc123`（`320×320` 闪卡 `y=64..384`, `Rmax=237.9`）、`spectrum`（`400×200` 频谱画布 `[40..440,149..349]`, `Rmax=227.8`, HUD 全 `IN_SAFE`）、`typewriter`（居中文字条 `x=48`, `Rmax=196.2`）、`async_demo`（最小 Promise 示例 `104×64` 键 `x=24`, `Rmax=223.5`）、`plasma`（480×480 全幅流体背景 + 居中顶标题 `(202,12)`, `Rmax=231.1`）。全部 `OUT_R240 = 0`、`TOUCH<48 = 0`。 |
| **已登记豁免 / 前序专项收口** | **14** | **简报/r215 已登记**：`fishtank`（纯观赏 480×480 无交互）、`mario`（480×352 玩法场景，HUD/3×`100×48` 键全 `IN_SAFE`）、`golf`（480×420 球场画布，HUD 全 `IN_SAFE`）、`clock_round`（r205 刻度 `Rmax=178.5`）、`aurora_clock`（r205 隐藏锚点 Text 在不透明画布下）、`compass`（r205 `360×360` 径向表盘刻度 `R=162`）。<br>**同类场景/径向表盘豁免**：`gravity_ball`（纯观赏 480×480 无交互，同 `fishtank`）、`scroller`（480×352 卷轴场景，HUD/48px 键全 `IN_SAFE`，同 `mario`）、`flapdot`（480×400 玩法画布，HUD 全 `IN_SAFE`）、`wordring`（480×430 径向词环画布，HUD/3×48px 键全 `IN_SAFE`）、`speedometer`（`432×344` 径向速度表弧线 `R=158 << 240`，全部 HUD/TRIP 卡 `IN_SAFE`，同 `compass`）。<br>**前序轮次收口**：`dashboard`（r216 收口，全部 tab/SYSTEM/TRACE/GAUGE 均在 `[84..396,78..400]`）、`wordle` & `keyboard_demo`（r217 收口，29/29 键高 `48px` 且全键 `IN_R240`，44px 字母键宽已数学证明豁免）。 |
| **真实 P0（本轮 r218 修复清零）** | **10** | `ble_uart`, `mochi`, `vec_demo`, `calculator`, `heart_curve`, `power_demo`, `imu_poll`, `luna`, `counter`, `gestures` — 改前全部存在真实 `OUT_R240`（`Rmax = 282.8..327.3`），覆盖可点按钮裁切、角标出圆、卡片圆角超标与 Canvas HUD 裁切；本轮全部修复至 `IN_SAFE IN_R240`。 |
| **真实违规（诚实登记 Deferred）** | **4** | `watchface`, `shell_demo`, `clock`, `piano` — 见 §3 Deferred 清单（均有明确测试锁定、本地化冲突或圆屏几何不可行依据，按简报「宁少勿滥、超 8 个优先修最严重项」原则诚实留待）。 |
| **合计** | **74** | **74 / 74 全量覆盖** |

---

## 2. 任务二：10 个真实 P0 改动前/后几何对照（实测 dump）

前后逐节点原始 dump 见 `artifacts/r218/geometry-before.txt` 与 `artifacts/r218/geometry-after.txt`（同一脚本 `artifacts/r218/audit.js` 产出）。

| App | 改前核心违规（实测） | 改动方案 | 改前 `worstR` / `OUT_R240` | 改后 `worstR` / `OUT_R240` | 改后触区 / 圆角 / ASCII |
|---|---|---|---|---|---|
| `ble_uart` | `padding:36` 致 7 行卡片 + 3 按钮（`y=420..476`）出圆，底注 `y=476..496` 甚至溢出 480 方屏 | 收入 `padding:76` (`[76..404]`)；7 行 `h=28 r=8`；底栏 `Ping`/`Advertise`/`Stop` 均 `48px` 高且 `Stop` 危险色 + `marginLeft:16`（总间距 24px）隔离；保留 `Ping` 为首 Button 满足 `tests/ble.js` | `327.3` / `13` | **`231.9` / `0`** | `3×104×48`, `r≤12`, `ASCII=0` |
| `mochi` | 页码角标 `01 / 10` 位于 `[384..468, 8..28]`（`Rmax=325.3`）被右上圆弧完全裁掉 | 移至 `[312..396, 80..100]`（`Rmax=223.5 IN_SAFE`），保留 `480×400` 满幅动画画布与已合规底栏 `<`/`>`（`80×48`） | `325.3` (badge) / `2`* | **`223.5`** (UI) / `1`* | `2×80×48`, `r=10`, `ASCII=0` |
| `vec_demo` | 标题 `(20,20)`、`NEXT` 键 `[20..140, 406..454]` 出圆，且 `240×240` 画布与中间统计区重叠 | 收入 `padding:76`；顶栏 `h=32` 居中标题 + 画布 `[120..360, 112..352]` + 底栏 `h=48` 统计与 `100×48` `NEXT` 键零重叠；严格保持 9 静态节点与 `S=240` 物理不变 | `311.1` / `2` | **`231.9` / `0`** | `100×48`, `r=12`, `ASCII=0` |
| `calculator` | 显示卡 `[24..456, 24..120] r=14` 与 6 个按键（`AC`/`*`/`1`/`=`/`0`/`.`）全部 `OUT_R240` | 收入 `padding:76`；显示卡 `h=64 r=12` + 7 段码画布缩至 `312×34`；5 行键盘 `KEY_H=48 gap=4`（按键 `77.5×48` / `241.5×48` / `80.5×48`，`r=10`）；清理注释非 ASCII 破折号 | `305.5` / `8` | **`231.9` / `0`** | `18/18 ≥48×48`, `r≤12`, `ASCII=0` |
| `heart_curve` | 标题、卡片 `r=20`、`Sparkline`（默认居中偏移至 `[164..468]`）与 `Next sample` 键全出圆 | 收入 `padding:76`；卡片 `h=216 r=12`；显式传 `Sparkline({width:304,height:116,x:12,y:62})` 落于卡内 `[88..392,192..308]` 零压盖；`Next sample` `328×48 r=12` | `305.5` / `5` | **`231.9` / `0`** | `328×48`, `r=12`, `ASCII=0` |
| `power_demo` | 标题 `(24,24)`、状态卡 `r=20`、`Keep awake` 键 `[24..456,360..416]` 与底注全出圆 | 收入 `padding:76`；状态卡 `h=184 r=12`；`Keep awake` `328×48 r=12`；底注在 `y≤404` | `305.5` / `5` | **`231.9` / `0`** | `328×48`, `r=12`, `ASCII=0` |
| `imu_poll` | 标题 `(24,24)`、X/Z 轴卡、`Poll now` 键与底注全出圆 | 收入 `padding:76`；三轴卡缩至 `104×120 gap=8`（`328px` 满安全宽）、状态条 `h=48`、`Poll now` `328×48 r=12` | `305.5` / `6` | **`231.9` / `0`** | `328×48`, `r=12`, `ASCII=0` |
| `luna` | Canvas 顶栏 `(30,22)` `Rmax=302.7`、底栏 `(30,444)` `Rmax=293.5` 与详情卡 `y=437` 全出圆；含非 ASCII 中点 `·` | 顶栏移至 `(104,80)`、底栏移至 `(92,386)`、详情卡缩至 `[88..392, 286..400]`；中点改 ASCII `-`；320×320 月球渲染与手势/SNTP 逻辑零改动 | `302.7` (CTXT) / `2` | **`IN_SAFE` / `0`** | 无按钮, `ASCII=0` |
| `counter` | 标题、`Dark`/`Light` 键 `[304..456,32..88]`、计数卡 `r=20`、`Add one` 键与底注全出圆 | 收入 `padding:76`；`Dark`/`Light` `70×48` 置 `[264..404,78..126]`；计数卡 `h=176 r=12`；`Add one` `328×48 r=12`；保留 `TOTAL TAPS`/`Add one` 供 `verify.mjs` 验收 | `299.9` / `8` | **`230.5` / `0`** | `70×48`/`328×48`, `r=12`, `ASCII=0` |
| `gestures` | `padding:40` 致标题、4 张手势卡 `r=14` 与底栏 `r=14` 全部 `OUT_R240` | 收入 `padding:76`、`radius:12`、`gap:8`；4 张手势卡 `160×124 r=12`、底栏 `h=36 r=12`；清理注释非 ASCII 破折号 | `282.8` / `8` | **`231.9` / `0`** | `4×160×124` 手势区, `r=12`, `ASCII=0` |

> `*` `mochi` 剩余的 1 个 `OUT_R240` 计数为底层 `480×400` 满幅动画背景 `Canvas`（人脸位于画布中心区域），全部 UI 节点（角标/名称/说明/`<`/`>` 按钮）均已 100% 落于 `[84..396, 80..400]`。

---

## 3. 诚实登记 Deferred 清单（4 个遗留 `OUT_R240`）

1. **`watchface`**（`Rmax=328.1`）：5 个表盘（含 `SYNCING` `(8,8)` 与 `modular` 四宫格）为早期 480 方屏设计，但 `tests/watchface.js` 硬锁定 `canvasPixels === 228544`、retained-path 节点 ID `10`/`14` 与中文化度数字符串（`'23°'`/`'--°'`、`11月28日`、`步`），修改将与「全文件 ASCII=0」门禁及既有本地化断言冲突；已有专用圆屏表盘 `clock_round` 与 `aurora_clock`，留待后续专题。
2. **`shell_demo`**（`Rmax=305.5`）：用于演示 `shell.StatusBar`（默认 `shape:'square'` `[24..456, 24..80]`；即使传 `shape:'round'` 也因 `SafeArea` 70px inset 得 `[70..410, 70..126]` `Rmax=240.4`）与 `shell.EdgeNavigation`（设计上贴靠 `x=0..24`/`456..480` 边缘捕获侧滑）。收紧 `SafeArea`/`StatusBar` inset 至 75px 涉及 `runtime/shell.js` 及 `tests/statusbar_round.js`/`tests/shell_components.js` 全量消费方，留待组件级决策。
3. **`clock`**（`Rmax=267.7`）：传统方屏模拟+数字时钟（`300×300` 表盘下方两行时间/日期至 `y=418`），已有圆屏专用版 `clock_round`（r205），且受 `tests/sntp_consumers.js` 守卫，留待后续决定保留方屏对照或迁移。
4. **`piano`**（`Rmax=258.2`）：HUD 与 4 个控制键（`DEMO`/`C3`/`C4`/`C5`，`72×48`）均已严格 `IN_SAFE`；仅双八度 14 枚白键水平铺满 `476px`（外侧 `C`/`B` 键 `Rmax=258.2`），受 `tests/piano.js` 硬锁 `WHITE_W * 14 === 476` 且几何上压缩至 330px 安全宽仅剩 `23px/键` 不可弹奏（与 r217 10 列 QWERTY 键宽同类几何约束），留待单八度/可滚动键盘专项设计。

---

## 4. 验收硬指标汇总（原始输出见 `artifacts/r218/`）

| 验收项 | Artifact 文件 | 结果摘要 |
|---|---|---|
| 1. 全量 74-app 审计表 | `audit.json` / `audit.txt` | **74/74** 全部实测完成：`COMPLIANT=38`, `COMPLIANT_IN_R240=8`, `EXEMPT=14`, `FIXED_R218=10`, `DEFERRED=4` |
| 2. 改前/改后坐标对照 | `geometry-before.txt` / `geometry-after.txt` | 10 个涉改 app 逐节点前后对照，全部可交互按钮与内容节点收进 `[76..404]` `IN_SAFE IN_R240` |
| 3. 全量回归（改前/改后） | `full-regression-before.txt` / `full-regression-after.txt` | 改前 `FAIL_COUNT=0`（`REGRESSION DONE`）；改后 `FAIL_COUNT=0`（`REGRESSION DONE`） |
| 4. Playground Playwright 74-app | `playground-verify.txt` | `verify.mjs` 全部 **PASS**（74/74 examples 加载零运行时错误，含 `counter` 点击验证与 `abc123` 移动端触控） |
| 5. `lume check --no-emu`（10 apps） | `check-<app>.txt` | 10/10 全部 **`RESULT: PASS (4 steps, 0 failed; exit 0)`** |
| 6. 网站一致性检查 | `check-website.txt` | `examples.html gallery up to date (74 cards)`；`API missing/invented/duplicates/not found: none` |
| 7. ASCII 纪律（10 涉改文件） | `ascii.txt` | 10/10 `grep -cPn '[^\x00-\x7F]'` 全部 = **0** |
| 8. Manifest + OTA 守卫（回退后） | `playground-manifest.txt` / `ota-consumers.txt` | 回退 `website/playground/apps/` 后 `tests/playground_manifest.js`（74 apps）与 `tests/ota_consumers.js`（18 正向 + 18 mutation）全部 **PASS** |

---

## 5. 范围纪律与提交拆分

- **改动面**：仅修改 10 个 `examples/<app>/app.js`、同步 `website/playground/sources/<app>.js` 与 `website/playground/sources.js`（按 r216 `d4cd368` 先例回退 `website/playground/apps/` 编译包），以及 `artifacts/r218/` 与 `docs/r218-report.md`。
- **零越界**：`firmware/`、`runtime/`、prelude、vendored 与 `tests/` 全部 **0 改动**；未跑 `idf.py build`；未 push；git 身份 `congduan`。
- **提交拆分**：
  1. `feat(examples): fit 10 round-screen P0 apps inside [76,404] safe area`
  2. `chore(playground): re-sync generated source mirrors and sources.js for r218`
  3. `chore(artifacts): record r218 74-app audit, before/after geometry and verification evidence`
  4. `docs(r218): report 74-app round-screen safe-area audit closure and 10 P0 fixes`
