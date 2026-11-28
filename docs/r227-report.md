# r227 报告：29 个 466 审计崩溃 app → 按 `__lumeScreen` 自适应（第一批全量收口）

## 0. 基线、事实核查与诚实口径

- **基线**：`origin/main 30b0922`（r226 merge），worktree `/tmp/lume-r227-wt`，分支 `r227-round466-adaptive`。`tools/lume/bin/qjsc`、`tools/lume/node_modules` 为只读软链（不入 git）。
- **第一步实证（简报假设部分修正）**：
  - `firmware/components/lume-engine/prelude/prelude.js:1061` 确有 `var SW = __lumeScreen.w, SH = __lumeScreen.h;`，但这是 `Canvas()` 函数**局部变量**；全文件无全局 `SW`/`SH` 声明。
  - `__lumeScreen` 是宿主/设备注入的**全局对象**：`tests/lib/prelude_runner.js:402/407` 用 `options.screen || {w:480,h:480}` 注入 vm context，`website/playground/runtime.js:425` 用 `new Function(..., '__lumeScreen', ...)` 注入。app 源码可直接读取，无需 prelude 暴露等价物。
  - 结论：自适应模式为「app 顶层 `var SW/SH = __lumeScreen.w/h`，拿不到时 fallback 480」；prelude 不改。
- **审计口径**：`tests/lib/prelude_runner.js` 逐份运行 `website/playground/apps/*.js`（74 份），注入 `{w:466,h:466}` / `{w:480,h:480}`，tick 一帧；与 r218 口径一致注入 `lume.raycast` / `lume.image` 宿主 stub（否则 `raycast` 在两种尺寸下都会先因宿主无射线模块崩溃，属 harness 限制）。
- **本轮 before 基线（实测）**：`SUMMARY_466 total=74 ok=45 fail=29`（与 `artifacts/r226/audit-466.log` 完全一致）；`SUMMARY_480 total=74 ok=74 fail=0`。原始日志 `artifacts/r227/audit-466-before.log`。
- **口径**：全部证据为宿主机 harness / CLI 单测 / 构建产物，**无真机**；466×466 圆屏观感、触控、帧率、PSRAM 实测全部 deferred to board bring-up。未跑 `idf.py build`（`firmware/` 零改动）。

## 1. 实现方式：app 层内联自适应 shim（480 恒等）

29 个 app 合计约 400 KB 源码、数百个 Canvas/DOM 坐标字面量。逐字面量改写不可控且无法保证 480 像素零差异，因此采用**每 app 内联同一段 shim**（约 100 行，纯 app 层，不改 prelude/runtime/tools）：

- `var SW/SH` 从 `__lumeScreen` 读取，`typeof` 守卫 + fallback 480；`__A_ADAPT = SW !== 480 || SH !== 480`。
- 源码级把 `View(` / `Text(` / `Button(` / `Canvas(` / `Image(` 调用改名为 `__A_*`，wrapper 再调用原全局构造函数；刻意**不 shadow 全局**（`new Function` 场景下 prelude 构造函数不在 globalThis 上，无法捕获）。
- `__A_style()` 按白名单缩放几何 style 键（width/height/x/y/borderRadius/padding/margin/gap/fontSize/translate* 等），颜色、枚举、百分比、flexGrow、opacity 原样透传。
- `__A_ctx()` 包装 Canvas ctx：`fillRect` / `line` / `polyline` / `retainPath` / `retainSegments` / `drawPath` / `drawImage` / `circle` / `fillCircle` / `ellipse` / `arc` / `text` 的坐标与半径按 `SW/480`、`SH/480` 四舍五入；描边宽度、角度、颜色原样透传；自定义 ctx 属性（如 `c.crPaths`）经按 ctx 缓存的 wrapper 保留；onDraw 返回的脏区同步缩放并夹取到新画布边界。
- `__A_ctx().retainImage()`：精灵宽高超过 SW/SH 时按最近邻降采样后上传（实测仅 `scroller` 的 480 宽天空带触发）；480 走无重采样快路径。
- **480 恒等性**：`__A_ADAPT === false` 时所有 wrapper 原样转发原参数，不做任何拷贝/取整，因此 480 宿主消息流与改前逐字节一致（见 §3）。

圆心口径：`clock_round` 等圆屏 app 的 `(240,240)` / `r=224` 在 466 下变为 `(233,233)` / `r≈217`，即 `(SW/2, SH/2)`，等比收缩、居中不裁切。

## 2. 分批落地与收口

| 批次 | app | 结果 |
|---|---|---|
| ① watchface 预算 | `watchface` | 466 下 4 块 Canvas 由 300/300/220 自适应到 291/291/214，`861,208 B ≤ 868,624 B`；harness 新增 466 预算断言 |
| ② 13 个 `'round'` 旗舰 | `clock_round`、`dashboard_round`、`timer_kit`、`fitness`、`aurora_clock`、`luna`、`plasma`、`spectrum_music`、`wordring`、`golf`、`minigolf`、`lcd_dual`、`watchface` | 全部 466 崩溃消除 |
| ③ 其余 square 崩溃 app | `mario`、`gravity_ball`、`pet`、`skyfire`、`skycombat`、`invaders`、`frogger`、`sokoban`、`memory`、`minesweeper`、`scroller`、`raycast`、`fishtank`、`particles`、`flapdot`、`mochi` | 全部 466 崩溃消除 |

