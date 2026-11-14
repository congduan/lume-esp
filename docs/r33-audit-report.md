# r33 深度审计报告（Codex，只读）

双目标：正确性 bug 扫描 + 以 ESP-Brookesia 为基线的渲染质量差距分析。
对照源：waveshareteam/ESP32-S3-Touch-AMOLED-2.16 main（brookesia_core + BSP + esp_lcd_co5300）。
所有结论带 file:line；「需真机验证」项如实标注。

---

## 1. 渲染质量差距表

| 项目 | Lume 现状 | Brookesia 基线 | 判断与修法、代价 |
|---|---|---|---|
| 中文与字体层级 | 默认 Montserrat 14；虽然编进 20/32，bridge 创建文字时仍只使用默认字体。[配置](/home/ubuntu/lume/firmware/components/lvgl/lv_conf.h:10)、[创建路径](/home/ubuntu/lume/firmware/components/lume-ui-bridge/lume_ui_bridge.c:392)。14px 字体的 cmap 不含通用汉字；LVGL 会尝试 fallback，未找到时进入占位字形路径。[cmap](/home/ubuntu/lume/firmware/components/lvgl/src/font/lv_font_montserrat_14.c:1694)、[缺字处理](/home/ubuntu/lume/firmware/components/lvgl/src/font/lv_font.c:109) | 默认样式表提供 8–48px 的 21 档 Maison Neue 位图字体。[样式表](/tmp/waveshare-amoled/examples/esp-idf/03_esp-brookesia/components/brookesia_core/systems/phone/stylesheets/default/dark/core_data.hpp:20)。其字体生成范围也是西文，**不能据此声称 Brookesia 已解决中文**。[字体源](/tmp/waveshare-amoled/examples/esp-idf/03_esp-brookesia/components/brookesia_core/systems/base/assets/fonts/maison_neue_book/esp_brookesia_font_maison_neue_book_14.c:4) | **硬伤**：Lume 自带首页已有中文文案。[首页文字](/home/ubuntu/lume/firmware/components/lume-engine/lume_scripts.c:1070) 应先加入覆盖常用中文的 LVGL 字体及 fallback，再开放字号、字距、行距。工作量中；字库会增加 flash。FreeType 并非必要前提，Lume 当前也未启用它。[默认配置](/home/ubuntu/lume/firmware/components/lvgl/src/lv_conf_internal.h:3015) 实际显示形态需真机验证。 |
| 颜色与透明 | 显示和 Canvas 均为 RGB565；PNG 保留独立 8 位 alpha，控件 opacity 走 LVGL 样式混合。[显示](/home/ubuntu/lume/firmware/components/lume-board/lume_display.c:285)、[PNG 转换](/home/ubuntu/lume/firmware/components/lume-engine/lume_image_pixels.c:3)、[透明度](/home/ubuntu/lume/firmware/components/lume-ui-bridge/lume_ui_bridge.c:638) | 参考工程未在 [sdkconfig.defaults](/tmp/waveshare-amoled/examples/esp-idf/03_esp-brookesia/sdkconfig.defaults:19)声明 RGB888 路径，不能把 24 位色作为已证实的基线。 | **可接受，但需真机验证**渐变色带与叠层效果。RGB565 每像素 2B；改为 RGB888 会提高传输量和缓存压力。优先改善配色及图像预处理，工作量低至中。 |
| 圆角与边框 | `radius`、`borderWidth` 直接交给 LVGL 软件绘制；Arc 使用 LVGL 原生环形控件。[属性映射](/home/ubuntu/lume/firmware/components/lume-ui-bridge/lume_ui_bridge.c:629)、[Arc](/home/ubuntu/lume/firmware/components/lume-ui-bridge/lume_ui_bridge.c:429) | SquareLine 示例也设置 LVGL 圆角和 1–2px 边框。[聊天卡片](/tmp/waveshare-amoled/examples/esp-idf/03_esp-brookesia/components/brookesia_app_squareline_demo/ui/screens/ui_screen_chat.c:52)、[时钟边框](/tmp/waveshare-amoled/examples/esp-idf/03_esp-brookesia/components/brookesia_app_squareline_demo/ui/screens/ui_screen_clock.c:127) | **可接受**。两者主要共用 LVGL 绘制能力；边缘是否有可见瑕疵需同屏截图验证。先统一设计令牌与控件尺寸，工作量低。 |
| 动画与刷新 | 动画由 `lv_anim` 在 LVGL 任务执行；任务每轮固定延迟 10ms，LVGL 默认刷新周期为 33ms。20 行双缓冲、partial 刷新，未见 TE 同步。[动画](/home/ubuntu/lume/firmware/components/lume-ui-bridge/lume_ui_bridge.c:299)、[任务循环](/home/ubuntu/lume/firmware/components/lume-board/lume_board.c:113)、[刷新默认值](/home/ubuntu/lume/firmware/components/lvgl/src/lv_conf_internal.h:238)、[缓冲与 flush](/home/ubuntu/lume/firmware/components/lume-board/lume_display.c:145) | 参考工程配置刷新周期 15ms、240MHz CPU、两个软件 draw unit；入口由 BSP 启动显示，但缺失其具体端口实现。[配置](/tmp/waveshare-amoled/examples/esp-idf/03_esp-brookesia/sdkconfig.defaults:15)、[入口](/tmp/waveshare-amoled/examples/esp-idf/03_esp-brookesia/main/main.cpp:25) | **需修**。先测 render、flush、等待三段耗时，再评估刷新周期与任务唤醒策略，工作量中。Lume 既有报告记录过约 20–26 FPS 的探索性真机观测，但这不是当前提交的整机验收。[历史记录](/home/ubuntu/lume/docs/KNOWN-SIMPLIFICATIONS.md:666) 撕裂程度及参考工程 TE 行为需真机验证。 |
| 图片缩放 | `Image` 使用 `CONTAIN`；LVGL 按目标框算缩放，RGB565 下默认启用抗锯齿，变换代码会混合相邻像素。[Lume](/home/ubuntu/lume/firmware/components/lume-ui-bridge/lume_ui_bridge.c:463)、[缩放](/home/ubuntu/lume/firmware/components/lvgl/src/widgets/image/lv_image.c:967)、[默认 AA](/home/ubuntu/lume/firmware/components/lvgl/src/widgets/image/lv_image.c:654)、[采样](/home/ubuntu/lume/firmware/components/lvgl/src/draw/sw/lv_draw_sw_transform.c:693) | 示例使用预制 PNG 图标及图片控件。[天气图](/tmp/waveshare-amoled/examples/esp-idf/03_esp-brookesia/components/brookesia_app_squareline_demo/ui/screens/ui_screen_weather.c:39) | **可接受**：不能把 Lume 归类为“最近邻缩放”。较明显的差距是图标资产和尺寸选择；优先提供目标尺寸资源，工作量低。 |
| Canvas 线条与图表 | 线条为整数 Bresenham 加方形画刷，圆为整数像素写入，均无覆盖率 AA；Canvas 文字仍走 LVGL 字体。[线](/home/ubuntu/lume/firmware/components/lume-ui-bridge/lume_ui_bridge.c:814)、[圆](/home/ubuntu/lume/firmware/components/lume-ui-bridge/lume_ui_bridge.c:826)、[文字](/home/ubuntu/lume/firmware/components/lume-ui-bridge/lume_ui_bridge.c:838) | 参考包装类使用 LVGL Canvas 原生格式；SquareLine 示例大量使用原生控件与预制资源。[Canvas 包装](/tmp/waveshare-amoled/examples/esp-idf/03_esp-brookesia/components/brookesia_core/gui/lvgl/esp_brookesia_lv_canvas.cpp:26)、[示例控件](/tmp/waveshare-amoled/examples/esp-idf/03_esp-brookesia/components/brookesia_app_squareline_demo/ui/screens/ui_screen_clock.c:27) | **需修**：斜线、圆环和折线图会更容易显得锯齿。优先用原生 Arc；通用 Canvas 可增加覆盖率 AA 或调用 LVGL draw API，工作量中，逐像素混合会增加 CPU 成本。 |
| dirty rect、带宽与撕裂 | LVGL partial 模式；无效区域按面板要求扩到偶数边界，40MHz 四线 QSPI 理论像素数据上限约 20MB/s，整屏 RGB565 数据 460,800B，仅传输理论下限约 23ms，尚未计命令和渲染。[rounder](/home/ubuntu/lume/firmware/components/lume-board/lume_display.c:116)、[partial](/home/ubuntu/lume/firmware/components/lume-board/lume_display.c:285)、[时钟](/home/ubuntu/lume/firmware/boards/waveshare_esp32_s3_touch_amoled_2_16/lume_board_profile.h:67) | 参考工程的具体 buffer 与 tearing avoidance 配置在本地缺失的 BSP 中，无法逐行确认；[依赖声明](/tmp/waveshare-amoled/examples/esp-idf/03_esp-brookesia/main/idf_component.yml:2)可定位缺口。 | **需真机验证**。不应直接改 full refresh：它会增加整屏传输。先捕获 dirty 区域分布、flush 耗时及高速摄影撕裂情况；若确有收益，再试更高 QSPI 时钟或 TE，同板稳定性验证工作量中至高。 |
| 基线、gap、padding | bridge 对 View 清零 LVGL 主题默认 padding/gap，并映射显式 gap；但公开样式仅有 `textAlign` 等，缺字号、字距、行距与基线对齐控制。[默认清零](/home/ubuntu/lume/firmware/components/lume-ui-bridge/lume_ui_bridge.c:381)、[gap](/home/ubuntu/lume/firmware/components/lume-ui-bridge/lume_ui_bridge.c:625)、[公开映射](/home/ubuntu/lume/firmware/components/lume-engine/lume_scripts.c:550) | Brookesia 样式表提供多档字号；示例对数字、标签单独选字体。[字体表](/tmp/waveshare-amoled/examples/esp-idf/03_esp-brookesia/components/brookesia_core/systems/phone/stylesheets/default/dark/core_data.hpp:20)、[数字字体](/tmp/waveshare-amoled/examples/esp-idf/03_esp-brookesia/components/brookesia_app_squareline_demo/ui/screens/ui_screen_clock.c:138) | **需修**。加入字号、字距、行距和统一的文字布局规则；成本中。当前主题的 `fontScale` 可设置，但 bridge 没有对应字体属性路径。[主题值](/home/ubuntu/lume/firmware/components/lume-engine/lume_scripts.c:163)、[属性枚举](/home/ubuntu/lume/firmware/components/lume-ui-bridge/include/lume_ui_bridge.h:76) |

