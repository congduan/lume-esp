# Lume r201 Design Notes — 480×480 圆屏专业级 HTML 设计稿（任务 A/B 确认门）

> **阶段**：任务 A（5 张独立高保真 HTML 设计稿 + Playwright 480×480 截图）与任务 B（设计确认门）。  
> **红线边界**：本刀仅新增 `artifacts/r201/design/*.{html,png}` 与本文档，**未修改** `examples/`、`firmware/`、`runtime/`、`tools/`、`tests/`。任务 C（按确认稿逐 app 翻译为 Lume `app.js`）待主控 vision 确认后在续刀实施。  
> **诚实口径**：本轮截图全部为宿主机无头 Chromium（Playwright 480×480）渲染结果；CO5300 真机 AMOLED 发光观感、微弱辉光衰减与物理触控手感仍 deferred 到 board bring-up，**不声称真机验收**。

---

## 1. 设计基准与 Token 扩展说明

5 张设计稿严格继承 `docs/DESIGN-TOKENS.md` 的 12 个 Primitive 色板（`bg-0` `#000000` ~ `info` `#5B9DF7`）、字号阶梯（`14 / 16 / 18 / 24 / 48`）、8px 间距网格、卡片圆角 `≤12px`、触区 `≥48px` 及全部 8 条红线。

为达成 Apple Watch Ultra / Galaxy Watch / Wear OS 级别的可穿戴景深与质感，本设计稿在 CSS `:root` 中声明了以下**扩展 Token**（全部由既有 Primitive 色板派生，不引入体系外游离色相）：

| 扩展 Token | 取值 | 派生来源 | 引入理由 |
|---|---|---|---|
| `--border-subtle` / `--border-strong` | `rgba(242,247,251,0.08~0.11)` / `rgba(158,179,198,0.20~0.22)` | `text-hi` / `text-mid` | AMOLED 纯黑/深蓝背景下用 1px 顶部高光与弱描边建立卡片材质边缘，替代生硬实线边框 |
| `--accent-soft` / `--accent-border` | `rgba(64,216,176,0.14)` / `rgba(64,216,176,0.38~0.42)` | `accent` `#40D8B0` | 用于状态徽章底色、激活态卡片微泛光，避免高饱和纯色大面积铺底导致视觉刺眼 |
| `--danger-soft` / `--danger-border` | `rgba(255,107,121,0.12)` / `rgba(255,107,121,0.55)` | `danger` `#FF6B79` | 用于独立 `RESET` 危险行与倒计时重置键：在保持 7.1:1 高对比的同时，视觉权重弱于主按钮 |
| `--tint-{accent,info,warn,danger,neutral}-{top,bot}` | 暗色梯度圆形底（由对应语义色降明度至 14%–24%） | `accent/info/warn/danger/bg-3` | 启动器 12 个图标徽章的暗色玻璃感圆盘底，衬托高亮线性 SVG 图标且保持 AMOLED 低功耗 |
| `--shadow-card` / `--shadow-knob` / `--shadow-accent` | 深黑投影 + 局部柔光 | `bg-0` / `accent` | 区分卡片浮层、开关 knob、滑块 32px thumb 与主 CTA 的 Z 轴层级（Task C 翻译至 Lume 时可退化为 1px 亮边 + 双环描边） |

---

## 2. 逐屏设计决策与 Task C 翻译映射

### 2.1 `timer.html` — 径向倒计时器（替代 `examples/timer_kit` 线性表单）

- **截图**：`artifacts/r201/design/timer.png` | **源码**：`artifacts/r201/design/timer.html`
- **布局逻辑**：
  - 彻底抛弃 r200 仍残留的「线性进度条 + 线性滑块垂直堆叠」手机表单范式，改用**瑞士腕表径向仪盘**。
  - 外环装饰区（`r = 188..213px`，严守 `≤ 220px`）：60 根精密刻度线（每 5 刻度加长加亮）+ 10px 凹槽轨道 + SVG 剩余进度弧（`READY` 态即满环 100%，配 12 点钟发光端点头）。
  - 安全区（`[75, 405]`）：顶部 `COUNTDOWN`（14px）→ 中心组（`● READY` 状态胶囊 + **48px `fs-display`** 居中主数值 `05:00`，与 9 点/3 点主刻度线精准对齐水平中轴 `y = 240`，左右配 `48×48px` 圆形 `-` / `+` 分钟步进键，消除输入滑块与展示条的视觉混淆）→ 底部 `54px` 胶囊操作栏。
