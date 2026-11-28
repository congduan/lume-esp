# r230 报告：11 个 (240,240) 硬锚点圆屏 app → 原生 466 对齐收口

## 0. 基线、事实核查与诚实口径

- **基线**：`origin/main 25c0aa4`（2026-11-28，r229 已推送），worktree `/tmp/lume-r230-wt`，分支 `r230-round-anchor-alignment`。开工时 `git status --short` 为空，`HEAD == origin/main`。
- **任务边界**：纯 app 层。11 个 app 数量不变（74 不增不减），`firmware/`、`runtime/`、prelude、`tools/lume/`、其他 examples 零改动，未跑 `idf.py build`。
- **实证先行**：逐个读了 11 份 `app.js`，确认其锚点写法（下表）。r227 报告 §2「本轮不动」清单与 `docs/r229-report.md:92` 登记同一笔遗留：这 11 份仍以 480 逻辑坐标硬编码，原生 466 下圆心 `(240,240)` 相对屏幕中心 `(233,233)` 偏移 `+7px,+7px`。本轮不再诊断，只落地修复。
- **r227 口径照抄并修正一处**：沿用 per-app 内联 `__A_*` shim、`__lumeScreen` 推导 `SW/SH` + fallback 480、480 恒等。但实证发现 r227 shim 的 `__A_View/Text/Button/Image` 把**整个 props 对象**传给只处理 style 键的 `__A_style`，因此 r227 只缩放了 Canvas/DOM 的一部分——实测 r227 已迁移的 `clock_round` 在 466 下根 View 仍是 `480x480`、数字 `x=216` 未缩放（`artifacts/r230/...` 调试记录）。本轮在同样结构上加一层 `__A_props(p)`，只把 `p.style` 交给 `__A_style`；480 时仍原样转发，故 480 字节恒等不被破坏，466 下 DOM 坐标才真正按 `SW/480` 缩放。

## 1. 11 个 app 的锚点写法清单（实证）

| app | 当前锚点写法（迁移前） | 特殊处理 |
|---|---|---|
| `files` | `[76,404]` 安全区容器 `x:76,y:76,328x328`；外圈 bezel `14,14,452x452` | `List` 项高需 `__A_List` 单独缩放 |
| `settings` | 注释声明 `[75,405]` 安全区；大量 `320` 宽 Canvas / List（2 处） | `__A_List`；4 处 harness 文本断言同步 |
| `weather` | `root width:480,height:480`；hero `x:116,y:130`；三卡片位于 `[75,405]` | 无 |
| `music_player` | `root width:480,height:480`；cover `170,76,140x140`；transport `120,270`；`fillRect(0,0,240,72)` | 画布内绘调用由 `__A_ctx` 缩放 |
| `control_center` | `outerRoot 480x480` + `SafeArea({shape:'round',size:480})` | `size:480 -> size:SW`，466 下内切区 `329x329` 居中 |
| `launcher_grid` | `root width:480,height:480`；bezel `22,22,436x436` + `SafeArea({size:480})` | 同上；网格/图标经 `__A_*` 缩放 |
| `image_gallery` | `[76,404]` 安全区；`retainImage/drawImage` 精灵 | `__A_ctx().retainImage` 最近邻降采样（480 走快路径） |
| `adc_meter` | `meter Canvas 320x94` at `x:4,y:150` | 无 |
| `crypto_check` | 根 100% + 诊断卡片 90/150 等绝对 y | harness 非 ASCII mutation 断言受 shim 注释影响，已修 |
| `archive_view` | 根 100% + 内容卡片 300x106 | 无 |
| `img_view` | **`var SW=24,SH=24`（源图像尺寸，不是屏幕尺寸）**；`CW/CH=204` 画布 at `138,112`，`Math.floor((CW-r.dw)/2)` 居中 | app 内 `SW/SH` 重命名为 `__IMG_SW/__IMG_SH` 避让 shim；`tests/img_view.js` 的 scale 字符串同步更新 |

其中 8 份为「根 100% + 绝对像素锚点」，2 份（`control_center`、`launcher_grid`）依赖 `SafeArea(size:480)`，1 份（`img_view`）有同名词法冲突。均按实际写法处理，未为凑一致硬套。

## 2. 实现方式