## 2. Bug 清单

### P0：崩溃或内存破坏

1. **热重载并发替换可双重释放，并使新帧滞留。** `request_reload()` 在锁外分配 `copy`，锁内允许后来的请求释放旧 `s_staged_src`；首个请求随后若因 Queue B 满而投递失败，仍无条件 `heap_caps_free(copy)`。触发顺序：A 写入 staging 并等待队列发送；B 替换、释放 A 的 buffer，因 `s_reload_pending` 为真而不再发事件；A 发送失败，再释放同一 buffer，并清掉 pending。见 [替换与回滚](/home/ubuntu/lume/firmware/components/lume-engine/lume_engine.c:2215)。修复应将“写 staging、决定投递、失败回滚”的所有权状态设计成可并发验证的单一状态转换，失败时只释放仍由该调用持有的指针。此为源码可推导竞态；触发概率需压力测试确认。

### P1：功能错误

2. **手势事件会在正常队列容量下乱序。** DOWN、UP、SWIPEDIR 都用 `xQueueSendToFront`，MOVE 用队尾。若 LVGL 在 engine 消费前先后投递 DOWN、MOVE、UP，实际取出顺序可变成 UP、DOWN、MOVE；JS 状态机遇到未开始的 UP 会直接忽略，随后可能留下 `down=true`。见 [入队策略](/home/ubuntu/lume/firmware/components/lume-engine/lume_engine.c:1978)、[状态机](/home/ubuntu/lume/firmware/components/lume-engine/lume_scripts.c:865)。应保持同一次触摸的 FIFO 顺序；满队列时对 MOVE 作合并或预留关键事件容量。现有手势主机测试覆盖状态机输入顺序，未覆盖这段 FreeRTOS 入队行为。

