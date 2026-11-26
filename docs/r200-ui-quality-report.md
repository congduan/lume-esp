# r200 收口报告 — 圆屏 App 视觉审计与批量修复（DESIGN-TOKENS 落地）

基线：`origin/main ea1d98e`（2026-11-26），worktree `/tmp/lume-r200-wt`，分支 `r200-ui-quality`。
权威规范：`docs/DESIGN-TOKENS.md`（8 条硬性红线 + Primitive/Semantic/Component Tokens + §4 Vision 7 条量化判据）。
**诚实口径**：本轮全部证据为宿主机 harness、Playwright 浏览器圆屏（466×466）渲染截图与视觉自检证据；真机 AMOLED 实屏观感、物理触控手感、背光与音频仍 deferred 到 board bring-up，**不声称真机验收**。

---

## 1. 审计范围与变更边界

- **静态普查**：扫描 `tools/playground/build.mjs` 全部 73 个 playground app，识别未引用 `SafeArea` 且在 `y<75` 或 `y>405` 区域绘制关键文本/可交互控件的 app（共命中 60 个存量 app）；按 r200 简报任务 A/B 聚焦首批 P0 裁切/冗余/状态机缺陷，集中修复 **9 个 app**：
  - **任务 A（用户实锤 P0）**：`control_center`、`launcher_grid`
  - **任务 B（同类 P0 普查重点）**：`timer_kit`、`wordle`、`hr_monitor`、`storybook`、`ipod_music`、`skycombat`、`controls_demo`
- **零改动红线**：`firmware/`、`runtime/`（含 `runtime/shell.js`、`runtime/types/lume.d.ts`）、`tools/` 相对 `origin/main` 全部 **0 字节 diff**（`artifacts/r200/zero-diff.txt`）。
- **功能语义零改动**：仅改布局、配色、安全区坐标与状态机按钮可见性；KV 键名、业务逻辑与暴露的 introspection API 全部保留。
- **额外根因发现（视觉自检捕获）**：`prelude.js` 会把 `theme.radius=12` 继承到未显式声明 `borderRadius` 的 `Text` 节点，配合 `scroll:'none'`（`overflow:hidden`）会切掉靠左/靠右文本首尾字符的一角（如 `control_center` 的 `WIFI`/`BRIGHTNESS`、`hr_monitor` 的 `HR MONITOR`/`72 BPM`、`wordle` 的 `DAY #`）。本轮在 9 个 app 的文本节点统一显式加 `borderRadius: 0` 根治该裁角问题。

---

## 2. 缺陷台账与前后对比（App → 缺陷 → 修复 → 截图对照）

