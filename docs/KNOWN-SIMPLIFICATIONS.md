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
- **LVGL 对象不随重载清空 + node id 复用**：按约定「驱动/LVGL/触摸不重启」，
  `lume-ui-bridge` 的 `s_nodes[]` 表跨重载保留；引擎每轮把 `s_next_node_id` 复位为 0，
  新 app 复用 1..N 的 id 覆盖表项，上一版 app 的 lv_obj 仍挂在屏幕上（成为孤儿/残留控件）。
  没有 `clear screen` 原语，残留控件仍可能触发点击回调并投递旧 id。彻底清理留给后续刀。
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
