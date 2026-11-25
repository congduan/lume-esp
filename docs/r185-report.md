# r185 — flapdot `--visual` draw-budget 收口

基线 `670020e`（chore/fw-sync）。到岗时 `origin/main` 已前进到 `09dd892`，核查其仅改
`website/wasm/fw/lume.json`（fw-sync），无实质性合并，故按简报要求在当前基点继续，不 rebase。
全部证据来自宿主 harness / 浏览器模拟器 / esp32sim；**未连接真机，真机帧率、触摸手感、
功耗、音频、WiFi 全部 deferred**。

## 1. 结论速览

| 项 | 改前 | 改后 |
|---|---|---|
| flapdot `--visual` 三采样点累计 draw（1/3/6 s） | 2072 / 3736 / 6856（r180） | **56 / 91 / 141**（<250，全绿） |
| 半成品门控（DRAW_SKIP=6，仅此一项） | — | 512 / 824 / 1344（仍 FAIL） |
| `node tests/flapdot.js` | 全绿 | 全绿 + 新增空闲门控断言 |
| 全量 harness | — | 0 FAIL / 1555 PASS |
| emu 链 `--timeout 180` | — | PASS（2x "app eval ok"） |
| counter `--visual` 防回归 | ok:true | ok:true |

## 2. 根因

`tools/lume/check.js:203` 的 draw-budget 口径是 `/messages` 中 `m[0]==='draw'` 的**累计**条数，
在 1/3/6 s 三个采样点各查一次，`< 250` 才通过。浏览器模拟器（`tools/simulator/sim.js:89`）
以 50 ms 驱动逻辑 tick（20 Hz），而 flapdot 每个 tick 都 `sync()` → `frame.set()` → `onDraw()`
全量发布。`prelude_runner.js:259` 把每次 `ctx.fillRect` 记为一条 `draw` 消息；flapdot 单帧
约 50-60 条（鸟身 19 段 span、地面约 20 条 dash、每脏矩形一条 sky），因此 6 s 累计约
`20 × 6 × 57 ≈ 6840`，与 r180 实测 6856 吻合。这与 r168 fishtank 收口前同病：
逐 tick 全量发布压垮 UI 队列。

半成品已加的 `DRAW_SKIP=6` 只把发布频率降到 1/6，绝对量仍是 `~180 draw/s`，本轮实测
512/824/1344，仍全部超预算——说明**光靠门控不够**，必须同时削减"每次发布多少条"。

## 3. 改法与参数取舍

最终 `examples/flapdot/app.js` 三处 app 层改动：

1. **帧门控**（半成品保留并收口）：`DRAW_SKIP=6`。`run` 相每 tick 发布（30 Hz，物理步长
   `DT=1/30` 不变）；`ready`/`dead` 相每 6 tick 发布一次——设备 30 Hz/6 = **5 fps**，
   浏览器 20 Hz/6 ≈ 3.3 Hz。`sync()` 只在门控放行时调用；`onDraw()` 仍可读取最新 `state`。
2. **静止世界脏矩形跳过**：当 `state.s === prevDrawnS`（ready/dead 世界不滚动）时，
   管道带与地面条带内容未变，`onDraw()` 只发布鸟盒脏矩形，不再发布管道/地面。
   这省下每次空闲发布约 27 条与视觉无关的 draw 消息。
3. **空闲鸟用原生圆**：`ready`/`dead` 的鸟身由 19 段 `fillRect` span 改为一次
   `ctx.fillCircle`（opcode 6，单条 draw 消息），颜色/半径/位置不变；`run` 相仍走
   原 span 路径，**游戏画面与碰撞/计分语义完全不变**。

**手感论证**：`run` 相是游戏本体，保持 33 ms 物理步长与逐 tick 绘制，30 fps 手感与 r180
一致，拍翅、管道滚动、碰撞、HUD 全部原样。被降频的只有 `ready`/`dead` 这两个非游戏相：
它们的鸟身上下浮动纯属装饰，5 fps 仍可见动画（冻结成静止画面会像死机；全速则要付
~6840 draw/6s 的代价）。`dead` 相的鸟闪烁按 `floor(t*8)%2` 为 4 Hz，5 fps 采样仍可辨。
故 30/5 fps 是"游戏本体零损失 + 空闲画面仍活着 + 预算达标"的最小取舍。

点按仍即时重绘：`tap()` 里原有的 `painted=false; sync()` 保留，不被门控拦截，
`tests/flapdot.js` 新增断言覆盖（tap 后立刻得到全屏 invalidate）。

## 4. sprites 方案去留：删除（证据）

半成品的 `examples/flapdot/sprites.js`（16929 行，untracked）与
`scripts/gen_flapdot_sprites.py`（40 行）按任务要求先修复再决定：

- 生成器两处缺陷均已修复：行间 `'\n'.join(rows)` 缺尾逗号（改为每行 `','.join(...) + ','`）；
  非 f-string 尾段字面量 `}}` 多输出一个右花括号（改为 `}) },`）。重新生成后
  `node --check examples/flapdot/sprites.js` 通过。
- 但产物 **1,302,806 bytes**（1.27 MiB，四个纯色 tile；`skyTile` 一项即
  480×376 = 180,480 个 Uint16），相对当前 5,752-byte bundle 是数量级膨胀。
- 机制上 `retainImage`/`drawImage` 确实发 `spriteDefine`/`spriteDraw`
  （`prelude_runner.js:265-266`），不计入 `check.js:203` 的 `draw` 口径，**理论上**能省；
  但生成的 tile 并不覆盖 draw 的主要来源：没有鸟 sprite（19 span 仍在），地面 tile 只有
  底色不含 dash（约 20 条仍在），`pipeBody` 是整块 56×376 纯色，直接 blit 会填满管道缺口
  （几何错误）。要真正受益需重写渲染逻辑并新造鸟 sprite，远超"锦上添花"范围。