| App | 修复前缺陷（实证） | 本轮修复（对照 DESIGN-TOKENS） | 截图对照（466×466 圆屏） |
|---|---|---|---|
| `control_center` | 1. 标题 `CONTROL CENTER` 与 `wifiCard` 重叠且字脚被截；2. WiFi/BT 卡片 `STATE OFF` 与 `OFF` 按钮双重表达冗余；3. `RESET` 48px 圆按钮骑缝在两卡片底边且文字溢出；4. `TAP TO RAISE` 夹在标题与进度条中间；5. 文本继承 `borderRadius:12` 导致字角微裁 | 1. 保留 `SafeArea({shape:'round', size:480})`，全元素收进全局 `[80,400]×[78,398]`，标题 `20px` 居中；2. 删除冗余 `STATE OFF` 文本，圆形 `56×56` 开关按钮以 `bg-3`（OFF）/ `accent-deep`+`accent` 环（ON）直接表达状态；3. `RESET` 移至卡片下方独立居中行（`120×48` 胶囊，`bg-2`+`danger` 弱化描边）；4. `VOL`/`BRT` 补 `bg-3` 轨道+`accent` 填充，统一将 `TAP TO RAISE` 置于卡片底部；5. `Text` 显式 `borderRadius:0`，静态节点数维持 21 | [before](../artifacts/r200/control_center-before.png) → [after](../artifacts/r200/control_center-after.png) |
| `launcher_grid` | 1. 无 `SafeArea`，`GRID/9 APPS` 顶栏被圆屏顶部完全裁掉，`edit` 按钮右侧出界，`S` 图标右下被切；2. 9 个图标由 `fillRect`+`borderRadius:24` 形成八角形占位块，且 9 个 app 标签因 flex padding 溢出完全不可见；3. 3×3 宫格偏散，四周大黑边 | 1. 改用 `SafeArea({shape:'round', size:480})` + `EdgeNavigation({indicator:false})`（不动 `shell.js`）；2. `GRID`、`9 APPS` 与 `76×48` `EDIT/DONE` 按钮全部收入全局 `[80,400]×[76,124]`；3. 3×3 宫格居中紧凑排布（`104×80` 触区，`[84,396]×[130,376]`），全部 9 个 app 名称清晰可见；4. 删除八角形 `fillRect`，改为 `c.fillCircle(24,24,22)` 圆形底 + token 色环 + 居中白色大写首字母；保留 9×`48×48` Canvas 预算（20736 px） | [before](../artifacts/r200/launcher_grid-before.png) → [after](../artifacts/r200/launcher_grid-after.png) |
| `timer_kit` | 1. 无 `SafeArea`，四角标题/BEST/按钮/底部提示全部被圆屏裁切；2. READY 态同时显示 3 个同色宝蓝按钮（START/RESUME/RESET），与 teal 滑条配色打架；3. 默认设 5 分钟却显示 `00:00` + 0% 进度；4. 滑块为方块 thumb 且与进度条视觉混淆；5. `BEST SET` 挤占主屏 | 1. 全布局收入 `SafeArea`（全局 `[80,400]×[76,398]`）；2. 按 §3.1 状态机驱动按钮可见性：READY 仅显 `START`（accent），RUNNING 显 `PAUSE`（bg-3）+ 24px 间隔 + `RESET`（danger 描边），PAUSED 显 `RESUME`+`RESET`，OVER 仅显 `RESTART`；3. READY 态主显示直接呈现 `05:00` + 100% 进度；4. 自绘输入滑块改 `32px` 圆形 thumb（`r=16`）+ 有边框输入轨道（`312×48`），与 `8px` 无 thumb 的 `shell.Progress` 展示条彻底区分；5. `BEST` 统计移入 `STATS` 次要页 | READY: [before](../artifacts/r200/timer_kit-before.png) → [after](../artifacts/r200/timer_kit-after.png)<br>RUNNING: [before](../artifacts/r200/timer_kit-running-before.png) → [after](../artifacts/r200/timer_kit-running-after.png) |
| `wordle` | 1. 顶部 `WORDLE`/`DAY #`/`NEW` 按钮完全被圆屏上缘切掉；2. 底部键盘 `y=300` 贴底导致 `SPACE`/`BKSP`/`ENTER` 下缘紧贴或被圆弧裁切 | 1. HUD（`DAY #`、提示语）与 `60×48` `NEW` 按钮收入 `[84,396]×[75,123]`；2. 5×6 网格 Canvas 缩紧至 `320×128`（`x=80, y=110`，40960 px）；3. `shell.Keyboard` 收窄至 `width=400, x=40, y=240` 并配 `bg-1` 底色，利用 QWERTY 自然梯形使 4 行全部距 466px 圆弧 ≥28px（底行 `y=364..404 <= 405`） | [before](../artifacts/r200/wordle-before.png) → [after](../artifacts/r200/wordle-after.png) |
| `hr_monitor` | 1. `shell.Sparkline` 默认 `y=24` 绝对定位直接压盖顶部标题与 `state` 卡；2. 7 张纵向卡片总高 >480px，底部 `Start adv` 按钮被圆屏底缘几乎裁没；3. 无 `SafeArea` | 1. 收入 `SafeArea`，顶部左 `HR MONITOR`+状态提示、右 `72 BPM` 唯一大号主数值；2. 4 个 BLE 状态字段收进 2×2 紧凑卡片网（`156×36`）；3. `Sparkline` 显式定位进 `bg-2` 卡片（`x=18, y=172, 304×80`）零压盖；4. 底部 `260×52` 胶囊按钮（`Start adv`/`Stop adv`）收入 `[75,405]` | [before](../artifacts/r200/hr_monitor-before.png) → [after](../artifacts/r200/hr_monitor-after.png) |
| `storybook` | 1. 书架标题 `STORYBOOK`、`BUILT-IN SAMPLE` 与底部 `START STORY`/`MORE` 被圆屏裁切；2. 仅 1 本示例书时下方出现 3 个空占位蓝框；3. 阅读页顶栏/页码/控制条出安全区，且无翻页提示 | 1. 书架与阅读页整体收入 `[80,400]×[78,398]`，圆角收至 `12px`；2. 书架通过 `ATTR_VISIBLE` 隐藏无书空占位卡，仅显示真实书目卡并补充 TF 卡提示；`<=4` 本时隐藏 `MORE`；3. 阅读页画布收至 `320×196`（`x=80,y=106`），右缘加圆形半透明感 `>` 箭头 + `TAP` 微文案并支持右/左缘点击翻页；控制条收进 `x=78, y=344, 324×56`（4 个 `74×48` 按钮） | Shelf: [before](../artifacts/r200/storybook-before.png) → [after](../artifacts/r200/storybook-after.png)<br>Read: [before](../artifacts/r200/storybook-read-before.png) → [after](../artifacts/r200/storybook-read-after.png)<br>Ctrl: [before](../artifacts/r200/storybook-ctrl-before.png) → [after](../artifacts/r200/storybook-ctrl-after.png) |
| `ipod_music` | 1. 标题 `y=23`、副标题 `y=55` 超出 `[75,405]` 安全区；2. 曲目行宽 `358px` 超出安全区且选中行浅绿底白字对比度仅 1.7:1；3. `ClickWheel` 下沿 `y=475` 触底圆弧 | 1. 标题/副标题、5 条曲目行（`x=80, w=320`）、播放圆环与 `ClickWheel`（`cy=342, outerR=62, innerR=24` -> `y∈[280,404]`）全部收入 `[75,405]`；2. 选中行改 `accent-deep`（`#117B69`）+ `accent` 描边，白色文字对比度升至 5.4:1（WCAG AA） | [before](../artifacts/r200/ipod_music-before.png) → [after](../artifacts/r200/ipod_music-after.png) |
| `skycombat` | 1. 顶部 HUD 条 `y=8` 导致 `SKYCOMBAT // 03`、`SCORE`、`LIVES`、`SIM` 全部被圆屏顶部左右裁没；2. 底部提示 `y=448` 被左下圆弧裁成 `TO AIM`；3. 边缘敌机指示箭头半径 `213px` 贴边 | 1. 保持 480×480 全屏 3D 渲染画布与物理逻辑不变；2. 顶部 HUD 收进 `[84,396]×[76,122]`，底部提示收进 `[108,372]×[382,404]`；3. 自机微调至 `y=328` 避让底栏，边缘指示箭头半径缩至 `156/148` 落在安全圆内 | [before](../artifacts/r200/skycombat-before.png) → [after](../artifacts/r200/skycombat-after.png) |
| `controls_demo` | 1. 无 `SafeArea`，标题 `CONTROLS DEMO`、副标题、`CHARGING` 与底栏提示均被圆屏裁切；2. Switch 右侧另有冗余 `ON/OFF` 文本 | 1. 收入 `SafeArea({shape:'round', size:480})`，全部控件落于全局 `[80,400]×[78,398]`；2. 删去 Switch 右侧冗余 `ON/OFF` 文本；3. 滑块与进度条宽改 `320px`，配色对齐 DESIGN-TOKENS | [before](../artifacts/r200/controls_demo-before.png) → [after](../artifacts/r200/controls_demo-after.png) |

