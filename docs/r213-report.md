# r213 报告：圆屏安全区 batch6 收口（mochi + sparkline_demo）

## 0. 基线与口径

- 基线：HEAD `6d55ef3`（`origin/main`，r210 已并入），分支 `r213-safearea-batch6`，开工时工作树干净。未 push、未 rebase、未改里程碑。
- **工作树偏离登记**：派发脚本给出的 `/tmp/lume-r213-wt` 在开工后被并发的 `r213-site-pro` 轮接管（分支被切走、`website/` 设计文件被其修改）。为避免覆盖他人工作，本轮把已改的两个 app.js 以 patch 迁到独立 worktree `/tmp/lume-r213-safearea-wt`（同 HEAD `6d55ef3`、同分支 `r213-safearea-batch6`）完成全部验证与提交；共享 worktree 中该轮的 website 改动一律未触碰。
- 全部证据均为**宿主 harness / prelude_runner / esbuild bundle**；无真机、无截图、未跑 `idf.py build`（本轮零 firmware 改动）。圆屏观感、触感、可点手感 deferred 到 board bring-up。

## 1. 实证方法（先实证，再改坐标）

1. 改前先用 `tests/lib/prelude_runner.js` 跑原始 app，dump `create`/`attr` 消息得到真实 `x/y/w/h/text`，确认简报数字与当前码一致；基线全量回归 0 FAIL、两 app `lume check --no-emu` 均 PASS 后才动手。
2. 改后用同一 runner dump 同一组属性，逐项对照。原始输出：
   - `artifacts/r213/geometry-before.txt`
   - `artifacts/r213/geometry-after.txt`
   - `artifacts/r213/full-regression-before.txt` / `full-regression-after.txt`
   - `artifacts/r213/check-mochi.txt` / `check-sparkline_demo.txt` / `ascii.txt` / `shell_sparkline.txt`

## 2. 逐 app 改动前/后坐标对照表（实测，非抄简报）

安全方块为 480 圆屏的 `[75,405]`；区间写作 `[x起点..x终点, y起点..y终点]`。

### 2.1 mochi

| 元素 | 改动前（实测 dump） | 改动后（实测 dump） |
|---|---|---|
| Canvas `W×H` | `w=480 h=400`（装饰满幅，保留） | `w=480 h=400`（不变） |
| 根 View | `w=480 h=480`（100%） | `w=480 h=480`（不变） |
| 页码 `01 / 10` | `x=384 y=8 w=84 h=20` → `[384..468, 8..28]` | 不变（装饰性角落 HUD，红线 1 允许装饰出界） |
| name `Idle` | `x=16 y=408 w=280 h=24` → `[16..296, 408..432]` | `x=84 y=298 w=312 h=24` → `[84..396, 298..322]` |
| detail | `x=16 y=436 w=348 h=36` → `[16..364, 436..472]` | `x=84 y=322 w=312 h=24` → `[84..396, 322..346]` |
| `<` 按钮 | `x=376 y=410 w=46 h=58` → `[376..422, 410..468]` | `x=84 y=352 w=80 h=48` → `[84..164, 352..400]` |
| `>` 按钮 | `x=430 y=410 w=46 h=58` → `[430..476, 410..468]` | `x=316 y=352 w=80 h=48` → `[316..396, 352..400]` |

- 原名/详情与两按钮整体在圆边外（`y>405`、`x<75`、`x>405`），按钮不可点；改后四个元素全部落在 `[84..396, 298..400] ⊂ [75,405]`。
- 两按钮触区由 `46×58` 改为 `80×48`（≥48×48），圆角 10 ≤12；`lume.gesture.on(mochiCanvas, 'swipe'/'tap')` 绑定完全未动，mascot 渲染与 pose 数学未动。
- name 显式 `fontSize:16`、detail 显式 `fontSize:12`，最长详情（34 字符）在 312px 宽内为易读的一行。

### 2.2 sparkline_demo

| 元素 | 改动前（实测 dump） | 改动后（实测 dump） |
|---|---|---|
| 标题 `SPARKLINE DEMO` | `x=24 y=20 w=432 h=36` → `[24..456, 20..56]` | `x=84 y=88 w=312 h=24` → `[84..396, 88..112]` |
| 副标题 | `x=24 y=58 w=432 h=22` → `[24..456, 58..80]` | `x=84 y=112 w=312 h=16` → `[84..396, 112..128]` |
| `STATIC / 3 SERIES` | `x=24 y=92 w=432 h=20` → `[24..456, 92..112]` | `x=84 y=134 w=312 h=16` → `[84..396, 134..150]` |
| staticSpark | `x=24 y=116 w=432 h=88` → `[24..456, 116..204]` | `x=84 y=152 w=312 h=44` → `[84..396, 152..196]` |
| `LIVE / TIMER PUSH 300MS` | `x=24 y=216 w=300 h=20` → `[24..324, 216..236]` | `x=84 y=200 w=200 h=16` → `[84..284, 200..216]` |
| `N=8` | `x=332 y=216 w=124 h=20` → `[332..456, 216..236]` | `x=296 y=200 w=100 h=16` → `[296..396, 200..216]` |
| liveSpark | `x=24 y=240 w=432 h=88` → `[24..456, 240..328]` | `x=84 y=218 w=312 h=44` → `[84..396, 218..262]` |
| `FILLED / MIN 0 MAX 100` | `x=24 y=340 w=432 h=20` → `[24..456, 340..360]` | `x=84 y=266 w=312 h=16` → `[84..396, 266..282]` |
| filledSpark | `x=24 y=364 w=432 h=72` → `[24..456, 364..436]`（底边越界） | `x=84 y=284 w=312 h=40` → `[84..396, 284..324]` |
| PAUSE/RESUME 按钮 | `x=24 y=444 w=120 h=30` → `[24..144, 444..474]` | `x=84 y=340 w=96 h=48` → `[84..180, 340..388]` |
| 说明文本 | `x=156 y=444 w=300 h=30` → `[156..456, 444..474]` | `x=192 y=348 w=204 h=32` → `[192..396, 348..380]` |

