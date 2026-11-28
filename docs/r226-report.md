# r226 报告：Playground 按 App 自动切换屏幕形状 + 圆屏画布口径实证与安全区参考线

## 0. 基线、改动面与诚实口径

- **基线**：`origin/main 1b310d6`（2026-11-28），分支 `r226-playground-shape`。
- **改动面**：
  - `website/playground/page.js`（74 项 7 元组 `shape` 元数据、按 app 自动切换与手动覆盖语义、参数化 `logicalScreen`、切换形状重启、安全区参考线开关）
  - `website/playground/runtime.js`（`options.screen` 参数化注入 `__lumeScreen`，session 暴露 `screen`）
  - `website/playground/index.html`（`.screen-shape` 内新增双语 `Safe area / 安全区参考线` 按钮）
  - `website/playground/playground.css`（`.device-wrap.round.show-safe::after` 虚线安全区参考叠加层）
  - `scripts/gen_examples_gallery.py`（7 元组正则同步，生成的 `website/examples.html` 零漂移）
  - `tools/lume/examples.js`、`tools/lume/examples.test.js`（CLI `lume examples` 7 元组结构解析与 `shape` 字段输出）
  - `tests/examples_gallery.js`（7 元组正则同步）
  - `tools/playground/verify.mjs`（新增圆屏自动切换、手动覆盖保活、安全区参考线与 `runtime.js` 466 `__lumeScreen` 注入断言）
  - `docs/r226-report.md`、`artifacts/r226/`
- **严守不动面**：`examples/*/app.js`、`firmware/`、`runtime/`、`website/playground/prelude.js`、`website/playground/sources*.js`、`website/playground/apps/*.js` 均零改动（`git diff origin/main -- examples/ firmware/ runtime/ website/playground/prelude.js website/playground/sources.js website/playground/sources/ website/playground/apps/` 为空）；未跑 `idf.py build`。
- **诚实口径**：全部证据为宿主机 harness、CLI 单测与无头 Chromium Playwright 浏览器模拟截图（prelude 语义模拟，非真机 CO5300 466×466 1.75C 或 480×480 2.16 硬件实测）；真机观感、触控与外设表现仍 deferred 到 board bring-up。

---

## 1. 任务一：Per-App Shape 元数据 + 自动切换语义

### 1.1 根因与修复

原 `website/playground/page.js` 中 `setShape()` 是全局开关：点击一次 Round 后写入 `localStorage('lume-screen-shape')`，切换任意 app 不再改变屏幕形态；且默认 Square 形态下打开 r204–r206 圆屏重制 app（例如 `files`、`settings`、`weather`、`music_player`、`control_center`、`launcher_grid`、`image_gallery`、`adc_meter`、`crypto_check`、`archive_view`、`img_view`）时，app 自身在 480×480 黑底内绘制的 `452×452` / `448×448` / `436×436` 圆形底盘会直接暴露在方形屏框中，造成用户报告的「方屏预览时带着圆屏背景色」。

本轮修复：

1. `examples` 元数据从 6 元组扩展为 7 元组 `[id, icon, en, zh, descEn, descZh, shape]`，其中 `shape` 为 `'round'` 或 `'square'`（74 项逐个实证：37 `round` + 37 `square`）。
2. `select(name)` 切换示例时自动调用 `setShape(appShape(name), { persist: false, restart: false })`，再执行 `startScript(LUME_APPS[name])`（单次启动，不重复 eval，且不覆盖 `localStorage`）。
3. 用户手动点击 `Square 480 × 480` / `Round 466 × 466` 按钮时调用 `setShape(next, { persist: true, restart: true })`：
   - 记录 `savedShape` 到 `localStorage('lume-screen-shape')`，仅作无 `shape` 元数据条目及 `#code=` 编辑器分享链接的兜底；
   - 本次停留在该 app 期间尊重用户手动选择（含点击 `#restart` 按钮：改为直接 `startScript(LUME_APPS[current])`，不再回弹重置形态）；
   - 切换到其他 app 时再次自动对齐目标 app 的 `shape`；
   - 形状确实变化且已有运行 session 时自动重启当前 app。
