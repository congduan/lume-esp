# Known Simplifications / Deferred Acceptance (M1)

本文件记录 M1 刻意接受的行为简化，以及**本轮不做、留待接板验收**的硬指标。
Codex review round-3 的 4 个 P1 已修（见提交）；round-4 review 的 2 个必修点已修：
`__drain()` 对普通抛异常的 effect 不再误清残留批次（仅 guard 溢出路径清），
且 UI 侧 removeChild 现在通过 `LUME_EVT_REMOVED` → `__lume_dispatchRemove` →
`__dispose(id)` 同步释放 JS 侧 press handler 与 signal 绑定 effect。
以下项按约定延后或按 M1 口径从简。

## Deferred: 资源硬指标验收（需接板测，主控接板后跑）

`docs/reactivity-design.md` §4 的数字是**设计预算**，M1 不据此验收，因为它们
需要真实 ESP32-S3 板级测量，当前无板无法取值。主控接板后的验证刀统一跑：

- **prelude bytecode ≤ 40KB flash**：口径未统一——现有数字是 `lume_prelude_js[]`
  **源码字符串**的体积（review 时 4333B，第三刀加修复后约 6.7KB，r4 修复后再增），
  不是编译后的 bytecode 体积。固件当前是 `JS_Eval` 内嵌**源码字符串**（非 bytecode），
  bytecode 口径需先用 `qjsc` 编译同版源码量化 `JS_Eval` 路径的体积/内存收益——
  这一步只需宿主机 qjsc，不需要接板；接板后要测的是**运行时**实际堆占用。
  源码字节数与 bytecode 字节数不可直接比较。
- **signal.set() → native message < 1ms**：需板级计时（无板无法测）。
- **启动后 JS heap 基线 ≤ 256KB PSRAM**：需板级 `heap_caps` 读数。

Owner：主控接板后跑，M1 不据此验收。

## M1 接受的行为简化

- **UI 队列满导致 JS/UI 状态分叉**：M1 采用「有限次重试 + `ESP_LOGE` 打点」，
  不做状态回滚或重同步（`signal.set()` 先改值再发消息，发送失败无法无损回滚）。
  完整的 JS↔UI 状态恢复留给 **M3 状态恢复刀**。（见 `lume_ui_bridge_post` 与
  `lume.*` 绑定的失败路径；日志显式标注 `JS/UI state may diverge`。）
- **signals 自引用/循环 effect**：`__drain()` 超过 1024 次触发 guard，丢弃整批、
  清空残留 dirty 标记并 `lume.log` 打点，不做循环检测或依赖图修复。
- **effect 依赖清理**：每次 effect 运行后重建依赖表、移除未触碰的旧依赖（条件分支
  切换用）；用扁平数组 `indexOf`，无版本号 link 结构（M1 资源优先）。
- **effect 无 dispose handle**；`computed` 延迟求值未实现（M1 仅 `signal` + `effect`）。
- **反向事件（点击）队列满**：丢弃点击，计数器 + 每 N 次一条 `ESP_LOGW`，不阻塞
  LVGL 任务。
- **`console` 不可用**：QuickJS-NG 的 `console` 在 `quickjs-libc`（未链入固件），
  故提供 `lume.log` → `ESP_LOGI` 作为 JS 可见日志通道（prelude guard / 自测用）。

## 热更新通道（r5 / M1）新接受的简化

本轮打通 USB Serial/JTAG（USB CDC）推包链路后，以下行为按 M1 口径从简，**实机推包验证待接板**：

- **无帧超时**：流式解析只靠 "LUME" magic 重同步，没有整体/字节间超时。
  一帧收了一半而主机停发时，解析器会一直等后续字节，不会主动复位该半帧；坏帧
  （坏 magic / 零长 / 超限 / 坏 crc）靠扫描下一个 magic 重新同步。
- **单 staging 槽 + last-wins 合并**：引擎侧只有一个受 mutex 保护的 staging 槽，
  未被引擎取走的新帧会覆盖旧帧，且 `s_reload_pending` 合并为最多一个排队中的
  `LUME_EVT_RELOAD`。连续快速推包时只有最后一帧生效，不做逐帧排队/逐帧 ACK。
- **热替换时清理 LVGL 场景**：r17 在 Queue A 排入 RESET，LVGL task 删除屏幕子节点、动画和 canvas；新 app 的 CREATE 排在 RESET 之后。硬件驱动仍不重启。UI 队列投递失败时会记录错误，尚无全量重同步。
- **帧协议极简**：固定 12 字节头（`LUME` + `u32le total_len` + `u32le crc32`），
  `total_len` 是 payload 字节数（不含头），上限 256KB；`crc32` = `esp_crc32_le(0, payload, len)`
  （即标准 CRC-32 / `zlib.crc32`），只校验 payload。无版本号、flags、帧序号、压缩/分片。
- **M1 仍是 JS_Eval 源码路径**：payload 直接当 JS 源码 eval，不做 bytecode 编译管线。
- **OK 在 eval 成功后才发**：每帧恰好一条 `RELOAD ...` 应答；校验通过只触发引擎重载，
  最终 `RELOAD OK <len>` / `RELOAD ERR eval-failed` 由引擎在 eval 结果确定后经回调发出
  （校验期失败由 RX 任务直接发 `RELOAD ERR <reason>`），避免发过早的 OK。eval 失败时
  引擎回退到上一个可用脚本（保留 `s_good_app` 旧值，否则内嵌 demo），不杀死引擎。
- **USB CDC 与 console 共用同一物理口**：`CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG=y`，
  ESP_LOG 与 `RELOAD ...` 应答混在同一条 CDC 上；未来 CLI 按 `RELOAD ` 前缀过滤。
  RX 帧与 console stdin 共享 USJ 驱动 ring buffer，本固件不读 stdin，故 RX 由热更新
  RX 任务独占；若将来加入 console REPL 需重新评估该共享。

## r6 review fixes（r5 交付后 Codex review 的 2×P1 + 2×P2，均已修）

- 安装/复用 USJ 驱动后调用 `usb_serial_jtag_vfs_use_driver()`：console 的 ESP_LOG
  TX 也走驱动，不再与走驱动的 `RELOAD` 应答在 FIFO 直写路径上竞争（P1）。
- 被 staging 槽覆盖（尚未被引擎取走）的帧现在会收到显式 `RELOAD ERR superseded`
  应答，「每帧恰好一条应答」的约定成立（P1）。
- `respond()` 检查 `usb_serial_jtag_write_bytes()` 返回值，TX 失败/短写打
  `ESP_LOGE`，不再静默丢 OK/ERR 行（P2）。
- `enter_resync()` 进入时先测滚动窗口：恰好结束在错误边界的 `LUME` magic
  不再被漏扫（P2）。

## r7 / M2 ADC 绑定（lume.adc）取舍

本轮补上 M2 第一行的 ADC binding（GPIO/PWM 已于上轮完成）。以下按 M1/M2 口径从简，
真机采样精度验收留主控接板轮（本轮无板，验收 = 编译绿 + size 达标 + API 对照自查）。

- **只暴露 ADC1，且 pin 集合硬编码**：ESP32-S3 的 `SOC_ADC_PERIPH_NUM = 2`，
  ADC2 实际存在（GPIO 11..20 / channels 0..9），但本绑定按任务口径只做
  **ADC1 可采样集合**（GPIO 1..10 → ADC1 channels 0..9），映射写死在
  `lume_adc.c` 的 `s_pin_to_chan[]`，来源是
  `soc/esp32s3/include/soc/adc_channel.h`（IDF 5.5.5 实证）。板子 schematic
  没有 ADC 分压/网络信息，因此 pin 校验**只到「是否属于 ADC1 可采样 GPIO」这一级**，
  不假设任何板级分压比、量程或网口占用；ADC2 与板级约束留后续刀。
- **单一共享 oneshot unit handle**：`adc_oneshot_new_unit()` 对同一 unit 第二次
  claim 返回 `ESP_ERR_NOT_FOUND`（`adc_oneshot.c:99`），故全组件只有一个 ADC1
  unit handle，首次 `config()` 惰性创建、常驻；每个 pin 只配置自己的 channel +
  校准 handle。`free(pin)` 只删该 pin 的校准 handle 并置空闲，**不删 unit handle**
  （对照 `gpio.pwmFree` 停 channel 但不拆 LEDC 外设）。
- **校准方案只有 curve fitting**：ESP32-S3 只编译了
  `ADC_CALI_SCHEME_CURVE_FITTING_SUPPORTED`（`esp_adc/esp32s3/.../adc_cali_schemes.h`），
  没有 line fitting。`readMv()` = `adc_oneshot_read()` + `adc_cali_raw_to_voltage()`
  （对照 `examples/peripherals/adc/oneshot_read`），是校准后 mV，不是 raw 线性估算。
  eFuse 校准位未烧时 `adc_cali_create_scheme_curve_fitting()` 返回
  `ESP_ERR_NOT_SUPPORTED`（官方例程是 WARN + 跳过）：本绑定让 `config()` 仍成功、
  `readRaw()` 可用，`readMv()` 返回 `-3`（校准不可用），**不给未校准的假电压**。
  mV 绝对精度受 eFuse 校准数据与 atten 档影响，接板后由主控轮实测。
- **衰减档与量程**：atten 0..3 → `ADC_ATTEN_DB_0/2_5/6/12`（v5.5 为 `_12`，
  `_11` 是 deprecated alias）。高衰减扩大可测范围、牺牲低端分辨率；本绑定不
  换算/上报量程电压，量程由调用方按衰减档自行把握。
- **roadmap 不勾选**：M2 第一行「GPIO / PWM / ADC bindings」**保持未勾选**，
  等下轮把 GPIO/PWM/ADC 合并 review 后再一起勾，不在本轮单独勾。

## r8 / M2 AXP2101 电源绑定（lume.pmic）取舍

本轮补上 M2 第二行「AXP2101 power bindings (battery telemetry, power off/reboot)」的
遥测 + powerOff 部分。以下按 M1/M2 口径从简，真机电池读数 / powerOff 行为验收留主控接板轮
（本轮无板，验收 = 编译绿 + size 达标 + 寄存器事实逐条对照 XPowersLib 自查）。

- **温度通道：纳入，但只暴露原始 ADC 值**。先实证 `XPowersAXP2101.tpp:2216-2219`
  `enableTemperatureMeasure()`（0x30 bit4）与 `:2226-2230` `getTemperature()`
  （0x3C/0x3D 的 H6L8），确认后纳入。但绑定返回 **14-bit raw**（`dieTempRaw()`），
  不套 `XPOWERS_AXP2101_CONVERSION(raw) = 22.0 + (7274 - raw)/20.0 [°C]`
  （`AXP2101Constants.h:241`）：一是该线性拟合是库级经验式，绝对精度必须接板实测；
  二是换算成 °C×10 后在 0°C 以下会得到负值，与「负数 = 错误码」契约冲突。换算公式
  写在 `runtime/types/lume.d.ts` 交给 JS 侧，接板验证后再决定是否下沉到 C。
- **充电参数一律不写**：不给 0x61/0x62/0x63/0x64（预充/恒流/截止/目标电压）、
  0x18/0xA2（充电 / fuel gauge 开关）等寄存器拍脑袋写值——板子电池策略未知，乱写会
  烧充电配置。init 只做两处**测量使能**写（OR-only、幂等、一次）：`BAT_DET_CTRL`
  (0x68) bit0 与 `ADC_CHANNEL_CTRL` (0x30) bit0/2/4（VBAT/VBUS/die temp）。
  `powerOff()` 只写 `COMMON_CONFIG` (0x10) bit0（soft PWROFF，`tpp:393-396`），
  且是 OR-only 保留其它位（含 bit1「Restart the SoC」）。**本轮不做 reboot**：
  `esp_restart` 属 `lume.system` 命名空间，下一刀再说（已查 `lume.system` 目前只有
  `log()`，无 reboot/restart 绑定）。
