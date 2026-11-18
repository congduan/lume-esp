# r103：plasma 软边与 fishtank 小鱼站点

基线 `b2e7cb7`，分支 `r103-gooey-fish`。只修改两个 app、各自 harness、playground 生成产物及本报告。未修改固件或运行时，也未做真机验收。

## Plasma

现有 5 团（不是简报估计的 6 团）保持 50 ms tick。每团主椭圆与偏移轮廓分别用同轴的外缘、中层、主体三层实心椭圆；亮核另画一层。偏移轮廓先画，主体后画，避免偏移轮廓的暗边切过主体。外缘、中层在启动时分别按背景到主体颜色的 56%、78% 插值预计算，帧内只查 48 色环。三套主题沿用原来的主体与亮核锚点，代表色如下：

| 主题 | 亮核 | 主体 | 中层 | 外缘 |
|---|---|---|---|---|
| LAVA | `#DC4967` | `#8D2444` | `#721E3B` | `#561731` |
| AURORA | `#36A8CE` | `#195B88` | `#154C72` | `#113C5D` |
| SUNSET | `#EE8EAB` | `#9F4377` | `#813767` | `#642A58` |

背景原来的两层暗色大圆盘改成四层同心、低对比度环境光。第 5 团中心从 `(171,119)` 移到 `(211,163)`，并调整振幅与相位，使小团进入主团区域。相交补色仍按中心距触发，最多四处。

**调用预算**：背景 1 + 环境 4 + 5 团 ×（主体 3 + 偏移 3 + 亮核 1）= 35 + 相交补色最多 4 + 涟漪 1 + 标题 2 = **47 次/帧**，低于 60。harness 正常峰值 46，强制全团重叠并有涟漪为 47；另断言三层同轴椭圆的圆心、半径顺序和颜色顺序。

## Fishtank

读码确认原版已经固定 6 站。现按体型用大鱼（`>=1.1`）6 站、中鱼 5 站、小鱼 6 站。小鱼轮廓收窄头端和尾端，在轴向 `-0.70` 加入基础半径 `1.8×1.8` 的尾柄站，再乘体型倍率。大鱼背线加三个 1 px 高光。`tankStep` 运动代码未变。

**调用预算**：12 背景色带 + 3 光斑 + 3 沙层 + 15 水草 + 10 气泡 = 43；两条大鱼 ×19 + 两条中鱼 ×13 + 两条小鱼 ×14 = 92，总计无食物时 **135 次/帧**。食物最多 20 粒，总上界 **155 次/帧**，低于断言 250。harness 实测普通帧峰值 135。

## 截图视觉验收

宿主模拟器截图（480×480，均保存在 `artifacts/r103/`）：

| 画面 | 截图 | 观察 |
|---|---|---|
| 熔岩 | [plasma-lava.png](../artifacts/r103/plasma-lava.png) | 背景大圆盘的外沿淡入背景；团块边缘有逐级暗化，偏移轮廓与主体相接。 |
| 极光 | [plasma-aurora.png](../artifacts/r103/plasma-aurora.png) | 薄荷绿团与中央色群交叠，没有单独悬浮的小贴片。 |
| 落日 | [plasma-sunset.png](../artifacts/r103/plasma-sunset.png) | 三主题配色与软边结构一致。 |
| 鱼缸 1 | [fishtank-1.png](../artifacts/r103/fishtank-1.png) | 小鱼有从躯干到窄尾柄的过渡，尾鳍仍可辨。 |
| 鱼缸 2 | [fishtank-2.png](../artifacts/r103/fishtank-2.png) | 转向后的大小鱼形态连续；没有发现孤立的大圆头小鱼。 |

这仍是 RGB565 实心椭圆近似：截图中能看到离散色带和 Z 序遮挡，不能等同于 alpha 或像素级连续渐变。视觉上比 r98 的单片硬边更柔和，但真正的熔融合并未由渲染器实现。鱼的尺度较小，板上显示效果仍待验收。

## 宿主验证

原始日志：`artifacts/r103/harness.log`、`lume-check.log`、`all-tests.log`、`playground-build.log`、`screenshots.log`。关键原始输出：

```text
PASS concentric three-ring ellipses; real prelude <=60 calls/frame (normal max 46; overlap+ripple 47), no-IMU fallback, gesture
ALL PLASMA HARNESS CASES PASSED
PASS 60 s smoke: six fish bounded, finite, continuous, capped turn; eaten=40
PASS food pursuit changes heading and position
PASS eating removes pellet and accelerates swimming/tail
PASS size tiers 6/5/6 stations; prelude integration: tap feeding, no errors, max draw calls/frame=135 (limit 250)
ALL FISHTANK HARNESS CASES PASSED
```

```text
lume check examples/plasma
[PASS] bundle   5569 bytes (59 ms)
[SKIP] eval     --no-emu
[SKIP] layout   requires emulator screenshot (--no-emu)
[SKIP] perf     profile disabled
RESULT: PASS (4 steps, 0 failed; exit 0)
lume check examples/fishtank
[PASS] bundle   5740 bytes (74 ms)
[SKIP] eval     --no-emu
[SKIP] layout   requires emulator screenshot (--no-emu)
[SKIP] perf     profile disabled
RESULT: PASS (4 steps, 0 failed; exit 0)
```

playground 重新生成，输出：`PASS esbuild-wasm assets and 41 editable sources`、`PASS prelude 67016 bytes; 41 apps`。全量 `for t in tests/*.js; do node "$t" || exit 1; done` 退出码 0，日志 563 行，无 `FAIL`；完整输出见日志。以上均为宿主验证，没有板上视觉、性能或功耗结论。