4. 防御兜底：默认启动形态保持 Square 480×480（`counter` 为 `'square'`，`meta()` 缺省第 7 项为 `'square'`），不破坏现有 `rounded square device frame` 断言。
5. 下游同步：`scripts/gen_examples_gallery.py`、`tests/examples_gallery.js`、`tools/lume/examples.js`、`tools/lume/examples.test.js` 同步升级至 7 元组校验，`gen_examples_gallery.py --check` 零改动通过（`website/examples.html` 74 卡保持不变）。

---

## 2. 任务二：圆屏画布口径（实证发现与边界决策）

### 2.1 先读源码实证结果（简报假设证伪）

简报假设「`prelude.js` 已按 `__lumeScreen.w/h` 参数化，因此在 `runtime.js` 圆屏模式下直接注入 `__lumeScreen = { w: 466, h: 466 }` 并让 74 app 加载无报错」。

实测验证（以 `tests/lib/prelude_runner.js` 在 `{ w: 466, h: 466 }` 下逐一运行全部 74 份 `website/playground/apps/*.js` 产物，完整日志见 `artifacts/r226/audit-466.log`）：

- `prelude.js:1061-1068` 确实无 480 硬编码：`SW = __lumeScreen.w, SH = __lumeScreen.h`，`Canvas()` 校验 `1..SW` / `1..SH` 且预算上限为 `SW * SH * 4`（466×466 时为 `868,624` B，小于 480×480 的 `921,600` B）。`renderer.js` DOM 层亦无 480 硬编码。
- **但 74 份 app 源码本身全部按 480×480 逻辑坐标系编写**（0/74 直接读 `__lumeScreen` 或 `lume.screen`；仅 `keyboard_demo` 与 `shell_demo` 经 `runtime/shell.js` 间接读到 `__lumeScreen`）。
- 在 `__lumeScreen = { w: 466, h: 466 }` 下，**29 / 74 个 app 直接抛运行时异常崩溃**，其中包括 **13 个圆屏旗舰 app（含简报红线点名的 `watchface` 与 `clock_round`）**：

| 失败类型 | 数量 | 涉及 app（其中 **粗体** 为 `'round'` app） |
|---|---|---|
| `lume: canvas coordinate out of range`（硬编码 `Canvas` 宽 `480 > 466`） | 27（含 `raycast` 480×460 共 28） | **`clock_round`** (480×480)、**`dashboard_round`** (480×480)、**`timer_kit`** (480×480)、**`fitness`** (480×480)、**`aurora_clock`** (480×480)、**`luna`** (480×480)、**`plasma`** (480×480)、**`spectrum_music`** (480×480)、**`wordring`** (480×430)、**`golf`** (480×420)、**`minigolf`** (480×480)、**`lcd_dual`** (480×480)、`mario` (480×352)、`gravity_ball` (480×480)、`pet` (480×480)、`skyfire` (480×480)、`skycombat` (480×480)、`invaders` (480×480)、`frogger` (480×480)、`sokoban` (480×480)、`memory` (480×480)、`minesweeper` (480×480)、`scroller` (480×352)、`raycast` (480×460)、`fishtank` (480×480)、`particles` (480×480)、`flapdot` (480×400)、`mochi` (480×400) |
| `lume: canvas PSRAM budget exceeded` | 1 | **`watchface`**：4 块 Canvas（12×12 + 300×300 + 300×300 + 220×220）双缓冲共 `914,176 B`，超过 `466×466×4 = 868,624 B` |

- 此外，其余未崩溃的圆屏 app（如 r204–r206 的 `files`、`settings`、`weather`、`music_player`、`control_center`、`launcher_grid`、`image_gallery`、`adc_meter`、`crypto_check`、`archive_view`、`img_view`）均在 480×480 内以 `(240, 240)` 为圆心绘制 `452/448/436` 圆形底盘或 `[75, 405]` 安全区；若将 `#device` 逻辑画布硬缩为 `466×466`，其圆心会整体向右下偏移 7px 并裁切右/下缘。

### 2.2 本轮诚实落地策略

