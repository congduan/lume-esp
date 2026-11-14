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
