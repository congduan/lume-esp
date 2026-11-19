# Mini Golf / 体感挥杆迷你高尔夫

在手表形态上玩迷你高尔夫：**挥动手表击球**（IMU 模式）或**拖拽瞄准 + HIT 击球**（demo 模式）。6 关程序化生成，无图片/字体素材依赖。纯 app 层，固件与 runtime 零改动。

## 运行

```bash
node tools/simulator/sim.js examples/minigolf/app.js     # 浏览器预览（无 IMU，自动 demo 模式）
node tools/lume/lume.js dev examples/minigolf            # 发到已刷 Lume 固件的主控板
node tools/lume/lume.js check examples/minigolf          # bundle + emu eval + layout + perf
node tests/minigolf.js                                   # 12 组 host harness
```

## 操作

- **demo 模式（默认；浏览器 / emu / 无 IMU 自动降级）**：在球道上从球的位置向目标方向拖拽，方向 = 拖拽方向、力度 = 拖拽距离（150 px = 满力），松开后再按 `HIT` 击球。`MODE` 在 demo / IMU 间切换；无 IMU 样本时请求 IMU 模式会回落到 demo 并记 `GOLF FALLBACK demo`。
- **IMU 模式（真机）**：按 `MODE` 切到 `IMU`，握表做挥杆动作。QMI8658 加速度水平幅值超过 `SWING_THRESHOLD`（6 m/s²）开始记峰值，峰值回落 160 ms 后结算一次击球；水平分量定方向、峰值超阈部分定力度（30 m/s² 封顶）。过弱挥杆不触发，240 ms 冷却保证一次挥杆只出一杆。
- `RESET` 重开本关；`NEXT` 进下一关；入洞后全场通关时把**总杆数**写入 `hisc.golf`（9 字符，NVS 上限 15），严格更少才覆盖。
- 界面文案仅 ASCII + 中文，无装饰 Unicode（固件字体缺字形）。

## 玩法与物理（简化模型）

- 2D 球道：Coulomb 摩擦（常量减速 `FRICTION_DECEL = 150 px/s²`，保证球必然停稳）+ 每关常向量坡度（px/s²）+ 四壁与圆形障碍 `RESTITUTION = 0.6` 回弹。
- 洞半径 16 px：球心入圈且速度不高于 `CAPTURE_SPEED = 140 px/s` 才进洞，快了会 lip-out 越洞。
- 沙坑 / 水域为惩罚区：入区回到上一静止点并 +1 罚杆；数值逃逸 / 越过球道边界也按出界处理（四壁钳制 + 复位，状态有限）。
- 6 关由关卡号确定性生成：`SLOPES` / `HOLES` / `GUARDS` / `BUNKERS` 四表随难度渐升（无障 → 坡度 → 单障 → 双障 → 沙坑 → 全要素），每关 par = 1。`tests/minigolf.js` 用 72 方向 × 14 力度网格搜索证明每关都可一杆进洞，关卡数据出错会在断言处暴露（sokoban 先例）。

## 渲染与预算

- 单个 480×480 canvas = **230,400 px**（恰好等于全 app 预算）。
- 静态层（球道边框、障碍环、洞环、沙坑边框）每关 `retainSegments` 一次上传，共 6 条 path（上限 8），每帧 `drawPath` 从 C 回放；最坏一关 78 段（上限 240）。
- 动态层（球、瞄准线、洞心）按 gravity_ball 的 `snapBox(union(old,new))` 脏区重画，首帧整块画布；稳态脏区远小于全帧（harness 实测最大 9,044 px）。

## 真机调参点与验收边界

- `SWING_THRESHOLD` / `SWING_PEAK_MAX`：挥杆触发门与满力上限，按真机手感调；`SIGN_X` / `SIGN_Y`：轴向映射（gravity_ball 实证 X 反向，故 `SIGN_X = -1`）。
- `SHOT_MIN` / `SHOT_MAX` / `DRAG_FULL`：力度曲线；`FRICTION_DECEL` / `RESTITUTION`：果岭快慢。
- QMI8658 驱动返回的加速度单位是 **m/s²**（`gravity_ball/README.md`、`lume_imu_hw.c`），不是 g；阈值均以 m/s² 计。
- **Deferred to board**：持握姿态、挥杆舒适度、触屏拖拽手感、真机帧率、KV 掉电持久性。验收口径 = 编译/宿主/emu 全绿 + 逻辑自洽，**不声称真机验证**。取舍见 `docs/KNOWN-SIMPLIFICATIONS.md` r123。