在不碰 `examples/*/app.js` 和 `prelude.js` 且守住 `verify.mjs` 74/74 全 PASS 的前提下：

1. **`runtime.js` 已完成真参数化**：`LumePlaygroundSession(script, { screen: { w, h } })` 支持注入任意正整数 `{ w, h }` 作为 `__lumeScreen`（默认 `{ w: 480, h: 480 }`，与 `tests/lib/prelude_runner.js:402` 同口径），并在 session 返回对象上暴露 `screen: { w, h }`。`verify.mjs` 新增独立断言验证 `{ screen: { w: 466, h: 466 } }` 真正注入 `__lumeScreen.w === 466`。
2. **`page.js` 消除散落魔数并支持切换形状重启**：`resize()`、`dispatch()`、`startScript()` 统一读取 `logicalScreen`（当前固定 `{ w: 480, h: 480 }`，圆屏模式通过 `.device-wrap.round` `466×466` + `scale(wrap.clientWidth / logicalScreen.w)` = `scale(466/480)` 居中映射到 466px 圆形视口）；手动切换形状会重启当前 app。
3. **不伪造 `__lumeScreen`**：绝不向 `prelude.js` 传 480 却向页面谎报 466。若未来要让圆屏模式默认跑原生 466×466 `__lumeScreen`，前置条件是专轮将上述 29 个硬编码 480 Canvas / 预算触顶的 app（及居中坐标）迁移为按 `__lumeScreen` 自适应。

---

## 3. 任务三：圆屏安全区参考线

- `website/playground/index.html` 在 `.screen-shape` 控件栏内新增 `#safe-area-toggle`（`data-en="Safe area" data-zh="安全区参考线"`），**默认关闭**（`aria-pressed="false"`），仅在圆屏形态显示，切回方屏时自动隐藏并复位。
- `website/playground/playground.css` 使用 `.device-wrap.round.show-safe::after` 伪元素叠加虚线框：`inset: 15.625%`（精确对应 `docs/DESIGN-TOKENS.md` 在 480 逻辑画布上的 `[75, 405]` / 330px 内切安全区）、`border: 1px dashed #fff`、`opacity: .15`、`pointer-events: none`。
- Playwright 实测（`verify.mjs` + `artifacts/r226/shots/04-clock-round-safe-guide.png`）：`opacity === 0.15`、`pointerEvents === 'none'`，与触摸交互和默认截图零冲突。
- 顺带观察（`artifacts/r226/shots/02-watchface-round.png`）：旧版 `watchface` 的左上角 `LUME / DIGITAL` 标签位于 `(32, 40)`，在圆屏下左端 `LUME / ` 会被圆弧裁切（属存量 app 布局，本轮按红线不动 `examples/watchface/app.js`）；相比之下 r205 `clock_round` 与 r206 `files` 严守安全区，圆屏观感完整居中。

---

## 4. 74 App Shape 判定表（源码实证依据）

共 74 项：**37 `round` + 37 `square`**。判定准则：
- 凡绘制 452/448/436 圆形底盘（`borderRadius >= 218`）或全圆表盘/圆环（`fillCircle`/`arc` 主视觉）或显式调用 `shell.SafeArea({shape:'round'})` / `shell.StatusBar({shape:'round'})` / 径向交互的 app 判 `'round'`；
- 凡矩形游戏棋盘、全宽横版/竖版 480 画布街机与沙盒、全宽键盘/钢琴/折线图及默认入口 `counter` 判 `'square'`。

