# r35b 渲染、性能与资源利用审计

审计基线：`main` / `b30af6d`（2026-11-15；开工执行 `git fetch origin && git status --short`，工作区无改动）。只改本报告；没有连接真机。Waveshare 参考树 `/tmp/waveshare-amoled` 为 `225a62b`。以下“上限”均为静态模型，不是实测 FPS。

## 结论与瓶颈 TOP 5

| 排名 | 用户可感知瓶颈、推演 | 建议、预期收益、代价 |
|---|---|---|
| 1 | **整块 Canvas 失效扩大传输面积。** 每次 `onDraw` 末尾无条件发 `canvasInvalidate`，桥接执行 `lv_obj_invalidate`，因此贪吃蛇虽仅改 2–3 个 14×14 方块，仍重绘/传输 384×384=294,912 B；按 40 MHz 四线理论占 14.75 ms。对比 3 个经 CO5300 偶/奇坐标取整后的 16×16 区域，净像素仅 1,536 B，面积比 **192 倍**。打砖块同为 384×350=268,800 B，每 40 ms 一次，理论纯颜色传输 13.44 ms。见 `lume_scripts.c:903`、`lume_ui_bridge.c:1222`、`games_snake/app.js:58-70`、`games_breakout/app.js:18,41-60`。 | 快赢：对游戏提供明确的小矩形脏区 API，并以屏幕坐标验证合并；蛇的线缆字节理论可降约 99.5%，但每个小区会增加窗口命令成本，实际 FPS 要测。结构性：Canvas 分块失效/精灵层；需改 JS API、桥接 ABI 和刷新一致性。 |
| 2 | **20 行缓冲仅占全屏 4.17%。** `480×20×2=19,200 B`，两块合计 38,400 B；全屏要至少 `480/20=24` 次 flush，每次 2 个窗口设置 + 1 个颜色事务，即至少 72 个事务。官方性能文档指出小于 10% 的内 SRAM draw buffer 会明显拖慢刷新。见 `lume_board_profile.h:67-70`、`lume_display.c:425-450`。 | 快赢：先测 DMA 内存最大连续块和 flush 耗时，再试 48 行双缓冲（92,160 B，10% 屏，10 次 flush）；事务数理论降 58%。代价是额外 53,760 B 内 SRAM，可能导致分配失败或 PSRAM 回退；不能直接承诺 FPS 涨幅。 |
| 3 | **刷新节拍压住轻场景帧率。** LVGL 刷新 timer 默认 33 ms，LVGL 任务每轮固定 `vTaskDelay(10 ms)`；空载 33 ms 对应最高约 30.3 次/s，触发还要等 0–10 ms 轮询。即使游戏逻辑改成 20 ms（50 Hz），静态推演也只会合并到约 30 Hz 的屏幕更新；实际耗时会继续降低。见 `lv_conf_internal.h:238-242`、`lv_display.c:108`、`lume_board.c:113-125`。 | 快赢：用 `lv_timer_handler` 返回的下一到期时间决定睡眠，分别试 15/10 ms 刷新周期；空载周期上限可由 30.3 提至 66.7/100 Hz，实际受总渲染/总线时间限制。代价是更多唤醒、CPU/功耗、需检查触摸响应。 |
| 4 | **逐段 Canvas 消息串行入队/排空。** 240 点 polyline = 239 段 + 1 invalidate = 240 条；当前 Xtensa 32 位 ABI 字段布局推算 116 B（目标 sizeof 待确认），单向队列复制约 27,840 B，收发合计约 55,680 B，加 240 次队列操作、239 次 8 参数 QuickJS→C 转换。384 槽队列可装一次，却会独占 LVGL drain；每次 drain 没有条数或时间预算。见 `lume_scripts.c:889-903`、`lume_engine.c:390-419`、`lume_ui_bridge.c:28-36,1196-1237`、`lume_ui_bridge.h:168-189`。 | 结构性：合批命令（如 16 段/包）可把 239 次投递降到 15 次，队列复制约降 94%，但需有界 payload、错误回滚、跨帧事务语义；批量像素写适合密集位图但需处理所有权/格式。双缓冲能消除半帧可见，至少增加一个 Canvas 像素面（最大 460,800 B），并不自动减少消息。 |
| 5 | **PSRAM 与 GC/解码争用导致长尾卡顿风险。** QuickJS 所有分配经 `heap_caps_*` 路由 PSRAM，JS 堆限额 8 MiB（这是上限，不是已占用）；图像解码、音频录制和 HTTP 也可能冲击外存。10 秒录音的 PCM 为 `10×16000×2×2=640,000 B`，复制为 ArrayBuffer 时瞬时 1,280,000 B。见 `lume_engine.c:47,96-125,1824-1831`、`lume_image.c:44-55`、`lume_net.c:488`。 | 快赢：加入 `JS_ComputeMemoryUsage`、最大连续 PSRAM、每帧耗时与堆水位日志（测量开关），定位 GC 尾延迟；收益是可归因，不承诺直接提速。结构性：录音移交外部 buffer 可省 640 KB 峰值；图像解码减少 RGBA 临时面，代价是所有权、解码器和生命周期设计。 |