- **I2C 并发结论：驱动自带锁，无需本层加锁**。引擎任务读 PMIC 时 LVGL 任务正在同一
  bus 上轮询触摸。实证 ESP-IDF v5.5.5：`docs/en/api-reference/peripherals/i2c.rst:652-663`
  明确「I2C master operation functions are also guaranteed to be thread safe by bus
  operation semaphore」，列表含 `i2c_master_transmit` / `i2c_master_transmit_receive`；
  `components/esp_driver_i2c/i2c_master.c:1007-1039` 的
  `s_i2c_synchronous_transaction()` 在触碰共享 bus 状态前 take `bus_lock_mux`
  （`:1097-1099` 创建），成功 `:1031` / 失败 `:1037` 归还；`:1200-1202`
  `i2c_master_bus_add_device()` 插设备链表也持同一把锁。故硬件层无锁，
  `lume_board_get_i2c_bus()` 返回的是 board 持有的**同一个**句柄（不是
  `i2c_master_get_bus_handle()` 那种同端口另取句柄，`i2c_master.h:349` 的
  「can't be used concurrently」警告不适用）。共享 bus 句柄导出 = lume-board 最小 diff：
  只加 static 句柄 + getter，不动初始化顺序、不动 `lume_pmic.c` 显示上电逻辑。
- **简报硬件事实的一处纠正（已实证）**：简报写「STATUS1 (0x00) bit4 = VBUS in」是错的。
  `tpp:256-259` `getBatfetState()` 才是 STATUS1 bit4（BATFET state）；VBUS 在位是
  STATUS1 **bit5** `VBUS_GOOD`（`tpp:251-254`）且 `!STATUS2 bit3` VINDPM
  （`isVbusIn()` `tpp:307-310`），AXP2101 datasheet REG00/REG01 位表
  （6.13.2.1 / 6.13.2.2）一致。电池在位 = STATUS1 bit3（`tpp:262-265`）。
  `chargingStatus()` 取 `STATUS2[2:0]`（`tpp:312-318`，0..5 充电态枚举 `tpp:81-87`），
  不是 `isCharging()` 的 `[6:5]` 电流方向位。
- **无板不验证项（接板后由主控轮实测）**：① VBAT 读数按库用 `readRegisterH5L8`
  （`XPowersCommon.tpp:426-432`，13-bit 有效），而 datasheet REG34 描述的是 14-bit
  `vbat[13:8]` + `vbat[7:0]`，库自身丢弃了最高位——单节锂电 3~4.2V 范围内无影响，
  但口径差异留档；② REG A4 电量百分比依赖 OTP 默认的 fuel gauge 是否使能，本轮不使能
  也不校验其有效性位；③ die temp 线性拟合的绝对精度；④ `isVbusIn()` 里 VINDPM
  条件对「USB 插入」判定的影响；⑤ `powerOff()` 后 PMIC 实际断电行为与所需延时。
  真实读数（mV / % / 充电态 / 温度）精度一律留接板验收。
- **单一 dev handle + init 闩锁语义（r9 review 后修订）**：`lume_pmic_hw_init()` 由
  `register_bindings()` 调用（引擎任务、每轮 runtime 都调）。**成功** init 闩锁进程
  生命周期（热更新 runtime 重置直接返回，不会重复 `add_device()`）；**失败** init
  **不闩锁**、且已 `add_device` 的 handle 在每条失败路径上 `i2c_master_bus_rm_device()`
  释放（Codex r8 review 指出的两点：瞬态 I2C 失败会把绑定锁死到重启、部分失败泄漏
  handle——均已修），下一轮 runtime 重试。init 失败（无板 / CHIP_ID≠0x4A）**非 fatal**，
  只 WARN，`s_dev` 保持 NULL，所有 `lume.pmic.*` 调用返回 `-3`。
- **roadmap 不勾选**：M2 第二行「AXP2101 power bindings」**保持未勾选**，等 review
  通过合并后再勾（与本轮 r7 的处理一致）。

## r9 / M2 QMI8658 IMU 绑定（lume.imu）取舍

本轮补上 M2 第三行「QMI8658 IMU bindings」的 **polled read** 部分（新组件
`lume-imu` + `lume.imu` 绑定）。以下按 M1/M2 口径从简，真机 IMU 读数 /
INT 中断触发验收留主控接板轮（本轮无板，验收 = 编译绿 + size 达标 + 寄存器
事实逐条对照 Waveshare 官方例程 / QMI8658A datasheet 自查）。寄存器逐条证据
见 `firmware/components/lume-imu/lume_imu_hw.c` 文件头注释。

- **简报硬件事实的一处纠正（已实证）：WHO_AM_I 不是单值 0xFD**。简报写
  「WHO_AM_I 校验 0xFD」；但本板随包 Waveshare SensorLib 的
  `QMI8658Constants.h:43` 定义 `WHOAMI_DEFAULT = 0x05`、
  `SensorQMI8658.hpp:2000-2004` 的 `initImpl()` 校验 `whoAmI() == 0x05`，
  随包 `QMI8658A Datasheet Rev A.pdf` Table 21（p.29）明写
  「Device identifier 0x05」。0xFD 是 **QMI8658C**（schematic 网表页眉写的
  那个 die，Waveshare 其它板如 ESP32-S3-LCD-1.9 的 `qmi8658c_example`
  用的就是它）；而 schematic 的料号 U5 标的是 **QMI8658A**，随包手册 /
  驱动也是 A 版。两种 die 寄存器映射相同、板子实际贴哪片无法在无板条件下
  判定，故 init **同时接受 0x05 与 0xFD** 并打印实测 ID——只认一个值会在
  另一片 die 上把绑定判死。这是按「假设可能错先实证」对简报做的纠正，
  与 r8 纠正 VBUS 在位的处理一致。
- **本轮 polled-only，不做 onMotion 中断**。schematic 确实把
  `QMI_INT1 -> GPIO17`、`QMI_INT2 -> GPIO21` 引到了 ESP32-S3，但
  `lume_pins.h`（简报指定的板级 INT 脚权威来源）**没有定义任何 IMU INT 脚**，
  Waveshare 随板 `Mylibrary/pin_config.h` 同样没有；本板官方例程
  `04_LVGL_QMI8658_ui.ino` 是纯 polled（`loop()` 里 `getDataReady()`，从不
  `enableINT`），带 INT 的 `InterruptExample.ino` 用的是 `IMU_IRQ=33`（属于
  T-Beam S3 Supreme，不是本板）。按简报「若板卡未引出或定义不明，退化为
  纯 polled 模式」的取舍，本轮：不写 GPIO17/21 的猜测定义、不装 ISR、
  不做 ISR->JS 回调派发（无板无法验证 IRQ 极性 / 触发 / 抖动）。
  `lume.imu.onMotion(cb)` 保留 API 形状但**恒返回 `-4`**
  （`LUME_IMU_ERR_NO_INT`）+ 一条 WARN，cb 永不触发；d.ts 与 roadmap 均注明
  其 unsupported。INT 接线 + 事件派发留主控接板轮。
- **初始化序列对照官方例程，写定值而非读改写**。`SensorQMI8658.hpp` 的
  `configAccelerometer(ACC_RANGE_4G, ACC_ODR_1000Hz, LPF_MODE_0)` /
  `configGyroscope(GYR_RANGE_64DPS, GYR_ODR_896_8Hz, LPF_MODE_3)` 拆成最终
  整字节值，逐位对照 datasheet Table 22 复核后一次性写入：
  `CTRL1=0x60`（ADDR_AI + BE 默认，INT 脚 high-Z）、`CTRL2=0x13`
  （±4g / 1000Hz）、`CTRL3=0x23`（±64dps / 896.8Hz）、`CTRL5=0x71`
  （accel LPF mode0 + gyro LPF mode3，两个 LPF 使能）、`CTRL7=0x03`
  （aEN+gEN，async，DRDY_DIS 默认 0）。**CTRL7 最后写**（datasheet 9.4/10.4
  要求配寄存器时传感器须关闭）；**CTRL4/CTRL6 是保留寄存器，不写**。
  `CTRL8`（CTRL9 handshake）与 `CTRL9`（COPY_USID / USID 读取）是官方
  `initImpl()` 里可选的 FW 版本日志，本轮不发任何 CTRL9 命令，故一并跳过。
- **软复位用固定 20ms 延时，不用 0x4D 轮询**。官方 `reset()` 写
  `RESET(0x60)=0xB0` 后轮询 `0x4D == 0x80`；datasheet Table 27 确认 0xB0
  （7.4 正文写「0x0B」是笔误，Table 27 + 驱动常量 `RESET_DEFAULT=0xB0`
  一致），且 3.3.1/7.4 规定复位最多 15ms、期间禁止任何寄存器写，7.4 还提醒
  `0x4D` 可能已因 POR 呈现 0x80 —— 轮询可能提前退出。故改为
  `vTaskDelay(20ms)` 的 datasheet 口径等待，再做 WHO_AM_I 校验。
- **read() 不门控 STATUS0**。`STATUS0(0x2E)` 的 aDA/gDA 位是「自上次读后有
  新数据」（datasheet Table 24），官方例程在 tight loop 里用 `getDataReady()`
  避免重复读同一帧；按需调用的 JS `read()` 若门控会让连续两次 read 第二次
  失败。故直接一次 burst 读 `AX_L..GZ_H` 共 12 字节（ADDR_AI=1，低字节在前、
  16-bit 补码，datasheet 5.6 / 8.9），输出寄存器始终持有最近一次转换结果。
  代价：使能后约 150ms 的 gyro turn-on 窗口内数据寄存器可能仍为 0 —— 属
  「接板后实测」项，不在无板条件下拍脑袋补状态判断。
- **物理单位换算在 native 完成**：`raw * (range/32768)` 得 g / dps
  （±4g → 8192 LSB/g、±64dps → 512 LSB/dps，datasheet Table 7/8），再乘
  标准重力 `9.80665` 把 g 转 m/s²；deg/s 即传感器原生单位，不再换算。
  ESP32-S3 带 FPU，直接用 `float`，不做 soft-float 假设或定点优化。
- **read() 的失败契约与其它 lume.\* 不同**：`lume.gpio/adc/pmic` 返回 int
  状态码；`read()` 按简报必须返回对象，故失败（无板 / 未初始化 / I2C 错误）
  统一映射到 JS `null`（native 侧已打 WARN，不抛异常、不 abort）。`onMotion()`
  仍按 int 状态码返回 -4。
- **单一 dev handle + init 闩锁语义照搬 r8 lume-pmic**：`lume_imu_hw_init()`
  由 `register_bindings()` 每轮 runtime 调用；**成功**闩锁进程生命周期、
  **失败**（含 add_device 之后的部分失败）在每条路径
  `i2c_master_bus_rm_device()` 释放且不闩锁，下一轮重试。init 失败非 fatal，
  只 WARN；I2C 并发同理依赖 ESP-IDF v5.5.5 的 bus 操作信号量，本层不加锁。
- **无板不验证项（接板后由主控轮实测）**：① 板上实际 die 是 A(0x05) 还是
  C(0xFD)；② CTRL1.BE=1 下 12 字节的字节序 / 符号位是否正确；③ 静止时 az
  是否 ≈ 9.81 m/s²、量程/ODR/LPF 实际效果；④ gyro 150ms turn-on 内首次
  read 的读数；⑤ INT1/INT2 极性、DRDY 触发与 ISR->JS 派发（本轮未实现）。
- **roadmap 不勾选**：M2 第三行「QMI8658 IMU bindings」**保持未勾选**，仅追加
  r8 风格进度注记「r9 代码完成 + Codex review 通过后由主控勾选」，等 review
  通过合并后再勾（与本轮 r7/r8 的处理一致）。

## r10 / M2 NVS KV store 绑定（lume.storage.kv）取舍

本轮补上 M2「NVS KV store + LittleFS partition」行的 **Kv 部分**（新组件
`lume-storage` + 嵌套命名空间 `lume.storage.kv` 绑定）。自包含、不依赖真机：
NVS 在主 flash 上、不需要外部外设，故与 lume.pmic/lume.imu 不同，没有「无板」
降级路径，唯一失败模式是 NVS 分区缺失/初始化失败。以下按 M1/M2 口径从简，
真机掉电重启后的 kv 持久性验收留主控接板轮（本轮验收 = 编译绿 + size 达标 +
逐条对照 ESP-IDF v5.5.5 nvs API 自查）。API 逐条证据见
`firmware/components/lume-storage/include/lume_kv.h` 文件头与 `lume_kv.c` 注释。

- **分区表实证：NVS 分区已存在，无需新增**（按「假设可能错先实证」）。先查
  `firmware/partitions.csv:2` 再跑 `idf.py partition-table`，输出含
  `nvs,data,nvs,0x9000,24K` —— 默认 NVS 分区（`NVS_DEFAULT_PART_NAME "nvs"`，
  `nvs.h:58`）存在且 24 KB，故本轮**不改分区表**。降级路径仍是必需的：
  `nvs_flash_init()` 可能返回 `ESP_ERR_NVS_PART_NOT_FOUND`（分区被裁掉 /
  未烧）等错误，此时所有 kv API 统一返回 `-3`。分区表里另有
  `storage,data,fat,0x750000,1M`，那是留给后续 LittleFS / `lume.storage.Fs`
  的分区，**本轮不碰、不挂载、不读写**。