| # | App | Shape | 源码实证依据 |
|---:|---|---|---|
| 1 | `counter` | `square` | 默认首页示例，矩形卡片与按钮，`verify.mjs` 校验默认 rounded-square 屏框 |
| 2 | `clock` | `round` | 居中 300×300 模拟圆盘时钟主视觉 |
| 3 | `clock_round` | `round` | r205 圆屏表盘，`fillCircle(240,240,224)` + `r=218` 金属表圈（`#000000` 底） |
| 4 | `dashboard_round` | `round` | r205 圆屏相对方位与水平仪，`r=218` 圆形表圈（`#000000` 底） |
| 5 | `games_snake` | `square` | 24×24 矩形网格贪吃蛇游戏（`verify.mjs` 方屏序列成员） |
| 6 | `games_2048` | `square` | 4×4 矩形方块合并游戏（`verify.mjs` `rounded square device frame` 前置项） |
| 7 | `games_breakout` | `square` | 矩形打砖块球场 `384×350`（`[48,76..432,441]` 四角超出圆屏内切圆） |
| 8 | `mario` | `square` | 全宽 `480×352` 横版平台画布（`x:0..480` 顶格铺满） |
| 9 | `calculator` | `square` | 矩形四则运算按键网格工具 |
| 10 | `weather` | `round` | r205 圆屏重制，含 `452×452`（`borderRadius: 226`）圆形底盘 |
| 11 | `music_player` | `round` | r204 Wear OS 径向媒体播放器，含 `436×436`（`borderRadius: 218`）圆形底盘 |
| 12 | `storybook` | `square` | 矩形 `320×196` 绘本插画卡片 + 翻页控件 |
| 13 | `ipod_music` | `round` | r200 圆形 ClickWheel 转盘交互，严格位于 `[75,405]` 安全区 |
| 14 | `dashboard` | `round` | LUME HUB 圆形仪表盘 + 安全区卡片布局 |
| 15 | `gravity_ball` | `square` | 全 `480×480` 矩形四壁物理弹球（撞屏幕四边回弹） |
| 16 | `typewriter` | `square` | 矩形打字机文本卡片（`padding: 28`，四角超出圆弧） |
| 17 | `heart_curve` | `round` | `padding: 76` 圆屏安全区心率脉搏曲线监视器 |
| 18 | `speedometer` | `round` | 圆形车速表盘，`320×320` 原生 `Arc` 色带（`r=156..160`） |
| 19 | `power_demo` | `square` | 矩形电源状态演示卡片工具 |
| 20 | `watchface` | `round` | 五种手表表盘（含模拟表盘、三环活动、目标环等圆形表盘） |
| 21 | `games_tetris` | `square` | 矩形 `160×320` 俄罗斯方块井道 + 侧栏预览 |
| 22 | `game_of_life` | `round` | 源码注明 `"emergence on a round screen"`，300×300 画布 + `[84,396]` HUD |
| 23 | `pet` | `square` | 全 `480×480` 矩形桌面宠物房间画布 |
| 24 | `async_demo` | `square` | 矩形异步按钮演示（`padding: 24`，四角超出圆弧） |
| 25 | `piano` | `square` | 全宽 `x:2..478` 横排钢琴琴键（贴近 480 左右边缘） |
| 26 | `compass` | `round` | 圆形 `360×360` 惯性方位刻度盘（`R_OUT=162`） |
| 27 | `skyfire` | `square` | 全 `480×480` 纵向弹幕射击街机游戏 |
| 28 | `skycombat` | `square` | 全 `480×480` 3D 体感空战射击画布 |
| 29 | `luna` | `round` | 居中圆形月球球体（`fillCircle(240,240,166)` + 320×320 球面贴图） |
| 30 | `invaders` | `square` | 全 `480×480` 矩形街机太空侵略者 |
| 31 | `frogger` | `square` | 全 `480×480` 矩形公路河道青蛙过河网格 |
| 32 | `abc123` | `square` | 矩形字母数字闪卡点读应用 |
| 33 | `sokoban` | `square` | 矩形推箱子关卡网格游戏 |
| 34 | `lcd_dual` | `round` | 双屏段码 LCD 玩具，HUD 与按键严格收于 `[84,396]` 圆屏安全区 |
| 35 | `memory` | `square` | 4×4 矩形翻牌网格（含左上 `[8,6]` 按钮） |
| 36 | `minesweeper` | `square` | 10×10 矩形扫雷棋盘网格 |
| 37 | `golf` | `round` | 10 洞俯视高尔夫，HUD 严格位于 `[84,396]` 圆屏安全区 |
| 38 | `scroller` | `square` | 全宽 `480×352` 横向精灵卷轴游戏（`x:0..480`） |
| 39 | `raycast` | `square` | 全宽 `480×460` 3D 第一人称迷宫视口 |
| 40 | `fishtank` | `square` | 全 `480×480` 矩形电子鱼缸场景 |
| 41 | `particles` | `square` | 全 `480×480` 矩形边界流体粒子沙盒 |
| 42 | `plasma` | `round` | 全画布无边缘控件的流体等离子表盘屏保 |
| 43 | `voice_assistant` | `square` | 对讲机卡片界面（`[0,34..480,434]` 覆盖全屏宽） |
| 44 | `spectrum_music` | `round` | 360° 径向圆形音频频谱音乐盒 |
| 45 | `ble_uart` | `square` | BLE 串口连接状态列表工具 |
| 46 | `spectrum` | `round` | 实时频谱仪，HUD 严格收于 `[84,396]` 圆屏安全区 |
| 47 | `svg_icon` | `square` | 极简 `480×480` 矢量图标渲染测试页 |
| 48 | `gestures` | `square` | 2×2 矩形手势测试卡片网格 |
| 49 | `aurora_clock` | `round` | r205 圆屏极光时钟（圆形表盘 + 流动极光丝带，`#000000` 底） |
| 50 | `flapdot` | `square` | 全宽 `480×400` 横版穿柱街机游戏 |
| 51 | `wordring` | `round` | 圆形 A-Z 字母环点选猜词游戏 |
| 52 | `image_gallery` | `round` | r206 圆屏重制，含 `452×452`（`borderRadius: 226`）圆形底盘 |
| 53 | `files` | `round` | r206 圆屏重制，含 `452×452`（`borderRadius: 226`）圆形底盘 |
| 54 | `adc_meter` | `round` | r206 圆屏重制，含 `452×452`（`borderRadius: 226`）圆形底盘 |
| 55 | `crypto_check` | `round` | r206 圆屏重制，含 `452×452`（`borderRadius: 226`）圆形底盘 |
| 56 | `archive_view` | `round` | r206 圆屏重制，含 `452×452`（`borderRadius: 226`）圆形底盘 |
| 57 | `img_view` | `round` | r206 圆屏重制，含 `452×452`（`borderRadius: 226`）圆形底盘 |
| 58 | `vec_demo` | `round` | `padding: 76` 圆屏安全区 + 居中 240×240 向量粒子盒 |
| 59 | `settings` | `round` | r205 圆屏重制，含 `452×452`（`borderRadius: 226`）圆形底盘 |
| 60 | `hr_monitor` | `round` | r200 显式使用 `shell.SafeArea({ shape: 'round', size: 480 })` |
| 61 | `keyboard_demo` | `square` | 466px 宽 QWERTY 软键盘（`x:7..473, y:456`，四角超出圆弧） |
| 62 | `wordle` | `square` | 448px 宽 QWERTY 软键盘（`x:16..464`）+ 5×6 矩形字母格 |
| 63 | `controls_demo` | `round` | r200 显式使用 `shell.SafeArea({ shape: 'round', size: 480 })` |
| 64 | `timer_kit` | `round` | r204 径向手表计时器（60 刻度圆盘 + 同心进度弧，`#000000` 底） |
| 65 | `control_center` | `round` | r204 圆屏控制中心，含 `448×448`（`borderRadius: 224`）圆形底盘 |
| 66 | `launcher_grid` | `round` | r204 3×4 圆屏应用宫格，含 `436×436`（`borderRadius: 218`）圆形底盘 |
| 67 | `minigolf` | `round` | 手表体感推杆迷你高尔夫，HUD 位于 `[84,396]` 安全区 |
| 68 | `color_demo` | `round` | r203 紧凑调色台，严格收于 `[75,405]` 圆屏安全区 |
| 69 | `mochi` | `square` | 全宽 `480×400` 吉祥物表情画布 |
| 70 | `shell_demo` | `round` | 显式使用 `shell.StatusBar({ shape: 'round' })` |
| 71 | `sparkline_demo` | `square` | `432px` 宽横向迷你折线图（`[24,20..456,474]` 超出圆弧） |
| 72 | `app_manager` | `square` | 矩形应用列表与双击卸载管理工具 |
| 73 | `imu_poll` | `square` | 三列 X/Y/Z 矩形卡片式传感器读数面板 |
| 74 | `fitness` | `round` | r204 三重同心活动环表盘（`r=207/187/167`，`#000000` 底） |