## 1. 显示管线、理论上限和对照

- 当前 `lv_tick_set_cb(esp_timer)` 提供单调毫秒时基；任务每轮调用 `lv_timer_handler()` 后固定延迟 10 ms。桥接 drain timer 标称 5 ms，但只能在这轮 handler 到来时执行，空闲时实际观察粒度为约 10 ms。见 `lume_board.c:40-46,113-125,187-193`、`lume_ui_bridge.c:34-35,1299-1307`。FreeRTOS tick 为 1000 Hz（`firmware/sdkconfig:1908`）。
- 两块 19,200 B draw buffer 优先 `MALLOC_CAP_INTERNAL|DMA|8BIT`，失败后两块均转 PSRAM；渲染模式 PARTIAL，没有启用 full refresh。PSRAM 回退会触发 SPI 驱动内部 bounce copy/内存压力，不能把它当成同速配置。flush 前 CPU 原位 RGB565 字节交换，`esp_lcd_panel_io_tx_color` 走 SPI DMA，传完回调 `lv_display_flush_ready`。见 `lume_display.c:308-346,351-381,425-466`。每次 flush 的字节交换为额外 O(像素数) CPU 工作；具体耗时待量测。
- panel profile 时钟 40 MHz、四线颜色阶段、SPI mode 0、深度 3。满屏净像素 `480×480×16=3,686,400 bit=460,800 B`；理想 QSPI payload 速率 `40 MHz×4/8=20 MB/s`，所以最少 `460,800/20,000,000=23.04 ms`，净传输**最多 43.4 帧/s**。20 行每片 19,200 B，单片净传输至少 0.96 ms，24 片仍 23.04 ms；窗口/命令、DMA 设置、字节交换、渲染及调度都只会加时。若刷新周期仍为 33 ms，轻场景最高约 30.3 FPS；全屏到达 30 FPS 的必要条件是每周期所有附加成本不超过 `33-23.04=9.96 ms`，还须保证刷新计时及异步 DMA 重叠行为。若周期改 15 ms，40 MHz 下满屏仍受 43.4 FPS 线缆上限限制。见 `lume_board_profile.h:49-53,65-73`、`lume_display.c:330-346`。这不是面板刷新率上限或实机结果。
- `LV_EVENT_INVALIDATE_AREA` 将坐标向外取整到偶/奇边界；LVGL 的 `lv_refr_join_area` 只在合并矩形比两块面积之和更小时合并，失效列表溢出会回退整屏。见 `lume_display.c:279-293`、`lv_refr.c:317-328,401,442-471`。Lume 没有另写脏区策略；Canvas 的整对象失效会绕开应用内小块更新收益。没有看到 TE/VSYNC 同步输入或等帧逻辑；部分更新可能撞上扫描位置，撕裂程度必须上板录像/示波器确认。双 draw buffer 是渲染/传输流水，并不等于面板防撕裂。

### 与 Brookesia / esp_lvgl_port 的配置差距

