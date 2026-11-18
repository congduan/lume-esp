# Known Simplifications / Deferred Acceptance (M1)

## r107 / 语音网关 D 刀（协议先行 + mock 上游；host 证据，无真机/无真实上游）

- **上游未拍板、只做适配器接口**：网关↔上游选型（①小智官方 WS+Opus 60 ms 帧翻译；
  ②直连 ASR/LLM/TTS 三件）用户尚未定案，本轮**不实现任何真实上游**。`tools/gateway/upstream.js`
  里 `XiaozhiUpstream` / `DirectStackUpstream` 是显式 `NOT_IMPLEMENTED` TODO 桩，CLI 选非 mock
  上游直接退出 2；不做臆测的 API key / 凭据 / 第三方 endpoint 处理。mock 上游用 canned 问答 +
  合成正弦/静音 PCM（每帧 3840 B，60 ms 交错立体声）走完整设备侧链路，只证明协议与网关自身正确。
- **协议是设备↔网关这一段，不是小智协议**：设备只讲简单双流（下行 JSON text delta + 带 8 字节头的
  二进制音频帧；上行 60 ms 裸 PCM），Opus 翻译、ASR/LLM/TTS 全留给未来的上游适配器。网关严格校验
  60 ms = **3840 B**（16 kHz/16-bit/2ch 交错；源证 `lume.d.ts` 974/986、`lume_audio.c` 331），
  错帧（含简报误写的单声道 1920 B）致命关闭；固件 `recordStream` 原生 1024 帧=64 ms 块的
  重组属 app 层工作，本轮网关不做猜测性转换。
- **无 TLS / 无鉴权**：WS server 只监听 `127.0.0.1`，`ws://` 明文，无 token 校验、无速率限制、
  无重放防护，定位 trusted-LAN / 本机联调。沿用 **lume-hotreload / WiFi OTA 的 AUTH 先例**
  （见本文件 r26 节）：设备侧 token 机制当初也是 `AUTH <token>` 明文 + 启动日志打印、LAN 信任模型，
  公网必须加 TLS（wss / 反向代理）并改为带外分发 token；本轮不引入任何设备侧 token 机制，
  也不在 JSON 控制帧里伪造认证字段。
- **单连接单轮、无 QoS**：一条 WS 承载一轮 turn，网关发 idle + close(1000) 结束；没有断线重连、
  没有心跳判活（`ping/pong` 仅占位）、没有 text-delta 重传（seq 仅供设备检测丢包）。
  WS 事件队列背压与音频帧吞吐仍待真机测量（r57 先例）。
- **零运行时依赖的取舍**：vendored 轻量 RFC6455 握手/分帧（`tools/gateway/ws.js`），不用 `ws` npm
  包以免引入重依赖；只支持文本/二进制/关闭/ping、7/16/64 位长度、客户端掩码、64 KiB 上限，
  不支持 permessage-deflate / 扩展协商 / TLS 终结。
- **未验项**：无真机、无 `idf.py build/size`（固件零改动）、无 `playStream` 边收边播时延、
  无双 DMA 并发、无上游断线恢复。可选 app 层 `vaSetTransport` WS 工厂**已于 r108 兑现**
  （见下方 r108 段）；但真机项（WiFi 稳定性/时延/双 DMA/barge-in 手感）仍未验。

## r108 / voice_assistant WS transport（E 刀收口；host 证据，无真机/无真实上游）

- **mock 上游不变，未接真实 ASR/LLM/TTS**：r108 只是把 app 接到 r107 的网关协议上，
  网关侧仍是 canned 问答 + 合成 PCM，小智/三件直连仍是 `NOT_IMPLEMENTED` TODO 桩；
  上游选型未拍板，无 API key / 凭据处理。
- **无 TLS / 无鉴权（沿用 r107 LAN 信任模型）**：`ws://` 明文，URL 走 KV
  `voice_gateway_url` 或顶部 `VA_GATEWAY_URL`，默认 `ws://192.168.1.50:18770/`
  （CLI 默认 8765，须对齐）。不在控制帧里伪造认证字段。
- **单连接单轮、无 QoS / 无重连**：一条 WS 一轮；`onClose` 无关闭码（`lume.d.ts`
  契约），结束原因靠 `state`/`error` 帧；拒连/中途断连/致命错误统一回 IDLE 不挂死，
  但不做断线重连、不发心跳（`ping/pong` 仅占位）、不重传 delta。
- **分帧与队列**：上行严格 3840 B（16 kHz/16-bit/2ch 交错，非错误的 1920 B 单声道），
  原生 `recordStream` 4096 B 块由 app 重组；下行 8 字节头 + ≤4608 B payload 直接喂
  `playStream`，-3（队列满）下一 tick 重投同一块。WS 事件队列背压与音频吞吐仍待真机测量。
- **barge-in 语义**：停 mic 并补发 `end` 帧、网关释放上游；触摸实际打断延迟 deferred。
- **未验项（真机）**：WiFi 下 WS 稳定性、时延预算（开口 <2 s）、双 DMA 并发、
  playStream 边收边播真实时延、触摸 barge-in 手感，一律 deferred to board bring-up；
  固件零改动、未跑 `idf.py build/size`。host harness 只证明协议与 app 逻辑正确，
  **不声称真机验证**。

## r71 / 本地 Web 服务（C HTTP + JS 路由，host/编译证据，无真机 WiFi 验收）

- **范围**：新增 `firmware/components/lume-net/lume_webserv.c`、`lume_webserv_parse.c`、`include/lume_webserv.h`、`Kconfig.projbuild`（`CONFIG_LUME_WEB_PORT=8080`）；`lume_engine.c` 五个绑定 + 单任务 poll 桥 + app 生命周期停服；prelude `lume.net.web` JS API（`lume_scripts.c`）；`runtime/types/lume.d.ts`、`docs/hardware-api.md`；新 harness `tests/webserver.js`、`tests/webserv_parse.c`；示例 `examples/web_config/`；`README.md` 一行 + roadmap 叙事行 + 本报告。Vendored 组件未改。**playground / website / README 的 apps 计数类改动一律未做**（并行 r69/r70 收口时主控统一处理）。commits 拆分、未推送。
- **架构决策（二选一，写明理由）**：采用**单任务 poll**，而非「独立 FreeRTOS web task + accept 后队列投引擎 + 信号量回投」。后者在引擎单线程模型下，等待 handler 的 web task 必须阻塞在一个信号量上，而引擎若正处于 app 切换 / eval / 长同步原生调用中，无法保证在 5 s 内消费该请求并回投——这正是停下条款担心的死锁面。单任务方案让引擎在自己的 ~20 ms 事件循环里直接 `lume_webserv_poll()`（非阻塞 `select` + `recv(MSG_DONTWAIT)`），同步调用 `__lume_web_dispatch(req)` 后立即 `lume_webserv_respond()`，**没有任何跨任务握手**，HTTP 同步语义天然成立；代价是 handler 与慢客户端的 I/O 都占用引擎任务，已由 8 KiB 上限 + 2 连接 + 5 s I/O 截止时间 + 回调纪律约束。
- **HTTP 子集边界**：HTTP/1.0 短连接，`Connection: close` 每请求一连接；只解析请求行 / `Content-Length` / `Connection` 三个要素，按 `Content-Length` 截取 body。**无 keep-alive、无 chunked、无 gzip/多 part、无 TLS**（mbedTLS 服务端证书需要证书/密钥配置与 PKI，明确 out of scope， trusted-LAN 明文信任模型）。浏览器访问完全兼容（浏览器对 `Connection: close` 无特殊要求）。
- **路由子集**：精确路径 + 精确方法匹配（`method + ' ' + path` 字符串键），**无路径参数 / 通配符 / 前缀匹配 / 文件系统映射**——C 层绝不把请求路径当文件路径打开，彻底没有任意文件读取面。未匹配 404；GET `/` 未注册时内置欢迎页（设备名 + 已注册路由列表）。多路由表由 JS 侧对象管理，运行时重建即清空，随 app 热更新分发。
- **安全边界**：默认关闭，`lume.net.web.start({token})` 显式开启；token 必填且 URL-safe，作为 `?key=<token>` 出现在 url()/屏幕大字中；`key` 查询参数用常数时间比较，无 / 错 token 直接 403 且在 JS dispatch 之前完成（handler 不会被调用）。无 WiFi IPv4 不监听（照抄 OTA 的 `lume_net_has_ip()` 门禁）。app 切换 / 关闭 / eval 失败一律在新建运行时之前 `lume_webserv_stop()`，杜绝僵尸端口。
- **内存纪律**：唯一共享请求缓冲 `LUME_WEB_HEAD_MAX(1024) + LUME_WEB_BODY_MAX(8192) ≈ 9 KiB` 一次性 PSRAM 分配（`MALLOC_CAP_SPIRAM`），2 个并发连接共用，不按连接翻倍；响应体不额外拷贝，从 JS 自有内存按 512 B 分块 `send()`。C 层中间面 ~9 KiB，低于 r33 叠加账 16 KiB 线；请求体转成 JS 字符串时 QuickJS 会另有分配，合并峰值须真机测量，不能把 C 缓冲值冒充整机峰值。请求体 8192 B 硬上限，超出 413。
- **并发/超时**：`listen` backlog 与已接受 socket 均封顶 2；第 3 个连接直接关闭。每个连接 5 s I/O 截止（含「连上但从不发字节」），超时 408；头超 1 KiB 431；畸形请求 400。handler 运行时间无法被 C 强制抢占（QuickJS 同步调用），与 `lume.ai.chat()`/`httpGet()` 的阻塞取舍同类，靠回调纪律而非硬超时约束。
- **验证口径（host + 编译，非真机）**：`tests/webserver.js` 8 例全绿（精确路由 / 404 / query 解析 / token 403 / 8 KiB body / start-stop 生命周期 / 全链 + handler 异常 500）；`tests/webserv_parse.c` gcc `-Wall -Wextra -Werror` 51 checks PASS（请求行 / header / body 截取 / 畸形输入 / 边界 / token 常数比较）；固件 `idf.py build` + `idf.py size` 与 IRAM 16384 硬线见 `docs/r71-webserv-report.md` 原始输出。esp32sim 无 host 网络回环时，以「C 解析单测 + JS 路由 host 测试」双证据替代，不做假的网络回环断言。
- **仍 open（真机验收）**：手机/浏览器经真实 WiFi 打开 `http://<ip>:8080/?key=...`、屏幕大字可读性、握手/DHCP 后自动监听与掉线停服、表单 POST 写 KV 后 abc123 侧轮询消费、并发 2 连接与 8 KiB body 的真机内存峰值、与 OTA(8765) 同时监听的射频共存，一律未验。`examples/web_config/` 只做服务端通路 + 演示页，不改 abc123 本体（主控后续排线）。
## r73 / abc123 SVG 字形（host + esp32sim，真机待验）

- `tools/font2svg/generate.py` 用 fontTools 从 DejaVu Sans Bold TTF 一次性生成 62 个静态 SVG 和 26 个竖排 Aa 组合，路径指令均在 r58 的 M/L/H/V/C/S/Q/T/A/Z 子集内。生成物采用 100×100 viewBox、固定白色 fill；mini-SVG 不支持运行时改色或 `transform`，换色须再生成 SVG。静态轮廓没有笔顺/描红动画；弹跳仅作用于整个 Image 节点。
- 数字字形也改为字体轮廓；数字下方的实心圆点和 A-E 涂鸦是独立教学元素，继续用一个 Canvas。四模式为顺序、随机、小写、竖排 Aa；数字在小写和 Aa 模式仍显示同一个数字。
- 字形 Image 声明 320×320 像素，r58 会按此尺寸光栅化。esp32sim 首卡约在注入后 5.2 秒模拟时间完成 app eval，翻页可能显著卡顿；340² 试跑更慢（约 5.8 秒）。主机模拟器和 playground 仍以 Image 占位符显示，不能拿其截图验 SVG 画质。真机 SVG 解码耗时、翻页触感、PSRAM 峰值和 AMOLED 外观待接板验收。

## r70 / abc123 幼儿字母数字卡（host + browser + esp32sim 证据，无真机验收）

- **范围**：新增 `examples/abc123/app.js` + `tests/abc123.js`；playground 四处同步（build.mjs apps、page.js picker、index.html script、verify.mjs 24→25）并重新生成 `website/playground/{apps,sources}` 产物；README Apps 表加格、roadmap 新开「幼儿教育」叙事行、本条与 `docs/r70-abc-report.md`。固件 C、prelude C 字符串、bridge ABI、帧协议、`runtime/types/lume.d.ts`、vendored 组件全部未改。未推送。
- **字号上限实证（本刀最大技术决策）**：`runtime/types/lume.d.ts:54-57` 与 `firmware/components/lume-ui-bridge/lume_ui_bridge.c:660-667` 实证 Text `fontSize` 经 `theme.fontScale` 相乘后仍被 **snap 到 14/20/32 三档**，渲染上限 32 px，远达不到 480 屏 ≥60%（~290 px）的单字巨幕。故大字形一律 Canvas 手绘：数字用七段 fillRect（与 calculator 同一抽象，也是数字写法启蒙的正确视觉），字母用粗笔画 polyline，全部为手授权点路径，`ctx.polyline` 上限 240 点 / 8-16 px 宽；**不引字体轮廓解析库**，简报「需字体解析即停」条款未触发。HUD/底部文案用 20 px Text（=20 档），符合「无小字 ≥20」。
- **ctx.circle 实为描边环**：r47 把 `LUME_DRAW_CIRCLE` 从八个实心 stamp 改成 `lume_raster_ring`（`lume_ui_bridge.c:962-966`），`ctx.circle(x,y,r,c)` 现在是 **1px 空心环**，不是实心圆。数字卡要「实心圆点」故改用 `ctx.arc(x,y,r,0,360,r+2,c)`——整圆扫 + 宽度 > 2r 触发 r48 登记的空腔闭合退化，得到实心圆点；浏览器 renderer 的 op5 同参也能画出实心。A-E 图标中的苹果有意保留空心环 + 绿柄，作为简笔涂鸦风。
- **交互取舍**：全屏单手势——屏幕下部（y≥74）任意点击 = 下一张；顶部 74px HUD 条点击 = 切模式（seq→rand→case→seq，切换即重置为首卡）。**无 exit / 无 back / 无家长锁**：单 app 锁屏归 launcher/boot 策略，本 app 不提供任何退出路径，幼儿乱点不会误退。只用一个 `lume.gesture.on(root,'tap')` + 坐标分区，没有第二个可点击节点，避免 LVGL 事件冒泡导致「切模式顺带翻页」双触发。
- **语音开关不做**：无 TTS 固件能力（audio 仅裸 PCM / playStream / MP3 解码，无语音合成绑定），登记不实现，非本轮缺口。
- **大小写对照模式**：`case` 模式字母左右并排显示大写 + 简化小写笔画（手绘近似，非字体轮廓）；每字形约 54% 屏高，低于单字形模式（62.9% / 数字 60.4%），因并排对照主动让出宽度，如实登记。数字无大小写，`case` 模式下数字仍按单七段字形显示（语义不变、顺序不变）。
- **随机模式**：Fisher-Yates 洗牌成 36 张袋，抽完才重洗，保证未抽完不重复；模式切换重置袋与序号。
- **playground 计数口径**：本分支基于 origin/main r68（24 apps），只加 abc123 → 25 apps。并行 r69 worktree 另有 `examples/sokoban/`（未并入本分支），两刀合并后总数应为 **26**，由主控合并时统一四处计数，避免各自把对方 app 计入导致重复/构建缺文件。
- **仍 open（全部真机验收）**：点屏/色彩、弹跳动画流畅度、HUD 在真机 AMOLED 的可读性、20ms tick 帧率、bundle 推送一律未验。`lume check` 绿 + 10 条 host harness 绿 + 25-app 浏览器 verify 绿 + esp32sim 截图 ≠ 真机验收。

## r51b / emu.yml 矩阵移除 image_gallery（CI 专有行为分歧，本地无法复现）

- **现象**：GitHub Actions 的 esp32sim 矩阵里 `examples/image_gallery` 间歇性失败（r47 绿、r48 一红一绿、r49/r50/r51 连红），失败模式固定：注入 frame 后 `runtime up; eval app` 打出、app 自己的 `js: gallery: eval start` 与首个 `create id=1 kind=4`（Image 节点）也打出，随后 eval 静默挂起——既无 `app eval ok` 也无 `eval failed`/`RELOAD ERR`，`[emu] stop` emulated 8.000s 正常结束。失败轮指令数 ~1.2G，本地成功轮 ~132M（9 倍分歧，块缓存 25572 vs 30729），说明 CI 上固件确实走进了不同的执行路径（疑似 Image 解码相关忙等/重试），但无任何错误日志。
- **已排除**：ROM 版本（本地换 CI 同款 pinned 20260528 ROM 重放 exit 0）、固件代码差异（本地与 CI 同源构建，同 app 同 frame 注入）、注入时序（RELOAD 在 2684ms 正常受理，crossfade 过渡正常 reveal）。本地（含 pinned ROM）反复跑均 exit 0。
- **处置**：emu.yml 截图矩阵移除 image_gallery（本地 `tools/emu/run.sh examples/image_gallery` 仍可用）。在此之前 playbook 已登记过「image_gallery 在模拟器里只有背景——先怀疑 esp32sim 图像绘制保真度」——本条是该已知问题的 CI 环境强化版：Image 节点的解码路径在 esp32sim + CI runner 组合下存在未定位的行为分歧。接板后用真机验收 image_gallery；esp32sim 的 Image/decode 保真度问题单独跟踪，不在 CI 门禁里硬扛。

## r45 / 1.8 寸板驱动级缺口收口（编译期 + 模拟器证据，仍无真机验收）