3. **Queue B 满时仍可能丢失 UP，造成手势状态悬挂。** 注释称优先保护释放事件，但 `xQueueSendToFront` 和尾部重试在队列满时都失败，只计数、记录日志。[队列满分支](/home/ubuntu/lume/firmware/components/lume-engine/lume_engine.c:1988) 此时 JS 的 `down` 状态仅在收到 UP 时清除。[状态机](/home/ubuntu/lume/firmware/components/lume-engine/lume_scripts.c:897) 与第 2 条一起修；真机高负载下的发生频率待测。

4. **文字超过 63 字节直接抛错，中文约 21 个常见三字节汉字便触限。** prelude 使用 UTF-8 字节计数，C binding 也拒绝超长字符串；不会截断或分片。[检查](/home/ubuntu/lume/firmware/components/lume-engine/lume_scripts.c:384)、[C 边界](/home/ubuntu/lume/firmware/components/lume-engine/lume_engine.c:406)、[消息定义](/home/ubuntu/lume/firmware/components/lume-ui-bridge/include/lume_ui_bridge.h:157)。较长的中文标签、动态数据或错误信息会中断 UI 更新。应改为有长度的独立文本载荷，明确所有权和释放时机；工作量中。

5. **UI 创建失败没有向 JS 确认，节点可处于“JS 认为存在、LVGL 不存在”的状态。** Canvas 超预算或 PSRAM 分配失败时 `apply_create()` 直接返回，发送者早已从 `createNode()` 收到 ID。[Canvas 失败路径](/home/ubuntu/lume/firmware/components/lume-ui-bridge/lume_ui_bridge.c:407)、[ID 返回](/home/ubuntu/lume/firmware/components/lume-engine/lume_engine.c:289) 后续属性消息仅记 unknown-node 日志。[属性路径](/home/ubuntu/lume/firmware/components/lume-ui-bridge/lume_ui_bridge.c:497) 应加入创建确认或预算预留。需以低内存故障注入验证表现。

### P2：观感或边界

6. **中文缺字和固定 14px 是当前最明确的用户可见缺陷。** 字体与 fallback 证据见上表。实际是方框、空白还是其他占位形态，取决于 LVGL 的占位配置及最终画面，**需真机验证**。
7. **Canvas 的斜线与圆形有像素阶梯；EdgeNavigation 指示条也通过 Canvas 绘制。** [整数画线](/home/ubuntu/lume/firmware/components/lume-ui-bridge/lume_ui_bridge.c:814)、[指示条](/home/ubuntu/lume/runtime/shell.js:60)。触摸手感和 List、边缘手势叠层的实际命中区域仍需真机验证；现有 [shell 实现](/home/ubuntu/lume/runtime/shell.js:42)与[滚动仲裁](/home/ubuntu/lume/firmware/components/lume-ui-bridge/lume_ui_bridge.c:937)不足以证明板上体验。

