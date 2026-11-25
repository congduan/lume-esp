# r105 — Flapdot 收口轮报告（r102 半成品修复 + playground/docs 补齐）

日期：2026-11-18。基线 `33386c5`（r104-safearea）。分支 `r105-flapdot-fix`，
worktree `/tmp/lume-r105-wt`。实施：主控接管（上轮引擎派发即遇上游 429 限流
零产出，按纪律不切模型，主控接手收口；本轮**零固件改动、零 `runtime/types`
改动，未跑 idf.py build**）。

## 半成品来源与修复内容

r102 轮中断遗留 `examples/flapdot/app.js` + `tests/flapdot.js`（未跟踪文件）。
本轮在保持原有世界模型（hash 确定性柱对 + 难度渐窄缺口 + NVS hiscore +
脏区纪律）的前提下修复两处实锤 bug：

1. **顶部柱碰撞矩形高度参数错位**（app.js `flapDead`）：原写法第 4 参传
   `g.top + 400`，顶部柱矩形 y 范围变成 `[top-400, 2*top]`，缺口上半段被
   误判致死。修正为高度 `400`（矩形 `[top-400, top]`），与底部柱
   `(g.bottom, 400)` 写法对齐。
2. **harness 碰撞用例滚动量用错**（tests/flapdot.js 用例 4）：原用
   `s = PIPE0`，柱 0 在屏幕左缘不与鸟列重叠，整组碰撞断言空转。修正为
   `s = PIPE0 - BIRD_X + PIPE_W/2 = 388`，实测 `pipeX(0,388) = 92`，
   覆盖鸟列 `BIRD_X = 120`。修正后 4 组碰撞用例（gap 中心存活 / 顶柱 /
   底柱 / 缺口边缘致死）全部真实命中。

顺手加固（实证后修正）：

- `pipeBand` 返回前对画布矩形做 `clipRect`（入场柱 x2 越过 FW 时 prelude
  会拒绝越界脏区矩形），并补注释。
- 用例 5 终端速度：改为从天花板自由落体并记录 `maxVy`（原写法中途触地，
  断言不可达）。
- 用例 6/11：先按 held-centre 策略过 1/5 根柱再自由落体（原先死于 score 0，
  与「score 须 > 0」断言矛盾）；用例 7 的 flap 门限放宽（`vy > -150`），
  窄缺口仍可完成，策略实测清 135 根柱。
- 用例 10：稳态窗口选取改为无相位变化的 8 tick 窗口（ready→run 相变本就
  允许全屏重绘，原断言口径错）。

## 验证（原始输出摘录）

```
node tests/flapdot.js
PASS flapdot UI strings are ASCII-only (r64 font rule)
PASS flapdot pipe geometry deterministic, gaps sane, ramp stepwise
PASS flapdot pipe window covers exactly the visible pipes
PASS flapdot scoring gate at pipe right edge
PASS flapdot collision: pipes/ground kill, gap passes, top clamps
PASS flapdot physics: gravity/flap/terminal, no NaN
PASS flapdot state machine ready/run/dead/restart
PASS flapdot course winnable: scripted policy cleared 135 pipes
PASS flapdot boots in ready mode with HUD and full first paint
PASS flapdot tap -> run through the gesture pipeline
PASS flapdot dirty-band discipline + canvas pixel budget (max inc 20680 px)
PASS flapdot death + restart through the real prelude
PASS flapdot 60 s smoke (draws=114918, paints=5648, phase=run, score=0)
ALL flapdot harness checks passed

全量回归: tests/*.js 59 文件 0 FAIL
npm test --prefix tools/lume: # tests 44 / # pass 43 / # fail 0 / # skipped 1
lume check examples/flapdot --no-emu  -> RESULT: PASS (4 steps, 0 failed)
lume check examples/counter  --no-emu -> RESULT: PASS (4 steps, 0 failed)  [哨兵]

node tools/playground/build.mjs
PASS bundle flapdot 5523 bytes
PASS esbuild-wasm assets and 42 editable sources
PASS prelude 67016 bytes; 42 apps

tools/simulator/verify.js（Playwright）
PASS renderer create/attr/remove/animate/canvas
PASS counter / files / device_monitor / shell_demo（含 edge-swipe 注入）全绿

flapdot 浏览器实跑（tools/simulator/sim.js + Playwright）
canvases=1; text="FLAPDOT\nSCORE 0\nBEST -\nTAP TO FLAP"
点击启动后 HUD 持续刷新；截图
artifacts/simulator/flapdot_ready.png / flapdot_run.png
vision 自查：HUD/黄鸟（眼+喙）/棕色虚线地面渲染干净，无伪影；
天空中暂无柱子为预期（柱 0 在 s>480 后入场，截图时仅滚 ~120 px）。
```

Canvas 预算断言已内建于 harness 用例 10/12：单 canvas 480x400 = 192,000 px
< 230,400 px 全预算；稳态增量最大 20,680 px。

## 诚实口径

- 调度轮验收 = 编译/宿主 harness/浏览器仿真绿；真机触摸手感、帧率、
  NVS 持久化、功耗均 deferred to board bring-up，未声称硬件验证。
- 纯 app 层轮未跑 `idf.py build/size`（无任何 C 侧改动；prelude 未变，
  `lume check` 的 bundle 步与 playground 重生成均从同一 prelude 源取）。
- harness 的 `runApp` 走真 prelude 的手势与绘制管线，但触摸事件为 harness
  注入，非真机 CST9220 路径。
