# r98 等离子屏保实施报告

## 实现

- `examples/plasma/app.js`：5 个大团（主椭圆半径 74–125 px）沿不同频率、相位的 Lissajous 轨迹漂移。同色偏移椭圆形成不规则轮廓，较亮内核形成熔岩灯的深浅层次。中心和偏移轮廓均限制在 480×480 画布内。
- 50 ms 定时器，即 20 fps；每帧全屏 RGB565 重绘。绘制上限为背景 1、环境椭圆 2、团块 15、相交补色至多 4、涟漪 1、文字 2，共 **25 次**；正常动画宿主实测最高 24 次，强制全团重叠且存在涟漪时为 25 次。
- IMU `ax/ay`（m/s²）映射为缓动重力偏置，最大横向偏置 24 px。无 IMU 时保持向下 6 px 偏置。大幅倾角变化或触摸唤醒；静置 1200 tick（60 秒）后，轨迹相位速度变成 0.3 倍，颜色索引推进变成 0.5 倍。触摸切换主题，并显示三帧扩散亮环。

## 主题色表

每套主题有 12 个手工挑选的 `body` 和 `core` 色环锚点；启动时一次性对相邻锚点做四级 RGB 插值，得到 48 色查找表。每团使用不同的固定色相偏移，每 5 个颜色 tick 移到下一个预计算颜色。下表给出背景、色环代表色和全部混合色；完整 12 色锚点在 `examples/plasma/app.js` 的 `PL_THEMES`。运行中只做索引查表，不计算 HSV 或实时 RGB 混色。

| 主题 | 背景 | 主体代表色 | 亮核代表色 | 重叠补色表 |
|---|---|---|---|---|
| 熔岩 LAVA | `#100719` | `#8D2444` `#D44A32` `#91294C` | `#DC4967` `#FF9540` `#DD506D` | `#FFBA68` `#FFE080` `#FF947A` `#FFCA75` |
| 极光 AURORA | `#061526` | `#195B88` `#219475` `#355D95` | `#36A8CE` `#89F0B6` `#76AEDB` | `#B7F4DC` `#B8DDF9` `#9DEBEE` `#C7C9F3` |
| 落日 SUNSET | `#180B30` | `#9F4377` `#E27862` `#A0447C` | `#EE8EAB` `#FFE29A` `#E98DB6` | `#FFE5B3` `#FFD4C2` `#FFB8CE` `#FFF0BD` |

完整色环锚点（顺序即流转顺序）：

```text
LAVA body  #8D2444 #A42943 #BC3040 #CC3B3A #D44A32 #DB5730 #D96332 #CC623A #BE4D44 #AC3C4C #9B3051 #91294C
LAVA core  #DC4967 #E85860 #F16C55 #FA7D47 #FF9540 #FFAE49 #FFC361 #FFAE56 #FA8C51 #F3735D #E86168 #DD506D
AURORA body  #195B88 #176E8B #147D83 #168B78 #219475 #309B79 #3D9A92 #488EAA #527FBC #5970AE #51649E #355D95
AURORA core  #36A8CE #3DBFCA #4ED9BE #61E8AE #89F0B6 #A3EDCD #A2E2E9 #94C9F3 #A7B5F2 #B9A5E5 #A4AAE0 #76AEDB
SUNSET body  #9F4377 #B44979 #C85872 #D96569 #E27862 #E98A5C #E69265 #DC7B76 #CE6985 #BB5B8E #AA4E89 #A0447C
SUNSET core  #EE8EAB #F5A5AC #FFC09A #FFD389 #FFE29A #FFE5A4 #FFD4A8 #FFC1B4 #F7B2C6 #EFA2CB #EB95C4 #E98DB6
```

RGB565 Canvas 没有 alpha。绘制顺序为深色背景、两层暗色环境光、团块主体与亮核、相交处亮色小椭圆。只有中心距离进入阈值才画补色，最多 4 个；补色椭圆沿两团中心连线的主轴伸展。偏移轮廓与亮核减轻纯色圆片感；补色是融合的视觉近似，不是像素级透明混合。

## 功耗与真机待测

一帧 480×480×2 = **460,800 字节**。按一次全屏写入估算，20 fps 为 **9.216 MB/s**，30 fps 为 **13.824 MB/s**，20 fps 少 **4.608 MB/s（33.3%）**。这是最低像素写入量估算，不含椭圆重绘、显示总线开销、CPU/PMIC 固定功耗；不能据此推算实际 mA 或宣称已实现真机最低功耗。低速模式仍以 20 fps 重绘，主要改变运动与色彩变化速度。

真机需测：IMU 轴向及增益、圆屏裁切与 AA 边缘在 RGB565 上的观感、20 fps 动画流畅度和实际电流、长时间静态文字的烧屏风险、触摸坐标与涟漪延迟。本轮只有宿主/模拟器验证，未做板上验收。

## 验证

原始输出：`artifacts/r98/plasma-test.log`、`lume-check.log`、`playground-build.log`、`playground-verify.log`、`all-tests.log`、`simulator-shots.log`。三张模拟器截图：`lava.png`、`aurora.png`、`sunset.png`。playground 生成 38 个可编辑示例，加单独注册的 `svg_icon`，共加载 39 个 app bundle；应用选择列表展示其中 38 个。

```text
PASS motion bounds 6000 ticks, speed 2.55 -> 0.15 px/tick
PASS palette lookup, IMU direction/fallback, idle wake and ripple expiry
PASS real prelude: <=25 calls/frame (normal max 24; overlap+ripple 25), no-IMU fallback, gesture
ALL PLASMA HARNESS CASES PASSED
```

```text
lume check examples/plasma

[PASS] bundle   5037 bytes (35 ms)
[SKIP] eval     --no-emu
[SKIP] layout   requires emulator screenshot (--no-emu)
[SKIP] perf     profile disabled

RESULT: PASS (4 steps, 0 failed; exit 0)
```

`for t in tests/*.js; do node "$t" || exit 1; done` 退出码 0；playground 浏览器验证输出 `PASS all examples load without runtime errors`，其中 `plasma: 2 nodes`。