- **色彩与状态机**：
  - `accent` 仅 2 处主呈现（进度弧 + `START` 主按钮），`START` 采用 `accent` 亮底 + `bg-1` `#0D1420` 深字（对比度 10.7:1，WCAG AAA）。
  - 严格落实 `DESIGN-TOKENS.md` §3.1 状态机：`READY` 仅渲染 `START`；点击交互后 `RUNNING` 显示 `PAUSE`（次操作）+ 24px 间距 + `RESET`（danger）；`PAUSED` 显示 `RESUME` + `RESET`；`OVER` 仅显示 `RESTART`；`BEST` 统计从主屏剥离。
- **组件来源**：Apple Watch Ultra Timer 径向刻度 + Wear OS 底部单主按钮。
- **Task C Lume 翻译提示**：外环刻度与弧线由单个全屏背景 `Canvas`（`ctx.arc` + `line`）绘制；中间 `05:00` 可用 `Canvas` 自绘矢量/放大数字（突破 bridge 32px 字体上限至 48px）或大字号字体；`-`/`+` 与状态机按钮直接用 `Button` + `ATTR_VISIBLE` 驱动。

### 2.2 `launcher.html` — 圆屏启动器（3×4 网格 + 12 枚手绘 SVG 系统图标）

- **截图**：`artifacts/r201/design/launcher.png` | **源码**：`artifacts/r201/design/launcher.html`
- **布局逻辑**：
  - 移除 r200 中占空间且无信息增量的 `GRID / 9 APPS / EDIT / READY` 工程式头尾条，顶部仅保留 watchOS 风格的 `10:09` 居中微型时钟（14px），底部放置 3 点页码指示器（激活胶囊 `18×6px` + 两枚 `6×6px` 弱化圆点）。
  - 中部在 `[75, 405]` 安全区内排布 **3 列 × 4 行**（每格 `96×65px` 全热区，内含 `48×48px` 圆形图标盘 + `14px` 居中标签），12 枚图标全部无裁切且与底部页点保持清晰呼吸间距。
- **色彩与图标工艺**：
  - **彻底消灭字母占位图标**（红线 R8）：12 个系统图标（Clock / Timer / Weather / Music / Fitness / Heart / Camera / Compass / Chat / Control / Alarm / Settings）全部采用内联手绘多元素 SVG，双色层次（语义色描边/填充 + `#F2F7FB` 主高光结构）。
  - 图标圆形底由 5 组暗色玻璃渐变构成（`accent / info / warn / danger / neutral`），全屏视觉统一、低噪不花哨。
- **组件来源**：Galaxy Watch One UI Watch 应用网格 + Apple Watch 圆形应用徽章语言。
- **Task C Lume 翻译提示**：在 `examples/launcher_grid` 中用每格 `48×48` `Canvas`（12 枚 = 27,648 px，远低于 230,400 px 预算）以基础矢量原语（`circle/arc/line/rect/polygon`）复刻这 12 枚图标，替代原 `c.text(..., app.glyph)` 首字母占位。

### 2.3 `control-center.html` — 控制中心 v2（专业开关 / 滑块 / 独立 RESET 危险行）

- **截图**：`artifacts/r201/design/control-center.png` | **源码**：`artifacts/r201/design/control-center.html`
- **布局逻辑**：
  - 全部元素收拢在 `320px` 宽（`x ∈ [80, 400]`、`y ∈ [79, 401]`）的 8px 网格中，卡片统一 `border-radius: 12px`（红线 R2）。
  - 标题层级清晰：`Control Center` 采用 `24px` `fs-title` 居中主标题；卡片主标签 `16px` `fs-label`；滑块标题与百分比数值 `14px` `fs-hud` 等宽数字对齐（全屏严格 3 级字阶）。
  - 第一行：Wi-Fi（展示 ON 激活态）与 Bluetooth（展示 OFF 未激活态）双列卡片（`154×80px`）。卡片内放置**真实腕表拨动开关**（`50×28px` 胶囊轨道 + `22×22px` 浮雕圆形 knob），状态由轨道发光色、knob 位移与卡片微泛光直接表达，彻底消除 `STATE ON/OFF` 双重冗余。
  - 第二、三行：Brightness（80%）与 Volume（60%）升级为**全宽横向滑块卡片**（`320×66px`，整卡作为 `≥48px` 触控热区），内置凹槽轨道 + `accent` 填充条 + **32px 圆形立体 thumb**（白色径向质感 + `accent` 描边 + `accent-deep` 中心锚点），消除原 `TAP TO RAISE` 文案与伪进度条。
  - 底部第四行：独立居中 `RESET` 危险胶囊行（`224×48px`），采用 `danger-soft` 底色 + `#FF6B79` 图标/文字/描边，与上方调节控件明显隔离。
