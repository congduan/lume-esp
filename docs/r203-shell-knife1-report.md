# r203 报告：shell 组件圆屏适配刀一（Slider / Keyboard / ColorPicker compact）

## 0. 基线与边界

- 基线：`origin/main 6c04f95`（2026-11-26，r202 已并入）；worktree `/tmp/lume-r203-wt`，分支 `r203-shell-component-knife1`。
- 本轮授权面：`runtime/shell.js` 及对应 `runtime/types/lume.d.ts`。**未动** prelude、`firmware/`、`watchface`、r200–r202 已修的其余 34 个 app；仅点名改动 `controls_demo` / `wordle` / `color_demo`。
- 最高验收项：**三个组件默认行为逐字节等价**。所有新参数均为 opt-in，默认值保持旧行为。
- 先实证后改：`shell.js` L425–489（Slider）/ L299–377（Keyboard）/ L589–669（ColorPicker）与引用 app、harness 均已读；`c.fillCircle(cx,cy,r,color)` 原语在 `firmware/components/lume-engine/prelude/prelude.js:1173` 实证存在（opcode 6，整数半径），无需用 arc 逐行 fillRect 兜底。`c.text` 只支持 14px（`prelude.js:1185`），故 compact 不缩放字号。

## 1. 参数面（新增，全部可选）

| 组件 | 新参数 | 默认值 | 开启后的效果 |
|---|---|---|---|
| `shell.Slider` | `roundThumb?: boolean` | `false` | thumb 从 `fillRect` 方块改为 `fillCircle` 圆点；手势目标仍是整个 Canvas，热区不变 |
| `shell.Slider` | `knobDiameter?: number` | `36` | 直径 32..`min(height,64)`；实际半径 `floor(d/2)`（prelude 要求整数半径），故直径至少 32px |
| `shell.Keyboard` | `controlKeyRatio?: number` | `1` | 仅 BKSP / ENTER 宽度乘该比值（1..3）；字母键与 SPACE 不动。ratio 1 时逐字节等价 |
| `shell.Keyboard` | `keyHeight?: number` | `keySize` | 键高 40..128，与字母键宽解耦；root 高度随 `4*keyHeight + 3*gap + 2*pad` |
| `shell.ColorPicker` | `compact?: boolean` | `false` | 300x360 → 210x252（缩放系数 k=0.7），命中测试坐标除以 0.7；默认几何与点击锚点完全不动 |

实现要点：

- Slider 圆 thumb 分支放在 `onDraw` 前部；默认分支保留原 4 行 `fillRect` 字面代码，未做等价重写。
- Keyboard 用 `controlWidth(label, keyWidth)` 按 label 判定 BKSP/ENTER，所有既有 call site 字面量不变，`keyboard_states.js` / `keyboard_demo.js` 的精确字符串断言零改动。`Math.round(keySize * 1) === keySize`，默认宽度严格相等。
- ColorPicker 用 `scaledPickerContext(c,k)` 包装 Canvas 上下文（只缩放坐标/半径，`fillColor`/`clear` 直接代理），并在 `hit()` 里把指针坐标除以 `scale`。`k=1` 时完全绕过包装器，r166 的命中与绘制源码逐字保留。

App 切换：

- `controls_demo`：Slider 加 `roundThumb: true`（36px 圆 thumb，48px 轨道内留 6px 边距）。
- `wordle`：Keyboard 加 `controlKeyRatio: 1.8`（BKSP/ENTER 40→72px），`keySize:40, gap:0, x:40, y:240` 锚点字符串保持；底行 `x=88..392, y=364..404`，满足 [75,405] 判据。
- `color_demo`：`compact:true` + `(135,104)`，标题/HEX/色块/状态字全部收入 `[75,405]`；`timer_kit` 的 app 层圆 thumb 保持不动。

## 2. 默认行为零变化证据

1. **Slider**：`tests/shell_slider.js` 把 pre-r203 的原生 draw 流固化为 golden，逐字节 `deepEqual`：

```
[["draw",1,0,0,0,0,0,0,1],["draw",1,1,0,22,320,4,1848393,1],
 ["draw",1,1,0,22,172,4,4249776,1],["draw",1,1,148,12,24,24,15923195,1]]
```

   并含变异证明（把 `kx` 加 1 后 golden 必须失败）。roundThumb 开启时第 4 条为 opcode 6、半径 18、`(160,24)`。

2. **Keyboard**：`tests/shell_keyboard.js` 的 golden fixture `tests/fixtures/shell_keyboard_default.json` 直接从 `git show origin/main:runtime/shell.js` 生成，默认 Keyboard 的 **249 条原生消息全量** `deepEqual`。变异证明：把 ratio 乘法的 `+ 1` 注入后 golden 必须失败。

3. **ColorPicker**：`tests/colorpicker.js` 全部原样通过——`(330,135)/(240,225)/(120,256)/(120,306)` 点击锚点、`(150,110)` 圆环 draw、24 段 arc、6 处精确字符串变异证明均未改动。compact 只新增 `tests/color_demo.js` 的 3 个点击坐标机械级联（0.7 倍换算）与一条 210x252 画布断言。

4. **全量回归**（`artifacts/r203/regression-before.log` 与 `regression-and-tests.log`）：