- **范围**：r45 收口 r44 登记的 1.8 V2（CO5300 + CST820/CST816S）profile 的三个**已实证**驱动级硬缺口，全部走编译期 profile 宏分派：① `lume_touch.c` 新增 CST816S 路径（`LUME_TOUCH_CHIP`，8-bit 寄存器 / 6 字节帧 @ 0x15），与默认板 CST9220 路径（16-bit 寄存器 / 10 字节帧）共存；② 1.8 板屏/触摸复位改走 TCA9554 IO 扩展器（`LUME_HAS_IO_EXPANDER_RESET`），默认板仍直接 GPIO；③ `LUME_LCD_COLUMN_OFFSET`（=16）真正接进 `lume_display.c` flush 路径。**默认 2.16 零回归**：新增代码全部落在默认板不编译的 `#if` 分支或取值为 0 的宏里，`idf.py size` 与 b66bebc 基线逐字节一致。**不动 vendored quickjs-ng/lvgl**；不做 SDMMC / ES7210 / 运行时切板（继续 open gap）；`runtime/types/lume.d.ts` 无变化；LVGL 未泄漏进 app 层。
- **实证纠正 r44 简报前提（以官方源为准，已回写 profile 头注释）**：① **0x15 是 I2C 从机地址，不是「芯片 ID 寄存器」**。CST816S/CST820 芯片 ID 寄存器是 `0xA7`（CST820=0xB7），FW/project 在 0xA8/0xA9；数据为 8-bit 寄存器，官方 `espressif/esp_lcd_touch_cst816s` v1.1.1~1 `esp_lcd_touch_cst816s.c:22-23,102-131` 从 `DATA_START_REG 0x02` 读 5 字节 `[num, x_h:4, x_l, y_h:4, y_l]`，Waveshare SensorLib `TouchDrvCST816.h/.cpp`（官方 1.8 demo）从 0x00 读 13 字节；esp32sim `esp32s3/src/i2c.rs` Cst820 模型给 0xA7..0xA9=B7/41/02。Lume 用「从 0x01 读 6 字节」的帧（gesture+5 字节数据），是官方 5 字节帧的超集。② **TCA9554 @ 0x20，REG_OUTPUT 0x01 / REG_CONFIG 0x03，LCD_RST BIT(0) / DSI_PWR_EN BIT(1) / TOUCH_RST BIT(2) / SD_CS BIT(7)**，来自官方 Waveshare ESP-IDF demo `examples/esp-idf/90_axp2101_pmu`、`92_qmi8658_imu` 的 `components/board_variant/board_variant.c:19-30,41-71` 与 BSP `waveshare/esp32_s3_touch_amoled_1_8` v2.0.3（`BSP_LCD_RST`/`BSP_LCD_TOUCH_RST = GPIO_NUM_NC`）；复位序列（config=~OUTPUT_MASK → 拉低所选复位位、SD_CS 保持高 20ms → 全高 150ms）同官方。③ **CO5300 16 列 gap = 0x10 确认**（BSP `BSP_LCD_CST816S_X_GAP` / `esp_lcd_panel_set_gap(panel,0x10,0)`、colorbar `V2_PANEL_X_GAP 0x10`、esp32sim `X_OFFSET=16`）。**`esp_lcd_panel_set_gap` 在 Lume 不可直接用**：`lume_display.c` 没有 `esp_lcd_panel_handle_t`（直接用 `esp_lcd_panel_io` 自绘 CASET/RASET/RAMWR），故按简报的备选路径在 flush_cb 的 CASET 源坐标加 `LUME_LCD_COLUMN_OFFSET`；init 表 CASET 保持 0..367，与官方 BSP/demo 一致（set_gap 只平移 draw 窗口）。LVGL 缓冲 / `capture_copy_area` / `px_count` 仍在逻辑坐标（offset 在 x2-x1 中抵消）。
- **如实记录：模拟器/编译期/官方源码证据 ≠ 真机验收**。三个缺口是**驱动级**收口：① CST816S 寄存器表来自官方驱动/datasheet/SensorLib 与 esp32sim 模型，② TCA9554 位映射与时序来自官方 demo，③ gap 值来自官方 BSP/demo/esp32sim。但**板子仍未上电点亮**：点屏、色彩、触摸方向与坐标映射（BSP identity 映射需实机核对）、16 列 gap 实机效果、TCA9554 复位时序与电压、CST820 芯片实际 ID、PMIC 上电、ES8311 音频、睡眠电流/触摸唤醒、WiFi/BLE radio、TF 卡、持久化、bundle 推送一律**未验证**。r44 的 esp32sim 368×448 截图只证明渲染管线在模拟器能跑，且其串口日志正好是 CST9220 协议打在 CST820 模型上的 `checkcode 00000000`，不证明任何板上行为。本轮既没有新增 esp32sim 触摸/复位/gap 逐项验证，也没有任何真机数据。
- **基线数字勘误（重要）**：r44 条目记录的默认板数字（Flash Code 1939820 / Flash Data 823440 / DIRAM 223747 / Total 2904983）是 **r44 当时的快照，已过时**。r44 之后到 `b66bebc` 之间的提交（`lume check` 一键校验、weather 示例、`13b521f` ui-bridge 双缓冲修复等）把默认板体积推到实测 **Flash Code 1940276 / Flash Data 823520 / DIRAM 224259 / IRAM 16384/16384（Remain 0）/ Total 2905519 / `lume.bin` 0x2c5630**。本轮「零回归」以 **b66bebc 实测基线**为准：改完后默认板 `idf.py size` 与该基线 `diff` 无任何差异（所有分区逐字节一致，IRAM 仍 16384/16384 Remain 0），而非与过时的 r44 数字比。
- **1.8 板构建绿且是真 1.8**：`idf.py -DSDKCONFIG_DEFAULTS="sdkconfig.defaults;boards/waveshare_esp32_s3_touch_amoled_1_8/sdkconfig.defaults" build` 绿 + `idf.py size`：Flash Code 1940008 / Flash Data 823256 / DIRAM 224243 / **IRAM 16384/16384（Remain 0，不超）** / Total 2904971 / `lume.bin` 0x2c5400。已按 r44 gotcha 把 tracked `firmware/sdkconfig` 移开重新生成、验证完恢复默认 sdkconfig 再复验默认板；`build/config/sdkconfig.h`、组件 `flags.make`、编译器 `.d` 依赖文件均指向 `1_8` 目录，`lume_touch.c.obj` 含 `CST816S` 字符串、`lume_board.c.obj` 含 `TCA9554` 字符串（CST9220/直接 GPIO 路径缺席），确认非旧板假绿。**恢复默认板时还踩到一个反向坑**：`mv` 回来的 sdkconfig mtime 早于已生成的 `sdkconfig.h`，CMake 会跳过重生成导致「静默仍构建 1.8」的假绿——必须 `touch sdkconfig`（或删 `sdkconfig.h`）强制重生成，复验时已处理并逐项核对 2_16 才收口。
- **「逐字节一致」口径**：`idf.py build` + `idf.py size` 输出（内存表）与基线逐字节一致。ELF/`lume.bin` 的**字节哈希不相等**：新增 `#if` 守卫/注释使源码行号位移，改动 `ESP_RETURN_ON_ERROR` 错误日志里 `__LINE__` 立即数与 DWARF 行表——各段字节数与默认板功能代码不变，属任何前置处理器分支改动的正常现象（已实证构建本身是确定性的：`touch` 单个源文件重链得到完全相同的哈希，排除时间戳/app_elf_sha256 非确定性）。简报列出的 `idf.py size` 数字才是本轮「逐字节」门槛。
- **本轮验证（全部宿主机）**：默认板 `idf.py build` 绿 + `idf.py size` 与 b66bebc 基线 `diff` 空；1.8 板 `idf.py build` 绿 + `idf.py size`（IRAM 不超）；`node tests/*.js` 22/22 全绿；C 宿主断言 `ota_protocol.c`（41 checks）、`apps_protocol.c`（39 checks）、`bridge_protocol.c`、`image_header.c`（2.16 与 1.8 两个 profile 各编译运行一次均 PASS）、`id3v2.c` 全绿；`npm test --prefix tools/lume` 33/33。未放宽任何既有断言；未改 prelude / bridge ABI / 帧协议，`tests/` 无需同步改动。
- **仍 open（与 r44 相同，外加全部真机验收）**：SDMMC-vs-SDSPI（TF 卡）、ES7210 缺失（恒不 ACK）、运行时切板 / 多板 CI / 真第二块目标演示、以及上一段列出的全部板级验收。`docs/roadmap.md` 的 M5 "Board abstraction for additional targets" **保持 `[ ]` 未勾选**：有第二块编译期 profile 且驱动路径已收口，但无运行时切板、无多板 CI、无真机点亮，不满足 "additional targets demonstrated"。

## r44 / M5 Board abstraction 第二块板（编译期 profile，无真机验收）

- **范围 = 第二块编译期 profile，默认板零回归**。`firmware/boards/waveshare_esp32_s3_touch_amoled_1_8/` 按 `firmware/boards/README.md` 六步流程新增（`lume_board_profile.h` / `sdkconfig.defaults` / `partitions.csv`），Kconfig `choice LUME_BOARD` 加 `LUME_BOARD_WAVESHARE_ESP32_S3_TOUCH_AMOLED_1_8` 与 `LUME_BOARD_DIR` 对应 default 行；默认仍是 2.16，`idf.py build` 默认命令不变。全部 56 个 `LUME_*` 宏名保留（驱动契约），另加一个仅作记录的 `LUME_LCD_COLUMN_OFFSET`。2.16 板源码、默认 defconfig、分区表均未改。
- **实证来源与冲突（以 Waveshare 官方 demo/BSP 为准）**：wiki 与官方仓库 `github.com/waveshareteam/ESP32-S3-Touch-AMOLED-1.8` 明确 V1（SH8601 + FT3168，2026-05-30 后停产）/ V2（CO5300 + CST820）两版，本 profile 针对 V2。引脚、368×448、16 MB flash / 8 MB PSRAM、CO5300 init 序列、QSPI 40 MHz / `lcd_cmd_bits=32` 逐项引自官方 BSP `waveshare/esp32_s3_touch_amoled_1_8` v2.0.3、官方 ESP-IDF `13_display_colorbar`、Arduino `pin_config.h` 与 `espressif/esp_lcd_co5300` v2.0.3 头文件，出处写在 profile 头注释。esp32sim 交叉对照：简报给的 `github.com/nousresearch/esp32sim` 为 404，真实上游是 `tools/emu/setup.sh:10` 固定的 `github.com/mikroverk/esp32sim`（commit `56ea9b2`）；其 `esp32s3/src/board/waveshare_amoled18.rs` 用 `Co5300::new(368, 448, 16)`、`X_OFFSET = 16`，与官方 `V2_PANEL_X_GAP 0x10` / `esp_lcd_panel_set_gap(panel, 0x10, 0)` 一致 → **column_offset 确认为 16，不是 0**。
- **简报前提被实证推翻（冲突清单，均写进 profile 头注释）**：① 触摸 IC 不是 CST9217/9220 家族（0x5A），V2 实际是 CST820/CST816S 家族 @ 0x15（V1 是 FT3168 @ 0x38）；`LUME_I2C_ADDR_CST9220` 宏名按契约保留但取值改为实证的 0x15。② 屏/触摸复位不是 ESP32 GPIO：官方 BSP 写 `BSP_LCD_RST` / `BSP_LCD_TOUCH_RST = GPIO_NUM_NC`，复位挂在 TCA9554 IO 扩展器（0x20）上。③ SD 是 1-bit SDMMC（CMD 1 / CLK 2 / D0 3），不是 Lume `mp3_decoder` 用的 SPI SDSPI，板上没有 CS 线。④ ES7210 在该板不存在（官方仓库 0 处引用；BSP 只用 `esp_codec_dev` + ES8311 单 codec）。⑤ AXP2101（0x34）、QMI8658（0x6B）、ES8311（0x18）在板上存在且有实证地址。
- **unsourced 值清单（不得静默猜测，全部标 `TODO(board): unsourced, verify on hardware`）**：`LUME_PIN_LCD_RST = 39`、`LUME_PIN_TP_RST = 40`、`LUME_PIN_SD_CS = 41`、`LUME_I2C_ADDR_ES7210 = 0x40` 都是从 2.16 profile 带入的**编译期占位值**，只为满足 `lume_display.c` / `lume_touch.c` 的 `1ULL << pin` 与 `lume_audio.c` 的地址契约能编译，不是该板真实连线；`LUME_PIN_SD_MOSI/MISO = 1/3` 是 SDMMC CMD/D0 的编号映射（总线语义不同，已注明）。接板轮必须逐一核对。
- **半成品如实记录：现有驱动路径与该板硬件并不完全兼容，直接烧板不能保证点亮/触控**。① `lume_touch.c` 说的是 CST9220 的 16-bit 寄存器 / 10 字节帧，CST820 是 CST816S 协议，需新增 CST816S 驱动路径；② `lume_display.c` / `lume_touch.c` 用直接 GPIO 复位，而该板复位经 TCA9554，需经 IO 扩展器；③ `flush_cb` 直接把 LVGL 区域 `[x1,x2]` 写进 CASET，未加 16 列 offset，部分刷新会落到物理列 0..367 而不是 16..383；官方做法是 `esp_lcd_panel_set_gap(panel, 0x10, 0)`，`lume_display.c` 目前没有对应能力，`LUME_LCD_COLUMN_OFFSET` 只记录已确认的值，应用它需改驱动；④ `mp3_decoder` 的 SPI SD 与板上 SDMMC 不匹配；⑤ ES7210 地址恒不 ACK。这些**不是「待验收」，而是已知的、需要驱动改动才能接板的功能缺口**。本轮按「不改公共驱动、2.16 零回归」的硬约束只交付编译期 profile，不假称可上板。
- **全部板级验收留接板轮**：点屏、色彩、触摸方向与坐标映射（BSP 的 `swap_xy/mirror_x/mirror_y = 0` 已作为 profile 的 identity 映射，但需实测）、16 列 gap、PMIC 上电时序与电压、ES8311 音频、睡眠电流 / 触摸唤醒、WiFi/BLE radio、TF 卡、持久化、bundle 推送，一律未验证。`docs/roadmap.md` 的 M5 "Board abstraction for additional targets" **保持未勾选**：只有一块新板 profile、无运行时切板、无多板 CI、无真机验收，不满足 "additional targets demonstrated"。
- **验证（全部宿主机）**：默认板基线 `idf.py build` + `idf.py size`：Flash Code 1939820 / Flash Data 823440 / DIRAM 223747 / **IRAM 16384/16384（100%，Remain 0，无溢出）** / Total 2904983 / `lume.bin` 0x2c5410；改完后再跑默认板逐字节一致（IRAM 16384/16384、Total 2904983）。新板 `idf.py -DSDKCONFIG_DEFAULTS="sdkconfig.defaults;boards/waveshare_esp32_s3_touch_amoled_1_8/sdkconfig.defaults" build` + `idf.py size` 绿：Flash Code 1939832 / Flash Data 823392 / DIRAM 223731 / **IRAM 16384/16384（Remain 0）** / Total 2904931；`build/config/sdkconfig.h` 的 `CONFIG_LUME_BOARD_DIR`、组件 `flags.make`、编译器 `.d` 依赖文件与分区表全部指向 `1_8` 目录，确认不是旧板假绿。**切板必须先把 tracked `firmware/sdkconfig` 移开让它重新生成**（ESP-IDF 里已有 sdkconfig 的存量值优先于 defaults，否则 `-DSDKCONFIG_DEFAULTS=...` 会静默构建旧板；已记入 `boards/README.md`），随后恢复默认 `sdkconfig` 再验默认板。
- **host 回归**：`node tests/*.js` 21/21 全绿；这些 harness 通过 `__lumeScreen` 注入屏尺寸、用的是 board-independent prelude，对新板宏无 480×480 刚性假设，未改任何断言。`npm test --prefix tools/lume` 23/23。C 宿主断言 `ota_protocol.c`（41 checks）、`apps_protocol.c`（39 checks）、`bridge_protocol.c`、`image_header.c` 全绿；`image_header.c` 还分别用 2.16 与 1.8 两个 profile 的 `LUME_LCD_H_RES/V_RES` 各编译运行一次均 PASS，确认对新板几何的容忍度。未放宽任何既有断言语义。
- **esp32sim 截图（仅交叉对照，不能当真机验收）**：上游 pin 的 `esp32sim` 已内建 `waveshare-amoled18-v2` 板型，无需给 `tools/emu/esp32sim-56ea9b2-lume.patch` 加映射；以 `EMU_SKIP_BUILD=1 EMU_BOARD=waveshare-amoled18-v2` 用新板固件跑通 `tools/emu/run.sh examples/counter`，产出 368×448 PNG，`RELOAD OK` 与两次 `app eval ok` 都在。但串口日志里触摸探测是 `checkcode 00000000` / `resolution 0 x 0` / `chip type 0x0000`，正是 CST9220 协议打在 CST820 模型上的结果；截图也无法验证 16 列 gap、方向、色彩、时序。**这张图只证明 368×448 的渲染管线在模拟器里能跑，不证明任何板上行为。**

## r43b JS 运行时优化（GC 测量 / 字节码装载）；真机验收待接板

- **不做 size-class 分流分配器**：esp32sim 上 `counter` / `games_snake` 各 30 s 实测 GC 仅 3 次 / 约 4.8 ms，全在启动阶段，稳态 0 次；三个分母下 GC 耗时占比均 <5 %。按本轮 B2 判定「暂不需要」，未改 `JS_NewRuntime2` 分配器，也就未动已满线的 IRAM（16384/16384）。数据与口径见 `docs/r43b-gc-report.md`。
- **字节码装载只在 esp32sim 验证**：`qjsc -b -C` 产出的字节码能被真机固件的 `JS_ReadObject` + `JS_EvalFunction` 装载；版本不匹配会返回负错误码、`ESP_LOGE` 并回退，不崩溃。实际启动时间、真机装载耗时、`--bytecode` 经 USB/WiFi-OTA 推送（VER 预检、STORE/LAUNCH 二进制落盘、ACK 时序）和长跑 GC 行为留接板轮。见 `docs/r43b-bytecode-report.md`。
- **字节码体积大于源码**：qjsc 默认保留源码/调试信息（counter 4694 B vs 源码 2160 B；snake 12173 B vs 3718 B）；收益在装载耗时（counter 15.7→10.4 ms，snake 35.8→19.5 ms，均为 esp32sim 观测值）。剥离（`-s`/`-s -s`）与压缩留后续评估，本轮不改默认。
- **字节码与 QuickJS-NG 版本强绑定**：`QJS_VERSION_*` 与 `BC_VERSION` 不匹配时 CLI 本地拒包、固件 `RELOAD ERR bc-version`。升级 vendored quickjs-ng 后必须重跑 `tools/lume/fetch-qjsc.sh` 并重新烧固件。
- **协议能力不向后兼容**：`LUMB` 帧与 `VER` 命令是新增能力；旧固件把 `LUMB` 当 bad-magic 重同步、把 `VER` 回 `CMD ERR verb`。源码模式不查 VER，因此旧固件仍可正常推源码。

## r36 gravity_ball (was `examples/imu_ball`): single-ball demo; board tuning pending