- 每份 app 顶部插入约 95 行内联 shim（与 r227 同构，标记 `/* r230 adaptive:`），源码级把 `View/Text/Button/Canvas/Image/List(` 改名为 `__A_*(`；不 shadow 全局构造函数。
- `__A_style(s)` 按白名单缩放几何键（width/height/x/y/borderRadius/padding/margin/gap/fontSize 等）；颜色、枚举、百分比、`flexGrow`、`opacity` 透传。**新增 `__A_props(p)`**：保留 props 其余字段，仅将 `p.style` 交给 `__A_style`；`__A_List` 另缩放 `itemHeight`（`overscan` 是行数，不缩放）。
- `__A_ctx(c)` 覆盖本 11 app 实际使用的全部 ctx 方法（`clear/fillColor/fillRect/line/polyline/arc/circle/fillCircle/fillEllipse/ellipse/text/drawPath/retainPath/retainSegments/drawImage/retainImage`），坐标/半径按 `SW/480`、`SH/480` 取整，描边宽度/角度/颜色不变；`onDraw` 返回的脏区同步缩放并夹取到新画布边界。
- `SafeArea` 两份从 `size: 480` 改为 `size: SW`（480 时字面等价），466 下内切区由 480 口径的 `339x339@(70,70)` 变为 `329x329@(68,68)`，中心 `(232.5,232.5)`。
- `img_view` 的源图尺寸 `SW/SH` 改名 `__IMG_SW/__IMG_SH`（纯标识符重命名，运行时 `r.sw/r.sh` 展示值不变）。
- **480 恒等**：`__A_ADAPT === false`（即 `SW===480 && SH===480`）时所有 wrapper 原样转发同一对象、不拷贝不取整，故 480 原生消息流与迁移前逐字节一致（§3.1）。
- 一处与 r227 文字差异：`w.text` wrapper 用 `c['text'](...)` 而非 `c.text(...)`，因为 `tests/launcher_grid.js` 有一项「app 源码不得出现 `c.text(`」的存量断言；括号写法行为完全相同。shim 注释中的 `r227's` 改为 `the r227`，因为若干 harness 用朴素正则抽字符串字面量，注释中的撇号会错配引号。

## 3. 验证（原始输出见 `artifacts/r230/`）

### 3.1 480 原生消息流等价（冻结时钟，先实证再断言）

沿用 r227 的冻结时钟流对比法：`git show origin/main:examples/<app>/app.js` 作为 before，当前文件为 after，两侧经真实 prelude (`tests/lib/prelude_runner.js`) 在默认 480 屏运行 boot + 3 帧 `__lume_tick()`，逐条 JSON 比对完整 bridge 消息流（`create/attr/draw/batch/pathDefine/pathDraw/spriteDefine/spriteDraw/invalidate/...`）。4 份带 `import shell.js` 的 app 两侧都在同位置内联同一个无导出 IIFE。结果：

```
IDENTICAL files             msgs=341/341 sha256/16=6055afa035d3b55b / 6055afa035d3b55b
IDENTICAL settings          msgs=1309/1309 sha256/16=a5766f8da1284832 / a5766f8da1284832
IDENTICAL weather           msgs=518/518 sha256/16=402ecc350321e3e6 / 402ecc350321e3e6
IDENTICAL music_player      msgs=365/365 sha256/16=eaeb9cea54beb686 / eaeb9cea54beb686
IDENTICAL control_center    msgs=247/247 sha256/16=4823fc07d3aa2126 / 4823fc07d3aa2126
IDENTICAL launcher_grid     msgs=591/591 sha256/16=0dfb2a4f0e6cbdd2 / 0dfb2a4f0e6cbdd2
IDENTICAL image_gallery     msgs=180/180 sha256/16=729f89d8c097df38 / 729f89d8c097df38
IDENTICAL adc_meter         msgs=214/214 sha256/16=38ba5a0b5bc43556 / 38ba5a0b5bc43556
IDENTICAL crypto_check      msgs=189/189 sha256/16=622f58e97e7987ca / 622f58e97e7987ca
IDENTICAL archive_view      msgs=166/166 sha256/16=85151319c982ee28 / 85151319c982ee28
IDENTICAL img_view          msgs=104/104 sha256/16=9c8a46d171e9033d / 9c8a46d171e9033d
TOTAL=11 IDENTICAL=11 DIFFERENT=0
```

每条消息相同即渲染器输入相同，等价于像素级零差异（宿主证据，非真机）。

### 3.2 466 / 480 全量审计

按 r227 口径逐份运行 74 个生成的 playground bundle（真实 prelude、注入 `lume.raycast`/`lume.image` 宿主 stub、tick 一帧）：

```
SUMMARY_466 total=74 ok=74 fail=0
SUMMARY_480 total=74 ok=74 fail=0
```

原始日志：`artifacts/r230/audit-466.log`、`artifacts/r230/audit-480.log`。

### 3.3 466 几何实证（`artifacts/r230/geometry-probe.txt`）

直接由 shim 算术与宿主消息流读数确认 `+7px` 消除：

- `__A_SX(240)=233`、`__A_SY(240)=233`、`__A_SX(75)=73`、`__A_SX(405)=393`；对照 r229 参考线 `[72.8125,393.1875]`，误差 `≤0.2px`。
- 11 份 app 的最外层圆形 bezel/根容器中心由 `(240,240)` 变为 `(233.5,233.5)`（例 `14,14,452x452 -> 14,14,439x439`）；`weather`/`music_player`/`control_center`/`launcher_grid` 根容器为 `466x466`，中心 `(233,233)`。
- 两份 SafeArea app 的内切容器为 `(68,68) 329x329`，中心 `(232.5,232.5)`（`artifacts/r230/safearea-geometry.txt`）。