- **组件来源**：watchOS Control Center 卡片网格 + iOS Toggle Switch / Precision Slider 规范。
- **Task C Lume 翻译提示**：`Switch` 与 `Slider` 卡片内部轨道/knob/32px 圆形 thumb 可用轻量化 `Canvas` 或多层 `View` 组合渲染，复用既有 `cc.wifi / cc.ble / cc.vol / cc.brt` KV 持久化与 introspection API。

### 2.4 `media.html` — 音乐播放页（Wear OS 媒体控制范式）

- **截图**：`artifacts/r201/design/media.png` | **源码**：`artifacts/r201/design/media.html`
- **布局逻辑**：
  - 告别原 `examples/music_player` 堆叠 8 枚方形按钮与错位歌词盒的桌面端思维，回归**Wear OS / Pixel Watch 经典四段径向居中结构**：
    1. **封面圆盘 + 环形进度**（`132×132px` 居中舞台）：`108×108px` 极光黑胶抽象 SVG 封面圆盘（带唱片微纹、中心主轴与斜向高光）外绕 `r = 61px` SVG 播放进度环（62% 进度 + 发光白点进度标）。
    2. **曲目元数据**：`24px` 粗体歌名 `Midnight Pulse` + `14px` 歌手与等宽时间 `Lume Synth · 02:14 / 03:42`（全屏仅 2 级字阶，克制干净）。
    3. **三键媒体控制行**：居中 `64×64px` 亮 `accent` 播放/暂停主圆键（深色 `#0D1420` 图标，对比度 10.7:1），左右隔 24px 排布 `52×52px` 上一首/下一首深色圆键。
    4. **胶囊音量条**（`276×48px`）：左右静音/高亮扬声器 SVG 图标 + 中央可拖拽音量轨与 32px 圆形 thumb。
- **色彩与层次**：顶部背景以极低饱和度的 `accent-deep` 径向环境光托起封面圆盘，外缘自然衰减至纯黑 `#000000`；全屏 `accent` 严格控制在 3 处（进度环 / 主播放键 / 音量条填充）。
- **组件来源**：Wear OS Media Controls + Apple Watch Now Playing。
- **Task C Lume 翻译提示**：封面圆盘与环形进度共用单枚 `132×132` `Canvas` 绘制；三枚圆形控制键采用 `borderRadius: 999` 的 `Button` + 居中符号/自绘图标；底部音量条复用 Control Center 同款滑块组件；歌词/曲库保留为次级抽屉页，不挤占主播放屏。

### 2.5 `fitness.html` — 运动数据页（三指标同心环 + 居中大数字）

- **截图**：`artifacts/r201/design/fitness.png` | **源码**：`artifacts/r201/design/fitness.html`
- **布局逻辑**：
  - 外环三道等距同心 SVG 运动环居中于 `(240, 240)`，外缘严格收敛在 `r = 214px ≤ 220px`，内缘留出直径 `320px` 的纯净内容井：
    - 外环（`r = 207px`，14px 宽）：**步数 Steps**（`--accent` `#40D8B0`，82%）；
    - 中环（`r = 187px`，14px 宽）：**卡路里 Burn**（`--warn` `#FFD78E`，68%）；
    - 内环（`r = 167px`，14px 宽）：**心率区间 Heart**（`--danger` `#FF6B79`，74%）。
    - 每道环的 12 点钟起跑点嵌入 watchOS 标志性的深色 `>` 方向微箭头，建立精致仪表感。
  - 内容井内部按圆形弦长收窄排布，四角距内环保留 `≥ 9px` 纯黑呼吸间隙：顶部 `TODAY · FRI 27`（14px）→ 中央唯一 **48px `fs-display`** 主指标 `8,240`（附步数图标与 `82% of 10,000`）→ 下方双列伴随指标卡片（`HEART 118 bpm` / `BURN 410 kcal`，`117×68px`，点击可切换中央主聚焦指标）→ 底部实时心率区间条 `● ZONE 2 · FAT BURN`。