---

## 5. 验证结果与原始产物索引

全部原始日志与截图保存在 `artifacts/r226/`：

| 检查项 | 命令 | 结果 | 产物 |
|---|---|---|---|
| Playground 全量 Playwright 校验 | `NODE_PATH=/home/ubuntu/.npm/_npx/705bc6b22212b352/node_modules node tools/playground/verify.mjs` | **EXIT 0**（含 74/74 app 零错加载 + `rounded square device frame` + 圆屏自动切换/手动覆盖/安全区参考线 + `runtime.js` 466 `__lumeScreen` 注入） | `artifacts/r226/verify.log` |
| 示例画廊新鲜度 | `python3 scripts/gen_examples_gallery.py --check` | **EXIT 0**（`examples.html gallery up to date (74 cards)`） | `artifacts/r226/gallery-check.log` |
| 站点静态链接与 API 校验 | `python3 scripts/check_website.py` | **EXIT 0**（7 页、162 API、0 缺失/漂移） | `artifacts/r226/website-check.log` |
| CLI 单测 | `npm test --prefix tools/lume` | **EXIT 0**（`87 pass / 0 fail`） | `artifacts/r226/npm-test.log` |
| 画廊契约 harness | `node tests/examples_gallery.js` | **EXIT 0**（6 checks + 6 mutations PASS） | `artifacts/r226/examples-gallery-test.log` |
| 全量宿主 harness 回归 | `for t in tests/*.js; do node "$t"; done` | **EXIT 0**（`112 pass / 0 fail`） | `artifacts/r226/full-regression.log` |
| 74 app 466×466 实测审计 | `prelude_runner` `{w:466, h:466}` 遍历 | `ok=45 / fail=29`（实证记录） | `artifacts/r226/audit-466.log` |
| 场景实拍截图（5 张） | Playwright Chromium 1200×900 | 5/5 零错、目视核验通过 | `artifacts/r226/shots/01-counter-square.png`、`02-watchface-round.png`、`03-watchface-manual-square.png`、`04-clock-round-safe-guide.png`、`05-files-round.png`、`artifacts/r226/shots.log` |