```
=== FULL HARNESS REGRESSION ===
done
```

   命令：`timeout 600 bash -c 'for t in tests/*.js; do node "$t" >/dev/null 2>&1 || echo FAIL "$t"; done; echo done'` → 0 FAIL（改前、改后各一次）。

## 3. 视觉自检闭环（466×466 圆屏，Playwright）

复用 `/tmp/r202-shot.mjs` 改路径为 `/tmp/r203-shot.mjs`，全部截图在 `artifacts/r203/`：

| app | before | after（第 1 轮） | after（第 2 轮） | 自检结论 |
|---|---|---|---|---|
| `controls_demo` | [png](../artifacts/r203/controls_demo-before.png) | [png](../artifacts/r203/controls_demo-after.png) | [png](../artifacts/r203/controls_demo-after-round2.png) | 白色方块 thumb → 36px 圆形 thumb；全部控件仍在圆内，无裁切 |
| `wordle` | [png](../artifacts/r203/wordle-before.png) | [png](../artifacts/r203/wordle-after.png) | [png](../artifacts/r203/wordle-after-round2.png) | 首轮观察到 BKSP/ENTER 截成 "BKS"/"ENTE"；ratio 1.8 后标签完整，底行在圆内 |
| `color_demo` | [png](../artifacts/r203/color_demo-before.png) | — | [png](../artifacts/r203/color_demo-after-round2.png) | before 标题顶切、圆形色块/状态字底切；compact 后全部收进圆内 |

第 1 轮发现 `wordle` 控制键文字紧凑，修复后复拍 PASS；`color_demo` 以 r202 记录的裁切态作 before，compact 实施后复拍 PASS。闭环完成。所有截图由 `shots-before.log` / `shots-after-round1.log` / `shots-after-round2.log` 记录，均为 `PASS <app>-<phase>.png`（0 WARN）。

## 4. 验证原始输出

`artifacts/r203/` 内完整日志：`regression-before.log`、`regression-and-tests.log`、`lume-checks.log`、`tooling-and-docs.log`、`shots-*.log`。

```
=== npm test --prefix tools/lume ===
1..57
# tests 57
# suites 0
# pass 57
# fail 0
```

```
=== lume check examples/<app> --no-emu ===
[PASS] bundle   30022 bytes (25 ms)     # controls_demo
RESULT: PASS (4 steps, 0 failed; exit 0)
[PASS] bundle   38775 bytes (30 ms)     # wordle
RESULT: PASS (4 steps, 0 failed; exit 0)
[PASS] bundle   29469 bytes (25 ms)     # color_demo
RESULT: PASS (4 steps, 0 failed; exit 0)
[PASS] bundle    2160 bytes (17 ms)     # counter (哨兵)
RESULT: PASS (4 steps, 0 failed; exit 0)
```

```
=== playground build idempotency ===
IDEMPOTENT: git status identical after second build
=== playground verify (NODE_PATH=/home/ubuntu/.npm/_npx/705bc6b22212b352/node_modules) ===
PASS all examples load without runtime errors        # FAIL 计数 0
=== check_website.py ===
examples.html gallery up to date (73 cards)
API: 162 catalog entries, 162 type declarations, 34 function namespaces
API missing: none / invented: none / duplicates: none / signatures not found: none
=== gen_api_docs.py --check ===
api.html is up to date with lume.d.ts (162 entries)
=== ASCII discipline ===
ASCII_LINE_COUNT=0
```

`python3 scripts/gen_api_docs.py` 重生成后无差异：新参数都落在 `interface XxxProps` 内，函数签名（`function Slider(props?: SliderProps)` 等）未变，故 `api.html` 无需改行；`--check` 通过。`docs/hardware-api.md` 的 ColorPicker 段已补 `compact` 说明；该文件未记载 Slider/Keyboard 参数面，故仅留 `runtime/types/lume.d.ts` 作为契约源。

## 5. ColorPicker compact 可行性结论：<120 行 diff，已实施

按简报判据评估并实测：

- 改动面：context wrapper + 参数校验 + 3 处改造，`shell.js` compact 专用新增约 30 行；`examples/` + `runtime/` 三组件合计新增 105 行（含 Slider/Keyboard 全部改动），低于 120 行阈值。
- harness 锚点：`tests/colorpicker.js` 的 10 个默认模式点击点、圆环 draw 断言与 6 个精确字符串变异证明 **零改动**（k=1 绕过包装器）；仅 `tests/color_demo.js` 的 3 个坐标按 0.7 倍机械级联，语义不变。
- 风险与规避：字号不可缩放 → 保持 14px，compact 下 "CLOSE"/"SAVE"/"COLOR" 实测无截断；命中测试与绘制共用同一坐标系（缩放/反缩放），截图确认 ring/strip/button 对齐。
- 结论：可行且已实施；无需退化为纯设计文档产出。

## 6. 未做 /  deferred

- 真机验收（显示/触控手感/睡眠电流/无线）不在本轮范围：green build + green host harness ≠ 硬件可用。
- prelude 的 `Text` 继承 `theme.radius` 根因未动（另立 prelude 刀）；`shell.Launcher` 圆屏升级仍列 r200 遗留。
- `web set` / 固件构建未触发（本轮无 `firmware/` 改动）。
- 不 push；commit 按 feat / test / docs 拆分。