- `examples/gravity_ball` (renamed from `examples/imu_ball`, and its host
  harness from `tests/imu_ball.js` to `tests/gravity_ball.js`) is a minimal demo
  after the r36 maze game: the canvas
  shows one ball, tilt drives a constant in-plane acceleration, edges reflect
  with a fixed restitution, linear damping and a speed cap bound the motion.
  The maze (walls, holes, goal, per-level timer, best times, PCM beeps) was
  removed together with its audio/KV usage. There is still no rolling-friction
  parameter table, mechanical tilt simulation or ball rotation rendering.
- QMI8658 acceleration is converted to m/s² in the native driver; the app maps
  `ax` to screen x and `ay` to screen y (`AXIS_X`/`SIGN_X`/`AXIS_Y`/`SIGN_Y` at
  the top of `app.js`). Board feedback: tilting left raised `ax`, i.e. the raw
  axis is opposite to screen +x, so `SIGN_X = -1`. `SIGN_Y`, `GAIN` and
  `DEAD_ZONE` are still tuned by eye on the board.
- The Canvas is 480×480 and redraws at 20 fps, but a frame now repaints only
  the ball's old+new box (50 draw records, ~3k pixels for the default
  `BALL_R = 24`) instead of the whole canvas; the host harness pins that budget
  and replays the rect commands to assert one ball and no ghost. Board frame
  rate, bounce feel, the Y sign and display latency still await board
  acceptance — a green host harness is not a hardware check.


## r34 host fixes; board acceptance pending

- Hot-reload staging ownership, Queue B gesture FIFO and release delivery,
  256-byte UTF-8 UI text, and asynchronous CREATE failure notices have host
  coverage and firmware compile checks. Concurrent reload pressure, touch feel,
  a low-PSRAM CREATE failure, and long Chinese labels on the display remain
  for the board round.
- A failed CREATE reserves its node id until the next runtime reset. The JS
  effect owner is disposed and later native calls on the id become no-op.
  This avoids stale JS references mutating a newly reused id; a sequence of
  many failed creations can exhaust the 127 app node ids until reload.
- Firmware has no linked `console`; create failures use `lume.warn` to emit
  one `ESP_LOGW` record per failed node.

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
- **r43b 起源码与字节码路径共存**：`LUME` payload 仍直接当 JS 源码 `JS_Eval(...GLOBAL)`；`LUMB` payload 走 `JS_ReadObject` + `JS_EvalFunction` 的 qjsc 字节码（详见 `docs/r43b-bytecode-report.md`）。源码仍是默认路径，字节码为 `--bytecode` 显式选项；引擎按 `LQBC` 头自动分流，两条路径共用一个 staging 槽。
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
- `padding` and `margin` accept one value for all four sides; `paddingTop/Right/Bottom/Left` and `marginTop/Right/Bottom/Left` override a single edge and are always sent after the box shorthand (bridge ids 30–38). `margin` maps to `lv_obj_set_style_margin_*`, which only affects flex placement — it is ignored by a parent without a flex layout.
- `flexGrow` (integer 0..255) maps to LVGL's `lv_obj_set_flex_grow` and only redistributes free space on the main axis of a flex parent. There is no `flexShrink`/`flexBasis` (LVGL has no equivalent), no reverse direction, no `alignSelf`, and no grid.
- `align` accepts an `ALIGN_*` constant (0..20, all exported) or its kebab-case name; `alignTo` (node id, 0 = parent) plus `alignOffset {x,y}` use `lv_obj_align_to`. Alignment is still the last attribute applied, so it overrides `x`/`y` on the same node; a base node that has been removed silently falls back to parent alignment.
- `alignTo` is a one-shot computation, not a constraint: LVGL's own contract is that `lv_obj_align_to` must be re-run whenever the base object moves or resizes. A base that is later re-laid-out by a flex parent (or whose text/size changes) leaves the aligned node at its old offset until something re-sends `ALIGN`. Use it against static bases; for dynamic ones prefer flex/`justifyContent`.
- `align` values 9..20 are LVGL's `LV_ALIGN_OUT_*` set (`outside-*`, plus `above`/`below`/`left-of`/`right-of` for the mid edges). They place the node next to a base rather than inside it, so they are only meaningful with `alignTo` (or `alignTo:0` for the parent); without a base object the bridge falls back to centring.
- `width`/`height` accept `'auto'`, which maps to `LV_SIZE_CONTENT` and counts as an explicit size (a stretch parent will not overwrite it). `minWidth`/`maxWidth`/`minHeight`/`maxHeight` bound the computed size; they are only checked by LVGL during layout, so they need either `'auto'` or a layout parent to matter.
- Containers are **not scrollable by default**: the bridge strips LVGL's `LV_OBJ_FLAG_SCROLLABLE` from every `View` at creation (LVGL's own default is scrollable + `LV_SCROLLBAR_MODE_AUTO`, so an overflowing flex child used to grow a scrollbar and swallow drags before the gesture recognizer saw them). `style.scroll` re-adds the flag; `scroll:'none'` stays accepted as an explicit no-op. `Text`/`Button`/`Arc` keep LVGL's default so a label's `longMode:'scroll'` still works, and the active screen is handled where the global gesture registers. Board acceptance of the new default is pending.
- Containers also **zero the default theme spacing**: LVGL's default theme wraps every bare `lv_obj` in its `card` style, which on this 480x480 panel (`DISP_MEDIUM`) adds 20px padding on all four sides plus 12px flex row/column gaps even when the app sets neither `style.padding` nor `style.gap`. The bridge zeroes `pad_all`/`pad_row`/`pad_column` at `View` creation, so unset means 0 and explicit `padding`/`gap` are the only spacing. This shifts any container whose layout silently relied on the hidden insets or row gaps; those spots must set `padding`/`gap` explicitly. Local styles always win over the theme, so nothing written before changes value.
- `position:'absolute'` sets `LV_OBJ_FLAG_IGNORE_LAYOUT`, which takes the node out of the parent's flex flow so `x`/`y` apply. There is no z-index or re-parenting beyond creation-time `parent`.
- `translateX`/`translateY` accept integer pixels or an integer `0%`–`100%` of the node's own size and are applied after layout, so they survive `align` (unlike `x`/`y`). They are not animatable through `transition`/`lume.anim` yet.
- `textAlign` and `longMode` apply to `Text` and to a `Button` caption (the bridge redirects them to the label child); on a `View` they are no-ops. Default LVGL behaviour is `wrap`, so long text reflows instead of clipping unless `longMode` says otherwise.
- There is no percentage sizing on properties other than width/height (+ translate). Percentage size is relative to the parent's LVGL content area, translate to the node's own size. `padding`/`margin`/`gap`/`x`/`y` remain integer pixels because LVGL resolves those as fixed coordinates; a percentage pad would need a measurement round trip that the bridge does not have.
- `Row`/`Column` are thin prelude wrappers over `View` that force `display:'flex'` and the row/column axis; they add no node kind or bridge message.
- Still missing by design: grid layout (LVGL has it, but it needs column/row descriptor arrays that the 112-byte fixed record cannot carry), `flexShrink`/`flexBasis`/`alignSelf` (no LVGL equivalent), `row-reverse`/`column-reverse` flow, and aspect ratio (no LVGL 9.3 style for it).
- `lume_demo_js` is the boot fallback and `examples/counter/app.js` is its source equivalent. Flex appearance, stretch sizing, margin/grow distribution, `alignTo`/outside placement, content sizing with `min`/`max`, `translate`, text wrap/clip, and touch placement still require board visual acceptance.

## r15 M3 animation primitives

- `transition` applies to numeric `x`, `y`, pixel `width`/`height`, and `opacity`. A signal getter supplies the initial value via `SET_ATTR`; later changes send `ANIMATE` with omitted `from`, so the LVGL task samples the current value. `lume.anim.to` offers an optional `from` and completion callback; `lume.anim.cancel` stops one attribute. A new animation on the same node and attribute replaces its predecessor.
- `transition.property: 'bg'` is accepted for API shape, but reactive color updates are immediate `SET_ATTR` changes; color interpolation is unavailable. There are no keyframes, multistage timelines, or spring physics curves. Easing is limited to LVGL linear/ease-in/ease-out/ease-in-out. Duration is an integer from 1 to 60000 ms.
- Completion events share the 16-entry LVGL→engine event queue with presses. On overflow completion is logged and dropped; its JS callback will not run. Callback references are released on replacement, cancel, removal, or runtime recycle; a dropped completion remains registered until one of those events.
- The example's `y` movement uses LVGL object coordinates. Visual smoothness, flex interaction, and touch timing await board testing.

## r16 Canvas MVP

- Canvas uses vendored LVGL 9.3 `lv_canvas_create` and `lv_canvas_set_buffer` with RGB565 pixels allocated by `heap_caps_malloc(..., MALLOC_CAP_SPIRAM)`. Buffers are owned by the bridge and released after LVGL object deletion. A canvas is at most 480×480; all live canvases share a 460,800-byte budget. Actual allocation is `lv_draw_buf_width_to_stride(width, LV_COLOR_FORMAT_RGB565) × height`; for an even width this is `width × height × 2`. The 220×120 example uses 52,800 bytes; a 480×480 canvas uses 460,800 bytes (~450 KiB). This budget is in addition to the JS heap, display draw buffers, and app staging in PSRAM.
- `onDraw` is an owned signal effect. It runs at creation and once per changed signal value read in its previous run. Each call posts fixed-size raster commands through Queue A, followed by one `CANVAS_INVALIDATE`; the LVGL timer drains them in order. There is no per-frame callback. The chosen one-way queue avoids blocking LVGL on the engine task or sharing a mutable pixel pointer across tasks. Large polylines can spend multiple timer periods posting and are limited to 240 points. The sample uses 12 points.
- Frame atomicity (previously "draws are not atomic against an intermediate LVGL refresh"): each canvas owns two RGB565 images — `front` (what `lv_canvas` displays) and `work` (raster target) — and the frame-closing `CANVAS_INVALIDATE` publishes the finished one: a full redraw swaps the two buffers, a dirty rect copies just that rect onto the front image. A refresh can therefore never blit a half-drawn canvas (previously visible as a flickering arc and an intermittently missing needle on the speedometer gauge). Costs: two canvas-sized PSRAM buffers per node — the canvas budget is now two framebuffers, and if the second allocation fails the node falls back to single buffering with a warning instead of failing to create. Canvas text still goes through `lv_canvas_finish_layer()`, which invalidates the canvas itself and busy-waits on LVGL's global draw-dispatch flag in `LV_USE_OS=0` builds; the text path therefore points the object at `work` with display invalidation suppressed for its duration.
- Redraw cost on the board (measured with a probe app, 432×344 gauge, 276 segments): one `onDraw` cost ~205 ms before and ~86 ms after the prelude fast path (one-entry color cache instead of a per-segment regex, integer fast-path range checks, single-pass `polyline`). The engine itself runs at ~0.5 Mops/s on this port (`for` loop 2.2 µs/iteration, `Math.cos` 16 µs, one `ctx.line()` ~450 µs before the fast path), so a JS-built gauge tops out near 10 fps. Static dial geometry (arcs, ticks, labels) should move to native `Arc`/`Text` widgets when a higher rate is needed.
- Retained paths: `retainPath(points, color, width)` / `retainSegments(segments, color, width)` upload geometry once and return a canvas-local path id; `drawPath(id, dx, dy)` replays it from C. Limits: 8 paths per canvas, ≤240 segments per path, 32 KB PSRAM for all retained paths (`lume_ui_bridge.h`); a define for an occupied id replaces the old geometry. Measured on the board, a full 432×344 repaint that used to rebuild 276 segments in JS (68.7 ms of JS per frame, ~9 fps) now costs 3.5–4 ms of JS and runs at ~27 ms per frame (~36 fps). Rasterisation is span based (one row run per span, 32-bit paired stores) and the whole frame is applied by the LVGL task: 1.36 ms average drain, 42 ms maximum for a full-canvas burst. Retained paths are dropped when their canvas node is removed or the app UI is reset; there is no way to read back or resize one.
- Rasterisation has **no anti-aliasing**: a stroke is an integer Bresenham centreline stamped with an axis-aligned square brush and written as pure colour, so a 4–5 px stroke shows 4–5 px staircase steps on shallow slopes. Sampling density is not the limit — a 2° step at r=158 is a 5.5 px chord with a 0.024 px sagitta — so finer polylines do not smooth the arc. Native `Arc` widgets render through an LVGL mask (8-bit coverage) and are therefore smooth. Planned fixes (coverage-based canvas AA, a native annulus op, or sampling the bands with `Arc` widgets) are tracked as items 1–3 of "Rendering backlog" in `docs/roadmap.md`.
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
- Counter, files, and device_monitor DOM assertions and screenshots are in `artifacts/simulator`. Hardware visual acceptance remains for the board round.

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
- **真机验证（r30 接板，已通过）**：固件由 CI（`espressif/idf:v5.5.5`）构建，产物 `lume-firmware-7` 经 `esptool.py write_flash @flash_args` 烧入板子（hash verified）。启动日志 `boot app 'dashboard' (5243 bytes)` → `runtime up; eval app 'dashboard'` → `app eval ok; entering event loop`，证明存储读取、boot 恢复与 UI 构建在真机成立。命令通道：`lume apps list` 返回 `dashboard / device_monitor / file_manager` 三个已安装 app；`lume apps launch device_monitor` 收到 `RELOAD OK` 且随后日志出现 `js: device_monitor refresh #41`（旧 app 的 timer 已随 runtime 释放）；`lume apps home` 收到 `RELOAD OK`，设备回到 home 网格，从网格点击图标又能启动 app 并写回 `.current`（硬件复位后再次 boot 到该 app）。**切换后只有一个 app 存活这一点在真机上得到确认**。
- **真机暴露并已修复的缺陷**：`LIST` 最初在板上**完全没有回复**（既无 `CMD OK` 也无 `CMD ERR`，连 `frame rejected` 都没有）。根因是 `lume_apps_list()` 把 2 KiB 的 id 表放在调用者栈上，而 `LIST` 跑在 4 KiB 栈的 USB/OTA RX 任务里，进入 LittleFS 前就溢出复位。修复：id 表改 PSRAM 分配（`lume_apps.c`），并把 `USB_RX_STACK` / `OTA_TASK_STACK` 提到 8 KiB（两个 RX 任务现在都要解析命令并访问 LittleFS，不再是纯 memcpy）。提交 `a0d0041`。这类缺陷主机 harness 结构上无法覆盖——host 没有任务栈。
- **仍未验证**：① 真机 LittleFS 写入/擦除耗时与 `lume dev` 反复安装的寿命影响；② 200 KiB 级 bundle 的 `STORE` 耗时与安装失败的掉电表现；③ 切换延迟的量化值（可用但未计时）、切换瞬间的闪烁/黑屏；④ home 网格的观感、图标尺寸与点击手感是否达标；⑤ 多 app 长时间使用下的内存碎片；⑥ `lume apps remove` 与 `-6 busy` 分支只在主机 harness 覆盖，真机未逐例验证。
- **roadmap 不动**：`docs/roadmap.md` 未修改；多 app 属于 M5 组件库/启动器方向的落地，里程碑定义与验收项仍由接板轮维护。
## r31 / M5 Board abstraction 第一刀（编译期单板 profile）

- **范围 = 编译期 profile，仅一块板**。本轮把「换一块板要改哪些文件」收敛到
  `firmware/boards/waveshare_esp32_s3_touch_amoled_2_16/`：`lume_board_profile.h`
  （引脚 / 分辨率 / I2C 地址 / QSPI 时序 / CO5300 init 序列 / 触摸方向映射，
  全部编译期宏）、`sdkconfig.defaults`（板级 flash/PSRAM/console/partition/
  LVGL 值 + `CONFIG_LUME_BOARD_*` 选择）、`partitions.csv`（板级 flash 布局）。
  `lume_pins.h` 退化为 re-export shim；`firmware/boards/README.md` 写清新增板的步骤。
  默认板 = Waveshare，**行为零变化**（所有值不变，仅来源变了）。
- **机制取舍（以 ESP-IDF v5.5.5 实证为准）**：`Kconfig.projbuild` 的
  `choice LUME_BOARD` + 派生的隐藏 `LUME_BOARD_DIR` 字符串，驱动
  `lume-board/CMakeLists.txt` 的 `INCLUDE_DIRS`；顶层 CMake 用
  `SDKCONFIG_DEFAULTS` **列表**（`project.cmake:680-686` 实证支持多文件）叠加
  common + 板级 defconfig。未发明私有格式，未改动 `idf.py build` 默认命令。
  另一条 `-DSDKCONFIG_DEFAULTS="sdkconfig.defaults;boards/<name>/sdkconfig.defaults"`
  路线已写入文档，但**无第二块板可实测**，仅验证过默认列表生效。
- **不做运行时热切板 / 多板 CI 矩阵 / 真实第二块板**：profile 全是编译期常量，
  没有链接任何运行时切换代码；「additional targets」尚未有第二块板实证，
  `docs/roadmap.md` 的 M5 Board abstraction **保持未勾选**。
- **IRAM 已满的硬约束（逐项对比）**：基线 `eb1345f` → r31 最终：
  Flash Code 1665362→1665370（+8，日志格式串多一个参数）、Flash Data
  378396→378348（−48，缩短日志/错误串）、DIRAM 228191→228191（0）、
  **IRAM 16384/16384→16384/16384（100%，Remain 0，无溢出）**、
  Total 2191757→2191717（−40，更小）；`lume.bin` 0x217210→0x2171e0，
  app 分区仍余 67%。Kconfig choice / defconfig / 分区表路径整层是配置改动，
  **零代码字节增量**（task 2 与 task 3 之后 size 完全一致），未拉入任何
  `noflash`/IRAM 符号。Flash Code 的 +8 字节来自把两处日志里的地址字面量
  改成 `%02x` 格式串（多传一个参数），属可解释的近似零增量。
- **JS prelude 的 `480` 曾是明确的例外（r32 已解决）**：r31 时
  `firmware/components/lume-engine/lume_scripts.c` 内嵌 JS 的 canvas 坐标钳位
  和 `480*480*2` 预算仍为字面量。该字符串由 `tests/lib/prelude_runner.js`
  按「每行一个字符串字面量」正则逐字提取，C 宏插值会破坏提取；且 r31 明确
  「JS 层不应有行为变化」。**所有 C 侧**分辨率/引脚/地址字面量已引用 profile，
  `git grep` 在 main/components 的 C 代码中无游离板级魔数。后续方案见 r32。
- **tracked `sdkconfig` 与 defconfig 的优先级**：ESP-IDF 里已有 `sdkconfig` 的
  已存值优先于 defaults。移动分区表后必须同步改 `firmware/sdkconfig` 里的
  `CONFIG_PARTITION_TABLE_CUSTOM_FILENAME` / `FILENAME`（本轮已改并提交，
  diff 仅 2 行路径 + 新增的 Lume board 菜单符号）。新板切换时也要更新这两行
  或删除 `sdkconfig` 重新生成，否则仍指向旧板分区表——已写入 `boards/README.md`。
