# r198 收口报告 — Sparkline 存量迁移债务确认关闭（r194 已实施；本轮 docs/test 层）

基线 `origin/main b97e2ea`（2026-11-26，r197 已收口），worktree `/tmp/lume-r198-wt`，分支 `r198-sparkline-migration`。**全部证据为宿主机证据**；真机显示 / 触控 / 配色对比度 / 刷新时序未实测，deferred 到 board bring-up，不声称真机验证。

## 1. 首要实证：简报前提与代码现状不符

简报的依据是 r193 节登记的「既有 dashboard / hr_monitor / heart_curve 的 app.js 未动，存量替换留后续刀」。动手前逐项核实，结论是该债务**已由 r194 关闭**：

| 实证 | 结果 |
|---|---|
| `git log --oneline -- examples/{dashboard,hr_monitor,heart_curve,sparkline_demo}/app.js` | 顶部为 `776dd62 feat(r194): ... consume shell.Sparkline` |
| r194 三个提交 | `776dd62` feat（三个 app + playground 生成物）、`e1e0b27` test（harness 锚点 + 白名单）、`c97d028` docs（`docs/r194-report.md`，§2 已逐 app 记载迁移） |
| 三 app 源码 | 已全部调用 `lume.ui.shell.Sparkline`：`examples/dashboard/app.js:402`、`examples/hr_monitor/app.js:149`、`examples/heart_curve/app.js:11`；且都已 `import '../../runtime/shell.js'` |
| `git diff origin/main -- <三个 app.js>` | 0 字节（`artifacts/r198/app-zero-diff.txt`） |
| KNOWN-SIMPLIFICATIONS | r193 节仍留有「存量替换留后续刀」字样，r194 未在同文件补节 —— 属**陈旧文档债务**，非代码债务 |

按 AGENTS.md §5「假设可能错先实证 / 改动最小化」的纪律，本轮**不重写已完成的迁移**（重做只会产生 churn）；实际交付为：确认现状 → 关闭陈旧文档债务 → 同步白名单 → 全量复核归档。

## 2. 逐 app 迁 / 不迁判定表

| app | 判定 | 依据 | 本轮改动 |
|---|---|---|---|
| `examples/dashboard/app.js` | **已迁（r194）** | TRACE 页三轴折线为 `series` 三项 getter（读 `view().trace`，按 `t[k]*9` 映射），`min:-100 max:100`，`x:44 y:44 width:340 height:200`，`strokeWidth:2`，`showLast:true`；`go()` 按页显隐，图层在 5+5 网格 retained path 之上（`:396–409`） | 无 |
| `examples/hr_monitor/app.js` | **已迁（r194）** | 手绘 400x96 Canvas 折线改为 `data: history`，`min:55 max:105`，`strokeWidth:3`；signal 仍由 app 持有，`sendHr()` 发布即在组件 `onDraw` 内重绘（`:145–150`） | 无 |
| `examples/heart_curve/app.js` | **已迁（r194）** | `data: samples`，`width:400 height:152`，`strokeWidth:3`，`showDots:true`；自动 min/max 保持相对脉冲形状（`:7–11`） | 无 |
| `examples/dashboard_round/app.js` | **不迁** | 罗盘指针 + 气泡水平仪：`roundDraw()` 用 `arc` / `line` / `circle` 画即时姿态二维几何（`:35–56`），无时序数据、无 `polyline`，与 dashboard TRACE 折线不共享代码结构；Sparkline 只能表达一维序列，硬套会丢失表意 | 无 |

补充：`dashboard/app.js` 中的 `arc()`（`:48–55`）是「保留作参考」的未被调用函数（GAUGE 环已改原生 `Arc`），不是活动折线，未清理。

## 3. Sparkline 契约核对（动手前已读，作为判定依据）

组件实现在 `runtime/shell.js:747–849`，契约 harness 在 `tests/shell_sparkline.js`，标准用法见 `examples/sparkline_demo/app.js`：

- `data`（number[] / signal getter）为单线；`series`（`[{data,color?,strokeWidth?}]` / getter）优先于 `data`。
- `min` / `max` 显式给定时固定域，否则自动取有限样本范围；全平序列落 `y=height/2`；空数据只 clear；单点只画点。
- 非有限样本跳过；>240 点等距降采样保首尾（对应 prelude `polyline()` 上限）。
- `fillArea` 用主题 `surfaceAlt` 画面积带（RGB565 无 alpha）；`showDots` / `showLast` 给点标；`strokeWidth` 1..16。
- Canvas 注册到 shell dispose 链；数据留在调用方 signal，发布触发 owned effect 重绘，无新订阅机制。