**29/29 全部完成，无剩余清单。** 简报点名「本轮不动」的 11 个未崩溃圆屏 app（`files`、`settings`、`weather`、`music_player`、`control_center`、`launcher_grid`、`image_gallery`、`adc_meter`、`crypto_check`、`archive_view`、`img_view`）源码零改动。app 数量仍为 74。

## 3. 验证（原始输出见 `artifacts/r227/`）

1. **466 全量审计**（`artifacts/r227/audit-466.log`）：
   ```
   SUMMARY_466 total=74 ok=74 fail=0
   ```
   before 为 `SUMMARY_466 total=74 ok=45 fail=29`，ok 严格递增 45 → 74。
2. **480 全量审计**（`artifacts/r227/audit-480.log`）：
   ```
   SUMMARY_480 total=74 ok=74 fail=0
   ```
3. **全量宿主 harness**（`artifacts/r227/full-regression.log`）：
   ```
   done
   ```
   0 FAIL（无 `FAIL ...` 行）。
4. **`npm test --prefix tools/lume`**（`artifacts/r227/npm-test.log`）：
   ```
   # tests 87
   # pass 87
   # fail 0
   ```
5. **`npm run build:playground --prefix tools/lume`**（`artifacts/r227/build.log`）：74 apps 全 PASS；第二次构建后 `git status --short` 与第一次完全一致（幂等）；`sources/<name>.js` 与 `examples/<name>/app.js` 74/74 字节一致。
6. **哨兵**（`artifacts/r227/sentinel.log`）：`RESULT: PASS (4 steps, 0 failed; exit 0)`。
7. **`python3 scripts/check_website.py`**（`artifacts/r227/website-check.log`）：`API missing: none` / `invented: none` / `duplicates: none` / `signatures not found: none`，74 卡片 up to date。
8. **480 宿主像素等价**：对 29 个改动 app 在 480 下 before/after 对比完整原生消息流（`create`/`attr`/`draw`/`batch`/`pathDefine`/`pathDraw`/`spriteDefine`/`spriteDraw`/`invalidate`），冻结时钟后逐条 JSON 比对：
   ```
   TOTAL=29 IDENTICAL=29 DIFFERENT=0
   ```
   每条消息相同即渲染器输入相同，等价于像素级零差异；逐 app sha256/16 见 `artifacts/r227/stream-equivalence-480.txt`。其中 5 个游戏类抽查为 `invaders` / `frogger` / `sokoban` / `mario` / `flapdot`。
9. **watchface 预算**（`artifacts/r227/watchface-budget.txt`）：
   ```
   PASS watchface 466 canvas budget 861208/868624 B
   ```
10. **ASCII**：本轮新增非 ASCII 行 `0`（29 个改动 app 中 7 份有 37 行**改前已存在**的非 ASCII 注释/中文 UI 字符串，逐字未动；未为凑 NONE 而改动存量文案）。

`firmware/`、`runtime/`、`tools/lume/`、prelude、vendored 均零改动，故未跑 `idf.py build`。

## 4. 与简报的偏离（以源码/实证为准）

- **未逐个改写坐标字面量**：采用 app 层内联 shim 达成同一目标（尺寸与坐标从 `__lumeScreen` 推导、fallback 480、圆心 `SW/2,SH/2`）。原因见 §1；收益是 480 消息流逐字节恒等，比逐字面量人工改写更可验证。
- **watchface 未在源码硬缩 300→290**：改由 shim 在 466 下按 `SW/480` 自适应缩放，480 观感与像素完全不变；budget harness 由「更新 480 数字」改为「新增 466 断言」，原有 480 断言保持严格不变。
- **生成物刷新范围**：重建 `build:playground` 时，除 29 个改动 app 外，另有 28 份未改动 app 的生成 bundle 从 HEAD 中的旧快照刷新到当前 `examples/*/app.js`（如 `app_manager` 的 `n=40` → `n=84`，为 r226 之前已存在的陈旧生成物）。这是满足「二次构建 git status 空」的必要条件，已在报告登记。
- **审计 harness stub**：`lume.raycast` / `lume.image.sizeOf` 宿主 stub 沿用 r218 口径；r226 原始日志未注入，故其 `raycast` 报错为 `setMap`，本轮带 stub 后为真实画布越界，崩溃清单仍为同一 29 个 app。
- **RGB565 像素 diff 替代证据**：本 worktree 无 `esp32sim` 缓存，也无宿主 RGB565 光栅化 harness；以「原生消息流逐字节相同」作为等价且更强的证据，不伪造像素采样结果。

## 5. 未验收项

- 真机 466×466 CO5300 圆屏的实际观感（圆度、裁切、AA 边缘）、触控命中、帧率、PSRAM 峰值与多画布双缓冲行为：deferred to board bring-up。
- shim 在 466 下引入的额外 JS 调用开销：宿主审计只验证正确性，未做 esp32sim/真机性能 A/B。
- 未改动的 11 个 `(240,240)` 锚点圆屏 app 在原生 466 `__lumeScreen` 下的居中偏移：留后续专刀。
