# r225 — watchface 五面选择性迁 `singleBuffer`（rendering-backlog #7 首个消费刀）

基线：`origin/main 1b310d6`（2026-11-28，r224 已合入）。worktree `/tmp/lume-r225-wt`，
分支 `r225-singlebuffer-consumers`（未 push）。**固件与 runtime 零改动**，本轮证据
全部来自宿主机 harness；真机 PSRAM / 撕裂观感 deferred 至 board bring-up。

## 1. 先验基线（改前）

`node tests/watchface.js` 与 `node tests/canvas_mapping.js` 均 PASS，原始输出见
`artifacts/r225/baseline-watchface.txt` / `baseline-canvas-mapping.txt`：

```
PASS watchface five-page swipe cycle
PASS watchface canvas budget 228544/230400 px; modular uses zero canvas
...
PASS r221 singleBuffer: C engine and bridge wire work==front and 1x budget
```

预算口径实证：`prelude.js:1067` 中 `cost = w*h*2*(singleBuf?1:2)`、上限
`SW*SH*4`；`tests/watchface.js:24` 的 `canvasPixels` 是 `sum(w*h)`，在四面全为
双缓冲时等价于预算占用。迁移后必须按 `m[6] & 1` 把 1x 面折半，否则断言失真。

## 2. 逐面帧级实证与迁移决策

`artifacts/r225/dump_frames.js` 通过 `tests/lib/prelude_runner.js` 跑真实 prelude +
真实 `examples/watchface/app.js`，注入确定性时钟（开机 `10:31:00`，每帧 +1 s），
调用真实 `faceTick()` 6 帧，逐面记录绘制消息与 RGB565 dump。原始输出：
`artifacts/r225/frames-before.txt` / `before.json`（改前）与 `frames-after.txt` /
`after.json`（改后）。

| 面 | canvas | 每帧重绘消息（6 帧实测） | invalidate | 驱动信号 | 决策 |
|---|---|---|---|---|---|
| digital | 12x12 | **0**（`draws/batches/invalidate` 全 0） | 无（开机一次） | `onDraw` 不读任何 signal | **迁 1x**：开机后无 publish，无撕裂窗口；收益 72 px |
| analog | 300x300 | 4 `draw` + 1 `batch` + 2 `pathDraw`，每帧一致 | `FULL` x1 | 只依赖 `faceNow`（1 Hz tick） | **迁 1x**：全帧覆写，撕裂窗口被下一帧覆盖；收益 45,000 px |
| rings | 300x300 | 1-2 `draw`（全盘 `fillRect`）+ 4-8 `batch` + 3-6 `pathDraw` | `FULL` x1-2 | `faceNow` + `faceBatt` + `faceSteps`（IMU 100 ms 异步） | **不迁**：异步 IMU 触发可能在 tick 之外，撕裂窗口不保证被下一帧覆盖 |
| goals | 220x220 | 7 `draw`（全盘 `fillRect` + 6 arc） | `RECT(2,2,216,216)=46,656 px` | `goalProgress`（1 Hz） | **不迁**：脏区增量重绘，按 r221 语义保留双缓冲 |
| modular | 无 canvas | — | — | 原生 `View`/`Text` | 不动（零 canvas 先例） |

证据要点：backlog #7 原文把 dial/rings 归为「dirty-rect faces」，但本 app 中
analog（dial）和 rings 实测都是 `FULL` invalidate；因此**不按面名，按驱动时序**
判定：analog 只有 1 Hz tick 驱动才迁，rings 因 IMU 异步触发保留双缓冲。

## 3. 迁移与预算断言

改动仅两处 canvas 构造（`examples/watchface/app.js`）：12x12 dot 与 300x300
analog 加 `singleBuffer: true`；同步更新两处 228,544 注释。
`tests/watchface.js`：