- **验证范围（无板，均为宿主机）**：ESP-IDF v5.5.5 完整 `idf.py build` +
  `idf.py size`（绿，IRAM 达标）；11 个 JS host harness 全绿、
  `npm test --prefix tools/lume` 10/10、`bridge_protocol.c` / `ota_protocol.c` /
  `image_header.c` 三个 C 宿主断言全绿、`python3 scripts/check_website.py`
  81/81 绿（补齐 4 条 `lume.ui.shell.*` + 实证多出的 `lume.net.otaStatus`，
  并补上 gallery 的 `examples/shell_demo/`）。真机显示/触摸方向、bundle 推送、
  音频、睡眠电流、radio、持久化等一律留接板验收。

## r32 / prelude 屏宽屏高运行时注入

- `lume_engine.c` 在每次新 QuickJS runtime 注册 native bindings 后、eval prelude 前，
  把选中板 profile 的 `LUME_LCD_H_RES` / `LUME_LCD_V_RES` 注入内部全局
  `__lumeScreen = {w, h}`。这不是公开 JS API；默认板仍为 480×480。
- prelude 的 Canvas 宽高、PSRAM 总预算以及 fillRect/line/circle/text 坐标上界
  改用注入值。内置 home 根容器高度原本意在铺满屏幕，也改为注入的屏高。
  `tests/lib/prelude_runner.js` 的 VM 注入同名全局；模拟器直接使用该 runner。
  新增 390×390 harness 覆盖尺寸、预算和绘图边界。
- 不能在 `lume_scripts.c` 的内嵌 JS 字符串中直接插 C 宏：host 提取器以
  `/^"(?:\\.|[^"\\])*"/gm` 逐行匹配以 `"` 开头的字符串，宏 token 行会被
  忽略，同一行的后半个字符串也会丢失。运行时属性注入保持提取器与固件
  执行同一份 prelude。
- `ba98394` 干净基线 → r32 最终（差值还包含开工前已在 `origin/main` 的
  `ca8236a` 和 `1ed8336`）：Flash Code 1675574→1675718（+144），Flash Data
  393180→393228（+48），DIRAM 229551→229551（0），**IRAM
  16384/16384→16384/16384（0，未溢出）**，Total 2216753→2216945（+192）。
  `idf.py build` + `idf.py size`、12 个 JS harness、CLI 14 项和网站检查均通过。
  无真机，本轮不声明板上行为已验证；M5 Board abstraction 仍未勾选。

## r33 / WiFi 扫描（lume.net.scan）同步阻塞

- 新增 `lume.net.scan()`（`lume_net.c` 同步实现 + `lume_engine.c` `js_net_scan`
  绑定）：全信道主动扫描，返回按 RSSI 降序的 `{ssid, rssi, auth}` 数组（上限
  20，`ssid === ''` 为隐藏 AP，`auth` 为 wifi_auth_mode_t，0 = open），失败
  返回负错误码。结果由 `examples/settings` 扫描页用于选择并连接网络。
- **同步阻塞是本轮接受的简化**：扫描期间引擎任务被阻塞 ~1.5-3 s（与 r11 同步
  httpGet 同一取舍），触摸/热更新事件停摆，设置应用 UI 冻结；异步扫描留待后续
  轮次。扫描需要 station 已启动；关联过程中驱动可能拒绝扫描（-2）。
- open（auth 0）网络不可连：`connect()` 固定 WPA2-PSK 阈值（r11 契约不变）。
- 真实扫描结果（AP 列表、RSSI 准确度、关联中扫描行为）属板上验收项，本轮仅在
  macOS 主机侧做 JS/host 验证；**`idf.py build` 需在 Linux + ESP-IDF v5.5 构建
  机上执行，本机无法编译验证**——esp_wifi_scan_* 的 API 形状已按 IDF v5.5 头文
  件书写，`lume_net.h` 注释中标注了上线前需对照构建机源码复核。

## r34 / 启动器状态栏 WiFi 标志（内置 home）

- `lume_home_js` 状态栏在时钟与电池之间新增一个 WiFi 文本标志（+1 节点，9 个
  app 时 home 共 47 节点，远低于 128 上限）：`wifi`（GOT_IP）/ `wifi~`（已关联
  待 DHCP）/ `wifi..`（连接中）/ 空隐藏（station 未初始化或空闲未连接）。
- 只读设计：30 秒随时钟轮询 `lume.net.status()`，**绝不调用 init()/connect()**
  ——启动器不会拉起 WiFi，也不会打扰任何应用的连接状态。未初始化时 status()
  返回负数 → 标志隐藏（每 30s 一条 ESP_LOGW 属预期日志）。
- ASCII 文本：默认 LVGL 字体无 Unicode 图形，图标样式留待字体轮次。
- 宿主验证：5 种 net 状态的标志文本、响应式 attr 更新、节点预算（47/128）。
  **板上验证随下次 Linux 固件构建**：状态栏布局（3 元素 space-between 在空标志
  时的表现）与真实 net 状态切换需真机确认。

## r34 AI infrastructure: deferred board acceptance

- `lume.ai.chat()` is synchronous. The JS engine task blocks through network completion, so the loading state may not paint and touch stops responding for up to the 120-second configured cap. Promise job draining landed in r56, but an async/SSE native transport is still deferred.
- Nonstreaming responses are capped at 32 KiB. Larger JSON is marked truncated and `chat()` returns `-4`; no partial answer is shown. Request bodies are capped at 16 KiB to bound copies and memory use. The cap accommodates ordinary short message histories but excludes very long system prompts.
- `examples/ai_chat` cycles preset questions because the UI has no keyboard. It pages answers to respect the existing 256-byte UI text payload cap. Non-ASCII text can hit the byte cap before its 80-character page size.
- The API key and WiFi credentials are plaintext in NVS. Physical flash readers can recover them. Provision through a private local app; never commit keys. No secure element or encrypted NVS has been added.
- TLS uses IDF's certificate bundle or a caller-provided CA. Explicit `httpsInsecure` skips validation and is unsafe. A verified TLS handshake requires correct time; SNTP provisioning is a board prerequisite. If clock setup fails, use a local HTTP test server or controlled test-only insecure mode, never production credentials.
- Host harnesses check request shape, key storage, response/error handling, and a Node local HTTP POST round trip. The latter does not execute ESP-IDF C transport. Real WiFi, TLS, DeepSeek response, and on-device UI behavior await board acceptance.

## r35 / 真机截图调试通道（SHOT 命令）

- `lume screenshot [file.bmp] [--port|--ota --token]`：向设备发 `SHOT` 命令帧
  （`lume_cmd.h` 新动词），设备抓一帧当前屏幕并以文本行回传（`SHOT <w> <h>
  <bytes> <crc>` 头 + `S64<base64>` 数据行 + `SHOT OK` 尾），CLI 校验 CRC 后
  写 24 位 BMP。语法与协议见 `docs/build.md` "Debug screenshot"。
- 抓帧方式：`lume_display.c` 的 `flush_cb` 在面板字节交换**之前**把每个刷新
  区域拷入 PSRAM 影子缓冲（小端 RGB565，无 stride padding），`REFR_READY`
  事件点整帧完整；布防时由 LVGL 任务整屏 invalidate 强制一次全帧刷新。
  未采用 `lv_snapshot`（避免依赖 LV_USE_SNAPSHOT 配置，且直接捕获面板实际
  合成结果）。
- **接受的本轮简化**：(1) 影子缓冲 460800 B（480x480 RGB565）首次截图时分配
  并常驻 PSRAM 不释放，换取取消/竞态下的内存安全（flush_cb 永不写入已释放
  内存）；(2) 同一时间只允许一次截图（USB 与 TCP 并发 SHOT 返回
  `CMD ERR shot-busy`）；(3) 显示暂停（panel asleep）期间截图挂起，设备侧
  5 s 超时回 `shot-timeout`，唤醒后才补拍；(4) 每帧 240 B 一行 base64 传输
  （~614 KB 行流量，USB 全速下约 1 s），未做二进制帧；(5) 仅 CLI 触发，尚未
  暴露 `lume.screen.capture()` JS API。
- 宿主验证：`tests/apps_protocol.c` SHOT 解析用例（37 checks 全绿）、
  `npm test --prefix tools/lume` 17 项全绿（含 mock 设备的 SHOT 往返、日志
  噪声过滤、CRC/截断错误路径、BMP 编码像素序）。
- **真机验收（通过，2026-11-14，USB 通道）**：固件烧录后连续两次
  `lume screenshot` 成功，各 ~1 s；480x480 BMP 内容与面板一致（home 启动器
  网格 + 状态栏时钟/电池，首拍 01:47），第二次拍摄验证了影子缓冲复用路径
  （两帧差异仅为时钟分钟数变化）。仍待验收：休眠/唤醒期间的 `shot-timeout`
  补拍行为、WiFi TCP 通道截图、与高频日志应用的并发噪声。

## r35 / Games examples (host acceptance only)

- `examples/games_2048`, `games_snake`, and `games_breakout` are standalone single-file app bundles. Four tiny helpers (fixed timer, `hiscore.<game>` KV (Breakout uses `hiscore.brkout` to fit the 15-character NVS key limit), short 16 kHz stereo PCM beep, AABB) are duplicated in each app so direct deploy needs no import or shared file. The game rules are plain functions before `/* GAME UI */` for host logic tests.
- Timers use the existing engine drain; 40 ms Breakout ticks target about 25/s, Snake starts at 180 ms and speeds up to 80 ms, while IMU polling is 50 ms. The 20 ms timer drain quantization and synchronous 12–48 ms audio calls can delay input and frames. There is no `requestAnimationFrame`, sprite/keyframe animation system, or general collision/physics engine. 2048 uses a simple width transition; Breakout uses basic AABB and axis reflection.
- Canvas redraws reuse retained pixels. Snake changes at most the head, tail and food cells after the first paint. Breakout paints old/new entity rectangles and keeps bricks as separate Views. This limits raster command count, but display invalidation and PSRAM/QSPI flush timing still require measurement on the board. The simulator proves structure and visible pixels, not FPS.
- IMU `ax`/`ay` signs and the 2.4 m/s² steering threshold are default estimates. Physical board tests must tune direction and sensitivity, verify round-edge touch, audio latency/level, actual frame pacing, and KV persistence through restart.
## r37 / M5 Dialog、Toast 与 shell spacing

- `runtime/shell.js` 是可选 bundle 模块。导入后 `lume.theme.set({colors, radius, spacing, fontScale})` 接受 `spacing` 非负整数像素；未显式设置 `View.style.padding` / `gap` 时，两者使用此值。局部显式值（含单边 padding）优先；换主题会更新继承值。未导入 shell 的内嵌 prelude 仍只有原有 colors/radius/fontScale 语义。本轮为满足零固件改动，没有修改内嵌 prelude。
- Dialog 只支持居中卡片和堆叠，不支持拖拽移动。全屏遮罩注册点击处理以拦截下层触摸；`modal:false` 仅禁止点遮罩关闭。bundle 暂停/替换时清理组件。真实 LVGL 触摸命中仍待接板验收。
- Toast 是单实例，新 `show()` 顶替当前并重置显示时长；淡出 180ms 后移除。浮层不注册点击处理，不应拦截触摸；真机触摸待验收。

## r36b / 性能测量与 Canvas 局部失效（主机验证）

- `CONFIG_LUME_PERF_PROFILE` 默认关；日志中的 flush 耗时只覆盖同步提交阶段，异步 DMA 完成时间尚未量。20/48 行 DMA buffer 和 33/15/10 ms 刷新周期的 FPS、p95/p99、内存余量、触摸与功耗 A/B 均待接板。默认保持 20 行/33 ms，不能用静态事务数代替实测收益。
- Canvas 最多接收八个显式局部矩形。局部无效化与实际 CO5300 传输面积、画面完整性、撕裂效果待真机确认；目前主机 harness 只验证消息参数与游戏逻辑。

## r37b / TF 卡 MP3 音乐播放器（主机验证）

- `lume.audio.mp3` 每次只打开一个 TF 卡文件，使用 4 KiB 输入窗口逐帧解码；`Fs` 仍为 LittleFS，不是 TF 卡 API。ID3v1 支持歌名/歌手，ID3v2 不解析；无标签时用文件名。曲库页显示排序后的前四首。
- LRC 只接受 UTF-8 和最多 32767 字节；GBK 不支持，坏字节以替换字符显示。无 LRC 时显示歌名。时长依比特率估算，VBR 文件的进度可能漂移；无进度回调、定位跳转或退出位置恢复。
- `playStream` 将 16 块以内的 PCM 复制到 PSRAM 队列并立即返回；单帧解码及 TF 读仍占用 engine timer tick，20 ms 截止时间、实际 DMA 排空和 ES8311 44.1 kHz 时钟须接板量测。真机音频、歌词同步、暂停/切歌、长曲稳定性尚未验收。

## r38b / Canvas 合批、录音与播放器补强（主机验证）

- Canvas 连续线段每 32 段合成一条 `CANVAS_BATCH` 消息；队列记录保留定长拷贝，PSRAM 线段负载在成功入队后由 LVGL drain 释放。240 点折线的宿主消息数由 239 降至 8；板上帧时间、队列水位与脏区画质仍待量测。
- `audio.record()` 将 16 kHz 双声道 PCM PSRAM 块移交给 QuickJS ArrayBuffer；宿主 QuickJS harness 覆盖内容、finalizer 与 detach 各释放一次。真实录音、PSRAM 峰值与设备端 GC 时序仍待接板。
- ID3v2.3/2.4 解析 TIT2/TPE1/TALB，支持 Latin-1、UTF-16 BOM、UTF-8 和常见 unsynchronisation；APIC 封面、压缩/加密帧、ID3v2.2、GBK LRC 和逐字歌词仍未实现。文本帧限 4096 B，标签限 16 MiB。
- 曲库递归至四层、最多 256 首，按 ID3 标题或文件名排序；库页每页四首。`music.last` 每五秒保存文件与位置，重启恢复曲目但从头播放。按帧跳到存储位置要逐帧解码，长曲启动可能明显卡顿，因此留待板上性能评估。`lrc.offsets` 是文件路径到毫秒偏移的 JSON 映射，因 NVS 单 key 最长 15 字符，无法直接使用 `lrc.offset.<file>`；UI 每次增减 0.5 秒。KV 的 4 KiB 单值上限也限制了大量文件的偏移映射。
- 音频、歌词观感、TF 子目录可靠性、排序与恢复时延、帧率和 NVS 持久化均未在真机验收。

## r39b / esp32sim screenshot acceptance

A patched esp32sim board model can boot the unmodified Lume firmware, inject JS bundles, and export 480×480 CO5300 screenshots in CI. The emulator's SPI/I2C models attach by host/bus/address and do not validate every physical GPIO route. The AXP2101 and audio codecs are register stubs; TF media, PMIC electrical behavior, audio output, touch timing and actual display timing remain unmodeled. The first CI version uploads artifacts for manual review, without a pixel baseline or a frame-rate gate. This is automated simulator evidence, not real-board acceptance. `image_gallery` currently evaluates and creates an Image node but its emulator screenshot shows background only. The no-IMU `gravity_ball` variant (then called `imu_ball`) does not crash; it uses the app's downward-gravity fallback and logs repeated QMI8658 warnings. See `docs/r39b-emu-report.md`.

## r40b / small-screen example UI (simulator acceptance)

Ten example apps have 480×480 simulator screenshots and four have before/after captures in `artifacts/emu/ui-refresh/`. These captures validate the rendered layout with the current firmware image. Physical AMOLED clipping and color, touch targets, sleep behavior, PMIC values, TF media and audio remain unverified on the board. The emulator shows placeholder PMIC readings (for example 0% battery and 385.7 C); these are model data, not UI calculations. `image_gallery` remains a known emulator visual failure from r39b and is outside this UI refresh. `runtime/shell.js` supplies default semantic colors only when an importing app has no theme; the embedded prelude theme has not changed.

## r41b / screenshot geometry checks

`tools/emu/check_layout.py` checks configured visible block bounds and spacing in the ten refreshed 480×480 emulator captures. The page geometry now uses a 24 px outer gutter. This verifies only the captured app state; transient dialog states, the optional shell in a separately bundled app, and physical AMOLED clipping or touch feel still need device review. No firmware or bridge ABI was changed. See `docs/r41b-alignment-report.md`.

## r46 / App 切换丝滑化（prelude 字节码缓存 + 屏幕过渡，sim 验证）

- 切换相位测量复用 r36b 的 `esp_timer_get_time()` 基建，新增 opt-in `CONFIG_LUME_SWITCH_PROFILE`（默认关），覆盖 teardown（JS_FreeRuntime 单列）、runtime 创建（NewRuntime2 / NewContext / register_bindings 单列）、prelude eval、app eval、首帧 UI 就绪五相位。相位耗时与指令计数来自 esp32sim 的确定性模拟时钟 / 累计指令计数（相位边界停机取样），是 **sim 指令计数 / 相对耗时口径，不是真机墙钟**；真机切换耗时、掉帧、触摸手感均未验收。
- prelude 字节码缓存：`lume_prelude_js` / `lume_home_js` / `lume_demo_js` 首次用 `JS_Eval` COMPILE_ONLY + `JS_WriteObject` 编译为 PSRAM 常驻字节码，后续切换 `JS_ReadObject` + `JS_EvalFunction` 直载跳过解析。缓存带 magic + 打包 QJS 版本 + 源码 FNV-1a hash，校验不符或加载异常即丢弃并回退源码 eval，杜绝跨版本错读。sim 口径下 prelude eval 74245 → 12079 µs（~6×），单次切换 87536 → 25392 µs（−71%）、prelude 指令 18.9 M → 3.4 M（−82%）；常驻缓存实测 prelude 98395 B + home 8416 B = 106811 B。`lume_demo_js` 是单次启动兜底，缓存无实测收益，机制同构保留。**这些加速数字是 esp32sim 指令计数 / 模拟微秒，不是真机墙钟**；真机解析 / 反序列化耗时与 GC 时序待接板量。启动一次性编译开销摊到后续每次切换。
- 屏幕过渡只实现 C1 crossfade-through-black：LVGL task 在 `lv_layer_top()` 建全屏黑色可点击覆盖层，淡入（默认 200 ms）盖住旧屏后引擎才 RESET/teardown，新 app 首帧 `FIRSTFRAME` 消息到达（或 500 ms 兜底）后淡出。**过渡消除了裸空白期，但真机流畅度、动画掉帧、覆盖层触摸吞掉与 AMOLED 实际观感未验**；触摸吞掉仅由可点击顶层覆盖层的 LVGL 命中保证，真机命中待验收。覆盖层是一个 LVGL rect，不是旧屏快照，故无 ~450 KB 帧缓冲临时分配；PSRAM 红线未被触及。时长 `CONFIG_LUME_APP_TRANSITION_MS`（默认 200），`CONFIG_LUME_APP_TRANSITION_DISABLE=y` 关闭后行为与 r46 之前一致（回归验证：0 条过渡日志、立即重建、app eval OK、截图完整）。
- C2 真快照 crossfade **放弃**：vendored lvgl 的 `LV_USE_SNAPSHOT` 编译为 0（`src/others/snapshot/lv_snapshot.c` 体内被 `#if` 裁空），开启需改 vendored 配置 / 代码；且 480×480×2 ≈ 450 KB 的一次性快照缓冲在 canvas 双缓冲已占两个 framebuffer 的紧张 PSRAM 预算下难保证。本轮硬约束禁止改 vendored，故只交付 C1，未做旧屏真快照 crossfade。
- Task D（teardown 分块）**未实施**：Task A 数据显示 `JS_FreeRuntime` 占切换总耗时 3507 / 87536 = 4.0%（字节码缓存后 3479 / 25392 = 13.7%），均 < 30% 门槛，「数据不支持，不做」。
- 桥 ABI 仅在枚举表尾追加 `LUME_OP_FIRSTFRAME`(14) / `LUME_OP_TRANSITION_COVER`(15) 并补 `_Static_assert`，既有 ID 不变；app 层 `lume.d.ts` 无新增；`lume_scripts.c` 的 prelude C 字符串形态原样保留（prelude_runner 与全部 host harness 全绿）。