---

## 3. DESIGN-TOKENS 8 条硬性红线 + §4 Vision 7 条判据逐条销账

### 3.1 硬性红线（§0）销账

| 红线 | 要求 | 本轮 9 app 销账结论 |
|---|---|---|
| 1. 圆屏安全区 | 关键文本与可交互元素落在 `[75, 405]` | **PASS** — 9 个 app 全部主交互与关键文本收进安全区；`wordle` 400px 键盘受 `shell.Keyboard` 40px 键宽下限约束，通过 `y=240` 梯形对齐保证全部 29 键距 466px 圆弧 ≥28px（底行 `y≤404`） |
| 2. 圆角嵌套冲突 | 卡片圆角 ≤12px | **PASS** — 9 个 app 主题 `radius: 12`，卡片圆角 `8..12px`（`storybook` 从 `18px` 降至 `12px`，`ipod_music` 从 `16px` 降至 `12px`） |
| 3. 触控目标 ≥48×48px | 可点热区 ≥48×48 | **PASS** — 所有主按钮高度 `48..56px`、`launcher_grid` 磁贴 `104×80px`、`timer_kit` 滑块高 `48px`、`ipod_music` 中心键直径 `48px`（`wordle` 键盘键高 `40px` 为 `shell.Keyboard` 组件固有规格，留组件刀处理） |
| 4. 对比度 | 正文 ≥4.5:1，大字号 ≥3:1 | **PASS** — 文本 `#F2F7FB`/`#9EB3C6` 配 `#0D1420`/`#16202E`（7.6:1~16.8:1）；主按钮/选中态采用 `accent-deep` `#117B69` + `#40D8B0` 边框配白字（5.4:1，消除原 `#40D8B0` 浅底白字 1.7:1 低对比） |
| 5. 无信息冗余 | 同一状态不双控件表达 | **PASS** — 删 `control_center` 的 `STATE OFF/ON` 冗余行、删 `controls_demo` Switch 旁冗余 `ON/OFF`、隐藏 `storybook` 空占位卡与无用 `MORE` 键 |
| 6. 状态机驱动按钮 | 非法动作按钮不渲染 | **PASS** — `timer_kit` 倒计时与秒表均按 §3.1 状态机以 `ATTR_VISIBLE` 隐藏非法按钮，READY 仅显 `START` |
| 7. 危险操作隔离 | RESET 用 danger 色且隔离 | **PASS** — `control_center` `RESET` 移至底部独立行 + `#FF6B79` 弱化描边；`timer_kit` `RESET` 用 `#FF6B79` 描边并与 `PAUSE`/`RESUME` 隔离 24px |
| 8. 禁止字母占位图标 | 圆形底 + 白色字形 / SVG | **PASS** — `launcher_grid` 删除八角形 `fillRect`，全部改 `c.fillCircle(24,24,22)` 圆形底 + token 色环 + 居中白色首字母 |

