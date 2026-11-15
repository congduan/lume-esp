# Tilt Maze / 重力迷宫

把设备当作掌上迷宫：倾斜手表，让白球绕开木色墙和黑色陷阱洞，进入绿色终点圈。入洞会在当前关起点重生，并累计 `HOLES`；到终点自动进入下一关。共三关，完成后显示通关画面。每关计时从进入该关开始，最快时间保存在 `lume.storage.kv` 的 `maze.best.1`、`.2`、`.3`。重启后从第一关开始，记录保留。

入口是 `app.js`，可直接 `node tools/simulator/sim.js examples/imu_ball/app.js` 预览，或 `node tools/lume/lume.js dev examples/imu_ball` 发送到设备。模拟器没有 IMU 时使用向下的演示重力；这不能验证倾斜手感。纯逻辑断言：`node tests/imu_ball.js`。

## 真机调参点

`app.js` 顶部集中放置标定参数：

- `AXIS_X`、`AXIS_Y` 与 `SIGN_X`、`SIGN_Y`：竖持时 `ax→屏幕 x`、`ay→屏幕 y` 的初始假设。观察左右/上下倾斜，再换轴或反转符号。
- `GAIN`：传感器每 1 m/s² 产生的屏幕 px/s²；`DEAD_ZONE`：小倾角死区。
- `RESTITUTION`、`DRAG`、`MAX_SPEED`：撞墙弹性、速度阻尼与速度上限。

QMI8658 驱动在 `firmware/components/lume-imu/lume_imu_hw.c` 将 ±4g 原始值乘 `(4 / 32768) * 9.80665`，因此 `lume.imu.read()` 的加速度单位是 **m/s²**，不是 g。真机仍需校准装配方向、手感、难度、音量与 20 fps 全屏 Canvas 开销。

## 关卡数据

`LEVELS` 是每关的 `start`、`goal`（圆）、`walls`（轴对齐矩形）和 `holes`（圆）。第一关一面墙一个洞，第二关两面墙两个洞，第三关三面墙三个洞。`physicsStep` 每次最多推进 100 ms，并拆成不超过 10 ms 的小步，返回新球状态及墙、洞、终点事件；渲染和 IMU 不参与该函数。