## r47 / Canvas 抗锯齿光栅（rendering backlog #1，host + sim 验证，无真机验收）

- **范围**：`canvas_line` / `canvas_disc` 的「Bresenham 中心线 + 轴对齐方刷 / 八瓣 stamp 圆」整体替换为 header-only、全整数 8.8 定点覆盖率光栅 `firmware/components/lume-ui-bridge/include/lume_raster.h`：`lume_raster_line` 用点到线段精确距离 + 1px feather，`lume_raster_ring` 用 `|d−r|` 画连续圆环，`lume_raster_blend` 在 RGB565 通道上按 alpha/256 混合。全覆像素仍不透明直写，opaque 重绘擦除契约（speedometer 的 fillRect 清针）逐位不变。未改 app API / `runtime/types/lume.d.ts` / prelude C 字符串 / bridge ABI（`LUME_DRAW_CIRCLE` 仍为「半径 `a`、宽度 `draw_width`」，prelude `circle()` 仍传 `draw_width=1`）/ vendored；`canvas_span` 的 CLEAR/RECT 路径与 r46 profiling 代码未动。
- **接受的简化**（均为有界、可复现，`tests/canvas_aa.c` 逐条覆盖）：
  - **共享关节双混合最多差一个 feather 像素**：折线以两段独立 op 到达同一端点时，该关节像素可能被 `blend(blend(bg,a1),a2)` 两次混合，与钳位并集最多差一个 feather 像素；不透明核不受影响，远轻于被替换掉的暗缝。测试验证两段共线 width=1 线段的包络不扩大。
  - **小半径环内孔退化**：当 `r ≤ hw+1`（`hw=(width−1)/2`，即环宽 ≥ `2r−1`、内半径 `r_in = r−hw ≤ 1`）时内孔与内羽化分支都不成立，圆环落成实心抗锯齿圆盘；`tests/canvas_aa.c` 用 `r=5 / width=16`（hw=7）覆盖此分支，`lume_raster_ring` 先 `if (r < 0 || width < 1) return` 再算 8.8 定点，无溢出。
  - **纯轴对齐 width=1/2 线无羽化 = 无回归**：feather 带 `(hw, hw+1)` 内没有整数像素中心，轴对齐笔画仍是硬边；`width=1` 与旧 1px 方刷逐像素一致。附带口径：`hw=(width−1)/2` 使偶数宽度落到与奇数 `width−1` 相同的硬核（`width=2`→1px、`width=4`→3px），比旧方刷窄 1px，属本轮 AA redesign 的有意收窄，不是 staircase 回归；只有斜线 / 圆环才出现灰阶过渡。
  - **零长线段画成实心方块**：`len2==0` 时 bbox 内每像素距离按 0 处理，得到 `(2·(hw+1)+1)²` 实心方块（width=1/2 → 3×3）而非圆帽点；有界、不越界、不溢出，测试按此断言，未做圆帽特化。
- **越界与 stride**：`lume_raster_put` / 两个主循环都在写前判 `px<w`、`py<h`，`py*stride+px` 的 padding 列 `[w,stride)` 永不写穿；测试用 `STRIDE=68 > W=64` 的 `0xABCD` 哨兵 + 越过可见宽度的线段实证该保护。
- **static 单读者**：`apply_canvas_draw` / `apply_canvas_path_draw` / drain 的 `CANVAS_BATCH` 三处 `static lume_raster_surf_t surf` 只由 LVGL task 的 drain timer 顺序访问，与文件内 `s_nodes` / `s_kinds` / `s_canvas_*` / `s_gesture_flags` 同一纪律（文件头线程约定）；合计约 72 B DRAM `.bss`，不进 IRAM。
- **验证（全部宿主机 / sim）**：`tests/canvas_aa.c` 11/11 全绿（头注释已补 `-lm`）；默认板 `idf.py build` 绿 + `idf.py size`：Flash Code 1,950,600 → 1,951,228 B（**+628 B**，< ~4 KB）、**IRAM 16384/16384（100%，Remain 0，+0，AA 代码在 flash `.text`）**、DIRAM 230499 / Total 2921463；emu `examples/speedometer` + `examples/counter` 重启干净（0 条 `eval failed|RELOAD ERR`，tft.png 生成）。静态黄带边缘（y=82，app 重构未改该 `speedArc(...,158,...)` 几何）受控 A/B：pre-r47 **2 色硬阶** → r47 **8 色 6 段 RGB565 过渡**；放大对比见 hub 旧八瓣圆为断续青弧、r47 为连续环。详见 `docs/roadmap.md` r47 result。
- **仍 open（全部真机验收）**：AMOLED 实际色彩 / 灰阶观感、笔画手感、局部脏区边界、板上帧时间、针脚双混合在真机是否可见，以及其余全部板级项一律未验；以上为 host / esp32sim 证据，不是真机验收。

## r48 / Canvas 原生抗锯齿环弧 op（rendering backlog #2，host + sim 验证，无真机验收）

- **范围**：新增 `ctx.arc(cx,cy,r,from,to,width,color)`（canvas 层原生 op，非 backlog #3 的 LVGL `Arc` widget 路线）。`lume_raster.h` 加 `lume_raster_arc`（header-only、全整数 8.8 定点、无浮点、无逐像素超越函数）：`|d−r|` band + r47 1px feather，角度范围用**两条叉积半平面**判定（整数化 atan2 的等价实现，不引入浮点），两端按 r47 line 端点钳位**圆帽**补 coverage；整数 q14 正弦表（91 项 / 182 B flash `.rodata`）供端点与紧 bbox 用。未改既有 app API 语义 / prelude C 字符串形态（仅追加）/ vendored；`ctx.polyline` 与 retained path（`retainSegments`/`drawPath`）原样保留。桥 ABI 仅追加 `LUME_DRAW_ARC=5`，既有 `LUME_DRAW_*`、`LUME_OP_*` ID 不变，`lume_ui_msg_t` 不加字段（host 仍精确 128 B）。
- **接受的简化**（均有界、可复现，`tests/canvas_aa.c` 逐条覆盖）：
  - **角度整数度离散化**：角度按整度处理，prelude 把小数度（如 `speedAngle()` 的 259.6°）`Math.round` 到整数，边界偏移 ≤0.5°（r=158 处约 1px）；角度归一化 / 跨 0° 环回 / 全圆判定都在 raster 内以整数 `%` 完成。这是有意的离散化，非回归。
  - **角度边界硬切 + 圆帽接缝**：角度范围是一条硬叉积半平面切线，**不做角度方向上的亚像素羽化**（1px feather 只作用于径向 band 内外边与圆帽）；接缝连续性靠圆帽保证——band 覆盖（角内）与圆帽覆盖（角外）在边界角处逐点相等，`tests/canvas_aa.c` 的 seam 扫描实证 0→24→31 平滑过渡、无零缺口 / 硬阶。
  - **端帽双混合最多差一个 feather 像素**：相邻两段弧的端帽（如 speedometer 260°/343° 色带交界）重叠时该像素可能被 `blend(blend(bg,a1),a2)` 两次混合，与钳位并集最多差一个 feather 像素；不透明核不受影响，语义与 r47 共享关节一致。emu 像素检查在色带接缝处 `bgGaps=0`（无背景缺口），并出现绿/黄混合过渡像素。
  - **q14 整数三角表 / 8.8 端点量化**：sin/cos 用 0..90° 1° 分辨率 q14 表折叠得到，端点坐标量化到 8.8 定点；r≤480 时端点误差 <0.05px，远小于 1px feather。表是 flash `.rodata` 静态常量，不进 IRAM。
  - **退化与快路径**：全圆 sweep（|to−from|≥360）直接走 `lume_raster_ring`，与 r47 逐位一致（`tests/canvas_aa.c` 用 `memcmp` 断言）；`from==to` 退化为端点处的有界圆点；`width≥2r−1` 内孔闭合，落成填充扇形/圆盘（沿用 r47 ring 语义）；`r<=0` 早退。
  - **128 B 消息字段复用**：固定队列记录无空余 int32 对，ARC 复用 spare 字段 `image_w`=半径、`duration_ms`/`token`=两个有符号整度角（u32↔i32 重解释），`b` 槽置 0。既有 `LUME_DRAW_CIRCLE`（`a`=半径/`draw_width`=宽）与其它 op 的字段语义完全不变。
- **bbox / 越界**：紧 bbox 由角度极值（端点 cos/sin + 4 个基角是否落在扇形内）算出并按 `hw+2` 为圆帽留边，写前裁剪到 `[0,w)×[0,h)`；`tests/canvas_aa.c` 用贴右边圆心的部分弧 + `0xABCD` stride 哨兵验证 padding 列不被写穿。
- **static 单读者 / IRAM**：`lume_raster_arc` 由 `apply_canvas_draw` 的 `LUME_DRAW_ARC` 分支在 LVGL task 调用，复用既有 `static lume_raster_surf_t surf`（与 r47 同纪律）。`idf.py size`：Flash Code 1,951,228 → 1,954,564 B（**+3,336 B**，< ~4 KB）、**IRAM 16384/16384（100%，Remain 0，+0，新代码全在 flash `.text`/`.rodata`）**、DIRAM 230499 不变 / Total 2926191。
- **验证（全部宿主机 / sim）**：`tests/canvas_aa.c` 19/19、`bridge_protocol.c` static assert 通过、`canvas_mapping.js` 14 PASS、全部 22 个 `tests/*.js` 绿、`npm test --prefix tools/lume` 32 pass / 0 fail / 1 skipped、`gen_api_docs.py --check` + `check_website.py` 绿；`idf.py build/size` `BUILD_EXIT=0 / SIZE_EXIT=0`。emu A/B（同一固件，仅注入 app 不同，固定 8s 确定性指令计数）：改造前 406,648,268 insns（core1 85,085,505）→ 改造后 403,956,287（core1 81,057,077），总 **−0.66% 未恶化**、JS core1 **−4.7%**；JS 每帧段数 276 → 4 条原生 arc；两条 serial 均 0 条 `eval failed|RELOAD ERR`，tft.png 生成；像素级确认斜向弧边多段 AA 过渡、色带接缝无缺口（2071 个变化像素全在表盘 bbox 内）。详见 `docs/roadmap.md` r48 result。
- **仍 open（全部真机验收）**：AMOLED 实际色彩 / 灰阶观感、弧边手感、接缝在真机是否可见、板上帧时间，以及其它全部板级项一律未验；以上为 host / esp32sim 证据，不是真机验收。

## r49 / rendering backlog #6 + #7（host + esp32sim 验证，无真机验收）

- **范围**：closing rendering-backlog #6（三示例静态/低频几何下放）与 #7（`lume screenshot --scan N` 半帧/图层完整性工具化）。全部为宿主机 / esp32sim 证据；未改任何固件 C（临时负例破坏已 `git checkout` 还原并复编）、未改 vendored quickjs-ng/lvgl、未改 bridge ABI / 帧协议 / prelude C 字符串、`runtime/types/lume.d.ts` 无变化（retained-path API 早已声明）。`idf.py size` 与 r48 基线逐字段一致：IRAM 16384/16384（Remain 0）、Flash Code 1954564（+0 B）、Total 2926191。
- **接受的简化 / 实证偏离（均有界、可复现）**：
  - **`gravity_ball` 用 JS 侧 span 缓存，而非 C 侧 retained path**：其每帧几何是「平移的实心圆盘」，由 49 条 `fillRect` 行 span 画出（`canvas_span`，廉价顺序写），不是线段几何。实测 `retainSegments`+`drawPath(pid,bx,by)` 变体：core1 **−41,408,410** 但 core0 **+71,457,862**（49 段 AA `canvas_line` 逐段按点到线段距离光栅，替代 49 次 span 写），总指令数 **+30,049,452（+12%，恶化）**，越过「总指令数不恶化」红线，故弃用。交付形态为把圆盘 49 个 `[dy,half]` span 预计算一次（`BALL_SPANS`），每帧仅按缓存行做 `fillRect`（去掉 `sqrt/floor/max/min` 的逐帧 JS 计算）：core1 **−10,128,442（−9.2%）**、total **−708,627**、像素与 dirty rect 逐位不变、`tests/gravity_ball.js` 无需放宽断言。这是「先实证…别硬搬」的落地：实心面不是线段路径的材料。
  - **`dashboard` 的 retained path 基本是测量中性**：其「276 段表盘」在更早轮次已改为原生 LVGL `Arc` widget（`battArc`），`arc()` helper 为死代码；剩余 canvas 静态几何仅 ~11-19 条 hairline。默认 GAUGE 页每帧只有 1 条静态线，default-page A/B core1 **+160,843（+0.22%）**、total **+191,598（+0.07%）**，属 bundle 体积改变引起 eval/publish 时序位移的噪声（该 app core1 基线 ~73M 中大部分是 QuickJS 事件循环空转；`counter` core1 = 54,573,730）。同一 BOOT 按键脚本把 BEFORE/AFTER 都切到 TRACE 页（10 条网格线）时 core1 **−1,631,867（−1.7%）**、total −2,604,566，retained grid 收益可见。不虚报「明显下降」。
  - **`watchface` 是唯一真正命中「276 段」前提的示例**：3 条整圆背景环（各 121 段，合计 ~360）+ 60 刻度，逐帧在 JS 里 `facePoint()` 三角函数采样；改 5 条 retained path 后 core1 **−40,023,011（−36.6%）**、total −40,097,584。环/刻度经 `retainPath`/`retainSegments` 回放走的仍是同一个 `canvas_line()` 光栅，像素逐位不变。
  - **`screenshot --scan N` 的「连截 N 帧」= N 次确定性 esp32sim boot**：esp32sim 的 `--tft-png` 只在运行结束写一张，没有逐帧 dump / 脚本截图动作。工具以固定固件 + 固定 app frame + 固定 script，在递增的 `--max-seconds` 上跑 N 次，得到同一次确定性执行的 N 个相继时刻画面；不是单次运行里连续截屏。所有帧按同一固件/脚本，A/B 与负例因此可复现。
  - **scan spec 的 ROI / 阈值是 esp32sim 截图标定值**：`tools/lume/scan_specs.json` 的 static-layer ROI、`minInk`、`dynamicRegion`、`inkThreshold`/`changeThreshold`、`start`/`step` 均按 480×480、当前主题色、IMU 静止的 esp32sim 画面标定；`dashboard` 需 `press 0` BOOT 动作切到 canvas 可见的 TRACE 页（默认 GAUGE 页 canvas 被 metric cards 遮住）。真机色彩/几何/刷新率变化需重新标定，工具本身不假设真机像素。
  - **负例破坏是临时固件改动、已完整还原**：为证明 #7 非「空转」，临时把 `lume_ui_bridge.c` 的 `CANVAS_INVALIDATE` drain 中 `canvas_publish(m.node_id,&m)` 注释掉（mid-frame blit 类破坏），复编后 `speedometer` 5/5 帧全部 `MISSING` 图层、`RESULT: FAIL ... exit 1`；随后 `git checkout` 还原 C 文件、复编、复扫 PASS。`git diff` 对该文件为空，工作树无残留破坏代码。
- **验证（全部宿主机 / sim）**：`lume check examples/counter`（回归兜底）+ `dashboard`/`watchface`/`gravity_ball` 全部 `EXIT=0`（dashboard layout R1-R7 全 PASS）；22/22 `tests/*.js` 绿（`JS_HARNESS_FAILURES=0`）；`npm test --prefix tools/lume` 44 pass / 0 fail（新增 `scan.test.js` 覆盖 `decodeRgb` / `inkCount` / `changedPixels` / `analyzeFrames` / `renderScan` / 注入式 capture 引擎 / 无 spec 的 CLI 失败）；`tests/canvas_aa.c` 19/19、`tests/bridge_protocol.c` static assert PASS；`gen_api_docs.py --check`（110 条）+ `check_website.py` 绿；`idf.py build && idf.py size` `BUILD_SIZE_EXIT=0`。emu A/B 原始 stop 行、scan 正常/破坏输出、像素对比（三示例 0 变化像素 / 0 丢失 ink / bbox 一致）见 `docs/roadmap.md` r49 result。
- **仍 open（全部真机验收，无板）**：AMOLED 实际色彩 / 灰阶、retained path 回放与 span 缓存的真机帧时间、dirty rect 边界、半帧 blit 在真机是否可见、scan spec 标定是否需按真机重写、`screenshot` 真机 SHOT/OTA 通道（本轮只有 esp32sim 数据源）、以及其余全部板级项（点屏、触摸、睡眠电流、radio、持久化、bundle 推送等）一律未验。以上为 host / esp32sim 证据，不是真机验收。

## r50 / CI 测试流水线（host + esp32sim 证据，无真机验收）