- **固定默认 namespace "lume"，不做 JS 可指定 namespace**。NVS namespace 名
  与 key 名一样受 `NVS_NS_NAME_MAX_SIZE == NVS_KEY_NAME_MAX_SIZE == 16`（含
  NUL，即 15 字符，`nvs.h:61-62`）限制。做成 JS 可指定会引入第二个需校验
  长度的参数，且 `keys()` / `clear()` 的作用域、`nvs_open` 句柄管理都要按
  namespace 分裂，超出「自包含一刀」的范围；单一固定 namespace 让所有
  `lume.storage.kv` 键同处一室、`keys()/clear()` 语义无歧义，与
  `lume.storage.Fs` 的分区级存储也自然分层。留后续轮按需扩展。
- **key ≤ 15 字符、value < 4000 字节的 native 防御**。key 用
  `NVS_KEY_NAME_MAX_SIZE(16)-1=15` 实证值卡死，空/超长返回 `-1`；value：
  `nvs_set_str` 的单页上限是 4000 字节（含 NUL，`nvs.h:294-296`），
  `nvs_set_blob` 对 24 KB 分区的理论上限约 19 KB（`nvs.h:327-329` 的
  97.6%×24576−4000），但那远超单页容量、实际会 `NOT_ENOUGH_SPACE`。故本层
  统一把 string/blob payload 卡在 `< 4000` 字节（string 3999 B + NUL = 4000、
  blob ≈ 一页），既贴 NVS 文档又防一个条目吃光小分区；`get()` 读侧也复查
  长度再 malloc，杜绝无界分配。零长 blob、含内嵌 NUL 的 string、不支持的
  value 类型（null/对象等）一律 `-1`。numbers 经 `JS_ToInt32` 截断/回绕存
  `i32`（与其它 lume.* 一致）。
- **每种 JS 类型对应一个独立的 NVS 类型，get() 才能还原类型**：string→
  `nvs_set_str`(NVS_TYPE_STR 0x21)、number→`nvs_set_i32`(0x14)、
  boolean→`nvs_set_u8`(0x01)、ArrayBuffer→`nvs_set_blob`(0x42)。
  `get()` 用 `nvs_find_key()`（`nvs.h:521`）拿类型再分派到对应 `nvs_get_*`；
  其中 blob 被 `NVSHandleSimple::find_key` 从内部 BLOB_IDX 映射成
  `NVS_TYPE_BLOB`（`nvs_handle_simple.cpp:77-80` + `nvs_handle.hpp:38`）。
  已实证 `Storage::writeItem` 在改类型时会用 `ItemType::ANY` 找到旧键、写新
  类型再删旧条目（`nvs_storage.cpp:445-461, 534-589`），故 `set()` 覆盖不同
  类型可直接写、无需手动 erase。发现不认识的 NVS 类型（其它固件写的
  I8/U16/U64…）返回 `-2`，不猜测 JS 类型。
- **init 失败一律 `-3`，且绝不自动擦除分区**。`nvs_flash_init()` 失败
  （分区缺失 / `NO_FREE_PAGES` / `NEW_VERSION_FOUND`）是非 fatal 的：只
  `ESP_LOGW`，`require_ready()` 把所有入口收敛到 `-3`，不 abort、不 crash，
  与 lume.pmic 的 `-3` 风格一致。**刻意不做**官方例程那套
  `erase()+retry()`：静默擦掉用户已持久化的 KV 数据是数据丢失隐患，分区损坏
  应由主控显式处理。init 幂等（`nvs_flash_init` 对已注册分区直接返回 ESP_OK，
  `nvs_partition_manager.cpp:41-44`），照搬 r8/r9 闩锁语义：**成功**闩锁进程
  生命周期、**失败**不闩锁并在下一次 `register_bindings()` 重试，故
  `nvs_open` 不会在活句柄上重复调用。每个写入口都 `nvs_commit()` 保证掉电
  落盘（持久性真机验收留接板轮）。
- **get()/keys() 的返回契约与其它 lume.\* 不同**：`lume.gpio/adc/pmic` 返回
  int 状态码、`lume.imu.read()` 失败返回 null；`kv.get()` 成功返回值 / 缺失
  返回 null，但**失败时返回负状态码（number）**，`kv.keys()` 成功返回
  string[]、失败返回负状态码（number），以满足简报「所有 kv API 返回统一错误
  码」的降级要求。代价是 get() 的 number 与错误码在类型上重叠（存的 number
  也可能是 -1/-2/-3 这些合法负值，NVS 可用时同样会撞码）——**调用方无法可靠
  区分 get() 的负返回值是存值还是错误码**，这是本契约的已知取舍而非可判别
  行为：后续轮若需要严格判别，改 get() 失败时抛 JS 异常或返回 `{ok, value}`
  包装。keys() 无歧义（`Array.isArray` 判别）。`remove()` 对缺失键幂等返回
  0。
- **keys() 用 NVS 迭代器 + 回调**，不自建固定容量数组：`nvs_entry_find_in_handle`
  → `nvs_entry_next` → `nvs_entry_info` → `nvs_release_iterator`
  （`nvs.h:757/775/789/799`），引擎侧回调把每个 key 追加进 JS 数组。空
  namespace 返回空数组 `[]`。`nvs_entry_next` 到末尾会自己 free 迭代器并置
  NULL（`nvs_api.cpp:859-864`），`nvs_release_iterator(NULL)` 是 no-op
  （`:880-883`），无泄漏。NVS 自带内部锁（`nvs_api.cpp` 各 wrapper 的
  `Lock lock;`），所有入口又只在引擎任务执行，故本层不加锁。
- **无板不验证项（接板后由主控轮实测）**：① 掉电重启后 kv 的持久性（本轮只
  保证 `nvs_commit()` 被调用）；② 24 KB 小分区在多条 string/blob 下的实际
  碎片 / `NOT_ENOUGH_SPACE` 行为；③ 4000 字节 blob 在 6 页分区里的实际可写性；
  ④ 与将来 WiFi/PHY 等也用默认 `nvs` 分区的组件共享命名空间/条目时的容量。
- **roadmap 不勾选**：M2「NVS KV store + LittleFS partition」**保持未勾选**，
  仅追加 r10 风格进度注记「r10 Kv 部分代码完成 + Codex review 通过后由主控
  勾选」——本轮只做 Kv，LittleFS / `lume.storage.Fs` 未做，不勾整行（与 r7/r8/r9
  处理一致）。

其余架构取舍见 `docs/reactivity-design.md` §3。

## r11 / M2 WiFi station + HTTP client 绑定（lume.net）取舍

本轮补上 M2「WiFi + HTTP client bindings」行的**代码部分**（新组件
`lume-net` + `lume.net` / `lume.net.http` 绑定）。自包含、不依赖真机即可编译
验收：WiFi 在 ESP32-S3 片内射频、不需要外部外设，故与 lume.pmic/lume.imu
不同，没有「无板」降级路径；唯一失败模式是 NVS 分区缺失 / WiFi 驱动初始化
失败（收敛到 `-3`）。以下按 M1/M2 口径从简，**真机连 WiFi / HTTP 实测验收
留主控接板轮**（本轮验收 = 编译绿 + size 达标 + 逐条对照 ESP-IDF v5.5.5
头文件与官方 `examples/wifi/getting_started/station`、
`examples/protocols/esp_http_client` 自查）。API 逐条证据见
`firmware/components/lume-net/include/lume_net.h` 文件头证据表。

- **只做 station / 只做 WPA2-PSK / 不做 smartconfig、softAP、BLE 共存、
  WPS、enterprise、主动扫描**。这是简报明确允许的简化。`lume_net_connect()`
  把 `wifi_sta_config_t.threshold.authmode` 写死为 `WIFI_AUTH_WPA2_PSK`
  （`esp_wifi_types_generic.h:90,370-376`），扫到的 AP 安全级别低于 WPA2
  不会连；SSID ≤ 32 字节（`MAX_SSID_LEN`，`:1196`，对应 `.ssid[32]`，
  `:559`）、密码 8..63 字符（WPA2 口径，`.password[64]` `:560` 留 NUL，
  `MAX_PASSPHRASE_LEN 64` `:1197`），内嵌 NUL / 空 / 超长一律 `-1`。
  **注意**：sdkconfig 里 `ESP_WIFI_ENABLE_WPA3_SAE / ENTERPRISE_SUPPORT /
  SOFTAP_SUPPORT` 等仍为 `y`（沿用板厂 BSP 默认值，**没有改**），这些能力
  编译进了库但 JS 层不暴露、不使用；把这些 config 关掉以砍 Flash 是后续
  轮的可选优化，本轮为减小 sdkconfig 改动面刻意保留。同理不做断线自动重连
  （官方 example 的 retry 逻辑未搬）、不做事件回调到 JS（见下）。
- **NVS 初始化时序（实证，不是猜）**：`lume_net_init()` 由
  `register_bindings()` 调用（`lume_engine.c` 引擎任务、`engine_task()` 外层
  循环每次 runtime 都跑，`:1202`）。同一函数里 `lume_kv_init()`（内含
  `nvs_flash_init()`）在它前面几行先跑（`:933`），故 WiFi 启动时 NVS 已就绪。
  WiFi 仍需要 NVS（`CONFIG_ESP_WIFI_NVS_ENABLED=y`，存 PHY 校准 / 凭证），
  因此 `lume_net_init()` **再调一次幂等的 `nvs_flash_init()`**（`nvs_flash.h:78`，
  `nvs_partition_manager.cpp:41-44` 已注册分区直接 `ESP_OK`）以自包含：即使
  KV init 失败也不影响。照搬 r10 政策——**成功闩锁进程生命周期、失败不闩锁
  并在下一次 `register_bindings()` 重试**，且**绝不自动擦除 NVS 分区**（静默
  擦掉用户数据是数据丢失隐患）。每个 init 步骤都用 `s_*` 闩锁守卫，失败后
  下一轮「断点续做」，不会重复创建 netif / event loop、不会泄漏。
- **event handler 任务归属（实证）+ 轻量锁**：`esp_event_loop_create_default()`
  会 `xTaskCreatePinnedToCore` 一个名为 **`sys_evt`**、绑 **core 0** 的专用任务
  （`default_event_loop.c:98-104` → `esp_event.c:576-579`），handler 在该任务
  的 `esp_event_loop_run()` → `handler_execute()` 里被派发（`esp_event.c:676/
  686/696`）；而引擎任务是 `lume-js`、绑 **core 1**（`lume_engine.c:1327-1329`）。
  **两者不同任务、不同核**：WIFI_EVENT/IP_EVENT handler（写者）与 `status()` /
  `httpGet()`（读者）并发访问连接状态。故状态（`s_state` 枚举 + `s_ip4` 原始
  IPv4）用 `portMUX_TYPE` 自旋锁临界区保护（与 `lume_engine.c` 的 `s_rm_mux`
  同一轻量模式）；临界区内**只做整数/标志赋值**，IP 字符串在读者侧
  `esp_ip4addr_ntoa()`（`esp_netif.h:879`）格式化、日志在临界区外打印，杜绝
  在关中断的临界区里调 libc/ESP_LOG。事件流：`connect()` 设 CONNECTING →
  `WIFI_EVENT_STA_CONNECTED` 设 CONNECTED（已关联、等 DHCP）→
  `IP_EVENT_STA_GOT_IP` 设 GOT_IP 并存 IP → `WIFI_EVENT_STA_DISCONNECTED`
  设 DISCONNECTED 并清 IP。`httpGet()` 仅在 GOT_IP 下放行。
