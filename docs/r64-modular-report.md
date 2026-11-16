# r64 Modular 表盘：停止点

基线 `origin/main`：`35f24cea9edf12608bed569eef25722d82a6c283`；工作分支 `r64-modular`。2026-11-16 已执行 `git fetch origin`。未修改固件或主仓。

## 实证与冲突

现有 `examples/watchface/app.js` 有四面，Canvas 尺寸分别为 12×12、300×300、300×300、220×220，总计 **228,544** 像素；prelude 的 Canvas 总预算为 480×480 = **230,400** 像素，只剩 **1,856** 像素。原拟第五面使用 416×132 Canvas 作为时钟背景，四个 complication 使用 View/Text 声明式节点。运行真实 prelude 的 host harness 时，第五面 Canvas 创建立即失败：

```text
$ node tests/watchface.js
lume_prelude.js:941
  if (__canvasBytes + w*h*2 > SW*SH*2) throw new Error('lume: canvas PSRAM budget exceeded');
                                       ^
Error: lume: canvas PSRAM budget exceeded
    at Canvas (lume_prelude.js:941:46)
    at app.js:160:1
```

这是任务简报规定的“2×2 网格用声明式组件时与表盘 canvas 背景混合有技术冲突”停止条件。试作改动已撤回，`examples/watchface/app.js` 保持基线；没有提交未能运行的第五面。

API 核对：`lume.power` 只有睡眠/唤醒；r63 的电量路径为 `lume.pmic.battPercent()`，与 `runtime/types/lume.d.ts` 一致。天气请求拟用 `lume.net.httpRequest`，但因 Canvas 预算冲突停止，尚未运行 emu 验证其降级行为。

## 待决策

可选实现方向：将时钟背景改为原生 View，仅保留一个不超过 1,856 像素的小型装饰 Canvas（继续展示 Canvas + 声明式组件混合）；或调整既有四面的 Canvas 资源分配。需主控选定后再继续第五面、截图、harness 与完整验收。

已执行的非验收检查原始输出：

```text
$ node tools/lume/lume.js check examples/watchface --no-emu
lume check examples/watchface

[PASS] bundle   8742 bytes (21 ms)
[SKIP] eval     --no-emu
[SKIP] layout   requires emulator screenshot (--no-emu)
[SKIP] perf     profile disabled

RESULT: PASS (4 steps, 0 failed; exit 0)
```

此 `--no-emu` 结果仅证明试作代码能打包，不能证明运行可用；运行失败证据以上述 host harness 为准。完整 `lume check`、emu 截图、天气降级日志及全量 harness 均未执行。