- 实证结论：原 filledSpark 底边 `436 > 405`，确实不在安全区内；且原按钮行 `y=444..474` 与它上下相邻，必须把 filledSpark 上移并收缩，才能给 48px 触区让位。因此按简报「先实证再决定是否需要微调」对标题/标签/三根图表做了整体收口，全部进入 `[84..396, 88..388] ⊂ [75,405]`。
- 按钮触区 `120×30 → 96×48`（≥48×48），圆角 8；`paused` 信号、300ms timer、`onPause` 清理、主题配色与 `globalThis.sparklineDemo` 导出全部未动。
- `tests/shell_sparkline.js` 是 `runtime/shell.js` 组件 harness，不含任何 app 坐标断言：改前原样跑即 `ALL SHELL SPARKLINE CASES PASSED (14 cases)`，**零改动**。全仓 `tests/` 中没有任何用例引用这两个 app 的坐标，故未改任何测试文件。

## 3. DESIGN-TOKENS.md §0 八条红线逐条自查

| # | 红线 | 自查结果 |
|---|---|---|
| 1 | 圆屏安全区 `[75,405]` | **通过**：两 app 所有可交互元素与关键文本实测落在 `[84..396] × [88..400]`；mochi 的 480×400 Canvas 与角落页码为装饰性内容，按红线 1「装饰元素可出界」保留满幅。 |
| 2 | 卡片圆角 ≤12px | **通过**：mochi 按钮 10、sparkline 按钮 8，主题 radius 12，无新增更大圆角。 |
| 3 | 触区 ≥48×48 | **通过**：mochi `<`/`>` 各 80×48；sparkline PAUSE/RESUME 96×48。 |
| 4 | 对比度 ≥4.5:1 / 大字 ≥3:1 | **通过**：沿用既有调色板（主文 `#F2F7FB`/`#9EB3C6` 于 `#101418`/`#07111D`），未引入新色值；字号显式化不改变颜色。 |
| 5 | 无信息冗余 | **通过**：mochi 只有一组 name+detail 与一对导航按钮；sparkline 标题、副标题、三张图表各表达一件事，PAUSE 单一按钮。 |
| 6 | 状态机驱动按钮 | **通过**：sparkline 单按钮按 `paused` 在 PAUSE/RESUME 间切换，非法态不并存；mochi `<`/`>` 为恒合法的循环导航。 |
| 7 | 危险操作隔离 | **通过（N/A）**：两个 app 均无 RESET/删除类危险操作。 |
| 8 | 禁止字母占位图标 | **通过**：无字母占位图标；mochi 的 `<`/`>` 是既有的简单导航字形，置于主题按钮底色上，非 A-Z 占位。 |

三层 token：本轮未新增 Primitive / Semantic / Component token，仅复用既有颜色、字号阶梯与 8px 网格（84/96/312/16/24/32/48 均为 4/8 的倍数），符合 §1.3。

## 4. 验证证据汇总

| artifact | 结果 |
|---|---|
| `full-regression-before.txt` / `full-regression-after.txt` | `for t in tests/*.js` 全量回归改前、改后均 **0 FAIL**，末尾 `REGRESSION DONE` |
| `check-mochi.txt` | `RESULT: PASS (4 steps, 0 failed; exit 0)`，bundle 8483 bytes |
| `check-sparkline_demo.txt` | `RESULT: PASS (4 steps, 0 failed; exit 0)`，bundle 31539 bytes |
| `ascii.txt` | 两个 app.js 各 `grep -cPn '[^\x00-\x7F]'` = **0** |
| `geometry-before.txt` / `geometry-after.txt` | 改前/改后 `create`/`attr` 实测坐标 dump（见 §2） |
| `shell_sparkline.txt` | `ALL SHELL SPARKLINE CASES PASSED (14 cases)`，harness 零改动 |

`--no-emu` 按 CLI 设计跳过 eval/layout/perf，因此布局结论来自宿主 harness 与坐标 dump，不冒充布局 lint 结果。

## 5. 偏离登记

- **工作树接管**：见 §0；已迁到独立 worktree，未 push、未覆盖并发轮改动。
- **生成镜像同步**：`tests/playground_manifest.js` 断言 `website/playground/sources/<app>.js` 与 `sources.js` 必须逐字节等于 `examples/<app>/app.js`。改 app.js 后同步了 `website/playground/sources/{mochi,sparkline_demo}.js` 与 `sources.js`（与 r210 的 `f0d4d9b` 同类 `chore(playground)` 提交）。仅动生成的应用源码镜像，**未动任何 website HTML/CSS/设计文件**；manifest 仍为 **74** 个 app（未变）。
- **ASCII**：mochi 原文件头注释里有一个既存 em-dash（`—`），为满足 `grep -cPn '[^\x00-\x7F]'` = 0 改为 `--`；UI 字面量原本即为 ASCII，未改任何字符串内容。
- 本轮未新建 harness、未改 firmware/runtime/prelude/tools/manifest/.d.ts、未跑 firmware build、未 push。

## 6. 诚实口径

所有结论仅由宿主 harness、`prelude_runner` 坐标 dump 与 esbuild bundle 支撑。圆屏上的实际观感、触控手感、文字换行后的像素效果均**未做真机验证**，deferred 到 board bring-up；本报告不构成硬件验收。