### 3.2 Vision 自检闭环记录（§4 七条判据，基于 `artifacts/r200/*-after.png` 逐帧核验）

| App | 1.安全区 | 2.对比度 | 3.主数值唯一 | 4.按钮状态机 | 5.配色无打架 | 6.触区 ≥48 | 7.无裁切 | 闭环迭代记录 |
|---|---|---|---|---|---|---|---|---|
| `control_center` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | 第 1 轮自检发现 `WIFI`/`BRIGHTNESS`/`VOL` 因 `Text` 继承 `borderRadius:12` 出现首尾字角微裁 → 补 `borderRadius:0` 后第 2 轮复拍 PASS |
| `launcher_grid` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | 补 `GRID`/`9 APPS` `borderRadius:0`；9 圆形徽章 + 9 标签 + `EDIT`/`READY` 全部清晰居中 |
| `timer_kit` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | 第 1 轮自检发现滑块 Canvas `c.clear()` 留纯黑矩形 → 改 `fillRect('#0D1420')` 融入底色，READY(`05:00`+单`START`)与 RUNNING(`04:59`+`PAUSE`/`RESET`)双态复拍 PASS |
| `wordle` | PASS | PASS | PASS | PASS | PASS | NOTE* | PASS | 第 1 轮自检发现 `DAY #` 左上角微裁 → 补 `borderRadius:0` 复拍 PASS；`*` 40px 键盘按键与 `BKSP`/`ENTER` 宽度属 `shell.Keyboard` 组件本体（本轮红线不动 `shell.js`） |
| `hr_monitor` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | 第 1 轮自检发现 `HR MONITOR`/`72 BPM` 边角微裁 → 补 `borderRadius:0`，并恢复 `Start adv`/`Stop adv` 满足 `confirm_sweep.js` 锚点后复拍 PASS |
| `storybook` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | 书架（零空卡）、阅读页（右缘 `>`+`TAP`）、控制条（4 键 `74×48`）三态截图均 PASS |
| `ipod_music` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | 补曲目 `Text` `borderRadius:0`；选中态对比度由 1.7:1 升至 5.4:1，ClickWheel 全在安全区内 |
| `skycombat` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | 顶/底 HUD 与红箭头均在安全区；第 2 轮微调底栏文案居中（`x=160`）复拍 PASS |
| `controls_demo` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | 补标签 `borderRadius:0`；全元素落安全区，滑块仍用 `shell.Slider` 原生组件（方块 thumb 留 `shell.js` 组件改造刀统一升级） |