### 关键原始输出摘录

`artifacts/r226/verify.log`（关键行）：
```
PASS page loads without JavaScript errors
PASS counter has nonempty screen DOM
PASS games_snake has nonempty screen DOM
PASS games_2048 has nonempty screen DOM
  border-radius: 36px
PASS rounded square device frame
  watchface -> round (50%), safe-area opacity=0.15, manual square + restart held, clock_round -> round, counter -> square
PASS round app auto-switches frame, manual override holds on restart, and safe-area guide toggles cleanly
  __lumeScreen injected: SCREEN:466x466
PASS runtime.js honors custom 466x466 __lumeScreen option
...
PASS all examples load without runtime errors
```

`artifacts/r226/shots.log`：
```
01-counter-square {"round":false,"safe":false,"wrapW":480,"wrapH":480,"radius":"36px","transform":"scale(1)","title":"Counter","err":false}
02-watchface-round {"round":true,"safe":false,"wrapW":466,"wrapH":466,"radius":"50%","transform":"scale(0.970833)","title":"Watchface","err":false}
03-watchface-manual-square {"round":false,"safe":false,"wrapW":480,"wrapH":480,"radius":"36px","transform":"scale(1)","title":"Watchface","err":false}
04-clock-round-safe-guide {"round":true,"safe":true,"wrapW":466,"wrapH":466,"radius":"50%","transform":"scale(0.970833)","title":"Round clock","err":false}
05-files-round {"round":true,"safe":false,"wrapW":466,"wrapH":466,"radius":"50%","transform":"scale(0.970833)","title":"File Manager","err":false}
```

`artifacts/r226/full-regression.log`（末行）：
```
SUMMARY: pass=112 fail=0
```