**已排除的误报：** 消息现在含图片指针，注释中的“原 96B”不是当前尺寸；接收端会强制终止 `text[63]`，C 发送端先拒绝超长字符串。[结构定义](/home/ubuntu/lume/firmware/components/lume-ui-bridge/include/lume_ui_bridge.h:157)、[接收端](/home/ubuntu/lume/firmware/components/lume-ui-bridge/lume_ui_bridge.c:1077) 图片缩放也不是简单最近邻。抽查 GPIO、ADC、图片和音频绑定时，未发现可确认的“成功返回正错误码”违约；读取值及 `ArrayBuffer` 返回属于 API 约定的非状态返回。[GPIO 契约说明](/home/ubuntu/lume/firmware/components/lume-engine/lume_engine.c:553)、[录音返回](/home/ubuntu/lume/firmware/components/lume-engine/lume_engine.c:1637)

## 3. 性能与内存优化点

| 优化点 | 源码依据与收益估计 |
|---|---|
| 测量后调刷新节拍 | Lume 的 10ms 轮询叠加默认 33ms LVGL 周期；参考工程配置 15ms。[Lume 任务](/home/ubuntu/lume/firmware/components/lume-board/lume_board.c:113)、[参考配置](/tmp/waveshare-amoled/examples/esp-idf/03_esp-brookesia/sdkconfig.defaults:23) 可降低空闲动画的调度等待，实际 FPS 收益需真机测量，不能直接按周期换算。 |
| 对 Canvas 绘制命令合批 | 当前每条线或矩形各占一个 Queue A 记录，队列 128 项，最终才 invalidate。[队列说明](/home/ubuntu/lume/firmware/components/lume-ui-bridge/lume_ui_bridge.c:28)、[Canvas 应用](/home/ubuntu/lume/firmware/components/lume-ui-bridge/lume_ui_bridge.c:799) 合批可减少队列压力和每条命令的跨任务开销；收益取决于图表复杂度。 |
| 录音避免峰值双份 PCM | 最长 10 秒录音先申请 640,000B PSRAM，再 `JS_NewArrayBufferCopy` 复制一份，瞬时约 1.28MB，仅计 PCM。[录音](/home/ubuntu/lume/firmware/components/lume-engine/lume_engine.c:1637) 若能安全移交外部 buffer，可省约 640KB 峰值，但需处理 QuickJS 释放回调。 |
| 图片解码控制峰值 | 一张 480×480 PNG：JS 压缩输入之外，解码中有约 921,600B RGBA，另分配约 691,200B RGB565A8；Canvas 满屏再占 460,800B。[解码](/home/ubuntu/lume/firmware/components/lume-engine/lume_image.c:42)、[Canvas 预算](/home/ubuntu/lume/firmware/components/lume-ui-bridge/lume_ui_bridge.c:407) 三者同时存在约 **2.07MB**，再加最长录音的约 **1.28MB**、JS 堆、LVGL 对象及其他资源。流式或分块解码可减少瞬时峰值，工作量高。 |
| 显示带宽按实测优化 | 当前优先内部 DMA SRAM 的两块 19,200B 缓冲，40MHz QSPI；落到 PSRAM 兜底会增加复制。[缓冲](/home/ubuntu/lume/firmware/components/lume-board/lume_display.c:261)、[时钟](/home/ubuntu/lume/firmware/boards/waveshare_esp32_s3_touch_amoled_2_16/lume_board_profile.h:67) 提高时钟的理论传输收益可达约 2 倍，但面板与走线稳定性、实际 FPS 必须真机验证。 |

## 4. TOP 3 建议行动

1. **补常用中文字体 fallback，并开放 14/20/32px 字号。** 这是最直接、覆盖首页与所有应用的观感提升；同时核对 flash 体积。[当前字体配置](/home/ubuntu/lume/firmware/components/lvgl/lv_conf.h:10)
2. **修 Queue B 手势 FIFO 与关键事件容量。** 代码改动相对集中，能消除滑动、List 与 EdgeNavigation 交互中可推导的乱序问题。[入队路径](/home/ubuntu/lume/firmware/components/lume-engine/lume_engine.c:1948)
3. **先测量再调刷新周期，并将高频图表优先交给原生 LVGL 控件。** 这同时改善动画观感和 Canvas 锯齿，避免未经测量就扩大整屏刷新成本。[任务循环](/home/ubuntu/lume/firmware/components/lume-board/lume_board.c:113)、[原生 Arc](/home/ubuntu/lume/firmware/components/lume-ui-bridge/lume_ui_bridge.c:429)

**实施优先级例外：** 虽然热重载竞态不按“观感提升÷工作量”排入上述 TOP 3，它是 P0，应在继续压力测试或发布前先修。[竞态位置](/home/ubuntu/lume/firmware/components/lume-engine/lume_engine.c:2215)

只读验证运行了 `node tests/gestures.js`（20 例通过）、`node tests/image_mapping.js`、`node tests/canvas_mapping.js`、`node tests/shell_components.js`（8 例通过）。这些是主机检查，不能代替板上字体、撕裂、帧率或触摸验收。
tokens used
134,205
# Lume 深度代码审计