- **范围**：把既有本地验证闭环搬进 GitHub Actions —— 新增 `.github/workflows/tests.yml`（host 回归矩阵：22 JS harness + `npm test` + 8 C 断言 + 两个 py 脚本 + 可选 `check --no-emu`），并在 `.github/workflows/emu.yml` 截图矩阵后追加 `screenshot --scan 5` 门禁步。纯 YAML/文档改动：未改固件 C、prelude C 字符串、bridge ABI、帧协议、vendored quickjs-ng/lvgl、`runtime/types/lume.d.ts`；未推送、未 rebase 他人提交。验收口径仍是「编译绿 + host/emu 证据」，**不等于真机验收**。
- **CI 无法覆盖的缺口（如实登记）**：
  - **真机在环（hardware-in-the-loop）完全不在 CI**：runner 上没有板，CI 不验证点屏/色彩/触摸方向与手感、音频、睡眠电流 / 触摸唤醒、radio、持久化、USB/WiFi bundle 推送、SHOT/OTA 真机通道。`tests.yml` 与 `emu.yml` 的全部证据都是 host 编译断言或 esp32sim 截图。CI 绿灯仅代表「这些 host/sim 检查没退化」，任何板级指标仍留接板轮。
  - **esp32sim 的时间确定性依赖 ROM 版本 + 固定输入**：`screenshot --scan N` 的 N 帧是「固定固件 + 固定 app frame + 固定 script，在递增 `--max-seconds` 上跑 N 次确定性执行」的 N 个相继时刻（不是单次运行连截）。`tools/emu/fetch-rom.sh` 把 S3 mask ROM ELF 固定在 `20260528`（sha256 `c0ce0f33…`），CI 本地缓存与之一致；但 ROM 版本一变，指令计数 / `--max-seconds` 采样落点就会漂移，`tools/lume/scan_specs.json` 的 `roi` / `minInk` / `dynamicRegion` / `start` / `step` 标定需重新校准。spec 与 ROM 的耦合是人工维护，CI 没有「ROM 漂移自动失效」检测（只有 fetch-rom.sh 的 sha 校验）；真机像素/刷新率变化更要重新标定。
  - **`check --no-emu` 不是布局门禁**：`tests.yml` 的快路径步只跑 bundle，eval / **layout R1-R7** / perf 全部跳过（`check.js:164-209`）。布局断言需要 esp32sim 截图，只在完整 `lume check <app>` / `emu.yml` 的截图矩阵里出现；`tests.yml` 本身没有 R1-R7 门禁，报告与 workflow 注释均已注明，不虚标。
  - **`tests.yml` 的 `paths` 是白名单，不是全量依赖图**：未列入的固件组件（`lume-hotreload` / `lume-ui-bridge` / `lume-board` / `mp3_decoder` / `quickjs-ng` / `lume-perf` 等，8 个 C harness 实际会编译它们的源码）变更不会触发 host harness job；这些由 `firmware.yml` 的 `firmware/**` 构建覆盖，但不是 harness 门禁。触发面是刻意收窄的快照，不是「改任何固件源码都必过 host 断言」的保证。
  - **浏览器 / 模拟器验证不在 CI**：`tools/simulator/verify.js`（Playwright 五条渲染断言）与 `sim.js` 预览需要浏览器，CI 未跑；`pages.yml` / `firmware.yml` 与两个新 workflow 互不触发，各自门禁独立。r55 新增的 `tools/simulator/verify_mario.js`（mario 浏览器端到端 + `artifacts/simulator/mario.png` 截图）同为手工运行：`PLAYWRIGHT_MODULE=<playwright 路径> node tools/simulator/verify_mario.js`；Playwright 安装重、易超时，本轮不纳入 CI。
  - **workflow 行为未在真实 runner 上实证**：本地只做了 `yaml.safe_load` 静态自检 + 逐命令本地预演；`actionlint` 未安装（跳过）。`espressif/esp-idf-ci-action@v1` 把固件镜像留在 host workspace、PR 门禁、`if: failure()` 产物上传、`upload-artifact` 路径拼接均由既有 `firmware.yml` / `emu.yml` 的隐式约定支撑，需首次真实 push 触发后才能确认。
- **验证（全部 host / esp32sim，EXIT=0）**：22/22 `tests/*.js`（`JS_HARNESS_FAILURES=0`）、8/8 C 断言、`npm test --prefix tools/lume` 44 pass / 0 fail、`gen_api_docs.py --check`（110 条）+ `check_website.py`、`check --no-emu` `RESULT: PASS`、speedometer/dashboard `scan N=5` 各 5/5 PASS + `--json` 冒烟；`idf.py build && idf.py size` `BUILD_SIZE_EXIT=0`，IRAM 16384/16384（Remain 0）、Flash Code 1,954,564 B、Total 2,926,191，与 r49 基线逐字段一致。详见 `docs/roadmap.md` r50 result。
- **仍 open（全部真机验收，无板）**：上述所有板级项一律未验；此外 CI 的 ROM/spec 耦合、白名单触发面、PR 门禁与产物上传的真实 runner 行为均待首次推送后观察。本轮为宿主 / 模拟器证据，不是真机验收。
## r53 / Optional boot-pinned launcher

- `.boot` is a separate LittleFS marker. A valid installed pin wins at power-on; otherwise boot falls back to `.current`, then the built-in home grid. `launch()` and `home()` retain their existing `.current` behavior. Devices that never call `setBoot()` have the original boot path.
- The launcher app pins itself when started. Its edit page clears the pin and opens home. Direct TF/CLI pin editing remains future work. A pinned app that still has `app.js` but fails during evaluation remains pinned; the current boot failure path drops `.current` and opens home for that run. Repair or clear the pin through a working app.
- Host harness, firmware compilation, and esp32sim evidence do not verify LittleFS persistence or display/touch behavior on the physical board. Board acceptance remains pending.

## r55 / mario 浏览器模拟器验证（host / 浏览器证据，无真机验收）

- 新增 `tools/simulator/verify_mario.js`：`sim.js` + Playwright 浏览器端到端，断言初始 HUD `S 0  C 0  L 3  LV 1`、6 节点、Canvas 像素绘入 `#device`，并通过三枚 Button 驱动 `BRICK 25` → `COIN 35`（`S 35  C 1`，覆盖 brick 与 coin 两类得分），截图 `artifacts/simulator/mario.png`。纯 host 改动：未改 `examples/mario/app.js`、固件 C / prelude / bridge ABI / 帧协议 / `runtime/types/lume.d.ts`；未推送。
- **与 esp32sim 证据的差异（如实登记）**：浏览器输入是 DOM 点击 → `/input` press + `/input` 注入的 `longpress` 手势（HIGH jump），esp32sim 则是固件内定时 `actions.txt` 触摸脚本；`sim.js` 用真实 50 ms wall-clock `Date.now()` 泵 `__lume_tick()`，物理按真实时间推进、非周期确定，帧时序与 esp32sim 固定指令计数不同，故断言打在 HUD Text 文案而非像素 diff / 帧号。浏览器路径稳定复现 `BRICK 25` → `COIN 35`（数值为实测、非硬凑），但**未**复现 esp32sim 更长的 `STOMP 85` / `LEVEL 2 185`（需踩敌 / 到旗杆，浏览器脚本不覆盖）；两条腿覆盖面不同，均非真机验收。
- **仍 open**：浏览器验证不在 CI（Playwright 安装重、易超时，见 r50；入口与手工命令已补入该条目）；上述全部板级项（点屏 / 色彩 / 触摸方向与手感 / 音频 / 睡眠电流 / radio / 持久化 / USB/WiFi bundle 推送）一律未验。本轮为 host / 浏览器证据，不是真机验收。
## r54 / QuickJS PSRAM allocator profile

- `alloc.net` and `alloc.live` count only blocks passing through Lume's `JSMallocFunctions` PSRAM hooks. Bytes use `heap_caps_get_allocated_size`, the same real-block-size measure as QuickJS's `js_malloc_usable_size`. The counters do not include canvas PSRAM allocated directly by C, LVGL buffers, other native allocations, or task stacks. Growth is evidence of retained JS allocator memory, not by itself proof of an unreachable-object leak or physical PSRAM fragmentation.
- Counters and the once-per-second `lume-perf: alloc.net=... alloc.live=...` line compile only with `CONFIG_LUME_PERF_PROFILE=y`; the default configuration remains off. All QuickJS runtime operations and allocator callbacks run on the engine task, so the counters need no atomic operations or lock. The read API is engine-task-only.
- The esp32sim assertion uses a fixed post-reload warmup and compares net bytes across the steady interval. Its threshold is calibrated to the current firmware, app and simulator clock; a future runtime/app change may require recalibration from fresh raw samples. Board-level memory pressure, display/touch behavior, sleep current, radio and persistence remain unverified.

## r56 / Promise job drain

- The engine drains at most 64 QuickJS jobs after each event dispatch and `__lume_tick`, before the next queue wait. A self-feeding Promise chain continues over later turns, leaving event dispatch and timer checks reachable. A job exception is logged and stops that turn's drain; the remaining jobs can run on the next turn.
- `async`/`await` continuations can now update signals and UI. This does not make synchronous native calls asynchronous: `lume.ai.chat()` still blocks the engine task as described under r34.
- The Node prelude harness checks the async button callback and reactive Text update. Firmware execution and Promise job scheduling require esp32sim or board verification; Node vm microtasks alone do not validate QuickJS's queue. Physical board acceptance remains open.

## r57 / WebSocket client

- The device accepts at most two concurrent WebSocket clients and 64 KiB per received logical message. The component may split frames across DATA events; the transport copies and reassembles them before engine dispatch. Oversized/invalid frames report `onError(-2)` and drop that message.
- The engine event queue is bounded. A saturated queue can drop WS events; message payloads are freed on post failure and after dispatch. Sustained streaming throughput and backpressure still need board measurement.
- `send()` can block the engine for up to one second while the ESP WebSocket transport writes. Keep UI callbacks short and avoid sending large frames from a touch handler. Connection setup remains asynchronous on the component task.
- The host C test covers message ownership and continuation frames; the Node test covers callback routing and text/binary types. esp32sim has no connected WS echo endpoint in this worktree. Physical WiFi association, TLS trust, reconnect behavior, frame throughput, memory peaks, and touch responsiveness during audio streaming remain pending board acceptance.

## r58b mini-SVG host implementation; board acceptance pending

- SVG intrinsic dimensions use positive pixel `width`/`height`, falling back per missing dimension to `viewBox` width/height. Percentages and other units are unsupported; an SVG without both intrinsic dimensions is rejected with `-2`. SVG may report intrinsic dimensions above 480 because its raster is separately limited to 480×480; bitmap PNG/JPEG size rejection remains unchanged.
- SVG rasterization supports solid fill/stroke/opacity and the documented geometry/path subset. `transform` is unsupported. Gradients, filters and text are unsupported. The bitmap target is at most 480×480 with a centered `viewBox` meet mapping.
- Host harness, firmware build and emulator checks do not constitute board acceptance. Display appearance, touch feel, memory pressure under real workload and transfer behavior remain for on-device verification.
- The fill and stroke sampler visits every flattened edge for each covered pixel sample. A 100×100 circle icon did not finish app evaluation within the emulator's 8-second simulated window; the checked SVG smoke example uses an 80×80 rectangle and path. Latency for complex SVGs needs board profiling before treating them as interactive assets.

## r65 / 桌面宠物（host + esp32sim 证据，无真机验收）

- **范围**：新增 `examples/pet/app.js` + `tests/pet.js`，只动 examples/tests/文档；固件 C、prelude C 字符串、bridge ABI、帧协议、`runtime/types/lume.d.ts`、vendored quickjs-ng/lvgl 全部未改。未推送。
- **像素手法**：16×16 调色板索引二维数组 → 每行同色连续段预计算成 `[y,x,w,color]` fillRect spans（gravity_ball 模式），所有 (皮肤,状态,帧) 组合在加载时一次算好；每拍只对「上一帧与当前帧不同」的单元格包围盒做 `fillColor(BG)+fillRect` 清除与局部重绘。闲置 4 帧只动眼睛行，实测脏区 72–96×12 px；睡眠态 1 帧静止且 tick 不 bump 重绘信号，40 拍零 draw / 零 invalidate。脏区是精灵局部盒，不是全 480×480 画布。
- **状态机**：`IDLE / HAPPY / HUNGRY / SURPRISED / SLEEP` 纯 JS。20 Hz `setInterval`；饥饿 +2.5/s、快乐 −1.2/s，睡眠衰减减半；HAPPY 2.5 s、SURPRISED 1.5 s 后回落；16 s 无交互自动入睡。数值是演示调参，不是真实宠物养成模型。
- **交互实证口径**：tap→抚摸（`lume.gesture.on(scene,'tap')`）、longpress→喂食、IMU 幅度偏离 ~9.81 且 debounce 后→惊醒。手势经 prelude 的归一化 DOWN/MOVE/UP 流驱动；esp32sim 用独立 `/tmp` 脚本注入 `touch x y 1/1/0`，串口实证 `PET PET happy=75 state=HAPPY`。**翻腕惊醒只在 host harness 用注入 IMU 样本验证**——esp32sim 默认静止 IMU，未做真机翻腕；启动瞬间的近零 IMU 向量被当作「传感器未就绪」忽略，避免开机误惊醒。
- **皮肤商店卖点**：两套皮肤（CAT / SLIME）同时换配色与像素几何；`lume.storage.kv.set('pet.skin', i)`（8 字符 ≤ 15 字符上限）记忆，新运行时按索引恢复。换肤 = 纯数据变更，固件不动，可由 `lume dev` 热更新推送。这只是给 app 作者的示范：本轮**未**实现在线商店/OTA 拉取/预览购买流程，皮肤表硬编码在 app.js 内。
- **KV 取值注意**：`kv.get()` 的负值可能是存储的数字也可能是错误码，故只判断 `=== 1`，其余（含 −2/7/字符串/null）一律回退皮肤 0；不拿 `r < 0` 当错误判别。
- **字体限制**：HUD/文案只用 ASCII 与中文，Zzz 与图标都用像素点画，未使用 ·/☂/☁/☀ 等固件缺字形的符号。
- **仍 open（全部真机验收）**：点屏/色彩、触摸方向与手感、翻腕（IMU）惊醒的真机手感与轴向/阈值、睡眠电流、bundle 推送与持久化跨断电、20–30 fps 真机帧率、KV 真机跨电源周期保存一律未验。`lume check` 绿 + host harness 绿 + esp32sim 截图 ≠ 真机验收。

## r68 / Retro classics 双刀（host + browser + esp32sim 证据，无真机验收）

- **范围**：新增 `examples/invaders/app.js`、`examples/frogger/app.js` 与 `tests/invaders.js`、`tests/frogger.js`；playground 四处同步（build.mjs apps、page.js picker、index.html script、verify.mjs 22→24）并重新生成 `website/playground/{apps,sources}` 产物。固件 C、prelude C 字符串、bridge ABI、帧协议、`runtime/types/lume.d.ts`、vendored 组件全部未改。未推送。
- **像素风口径**：两 app 都硬边（`fillRect` 整像素、无 AA），精灵一律 mario 式预计算 spans（eval 时解码一次、逐帧只回放；`spanBuilds` 恒为 8，harness 断言跨 120 tick 不增长）。Invaders 取 Game Boy 三档墨绿（`#0F380F/#306230/#8BAC0F/#9BBC0F`），Frogger 取 NES 灰底低饱和彩块（红/黄/蓝车、棕木、绿荷叶）。造型为**原创近似**的街机风格，不逐像素复制任何原始 ROM 位图，README/roadmap 只用「arcade-style」自研口径、不点名原商标。
- **字体验收取舍**：HUD/文案沿用固件 14px Montserrat，不换像素字体（flash 收益不值当）。这是有意的简化，不是像素风缺口。
- **KV key 实证纠正**：任务简报写 `hiscore.invaders`（16 字符），但 `firmware/components/lume-storage/lume_kv.c:42-50` 实证 NVS key 上限 15 字符，16 字符键在真机会被拒。实际用 `hisc.invaders`（13 字符）与 `hisc.frogger`（12 字符）。浏览器 runtime 的 `storage.kv` 是 `get:()=>null, set:()=>0` 的 no-op 桩（非内存 map），两 app 的 `gameHigh/gameSave` 用 try/catch + 内存分兜底，KV 失败静默降级已覆盖（verify.mjs 24-app 全绿）。
- **Frogger 交互取舍**：青蛙跳跃简化为**瞬移 + 一帧高亮**，不做逐格补间动画。tap 方向按落点相对青蛙中心判定（|dx|>|dy| 走横轴，否则纵轴），是单点触摸无方向键下的最优解。
- **脏区口径**：Invaders 编队整体移动脏区 = 编队包围盒 ∪ 炮台 ∪ 子弹，稳态实测 308×196 + 36×28 = 61,376 px ≈ 全帧 26.6%（首帧一次性全屏初始化，不计入稳态预算）；下降帧因新旧包围盒并集升到约 88k px。Frogger 每条横列独立脏区，但 bridge 单帧最多 8 个 dirty rect（`lume_prelude.js`），故相邻行合并成 2–4 个带区间；这是 bridge 约束下的合并，不是整帧重绘。
- **emu 性能证据口径**：10 s emu 的 PERF 打点（`INVADER/FROGGER PERF js_avg_ms=...`）测的是模拟器内 JS+桥接耗时，不等于真机帧率；`[emu] stop` 的 INSNs 是 esp32sim 确定性指令计数，core1 高于 counter 是编队/横列 spans 回放量更大所致，非掉帧。两 app 串口均无 `eval failed|RELOAD ERR`、无 dropped-frame 日志；唯一的 `phy: error: pll_cal exceeds 2ms!!!` 是模拟器 PHY 校准噪声，与 app 无关。
- **仍 open（全部真机验收）**：点屏/色彩、触摸 pan/tap 手感与阈值、20 ms tick 真机帧率与编队重绘掉帧、音效（两 app 未加音效，pending）、KV 真机跨电源周期持久化、bundle 推送一律未验。`lume check` 绿 + 双 harness 绿 + 24-app 浏览器 verify 绿 + esp32sim 截图 ≠ 真机验收。

## r72 / live microphone spectrum (host evidence; board pending)

- `recordStream` captures 16 kHz stereo PCM into a 64 KiB PSRAM RX ring. The eight-chunk engine audio queue discards its oldest chunk under pressure and exposes a monotonic per-stream drop count. The display prefers fresh audio to delayed frames. A temporary per-chunk PSRAM copy bridges the ring to the engine queue; peak audio buffering can exceed 64 KiB.
- The FFT uses a Hann window and 512-point radix-2 analysis by default, with 256-point fallback when one callback measures above 15 ms. Browser/host timing is not a QuickJS board timing measurement. The 32 logarithmic columns have no microphone gain calibration; VU is normalized raw PCM RMS, not dB SPL. No acoustic echo cancellation or automatic gain control is implemented.
- ES7210 in esp32sim is a register stub and supplies no real microphone samples. Host synthetic sine/chirp injection validates callback routing and rendering logic only. Microphone sound quality, callback time, end-to-end latency, queue drops under WiFi/UI load, TX/RX shared-clock behavior, and 16 kHz duplex capture/playback remain pending board acceptance.
## r69 / Retro classics 第三刀（host + browser + esp32sim 证据，无真机验收）