- **IRAM 16384 硬红线 + sdkconfig 手段（实证）**：r10 基线 IRAM 恰好
  `16384/16384`（100%，Remain 0，`.text 15356 + .vectors 1028`）。一旦 lume-net
  引用 `esp_wifi_*`，链接器把 WiFi 库拉进来；`CONFIG_ESP_WIFI_IRAM_OPT=y`、
  `CONFIG_ESP_WIFI_RX_IRAM_OPT=y`（r10 sdkconfig 默认）会经
  `components/esp_wifi/linker.lf:25-31,108-151` 把 `libpp.a` / `libnet80211.a`
  的 `.wifi0iram` / `.wifirxiram` 段塞进 `iram0_text`，必然溢出。故本轮在
  `firmware/sdkconfig` 与 `firmware/sdkconfig.defaults` 把两者设为 `n`（Kconfig
  `:274-299` 明示「关掉省 >10K / >17K IRAM，代价是 WiFi 吞吐下降」），
  `EXTRA_IRAM_OPT` / `SLP_IRAM_OPT` 保持默认关；`ESP_PHY_IRAM_OPT=y` 依
  `esp_phy/Kconfig:205` 只影响 esp32c2，与本板 esp32s3 无关，不动。构建实测
  **IRAM 仍为 16384 / 100% / Remain 0，零增量**（若不开这两个 config 链接会
  因 IRAM 溢出直接失败）。取舍：牺牲 WiFi 吞吐换取不越硬红线，写入 docs。
- **Flash/DIRAM 增量归因（超出 250KB，按要求解释）**：r10 基线（简报值）
  Flash Code 844742 / DIRAM 155535 / IRAM 16384 / Total 1154209；开工前实测
  基线为 844742 / 155535 / 16384 / **1154285**（Total 与简报差 76 B，构建
  可复现性微差）。r11 实测 Flash Code 1398890 / Flash Data 289920 / DIRAM
  189523 / IRAM 16384 / Total 1810125 → **Flash Code +554148、DIRAM +33988、
  IRAM +0、Total +655916**（对实测基线 Total 为 +655840）。简报预估的
  「+80~150KB」只算了 `libesp_wifi.a` 自身，实际一旦引用 WiFi+HTTP，链接器
  会把 r10 里被 `--gc-sections` 丢弃的 **整张传递依赖图**拉回来
  （`idf.py size-components`，Flash Code 列）：
  `libnet80211.a` 121134、`liblwip.a` 96845、`libmbedcrypto.a` 74339、
  `libwpa_supplicant.a` 65946、`libpp.a` 56287、`libmbedtls.a` 27345、
  `libhttp_parser.a` 13832、`libnvs_flash.a` 15531、`libesp_http_client.a`
  9207、`libesp_netif.a` 6448、`libesp-tls.a` 6424、`libesp_wifi.a` 3753、
  `libtcp_transport.a` 3683、`liblume-net.a` **2411**。其中 `libnet80211.a`
  / `libpp.a` 是闭源预编译 WiFi MAC 二进制（≈177KB，不可由 Kconfig 削减），
  `liblwip.a`（TCP/IP+DHCP，≈97KB）与 WPA2 握手需要的 `libwpa_supplicant.a`
  / mbedcrypto 也是刚需；故即便关掉 WPA3/enterprise/softAP/HTTPS 也压不到
  250KB 以内——增量属于「首次链接 WiFi 栈」的一次性固定成本，判定为合理。
  `liblume-net.a` 自身仅 2411 B。后续轮若真要省 Flash，可关 WPA3/
  enterprise/softAP 与 ESP_HTTP_CLIENT_ENABLE_HTTPS，但本轮不为省几十 KB
  去动板厂已验证的 WiFi config（见第一条）。
- **HTTP 同步、http:// 为主、能力从简**：`httpGet()` 是**同步 oneshot GET**
  （`esp_http_client_init` → `perform` → `get_status_code` → `cleanup`，
  `esp_http_client.h:296/327/688/738`），body 经 `HTTP_EVENT_ON_DATA`
  （`:42,51-59`）累积到一次性 `malloc` 的 32KB 缓冲，超出**截断**并置
  `truncated:true`（不做无界分配、不返回 chunk 流）。`timeoutMs` 默认 5000、
  钳到 30000；`responseType:'arraybuffer'` 时 body 为 ArrayBuffer，默认 string。
  **同步会阻塞引擎任务**：`esp_http_client_perform()` 在超时前不返回，
  期间热更新 RELOAD / 触摸 PRESS 事件卡在内层事件循环外——本轮按简报允许
  「先做同步版」，**异步 / 带回调版列后续轮**。HTTP 级状态码（404/500…）是
  **成功结果**（`out.status`），不是 C 错误码；`headers?` 本轮不解析返回。
- **HTTPS 未正确配置、http:// 为主**：`CONFIG_ESP_HTTP_CLIENT_ENABLE_HTTPS=y`
  仍编译进库，但本轮**不挂 `crt_bundle_attach` / `cert_pem`、不开
  `skip_cert_common_name_check`**，故 https:// 因无 CA 做服务器校验通常握手
  失败（URL 语法接受 `https://`，但不保证可用）。URL 仅接受
  `http://`/`https://` 前缀、≤512 字节。真机 HTTPS 能力（cert bundle 或
  skip CN 等简化）留后续轮。
- **错误码契约与统一降级（照搬 r10 -1/-2/-3）**：`lume_net.h` 定义
  `0 OK / -1 ARG / -2 DRIVER / -3 STATE`，与 `lume_kv.h` / `lume.pmic` 同风格。
  `require_ready()` 把所有入口（init 除外）收敛到 `-3`：WiFi 未初始化 / 驱动
  init 失败 / 无 IP 时 `connect/status/disconnect/httpGet/deinit` 一律 `-3`，
  **不 crash、不 abort、不抛异常**；`init()` 失败非 fatal（WARN）、失败不闩锁
  下轮重试。`status()`/`httpGet()` 成功返回对象、失败返回负数（与
  `kv.get()`/`keys()` 的对象/负数联合返回值同构）；`init/deinit/connect/
  disconnect` 直接返回 int 状态码。
- **凭证与 URL 的日志纪律**：SSID/password 只做校验、拷进**栈上**
  `wifi_config_t`、`esp_wifi_set_config()` 后立即 `memset` 清零，**绝不进
  ESP_LOG**（官方 station example 结尾 `ESP_LOGI("SSID:%s password:%s")` 的
  反模式刻意不抄）；handler 只打状态跃迁与分配到的 IP。**URL 全串不进日志**
  （query 可能含 token）；docs 提一句：URL 里的敏感 query 参数本层不强制
  擦洗/脱敏，调用方自行避免在 url 中拼接密钥。
- **无板不验证项（接板后由主控轮实测）**：① 真实 AP 关联 / DHCP 拿 IP /
  `status()` 状态机时序；② `httpGet()` 对真实 http:// 服务器的响应、
  超时、32KB 截断行为；③ 关闭 WiFi IRAM 优化后的实际吞吐；④ https:// 行为
  与未来 cert bundle 接入；⑤ `connect()` 在 `esp_wifi_start()` 后、STA_START
  事件已派发的前提下直连的时序（init 在 boot 期 start、app JS 远晚于
  STA_START 才调 connect；最坏情况 `esp_wifi_connect()` 返回 -2，不 crash）。
- **roadmap 不勾选**：M2「WiFi + HTTP client bindings」**保持未勾选**，仅追加
  r11 风格进度注记「r11 代码完成 + 编译绿 + size 达标 + ESP-IDF 自查，真机
  连网验收留接板轮」——与 r7/r8/r9/r10 处理一致，等主控接板实测通过再勾。

## r12 / M2 LittleFS 文件系统绑定（lume.storage.Fs）

- 单个 `storage` 分区，挂载点 `/lume_fs`；成功挂载闩锁进程生命周期，失败在下次 runtime 注册时重试。`Fs.mounted()` 暴露状态；未挂载的操作返回 `-3`。
- 首次挂载失败时组件按 `format_if_mount_failed=true` 格式化再挂载。这会清除已有的、无法挂载的 `storage` 内容；此分区此前标为 FAT，升级时原 FAT 内容不会保留。
- 路径相对存储根目录，最多 240 字节。拒绝空路径段、`.`、`..`、末尾斜杠及内嵌 NUL；不自动创建父目录。`mkdir` 只创建一层，`remove` 不递归，`list` 只列直接子项名称。
- `read` 最多一次读 64 KiB，按 QuickJS 的 UTF-8 文本解码；`readBinary` 返回原始 ArrayBuffer。写入的类型不记元数据，调用者自行选择读取方法。
- `write`/`append` 同步执行 VFS 操作；没有事务、跨文件原子性或并发写入 API。文件系统层仅由 JS 引擎任务调用。掉电持久性和首次格式化行为仍待接板验证。

## r13 / M2 ES8311 + ES7210 音频

- `lume.audio.play()` / `record()` 在 engine task 同步阻塞。数据为 16 kHz、16-bit、有符号小端、双声道交错裸 PCM；不解析 WAV 头，也不做重采样。1 秒为 64,000 字节。其他 `sampleRate/channels/bits` 返回 -1。
- `record()` 最多 10 秒，原生缓冲通过 `heap_caps_malloc(MALLOC_CAP_SPIRAM)` 分配；复制到 QuickJS ArrayBuffer 后释放。最多约 1.28 MB 的短时双份占用。无环形 DMA、后台 worker 或多实例。`stop()` 仅静音后续输出，不能从同一 JS task 中打断正在运行的同步播放。
- 官方 `07_ES8311.ino:54-55` 把 PA=GPIO46 设成输出高电平；板级 `pin_config.h:27` 也标为 GPIO46。IDF 5.5.5 的 `esp32s3/soc_caps.h:187-189` 明确将其列为可输出 GPIO。真实 PA 时序与扬声器效果仍留接板实证；配置失败时明确 WARN。
- 音频寄存器取自 Waveshare `examples/arduino/06_ES7210/es7210.cpp` 与 `07_ES8311/es8311.c`；仅实现示例中的 16 kHz 配置。ADC 示例用独立 I2S1 RX；DAC 示例用 I2S 标准模式。这里 I2S0 主机 TX 发共用时钟，I2S1 从机 RX 接同网时钟。真机需确认 GPIO matrix 共线输入、双声道排序及 PA 实际行为。

## r14 / M3 flex style bridge

- `View({style})` accepts `display:'flex'`, row/column flow and wrap, main-axis justification, cross-axis alignment, uniform `padding`, one `gap` value for both axes, radius, border width/color, opacity, and width/height in pixels or integer `0%`–`100%`. It maps these to fixed-size numeric bridge messages; only text uses the inline string field. `background` and `borderColor` use `#RRGGBB` strings; the old numeric `bg`/`background` path remains available.
- LVGL's flex layout computes positions. Its cross-axis align enum has no `stretch`, so the bridge sets an un-sized child's cross-axis size to `lv_pct(100)` when adopted by a stretch parent. Explicit child width/height wins. Changing stretch back to another alignment after adoption does not restore the child's implicit default size; dynamic style mutation is not part of the M3 prelude API.
- Padding is one value on all four sides, and gap is one value for rows and columns. There is no margin, grid, per-side padding, flex grow/shrink, reverse direction, or percentage sizing on properties other than width/height. Percentage size is relative to the parent's LVGL content area.
- `lume_demo_js` is the boot fallback and `examples/counter/app.js` is its source equivalent. Flex appearance, stretch sizing, and touch placement still require board visual acceptance.

## r15 M3 animation primitives

- `transition` applies to numeric `x`, `y`, pixel `width`/`height`, and `opacity`. A signal getter supplies the initial value via `SET_ATTR`; later changes send `ANIMATE` with omitted `from`, so the LVGL task samples the current value. `lume.anim.to` offers an optional `from` and completion callback; `lume.anim.cancel` stops one attribute. A new animation on the same node and attribute replaces its predecessor.
- `transition.property: 'bg'` is accepted for API shape, but reactive color updates are immediate `SET_ATTR` changes; color interpolation is unavailable. There are no keyframes, multistage timelines, or spring physics curves. Easing is limited to LVGL linear/ease-in/ease-out/ease-in-out. Duration is an integer from 1 to 60000 ms.
- Completion events share the 16-entry LVGL→engine event queue with presses. On overflow completion is logged and dropped; its JS callback will not run. Callback references are released on replacement, cancel, removal, or runtime recycle; a dropped completion remains registered until one of those events.
- The example's `y` movement uses LVGL object coordinates. Visual smoothness, flex interaction, and touch timing await board testing.

## r16 Canvas MVP