审计基线：Lume `ad173422bc614f85f615af8e124f9417bbfb1389`。本次只读，未修改文件。参考目录存在，但其中的板级 BSP 由 [组件清单](/tmp/waveshare-amoled/examples/esp-idf/03_esp-brookesia/main/idf_component.yml:2)声明为外部依赖；目录内没有 `esp_lvgl_port` 和 CO5300 驱动实现。因此，关于 Brookesia 的缓冲区落点、TE 防撕裂模式和实测帧率，不能从这份参考源码作确定比较。

## 1. 渲染质量差距表

| 项目 | Lume 现状 | Brookesia 基线 | 判断与修法、代价 |
|---|---|---|---|
| 中文与字体层级 | 默认 Montserrat 14；虽然编进 20/32，bridge 创建文字时仍只使用默认字体。[配置](/home/ubuntu/lume/firmware/components/lvgl/lv_conf.h:10)、[创建路径](/home/ubuntu/lume/firmware/components/lume-ui-bridge/lume_ui_bridge.c:392)。14px 字体的 cmap 不含通用汉字；LVGL 会尝试 fallback，未找到时进入占位字形路径。[cmap](/home/ubuntu/lume/firmware/components/lvgl/src/font/lv_font_montserrat_14.c:1694)、[缺字处理](/home/ubuntu/lume/firmware/components/lvgl/src/font/lv_font.c:109) | 默认样式表提供 8–48px 的 21 档 Maison Neue 位图字体。[样式表](/tmp/waveshare-amoled/examples/esp-idf/03_esp-brookesia/components/brookesia_core/systems/phone/stylesheets/default/dark/core_data.hpp:20)。其字体生成范围也是西文，**不能据此声称 Brookesia 已解决中文**。[字体源](/tmp/waveshare-amoled/examples/esp-idf/03_esp-brookesia/components/brookesia_core/systems/base/assets/fonts/maison_neue_book/esp_brookesia_font_maison_neue_book_14.c:4) | **硬伤**：Lume 自带首页已有中文文案。[首页文字](/home/ubuntu/lume/firmware/components/lume-engine/lume_scripts.c:1070) 应先加入覆盖常用中文的 LVGL 字体及 fallback，再开放字号、字距、行距。工作量中；字库会增加 flash。FreeType 并非必要前提，Lume 当前也未启用它。[默认配置](/home/ubuntu/lume/firmware/components/lvgl/src/lv_conf_internal.h:3015) 实际显示形态需真机验证。 |
| 颜色与透明 | 显示和 Canvas 均为 RGB565；PNG 保留独立 8 位 alpha，控件 opacity 走 LVGL 样式混合。[显示](/home/ubuntu/lume/firmware/components/lume-board/lume_display.c:285)、[PNG 转换](/home/ubuntu/lume/firmware/components/lume-engine/lume_image_pixels.c:3)、[透明度](/home/ubuntu/lume/firmware/components/lume-ui-bridge/lume_ui_bridge.c:638) | 参考工程未在 [sdkconfig.defaults](/tmp/waveshare-amoled/examples/esp-idf/03_esp-brookesia/sdkconfig.defaults:19)声明 RGB888 路径，不能把 24 位色作为已证实的基线。 | **可接受，但需真机验证**渐变色带与叠层效果。RGB565 每像素 2B；改为 RGB888 会提高传输量和缓存压力。优先改善配色及图像预处理，工作量低至中。 |
| 圆角与边框 | `radius`、`borderWidth` 直接交给 LVGL 软件绘制；Arc 使用 LVGL 原生环形控件。[属性映射](/home/ubuntu/lume/firmware/components/lume-ui-bridge/lume_ui_bridge.c:629)、[Arc](/home/ubuntu/lume/firmware/components/lume-ui-bridge/lume_ui_bridge.c:429) | SquareLine 示例也设置 LVGL 圆角和 1–2px 边框。[聊天卡片](/tmp/waveshare-amoled/examples/esp-idf/03_esp-brookesia/components/brookesia_app_squareline_demo/ui/screens/ui_screen_chat.c:52)、[时钟边框](/tmp/waveshare-amoled/examples/esp-idf/03_esp-brookesia/components/brookesia_app_squareline_demo/ui/screens/ui_screen_clock.c:127) | **可接受**。两者主要共用 LVGL 绘制能力；边缘是否有可见瑕疵需同屏截图验证。先统一设计令牌与控件尺寸，工作量低。 |
| 动画与刷新 | 动画由 `lv_anim` 在 LVGL 任务执行；任务每轮固定延迟 10ms，LVGL 默认刷新周期为 33ms。20 行双缓冲、partial 刷新，未见 TE 同步。[动画](/home/ubuntu/lume/firmware/components/lume-ui-bridge/lume_ui_bridge.c:299)、[任务循环](/home/ubuntu/lume/firmware/components/lume-board/lume_board.c:113)、[刷新默认值](/home/ubuntu/lume/firmware/components/lvgl/src/lv_conf_internal.h:238)、[缓冲与 flush](/home/ubuntu/lume/firmware/components/lume-board/lume_display.c:145) | 参考工程配置刷新周期 15ms、240MHz CPU、两个软件 draw unit；入口由 BSP 启动显示，但缺失其具体端口实现。[配置](/tmp/waveshare-amoled/examples/esp-idf/03_esp-brookesia/sdkconfig.defaults:15)、[入口](/tmp/waveshare-amoled/examples/esp-idf/03_esp-brookesia/main/main.cpp:25) | **需修**。先测 render、flush、等待三段耗时，再评估刷新周期与任务唤醒策略，工作量中。Lume 既有报告记录过约 20–26 FPS 的探索性真机观测，但这不是当前提交的整机验收。[历史记录](/home/ubuntu/lume/docs/KNOWN-SIMPLIFICATIONS.md:666) 撕裂程度及参考工程 TE 行为需真机验证。 |
| 图片缩放 | `Image` 使用 `CONTAIN`；LVGL 按目标框算缩放，RGB565 下默认启用抗锯齿，变换代码会混合相邻像素。[Lume](/home/ubuntu/lume/firmware/components/lume-ui-bridge/lume_ui_bridge.c:463)、[缩放](/home/ubuntu/lume/firmware/components/lvgl/src/widgets/image/lv_image.c:967)、[默认 AA](/home/ubuntu/lume/firmware/components/lvgl/src/widgets/image/lv_image.c:654)、[采样](/home/ubuntu/lume/firmware/components/lvgl/src/draw/sw/lv_draw_sw_transform.c:693) | 示例使用预制 PNG 图标及图片控件。[天气图](/tmp/waveshare-amoled/examples/esp-idf/03_esp-brookesia/components/brookesia_app_squareline_demo/ui/screens/ui_screen_weather.c:39) | **可接受**：不能把 Lume 归类为“最近邻缩放”。较明显的差距是图标资产和尺寸选择；优先提供目标尺寸资源，工作量低。 |
| Canvas 线条与图表 | 线条为整数 Bresenham 加方形画刷，圆为整数像素写入，均无覆盖率 AA；Canvas 文字仍走 LVGL 字体。[线](/home/ubuntu/lume/firmware/components/lume-ui-bridge/lume_ui_bridge.c:814)、[圆](/home/ubuntu/lume/firmware/components/lume-ui-bridge/lume_ui_bridge.c:826)、[文字](/home/ubuntu/lume/firmware/components/lume-ui-bridge/lume_ui_bridge.c:838) | 参考包装类使用 LVGL Canvas 原生格式；SquareLine 示例大量使用原生控件与预制资源。[Canvas 包装](/tmp/waveshare-amoled/examples/esp-idf/03_esp-brookesia/components/brookesia_core/gui/lvgl/esp_brookesia_lv_canvas.cpp:26)、[示例控件](/tmp/waveshare-amoled/examples/esp-idf/03_esp-brookesia/components/brookesia_app_squareline_demo/ui/screens/ui_screen_clock.c:27) | **需修**：斜线、圆环和折线图会更容易显得锯齿。优先用原生 Arc；通用 Canvas 可增加覆盖率 AA 或调用 LVGL draw API，工作量中，逐像素混合会增加 CPU 成本。 |
| dirty rect、带宽与撕裂 | LVGL partial 模式；无效区域按面板要求扩到偶数边界，40MHz 四线 QSPI 理论像素数据上限约 20MB/s，整屏 RGB565 数据 460,800B，仅传输理论下限约 23ms，尚未计命令和渲染。[rounder](/home/ubuntu/lume/firmware/components/lume-board/lume_display.c:116)、[partial](/home/ubuntu/lume/firmware/components/lume-board/lume_display.c:285)、[时钟](/home/ubuntu/lume/firmware/boards/waveshare_esp32_s3_touch_amoled_2_16/lume_board_profile.h:67) | 参考工程的具体 buffer 与 tearing avoidance 配置在本地缺失的 BSP 中，无法逐行确认；[依赖声明](/tmp/waveshare-amoled/examples/esp-idf/03_esp-brookesia/main/idf_component.yml:2)可定位缺口。 | **需真机验证**。不应直接改 full refresh：它会增加整屏传输。先捕获 dirty 区域分布、flush 耗时及高速摄影撕裂情况；若确有收益，再试更高 QSPI 时钟或 TE，同板稳定性验证工作量中至高。 |
| 基线、gap、padding | bridge 对 View 清零 LVGL 主题默认 padding/gap，并映射显式 gap；但公开样式仅有 `textAlign` 等，缺字号、字距、行距与基线对齐控制。[默认清零](/home/ubuntu/lume/firmware/components/lume-ui-bridge/lume_ui_bridge.c:381)、[gap](/home/ubuntu/lume/firmware/components/lume-ui-bridge/lume_ui_bridge.c:625)、[公开映射](/home/ubuntu/lume/firmware/components/lume-engine/lume_scripts.c:550) | Brookesia 样式表提供多档字号；示例对数字、标签单独选字体。[字体表](/tmp/waveshare-amoled/examples/esp-idf/03_esp-brookesia/components/brookesia_core/systems/phone/stylesheets/default/dark/core_data.hpp:20)、[数字字体](/tmp/waveshare-amoled/examples/esp-idf/03_esp-brookesia/components/brookesia_app_squareline_demo/ui/screens/ui_screen_clock.c:138) | **需修**。加入字号、字距、行距和统一的文字布局规则；成本中。当前主题的 `fontScale` 可设置，但 bridge 没有对应字体属性路径。[主题值](/home/ubuntu/lume/firmware/components/lume-engine/lume_scripts.c:163)、[属性枚举](/home/ubuntu/lume/firmware/components/lume-ui-bridge/include/lume_ui_bridge.h:76) |