- 结论：**删除**两个文件；最终 app.js 不引用任何 `FLAP_SPRITES`，语义与 lint 均干净。
  最小方案（门控 + 静止脏矩形跳过 + 原生圆）已独立达标并留有余量。

## 5. 改前 vs 改后三采样点 draw 数

`artifacts/r180/visual-flapdot.json`（原始 app）：

| 采样点 | r180 基线 | 半成品（仅门控6） | 本轮最终 |
|---|---|---|---|
| 1（~1.3-1.8 s） | 2072 | 512 | **56** |
| 2（~3.3-3.4 s） | 3736 | 824 | **91** |
| 3（~6.2-6.5 s） | 6856 | 1344 | **141** |

最终三帧断言 `drawBudget / drawCalls / nonEmpty / simulator` 全部为 true；
原始 JSON 见 `artifacts/r185/flapdot-visual.json`。

## 6. 验证（原始输出见 `artifacts/r185/`）

```
# flapdot --visual（NODE_PATH=/home/ubuntu/.npm/_npx/705bc6b22212b352/node_modules）
$ node tools/lume/lume.js check examples/flapdot --visual
[PASS] bundle   5752 bytes (48 ms)
[SKIP] eval     --visual uses browser simulator
[SKIP] layout   requires emulator screenshot (--visual)
[SKIP] perf     profile disabled
[PASS] visual   3 frames: artifacts/check/flapdot/visual/visual.json
RESULT: PASS (5 steps, 0 failed; exit 0)
→ artifacts/r185/flapdot-visual.txt

# emu 链
$ node tools/lume/lume.js check examples/flapdot --timeout 180
[PASS] bundle   5752 bytes (171 ms)
[PASS] eval     2x "app eval ok; entering event loop"
[SKIP] layout   no layout expectations for flapdot
[SKIP] perf     profile disabled
screenshot: artifacts/check/flapdot/tft.png
RESULT: PASS (4 steps, 0 failed; exit 0)
→ artifacts/r185/flapdot-emu.txt

# flapdot host harness
$ node tests/flapdot.js
... PASS flapdot dirty-band discipline + canvas pixel budget (max inc 20680 px)
... PASS flapdot eight-tick frame skip clears full bird path; old union misses 43 vertical px; draw calls=57
... PASS flapdot 60 s smoke (draws=97893, paints=4951, phase=run, score=0)
... PASS flapdot r185 idle gate: 12 ticks -> 2 bird-only paints (draws=10), tap repaints full canvas immediately
ALL flapdot harness checks passed
→ artifacts/r185/flapdot-harness.txt

# 全量 harness
$ for t in tests/*.js; do node $t || echo "FAIL $t"; done
FAIL 行数 = 0；PASS 行数 = 1555
→ artifacts/r185/harness-all.txt

# CLI 单测
$ npm test --prefix tools/lume
1..52 / # tests 52 / # pass 51 / # fail 0 / # skipped 1 / # cancelled 0
→ artifacts/r185/npm-test.txt

# counter --visual 防回归
$ node tools/lume/lume.js check examples/counter --visual
[PASS] bundle   2160 bytes (21 ms)
[PASS] visual   3 frames: artifacts/check/counter/visual/visual.json
RESULT: PASS (5 steps, 0 failed; exit 0)
→ artifacts/r185/counter-visual.txt
```

### playground 级联与守卫重钉

- `npm run build:playground --prefix tools/lume` 重建：`PASS ... 70 apps`；
  二次构建 `git diff --stat` 完全一致（幂等）。变更生成物：
  `website/playground/apps/flapdot.js`、`website/playground/sources/flapdot.js`、
  `website/playground/sources.js`（bundle 5752 bytes）。manifest 仍 70，无注册变更。
- 全量 sweep 首轮 `tests/ota_consumers.js` 转红（r183 先例）。按"只重钉 allowlist、
  不改谓词"补钉：加入 r185 的 app/harness/playground/report 路径，以及基线 `670020e`
  fw-sync 产物 `website/wasm/fw/partition-table.bin`。补钉后该守卫全绿，断言逻辑未动。
- 三刀提交后按 r183 教训再跑一遍全量 sweep：仍 **0 FAIL / 1555 PASS**，
  无新增转红守卫；原始输出 `artifacts/r185/harness-all-post-commit.txt`。

## 7. 提交拆分

- feat：`examples/flapdot/app.js` + playground 生成物
- test：`tests/flapdot.js` + `tests/ota_consumers.js`（allowlist 重钉）
- docs：`docs/r185-report.md` + `artifacts/r185/`

## 8. Deferred

- 未连真机：显示方向、触摸手感、实际帧率、睡眠电流、音频、WiFi OTA 均 deferred，
  本轮所有结论只到宿主/模拟器层。
- 浏览器 visual 的采样点是 check.js 的 `[1,3,6]` 秒 + 截图开销（实测 ~1.3/3.3/6.2 s），
  与 r180 报告的 ~1.8/3.4/6.5 s 略有差异；两者都是自页面加载起的累计 draw 数，口径一致。
- `draw` 消息数是 UI 队列压力的代理指标，不等于真机 LVGL 刷新次数；浏览器 stub 与
  ESP32-S3 原生绘制路径不同。
- emu 链使用基线 fw-sync 已发布的固件镜像与预编译 esp32sim（均落在 gitignored 目录），
  本轮未改 firmware 源码、未跑 `idf.py build`。
- sprites retained-image 路径本轮最终删除；`runtime/` 的 `retainImage`/`drawImage` API
  未改动，仍可供其他 app 使用。
