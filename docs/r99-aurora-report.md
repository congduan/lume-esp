# r99 极光蒙版时钟实施报告

基线：`origin/main` 在开工前 `git fetch origin` 后为 `18feda02661c5bf990d5256e5d5dd2bf3196ae59`；工作分支 `r99-aurora` 同一 HEAD。未改 firmware、runtime、tools/lume 或 tests/lib。`r98-plasma` 分支可供估算口径对照，但不在本轮 origin/main 基线内。

## 构成与配色

`examples/aurora_clock/app.js` 使用单一 480×480 RGB565 Canvas、50 ms tick。三条带子各由六枚横向重叠椭圆组成（`rx=113..157`、`ry=33..58`），每条另加两枚预计算重叠色补丁。低对比底层上叠一枚预生成的径向渐层精灵，避免纯色椭圆拼接的硬边；中央深色椭圆保留数字对比度。日期与语义时间使用 `Text`，数字的 76px 视觉字形则是分钟变化时才更新的 RGB565 保留精灵，绕开设备字体最大约 32px 的限制。常态帧为背景 1 + 光带椭圆 18 + 补丁 6 + 光晕精灵 3 + 深色蒙版 1 + 时间精灵 1 = **30 draw calls**；三圈触摸涟漪使上限为 **33**，低于 35。两枚保留精灵总共 141,248 字节，小于每画布 460,800 字节的精灵槽预算。

每主题四组锚色，每组按暗层、主体、补丁、亮核排列；启动时按相邻锚色做八级 RGB 插值，共 32×4 色/主题。逐帧只查表，不计算 HSV 或 RGB 混色。

| 主题 | 暗层代表 | 主体代表 | 补丁代表 | 亮核代表 |
|---|---|---|---|---|
| 青绿 | `#0A2431` | `#18495A` | `#347F81` | `#70BBAE` |
| 紫 | `#211B37` | `#48355D` | `#785C92` | `#B49AC2` |
| 蓝绿 | `#0A2936` | `#1B5269` | `#438D94` | `#84BEBD` |

IMU 以 m/s² 的 `ax/ay` 经低通滤波控制整体偏移与倾斜；无传感器或读取失败时自然回到水平漂移。静置 1200 tick（约 60 秒）后相位步进从 `0.02` 降为 `0.006`，即 0.3 倍；触摸或大幅加速度变化唤醒。触摸还循环切换三套主题。

## 视觉验收

模拟器固定时刻截图（源 app 仅在临时副本中注入时刻与主题；提交的 app 仍使用设备时钟）：

- [06:28 青绿](../artifacts/r99/aurora-dawn.png)
- [18:42 紫](../artifacts/r99/aurora-dusk.png)
- [23:17 蓝绿](../artifacts/r99/aurora-night.png)

检查结果：光带中央有连续柔和光晕，三套主题明显区分，日期和 HH:MM 清晰可读。模拟器未实现 `Text.fontSize`，因此实际可见的大字由同一时间状态驱动的保留精灵绘制。

## 功耗估算与真机待测

同 r98 plasma 的全屏重绘口径：每帧 `480×480×2 = 460,800` 字节，20 fps 为 **9.216 MB/s** 最低像素写入量；r98 plasma 也是 20 fps、9.216 MB/s，正常宿主峰值 24 draw calls、上限 25。本轮 30/33 draw calls 增加了 Canvas 图元与精灵重放，不能由写入量推导 CPU 电流。低速模式只减小位移速度，仍维持 20 fps 与同等全屏刷新流量；真机省电幅度未证实。与 30 fps 全屏 13.824 MB/s 相比，20 fps 少 4.608 MB/s（33.3%）像素写入量；这不是实测电流。

真机需调：CO5300 上 RGB565 渐层/椭圆 AA 的台阶感、圆屏裁切、中心字形粗细与烧屏策略、IMU 实际轴向/阈值、触摸唤醒延迟、20 fps 帧时间和 PMIC 电流。所有这些均未做板上验收。

## 验证原始输出

`artifacts/r99/` 保存全部原始日志。新 harness：

```text
PASS centers, 20 Hz speed cap, 60 s idle drift x0.3 and wake
PASS palette lookup interpolates only precomputed colors
PASS clock text changes on minute boundary only
PASS prelude/no IMU, per-frame draw calls max=30, ripple <=35
ALL AURORA CLOCK CASES PASSED
```

`node tools/lume/lume.js check examples/aurora_clock --no-emu`：

```text
lume check examples/aurora_clock

[PASS] bundle   4937 bytes (21 ms)
[SKIP] eval     --no-emu
[SKIP] layout   requires emulator screenshot (--no-emu)
[SKIP] perf     profile disabled

RESULT: PASS (4 steps, 0 failed; exit 0)
```

`for t in tests/*.js; do node "$t" || exit 1; done`：55 个 harness，退出码 0，完整逐项输出见 `artifacts/r99/host-regression.log`。`npm test --prefix tools/lume`：44 tests、43 pass、0 fail、1 skip；原始 TAP 见 `artifacts/r99/cli-unit.log`。`lume check examples/counter --no-emu`：退出码 0，原始输出见 `artifacts/r99/counter-check.log`。Playground 重生成输出：39 apps，比基线 38 +1，见 `artifacts/r99/playground-build.log`。以上为宿主/模拟器验证，不代表真机通过。