## 2. Bug 清单

### P0：崩溃或内存破坏

1. **热重载并发替换可双重释放，并使新帧滞留。** `request_reload()` 在锁外分配 `copy`，锁内允许后来的请求释放旧 `s_staged_src`；首个请求随后若因 Queue B 满而投递失败，仍无条件 `heap_caps_free(copy)`。触发顺序：A 写入 staging 并等待队列发送；B 替换、释放 A 的 buffer，因 `s_reload_pending` 为真而不再发事件；A 发送失败，再释放同一 buffer，并清掉 pending。见 [替换与回滚](/home/ubuntu/lume/firmware/components/lume-engine/lume_engine.c:2215)。修复应将“写 staging、决定投递、失败回滚”的所有权状态设计成可并发验证的单一状态转换，失败时只释放仍由该调用持有的指针。此为源码可推导竞态；触发概率需压力测试确认。

### P1：功能错误

2. **手势事件会在正常队列容量下乱序。** DOWN、UP、SWIPEDIR 都用 `xQueueSendToFront`，MOVE 用队尾。若 LVGL 在 engine 消费前先后投递 DOWN、MOVE、UP，实际取出顺序可变成 UP、DOWN、MOVE；JS 状态机遇到未开始的 UP 会直接忽略，随后可能留下 `down=true`。见 [入队策略](/home/ubuntu/lume/firmware/components/lume-engine/lume_engine.c:1978)、[状态机](/home/ubuntu/lume/firmware/components/lume-engine/lume_scripts.c:865)。应保持同一次触摸的 FIFO 顺序；满队列时对 MOVE 作合并或预留关键事件容量。现有手势主机测试覆盖状态机输入顺序，未覆盖这段 FreeRTOS 入队行为。