- **范围**：新增 `examples/sokoban/app.js`、`examples/lcd_dual/app.js` 与 `tests/sokoban.js`、`tests/lcd_dual.js`；playground 四处同步（build.mjs apps、page.js picker、index.html script、verify.mjs 24→26）并重新生成 `website/playground/{apps,sources}` 产物与 `sources.js`。固件 C、prelude C 字符串、bridge ABI、帧协议、`runtime/types/lume.d.ts`、vendored 组件全部未改。未推送。
- **像素风口径**：沿用 r68 硬边 `fillRect`、mario 式 spans 预计算（`spanBuilds` 恒为 6/7，harness 断言跨多次 tick/移动不增长）、14px Montserrat 不换字体。Sokoban 取暗橄榄地牢色（墙/地板点阵/目标菱形/双态箱），造型为自研近似；LCD 取透传段码绿（BG `#050A06` / 幽灵 `#122A12` / 点亮 `#8CDA4A`），**造型自研，不复刻 Nintendo Game & Watch 任何原机、不逐像素复制任何原版位图或商标**。
- **KV key 实证纠正（与 r68 同款）**：简报写 `hisc.soko_progress`（18 字符），但 `firmware/components/lume-storage/lume_kv.c:42-50` 的 NVS key 上限是 15 字符，18 字符键在真机会被拒。实际收敛为 `hisc.soko_pg`（12 字符）；LCD 用 `hisc.lcd`（8 字符）。浏览器 runtime 的 `storage.kv` 仍是 no-op 桩，两 app 的 `gameHigh/gameSave`/进度读写用 try/catch 静默降级，26-app 浏览器 verify 全绿实证无中断。
- **Sokoban 关卡数据与 BFS 断言**：10 关均为 11×7 ASCII 数组常量（≤13×10），par 值 `[2,9,1,10,8,7,9,14,15,4]`。harness 内置 BFS 解算器逐关证明可解且 par == 最优玩家步数；这是本轮 harness 的核心价值——关卡数据 bug 会让断言失败，而不是放宽断言。死锁 QoL 只检测**箱子入角且非目标点**（两正交邻墙），未做更宽的死墙/冻结区全局分析。
- **玩家移动取舍**：与 r68 frogger 同款——瞬移 + 一次高亮（120 ms timer 衰减），不做逐格补间；登记为有意简化，不是功能缺口。
- **LCD 幽灵段的物理近似**：所有可能段位（每模板非 `.` 单元，含永不点亮的面包轮廓 `G`）以 8% 亮度常显，激活段以正常色叠加。`ctx.retainSegments` 在首帧上传两条静态幽灵路径（GAME A 124 段 / GAME B 99 段，均 ≤240 上限），后续帧仅 `ctx.drawPath` 回放，零 JS 几何；harness 断言 `pathDefine` 全程只发生 2 次。MODE 切换时强制一帧全屏重绘，避免旧模式点亮段残留在新模式较小的脏区外。
- **LCD 交互冲突化解（停下条款核对）**：MODE 不用 LVGL `Button` 的 `onPress`——emu 实测 Button 吞掉触摸、不触发 CLICKED；浏览器里按钮 onPress 与画布根手势会同时命中，造成「切模式 + 误移动棋子」双触发。改为 MODE 画进画布、由**单一手势目标的底部 tap 区**处理，浏览器交互烟测实证 `GAME A → tap MODE → GAME B` 与四向 swipe 无冲突。GAME A 忽略上下 swipe、GAME B 忽略左右 swipe，两状态机互不串扰（harness 逐条断言）。
- **音效**：两 app 均无音效，与 r68 两 app 一致（pending board），不是遗漏。
- **emu 性能证据口径**：10 s emu 的 `SOKO/LCD PERF js_avg_ms=...` 是模拟器内 JS+桥接耗时，不等于真机帧率；`[emu] stop` 的 INSNs 是 esp32sim 确定性指令计数。串口无 `eval failed|RELOAD ERR`、无掉帧日志；唯一 `error` 行是 PHY 校准噪声，与 app 无关。
- **仍 open（全部真机验收）**：点屏/色彩、幽灵段在真机非背光 LCD 上的实际可见度与对比、swipe/tap 阈值手感、真机帧率、音效、KV 跨电源持久化、bundle 推送一律未验。`lume check` 绿 + 双 harness 绿 + 26-app 浏览器 verify/交互绿 + esp32sim 截图 ≠ 真机验收。
## r74 / real firmware in browser (esp32sim WASM self-host)