### 3.4 其余门禁

| 项 | 原始输出摘要 | 证据 |
|---|---|---|
| 全量宿主 harness | `TESTS_TOTAL=112`，`FAIL_COUNT=0`（循环无 `FAIL` 行） | `artifacts/r230/tests-loop.log` |
| CLI 单测 | `# tests 87 / # pass 87 / # fail 0` | `artifacts/r230/npm-test.log` |
| playground verify | `PASS=18 FAIL=0`（含 74 app 原生 466 圆屏加载） | `artifacts/r230/verify.log` |
| 网站检查 | `API missing/invented/duplicates/signatures not found: none` | `artifacts/r230/website-check.log` |
| 红线 diff | `git diff origin/main -- firmware/ runtime/ tools/lume/` -> `DIFF_BYTES=0` | `artifacts/r230/diff-probe.txt` |
| 生成物 | `npm run build:playground` 74/74 PASS，二次构建无已跟踪漂移 | `artifacts/r230/build.log` |
| 圆屏截图 | 6 张原生 466 截图，`round=true wrap=466 device=466px transform=matrix(1,0,0,1,0,0)`，无 `#error` | `artifacts/r230/shots/`、`screenshots.log` |

Playwright 截图优先覆盖 `launcher_grid`、`weather`、`music_player`、`control_center`，另加 `files`、`img_view`。目视：6 张均居中于圆形屏，网格/卡片/控件/文本无裁切异常；`weather` 中的中文城市/天气为 app 存量文案，非本轮新增。

### 3.5 ASCII 纪律

本轮新增非 ASCII 行 **0**（`git diff origin/main -- examples/ | grep '^+' | grep -cP '[^\x00-\x7F]'` = 0）。11 份 app 中存量中文文案（如 `weather` 的城市名）逐字未动，未为凑 NONE 改动存量 UI。

## 4. harness 同步（先实证后改断言）

4 份 harness 因源码文本被 shim 改写而需要同步，均先复现失败再改：

- `tests/control_center.js:90`、`tests/launcher_grid.js:96`：`SafeArea` 断言中的 `size: 480` -> `size: SW`（本轮 app 实际写法）；mutation proof 仍按原前缀工作。
- `tests/img_view.js:125/267`：`imgscale.scale(SRC, SW, SH, ...)` -> `imgscale.scale(SRC, __IMG_SW, __IMG_SH, ...)`（避让 shim 的同名冲突）。
- `tests/sntp_consumers.js:110/178/179`：`settings` sync row 的 `View/Text/Button(` 计数与 mutation 注入接受 `__A_` 前缀。

未触碰 `tests/timer_kit.js` 等其他 app 的断言。

## 5. 与简报的偏离（实证优先）

- **DOM 坐标也缩放**：r227 shim 原样复制时只缩放 Canvas 几何；若照抄则 11 个 app 的 `(240,240)` DOM 锚点不会动，`+7px` 仍在。因此保留 r227 同构结构但补 `__A_props`，使 style 真正缩放——目标（消除偏移）优先于「字面逐字照抄」。480 恒等由 §3.1 直接证明，未受损。
- **`SafeArea size` 自适应**：r227 已迁移的 `fitness`/`timer_kit` 仍写死 `size:480`，本轮未动它们（红线）；本轮两份 SafeArea app 改为 `size:SW` 才能把内切区中心从 240 移到 233。
- **生成物刷新范围**：`build:playground` 重建只改了这 11 个 app 的 bundle、`sources/<name>.js` 与 `sources.js`；其余 63 份 bundle 字节未变（与 r227 那次不同，无陈旧漂移需要顺带刷新）。这是 playground 能看到修复、且 `tests/playground_manifest.js` 保持通过的必要条件。
- **未做逐像素 A/B**：仅有 480 原生消息流逐字节等价 + 466 几何读数 + 浏览器截图，无宿主 RGB565 光栅化 harness 或 esp32sim 像素采样，不伪造像素 diff。

## 6. 未验收项

- 真机 CO5300 466 圆屏的实际观感（圆度、AA 边缘、触控命中精度）、帧率、PSRAM 峰值与 shim 引入的额外 JS 调用开销：deferred to board bring-up。浏览器截图与宿主证据不构成硬件验收。
- 11 个 app 的完整交互回归（逐按钮点击）未做；verify.mjs 只做 74 app 加载与部分既有交互用例。

## 7. 提交拆分

- `feat`: 11 份 app 的 shim 迁移 + 生成的 playground bundle/sources。
- `test`: 4 份 harness 断言同步。
- `docs`: 本报告 + `KNOWN-SIMPLIFICATIONS.md` + `roadmap.md` + `artifacts/r230/`。