3. **Queue B 满时仍可能丢失 UP，造成手势状态悬挂。** 注释称优先保护释放事件，但 `xQueueSendToFront` 和尾部重试在队列满时都失败，只计数、记录日志。[队列满分支](/home/ubuntu/lume/firmware/components/lume-engine/lume_engine.c:1988) 此时 JS 的 `down` 状态仅在收到 UP 时清除。[状态机](/home/ubuntu/lume/firmware/components/lume-engine/lume_scripts.c:897) 与第 2 条一起修；真机高负载下的发生频率待测。

4. **文字超过 63 字节直接抛错，中文约 21 个常见三字节汉字便触限。** prelude 使用 UTF-8 字节计数，C binding 也拒绝超长字符串；不会截断或分片。[检查](/home/ubuntu/lume/firmware/components/lume-engine/lume_scripts.c:384)、[C 边界](/home/ubuntu/lume/firmware/components/lume-engine/lume_engine.c:406)、[消息定义](/home/ubuntu/lume/firmware/components/lume-ui-bridge/include/lume_ui_bridge.h:157)。较长的中文标签、动态数据或错误信息会中断 UI 更新。应改为有长度的独立文本载荷，明确所有权和释放时机；工作量中。

5. **UI 创建失败没有向 JS 确认，节点可处于“JS 认为存在、LVGL 不存在”的状态。** Canvas 超预算或 PSRAM 分配失败时 `apply_create()` 直接返回，发送者早已从 `createNode()` 收到 ID。[Canvas 失败路径](/home/ubuntu/lume/firmware/components/lume-ui-bridge/lume_ui_bridge.c:407)、[ID 返回](/home/ubuntu/lume/firmware/components/lume-engine/lume_engine.c:289) 后续属性消息仅记 unknown-node 日志。[属性路径](/home/ubuntu/lume/firmware/components/lume-ui-bridge/lume_ui_bridge.c:497) 应加入创建确认或预算预留。需以低内存故障注入验证表现。

### P2：观感或边界

6. **中文缺字和固定 14px 是当前最明确的用户可见缺陷。** 字体与 fallback 证据见上表。实际是方框、空白还是其他占位形态，取决于 LVGL 的占位配置及最终画面，**需真机验证**。
7. **Canvas 的斜线与圆形有像素阶梯；EdgeNavigation 指示条也通过 Canvas 绘制。** [整数画线](/home/ubuntu/lume/firmware/components/lume-ui-bridge/lume_ui_bridge.c:814)、[指示条](/home/ubuntu/lume/runtime/shell.js:60)。触摸手感和 List、边缘手势叠层的实际命中区域仍需真机验证；现有 [shell 实现](/home/ubuntu/lume/runtime/shell.js:42)与[滚动仲裁](/home/ubuntu/lume/firmware/components/lume-ui-bridge/lume_ui_bridge.c:937)不足以证明板上体验。