- The self-hosted esp32sim runner (website/run.html + wasm/* + vendor/xterm + assets/atech) is vendored from the official mikroverk/esp32sim distribution (MIT) and pinned by commit at fetch time; it is not rebuilt from source. Updating the engine means re-copying files — no automated upstream-sync.
- esp32sim models the Waveshare AMOLED-1.8 V2 board: CO5300 368x448 QSPI panel and a CST820-class touch IC. The real board is 480x480 with a CST9220; panel geometry and touch IC differ, so this is pipeline-level fidelity (real QuickJS-NG + LVGL + CO5300 driver code paths), not hardware acceptance.
- The simulator's touch model only drives the controller the firmware expects imperfectly: the firmware logs repeated `lume-touch: touch bus down after 10 read errors, resetting` in the emulator. Boot, rendering, and serial are unaffected; touch interaction in the browser emulator is not yet usable and awaits either an upstream board-profile fix or a lume board-profile shim.
- `website/wasm/fw/` ships a seeded firmware trio (Build firmware run 41) so the first Pages deployment works; afterwards fw-sync.yml overwrites it from each successful firmware.yml build and regenerates lume.json with a `_note` (commit SHA + build date). The ROM ELF is the Apache-2.0 espressif esp-rom-elfs artifact, redistributed per license.
- No hot reload in the browser firmware mode; the app JS inside the emulated flash is whatever the CI build embedded. `lume dev` on real hardware remains the only hot-reload path.
## r75 / Memory Match (host + esp32sim evidence, no board acceptance)

- **No flip animation**: cards flip by teleport (full redraw of the card cell) and a miss flips back after two 150 ms ticks (frame counting in the app's interval, not a precise setTimeout). No tween / lv_anim transition, matching the r68 frogger simplification. The miss flip-back repaints the whole grid area once (376x376 dirty rect, ~61% of a frame); matched pairs repaint only their two cells.
- **No sound effects**, consistent with the r68/r69 retro apps (pending board, not an omission).
- **Best-score policy**: `hisc.memory` (11 chars, under the 15-char NVS cap) stores the fewest-moves win; only a strictly smaller count overwrites (equal keeps). The browser runtime `storage.kv` remains a no-op stub, so the browser playground shows `BEST -` until played on hardware; the app degrades to a volatile in-session best via try/catch.
- **Grid geometry is harness-locked** (CELL=88 GAP=8 GX=64 GY=44 -> bottom edge 420, above the y=424 button row); the single 480x480 canvas consumes the entire 230,400 px budget, so any future pixel-drawing feature in this app requires budget headroom first.
- Still open (all board acceptance): real touch feel, flip-back pacing on-device, KV persistence across power cycles, bundle push. `lume check` green + 12-case harness green + emu screenshot reviewed do not equal hardware acceptance.

## r76 / Minesweeper (host + esp32sim evidence, no board acceptance)

- **No chording**: the classic double-click "open around a satisfied number" is not implemented — each neighbouring cell must be dug individually. No dynamic difficulty (fixed 10x10 / 15 mines), no "unsafe flag" marking when the flag count exceeds the mine count.
- **Flood fill uses an explicit stack** (no recursion) so the QuickJS depth budget is untouched; flagged cells are never auto-opened by the flood and never count toward the win verdict — the win is exactly "85 safe cells revealed".
- **First-tap safety**: mines are placed after the first dig, excluding the tapped cell and its 8 neighbours; there is no timing compensation (the 1 Hz clock only runs between start and game-over, so pre-boom scans cost no time).
- **Grid geometry is harness-locked** (CELL=38 GAP=2 GX=41 GY=64 -> grid 398x398, right edge 439 / bottom edge 462, top edge clears the BEST text row at y=48). The single 480x480 canvas consumes the entire 230,400 px budget. Round-screen corner occlusion (grid corners / RESTART outer edge beyond the inscribed circle) follows the existing examples precedent (memory/sokoban), deferred to board acceptance.
- Still open (all board acceptance): long-press threshold feel on-device, 1 Hz timer drift, KV persistence across power cycles, bundle push. `lume check` green + 15-case harness green + emu screenshot reviewed do not equal hardware acceptance.

## r81 / Retained canvas sprites (ctx.retainImage / ctx.drawImage)

- **Colour-key transparency, not alpha**: source pixels equal to 0x0000 (RGB565 pure black) are skipped when blitting; everything else is copied opaque. Apps needing near-black ink use #000001 (3x3x1 channels, visually indistinguishable on the AMOLED). No per-pixel alpha plane — keeps the blit a pure 16-bit copy.
- **Bitmap source is JS pixels only**: `retainImage(slot, w, h, Uint16Array)` takes an app-computed RGB565 array; there is no PNG/SVG/JPEG decode on device (the r58 mini-SVG rasteriser remains the only on-device vector path). Rationale: decoding would blow the JS budget (~0.5 Mops/s) the retained path exists to avoid.
- **8 slots per canvas, one budget in bytes**: LUME_CANVAS_SPRITE_BUDGET = 480*480*2 (one full-screen RGB565 image) across all slots of a canvas; a define that would exceed it is dropped with an error log (JS side pre-checks per-sprite size, not the cumulative budget, so the bridge log is authoritative). Re-defining a slot replaces the old bitmap (animation frame swap, no leak).
- **flip is horizontal only**: 90/270 degree rotation and vertical mirror are not implemented (character facing covers the known use case; add on demand).
- **Browser simulator parity**: renderer.js replays spriteDefine/spriteDraw with the same colour key and flip semantics via ImageData; invalidation/dirty-rect behaviour follows the existing canvas message replay (the browser does not model the double-buffer swap).

## r83 / 全屏精灵卷轴 POC（app/工具层，无真机验收）

- **卷轴实现 = 全 work-buffer 重画 + 脏区发布**：每帧把 sky/hill/ground 与动态
  精灵全部 `drawImage` 到 work buffer，再只发布相机扫过的两条水平带
  （hill 480×40 + ground 480×62 = 48,960 px）与英雄/金币包围盒；不是硬件
  framebuffer 平移，也没有真正的视差层位移（hill 用 cam/2 偏移重画，但旧像素
  靠整屏 work 重画清除）。真平移需新 C 原语，本轮不做。
- **金币矩形合并**：bridge 每帧最多 8 个脏矩形，两带已占 2 个，故所有金币的
  old∪new 盒合成一个大矩形（矩形内含未变化像素）；稳态 4 矩形/帧，换来的是
  不触上限。障碍尖刺落在 ground 带内，不单列矩形。
- **精灵来源**：角色/障碍/金币为原创 ASCII 造型 → RLE spans → Uint16Array
  RGB565 一次预计算（`TOTAL_SPANS=85`）；三条背景带直接生成位图，不占 spans。
  不点名、不复刻任何商业作品；文案纯 ASCII。
- **触摸**：tap 跳、swipe down 冲刺+下蹲、两枚按钮，均按单点触摸设计。r74
  已登记 emu 触摸 IC 与 CST9220 驱动不匹配，真机 tap/swipe 阈值手感未验；
  手势逻辑只在 host harness 用事件序列验证，不声称 emu 触摸验收。
- **KV**：`hisc.scroller`（13 字符）在 NVS 15 字符上限内；浏览器 playground
  的 `storage.kv` 仍是 no-op 桩，离线 try/catch 静默降级。
- **性能口径限制**：`js_avg_ms≈10`（emu `esp_timer` 粗粒度、最大 11ms）是
  上界估计，不是 ESP32-S3 执行时间；host 200 帧 onDraw 实测 0.682ms/帧
  （Node vm 真实挂钟），两者不可互换。emu wall `Minsn/s`（39.6 vs counter
  36.6）受宿主负载影响不可比，可比的是每模拟秒指令（112.6 vs 26.1，
  4.31×）。全部为 host/esp32sim 证据。
- **浏览器配套修复**：r81 的 `renderer.js` spriteDraw 把 `createImageData(w,h)`
  当整屏缓冲，在 (dx,dy)≠(0,0) 时越界写导致精灵只画在左上角；本轮被首个
  blit app 暴露，改为离屏 canvas + drawImage；`website/playground/runtime.js`
  同时补齐 r81 漏加的 `canvasSpriteDefine/Draw` natives。两者都属 JS 工具层，
  不影响固件 size。
- **仍 open（全部真机验收）**：真机帧率与 p95/p99、AMOLED 色彩、PSRAM 批量
  define 余量、bundle 推送、sleep current、触摸手感。`lume check` 绿 + 9 例
  harness 绿 + emu 截图人工检视 + 31-app 浏览器 verify 绿 ≠ 硬件验收。
  flappy 同构 mini demo 未做，留 P1 评估。

## r84 / lume.imgscale RGB565 缩放（host + 固件构建证据，无真机验收）

- **纯逐像素采样，无透明/颜色 key**：`scale()` 不识别 RGB565 `0x0000` 透明，
  也不做颜色 key 比较；bilinear 会直接把黑色像素与邻像素混合。透明语义继续由
  `ctx.retainImage` / `ctx.drawImage`（r81：来源像素等于 0x0000 时跳过 blit）
  负责。理由：缩放是通用数组变换，消费方可能是缩略图、sprite 或查看器，透明
  约定应留在渲染层，不写进数值原语。
- **写调用方 Uint16Array，不写 Canvas work buffer**：路线清单原文建议 r79
  模式直写 work buffer；本轮契约采用 typed-array 进 / typed-array 出，结果作为
  `retainImage` 的输入。无需新增渲染通道，也保持 `lume.imgscale` 可在无 UI 场景
  （如频谱数据、离屏缩略）使用。未改 ui-bridge / 渲染管线。
- **边缘 clamp + 8-bit 定点 bilinear**：源坐标先 clamp 到 `[0, size-1]` 再取
  整，权重量化到 1/256，分量四舍五入到最近整数。低分辨率下的双线性结果可能
  与浮点实现差 1 个分量 LSB；这是为避开 ESP32-S3 软件浮点而做的固定取舍。
- **整数维度 1..16384，分数维度 -2**：不静默截断（与 `JS_ToInt32` 默认行为
  不同）；超范围或过长视图一律 -2。
- **同 buffer 仅「同视图 + 同尺寸」可原地拷贝**：部分重叠（含同起点不同网格）
  一律 -2；不尝试 memmove 式重排，避免正向/反向写顺序耦合。
- **未加消费方 demo（可选项）**：`examples/image_gallery` 缩略路径未改动，留
  待下轮接入；本轮只交付原语与 host/playground 桩。
- **待真机验收**：缩放耗时、缩略图视觉质量、与 retainImage 串联的实际吞吐、
  大图 PSRAM 余量与 bundle 推送均 pending board。host 单样本性能对照
  （JS 17.8550 ms vs native 0.4000 ms，64x64->128x128，200 次均值）及
  固件 `idf.py size` 绿 ≠ 硬件验收。

## r85 / lume.image.decode 像素出口 + gallery 缩略（host + 固件构建证据，无真机验收）

- **decode 内存口径**：`decode()` 先把整张图按原生路径解到 PSRAM（PNG 为
  RGB565A8 3 B/px，JPEG 为 RGB565 2 B/px），再把 RGB565 颜色面 `memcpy` 进
  QuickJS 堆的 Uint16Array，随后立刻释放 PSRAM 缓冲。因此单张 480x480 图的
  瞬时峰值 = PSRAM 解码面（PNG 另加 w*h*4 RGBA 临时面）+ JS 堆 460,800 B
  像素；若同时保留原图 Image 节点与多个缩略图，`retainImage` 还会各占一份
  PSRAM 精灵拷贝。大图 + 大缩略并存的实际 PSRAM 峰值、GC 时序与碎片情况
  未在本机测量，须接板用 `heap_caps` 读数验收。host harness 只验证位模式与
  契约，不模拟 PSRAM 压力。
- **PNG alpha 平面丢弃**：原生 PNG 解码面是颜色面 + A8 面，`decode()` 只导出
  颜色面，半透明/透明信息不进入 JS。需要透明像素的场景继续使用 `Image()`
  的 `_setSource` 原生路径（A8 由 bridge 消费）。
- **缩略质量**：`decode(bytes, maxW, maxH)` 的缩放固定为 nearest（r84 默认），
  小尺寸缩略会有锯齿；未暴露 mode 参数。bilinear 由调用方对返回的 pixels
  另调 `lume.imgscale.scale(..., 'bilinear')` 自行完成。gallery 的 96x96 缩略
  用 nearest，视觉质量待真机确认。
- **错误码语义**：`-1` 参数/类型错（非 ArrayBuffer、缺少一个目标维度、
  coercion 抛错），`-2` 解码失败/超尺寸（含 480x480 上限与非法目标维度），
  `-3` PSRAM OOM 直接透传原生解码器返回值而非折叠为 -2。`maxW/maxH` 的
  16384 维度上限与整数校验复用 r84 口径；部分重叠拒绝规则在 decode 路径
  不适用（输出是新建 JS 缓冲，不会与源 PSRAM 缓冲重叠）。
- **gallery 演示范围**：TF 卡图片走 decode -> 96x96 -> Canvas.retainImage 缩略；
  无卡/解码失败回退既有内嵌 1x1 PNG 与原 Image 直显路径。点按看大图未做，
  如实登记为未做项（可选）。host 桩无真实 PNG/JPEG 解码器，返回确定性
  RGB565 图案；浏览器 playground 与 Node host 桩均为结构桩，不代表原生画质。
- **待真机验收**：缩略解码耗时、retainImage 串联吞吐、PSRAM 峰值、TF 卡
  （<=64 KiB）实际读取成功率、bundle 推送与 AMOLED 观感均 pending board；
  host、浏览器与固件 `idf.py size` 结果均不代表板上验收。

## r86 / Waveshare ESP32-S3-Touch-AMOLED-1.75C profile

- 466×466 CO5300 / CST9217 / 32 MB flash profile is selected at compile time.
  The CST9217 uses the existing CST92xx protocol path; its project ID is
  diagnostic only. The board has no TF slot, so SD-backed file and MP3 calls
  return the existing unavailable error `-2`.
- Column offset 0, the copied CO5300 init sequence and 2.16 touch orientation
  are provisional pending first board power-on. Display placement, touch
  mapping and feel, audio, sleep current, radio, persistence and bundle push
  remain unverified on hardware. Build and host checks establish only compile
  and host behavior; details are in `docs/r86-amoled-175c-report.md`.

## r91 / lume.crypto 原生原语

- **CRC-32 不是 mbedTLS 封装**：mbedTLS 3.x 无 `mbedtls_crc32`，ESP-IDF 的
  `esp_crc32_le` 是 ROM 封装（host harness 不可用），故 CRC32 在组件内用
  表无关反射 0xEDB88320 循环实现（与 zlib/Node zlib.crc32 seed 语义一致）。
  SHA-256 / HMAC-SHA256 / AES-CTR 仍全部走 IDF mbedTLS，未改任何 IDF 源码。
- **browser playground / Node prelude 桩为 unsupported**：宿主没有 mbedTLS，
  `lume.crypto` 四个方法只保留命名空间形状并返回 -3（未支持），带 onWarn
  提示，可通过 `options.crypto` 注入实现；不伪造密码学结果。权威路径是
  固件与 host harness（编译同一份 `lume_crypto.c`）。
- **接板验收 deferred**：真机 mbedTLS/AES 硬件加速路径、吞吐与时延、WS 鉴权/
  OTA 校验/配网 token 等消费方接入未验证；host 向量、build 与 size 不代表
  板上验收。详见 `docs/r91-crypto-report.md`。

## r92 / lume.compress 原生原语

- **只解压不压缩**：vendored miniz 3.1.0 tinfl 只含解压协程（`lume.compress.inflate`），
  不含 tdefl/`compress` 入口。沿用简报「解压优先，压缩 JS/设备侧用不上」口径；
  如将来确需压缩再独立评估，不为对称 API 提前引入无消费方入口。
- **zlib 校验口径**：`format='zlib'`（RFC 1950）由 tinfl 内置校验——CMF/FLG
  合法性（`(CMF<<8|FLG)%31==0`、`CM=8`）、拒绝 preset dictionary（FDICT）、
  解压结束校验 Adler-32（不匹配返回 `-2`）。`format='raw'`/默认（RFC 1951）
  不读 zlib 头、不校验 Adler。因 tinfl 已覆盖 Adler-32，**不额外暴露
  `adler32` 原语**（避免无消费方 API）。error code：`-1` 类型/format 非法、
  `-2` 损坏/截断/校验失败、`-3` out 太小（拒绝越界写，视图外字节不动）。
- **vendored 取材与修改**：ESP-IDF 自带 `miniz.h` 是 ROM 实现声明头（host
  harness 不可用，同 r91 `esp_crc32_le` 坑），LVGL 内 `lodepng.c` 的 inflate
  绑 malloc/ucvector、侵入大，均排除。选本机已有的 miniz 3.1.0 单文件
  `miniz_tinfl.c`（public domain/MIT），合并 prologue、丢弃 malloc 版 helper、
  固定 32-bit bitbuf；协程逐字节原样，来源与全部修改见组件 `VENDOR.md`。
- **browser playground / Node prelude 桩为 unsupported**：宿主无同步 inflate
  解码器，`lume.compress.inflate` 只保留命名空间形状并返回 -3（未支持），带
  onWarn 提示，可通过 `options.compress` 注入实现；不伪造解压结果。权威路径是
  固件与 host harness（编译同一份 `lume_compress.c`）。
- **性能口径**：host 单样本 native 23ms vs Node zlib 40ms（200×111KB），两者均
  为宿主测量、Node zlib 本身是 native C（非 JS 解压实现），不代表 ESP32-S3
  吞吐；真机 DEFLATE 解压耗时/功耗未测。
- **接板验收 deferred**：真机热更新大包解压、日志/历史数据压缩存储消费方接入、
  256KiB bundle 上限内实际压缩比、AMOLED 观感未验证；host、build 与 size 只
  证明编译与宿主行为。本轮无 UI 改动，emu 未跑。详见
  `docs/r92-compress-report.md`。

## r93 / lvgl_task 事件驱动化

- **简报前提翻案**：r35b/roadmap 候选 #1 所述「33 ms timer + 10 ms 固定轮询」
  是过期快照。r92 基线 `lume_board.c:125-133` 已是 `wait_ms = lv_timer_handler()`
  驱动 + 10 ms 封顶（r36b commit `62bb0ff`，见 `docs/r36b-perf-report.md:9`）。
  r93 删封顶并接入通知唤醒，不是把固定轮询改成 wait_ms（那步 r36b 已做）。
- **删封顶不改变空载唤醒频率**：`lume_ui_bridge.c:40,1811` 的 5 ms drain timer
  常驻且从不暂停，`lv_timer_handler()`（`lv_timer.c:119-147`）总返回 ≤5 ms，
  故旧 `if (wait_ms>10) wait_ms=10` 在 r92 配置下从不命中。r93 的可证收益是
  **事件响应延迟**（post/timer 新建立即唤醒、`LV_NO_TIMER_READY` 真睡眠），
  不是空闲唤醒数；这是 host/emu 侧可证事实，**不代表 ESP32-S3 功耗**。
- **功耗/帧率量化收益 pending board**：调度轮无真机功耗计，也不改
  `CONFIG_LUME_REFRESH_PERIOD_MS`（默认 33 ms）。r35b 的 30 fps 上限来自刷新
  周期本身，r93 不宣称解锁帧率；真机 A/B（r92 vs r93 固件 + profile + 功耗计）
  未做，sleep current / 动画帧率 / 触摸手感仍 deferred。
- **未做 drain timer 暂停优化**：没有把 5 ms drain timer 改成「队列空则暂停、
  post 时恢复」，因为那要从引擎任务跨任务调用 `lv_timer_resume`（`LV_USE_OS=NONE`
  无锁、写 LVGL 全局状态）并触碰 Queue A 满队列重试语义，回归风险超出本刀；
  真要压低空载唤醒频率需独立评估并在此登记翻案。
- **vendored 未改**：只用 LVGL 已导出的 `lv_timer_handler_set_resume_cb`
  （`lv_timer.h:73`），未动 `lv_conf.h`/LVGL/QuickJS 源码，故无 VENDOR.md 变更。
  esp32sim 加载同一份 `lume.bin`，与真机共用 `lvgl_task`（`tools/emu/run.sh:37-43`），
  两条路径本轮均过；模拟器 CST820 触摸模型与 CST9220 驱动不匹配，触摸手感
  不能由 emu 验收。详见 `docs/r93-lvglev-report.md`。

## r94 / 流体粒子沙盒 examples/particles（纯 app 层）

- **物理是简化近似，不是真流体**：220 粒子的邻域作用只做 3x3 网格的
  capped **位置式分离**（防重叠）+ 速度阻尼 + 限速 + 四壁回弹 + 重力；
  无 SPH 密度/压力投影、无黏性、无表面张力、无粒子-粒子速度交换。
  「流体感」是视觉近似，不宣称物理正确。网格是每步重建的预分配链表，
  无逐帧 JS 分配；detected 的 shake 只是一次径向速度注入，非真实甩动积分。
- **渲染预算取舍**：单 480x480 canvas 恰满 460,800 B 全 app 预算，无第二个
  canvas/HUD 画布；每帧清旧+画新用 union dirty box 一次 clear +
  220 次 fillRect(6x6)（恒 221 draw/帧，harness 锁 <250）。粒子铺满屏后
  union box 实为全屏，脏区纪律在代码层成立但**不带来像素节省**；这是
  屏幕填满型沙盒的固有结果，不是 bug。
- **IMU 单位与降级**：`lume.imu.read()` 返回 m/s^2（静止 +Z ~9.81），
  本 app 直接乘 GAIN 映射为 px/s^2，shake 用 `|a-9.80665|>4 m/s^2`
  （**非 g 阈值**）；静止补 `STATIC_G=2 m/s^2` 避免平板失重，属展示取向。
  无板/浏览器 `read()===null` → demo 慢转重力（compass 先例），真机 IMU
  轴向/增益/甩动阈值均未接板核对，pending board。
- **性能口径**：host harness 的 `particleTick` 约 1.5–2.5 ms/50 ms，
  但 esp32sim `jit: 0 compiled` 下报 57–257 ms（221 次 canvasDraw 跨语言
  边界被解释执行放大；先例 invaders 同口径 93.72 ms）。emu 60 s 全程
  eval_ok=2 / RELOAD ERR=0 / ui queue full=0、数组长度恒定，**不宣称
  emu 20 fps 已达标**；真机帧率/功耗/观感 deferred 到接板验收。
- **KV 偏好**：`pt.mode`（7 字符）只存 `auto`/`demo` 字符串偏好；
  `get()` 用严格 `===` 匹配，不把负数当错误码（r10 歧义口径），
  NVS 不可用时退化为内存偏好。详见 `docs/r94-particles-report.md`。

## r95 / voice_assistant 对讲机 demo examples/voice_assistant（纯 app 层，legacy 同步）

- **legacy 同步阻塞口径**：`lume.ai.chat`（同步 HTTP，最长 120 s）与
  `lume.audio.record`（整段录音，最长 10 s）都阻塞单引擎 task。本刀只在阻塞前
  用 `setTimeout(...,0)` 让出一帧渲染 THINK/LISTEN 卡片，**不宣称「不卡 UI」或
  流式输出**。真流式/全双工需 D 刀网关 + async 路线（A/B/C 固件刀已就绪，
  D 未拍板），真机「开口 <2 s」时延预算未验证。
- **无 ASR/TTS 的对讲机闭环**：legacy 没有语音识别/合成——「用户语句」是
  `VA_CANNED` 里的 canned prompt，录音 PCM 只驱动波形电平（crude RMS），
  「回答播报」是 0.18 s 660 Hz 合成 beep 经 `audio.play()`，不是语音合成。
  该 demo 验证的是状态机/产品手感，不验证语音链路正确性。
- **DEMO 降级**：无 `ai_api_key` 或 `net.status().state !== GOT_IP` → DEMO，
  4 条 canned 问答轮换；`MODE DEMO/LIVE` 徽章如实标注。host/浏览器因无 key、
  无网络、无 mic 恒为 DEMO；`MODE LIVE` 仅在 harness 注入下覆盖，未在真机
  WiFi 下验证。`record()` 返回 -3 时只记日志并保留 demo 电平，不崩溃。
- **状态机边界**：合法边仅 6 条（`IDLE→LISTEN`、`LISTEN→{IDLE,THINK}`、
  `THINK→{SPEAK,IDLE}`、`SPEAK→IDLE`）；THINK 中 tap 不动作；barge-in 只在
  SPEAK 生效；LISTEN 4 s 看门狗超时回 IDLE 而非自动发送。逐字上屏 30 cps
  按 typewriter 的 OOM 教训只在 timer 写整数 signal，字符串由 `Text` getter
  拼接；canvas 单 320×160 = 51,200 px（预算 230,400 px 余量充足）。
- **transport 槽是唯一替换点**：`vaTransport`/`vaSetTransport(fn)` 用 `done(text,err)`
  回调造型兼容同步 legacy 与未来异步 WS/网关；本刀默认 legacy，未接 D 刀网关。
- **未做接板验收**：ES7210/ES8311 音频链路、触摸唤醒/长按/打断手感、
  AMOLED 观感、barge-in 实际延迟、功耗全部 deferred to board bring-up；
  emu/simulator 不能验证硬件行为（esp32sim 触摸模型与 CST9220 不匹配）。
  emu 12 s 仅证 eval_ok=2 / RELOAD ERR=0 / ui queue full=0 的 DEMO 主屏不白屏。
  详见 `docs/r95-voice-report.md`。

## r96 / WiFi OTA app-push channel（HMAC-SHA256 challenge-response）

- **复用 r26 transport，不新建 `lume-ota` 组件**：r26 已把 TCP 传输、token/NVS、帧
  parser sink、回复 FIFO、engine reload 链放在 `lume-hotreload` 并与 USB 共用。拆出
  新组件要么制造双向依赖/函数指针间接层，要么搬走共享 `lume_frame.c` 并重写所有
  harness include——高风险低收益。`lume_frame.c/.h` 仍是 USB/TCP 唯一共享帧入口，
  r96 只扩展其便携鉴权导线助手。这是简报允许的「明确登记为何分层」。
- **端口 8765（非简报举例 7801）**：r26 已文档化、CLI 已默认；webserv 默认 8080，
  Kconfig 互引注释确认无冲突。改号只会破坏既有部署。
- **HMAC 分层**：便携层只做 hex/挑战行/AUTH 解析/常量时间比较，HMAC 数学由注入的
  `lume_ota_hmac_fn` 提供（固件=mbedTLS，host harness=同一 mbedTLS 最小 closure，
  CLI=node:crypto）。host 不复制密码学实现；`lume.crypto.hmacSha256` 是 JS typed-array
  API，非固件消费路径，固件在 C 侧直接调 mbedTLS 同原语。
- **token 首次设置 = 首启自动生成 + 串口日志 + 串口 `TOKEN <32hex>` LUMC 命令**
  （另给 `lume.ota.setToken()`）；NVS `"lume_ota"/"token"` 合规（≤15 字符）。未接
  `lume.net.web` 设 token：需新增 web 路由 + JS 暴露，侵入更大且非安全必需（pending）。
- **`lume.ota` 只有 `status()/setToken()`，无 `start/stop`**：监听器由 WiFi GOT_IP 门
  自动启停，手动开关会破坏该不变量。`lume.net.otaStatus()` 保留并加 `hmac` 字段。
- **不做 TLS / mDNS / 固件镜像 OTA 分区**：token 不上线 + 每连接新挑战已高于 r71
  webserv 明文 key 的水位；TLS（证书/内存/IRAM）、mDNS 发现、A/B 镜像分区登记为
  pending / 接板后另刀。IP 仍手填。
- **板验 deferred**：esp32sim 不建模 WiFi；counter emu 烟测只证明未破坏启动/热替换
  链路。真 WiFi 关联、CHALLENGE/AUTH 真板往返、token 掉电持久性、实测时延/吞吐、
  多客户端串行行为一律 deferred to board bring-up，不声称硬件验收。

## r109 / 1.75" 圆屏板 profile 三类差异复核（编译期 + 宿主证据，仍无真机验收）

- **范围与纠偏**：简报假设"1.75c 只接了 Kconfig、驱动未补齐"被读码推翻——r86
  （HEAD 祖先）已按 Waveshare 1.75C BSP 口径补齐 profile/驱动消费路径，本轮不重做，
  只新增 freestanding 静态断言 `tests/board_175c_profile.c` 锁定宏契约。以下三类差异
  的"来源"均为 **r86 review fix 已核过的 Waveshare 官方例程口径**（例程原文不在仓，
  按 r45 先例 + 现有序列自查），**不是本轮新读到的例程原文，也未真机核对**。
- **① 触摸 IC/协议**：1.75C 装的是 **CST9217**（`CST92xx` 族，地址 0x5A 为 r86
  继承的待探测值），复用 16-bit 寄存器 / 10 字节帧的 CST9220 路径；**不是** 1.8 V2
  的 CST820/CST816S（0x15）/ 8-bit / 6 字节帧路径。BSP `swap_xy=0,mirror_x=1,mirror_y=1`
  → `px=465-tx, py=465-ty`。来源：r86 review fix 对
  `bsp/esp32_s3_touch_amoled_1_75c/esp32_s3_touch_amoled_1_75c.c:bsp_display_start`
  的对齐（详见 `docs/r86-amoled-175c-report.md`）。`lume_touch.c` 的项目 ID 读取仅诊断、
  无硬芯片 ID 校验，故未新增驱动分叉。**未真机核对**：触摸方向/手感/INT 行为一律
  deferred to board bring-up。
- **② LCD 初始化**：CO5300 466×466，6 列 CASET 偏移（`00 06 01 D7`）/ RASET `01 D1`，
  序列 `FE,19,1C,FE,C4,3A,35,53,51,63,2A,2B,11,29`（`2B`/`11` 后各 600ms，无 MADCTL），
  QSPI 40MHz / cmd 32-bit / param 8-bit / mode 0。来源：r86 review fix 对齐同一 BSP 的
  `lcd_init_cmds`。`LUME_LCD_COLUMN_OFFSET` 在 `lume_display.c:334` flush 路径生效
  （r45 先例），init 表 CASET 保留物理列起点。**未真机核对**：点屏、色彩、gap 实机效果、
  序列时序全部 deferred。
- **③ 其他外设路由**：**无 TF 卡槽**（`LUME_PIN_SD_*` 全未定义，SD 调用返回既有 -2）；
  ES8311 @0x18 + ES7210 @0x40 + AXP2101 @0x34 + QMI8658 @0x6B；屏/触摸复位为
  **直接 GPIO**（GPIO1/GPIO2），**不经 TCA9554**（`LUME_HAS_IO_EXPANDER_RESET` 未定义，
  与 1.8 的 r45 路径相反）。来源：r86 官方 1.75C Arduino `pin_config.h` / BSP 引脚表
  与 `413a6af`。**未真机核对**：PMIC 轨电压/上电顺序、ES7210/ES8311 音频链路、
  复位时序与电压 deferred。
- **顶栏等宽（纯 JS）**：StatusBar 原硬编码 432/24/24，在 368 宽屏与 466 圆屏安全区
  溢出；改为按 `__lumeScreen` + `safeInsets` 派生，圆屏与 r104 SafeArea 等宽。
  480 方屏逐值不变；368 方屏从溢出 432 clamp 到 320（修复，非回归）；**触摸碰撞、
  圆屏实际裁切/观感仍 deferred to board bring-up**，宿主断言只证明下发几何正确。
- **默认板零 C 行为改动**：本轮固件相关改动仅 profile 头注释（不进二进制）、JS、
  harness、docs；默认 Flash Code 2,032,588 vs 简报 r106 基线 2,032,860 = −272 B，
  IRAM 16,384/16,384 Remain 0 不超。`sdkconfig` 由 `set-target` 追加的一行已还原。
  与 r106 逐字节相同不作承诺（r96 OTA 合入改变过代码基线）；只如实记录差值。
- **仍 open**：运行时切板、多板 CI、以及上述全部板级真机验收；`docs/roadmap.md` 的
  M5 "Board abstraction for additional targets" 保持 `[ ]`。