- **色彩与层次**：三环精准复用既有语义色三元组（`#40D8B0 / #FFD78E / #FF6B79`），不引入多余新色；全屏字阶严格 3 级（`48 / 18 / 14px`），主数值唯一。
- **组件来源**：Apple Watch Activity Rings + Galaxy Watch Samsung Health 圆形仪表盘。
- **Task C Lume 翻译提示**：新建 `examples/fitness/` 时，背景三道同心环可用单枚 `Canvas` 绘制圆弧与 12 点箭头；中心区 `8,240` 主数字 + 双列 `Card` 与交互切换直接用 Lume `signal` + `View/Text` 声明式实现，并可接入 `lume.imu` 步数/模拟心率。

---

## 3. 红线自检与 Playwright 量化审计证据

所有 5 张 HTML 均通过 Playwright（480×480 viewport）截图与 DOM 几何脚本自动化审计，逐条对照 `docs/DESIGN-TOKENS.md` §0 八条红线与 §4 七条 Vision 判据：

| 设计稿 | R1 安全区 `[75,405]` | R2 卡片圆角 `≤12px` | R3 触区 `≥48px` | R4 对比度 AA | R5 零冗余 | R6 状态机 | R7 危险隔离 | R8 无字母图标 | 字号阶梯（≤3 级） |
|---|---|---|---|---|---|---|---|---|---|
| `timer.html` | PASS (0 越界) | PASS (胶囊/圆) | PASS (`48×48`, `184×54`) | PASS (10.7:1+) | PASS | PASS (`READY` 仅 `START`) | PASS (`RESET` 24px 隔离) | PASS (SVG) | `14 / 16 / 48` (3 级) |
| `launcher.html` | PASS (0 越界) | PASS (圆盘+12px 格) | PASS (`96×65`, `48×48` 圆) | PASS (11.8:1+) | PASS | N/A | N/A | PASS (12 枚手绘 SVG) | `14` (1 级) |
| `control-center.html` | PASS (0 越界) | PASS (`12px`) | PASS (`154×80`, `320×66`, `224×48`) | PASS (7.1:1~17:1) | PASS (无 ON/OFF 文案) | N/A | PASS (独立底行 `RESET`) | PASS (SVG) | `14 / 16 / 24` (3 级) |
| `media.html` | PASS (0 越界) | PASS (圆/胶囊) | PASS (`52×52`, `64×64`, `276×48`) | PASS (10.7:1+) | PASS | PASS (播放/暂停单键切换) | N/A | PASS (SVG+黑胶艺术) | `14 / 24` (2 级) |
| `fitness.html` | PASS (0 越界且距内环 ≥9px) | PASS (`12px`) | PASS (`117×68`, 中心主区) | PASS (8.9:1~17:1) | PASS | N/A | N/A | PASS (SVG+三环) | `14 / 18 / 48` (3 级) |

### 原始 Playwright 自动化校验日志

```text
timer {"errors":0,"violations":[],"touchIssues":[],"fontSizes":["14px","16px","48px"],"interaction":{"ready":["START"],"running":["PAUSE","RESET"],"paused":["RESUME","RESET"]}}
launcher {"errors":0,"violations":[],"touchIssues":[],"fontSizes":["14px"],"interaction":"ok"}
control-center {"errors":0,"violations":[],"touchIssues":[],"fontSizes":["14px","16px","24px"],"interaction":{"btAfter":"true","wifiReset":"false"}}
media {"errors":0,"violations":[],"touchIssues":[],"fontSizes":["14px","24px"],"interaction":{"nextTitle":"Aurora Drift"}}
fitness {"errors":0,"violations":[],"touchIssues":[],"fontSizes":["14px","18px","48px"],"interaction":{"hrLabel":"HEART RATE"}}
```

---

## 4. 下一步（等待主控确认门）

请主控结合 `artifacts/r201/design/*.png` 进行 vision 验收。确认 5 张视觉基准达标后，即可启动任务 C 续刀，按本设计稿逐一迁移改写：
1. `examples/timer_kit/app.js` ← `timer.html`
2. `examples/launcher_grid/app.js` ← `launcher.html`
3. `examples/control_center/app.js` ← `control-center.html`
4. `examples/music_player/app.js` ← `media.html`
5. `examples/fitness/app.js`（新增） ← `fitness.html`