- `canvasPixels` 按 flags 折半 1x 面；死值 `228544` → `183472`；
- 保留 `<= 230400` 上限断言；
- 新增 1x 记账断言：1x 面恰好 `[[12,12],[300,300]]`、原价合计 90,144 px、
  未迁面原价合计 138,400 px。

预算：228,544 → **183,472 / 230,400 px**；释放 **45,072 px（=180,288 B
work 缓冲）**，余量从 1,856 px 增至 46,928 px。该红利登记为**未来扩展余量**
（第六面 / 新 complication），本轮不加新面（scope 纪律）。

## 4. 像素一致性（r212 的 0 px diff 口径）

归一化消息流（只剥掉 create 的 flags 参数）sha256 before/after 完全一致：

```
boot:        0a038b987c55e7e58001c6f4692e7fe1d0324ebd998d8d4dcad9ae2f3d50fc75
boot+6 tick: b47a270814b12ffaa60fa547f7a925305d2bdac58b37e455cdd901e044d84feb
```

24 份 face-frame RGB565 dump 逐像素比对（`artifacts/r225/pixel-diff.txt`）：

```
TOTAL: 0 / 1371264 px diff across 24 face-frames
```

说明：宿主光栅化是确定性镜像；权威栅格路径仍是 C bridge。由于固件零改动，
消息流一致即像素一致，两条证据方向相同。

## 5. 验证矩阵（原始输出均在 `artifacts/r225/`）

| 项 | 结果 | 原始输出 |
|---|---|---|
| 基线 `node tests/watchface.js` / `canvas_mapping.js` | PASS | `baseline-*.txt` |
| 迁移后 `node tests/watchface.js`（新断言） | PASS | `after-watchface.txt` |
| 全量 `for t in tests/*.js; do node $t ...` | **112 PASS / 0 FAIL** | `full-regression.log`、`full-regression-fails.txt`（空） |
| `npm test --prefix tools/lume` | 87 tests / 87 pass / 0 fail | `npm-test.txt` |
| `lume check examples/watchface --no-emu` | PASS（bundle 9178 B） | `lume-check.txt` |
| `npm run build:playground --prefix tools/lume`（74 apps） | PASS；只保留 watchface 生成物变更 | `playground-build.txt` |
| `python3 scripts/check_website.py` | none（74 cards，API missing/invented/duplicates: none） | `website-check.txt` |
| 像素 diff | 0 / 1,371,264 px | `pixel-diff.txt` |
| `git diff origin/main -- firmware/ runtime/` | **0 字节**（故未跑 `idf.py build`） | 下文 |

playground 重建时 esbuild 把无关 73 个 app bundle 的极小变量名重排（如 `e`→`t`），
按仓库惯例（r224 只提交 1 个 app bundle）已 `git restore` 这些无关生成物；
`tests/playground_manifest.js` 与 `check_website.py` 复验仍全绿。

固件零 diff 的原始输出：

```
$ git diff origin/main -- firmware/ runtime/ | wc -c
0
```

因此未执行 `idf.py build` / `idf.py size`，IRAM 16384 红线无新增风险。

## 6. 文档与边界

- `docs/roadmap.md` #7：`Not scheduled` → LANDED（r225），附预算前后与证据指针；
  milestone checkbox 未动。
- `docs/KNOWN-SIMPLIFICATIONS.md`：新增 r225 条目，记录迁移集合选择理由、
  未迁面取舍与 deferred 指标。
- UI 字面量 ASCII-only：新增注释与断言均为 ASCII，存量中文字符串未动。
- 未 push；按 feat（app + playground 生成物）/ test（watchface harness）/
  docs（roadmap + KNOWN-SIMPLIFICATIONS + 本报告 + artifacts）拆 commit。

**诚实口径**：以上全部是 host 证据，不构成硬件验收。真机 AMOLED 上
singleBuffer 的 PSRAM 峰值/碎片、全帧与异步 IMU 触发下的实际撕裂观感、
第六面扩展后的帧时间均 deferred 至 board bring-up。
