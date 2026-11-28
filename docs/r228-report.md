# r228 报告：合并悬尾分支 r225-singlebuffer-consumers（与 r226/r227 watchface 双线收敛）

## 0. 基线、事实核查与诚实口径

- **基线**：`origin/main 0ce2c7b`（r227，已推送），worktree `/tmp/lume-r228-wt`，分支 `r228-merge-r225`。r225 分支 `785abf3` 已 fetch；merge-base `1b310d6`（r224）。
- **实证先行**：未凭简报数字写断言。先跑宿主 harness 实测两条口径真值，再写断言；先写一行宿主断言验证 `__A_Canvas` 的 for-in 拷贝把 `singleBuffer` 透传进 bridge 消息流（480 与 466 两条路径都验）。
- **实测口径**：
  - 480：`{"canvases":[[12,12,1],[300,300,1],[300,300,0],[220,220,0]],"weightedPx":183472,"rawPx":228544}`。
  - 466：`{"canvases":[[12,12,1],[291,291,1],[291,291,0],[214,214,0]],"weightedPx":172889.5,"bytes":691558,"rawPx":215302}`。
- **口径**：全部证据为宿主机 harness / CLI 单测 / 构建产物 / 浏览器 playground，**无真机**；466/480 CO5300 圆屏观感、触控、帧率、PSRAM 峰值、singleBuffer 撕裂观感与异步 IMU 触发行为 deferred to board bring-up。`firmware/`/`runtime/` 零改动，`git diff origin/main -- firmware/ runtime/` 为空，**未跑 `idf.py build`**。

## 1. 合并与 5 处冲突解算

`git merge --no-ff r225-singlebuffer-consumers`。冲突面与解算语义（与主控制导出的证据一致）：

| 文件 | 冲突形态 | 解算 |
|---|---|---|
| `examples/watchface/app.js` | r227 的 `__A_*` 自适应包装 vs r225 的 `singleBuffer: true` + 注释 | **两侧叠加**：保留 r227 全部 wrapper，`__A_Canvas({...})` 两个调用点加回 `singleBuffer: true` 与 r225 注释；`__A_Canvas` 的 `for (k in p) o[k] = p[k]` 原样透传，**未改 shim 实现**。`singleBuffer: true` 只加在 digital 12×12 与 analog 300×300；goals 220×220、rings 300×300 保持双缓冲（r225 帧级实证的撕裂窗口结论，未动）。 |
| `website/playground/apps/watchface.js` | 生成物 | `node tools/playground/build.mjs` 重建，不手改。 |
| `website/playground/sources/watchface.js` | 生成物 | 同上；重建后与 `examples/watchface/app.js` `cmp` 一致。 |
| `website/playground/sources.js` | 单行全量 JSON 生成物 | 同上；未手拼。 |
| `docs/KNOWN-SIMPLIFICATIONS.md` | 两侧 append 段 | 两段全保留（先 r227 后 r225），只去冲突标记。 |

`docs/roadmap.md` 由 git 自动合并（r225 的 backlog #7 LANDED 段落入），无冲突。合并提交 `ec52b67`。

## 2. 预算断言收敛（两条断言并存，口径写清）

`tests/watchface.js` 先实测后改断言：

- **480 口径 = 1x px**：`canvasPixels === 183472`（480 尺寸 + singleBuffer 半价记账：`72 + 45,000` 单缓冲 + `90,000 + 48,400` 双缓冲）。断言同时锁定 1x 面恰为 `[[12,12],[300,300]]`、单缓冲原始 90,144 px、双缓冲 138,400 px，防止误迁 goals/rings。
- **466 口径 = 1x bytes**：从 r227 的 `px466 * 4 <= 868624`（全双缓冲 861,208 B）改为实测 `bytes466 === 691558`（`sum w*h*2*[single?1:2]`），上限仍为 `466*466*4 = 868,624 B`。`__A_Canvas` 的 min 收缩把 300×300 → 291×291、220×220 → 214×214，1x 后预算更宽裕（691,558 vs 861,208 B）。附加断言锁定 `__A_ADAPT` for-in 拷贝路径下 1x 面为 `[[12,12],[291,291]]`。
- 注释明确区分「480 = 1x px」「466 = 1x bytes」，两条断言各自留口径说明。

## 3. 480 像素等价金标准（冻结时钟 before/after）

照 r227 先例，用 `artifacts/r228/equivalence.js`（基于 r227 的 dump 与 r225 的 RGB565 镜像）：`before = git show origin/main:examples/watchface/app.js`（r227，无 singleBuffer），`after = 合并后 worktree`；两者在 480 逻辑像素、冻结时钟（`2026-01-01 10:31:00`）下经同一 `tests/lib/prelude_runner.js` 跑 boot + 6 帧 `faceTick()`。原始输出见 `artifacts/r228/equivalence.txt`：

