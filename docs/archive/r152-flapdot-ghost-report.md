# r152 flapdot 振翅鬼影修复报告

基线 `835fdb1`，分支 `r152-flapdot-ghost`。验证范围是 host harness、CLI 主机端和浏览器 Playground；未做设备验收。

## 根因与改动

2026-11-21 的线上 Playground 用户截图显示：鸟振翅上升后，上方有约 8 个渐小渐淡、纵向排列的黄色鬼影（截图 y≈550–765），管道没有同类残影。渲染层原来用 `prevY/prevS` 同时表达“上一个 tick”和“上一次绘制”。`tick()` 在每次逻辑推进后写入它们，`onDraw` 又写入一次；浏览器绘制晚于多个 33 ms tick 时，鸟的旧像素没有被完整清除。

| 状态 | 旧实现 | r152 |
| --- | --- | --- |
| 鸟的历史位置 | `prevY` 在 tick 和 draw 后都更新；脏矩形取当前鸟与 `prevY` 鸟盒的并集 | `prevDrawnY` 只在绘制完成后更新；矩形覆盖从上次画出的 y 到当前 y 的纵向路径，并裁剪到画布 |
| 管道历史滚动 | `prevS` 同时由 tick 和 draw 更新 | `prevDrawnS` 只在绘制完成后更新；新旧 `pipeBand` 仍取并集 |
| 首帧和相位切换全屏画 | 首帧提前返回，没有记录新基准 | 全屏画完即记录 `prevDrawnY/S` |

鸟路径用 `min/max(prevDrawnY, state.y) ± (BIRD_R + 8)` 构造，水平方向含鸟的完整宽度，再与当前 `birdBox` 取并集。帧跳大时脏矩形可以很高，这是擦除之前画出的鸟像素所需的范围。物理函数 `flapStep` 未改。

## 帧跳回归

`tests/flapdot.js` 的新用例保存上次绘制位置，屏蔽绘制同步，连续执行 8 个 `tick()`，再恢复并触发一次绘制。断言 tick 期间 `prevDrawnY/S` 不变、没有画图消息，最后的 invalidate 包含从旧鸟位置到新鸟位置的完整路径。对照断言计算旧式单 tick 鸟盒并集与完整路径的差集非空；该场景少覆盖 **43 像素** 的纵向范围。实际旧代码在 tick 后把 `prevY` 直接写成当前 y，因此覆盖还会更少。该帧发出 57 次 canvas draw 调用，低于新增的 250 次上限。

## 验证记录

- `node tests/flapdot.js`：全部既有及新增断言通过。原始输出：`artifacts/r152/flapdot-harness.txt`。
- `node tools/lume/lume.js check examples/flapdot --no-emu`：`RESULT: PASS (4 steps, 0 failed; exit 0)`，其中 eval/layout 因 `--no-emu` 跳过。原始输出：`artifacts/r152/lume-check-no-emu.txt`。
- `node tools/playground/build.mjs`：`PASS bundle flapdot 5601 bytes`，55 个 editable sources 生成；修改产物为 `apps/flapdot.js`、`sources/flapdot.js`、`sources.js`。原始输出：`artifacts/r152/playground-build.txt`。
- `for t in tests/*.js`：87 个脚本均已执行，其中 86 个通过，`tests/ota_consumers.js` 的旧文件白名单断言失败。首轮执行到第 26 项后进程收到退出码 143；按 27–45、46–65、66–87 三批继续，退出码分别为 0、1、0。完整原始输出：`artifacts/r152/host-regression.txt`。该守卫以 `d49fb81` 为基线，r152 的 `examples/flapdot/app.js`、`tests/flapdot.js`、`website/playground/apps/flapdot.js`、`website/playground/sources/flapdot.js` 不在其 `ALLOWED` 内；这些正是本轮获准修改的文件。按本轮红线未改 `tests/ota_consumers.js`，因此不能报告全量无 FAIL。

### 核心命令原始输出

```text
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
PASS flapdot eight-tick frame skip clears full bird path; old union misses 43 vertical px; draw calls=57
PASS flapdot death + restart through the real prelude
PASS flapdot 60 s smoke (draws=114918, paints=5648, phase=run, score=0)
ALL flapdot harness checks passed
```

```text
lume check examples/flapdot

[PASS] bundle   5601 bytes (61 ms)
[SKIP] eval     --no-emu
[SKIP] layout   requires emulator screenshot (--no-emu)
[SKIP] perf     profile disabled

RESULT: PASS (4 steps, 0 failed; exit 0)
```

## 浏览器复现

Playwright Chromium 打开生产站 `https://congduan.github.io/lume-esp/playground/`，将 `apps/flapdot.js` 的网络请求替换为本次本地生成的修复后 bundle，然后选择 flapdot、点击开始、连续点击保持飞行，在高速上升期间连拍两帧。截图：`artifacts/r152/flapdot-fixed-frame-1.png`、`artifacts/r152/flapdot-fixed-frame-2.png`。浏览器像素检查在鸟的 x=106–134、地面上方 y<376 的区域分别只发现一个连续黄色区间（画布 y=49–65 和 y=3–19）；没有用户截图中的纵向黄色鬼影串。原始浏览器输出：`artifacts/r152/playwright-production-page.txt`。这验证的是生产站页面与修复后 bundle 的组合，尚未宣称线上已部署该 bundle。

修复后连拍截图：

![flapdot 修复后上升帧 1](../artifacts/r152/flapdot-fixed-frame-1.png)

![flapdot 修复后上升帧 2](../artifacts/r152/flapdot-fixed-frame-2.png)