r194 的三处替换均在上述契约覆盖范围内；未为旧视觉扩组件（hr_monitor 的 opaque surface 底、heart_curve 的白点 / 基准线等纯视觉差异，r194 报告已逐项取舍）。

## 4. harness 与白名单同步

- **三个 app 的既有 harness**：仓库中只有 `tests/hr_monitor.js`，且不含 Canvas / polyline / Sparkline 绘制锚点；`tests/dashboard.js` / `tests/heart_curve.js` 不存在。`tests/dashboard_round.js` 属「不迁」app，无折线锚点。r194 已同步 `tests/examples_gallery.js`（71→73 注释）与 `tests/ota_consumers.js`。**本轮无可更新的绘制锚点**，不改任何 harness 断言。
- **`tests/ota_consumers.js` ALLOWED**：按 r195/r196/r197 先例机械追加 `docs/r198-report.md` 与 `f.startsWith('artifacts/r198/')`；BASE 仍 `94f5d4e`，零 diff 守卫与全部断言谓词未改（不重钉、不自比较、不删守卫、不放宽）。新增前先跑 `node tests/ota_consumers.js`：`ALL OTA CONSUMERS HARNESS CASES PASSED`。

## 5. 验证（原始输出均在 `artifacts/r198/`）

| 项 | 命令 | 结果 | 证据文件 |
|---|---|---|---|
| 1 | `for t in tests/*.js; do node $t \|\| echo "FAIL $t"; done` | 107 个 harness，`FAIL` 行数 0（wordle 存量 flake 本轮未触发，未修） | `tests-all.txt` |
| 2 | `npm test --prefix tools/lume` | `pass 52` / `fail 0` / `skipped 0` | `cli-tests.txt` |
| 3 | `node tools/lume/lume.js check examples/<name> --no-emu`（dashboard / hr_monitor / heart_curve） | 3× `RESULT: PASS (4 steps, 0 failed; exit 0)` | `lume-check.txt` |
| 4 | `node tools/playground/build.mjs` ×2 | `PASS prelude 67546 bytes; 73 apps`；两次 `git status` 逐字节一致（幂等） | `playground-build.txt`、`playground-status-before2.txt`、`playground-status-after2.txt` |
| 5 | `python3 scripts/check_website.py` | missing / invented / duplicates / signatures-not-found 四类均 `none`；API 162 entries | `website-check.txt` |
| 6 | `git diff origin/main -- firmware/` | 0 字节 → 按纪律未跑 `idf.py build` | `firmware-zero-diff.txt` |
| 7 | `grep -Pn '[^\x00-\x7F]' <三个 app.js>` | 命中 1 处**存量** `dashboard/app.js:1` 的 `—`（基线注释）；相对 origin/main 新增字节中非 ASCII 为 0（三 app diff 0 字节） | `ascii-check.txt`、`app-zero-diff.txt` |

环境说明：worktree 缺 gitignore 的 `tools/lume/node_modules` 与 `tools/lume/bin/qjsc`，从主仓 `/home/ubuntu/lume` 只读软链对齐基线（源码零改动，`git status` 不可见）。CLI 入口用 `tools/lume/lume.js`（本仓无 `tools/lume/bin/lume.js`），与 r193/r194 的验证入口一致。

## 6. 范围、取舍与收尾

- 本轮**没有生产代码改动**：`firmware/`、`runtime/`（含 `shell.js`）、`tools/lume/`、vendored（QuickJS/LVGL）、examples 全部零 diff；改动仅 `tests/ota_consumers.js`（白名单）与 docs（`docs/KNOWN-SIMPLIFICATIONS.md` 新增 r198 节、`docs/r198-report.md`）+ 证据目录。
- KNOWN-SIMPLIFICATIONS 新增 r198 节，明确 r193 的「存量替换留后续刀」债务**已由 r194 关闭、r198 完成文档收口**，避免后续轮次再次按陈旧简报重复派发。
- 诚实口径：宿主机 harness 证明的是源码契约与 bundle 可构建；Sparkline 的 AMOLED 实际配色对比度、点标尺寸、面积带观感、Canvas 刷新时序与触控手感一律 deferred 到 board bring-up，**不声称真机验证**。
- 不改变 roadmap 里程碑定义；不 push；git 身份沿用 repo 级 congduan；commits 按 test / docs 拆分（本轮无 feat 内容，不制造空提交）。