```
BEFORE canvases: [["digital",12,12,0],["analog",300,300,0],["rings",300,300,0],["goals",220,220,0]]
AFTER  canvases: [["digital",12,12,1],["analog",300,300,1],["rings",300,300,0],["goals",220,220,0]]
RAW message count before/after: 637/637
RAW differences: 2
  DIFF[42] before=["create",6,3,2,12,12] after=["create",6,3,2,12,12,1]
  DIFF[74] before=["create",10,3,8,300,300] after=["create",10,3,8,300,300,1]
All raw differences are createNode singleBuffer flags only: true
NORMALIZED stream IDENTICAL: true
  before sha256: b47a270814b12ffaa60fa547f7a925305d2bdac58b37e455cdd901e044d84feb
  after  sha256: b47a270814b12ffaa60fa547f7a925305d2bdac58b37e455cdd901e044d84feb
TOTAL RGB565 diff: 0 / 1371264 px (IDENTICAL)
PASS 480px message stream + pixels IDENTICAL
```

**逐条差异解释**：原始消息流共 637 条，前后条数相同；唯一 2 条差异都是 `createNode` 的第 7 元素 `flags=1`（digital 12×12 节点 6、analog 300×300 节点 10），即 singleBuffer 的 1x 标志。**没有 publish 行为差异，也没有消息条数变化**：两块的 invalidate/draw 序列在 6 帧中逐帧一致（analog 每帧 FULL、digital 0 消息、rings 与 goals 不变）。归一化掉该标志后消息流 sha256 完全相同，24 份 face-frame RGB565 逐像素 0/1,371,264 diff。该像素比对是宿主确定性镜像，权威栅格路径是 C bridge；固件零改动，两侧结论一致。

## 4. 验证（原始输出见 `artifacts/r228/`）

1. **`tests/watchface.js` 全文 PASS 行**（`node tests/watchface.js`）：
   ```
   PASS watchface five-page swipe cycle
   PASS watchface 480 1x canvas budget 183472/230400 px (digital 12x12 + analog 300x300 singleBuffer); modular uses zero canvas
   PASS watchface weather updates only its own complication text
   PASS watchface weather WiFi-down fallback --°
   PASS watchface six native AA arcs; dirty area 46656 px
   PASS watchface progress clamps 0..100
   PASS watchface retained-path static contract (ticks + 3 bg rings)
   PASS watchface retained paths defined once, replayed on every redraw
   PASS watchface retained-path mutation guards (ticks, rings)
   PASS watchface 466 1x canvas budget 691558/868624 B (digital 12x12 + analog 291x291 singleBuffer)
   ```
2. **466 审计**：上述 466 断言 + `artifacts/r228/playground-verify.txt` 中 `__lumeScreen injected: SCREEN:466x466`、`watchface -> round ...` 与 `PASS all examples load without runtime errors`（74 app 全量加载）。
3. **480 消息流**：见 §3，`artifacts/r228/equivalence.txt`。
4. **全量回归末行**（`artifacts/r228/full-regression.log`，112 份 `tests/*.js`）：
   ```
   ALL tests/wordring.js PASSED
   WebSocket host prelude: PASS
   FAIL COUNT=0
   ```
5. **`npm test --prefix tools/lume` 末行**（`artifacts/r228/npm-test.txt`）：
   ```
   1..87
   # tests 87
   # pass 87
   # fail 0
   ```
6. **`node tools/playground/build.mjs`**（`artifacts/r228/playground-build.txt`）：
   ```
   PASS esbuild-wasm assets and 74 editable sources
   PASS prelude 68299 bytes; 74 apps
   ```
   二次构建后 `git status --short` 只有未跟踪的 `artifacts/r228/`，无已跟踪文件改动（幂等）。
7. **`python3 scripts/check_website.py`**（`artifacts/r228/website-check.txt`）：
   ```
   API missing: none
   API invented: none
   API duplicates: none
   API signatures not found in lume.d.ts: none
   ```
8. **`NODE_PATH=... node tools/playground/verify.mjs`**（`artifacts/r228/playground-verify.txt`）：全 PASS，末行 `PASS all examples load without runtime errors`。

## 5. 与简报的偏离（以源码/实证为准）

- 简报「480 消息流逐字节一致」按字面不可同时成立：加 `singleBuffer: true` 必然让 2 条 `createNode` 多出 `flags=1` 第 7 元素。实证给出**精确边界**：原始差异恰为这 2 个标志，归一化后逐字节一致，且 24 份 RGB565 帧像素完全相同。这满足「像素等价」的金标准，并逐条给出差异证据（§3）。
- 简报给 r225 的 480 真值 `183472` 与 r227 的 2x 口径 `861208 B` 都不是合并后的新口径：实测合并后 480=183,472（1x px，与 r225 一致，因 r227 480 恒等）、466=691,558 B（1x bytes，比 r227 的 861,208 B 更宽裕）。两条断言按各自口径并存。
- 466 断言从 `px466*4`（全双缓冲估算）改为按 `isSingle` 标志计算真实 PSRAM 字节，避免高估；上限 `868,624 B` 未改。

## 6. 未验收项

- 真机 CO5300 480/466 圆屏观感、触控、帧率、PSRAM 峰值未验。
- singleBuffer 全帧重绘的撕裂观感、异步 IMU 触发下的表现未验（r225 的帧级理由沿用）。
- `idf.py build`/`idf.py size` 未跑（`firmware/`/`runtime/` 零 diff）。
- 构建 raw 产物、消息流 dump、RGB565 bin 与比较脚本见 `artifacts/r228/`。