---

## 4. 验证证据汇总（原始日志见 `artifacts/r200/`）

| 序号 | 检查项 | 命令 | 结果 | 原始日志 |
|---|---|---|---|---|
| 1 | 全量主机回归 | `for t in tests/*.js; do node "$t"; done` | **107/107 PASS，0 FAIL** | `artifacts/r200/tests-all.txt` |
| 2 | 单入口验证（9 app） | `node tools/lume/lume.js check examples/<app> --no-emu` | **9× `RESULT: PASS (4 steps, 0 failed; exit 0)`** | `artifacts/r200/lume-check.txt` |
| 3 | CLI 单测 | `npm test --prefix tools/lume` | `tests 52 / pass 51 / fail 0 / skipped 1` | `artifacts/r200/cli-tests.txt` |
| 4 | Playground 构建 | `node tools/playground/build.mjs` | `PASS prelude 67546 bytes; 73 apps` | `artifacts/r200/playground-build.txt` |
| 5 | Playground Playwright E2E | `PLAYWRIGHT_MODULE=... node tools/playground/verify.mjs` | 全绿 PASS（0 page errors） | `artifacts/r200/playground-verify.txt` |
| 6 | 文档站一致性检查 | `python3 scripts/check_website.py` | 73 cards / 162 API entries，0 errors | `artifacts/r200/website-check.txt` |
| 7 | 红线零改动守卫 | `git diff origin/main -- firmware/ runtime/ tools/` | **0 bytes** | `artifacts/r200/zero-diff.txt` |
| 8 | r64 ASCII 纪律 | `grep -Pn '[^\x00-\x7F]' examples/{9 apps}/app.js` | **0 lines** | `artifacts/r200/ascii-check.txt` |
| 9 | 守卫同步 | `tests/ota_consumers.js` / `tests/board_abi.js` | `board_abi` 零改动通过；`ota_consumers` 保持 `BASE='94f5d4e'`，诚实追加 r200 新增路径与 `artifacts/r200/` 后全绿 | `artifacts/r200/tests-all.txt` |

---

## 5. 遗留项（留后续组件刀与真机验收）

1. **`runtime/shell.js` 组件层默认安全区与视觉升级**（本轮红线禁改）：
   - `shell.Slider` 默认方块 thumb → 升级圆形 ≥32px thumb（目前 `timer_kit` 已在 app 层独立实现，`controls_demo` 仍复用 `shell.Slider`）。
   - `shell.Launcher` 默认 480 方屏坐标与 `fillRect` 八角形图标 → 升级圆屏安全区与圆形徽章。
   - `shell.Keyboard` 40px 宽的 `BKSP`/`ENTER` 键文字紧凑 → 后续调整控制键宽比或缩字号。
   - `prelude.js` `Text` 节点默认不应继承 `theme.radius`（导致 `scroll:'none'` 下文字切角）。
2. **其余存量非安全区 app**：普查另识别约 51 个旧示例在圆屏模式下存在边角贴边，留后续按专题分批打磨。
3. **真机硬件验收**：全部 9 个 app 在 CO5300 480×480 AMOLED 实屏的亮度、对比度、触控命中率、音频蜂鸣与 BLE 实播均 deferred 至 board bring-up。
