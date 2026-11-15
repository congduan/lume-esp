# Gravity Ball / 重力球

最小 IMU 演示：画布上只有一个球，没有关卡、计时、音效或文字。

- 每 50 ms 读一次 `lume.imu.read()`，把 `ax`、`ay` 乘 `GAIN` 当作屏幕平面内的加速度；改变倾斜方向就改变加速度方向，球按新方向加速；
- `DRAG` 阻尼 + `MAX_SPEED` 限速；
- 球心被限制在画布内（`BOUNDS` 内缩 `BALL_R`），撞到边缘时法向速度乘 `-RESTITUTION` 反弹；
- 小于 `DEAD_ZONE` 的加速度分量按 0 处理，用来压掉静止噪声；注意它只清加速度，球已有的速度是靠 `DRAG` 慢慢衰减的。

入口是 `app.js`，可直接 `node tools/simulator/sim.js examples/gravity_ball/app.js` 预览，或 `node tools/lume/lume.js dev examples/gravity_ball` 发送到设备。模拟器没有 IMU（`read()` 返回 `null`），此时用向下 9.8 m/s² 的演示重力，所以预览只能看渲染和回弹，验证不了倾斜映射。纯逻辑与渲染预算断言：`node tests/gravity_ball.js`。

## 真机调参点

`app.js` 顶部集中放置标定参数：

- `AXIS_X`、`AXIS_Y` 与 `SIGN_X`、`SIGN_Y`：屏幕 x/y 取哪一路加速度、正负号。拿起板子左右/上下倾斜，看球是否朝倾斜方向走；不对就换轴或反转符号。本板实测左右是反的，所以 `SIGN_X = -1`；`SIGN_Y` 仍是默认 `1`，若上下也反就同样取负。
- `GAIN`：传感器每 1 m/s² 产生的屏幕 px/s²；`DEAD_ZONE`：小倾角死区，避免静止时噪声让球乱飘。
- `RESTITUTION`：撞边回弹系数（1 = 完全弹性，0 = 不弹）；`DRAG`：速度阻尼；`MAX_SPEED`：速度上限。
- `BALL_R`：球半径（默认 24）；`W`、`H`：画布尺寸（默认 480×480，铺满屏幕，四边就是回弹边界）。

QMI8658 驱动在 `firmware/components/lume-imu/lume_imu_hw.c` 将 ±4g 原始值乘 `(4 / 32768) * 9.80665`，因此 `lume.imu.read()` 的加速度单位是 **m/s²**，不是 g。装配方向（轴向/符号）、倾斜手感与每帧刷新开销都只能上板确认。

## 渲染方式

背景是单一颜色，所以每帧只做两件事：用背景色填掉「球的新旧包围盒并集」，再在球的新位置画实心圆，并把这块矩形作为脏矩形返回；首帧整块画布画一次。

`node tests/gravity_ball.js` 里用假时钟推进真实 tick，`BALL_R = 24` 时实测首帧 51 条绘制记录、整块 480×480（230,400 像素），之后每帧 50 条记录、约 2,500–3,080 像素。用例还会按绘制命令回放画布，断言除当前这个球以外整屏都是背景色（没有残影）。之前的迷宫版在真机上出现条纹/残影，怀疑是整块 20 fps 重绘让 UI 队列积压、`post()` 在 onDraw 中途失败；改成增量后尚未在板子上复测，验收状态见 `docs/KNOWN-SIMPLIFICATIONS.md`。