**已排除的误报：** 消息现在含图片指针，注释中的“原 96B”不是当前尺寸；接收端会强制终止 `text[63]`，C 发送端先拒绝超长字符串。[结构定义](/home/ubuntu/lume/firmware/components/lume-ui-bridge/include/lume_ui_bridge.h:157)、[接收端](/home/ubuntu/lume/firmware/components/lume-ui-bridge/lume_ui_bridge.c:1077) 图片缩放也不是简单最近邻。抽查 GPIO、ADC、图片和音频绑定时，未发现可确认的“成功返回正错误码”违约；读取值及 `ArrayBuffer` 返回属于 API 约定的非状态返回。[GPIO 契约说明](/home/ubuntu/lume/firmware/components/lume-engine/lume_engine.c:553)、[录音返回](/home/ubuntu/lume/firmware/components/lume-engine/lume_engine.c:1637)

## 3. 性能与内存优化点

| 优化点 | 源码依据与收益估计 |
|---|---|
| 测量后调刷新节拍 | Lume 的 10ms 轮询叠加默认 33ms LVGL 周期；参考工程配置 15ms。[Lume 任务](/home/ubuntu/lume/firmware/components/lume-board/lume_board.c:113)、[参考配置](/tmp/waveshare-amoled/examples/esp-idf/03_esp-brookesia/sdkconfig.defaults:23) 可降低空闲动画的调度等待，实际 FPS 收益需真机测量，不能直接按周期换算。 |
| 对 Canvas 绘制命令合批 | 当前每条线或矩形各占一个 Queue A 记录，队列 128 项，最终才 invalidate。[队列说明](/home/ubuntu/lume/firmware/components/lume-ui-bridge/lume_ui_bridge.c:28)、[Canvas 应用](/home/ubuntu/lume/firmware/components/lume-ui-bridge/lume_ui_bridge.c:799) 合批可减少队列压力和每条命令的跨任务开销；收益取决于图表复杂度。 |
| 录音避免峰值双份 PCM | 最长 10 秒录音先申请 640,000B PSRAM，再 `JS_NewArrayBufferCopy` 复制一份，瞬时约 1.28MB，仅计 PCM。[录音](/home/ubuntu/lume/firmware/components/lume-engine/lume_engine.c:1637) 若能安全移交外部 buffer，可省约 640KB 峰值，但需处理 QuickJS 释放回调。 |
| 图片解码控制峰值 | 一张 480×480 PNG：JS 压缩输入之外，解码中有约 921,600B RGBA，另分配约 691,200B RGB565A8；Canvas 满屏再占 460,800B。[解码](/home/ubuntu/lume/firmware/components/lume-engine/lume_image.c:42)、[Canvas 预算](/home/ubuntu/lume/firmware/components/lume-ui-bridge/lume_ui_bridge.c:407) 三者同时存在约 **2.07MB**，再加最长录音的约 **1.28MB**、JS 堆、LVGL 对象及其他资源。流式或分块解码可减少瞬时峰值，工作量高。 |
| 显示带宽按实测优化 | 当前优先内部 DMA SRAM 的两块 19,200B 缓冲，40MHz QSPI；落到 PSRAM 兜底会增加复制。[缓冲](/home/ubuntu/lume/firmware/components/lume-board/lume_display.c:261)、[时钟](/home/ubuntu/lume/firmware/boards/waveshare_esp32_s3_touch_amoled_2_16/lume_board_profile.h:67) 提高时钟的理论传输收益可达约 2 倍，但面板与走线稳定性、实际 FPS 必须真机验证。 |

## 4. TOP 3 建议行动

1. **补常用中文字体 fallback，并开放 14/20/32px 字号。** 这是最直接、覆盖首页与所有应用的观感提升；同时核对 flash 体积。[当前字体配置](/home/ubuntu/lume/firmware/components/lvgl/lv_conf.h:10)
2. **修 Queue B 手势 FIFO 与关键事件容量。** 代码改动相对集中，能消除滑动、List 与 EdgeNavigation 交互中可推导的乱序问题。[入队路径](/home/ubuntu/lume/firmware/components/lume-engine/lume_engine.c:1948)
3. **先测量再调刷新周期，并将高频图表优先交给原生 LVGL 控件。** 这同时改善动画观感和 Canvas 锯齿，避免未经测量就扩大整屏刷新成本。[任务循环](/home/ubuntu/lume/firmware/components/lume-board/lume_board.c:113)、[原生 Arc](/home/ubuntu/lume/firmware/components/lume-ui-bridge/lume_ui_bridge.c:429)

**实施优先级例外：** 虽然热重载竞态不按“观感提升÷工作量”排入上述 TOP 3，它是 P0，应在继续压力测试或发布前先修。[竞态位置](/home/ubuntu/lume/firmware/components/lume-engine/lume_engine.c:2215)

只读验证运行了 `node tests/gestures.js`（20 例通过）、`node tests/image_mapping.js`、`node tests/canvas_mapping.js`、`node tests/shell_components.js`（8 例通过）。这些是主机检查，不能代替板上字体、撕裂、帧率或触摸验收。
CODEX_EXIT=0