| 项 | Lume | 对照与判断 |
|---|---|---|
| 调度与刷新 | 10 ms 固定轮询，LVGL 默认 33 ms | Brookesia 示例 `sdkconfig.defaults:23` 为 15 ms；[esp_lvgl_port 性能指南](https://github.com/espressif/esp-bsp/blob/master/components/esp_lvgl_port/docs/performance.md)建议 LVGL9 10 ms 用于主观响应。该例的具体 BSP port 源码不在 `/tmp/waveshare-amoled` 中，无法声称已核实其 handler 调度。 |
| draw buffer | 双 20 行、内部 DMA，4.17% 屏；无 `trans_size` | [官方性能指南](https://github.com/espressif/esp-bsp/blob/master/components/esp_lvgl_port/docs/performance.md)指出内部缓冲小于 10% 效果差、超过 25% 收益有限；[esp_lvgl_port 配置结构](https://github.com/espressif/esp-bsp/blob/master/components/esp_lvgl_port/include/esp_lvgl_port_disp.h)可配置 `buffer_size/double_buffer/trans_size/buff_dma/buff_spiram`。没有 CO5300 专属“官方最优行数”；建议 48/96 行是待实验候选。 |
| 软件绘制单元 | `lv_conf.h:56` 配 1 | Brookesia 示例 `sdkconfig.defaults:25` 配 2；双核并不保证双 draw unit 获益，要测 CPU 使用和内存成本。 |
| 编译优化 | `firmware/sdkconfig:614` 为 DEBUG，CPU 240 MHz | Brookesia 示例 `sdkconfig.defaults:15,30` 为 240 MHz + PERF；[官方指南](https://github.com/espressif/esp-bsp/blob/master/components/esp_lvgl_port/docs/performance.md)建议 PERF，但会增大 bin，需与 IRAM 和 flash 余量一起复测。 |
| 帧同步 | 未见 TE 同步；partial 与双缓冲 | [官方 display cfg](https://github.com/espressif/esp-bsp/blob/master/components/esp_lvgl_port/include/esp_lvgl_port_disp.h)的 `avoid_tearing` 说明针对 RGB/DSI，不能直接套到 CO5300 SPI；应先查板卡 TE 接线及面板能力。 |

Brookesia 的 `bsp_display_start()` 调用见 `/tmp/waveshare-amoled/examples/esp-idf/03_esp-brookesia/main/main.cpp:25`，其 `sdkconfig.defaults:5-30` 是可核对的示例配置，**不是本板 CO5300 buffer 实现的证据**。

## 2. Canvas、signals 与游戏负载

- 实际 ABI 结构按 Xtensa 32 位字段对齐推算为 116 B，64 位宿主布局为 128 B；目标固件的 `sizeof` 仍应由编译产物/断言打印确认。源码已有 `<=128` 静态断言，故 128 B 只能作为保守上界。r16 的 96 B 已被 text/image 扩展改动，见 `lume_ui_bridge.h:165-189`。384×116=44,544 B 为目标 ABI 推算的 Queue A 记录载荷；384×128=49,152 B 为最大**记录载荷上界**，队列控制块另计；队列存放位置取决于 IDF `malloc` 路由，不能无条件写成内部 DRAM。长文本每条另外占 65–257 B PSRAM；最坏 384 条全为 256 B 文本时额外 `384×257=98,688 B`，但这个流量是刻意的压力上界。
- `signal.set` 先做 `===` 去重，再标脏订阅 effect 并同步 drain；一次 set 的 JS 复杂度约 O(订阅者数+被执行 effect 的工作量)。effect 内的属性更新经 C 栈上 `lume_ui_msg_t` 清零、参数/UTF-8 转换、`xQueueSend` 拷贝，再由 LVGL 任务 `xQueueReceive` 拷贝、执行 setter。数值 ATTR 没有单独 PSRAM 消息分配，排队长度和两次记录拷贝是主要固定成本；JS 对象/闭包在 effect 注册时长期存活，字符串拼接和 `JS_ToCStringLen` 的临时值则产生短寿命分配。见 `lume_scripts.c:175-190,224-228`、`lume_engine.c:185-214,390-419`、`lume_ui_bridge.c:1196-1230,1264-1292`。每条耗时未知，不能用字节数臆算毫秒。
- 0–63 B 文本内联；64–256 B 文本分配 `len+1` PSRAM payload，发送者转移所有权，drain 释放；`JS_ToCStringLen` 与 `lv_label_set_text` 可能另有临时/持有副本。高频长标签会反复分配/释放、增加碎片风险。见 `lume_ui_bridge.h:28-29,165-177`、`lume_engine.c:190-214`、`lume_ui_bridge.c:1201-1229`。
- 贪吃蛇实际 tick 从 180 ms 起、最快 80 ms，即 5.6–12.5 次/s，主负载不是 20 ms；每 tick 2–3 个 `fillRect` + 1 invalidate，约 3–4 条记录，却失效整个 384² Canvas。打砖块实际 40 ms，即逻辑上限 25 Hz，常态最多 4 个擦/画矩形 + 1 invalidate = 5 条；Canvas 面 384×350，每次仍整块失效。20 ms 假设的游戏若保持此 API，逻辑 50 Hz，但屏幕周期约 30.3 Hz，积压风险由 `T_JS+T_queue+T_raster+T_render+T_flush` 是否小于 20 ms 决定。见两游戏 `app.js:41-70`。打砖块并非每帧“全屏 Canvas 落笔”，而是**局部落笔、整块失效**；此区分影响优化优先级。
- 最小可复现实测：板上记录 `esp_timer_get_time` 的 JS tick 首尾、Queue A 投递/出队、Canvas draw、LVGL `RENDER_START/READY`、`FLUSH_START/READY`；分别运行 240 点折线、Snake、Breakout 各 60 秒，记录 p50/p95/p99 帧间隔、丢队列、CPU/内外存最低余量与最大连续块。用相同亮度/帧内容及相同系统负载比较，不能把模拟器 FPS 当真机 FPS。

## 3. QuickJS 启动与 GC

当前每次 fresh runtime 建立后用 `JS_Eval(...GLOBAL)` 先解释 prelude 源字符串，再解释 app IIFE 源；源码在 `lume_engine.c:159-178,2587-2623`。这意味着每次启动/热重载都解析与编译 prelude；qjsc 预编译字节码理论上可省这一段 CPU 与编译临时内存，但不能省运行期 JS 对象/闭包、App 源解析，也不自动缩小固件：字节码大小和 QuickJS-NG 版本/架构兼容、C 嵌入方式都需比对。可用 boot 和 100 次 reload 的 `esp_timer_get_time` 分别量 `JS_NewRuntime2`、prelude eval、app eval、首帧，辅以 `JS_ComputeMemoryUsage` 和 PSRAM 最低余量；未有真机数据，不能给启动毫秒收益。

分配器是 `JS_NewRuntime2(&s_psram_mf)`，使用 `heap_caps_malloc/calloc/realloc(...SPIRAM)`，而**不是** `JS_SetMemoryFunctions`；`JS_SetMemoryLimit(8 MiB)` 是 QuickJS 账面上限，板上 8 MiB PSRAM 还要容纳 Canvas/图片/WiFi 等，因此这个上限不能作为可用余量。QuickJS 采用引用计数及循环回收；频繁短寿命对象可能增加分配成本，但“频繁 GC 一定导致卡顿”尚无证据。应记录每帧 JS 堆、GC 次数/时长、PSRAM 最大连续块及 p99 延迟相关性，再决定缓存/对象复用。见 `lume_engine.c:93-125,2587-2594`。

## 4. 内存审计与峰值

本次在已有 Linux ESP-IDF 5.5.5 构建目录执行 `idf.py size-components` 和 `idf_size.py --format csv --archives firmware/build/lume.map`。命令重新链接了固件但未刷板。关键原始输出：

```text
lume.bin binary size 0x2853c0 bytes. Smallest app partition is 0x640000 bytes. 0x3bac40 bytes (60%) free.
"DIRAM","229863","67.26","111897","341760"
"IRAM","16384","100.0","0","16384"
".text","15356","93.73","",""
".vectors","1028","6.27","",""
```

IRAM 按 archive：`esp_hw_support 4062`、`esp_system 2847`、`heap 1837`、`bt 1052`、`freertos 1016`、`newlib 838`、`xtensa 757`、`hal 641`、`spi_flash 472`、`esp_psram 387`、`esp_ringbuf 284`、`esp_timer 287`、`esp_driver_spi 248`、`esp_lcd 162`、其余带 IRAM archive 726 B；这些 archive 行合计 15,616 B，与总区 16,384 B 之间 768 B 为链接器/非 archive 归属差额，需用 `size-files`/map 进一步精确归因。`lvgl`、`quickjs-ng`、`lume-engine`、`lume-board`、`lume-ui-bridge` 各 archive IRAM 均 0 B；因此不能说 Canvas/QuickJS 直接占了 IRAM。IRAM 满线是**静态链接分区**现象，更多代码入 IRAM 会触发链接约束，并非运行时堆 0 B。

| 场景/分配点 | 外存峰值或容量（B） | 生命周期与并发说明 |
|---|---:|---|
| Canvas RGB565（`lume_ui_bridge.c:57-59,447-468`） | 460,800 | 所有 Canvas 合计预算；Snake 294,912，Breakout 268,800；两个游戏不会同屏运行。 |
| 480² PNG 解码输出 RGB565A8（`lume_image.c:42-55`） | 691,200 | 解码时与原有图像像素可重叠；旧图仅在新图交接后释放，单节点替换峰值可再加旧 691,200。 |
| PNG RGBA 中间面（`lume_image.c:47-54`） | 921,600 | `lv_malloc` 经 C `malloc`，是否落 PSRAM 取决于 IDF allocator；还要加 PNG 压缩源与解码 scratch，未知。 |
| 10 秒录音 + JS ArrayBuffer（`lume_engine.c:1824-1831`） | 1,280,000 | 录音时先 640,000，返回复制时重叠 640,000；同步调用占 engine task。 |
| HTTP response + JS copy（`lume_net.c:488`，`lume_engine.c:1569-1574`） | 65,536 | 32 KiB body + 最大 32 KiB JS 返回值；TLS/WiFi 工作内存另计，POST 源最多 16 KiB。与同步录音调用不会同一瞬间执行。 |
| Queue A 最坏记录+长文（`lume_ui_bridge.c:34,1291`） | ≤147,840 | 49,152 B 队列载荷上界 + 98,688 B 长文 payload；极端压力情景，实际队列记录大小目标编译确认。 |
| QuickJS 堆（`lume_engine.c:47,2588-2594`） | ≤8,388,608 账面上限 | 与 JS ArrayBuffer/源字符串重叠，不能和上述各项简单相加为实际可实现峰值。 |
| 内部 DMA draw buffers（`lume_display.c:431-450`） | 38,400 | 正常为内部 SRAM；回退 PSRAM 时占外存，且可能触发 SPI bounce。 |
| 任务栈（`lume_board.c:213`、`lume_engine.c:48,2857-2859`） | 8,192 + 24,576 | 两项配置字节数，共 32,768 B；实际栈分配能力/水位须板上 `uxTaskGetStackHighWaterMark`。JPEG 解码另在 engine 栈放 4,096 B work (`lume_image.c:57`)。 |

可**时间重叠**的保守图像+Canvas+录音复制模型（各一个全尺寸）：`460,800+691,200+921,600+1,280,000=3,353,600 B`，未计 QuickJS 常驻堆、PNG 源、解码 scratch、驱动及分配碎片；若图像替换还有旧图，则 `4,044,800 B`。但 PNG 解码和同步录音都占 engine task，RGBA 中间面通常在录音前已释放，故这两个数字是把互斥阶段相加的压力包络，**不是可同时出现的实测快照或可实现峰值**。可实现的次序峰值应分别测：解码峰值 `Canvas+新输出+RGBA+旧图+JS`，录音复制峰值 `Canvas+已装图片+1,280,000+JS`。长跑反复图片替换、短长文本交替、录音/播放会考验最大连续块；每分钟记录 `heap_caps_get_largest_free_block(MALLOC_CAP_SPIRAM)` 和总空闲，必要时做 8 小时循环。内部 DRAM 的 229,863 B 是**静态**占用；任务栈、队列、LVGL 对象与网络运行期分配需在板上叠加，不可用 111,897 B 静态余量直接断言能再加 92 KiB draw buffer。

## 优化路线图与验收顺序

| 阶段 | 实施 | 可验证收益目标 | 成本/门槛 |
|---|---|---|---|
| 快赢，<1 天 | 加临时 profile 点与每秒摘要：render、flush、drain、JS eval、GC、最大连续块、栈水位；不开启时零额外热路径日志 | 得到 p95/p99 和真实瓶颈，不预设 FPS 提升 | 少量代码/日志；先测基线，需真机 |
| 快赢，<1 天 | 48 行双内部 DMA buffer A/B 试验 | 全屏 flush 从 24 降 10，事务降约 58%；FPS 待量 | 多 53,760 B 内存，必须检查启动/连续块 |
| 快赢，<1 天 | 15/10 ms 刷新周期 + 动态睡眠 A/B | 低复杂度刷新机会 30→67/100 Hz；实际提升受 23.04 ms 满屏线缆下限约束 | CPU/功耗上升，量 p99、触摸、睡眠 |
| 结构性 | Canvas 脏矩形（首选 Snake）与多区合并阈值 | Snake 3 格时线缆净字节可从 294,912 降到约 1,536；实际需把命令开销计入 | ABI、坐标、Clip、撕裂语义设计 |
| 结构性 | 多命令合批 + 帧边界，必要时双 Canvas buffer | 240 点折线投递 240→约 16，队列复制约降 94% | 有界包协议、失败回滚、最多 +460,800 B Canvas 内存 |
| 结构性 | 录音零拷贝、PNG 解码减中间面；评估 qjsc prelude | PCM 峰值降 640,000 B；prelude 启动时间收益须量 | QuickJS buffer 所有权、字节码版本及恢复路径 |

验收门槛：每项记录同一构建/同一画面下的 FPS p50、帧间隔 p95/p99、`RENDER/FLUSH/DRAIN` 各段、Queue A 峰值/丢包、内外存最小余量/最大连续块、栈水位和功耗；Snake、Breakout、240 点 polyline 均要跑。优先解决整块 Canvas 失效，再考虑提高 QSPI 时钟：40→80 MHz 的线缆净时间理论从 23.04→11.52 ms、理论上限 43.4→86.8 FPS，但面板容限、走线稳定性和撕裂必须真机验证，不能视为无破坏快赢。
