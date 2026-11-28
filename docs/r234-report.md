# r234 报告：round app DESIGN-TOKENS 红线审计 + 修复刀（新增确定性审计 harness）

## 0. 基线、红线遵守与诚实口径

- **基线**：`origin/main 781fc5d`（2026-11-28），worktree `/tmp/lume-r234-wt`，分支 `r234-round-token-audit`。
- **改动面**：
  - 新增确定性审计 harness：[tests/design_token_audit.js](file:///tmp/lume-r234-wt/tests/design_token_audit.js)
  - 修复 14 个 round app 的 `examples/<app>/app.js`：`clock`、`weather`、`music_player`、`game_of_life`、`compass`、`image_gallery`、`files`、`adc_meter`、`crypto_check`、`archive_view`、`img_view`、`settings`、`control_center`、`launcher_grid`
  - 重生成 playground 产物（`node tools/playground/build.mjs`）：`website/playground/{apps,sources,sources.js}`
  - 报告与路线图：`docs/r234-report.md`、`docs/roadmap.md`（仅末尾追加 `### r234 result`，所有 milestone checkbox 一字未动）、`artifacts/r234/`
- **红线校验（原始命令实证）**：
  - `git diff --name-only origin/main -- firmware/ runtime/ tools/` = **空（0 文件）**（`artifacts/r234/forbidden-diff.log`）
  - `docs/DESIGN-TOKENS.md`、`examples/watchface/`、`tests/round_corner_audit.js` **零改动**
  - 全部 37 个 square app **零改动**；app 数量保持 **74**（37 round + 37 square）
  - 既有 canvas 预算断言（230,400 px 共享）**零改动**；本次修复未新增任何 Canvas（`settings` 中 3 个 canvas 尺寸略有缩小，总像素严格不增）
  - 新增代码行非 ASCII 字符数 = **0**（`ADDED_LINES: 166 NON_ASCII_ADDED_LINES: 0`，`artifacts/r234/ascii-check.log`）
  - 既有 113 份测试零破坏，无需放宽任何既有断言；未 push；git 身份 `congduan`
- **诚实口径**：本轮所有审计、单测与截图验收均在 Linux 宿主 prelude VM 与 Playwright 浏览器 466×466 圆屏渲染中完成，属于 **host/browser 证据，非真机硬件验收**。真机 CO5300 显示效果、CST9220 触控热区手感、PSRAM 峰值与帧时延仍 deferred to board bring-up。

---

## 1. 任务一：确定性审计 harness `tests/design_token_audit.js`

### 1.1 架构与 4 项确定性判据

参照 `tests/round_corner_audit.js` 的结构、exit 契约与 `PASS`/`FAIL`/`AUDIT` 输出风格，核心层纯宿主可跑（不依赖浏览器，<2 秒完成），覆盖 `website/playground/page.js` 目录全部 **74 个 app**（37 round 在原生 `466×466` 运行，37 square 在原生 `480×480` 运行）：

1. **合成正负向自检（防装饰断言）**：每次运行先执行合成坏用例（同时包含 `36×36` 小按钮、单字母 `'R'` 按钮、`fontSize: 10` 文本、`borderRadius: 20` 卡片）与合规用例（`452×452 r=226` 表圈、`320×120 r=12` 卡片、`64×48 r=999` 胶囊按钮、`12px` 文本），证明 4 条规则全部可触发且零误报。
2. **四项确定性规则（`DESIGN-TOKENS.md` §0 v1 范围）**：
   - `touch-target`：所有 `Button`（`kind=2`）、绑定 `onPress` 的节点、以及绑定 `tap`/`longpress` 手势的 `View`（通过读取 prelude VM `__gestureHandlers` 精准区分，避免把 `EdgeNavigation` 的 24×480 边缘滑动条误报为点击按钮），宽高须 `≥48×48`（含水平 flex 行中 `flexGrow` 按钮的等效宽度推算）。对 `settings` 注入一条 `wifi.saved` 记录使虚拟列表 `netRow` 真实实例化进入审计。
   - `letter-icon`：`Button`、可点击节点、或其内部图标位 `Text` 的单 ASCII 字母文本（`/^[A-Za-z]$/`）。
   - `font-size`：所有显式 `ATTR_TEXT_FONT` 的文本节点须 `≥12px`。
   - `card-radius`：`View`/`Button` 的 `ATTR_RADIUS > 12`，同时排除几何胶囊/圆（`r ≥ 900` 胶囊按钮，或 `r ≥ floor(min(w,h)/2) - 1` 的圆形表圈/圆形按钮/半圆端胶囊）。
3. **输出粒度**：每条违规/豁免均打印 `app / file:line / node路径 / 规则 / 现值 / 要求值`（及 `--json` 机器可读输出）。

### 1.2 修复前 0 例外全量基线 vs 修复后汇总

| 阶段 | 审计范围 | `violations` | `round_violations` | `square_violations` | `accepted` (round / square) | 日志 |
|---|---|---:|---:|---:|---|---|
| 修复前（`ACCEPTED = []`） | 74 apps (37+37) | **247** | 131 | 116 | 0 (0 / 0) | `artifacts/r234/audit-before.log` |
| 修复后（含登记 `ACCEPTED`） | 74 apps (37+37) | **0** | **0** | **0** | 185 (69 / 116) | `artifacts/r234/audit-after.log` |

- **本轮真实清零的 round 违规**：**62 项**（覆盖 14 个 round app；`131 - 62 = 69` 项保留为明确有据可查的 `ACCEPTED`）。
- **round 侧保留的 69 项 `ACCEPTED`（均有源码与红线依据）**：
  1. `watchface`（10 项 `card-radius: borderRadius=16`）：r232 专刀在途，本轮红线禁碰。
  2. `settings` 软键盘覆盖层 `kbOverlay`（26 项 `letter-icon` `a-z` + 33 项 `touch-target` 键宽 `<48px`）：单字母 `a-z` 为真实 QWERTY 字符输入键而非占位图标；328px 圆屏安全区内排 10 列 QWERTY 键在几何上不可能单键宽 ≥48px（行高已在本轮从 42px 提升并锁死 `≥48px`，匹配 predicate 强制要求 `f.h >= 48`）。

---

## 2. 任务二：14 个 round app 修复明细与目视结论

所有修改的 14 个 round app 均在 Playwright 原生 466×466 圆屏模式留存 before/after 截图（`artifacts/r234/shots/<app>-{before,after}.png`，另含 `settings-{wifi,general}-{before,after}.png`，共 32 张），全部人工目视复核：

| # | App | 修复前违规（原生 466） | 修复内容 | 目视结论 |
|---|---|---|---|---|
| 1 | `settings` | `backPill` `47×29` (×4 页)；`Scan/Add/Disconnect` `h=45`；`Rescan` `h=45`；`netRow` `'X'` 按钮 `39×43` + 单字母占位 + 行高 `47`；`generalPage` `-`/`+` `43×43`、`New token`/`Sync now`/`Reboot` `h=31`；`Advertise`/`Stop`/`Sleep now`/`Power off` `h=47`；`kbOverlay` 行高 `41` | `__A_props`/`__A_List` 加 48px 触控底限（480 零变更）；`backPill` 升为 `48×48 r=12`；`netRow` 删单字母 `'X'` 改为 `DEL` `48×48`、`itemHeight: 52`；`Scan/Add/Disconnect/Rescan` 升为 `h=48`；`generalPage` 重排纵坐标（0..328 安全区内零重叠）：`-`/`+` `48×48`、`New token`/`Sync now`/`Reboot` 全高 `48`、`telemetryCanvas` `320×24`；`kbOverlay` 4 行键盘升至 `h=48` | PASS：`settings-general-after.png` 与 `settings-wifi-after.png` 所有按钮饱满清晰，无裁切无重叠 |
| 2 | `weather` | 刷新按钮 466 下缩至 `47×47`；SVG 不可用回退文本为单字母 `'R'` | `__A_props` 触控底限夹紧至 `48×48`；回退文案 `'R'` → `'SYNC'`（`fontSize: 12`，纯 ASCII） | PASS：`weather-after.png` 保持原 SVG 刷新图标，48×48 圆形触区完整 |
| 3 | `music_player` | 11 处按钮/曲目行在 466 下由 48 缩至 `47px`（`btnVolDown/Up`、`Back`、`-0.5`、`+0.5`、`<`、`>`、4 条曲目行） | `__A_props` 触控底限夹紧至 `≥48`（480 零变更） | PASS：`music_player-after.png` 布局与音量条居中对称 |
| 4 | `files` | 4 处按钮/行高在 466 下缩至 `47px`；`statusLabel` 与行内 `DEL` 为 `fontSize: 11` | `__A_props`/`__A_List` 触控底限夹紧；2 处 `fontSize: 11 → 12` | PASS：`files-after.png` 列表行与底栏 3 键清晰可读 |
| 5 | `image_gallery` | `<`/`>` 按钮在 466 下缩至 `47×47`；卡片说明与状态胶囊为 `fontSize: 11` | `__A_props` 触控底限夹紧；2 处 `fontSize: 11 → 12` | PASS：`image_gallery-after.png` 2×2 卡片与底栏分页清晰无截断 |
| 6 | `adc_meter` | `PIN`/`ATTEN` 在 466 下缩至 `h=47`；`4 Hz`、`CFG OK`、`0-3300 mV` 为 `fontSize: 11` | `__A_props` 触控底限夹紧；3 处 `fontSize: 11 → 12` | PASS：`adc_meter-after.png` 胶囊与量程标签无溢出 |
| 7 | `crypto_check` | `NEXT` 在 466 下缩至 `h=47`；4 张诊断卡标题为 `fontSize: 11` | `__A_props` 触控底限夹紧；`diagCard` `fontSize: 11 → 12` | PASS：`crypto_check-after.png` 4 张卡片标题清晰无裁切 |
| 8 | `archive_view` | `NEXT` 在 466 下缩至 `h=47` | `__A_props` 触控底限夹紧 | PASS：`archive_view-after.png` 布局整洁 |
| 9 | `img_view` | `NEXT`/`MODE` 在 466 下缩至 `h=47` | `__A_props` 触控底限夹紧 | PASS：`img_view-after.png` 布局整洁 |
| 10 | `control_center` | `resetBtn` 在 466 下缩至 `206×47` | `__A_props` 触控底限夹紧 | PASS：`control_center-after.png` 布局整洁 |
| 11 | `launcher_grid` | `editBtn` 在 466 下缩至 `62×47` | `__A_props` 触控底限夹紧 | PASS：`launcher_grid-after.png` 3×4 宫格与 EDIT 胶囊整洁 |
| 12 | `clock` | `clockTheme.radius = 14 > 12` | `radius: 14 → 12` | PASS：`clock-after.png` 模拟表盘与数字时间完整 |
| 13 | `game_of_life` | 底部操作提示 `fontSize: 11` | `fontSize: 11 → 12` | PASS：`game_of_life-after.png` 提示居中两行显示，无遮挡无裁切 |
| 14 | `compass` | 副标题免责文案 `fontSize: 11` | `fontSize: 11 → 12`；**目视自检捕获初版 12px 在 `w=312` 下折行压住表盘 `N`**，随即放宽文本框至 `x: 68, width: 344`（仍在 `y=106` 圆弦 `[38,428]` 内） | PASS：复拍 `compass-after.png` 恢复单行居中，与 `N` 零重叠 |

---

## 3. 方屏 app（37 个）违规登记清单（本轮只登记不修，留下一轮）

全部 37 个 square app 经 `tests/design_token_audit.js`（480×480）全量扫描，共发现 **8 个 app / 116 项**（已按红线暂登记于 `ACCEPTED`，留给下一轮方屏 token 收口刀）：

| App | 规则 | 数量 | 现值 / 位置 | 说明与下一轮建议 |
|---|---|---:|---|---|
| `counter` | `font-size` | 1 | `11px` (`L39`, `"TAP TO INCREMENT"`) | 待修：升至 `12px` |
| `typewriter` | `card-radius` | 1 | `borderRadius=20` (`L78`) | 待修：降至 `12` |
| `minesweeper` | `font-size` | 1 | `11px` (`L351`, `"BEST -"`) | 待修：升至 `12px` |
| `voice_assistant` | `font-size` | 2 | `10px` (`L764`)、`11px` (`L781`) | 待修：升至 `12px` |
| `ble_uart` | `font-size` | 1 | `11px` (`L162`) | 待修：升至 `12px` |
| `sparkline_demo` | `font-size` | 6 | `11px` (`L30/35/48/51/59/80`) | 待修：升至 `12px` |
| `keyboard_demo` | `touch-target` + `letter-icon` | 26 + 26 | `44×48` + `A-Z` (`shell.Keyboard`) | 10 列 QWERTY 软键盘物理宽度上限（`10×48=480` 零间隙）与真实字符键，建议保持豁免 |
| `wordle` | `touch-target` + `letter-icon` | 26 + 26 | `44×48` + `A-Z` (`shell.Keyboard`) | 同上（`shell.Keyboard` 10 列 QWERTY） |

---

## 4. `DESIGN-TOKENS.md` 与基建观察（仅登记，未改规范文件）

1. **10 列 QWERTY 软键盘的水平键宽物理约束**：`DESIGN-TOKENS.md` §0.3 写明触控目标 `≥48×48px`，但在 480 方屏（480px / 10 = 48px 零间距）与 466 圆屏安全区（328px / 10 ≈ 32px）下，10 列 QWERTY 字符键无法在横向上满足 48px；目前 `runtime/shell.js`（r217）与 `examples/settings/app.js`（本轮）均采取「行高锁死 ≥48px、字符键宽尽力最大」的折中，后续修订 `DESIGN-TOKENS.md` 时建议明文补一条 QWERTY 键盘豁免条款。
2. **r230 自适应缩放垫片与 48px 触控底限**：11 个 r230 round app 原本用 `Math.round(48 * 466 / 480) = 47` 导致所有 48px 触区在原生 466 屏幕上掉到 47px；本轮已在 11 个 app 的 `__A_props`/`__A_List` 中加入 `>=48` 下限夹紧（480 下保持原样 no-op），后续新增自适应圆屏 app 应复用此下限逻辑。

---

## 5. 自动化验证原始输出汇总（产物全存 `artifacts/r234/`）

| # | 验证项 | 原始结果 | 产物路径 |
|---|---|---|---|
| 1 | `node tests/design_token_audit.js`（修复前） | `AUDIT apps=74 violations=247 (round=131 square=116) accepted=0 (round=0 square=0)` (exit 1) | `artifacts/r234/audit-before.log` / `.json` |
| 2 | `node tests/design_token_audit.js`（修复后） | `PASS zero unaccepted DESIGN-TOKENS violations` / `AUDIT apps=74 violations=0 (round=0 square=0) accepted=185 (round=69 square=116)` (exit 0) | `artifacts/r234/audit-after.log` / `.json` |
| 3 | `tests/round_corner_audit.js`（Playwright 实时 37 round） | `AUDIT round_apps=37 risks=2 watchface=2 accepted=2`（与基线 781fc5d 完全一致） | `artifacts/r234/round-corner-audit.log` |
| 4 | `tools/playground/verify.mjs` | **18 PASS / 0 FAIL**（含 74/74 square + 74/74 native-466 加载无报错） | `artifacts/r234/verify.log` |
| 5 | `npm test --prefix tools/lume` | `# tests 87 / # pass 87 / # fail 0` | `artifacts/r234/npm-test.log` |
| 6 | 全量 `for t in tests/*.js`（114 份 = 113 既有 + 1 新增） | **`TESTS_DONE count=114 fails=0`** | `artifacts/r234/tests-loop-summary.log`、`artifacts/r234/tests-loop.log` |
| 7 | `node tools/playground/build.mjs` | `PASS esbuild-wasm assets and 74 editable sources` / `PASS prelude 68299 bytes; 74 apps` | `artifacts/r234/playground-build.log` |
| 8 | `python3 scripts/check_website.py` & `gen_examples_gallery.py --check` | 四类 `none`；`examples.html gallery up to date (74 cards)` | `artifacts/r234/check-website.log`、`artifacts/r234/gen-gallery.log` |
| 9 | `git diff origin/main -- firmware/ runtime/ tools/` & ASCII 校验 | 禁改目录 diff 为空；`ADDED_LINES: 166 NON_ASCII_ADDED_LINES: 0` | `artifacts/r234/forbidden-diff.log`、`artifacts/r234/ascii-check.log` |

---

## 6. 仍未验收（真机 deferred）

真机 Waveshare ESP32-S3-Touch-AMOLED-2.16（466×466 CO5300 / CST9220）实际触控热区手感、小字清晰度、WiFi/BLE 交互与 PSRAM/帧率峰值均未在硬件板卡上验证，继续保持 deferred to board bring-up。
