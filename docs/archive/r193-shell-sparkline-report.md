# r193 — M5 Component library 第八片：`shell.Sparkline` 迷你折线图（runtime/ + 纯 app 层）

基线 `origin/main 4416a98`（2026-11-26），worktree `/tmp/lume-r193-wt`，分支 `r193-shell-sparkline`。**未推送**。

## 范围

- `runtime/shell.js`：新增 `shell.Sparkline`，注册在 `shell.Progress` 旁；构造约定沿用 r151 表单原语（props 对象、`positive`/`callback` 校验、返回节点、`cleanups[id]` 清理链）。数据由调用方 signal 持有，在 `Canvas.onDraw` 内读值 —— prelude 的 owned effect 负责 publish 后重绘，未发明新订阅机制。
- `runtime/types/lume.d.ts`：`lume.ui.shell` 内新增 `SparklineSeries` / `SparklineProps` / `function Sparkline`；`scripts/gen_api_docs.py --check` 原本报 stale，重生成 `website/api.html` 后 162 entries 且 freshness 通过。
- `examples/sparkline_demo/app.js`：静态三序列 + 300 ms 定时器推点的 live 折线 + 显式 min/max 的 fillArea 折线；全部 UI 字面量 ASCII（非 ASCII 字节 0），中文只在 `page.js` 的 cn 元数据字段（r64）。
- 清单级联：`tools/playground/build.mjs` apps 数组、`website/playground/page.js` 元数据、`website/playground/index.html` script 标签、`sources.js` / `apps/*.js` / `prelude.js` 生成物、`website/examples.html` 画廊。
- harness：`tests/shell_sparkline.js`（13 组静态断言 + 逐条 mutation 反证 + live signal 行为）。

**零固件改动**：`git diff origin/main -- firmware/` 为空；`gen_lume_scripts.py` 与 `prelude/*.js` 均无 diff，故未跑 `idf.py build`。

## 关键取舍

- **`series` 优先级**：同时给 `data` 与 `series` 时以 `series` 为准，已在 `shell.js` 注释与 `.d.ts` 字段注释写明。
- **退化行为**：min/max 缺省自动取全部有限样本范围；全平序列 `lo == hi` 时所有点落在垂直中心 `y = height/2`，不除零；空数据只 `clear()`；单点不画 polyline，仅在 `showLast`/`showDots` 下画圆点；非有限样本跳过；超过 240 点等距降采样（保首尾）以不超过 Canvas `polyline` 上限。显式 `min >= max` 抛 `RangeError`。
- **fillArea 无 alpha**：RGB565 Canvas 的 `__canvasColor` 只接受 `#RRGGBB` 或 24-bit number，没有 alpha 通道，也没有多边形填充原语。折中方案：按整数列用现有 `line()` 从曲线画到底边，颜色取主题 `surfaceAlt`，得到低对比面积带；未引入新绘制原语。
- **playground 计数实证纠偏**：简报写「当前 69 → 70」，实证 `manifestApps()` 与 `page.js` 元数据**均为 70**，故本轮为 **70 → 71**。当前 harness 的数值断言已全部改为动态 `apps.length`，无需逐处改数字；仅同步了两处文案注释（`tests/examples_gallery.js:3`、`scripts/gen_examples_gallery.py:4`）。`tests/ota_consumers.js` ALLOWED 预加 4 个新文件路径与 `artifacts/r193/` 前缀，防 untracked 提交后 allChanged 守卫转红；未重钉 BASE、未放宽任何谓词。
- **build.mjs 陈旧点**：基线 `firmware/components/lume-engine/lume_scripts.c` 已成为 `#include "lume_scripts.inc"` 占位（提交 `920ee22` 起 C 数组改由构建期生成），而 `tools/playground/build.mjs:21` 仍直接读它，裸跑报 `missing lume_prelude_js`。本轮用 `gen_lume_scripts.py` 把 C 数组临时物化到 `lume_scripts.c`，重建后用备份原样还原，`git diff origin/main -- firmware/` 为空；生成的 `prelude.js` 与基线逐字节一致。本轮未改 build.mjs 的读取逻辑（超出授权面）。

## 验证（原始输出见 `artifacts/r193/`）

| # | 命令 | 结果 | 原始输出 |
|---|---|---|---|
| 1 | `for t in tests/*.js; do node $t \|\| echo "FAIL $t"; done` | **0 FAIL** | `full-suite.txt` |
| 2 | `node tools/lume/lume.js check examples/sparkline_demo --no-emu` | `RESULT: PASS (4 steps, 0 failed; exit 0)`，bundle 28971 bytes | `lume-check-noemu.txt` |
| 3 | `node tools/playground/build.mjs` | `PASS ... 71 editable sources` / `PASS prelude 67546 bytes; 71 apps` | `playground-build.txt` |
| 4 | `python3 scripts/check_website.py` | gallery 71 cards；API missing/invented/duplicates/signatures 均 none | `check-website.txt` |
| 5 | `NODE_PATH=... node tools/playground/verify.mjs` | 全 PASS，`sparkline_demo: 12 nodes` | `playground-verify.txt` |
| 6 | `npm test --prefix tools/lume` | 52 pass / 0 fail | `npm-test.txt` |

附加：`node tests/shell_sparkline.js` → `ALL SHELL SPARKLINE CASES PASSED (14 cases)`（`shell-sparkline-harness.txt`）；`python3 scripts/gen_api_docs.py --check` → `api.html is up to date with lume.d.ts (162 entries)`。

## 验收边界

宿主 harness、esbuild bundle、浏览器 playground 与 API 文档均为**宿主机证据**。折线的 AMOLED 实际配色对比度、`surfaceAlt` 面积带观感、点标大小、Canvas 像素预算/刷新时序与真机触控均**未实测，deferred 到 board bring-up；不声称真机验证**。既有 `dashboard` / `hr_monitor` / `heart_curve` 的存量手搓折线替换按红线留后续刀，其 `app.js` 未改。

未改 vendored（QuickJS / LVGL）、`.github/`、`tools/lume/`、`tests/board_abi.js` 的既有排除；未重钉 BASE；未 push。commits 拆分：feat / test / docs。