- Canvas uses vendored LVGL 9.3 `lv_canvas_create` and `lv_canvas_set_buffer` with RGB565 pixels allocated by `heap_caps_malloc(..., MALLOC_CAP_SPIRAM)`. Buffers are owned by the bridge and released after LVGL object deletion. A canvas is at most 480×480; all live canvases share a 460,800-byte budget. Actual allocation is `lv_draw_buf_width_to_stride(width, LV_COLOR_FORMAT_RGB565) × height`; for an even width this is `width × height × 2`. The 220×120 example uses 52,800 bytes; a 480×480 canvas uses 460,800 bytes (~450 KiB). This budget is in addition to the JS heap, display draw buffers, and app staging in PSRAM.
- `onDraw` is an owned signal effect. It runs at creation and once per changed signal value read in its previous run. Each call posts fixed-size raster commands through Queue A, followed by one `CANVAS_INVALIDATE`; the LVGL timer drains them in order. There is no per-frame callback. The chosen one-way queue avoids blocking LVGL on the engine task or sharing a mutable pixel pointer across tasks. Large polylines can spend multiple timer periods posting and are limited to 240 points; draws are not atomic against an intermediate LVGL refresh. The sample uses 12 points.
- Coordinates are integer canvas-local pixels; clipping occurs in the bridge. Colors are opaque RGB565. Text uses LVGL's default 14px font through a canvas draw layer and is limited to 63 UTF-8 bytes. `clear()` fills opaque black. Antialiased curves, path reuse, alpha blending, image blit, and dynamic canvas resizing are deferred.
- Signal callbacks and text draw cost have host/build validation only. Real-device rendering, timing, and visual quality remain for the board acceptance round.

## r17 App lifecycle / timers

- 单 app 实例。`onStart` 在 bundle eval 成功后触发；`PAUS`/`RESM` 四字节控制帧触发 pause/resume，重复帧幂等；`BACK` 四字节控制帧只在协议侧实现，触摸返回手势后续接入。`onBack` 任一回调返回严格的 `true` 即拦截；默认关闭当前 app 并启动内嵌 demo。尚无多 app 启动器。
- 20ms engine 队列等待是 timer tick 源，`esp_timer_get_time()` 仅用于单调时钟读数。回调在 engine task 的 drain 点执行；interval 漏过的周期只补一次，不追赶连发。pause 时 timer 停止派发，resume 后到期的 timer 最多触发一次；bundle 替换时全部清掉。
- `audio.record`/`audio.play` 与同步 HTTP 会阻塞 engine task，期间 timer、输入与热更新均延迟。后续可把这些操作迁到独立 worker，由定长消息桥回传完成事件，再在 engine drain 点派发 JS 回调。
- 热替换释放次序：旧 app `onPause` → 清生命周期回调 → 清 timer → 取消 native 动画 → dispose 所有 effect（含 Canvas onDraw）/press handler → 清 signal 队列与版本 → Queue A RESET 场景 → 释放旧 QuickJS runtime → 新 runtime/prelude/bundle eval → `onStart`。signal 对象的最终内存由 QuickJS runtime 释放。eval 失败会回退上个可用 bundle；`onStart` 回调抛错仅记录日志。

## r18 theme tokens

- `lume.theme.set()` replaces one flat theme snapshot. Named `colors` resolve only in `Style.background` and `Style.borderColor`; unknown names pass to the existing `#RRGGBB` parser and raise its error. Literal hex colors and numeric background values retain their prior behavior. Canvas drawing colors and text glyph colors do not use theme tokens. There is no nested theme inheritance or partial merge.
- The snapshot is held in a signal. Each named-color property has an owned effect and resends its ATTR when the theme changes; disposal removes its subscription. Theme changes may resend an unchanged named color. Literal properties stay quiet. An omitted `borderRadius` follows the theme's default `radius`; clearing that default sends radius 0. An explicitly set `borderRadius` stays fixed.
- `fontScale` is validated and stored, but text font size remains LVGL's fixed default because Style has no `fontSize` property in this round. Theme changes are JS/Queue A events; on-board colors and visual timing still need device acceptance.

## r19 scroll / virtual List

- `View({style:{scroll:'vertical'|'horizontal', scrollbar:'off'|'auto'|'on'}})` uses LVGL's built-in scroll physics. The default scrollbar mode is LVGL auto. Momentum, elasticity, snap, friction and scrollbar styling are not exposed. Scroll offset callbacks report vertical pixels; horizontal scrolling is visual only in this round.
- `List` requires an integer pixel `style.height` and a positive fixed integer `itemHeight`. Each visible row must fit that height; dynamic row heights and variable-height measurement are deferred. The viewport window extends by `overscan` items above and below (default 3, maximum 20). The spacer has `items.length × itemHeight` height. `renderItem` must return one root Node; any children count toward the 127-node table cap.
- `items` may be an array, signal reader or getter returning an array. Publishing a new array rebuilds the visible rows. If its length is unchanged, the current offset is kept; if the length changes, the List posts a nonanimated scroll-to-top. Mutating an array in place does not notify signals; publish a new array. A scroll window change removes outgoing rows and waits for LVGL removal acknowledgements before allocating replacement nodes, so fast jumps may show a brief blank window until the next 20ms engine tick.
- Native scroll events are capped at one per 25ms, and sent after at least 12px of displacement or 40ms since the last sent event; `LV_EVENT_SCROLL_END` always sends a final offset. The shared 16-entry reverse queue drops a full-queue event and increments/logs the existing drop counter. If a final event itself is dropped, the List may stay on its last delivered window until a subsequent scroll event. The bridge never calls JS from LVGL task.
- Node IDs are reused only after LVGL's subtree removal notice reaches the engine task. This bounds IDs over long scrolling sessions. `List` still shares the global 127-node cap with the rest of the app; a deeply nested `renderItem` or very large viewport/overscan can exhaust it. Resource use is proportional to visible rows plus overscan, not `items.length`, assuming bounded row trees. Device drag feel, momentum and memory behavior await the board round.

## r20 / light sleep power management

- `sleepNow()` rejects every started WiFi station with `-1`, including the disconnected station started by the engine at boot. Apps that own WiFi must explicitly call `lume.net.deinit()` before sleeping; `examples/power_demo` does this. No implicit disconnection or reconnection occurs.
- GPIO11 is polled by LVGL in the current board driver (`lume_touch.c:226-230`, `GPIO_INTR_DISABLE`), despite the earlier brief's interrupt premise. The vendor CST9217 driver selects a falling edge for `levels.interrupt = 0`; the board BSP sets that value (`Waveshare-ESP32-components/display/touch/esp_lcd_touch_cst9217/esp_lcd_touch_cst9217.c:75-85`, `bsp/esp32_s3_touch_amoled_2_16/esp32_s3_touch_amoled_2_16.c:481-485`). Sleep uses an ext0 low-level wake; preexisting low INT returns `-2`. After wake the pad is returned from RTC IO to digital input before LVGL resumes. The controller's INT pulse width and behavior during ESP light sleep have no confirmed vendor guarantee, so reliability needs board measurement.
- `wake()` is idempotent when JS is running. The same JS task is blocked inside `esp_light_sleep_start()` and cannot invoke JS to wake itself; touch on GPIO11 is the actual sleep wake source. `onWake` runs after panel sleep-out and full-redraw scheduling, on the engine task. No periodic deep-sleep wake or RTC restart mode is implemented.
- `CONFIG_PM_SLP_SPIRAM_HALFSLEEP_ENABLED=y` and `CONFIG_SPIRAM_XIP_FROM_PSRAM=n` are set. ESP-IDF `sleep_modes.c:989-996` waits for PSRAM to resume before returning to flash/PSRAM code. Actual heap retention on this board, sleep current, wake latency, and touch wake reliability remain unmeasured. If retention fails on hardware, the current light-sleep path must not be accepted; a deep-sleep/restart design requires a separate decision.

## r21 / M3 Gesture layer (tap / swipe / longpress / pan)

- **Architecture choice (trade-off, empirically evaluated)**: gestures reuse LVGL for the hard embedded parts — per-target hit-testing and object events (`LV_EVENT_PRESSED/PRESSING/RELEASED/GESTURE`, `lume_ui_bridge.c:648-702`), absolute coordinates (`lv_indev_get_point`, `lv_indev.c:471-485`), the monotonic tick (`lv_tick_get`), swipe direction (`lv_indev_get_gesture_dir`, `lv_indev.c:487-490`) and scroll arbitration (`lv_indev_get_scroll_obj`, `lv_indev.c:514-519`). Recognition of tap/longpress/swipe/pan is a **PURE JS state machine** (`__gestureStep`, `lume_scripts.c:679-734`) fed a normalized DOWN/MOVE/UP/SWIPEDIR stream over the same reverse queue (Queue B) as onPress. We deliberately did NOT reuse LVGL's own recognizers (`LV_EVENT_SHORT_CLICKED/LONG_PRESSED/CLICKED/GESTURE` as final decisions) because (a) `LV_EVENT_GESTURE` fires mid-drag with no release velocity, no dx/dy (`lv_indev.c:1700-1748`), (b) LVGL long-press timing is fixed in C and not tunable/testable from JS, (c) a single pure JS core centralizes all thresholds and makes the six events mutually consistent and fully host-harness testable without an LVGL indev build. Cost: a few KB of flash for the JS source string + a thin native pointer-stream forwarder; **no new IRAM symbols** (size verified IRAM 16384/16384). All JS lives in flash-mapped rodata, all new native C in flash `.text`.
- **Thresholds start from vendored LVGL defaults** and are centralized/tunable in one place (`GESTURE` / `lume.gesture.tuning`, `lume_scripts.c:656-663`): `tapMovePx=10` = `LV_INDEV_DEF_SCROLL_LIMIT` (`lv_indev.c:32`), `tapMaxMs=longpressMs=400` = `LV_INDEV_DEF_LONG_PRESS_TIME` (`lv_indev.c:39`), `panMinPx=12` (just above scroll_limit so a scroll's first frame cannot start a pan), `swipeMinPx=50` = `LV_INDEV_DEF_GESTURE_LIMIT` (`lv_indev.c:46`), `swipeMinVel≈0.1 px/ms` ≈ `LV_INDEV_DEF_GESTURE_MIN_VELOCITY` 3px/read (`lv_indev.c:49`). Defaults are applied in `lv_indev_create` (`lv_indev.c:138-143`). `LV_INDEV_DEF_LONG_PRESS_REP_TIME=100` (`lv_indev.c:43`) is not wired (no repeat-longpress event).
- **LVGL exposes no swipe speed/velocity threshold** to callers. Our `swipeMinVel` is effectively bounded by `longpressMs`: any ≥50px move completed within 400ms already exceeds 0.1 px/ms, so the real "quick" gate is the 400ms long-press bound; a hold ≥400ms is consumed as a longpress. `swipeMinVel` remains a tunable knob (verified by the harness). `LV_EVENT_LONG_PRESSED_REPEAT` and pinch/rotate/multi-touch are unsupported: the project compiles `LV_USE_GESTURE_RECOGNITION=0` (`lv_conf_internal.h:1501`) and the CST9220 is a single-touch controller, so pinch and multi-touch are out of scope.
- **Swipe vs pan overlap**: one large drag can emit BOTH the pan stream (`panstart/pan/panend`) AND a `swipe` on release; they are two interpretations of the same motion and the app subscribes to whichever type it wants (the demo's swipe cell listens only to `swipe`). `tap`, `longpress` and `swipe` are mutually exclusive; `pan` is a continuous stream.
- **longpress / onPress non-double-trigger**: a press lasting ≥`longpressMs` sets a per-node consumed latch (`lume_scripts.c:764-773`); on release no `tap` or `swipe` is emitted, and the CLICKED→onPress path is suppressed (`__lume_dispatchPress`, `lume_scripts.c:736-740`). A short tap still fires both the gesture `tap` and any legacy `onPress`. LVGL itself sends `CLICKED` regardless of long press (`lv_indev.c:1458`); its `SHORT_CLICKED` is gated on `long_pr_sent==0` (`lv_indev.c:1455`) — we reproduce that mutual exclusion in the JS core instead of depending on CLICKED. **r21 review fix (movement gate)**: the longpress clock only runs while the press is essentially stationary — displacement from DOWN past `panMinPx` marks the press as a drag, which can never fire `longpress` (neither mid-press nor on release) and stays swipe-eligible; a slow drag held past 400ms yields the pan stream, never a stolen longpress (`lume_scripts.c` `__gestureStep` `dragged` gate, harness cases `r21-fix: a SLOW drag...`).
- **List scroll coexistence**: LVGL commits a drag to scrolling by setting `indev->pointer.scroll_obj` (only when there is scroll range and `|scroll_sum| > scroll_limit`, `lv_indev_scroll.c:392-414`) and then suppresses its own `GESTURE`/`LONG_PRESSED`/`CLICKED` (`lv_indev.c:1702 / 1352 / 1453`). We extend the same rule to the PRESSING stream with TWO gates (`lume_ui_bridge.c` `gesture_obj_cb`): (a) while `scroll_obj != NULL`, no MOVE is emitted (post-commit rule, unchanged); (b) **r21 review fix (pre-commit latch)**: `LV_EVENT_PRESSING` is sent BEFORE `lv_indev_scroll_handler` inside the same indev read (`lv_indev.c:1332` vs `:1339`), so on the commit frame `scroll_obj` is still NULL and the first naive version leaked exactly that MOVE — enough to start a `pan` before cancellation. Now at DOWN we scan the pressed object's ancestor chain for live scroll candidates (scrollable + direction enabled + content beyond an edge, mirroring `lv_indev_find_scroll_obj`, `lv_indev_scroll.c:267-...`), and latch SCROLLED as soon as the cumulative per-read vect on a candidate axis exceeds `LV_INDEV_DEF_SCROLL_LIMIT` (10px, same accumulation as LVGL's `scroll_sum += vect`, `lv_indev_scroll.c:285-286`). Because the latch fires at 10px and pan needs >12px cumulative displacement, a scrollable container can never start a pan; drags on an axis with no scroll candidate (e.g. horizontal pan over a vertical List) still pan freely. **Gesture targets must be non-scrollable** (`style.scroll:'none'`): `lv_obj_create` Views are SCROLLABLE by default (`lv_obj.c:500`); the demo sets `scroll:'none'` on every card and the root.
- **Per-target routing relies on LVGL hit-testing, not bubbling**: object events only bubble to parents with `LV_OBJ_FLAG_EVENT_BUBBLE` (`lv_obj_event.c:398`), which we do not set. Non-clickable children (labels, `lv_label.c:735`) are skipped by hit-testing (`lv_indev_search_obj`, `lv_indev.c:585-...`), so a press anywhere on a card View — including on its Text children — is delivered to the card itself. A *clickable* child (e.g. a nested `Button`) captures the press itself and the parent's gesture will not fire (same limitation as the existing `onPress`). Pressing outside a gesture target produces no gesture events.
- **Coordinates** are absolute screen pixels from `lv_indev_get_point` (already mirror/swap-transformed by `lume_touch.c`); `dx/dy` are displacement from the press start; `dir` is LVGL's `lv_dir_t` bitmask (`lv_area.h:78-85`) mapped to `'left'|'right'|'up'|'down'`, falling back to the dominant axis when LVGL fired no `GESTURE`.
- **Queue pressure / drops (r21 review fix)**: `LV_EVENT_PRESSING` repeats every indev read (~33ms, `lv_indev.c:1332`), so a held finger posts a MOVE per read through the shared 16-entry Queue B. On a full queue a MOVE is now dropped FIRST (lossy by design — the state machine re-evaluates thresholds on the next sample), while non-MOVE gesture inputs (DOWN/UP/SWIPEDIR) post via `xQueueSendToFront` so a MOVE burst can neither evict nor delay a release; a stalled engine can therefore no longer lose tap/swipe/panend because of PRESSING traffic (`lume_engine.c` `lume_engine_post_gesture`). The engine drains one event per loop iteration with a 20ms idle wait, so normal drags keep up; a dropped MOVE only degrades pan sample density for that frame.
- **Verification scope**: `idf.py build` + `idf.py size` (IRAM 16384/16384 unchanged) + 24-case host harness (`tests/gestures.js`, pure state machine + integration + example, incl. 3 `r21-fix` regression cases for the Codex review findings) + all pre-existing host harnesses are green. **Real-device feel, threshold comfort, and the actual on-board tap/swipe/pan vs List-scroll conflict are NOT verified** (no board); acceptance is deferred to the main controller's board round, the M3 code item is checked in r22 while board acceptance stays pending.

## r22 Image

- `Image({src:ArrayBuffer,style})` accepts PNG and JPEG bytes from JS, with `sizeOf` reading PNG IHDR or JPEG SOF without decompression. Invalid argument/over 480×480 is `-1`, corrupt/unsupported data or decoder failure `-2`, PSRAM or queue exhaustion `-3`. Progressive JPEG can have a valid SOF but fail tjpgd decode with `-2`.
- The bridge stores one PSRAM image buffer per live Image node, frees it after LVGL object deletion, and drops its LVGL cache entry. RGB565 uses `w×h×2` bytes (480²×2 = 460,800 B, about 450 KiB); PNG first allocates RGB565A8 `w×h×3` (691,200 B max) and uses it for any transparency. Opaque PNG keeps the 3-byte allocation but exposes RGB565 to LVGL. PNG decode also needs a temporary `w×h×4` RGBA allocation (921,600 B max), in addition to the encoded JS ArrayBuffer and decoder scratch; the true peak therefore exceeds the 450 KiB retained RGB565 figure. Multiple live images have no shared aggregate cap; PSRAM exhaustion returns `-3` when detected.
- `LV_IMAGE_ALIGN_CONTAIN` scales proportionally to the Image widget box. Without style dimensions the box uses intrinsic pixels. One numeric dimension derives the other in JS; two supplied dimensions define a box and may letterbox. Percent or signal dimensions are passed to existing style mapping and the LVGL contain behavior applies. Scaling quality and transparency blending await board inspection.
- Vendored LVGL 9.3.0 lodepng and tjpgd are enabled in `lv_conf.h`. The native decoder calls their proven raw APIs on the engine task and converts into the display format; the LVGL image decoder registration is present but external file loading is not used. No vendored decoder source was modified. JPEG uses the vendored `JD_FORMAT=0` RGB888 blocks, then converts them to RGB565. PNG accepts lodepng's supported color types and preserves per-pixel alpha; animated PNG, GIF, and WebP are outside this API.
- `Fs.readBinary` retains its 64 KiB single-read limit; gallery assets on TF must fit it. `httpGet(...,{responseType:'arraybuffer'})` has its own configured response limit.

## r24 Host Simulator L1

- Browser CSS and Canvas replay the prelude's wire messages but are not LVGL. Fonts, default widget style, antialiasing, flex sizing, scroll momentum and rendering time can differ. RGB565 on the device quantizes colors; the browser's 2D canvas draws full RGB888. Canvas `clear` uses its encoded color (black from the prelude), as in `lume_ui_bridge.c`; circle and line antialiasing are browser approximations of the bridge's pixel rasterizer. Simulator frame rate does not represent device frame rate.
- Click sends `onPress` through `__lume_dispatchPress`. Scroll offset reaches `__lume_dispatchScroll`, but browser touch injection does not yet reproduce native pan/swipe/longpress timing or hit testing. There is no multitouch or device performance simulation.
- Images display a gray size placeholder; image decoding and LVGL contain scaling are deferred. Host `Fs` serves in-memory sample entries, not a mounted TF card. The host does not simulate IMU, battery changes, power, audio, network, or persistent storage.
- File watching covers the selected `app.js` only. The simulator evaluates the app as a global script; it does not bundle imported modules. The generated `npm run sim` points at the simulator in the checkout used to create it, so moving or removing that checkout requires recreating or updating the script.
- Counter, files, and watch_launcher DOM assertions and screenshots are in `artifacts/simulator`. Hardware visual acceptance remains for the board round.

## r23 / M4 CLI first slice

- `tools/lume` sends esbuild IIFE JavaScript source over the existing USB Serial/JTAG protocol. There is no on-device bytecode compiler or WiFi OTA path in this slice. The embedded demo remains the boot fallback and a failed eval restores the last good app.
- `dev` polls the project tree every 500 ms for changes, watches one app and one USB device, and has no automatic serial reconnection. Files outside the app directory, including linked packages, are not watched. Rebuild failures leave the previous app running.
- Auto-detection selects a unique Espressif USB serial port; multiple ports require `--port`. It does not identify a particular board among several matching devices. A disconnect or missing ACK surfaces as an error; reconnect and rerun `dev`.
- The scaffold uses global prelude APIs and plain JavaScript. The `tsconfig.json` supports editor checking without a TypeScript build step. Bare `lume` / `lume/ui` npm imports are not yet supplied as packages. JSX/TSX transforms, full type declarations, and WiFi OTA remain later M4 work.
- Host tests cover bundle generation, global-script IIFE behavior, frame bytes, and CLI failure paths. Real-device push latency, log interleaving, control keys, and changed JS appearing on screen await the board round.

## r26 / M4 CI 固件发布 + WiFi OTA 通道

本轮补上 M4 收官两块：CI 固件发布（`.github/workflows/firmware.yml`）与 WiFi OTA
推包通道（`lume-hotreload` 扩展 + `tools/lume` CLI）。**真机 WiFi 推包实测留接板轮**，
本轮验收 = 编译绿 + size 达标 + host harness + CLI 无板报错路径 + ESP-IDF / Actions
文档实证。以下按 M4 口径从简：

- **安全边界：token 明文 + LAN 信任模型**。鉴权 token（16 字节随机 → 32 hex）经 TCP
  `AUTH <token>\n` **明文**传输，且**每次启动打 `ESP_LOGI` 日志**（CLI 需要用户从串口
  日志复制）。无任何加密/传输保护，仅适用于可信局域网：能嗅探 LAN 或读串口日志者即可
  推包。**公网 / 不可信网络必须加 TLS**：后续路径为在 OTA TCP server 上挂 `esp_tls` /
  mbedTLS 服务端证书（或改走 HTTPS/WS 隧道）+ 关闭日志打印 token、改为带外分发；
  本轮不做。也不做防重放、auth 失败速率限制、token 轮换/撤销（NVS 里只有一个固定
  token）。
- **完整性 only：CRC-32，无签名**。帧协议复用 USB 同款（`LUME` | u32le len |
  u32le crc32 | payload + BACK/PAUS/RESM），CRC-32 只防传输比特错误，**不防篡改**：
  持有 token 的对端可任意构造合法 CRC 的 bundle。后续路径：**ed25519 签名**（固件内置
  公钥、CLI 私钥签名、帧内增签名字段或独立签名帧）+ 版本号/单调计数防重放；本轮协议
  字段**刻意不改**（与 r23 USB 通道逐字段对称），登记为后续刀。
- **token 不硬编码、NVS 持久化 + 降级**。首次启动 `esp_fill_random()` 生成、存 NVS
  （`lume_ota`/`token`）、后续启动沿用；每次启动都打印当前 token。NVS 不可用（分区缺失
  / 初始化失败）时**非 fatal**：退化为本次启动的临时 token，OTA 仍可用、重启后变化。
  可用性优先于持久性的取舍。
- **单结果回调 + 跨通道应答路由**。引擎只有**一个** `lume_engine_set_reload_result_cb()`，
  USB 与 OTA 共用它，靠 `lume_hotreload.c` 里有界（16）的 pending-sink FIFO + 递归互斥
  锁把 `RELOAD OK/ERR` 送回发起帧的通道；staging 槽仍是单槽 last-wins，被覆盖帧收到
  `superseded`。代价：**客户端必须保持 TCP 连接直到收到自己那帧的 `RELOAD` 应答**
  （CLI 正是如此）；若发完帧立刻断开，结果回调可能写到已关闭/被复用的 fd。并发跨通道
  推包不保证逐帧隔离，登记为已知简化。
- **OTA server 单客户端、无帧超时（沿用 USB）**。`select` 1s 轮询 + 单 `accept`，一次
  只服务一个连接；客户端 socket 设 5s 收发超时防挂死。`lume_frame` 解析器沿用 M1 的
  「只对 `LUME` magic 重同步、无整体/字节间超时」；半帧停发会一直等。帧仍走现有热替换
  链（r17 生命周期释放 → eval 新 bundle），无独立编译管线。
- **WiFi 门控 = GOT_IP 才 bind**。OTA 任务每秒用 `lume_net_has_ip()`（自旋锁保护、任意
  任务可调）判断；只有 station 拿到 IPv4 才 `bind/listen`，掉线即 `close`、`connect`
  后自启。不做 AP 模式配网、不做断线自动重连（沿用 r11 不搬官方 retry 逻辑）。
- **`lume.net.otaStatus()`（可选，已实现）**。返回 `{running, wifiReady, tokenReady,
  port, token}` 的**本地快照**（registered provider 函数指针，避免 lume-engine →
  lume-hotreload 组件依赖环）。它不探测网络、不代表对端可达；token 字段等于日志里的
  明文 token，调用方可在 UI 显示。
- **端口可配**：`CONFIG_LUME_OTA_PORT`（Kconfig，默认 8765），CLI `--ota-port` 对应。
  本轮不做运行时改端口 / 多监听。
- **CI 发布取舍**。`espressif/esp-idf-ci-action@v1` 起官方 `espressif/idf:v5.5.5`
  Docker 镜像（已实证该 tag active）；`command` 默认 `idf.py build`，`path: firmware`
  使产物落在 `firmware/build/`。**flash_args 路径修正**：IDF 的 `flash_args` 用
  `bootloader/bootloader.bin` 等 build 相对子目录路径，而收集步骤把三 bin 拍平到
  `dist/` 根；本轮把 offset 行改写成 basename（保留 option 行），使
  `write_flash @flash_args` 对 artifact 与扁平 Release 资产都成立。版本策略：push →
  仅 artifact（`lume-firmware-<run_number>`）、`vX.Y.Z` tag → 追加 Release、
  手动 `workflow_dispatch` 可用；依 GitHub Actions 文档「Path filters are not evaluated
  for pushes of tags」，`branches`+`paths` 与 `tags` 可在同一 `push` 下共存。**CI 只跑
  构建 + 收集**，不跑 host harness / CLI 单测（宿主机任务，由本地验证）。
- **无板不验证项（接板后由主控轮实测）**：① 真机连 WiFi 拿 IP 后 OTA server 是否如期
  bind；② 真机 `lume deploy --ota` 推包 → 热替换链端到端；③ 真机 token 鉴权 AUTH
  OK/ERR；④ 关闭 WiFi IRAM 优化后的 TCP 吞吐与实际推包延迟；⑤ 掉线/重连 server 自启
  时序；⑥ 串口日志里 token 与 boot log 交错的可读性；⑦ NVS 掉电后 token 持久性。
  真机一律留接板验收。
- **roadmap 不勾选**：M4「WiFi OTA」**保持未勾选**，等主控接板实测通过再勾（与
  r7~r11 处理一致）。
## r25 / BLE peripheral first slice (lume.ble)

- **角色与范围**：仓库此前没有任何 BLE 设计（只有 `docs/hardware-api.md` 的一句 design-only 占位），本轮自选最小可用形态 = **NimBLE GATT 外设 / server**，挂在独立的 `lume.ble` 命名空间（不改 `lume.net`）。一个 128-bit Nordic UART Service (NUS) 形状的 service：RX 特征 `WRITE | WRITE_NO_RSP`、TX 特征 `NOTIFY`，这样手机通用 BLE 调试 App 可以直接连。只做 peripheral / 单连接：不做 central、扫描/observer、多连接、配对/bonding、加密、MITM、GATT 客户端发现，也不做 BLE 配网。无鉴权链路仅适用于可信本地调试，不能用于承载敏感数据。
- **20 字节上限**：单包 `LUME_BLE_PAYLOAD_MAX = 20`（默认 ATT_MTU 23 减去 3 字节 ATT 头），不做 MTU 协商、不做分片；`status().mtu` 只上报 `BLE_GAP_EVENT_MTU`，不改变上限。RX 超长写由 `ble_hs_mbuf_to_flat()` 拒绝并回 ATT 错误（不静默截断）；`write()` 超长或含内嵌 NUL 返回 `-1`。JS 侧只有 UTF-8 文本（`string`），没有 `ArrayBuffer` / `readBinary` 形式；非文本或大块数据留后续轮。
- **轮询而非 JS 回调**：本轮不提供 `onData(cb)`。GAP/GATT 回调只跑在 NimBLE host 任务，绝不进 QuickJS；接收数据进 8 槽 FIFO（满时丢**最旧**包），app 用 `lume.system.setInterval()` 调 `read()` 拉取，与 `examples/imu_poll` / `lume.imu.read()` 同构。代价是 100ms 级延迟与可能的丢包；事件式回调需要反向队列 + engine drain 派发点，留后续轮。
- **懒初始化、无 deinit、热重载**：`register_bindings()` 只挂函数，**不**调用 `lume_ble_init()`；首次 `start()` / `init()` 才开 `nimble_port_init()` + host task + 广播，不用蓝牙的 app 不启动射频。栈与 controller 进程生命周期常驻，**没有 `deinit()`**：`stop()` 只停广播并断开连接。`prelude` 的 `__lume_shutdown()` 只会 `lume.net.deinit()`，与本模块无关；`lume.power.sleepNow()` 也**没有**接 BLE 状态检查，app 必须在 `onPause` / 睡眠前自己 `stop()`，否则广播会抬高低功耗电流。`tests/lib/prelude_runner.js` 的 host stub 与浏览器模拟器只模拟 `lume.ble`，无射频。
- **线程假设（待真机验证）**：GAP/GATT 调用从 engine 任务发出（由 NimBLE host 内部锁串行化），事件回到 host 任务；共享状态用 `portMUX_TYPE` 临界区保护，临界区内只写标志/拷贝 ≤20 字节。`ble_gatts_notify_custom()` 的 `os_mbuf` 所有权按 IDF bleprph 示例约定交给协议栈（成功/失败均不手动释放）；若目标 IDF 版本行为不同，可能出现泄漏或重复释放，需接板后用 heap 追踪确认。
- **构建配置与体积（已在本机实测）**：`firmware/sdkconfig.defaults` 追加 `CONFIG_BT_ENABLED=y` / `CONFIG_BT_BLUEDROID_ENABLED=n` / `CONFIG_BT_NIMBLE_ENABLED=y` / `CONFIG_BT_NIMBLE_MAX_CONNECTIONS=1`；4 个符号经「删除 sdkconfig 后从零 `idf.py reconfigure`」验证有效（唯一 Kconfig 警告是仓库原有的 `LV_COLOR_DEPTH_16`）。`firmware/sdkconfig` 用 ESP-IDF v5.5.5 `idf.py` 重新生成（diff 集中在 Bluetooth 段与 `CONFIG_SW_COEXIST_ENABLE=y` 等共存项），保证 clone 后直接 `idf.py build` 就是开箱可编译的。`idf.py build` + `idf.py size` 实测：**IRAM 16384/16384（100% 满但没有溢出，`libbt.a` 占 1052）**、DIRAM 227975（余 113785）、Flash Code 1657930、Flash Data 377388、Total image 2183301 字节、app 分区余 67%。相对 docs/r11 记录值约 Flash Code +259040 / DIRAM +38452 / IRAM +0 / Total +373176，主要来自首次链接 BT controller/host（`libbt.a` 102242、`libbtdm_app.a` 87869、`libbtbb.a` 3467；`liblume-ble.a` 自身仅 2859）。**IRAM 0 字节剩余是脆弱边界**，后续任何新增 IRAM 符号都可能溢出，需持续盯 `idf.py size`。
- **sdkconfig 默认角色与 SMP 仍编译进库**：重新生成的配置里 `BT_NIMBLE_ROLE_CENTRAL/OBSERVER/GATT_CLIENT/SECURITY_ENABLE/SM_LEGACY/SM_SC` 等仍为 `y`（IDF 默认值），`BT_NIMBLE_ATT_PREFERRED_MTU=256`。与 r11 对 WiFi WPA3/softAP 的处理一致：编译进库但 JS 层不暴露、不使用；`ble_hs_cfg.sm_bonding` 保持 0，本轮不触发配对。JS 层仍固定 20 字节上限，不利用大 MTU。要压 Flash 可后续裁剪这些角色，本轮不动板厂已验证的配置面。
- **验证范围**：主机侧 `tests/ble.js`（接线一致性 + 示例 app 在注入 stub 下的行为）、10 个既有 harness 全绿、`npm test --prefix tools/lume` 4/4、`python3 scripts/check_website.py`（新增 6 条 `lume.ble` 目录已同步；仍报 4 条仓库原有的 `lume.ui.shell.*` 缺失，与本轮无关）、`lume_ble.h` C11 语法/静态断言、既有 `tests/bridge_protocol.c` ABI 断言，以及 **ESP-IDF v5.5.5 完整 `idf.py build`（链接通过）+ `idf.py size`**。首轮编译只发现并修正了 `nimble_port_freertos_init()` 返回 `void` 的一处误用。**没有开发板**，所有射频行为仍未验收。
- **无板验收项**：① 手机能否发现/连接、GATT service 与 RX/TX 特征发现；② 订阅 notify、20 字节收发与 FIFO 丢弃行为；③ 断开后自动重新广播；④ `start()` 在 host sync 前后的时序；⑤ WiFi 与 BLE 同时开启的吞吐/稳定性（Flash/IRAM/DIRAM 体积已实测，不在此列）；⑥ 蓝牙对 light sleep 电流的影响；⑦ 无配对链路的安全边界。
- **roadmap 不动**：`docs/roadmap.md` 的里程碑定义不因本轮修改，也没有为 BLE 新增/勾选里程碑；真机验收留主控接板轮，与 r11/r13 的处理一致。

## r27 / 首次真机 bring-up：LVGL 9 tick 缺失（已修）

- **现象（真机 Waveshare ESP32-S3-Touch-AMOLED-2.16，MAC `28:84:85:90:7e:64`，chip rev v0.2 / 8MB PSRAM）**：刷入 0.1.0 release 包后板级初始化全绿（AXP2101 `0x4a`、CO5300 QSPI 480x480、CST9220 480x480、QMI8658、LittleFS、NVS KV、WiFi station、hot-reload、OTA token），但应用永远进不去：屏幕无内容，`lume-engine` 每 ~350 ms 重启一次。

  ```
  I (2470) lume-engine: runtime up; eval embedded/last-good app (1575 bytes)
  E (2726) lume-ui-bridge: post: ui queue full after 8 attempts (op=1 id=4)
  E (2730) lume-engine: JS exception [<lume-app>]: InternalError: lume: ui queue full
  E (2735) lume-engine: embedded/last-good app eval failed (unexpected)
  ```

- **根因**：`firmware/components/lvgl/lv_conf.h` 仍按 LVGL **v8** 写 `LV_TICK_CUSTOM` / `LV_TICK_CUSTOM_INCLUDE` / `LV_TICK_CUSTOM_SYS_TIME_EXPR`。vendored LVGL 是 **9.3.0**，v9 已移除这三个宏，配置被静默忽略；`lume-board` 里也没有任何 `lv_tick_set_cb()` / `lv_tick_inc()` 调用，于是 `lv_tick_get()` 恒为 0。`lv_timer_handler()` 中所有 timer 都"未到期"：display refresh timer 不刷屏（所以日志里连一条 `QSPI flush failed` 都没有，PSRAM draw buffer / QSPI DMA 从未被调用），ui-bridge 的 5 ms drain timer 也不执行 —— 队列 32 条塞满后 JS 侧 post（8 次 × 2 ms 重试）必然失败。
- **修复**：`lume_board_init()` 在 `lv_init()` 之后注册 tick 源 `lv_tick_set_cb(lvgl_tick_get_cb)`，回调返回 `esp_timer_get_time() / 1000`（1 ms 单调时钟）；`lv_conf.h` 中三行失效宏替换为说明性注释，避免后人再按 v8 方式配置。改动文件只有 `firmware/components/lume-board/lume_board.c` 和 `firmware/components/lvgl/lv_conf.h`。
- **真机验证（ESP-IDF v5.5.5 全量构建 → esptool 刷写 → `Hash of data verified`）**：

  ```
  I (2511) lume-engine: runtime up; eval embedded/last-good app (1575 bytes)
  I (2754) lume-ui-bridge: create id=3 kind=2 parent=0
  I (2794) lume-engine: app eval ok; entering event loop
  I (6835) lume-ui-bridge: LVGL CLICKED id=3 -> post to engine queue
  I (6837) lume-engine: engine recv PRESS id=3
  ```

  连续 6 s 采样：`E (` 开头日志 **0 条**、`ui queue full` **0 次**、`runtime up` 不再重复（无重启循环）；触摸 raw→panel 坐标映射与 PRESS 回传到 JS 事件循环的链路打通。
- **仍未验收**：画面观感（颜色/朝向/亮度）、触摸手感与 tap/swipe/longpress/pan 识别、帧率与撕裂、PSRAM draw buffer 下 QSPI DMA 的长期稳定性、音频、WiFi/OTA、BLE、light sleep 电流。本次只证明"LVGL 渲染 + ui-bridge 排空 + 触摸事件"这条最小闭环在真机上跑通，不代表整机验收通过。

## r28 / 真机渲染性能实测（LVGL perf monitor）

- **背景**：真机上切 dark/light 主题时肉眼可见掉帧。分析指向整屏重绘（480x480 RGB565 = 460800 B），但需要客观数据确认瓶颈在渲染还是传输，因此临时启用 LVGL sysmon perf monitor（`LV_USE_SYSMON` + `LV_USE_PERF_MONITOR` + `LV_USE_PERF_MONITOR_LOG_MODE`），日志经 `lv_log_register_print_cb` 转发到 `ESP_LOGI("lvgl-perf")`，并补 `LV_SYSMON_GET_IDLE` 桩（`LV_USE_OS 0` 没有 idle 统计，CPU 列恒为 100%，不可用）。
- **测量方法**：压测 app 每 2 s 自动 `lume.theme.set()` 切换一次主题（与 `examples/counter` 相同的 7 个节点），串口连续采样 24 s，取 12 个"发生重绘"的 300 ms 窗口。
- **结果（12 次全部一致，非单次抖动）**：

  ```
  sysmon: 23 FPS (refr_cnt: 7 | redraw_cnt: 1), refr 9ms (render 39ms | flush 29ms), CPU 100%
  sysmon: 20 FPS (refr_cnt: 7 | redraw_cnt: 1), refr 9ms (render 40ms | flush 28ms), CPU 100%
  ```

  | 指标 | 空闲（无重绘） | 切主题（整屏重绘） |
  |---|---|---|
  | FPS | 22–26 | 20 |
  | render | 0 | **39–40 ms** |
  | flush | 0 | **28–29 ms** |
  | 合计 | – | **~68 ms**（帧预算 33 ms 的约 2 倍） |

- **结论**：掉帧不是 bug，是当前管线的真实上限。flush 29 ms 对应 460800 B / 29 ms ≈ **15.9 MB/s**，已贴近 40 MHz QSPI × 4 线（理论 20 MB/s）的实用带宽；render 39 ms 是 160 MHz CPU + PSRAM draw buffer 下 480×480 软件渲染的开销。另外**空闲上限只有 22–26 FPS**（不是 30），因为 `lvgl_task` 是 `lv_timer_handler()` + `vTaskDelay(10ms)` 的轮询循环叠加 33 ms 刷新周期。
- **可选优化（按预期收益排序，均未实施）**：① draw buffer 从 PSRAM 挪到内部 SRAM（render 预计降到 20–25 ms，代价是内部 RAM）；② QSPI 40 → 80 MHz（flush 预计减半到 ~15 ms，需先确认 CO5300 与走线能否稳定）；③ `CONFIG_ESP_DEFAULT_CPU_FREQ_MHZ` 160 → 240（render 再快约 20–30%，功耗上升）。三项全做可把整屏重绘压到 ~30 ms 以内。
- **副作用（已验证）**：perf monitor 每 300 ms 一条日志会把 USB-Serial/JTAG 控制台塞满，`RELOAD OK` ACK 被挤掉，`lume deploy` 会报 `did not ACK reload within 15000 ms` 但包其实已经生效。因此该开关**默认关闭**（`lv_conf.h` 中 `LV_USE_SYSMON 0`），`lume_board.c` 里的回调与桩用 `#if LV_USE_SYSMON` 保护；需要复测时把 `lv_conf.h` 里 `LV_USE_SYSMON` / `LV_USE_PERF_MONITOR` / `LV_USE_PERF_MONITOR_LOG_MODE` / `LV_USE_LOG` 改回 1 即可。
- **另一条独立的 deploy 超时路径**：perf 关闭时也复现过——只要 `lume deploy` 紧跟在另一个进程刚关闭串口（例如用 `pyserial` 抓完启动日志）之后，第一次会超时，**原样重试即成功**（`Deployed 1040 bytes`）。所以 ACK 丢失有两个来源：控制台日志占满 CDC，以及端口重开后的时序，后者与 perf monitor 无关，重试即可。
- **roadmap 不动**：本轮只做测量与开关，没有为性能新增里程碑，`docs/roadmap.md` 未修改。

## r29 / 整屏刷新"线条扫过"：draw buffer 改内部 SRAM + CPU 240 MHz

- **问题**：真机上整屏变色（dark/light 主题切换）能看到一条刷新线从上往下扫。r28 实测该次重绘 `render 39 ms + flush 29 ms ≈ 68 ms`。
- **对照 esp-brookesia（同板 `waveshare/esp32_s3_touch_amoled_2_16`，源码 git clone 逐行读）**：① SPI/QSPI 总线分支**不设 tear_avoid_mode**（`display_source.cpp:433-452` 只在 MIPI/RGB 分支赋值），即它也没有 TE 防撕裂；② `buffer_height` 默认 **20 行**（`brookesia_gui_lvgl/include/brookesia/gui_lvgl/macro_configs.h:104`），Task 节拍 tick 5 ms + 自适应 delay 10–100 ms；③ 板级 `sdkconfig.defaults.board:15` 为 **CPU 240 MHz**；④ 用 `ESP_LV_ADAPTER_DISPLAY_SPI_WITHOUT_PSRAM_DEFAULT_CONFIG` 创建显示。`esp_lv_adapter` 是私有组件（不在仓库、公开组件仓库亦 `ComponentNotFoundError`），其 buffer 究竟落在 SRAM 还是 PSRAM**无法源码级确认**，只能从宏名推断为内部 SRAM。结论：Brookesia 不是"消除了扫过"，而是条带更细（24 条 × ~1.2 ms）+ 渲染更快，观感更接近整体刷新。
- **尝试 A（失败，已回退）**：把 draw buffer 改成整屏 480 行 + `LV_DISPLAY_RENDER_MODE_FULL`，期望一帧一次提交。真机日志：
  ```
  I (2267) lume-display: CO5300 QSPI + LVGL display up (480x480 RGB565, 2x460800 B PSRAM draw buf)
  E (2710) spi_master: setup_dma_priv_buffer(1214): Failed to allocate priv TX buffer
  E (2710) lcd_panel.io.spi: panel_io_spi_tx_color(405): spi transmit (queue) color failed
  E (2712) lume-display: QSPI flush failed: ESP_ERR_NO_MEM
  ```
  根因：在 PSRAM 里的 draw buffer 不是 DMA-capable，`spi_master` 每次传输都要先分配**内部** bounce buffer（`setup_dma_priv_buffer`）并拷贝；48 KB（50 行）能分配到，460800 B（整屏）直接 OOM。所以"全屏 buffer"这条路在 PSRAM 上走不通。
- **尝试 B（采用）**：① `DRAW_BUF_LINES` 50 → **20**，buffer 改为 `heap_caps_malloc(MALLOC_CAP_INTERNAL | MALLOC_CAP_DMA)`（PSRAM 作为兜底），保持 `PARTIAL`——DMA 直接读内部 SRAM，去掉每帧的 bounce 拷贝，条带也从 10 条变 24 条细带；② `CONFIG_ESP_DEFAULT_CPU_FREQ_MHZ` 160 → **240**（`sdkconfig` 与 `sdkconfig.defaults` 同步），降低整屏软件渲染耗时。改动文件：`firmware/components/lume-board/lume_display.c`、`firmware/sdkconfig`、`firmware/sdkconfig.defaults`。
- **真机验证（构建 → 刷写 hash verified → 启动）**：
  ```
  I (886) cpu_start: cpu freq: 240000000 Hz
  I (2267) lume-display: CO5300 QSPI + LVGL display up (480x480 RGB565, 2x19200 B SRAM draw buf)
  I (2377) lume-board: board init done: CO5300 QSPI + CST9220 + LVGL pipeline up
  I (2679) lume-engine: app eval ok; entering event loop
  ```
  `E (` 行 **0 条**、无 `QSPI flush failed`；`lume deploy examples/counter` 正常（`Deployed 1040 bytes`）。内部 RAM 代价为 2×19200 B。
- **仍未验收/未量化**：① 观感上"扫过"是否消除——需要人眼确认，且**理论上仍会存在**：总线时间由 QSPI 40 MHz 决定（≈29 ms/整屏），无法靠缓冲切法消除；② 新配置的 render/flush 数字未复测（本轮结束时 perf monitor 已关闭），r28 的 39/29 ms 是老配置读数；③ 240 MHz 对功耗/发热的影响未测；④ 彻底消除需要 TE 引脚 + vsync 同步，尚未确认该板 TE 是否引到可用 GPIO。
- **roadmap 不动**：`docs/roadmap.md` 未修改。

## r30 / 多 app 存储 + 单 app 存活

- **模型**：设备上可安装多个 app，但**任何时刻只有一个 QuickJS runtime / 一个 app 存活**。切换 = 完整重建（`__lume_shutdown` → UI reset → free context/runtime → 新 runtime 里 eval prelude + 目标源），与热替换同一条链路。没有共享 runtime、没有后台 app、没有 app 间通信、**没有沙箱或权限隔离**——任何 app 都能通过 `lume.storage.Fs` 读写 `/apps` 下其他 app 的文件。这是刻意的：目标是多入口体验，不是多租户隔离。
- **存储**：LittleFS `storage` 分区，`/apps/<id>/app.js` + `/apps/<id>/meta.json`（单行 JSON，固件不解析，由 prelude 的 `lume.apps.entries()` 解析）+ `/apps/.current`（上次启动的 id）。id 规则见 `firmware/components/lume-engine/include/lume_app_id.h`（1..31 字符 `[A-Za-z0-9._-]`，禁止以 `.` 开头）。`STORE` 先写 meta 再写 app.js：中途掉电最多留下"新 meta + 旧 bundle"，不会出现没有 meta 的隐形 app。
- **命令通道**：新增 `LUMC` 命令帧（与 `LUME` 应用帧共用 12 字节头/CRC、共用一个字节流），语法在 `firmware/components/lume-hotreload/include/lume_cmd.h`。`STORE`/`REMOVE`/`META`/`LIST` 立即回 `CMD OK/ERR`；`LAUNCH`/`HOME` 复用引擎的 `RELOAD OK/ERR`（最终结果只能在 eval 之后知道）。旧固件把 `LUMC` 当 bad-magic 重同步，不兼容新 CLI 的多 app 命令，但普通 deploy（`--ephemeral`）仍然只发 `LUME`。
- **启动/返回**：boot 时 `.current` 指向的 app 仍存在就直接启动它，否则进固件内嵌 home 网格（`lume_scripts.c:lume_home_js`）。app eval 失败会清掉 `.current` 并回落 home（坏安装不会变砖）。BACK 未被 app 的 `onBack` 拦截时回 home；home 自身是根，拦截 BACK。`lume.apps.home()` 供 app 主动返回。
- **热更新语义不变**：`lume dev` 首帧 `STORE` + `LAUNCH`（写盘并启动），之后的改动只走 `LUME` 数据帧，只存在内存里；重启后回到磁盘上的版本。这样 dev 崩溃不会把坏代码写进安装目录。`deploy --ephemeral` 完全保持 M1 行为（不写盘）。
- **删除限制**：正在运行的 app 不能自我删除（`lume.apps.remove` 返回 `-6`，命令行 `CMD ERR busy`），避免 runtime 在自己源码被删后继续运行、下次启动落空。
- **已做的主机侧验证**：`tests/apps_protocol.c` 35 项（LUMC 识别/交错流/逐字节喂入/CRC 重同步/STORE 元数据与源码切分/id 校验/CLI 字节往返）；`tests/apps.js` 9 项（真实 prelude 抽取 + `entries()` 合并 meta/坏 JSON/无 native 降级/Launcher 默认列表与默认 launch/显式覆盖）；`npm test --prefix tools/lume` 14 项（cmdFrame 字节、STORE 布局、OTA 命令往返 `STORE`+`LIST`+`LAUNCH`、CLI 子命令与 id 校验）。既有 harness 全绿，其中 `tests/style_mapping.js` / `tests/theme_mapping.js` 的 demo 提取正则从 `;\s*$` 改为 `;\n`（脚本文件末尾新增了 `lume_home_js`）。
- **未验证（全部留接板轮）**：① 真机 LittleFS 写入/擦除耗时与 `lume dev` 反复安装的寿命影响；② 200 KiB 级 bundle 的 `STORE` 耗时与安装失败的掉电表现；③ 切换延迟、切换时的闪烁/黑屏；④ home 网格的观感、点击手感、图标尺寸；⑤ 多 app 实际使用下的内存碎片与长时间稳定性；⑥ `lume-hotreload`/`lume-engine` 的新增代码尚未在 ESP-IDF v5.5 下编译（本轮在 macOS 主机，无法 `idf.py build`），首次构建需注意 `lume_apps.c` 的 include/CMake 依赖。
- **roadmap 不动**：`docs/roadmap.md` 未修改；多 app 属于 M5 组件库/启动器方向的落地，里程碑定义与验收项仍由接板轮维护。
