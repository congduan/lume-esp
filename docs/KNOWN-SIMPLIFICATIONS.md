# Known Simplifications / Deferred Acceptance (M1)

## r125 — TF 卡（microSD）SPI 模式 `lume.storage.Sd`（固件刀；无真机/无插卡）

- **纯模拟侧验收**：证据 = `idf.py build` 绿 + size 达标（Flash Code 2,037,888，较 r124
  基线 ~2.02x,xxx 增量 ~16 KB，为 sdmmc/sdspi/fatfs 驱动栈传递链接；IRAM .text 15,356 < 16,384
  上限不变）+ 宿主 harness `tests/sdcard.js` 4 例全绿 + 全量宿主回归 0 FAIL +
  `npm test --prefix tools/lume` 50 pass / 0 fail + `check_website.py`
  missing/invented/duplicates 均 none。**无真机插卡验证**：真实 mount、读卡容量、读写/
  掉电持久性、CD 行为全部 deferred to board-connected round。
- **引脚出处**：2.16 profile `LUME_PIN_SD_MOSI/CLK/MISO/CS = GPIO1/2/3/41`
  （`firmware/boards/waveshare_esp32_s3_touch_amoled_2_16/lume_board_profile.h:49-52`，
  沿用 mp3_decoder SDSPI 先例的 SPI3 + 板级引脚）。1.8 profile 同名引脚实为 SDMMC
  CMD/CLK/D0（profile 内已有注释），1.75c 无卡槽（`LUME_PIN_SD_*` 故意不定义 → 编译期
  `LUME_SD_HAS_SLOT=0`，全部 API 返 -3）——SPI 口径只对 2.16 声称有效。
- **CD 脚策略**：三块板 profile 均无 `LUME_PIN_SD_CD`，`detect()` 统一返 -4
  （`LUME_SD_ERR_NO_CD`），`mounted()` 以 mount 结果为准（简报允许的两种取舍之一）。
- **绝不自动格式化**：`format_if_mount_failed=false`（与 Fs 首挂自动格式化相反——卡里可能
  有用户数据）；mount 失败非致命、lazy one-shot（`s_tried` 锁定，失败后本轮 boot 所有 API
  返 -3，不重试风暴）；mount 失败路径 `spi_bus_free` 释放总线。
- **statvfs 实现**：ESP-IDF FATFS 无 POSIX `statvfs`（引擎首版编译失败已证），改用
  `f_getfree`（`ff.h`），容量 = `csize * ssize * n_fatent`；数值经 `JS_NewInt64` 全量
  返回（FAT32 最大 2 TiB << 2^53，JS 安全整数内，无精度取舍）。
- **LFN/编码配置**：`CONFIG_FATFS_LFN_STACK=y + MAX_LFN=128` 本已在 sdkconfig.defaults
  （r12 Fs 轮引入），本轮只新增 `CONFIG_FATFS_API_ENCODING_UTF_8=y` 一行（diff 已贴于
  commit），使 VFS 路径 UTF-8 往返与 Fs/Kv 口径一致。
- **速度档**：SDSPI 10 MHz 默认档起步（Waveshare demo 同档），`max_transfer_sz 4096`
  对齐 mp3_decoder 先例；更高速度档留真机实测后再调。

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
- **验证口径（host + 编译，非真机）**：`tests/webserver.js` 8 例全绿（精确路由 / 404 / query 解析 / token 403 / 8 KiB body / start-stop 生命周期 / 全链 + handler 异常 500）；`tests/webserv_parse.c` gcc `-Wall -Wextra -Werror` 51 checks PASS（请求行 / header / body 截取 / 畸形输入 / 边界 / token 常数比较）；固件 `idf.py build` + `idf.py size` 与 IRAM 16384 硬线见 `docs/archive/r71-webserv-report.md` 原始输出。esp32sim 无 host 网络回环时，以「C 解析单测 + JS 路由 host 测试」双证据替代，不做假的网络回环断言。
- **仍 open（真机验收）**：手机/浏览器经真实 WiFi 打开 `http://<ip>:8080/?key=...`、屏幕大字可读性、握手/DHCP 后自动监听与掉线停服、表单 POST 写 KV 后 abc123 侧轮询消费、并发 2 连接与 8 KiB body 的真机内存峰值、与 OTA(8765) 同时监听的射频共存，一律未验。`examples/web_config/` 只做服务端通路 + 演示页，不改 abc123 本体（主控后续排线）。
## r73 / abc123 SVG 字形（host + esp32sim，真机待验）

- `tools/font2svg/generate.py` 用 fontTools 从 DejaVu Sans Bold TTF 一次性生成 62 个静态 SVG 和 26 个竖排 Aa 组合，路径指令均在 r58 的 M/L/H/V/C/S/Q/T/A/Z 子集内。生成物采用 100×100 viewBox、固定白色 fill；mini-SVG 不支持运行时改色或 `transform`，换色须再生成 SVG。静态轮廓没有笔顺/描红动画；弹跳仅作用于整个 Image 节点。
- 数字字形也改为字体轮廓；当前版本改为静态黑底，顶部 MODE 文案和底部识字文案保持原有上下间距，移除数字下方实心圆点和 A-E 涂鸦所在的底部 Canvas。四模式为顺序、随机、小写、竖排 Aa；数字在小写和 Aa 模式仍显示同一个数字，底部文案仍保留数字点数的文字提示（不再是图形）。
- 字形 Image 声明 320×320 像素，r58 会按此尺寸光栅化。r58 的逐像素逐边采样在 MCU 软浮点上过慢（每个字形数十秒），现已改为 fill-only 闭合路径的扫描线 parity 填充：每个子扫描行只求一次边交点，再按区间覆盖 2×2 子采样；带 stroke 的通用路径仍走原采样器。macOS clang `-O2` 实测 320² 字形 A/B/O/8 由 21.7/28.8/36.3/100.0 ms 降到 0.4/0.5/0.3/0.6 ms；优化前后 8 个字形 + 9 个单测场景的 alpha 哈希逐项一致，`tests/lume_svg_test.c`、`tests/abc123.js`、`npm test --prefix tools/lume` 全绿。主机模拟器和 playground 仍以 Image 占位符显示，不能拿其截图验 SVG 画质。真机 SVG 解码耗时、翻页触感、PSRAM 峰值和 AMOLED 外观待接板验收。

## r70 / abc123 幼儿字母数字卡（host + browser + esp32sim 证据，无真机验收）

- **范围**：新增 `examples/abc123/app.js` + `tests/abc123.js`；playground 四处同步（build.mjs apps、page.js picker、index.html script、verify.mjs 24→25）并重新生成 `website/playground/{apps,sources}` 产物；README Apps 表加格、roadmap 新开「幼儿教育」叙事行、本条与 `docs/archive/r70-abc-report.md`。固件 C、prelude C 字符串、bridge ABI、帧协议、`runtime/types/lume.d.ts`、vendored 组件全部未改。未推送。
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

- **不做 size-class 分流分配器**：esp32sim 上 `counter` / `games_snake` 各 30 s 实测 GC 仅 3 次 / 约 4.8 ms，全在启动阶段，稳态 0 次；三个分母下 GC 耗时占比均 <5 %。按本轮 B2 判定「暂不需要」，未改 `JS_NewRuntime2` 分配器，也就未动已满线的 IRAM（16384/16384）。数据与口径见 `docs/archive/r43b-gc-report.md`。
- **字节码装载只在 esp32sim 验证**：`qjsc -b -C` 产出的字节码能被真机固件的 `JS_ReadObject` + `JS_EvalFunction` 装载；版本不匹配会返回负错误码、`ESP_LOGE` 并回退，不崩溃。实际启动时间、真机装载耗时、`--bytecode` 经 USB/WiFi-OTA 推送（VER 预检、STORE/LAUNCH 二进制落盘、ACK 时序）和长跑 GC 行为留接板轮。见 `docs/archive/r43b-bytecode-report.md`。
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
- **r43b 起源码与字节码路径共存**：`LUME` payload 仍直接当 JS 源码 `JS_Eval(...GLOBAL)`；`LUMB` payload 走 `JS_ReadObject` + `JS_EvalFunction` 的 qjsc 字节码（详见 `docs/archive/r43b-bytecode-report.md`）。源码仍是默认路径，字节码为 `--bytecode` 显式选项；引擎按 `LQBC` 头自动分流，两条路径共用一个 staging 槽。
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
- **2026-11-24 上游复核（BSP 2.0.1 / adapter 0.6.0-beta，替代上面旧快照的不可确认项）**：① Waveshare 官方 2.16 引脚表**没有 `LCD_TE`**，`GPIO13` 是 `RTC_INT`（PCF85063ATL）；1.8 / 2.06 板的 `GPIO13` 才是 `LCD_TE`，说明 2.16 未在板级引出 CO5300 TE。② BSP 2.0.1 `bsp_display_start()` 明确 `.tear_avoid_mode = ESP_LV_ADAPTER_TEAR_AVOID_MODE_NONE`，profile 为 `ESP_LV_ADAPTER_PANEL_IF_OTHER` + `buffer_height=50` + `use_psram=true` + 双缓冲，`bsp_display_cfg_t` 也没有 `te_sync` 字段。③ `esp_lvgl_adapter` 0.6.0-beta 已有 `ESP_LV_ADAPTER_TEAR_AVOID_MODE_TE_SYNC` 与 `ESP_LV_ADAPTER_DISPLAY_SPI_WITH_PSRAM_TE_DEFAULT_CONFIG(..., te_gpio, ...)`，软件侧支持 SPI/QSPI TE 同步，但板上无 TE 信号可接。④ 结论：在不改板（飞线/改原理图把 CO5300 TE 引到某个空闲 GPIO）的前提下，2.16 无法启用 vsync 防撕裂；Brookesia 同样没有启用。
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
- **仍未验收/未量化**：① 观感上"扫过"是否消除——需要人眼确认，且**理论上仍会存在**：总线时间由 QSPI 40 MHz 决定（≈29 ms/整屏），无法靠缓冲切法消除；② 新配置的 render/flush 数字未复测（本轮结束时 perf monitor 已关闭），r28 的 39/29 ms 是老配置读数；③ 240 MHz 对功耗/发热的影响未测；④ 2026-11-24 已确认：官方 2.16 引脚表无 `LCD_TE`（`GPIO13=RTC_INT`），Brookesia BSP 2.0.1 也显式 `TEAR_AVOID_MODE_NONE`。adapter 0.6.0-beta 虽支持 SPI/QSPI `TE_SYNC`，但板上无 TE 信号可接，**不改板无法引入 vsync**；只能通过减少脏区/动画降低观感，彻底消除需要硬件引出 TE。
- **2026-11-24 低风险刷新对齐（采用）**：`firmware/components/lvgl/lv_conf.h` 增加 `LV_DEF_REFR_PERIOD 15`（LVGL 默认 33）与 `LV_OBJ_STYLE_CACHE 1`；draw buffer 仍保持 20 行内部 SRAM DMA 双缓冲，不改 50 行 PSRAM、不改 `LV_USE_OS`。`idf.py -B build-local build` 通过（`lume.bin` `0x2e6a90`），烧录三件套 hash verified；`abc123` 重新部署成功，截图确认黑底、字形与上下文案正常。线条观感是否减轻仍需人眼在真机确认；无 TE 只能减轻，不能根除。
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

A patched esp32sim board model can boot the unmodified Lume firmware, inject JS bundles, and export 480×480 CO5300 screenshots in CI. The emulator's SPI/I2C models attach by host/bus/address and do not validate every physical GPIO route. The AXP2101 and audio codecs are register stubs; TF media, PMIC electrical behavior, audio output, touch timing and actual display timing remain unmodeled. The first CI version uploads artifacts for manual review, without a pixel baseline or a frame-rate gate. This is automated simulator evidence, not real-board acceptance. `image_gallery` currently evaluates and creates an Image node but its emulator screenshot shows background only. The no-IMU `gravity_ball` variant (then called `imu_ball`) does not crash; it uses the app's downward-gravity fallback and logs repeated QMI8658 warnings. See `docs/archive/r39b-emu-report.md`.

## r40b / small-screen example UI (simulator acceptance)

Ten example apps have 480×480 simulator screenshots and four have before/after captures in `artifacts/emu/ui-refresh/`. These captures validate the rendered layout with the current firmware image. Physical AMOLED clipping and color, touch targets, sleep behavior, PMIC values, TF media and audio remain unverified on the board. The emulator shows placeholder PMIC readings (for example 0% battery and 385.7 C); these are model data, not UI calculations. `image_gallery` remains a known emulator visual failure from r39b and is outside this UI refresh. `runtime/shell.js` supplies default semantic colors only when an importing app has no theme; the embedded prelude theme has not changed.

## r41b / screenshot geometry checks

`tools/emu/check_layout.py` checks configured visible block bounds and spacing in the ten refreshed 480×480 emulator captures. The page geometry now uses a 24 px outer gutter. This verifies only the captured app state; transient dialog states, the optional shell in a separately bundled app, and physical AMOLED clipping or touch feel still need device review. No firmware or bridge ABI was changed. See `docs/archive/r41b-alignment-report.md`.

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
- The original fill and stroke sampler visited every flattened edge for each covered pixel sample; a 100×100 circle icon did not finish app evaluation within the emulator's 8-second simulated window. Fill-only closed paths now use a scanline parity rasterizer with unchanged 2×2 AA coverage; stroked paths still use the per-sample edge scan. Latency for complex/stroked SVGs still needs board profiling before treating them as interactive assets.

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
  and host behavior; details are in `docs/archive/r86-amoled-175c-report.md`.

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
  板上验收。详见 `docs/archive/r91-crypto-report.md`。

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
  `docs/archive/r92-compress-report.md`。

## r93 / lvgl_task 事件驱动化

- **简报前提翻案**：r35b/roadmap 候选 #1 所述「33 ms timer + 10 ms 固定轮询」
  是过期快照。r92 基线 `lume_board.c:125-133` 已是 `wait_ms = lv_timer_handler()`
  驱动 + 10 ms 封顶（r36b commit `62bb0ff`，见 `docs/archive/r36b-perf-report.md:9`）。
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
  不能由 emu 验收。详见 `docs/archive/r93-lvglev-report.md`。

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
  NVS 不可用时退化为内存偏好。详见 `docs/archive/r94-particles-report.md`。

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
  详见 `docs/archive/r95-voice-report.md`。

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
  的对齐（详见 `docs/archive/r86-amoled-175c-report.md`）。`lume_touch.c` 的项目 ID 读取仅诊断、
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

## r110 — 多板 CI 矩阵（firmware.yml 三板构建）

- **Release 只出默认 2.16 板**：tag 构建跑全 3 板矩阵、三板 artifact zip 均上传，
  但 GitHub Release 资产只从默认板 job 组装（无板名后缀的扁平五件套），理由：
  现有刷机文档/网站 flasher 流程/脚本化下载保持字节兼容；1.8 与 1.75c 仍是
  无真机验收的编译期 profile，发布其二进制会夸大就绪度（矩阵 `release: true`
  仅标在 2.16 上，决策记录在 firmware.yml 头注释）。
- **CI 构建用 `rm -f sdkconfig` 前置**：tracked `firmware/sdkconfig` 在 CI
  checkout 后存在，会让 `SDKCONFIG_DEFAULTS` 静默失效（r44 gotcha），三板全部
  假绿成默认板。CI 命令必须先删它；本地切板同理（boards/README 第 5 步）。
- **矩阵板名引号纪律**：YAML 1.1 把未加引号的 `2_16` / `1_8` 解析成整数
  216 / 18（下划线被吞），artifact 名后缀会坏；matrix 值一律加引号。
- **本地 -g1 手术不进 repo**：宿主 2G 内存下 quickjs.c 调试信息汇编会 swap
  卡死（r78/r82 先例）。r110 实测：对 build 目录中 quickjs.c.obj 单独以
  同 flags 换 `-g1` 编译可 46-48s 完成（`-g0` 会破坏 Xtensa call8 范围导致
  "dangerous relocation" 链接错，因为剥掉的 @toolchain/cflags 内含
  -mlongcalls——@file 必须保留或内联）。这是本地 workaround，CI（更大
  runner）不需要；未改任何 vendored/工程编译选项。
- **仍 open**：三板真机验收全部 deferred；运行时切板不做；M5
  "Board abstraction" 的板级 HAL 收敛仍 open（本轮只闭环 CI 矩阵）。

## r113 / OpenAI 兼容上游适配器（三段 one-shot；host 假端点证据，无真机/无出网）

- **无流式 ASR / 无流式 TTS（ASR 半边 r117 已翻案；TTS 半边 r116 已翻案）**：
  r113 时上行 60 ms 帧流在网关侧**先攒后发**——整轮音频收齐
  （`stop()` 收口或静默兜底）后一次性 POST `/audio/transcriptions`；TTS 也是整段回复
  一次性合成再下行，不是边合成边播。取舍：v1 协议无上行分片 ASR 语义，先攒后发实现
  简单且对兼容端点要求最低；代价是首字时延 = 完整录音时长 + 三段串行 HTTP。真机
  时延预算 deferred，宿主不声称实时性。
  - **TTS 翻案（r116）**：见 r116 条目与 `docs/voice-gateway-protocol.md` §8.1.7。
  - **ASR 翻案（r117）**：协议 v1.1 追加 `transcript-delta`（独立 seq、单条定稿、
    先于 chat 首 delta）；配置 + `hello.caps` 双门启用 WS 流式转写，帧到达即转发，
    中间结果即时下行；未协商/失败回退 r113 REST，行为不变。**翻案依据**：
    `tests/gateway_upstream.js` r117 case 28-34（interim seq / 单条定稿 / 帧到即转
    的时间戳 / 双门回退 / stop 中止 / 流错降级 / 握手前 end 的 commit 排队）+
    `tests/gateway.js` case 11（真会话 seq 独立）+ `tests/va_ws.js` case 7（app 消费）+
    集成 smoke 实测 `recv.transcript-delta final=true @18:36:17.611` 早于
    `recv.text-delta seq=0 @18:36:17.749`（原始日志 `artifacts/r117-smoke.log`）。
    上游转写协议仍为适配性假设，真机时延 deferred（见下方 r117 条目）。
- **无 barge-in 中断上游**：`stop()` 按 §8 是建议性收口——幂等、不取消已在途的三段
  管线、不调 `session.close()`。设备中途说话/再次 `end` 不会打断已开始的上游请求；
  一轮管线跑完才 idle + close。真机触摸 barge-in 手感 deferred。
- **音频重采样为线性插值**：TTS 24 kHz mono → 16 kHz stereo 用两点线性插值 + 四舍五入
  + int16 clip（工具函数 `resample24kMonoTo16kStereo` 独立可测），非高质量多相/窗函数
  重采样；尾帧零填充到 3840 B。对语音频段足够，但不承诺音频保真度；高保真重采样
  deferred。立体声下混为 L/R 均值（单声道），不保留声像。
- **静默兜底定时器有取舍**：`stop()` 由 `end` 触发最准确，但设备只发音频不发 `end`
  会悬空，故加默认 3000 ms 静默定时器（每帧重置）兜底收口。若设备说话中停顿 >3 s，
  可能提前收口——v1 接受该风险；真机停顿分布未测。
- **错误映射按协议 §7 简化**：429/5xx/超时/网络错为 fatal（`upstream_error` /
  `upstream_closed`，关 1011），401 等 4xx 为非 fatal（适配器 `close(1000)`）；单段最多
  1 次重试（1 s）。无指数退避、无熔断、无跨轮状态；聚合网关的差异化错误码未逐一适配。
- **无真机 / 无出网 / 无真实 key**：全部证据来自 `node:http` 本地假 OpenAI 端点 +
  `cli.js --upstream openai` + device-sim 集成 smoke。真实 API key、真实端点地址不进
  git / docs 硬编码；真机 WiFi 稳定性、playStream 边收边播时延、双 DMA 并发全部
  deferred。可选 `OPENAI_CHAT_BASE_URL` 只覆盖 LLM 端点，未验证所有兼容网关的
  `/chat/completions` 差异。

## r114 — chat 段 SSE 流式化（真 delta；宿主假端点证据，无真机/无出网）

- **TTS 仍非流式（r116 已翻案）**：r114 时 `/audio/speech` 仍是整段回复一次性合成后
  按 3840 B 帧下行。r116 已兑现该项：chat delta 经状态机切句 → 串行单在途按句 TTS
  → 每段即刻重采样切帧下行，首句音频不再等待完整 LLM 回复 + 整段 TTS。
  **翻案依据**：`tests/gateway_upstream.js` r116 case 21-27（切句 / 首帧早于 chat
  收口 / 帧序 / 单句失败跳过 / 中断补播 / stop abort / chat 收口后 stop）+ 集成 smoke 实测
  first-audio-before-chat-SSE-end（详见 `docs/voice-gateway-protocol.md` §8.1.7）。
  真机时延预算仍 deferred。
- **SSE 中断按非 fatal、不重试**：SSE 响应头接受之后的断连 / 读错 / 超时统一封为
  `upstream_error` 非 fatal（与 401 同类，`close(1000)`），已发 delta 保留、追加
  一条带截断标记的 `final=true`。取舍理由：重试会重复已上屏 delta，弱网下更看重
  "不重复上屏 + 干净收口"而非把断流升级为致命错误。头之前的失败仍走 r113 映射
  （429/5xx/超时 fatal + 1 次重试，401 等 4xx 非 fatal）。
- **pseudo-delta 去留**：保留 `splitTextDeltas()` 为导出工具（旧 harness 的 helper
  断言继续成立、API 不破坏），但 r114 流式路径不调用它。当前**没有**非流式回退
  路径——非 `text/event-stream` 的 200 视为错误而非静默回退，理由：避免把兼容
  端点的降级掩盖成成功、也避免重复上屏。未来若引入显式非流式模式可复用该函数。
- **stop() 语义局部收紧（r116 进一步收紧，见下）**：r113 的 `stop()` 完全建议性；
  r114 仅在"管线已由静默定时器启动且 chat SSE 正在读"这一种情形复用
  `AbortController` 中止读流，当时 STT / TTS 在途仍不取消。r116 起 TTS 在途同样
  中止（已播段保留）。真机 barge-in（用户中途插话打断朗读）手感 deferred。
- **行格式边界**：解析器覆盖空行分事件、`data:` 拼接、`:comment`、`\r\n` 与
  半行分片；未覆盖多字节 UTF-8 被截在分片边界的高级场景（`TextDecoder` 流式
  解码已按字节缓冲，正常情况安全），兼容端点的非标准 keepalive 帧 deferred。
- **仍 open**：无真机 / 无出网 / 无真实 key；真机 WiFi、SSE 长连接稳定性、流式
  TTS、barge-in 全部 deferred；固件零改动。

## r115 — 设备 REPL（串口逐行 eval）

- **输出 cap = 2048 B + 截断标记**：`lume_repl_clamp()` 按字节截取并置 `trunc=1`，
  CLI 打印 `[output truncated]`。按字节截断可能把一个多字节 UTF-8 字符切成两半，
  解码端会显示替换字符 U+FFFD；不尝试回退到字符边界（避免为调试通道增加复杂度）。
  base64 以 240B 一块分 `R64` 行，沿用 SHOT 的成熟串口路径。
- **无多行续行 / 括号补全 / 历史 / 语法高亮**：每次只把一行当一个完整表达式
  `JS_Eval(..., JS_EVAL_TYPE_GLOBAL)`；跨行对象字面量、未闭合括号会直接报语法错。
  REPL 是调试基建加分项，不是完整 JS IDE。
- **单 REPL slot、last-wins**：引擎侧只有一个 staging slot，新请求覆盖未消费的旧
  请求，旧 token 收到 `ok=false / "superseded"` 回执；channel 侧 `REPL_SLOTS=8`
  有界表把 token 映射回 sink，表满时回 `repl-busy`。正常 CLI 串行请求不会触发。
- **PAUS 语义**：`PAUS` 只调用 app 的 `__lume_pause` hook，引擎 inner loop 不停，
  当前 app ctx 仍然存活，所以暂停态下 REPL 照常 eval（不会隐式 resume）。
- **app 切换过渡窗口**：`LUME_EVT_REPL` 在普通 inner loop 处理；若帧恰好落在 app
  切换的 crossfade/teardown 接管窗口，事件会被吞掉且无回执（CLI 超时），残留 slot
  在下一个 REPL 请求时回收。窗口很短且 REPL 是人工调试操作，接受此取舍。
- **鉴权不新增面**：USB 沿用串口信任模型；TCP 沿用既有 HMAC challenge-response
  + token，`LUMR` 帧只在 `AUTH OK` 之后进入同一 frame parser。REPL 能摸到 app 全局
  与 signals，等价于把串口调试权限视作设备本地信任。
- **端到端 deferred to board**：无真机；`tools/gateway/device-sim.js` 是 WebSocket
  gateway 模拟而非串口 REPL 设施，无可复用 REPL 收发设施。宿主证据为真实
  `lume_frame.c` 字节级 harness + CLI 解析 + 构建/size 数字，不宣称板级验证。
- **IRAM 仍在上限**：`IRAM 16384 / Remain 0` 与 r109 基线一致（未突破）；Flash Code
  2034220，较基线 2032588 +1632 B。

## r116 — 按句流式 TTS（chat delta 切句 → 串行单在途合成 → 边合成边播；宿主假端点证据，无真机/无出网）

- **无粘性连接 / 无跨句语调连续性**：每个完整句各自一次 `/audio/speech` POST
  （`Connection: close`），不复用 HTTP keep-alive；兼容端点限流风险靠"串行单在途"
  而非长连接压制。各句独立合成，句间韵律/音调不连续，可能有可听断句间隙；跨句
  连贯（单请求边收边播 PCM）需端点支持流式 speech 响应，deferred。
- **串行单在途**：同一时刻最多 1 个 `/audio/speech` 在途，句子队列 FIFO 消费。
  取舍：对兼容端点最友好、音频顺序天然保证；代价是多句总时长 = 各句 RTT 之和，
  未做并行预取。弱网下是否值得受限并发 deferred。
- **线性插值重采样不变**：沿用 r113 的 `resample24kMonoTo16kStereo`（两点线性插值
  + 四舍五入 + int16 clip，L=R 复制），只是从"整段一次"改为"按句多次"调用；
  尾帧零填充到 3840 B 的口径不变。高保真重采样仍 deferred。
- **句子边界是启发式**：`.!?。！？` + 闭合引号/括号容错 + 省略号/重复终止符合并；
  缩写点（如 "Dr."）、无空格中英文混排、多字节 UTF-8 被截在分片边界等高级语言
  现象未做 NLP 级处理；错切只影响 TTS 分句与上屏节奏，不丢文本、不改协议。
- **单句失败跳过、不重试整轮**：429/5xx/超时对单句允许 1 次重试（复用 `_withRetry`），
  仍失败则 log `openai.tts.skip` 并继续下一句；已播段保留。只有全部句子都失败才按
  既有 `_fail` 映射。取舍：优先"尽量出声"，不为单句失败让整轮从头重来；代价是
  用户可能听到缺句，真机容忍度 deferred。
- **stop() 在途 TTS 与 chat 读流同等待遇**：abort 当前 TTS 请求 + 当前 chat SSE 读，
  丢弃未开始句子，已播段保留，clean idle + close(1000)，无 error 帧；被中止请求
  不重试。真机 barge-in（中途插话打断朗读）手感 deferred。
- **chat SSE 中断音频补完**：已入队句子照常合成播完，final 带截断标记照旧（r114）；
  因此 error 帧出现在全部音频之后，而不是中断瞬间。
- **仍 open / 诚实口径**：无真机 / 无出网 / 无真实 key；全部证据来自本地假端点 +
  host harness + 真 `cli.js` + device-sim 集成 smoke。首字时延收益有宿主时间序证据，
  但不声称板级 playStream 实时性；固件零改动，**未跑 `idf.py build` / `idf.py size`**。

## r117 — 流式 ASR（上行帧到即转写；协议 v1.1 `transcript-delta`；宿主假端点证据，无真机/无出网）

- **上游转写协议是适配性假设**：本轮无真实 key / 不出网，转写 WS 的事件形状
  （`transcript.delta` / `input_audio_transcription.delta` / `transcript.done` /
  `input_audio_transcription.completed` / `{text,final:true}`）按 OpenAI Realtime
  转写风格**假设**实现，单点收口在 `tools/gateway/asr-stream.js`，可在接真实端点时
  一处替换。不声称已验证任何真实服务的流式转写契约。
- **默认关闭 + 双门协商**：`OPENAI_STREAM_ASR=1` + 非空 `OPENAI_ASR_WS_URL` +
  设备 `hello.caps.streamTranscript===true` 三者缺一即回退 r113 一次性 REST，
  不产生 `transcript-delta`。取舍：对存量设备/端点零回归，代价是默认拿不到流式收益；
  配置/协商任一遗漏会静默降级（有 `openai.asr.handshake` 日志可查）。
- **转写流中断选"回退 REST"而非升级错误码**：握手失败/流断/读错 → 记日志 →
  走 r113 REST，成功后发一条定稿（REST 全文**替换**中间转写），chat/TTS 不中断；
  REST 也失败仍先发一条定稿（可空）再按 §7 `_fail` 既有映射收口。取舍：优先整轮
  可用性、不引入新错误码/不重复定稿；代价是用户可能在中间转写后短暂看到文本被
  REST 全文替换（真机观感未测）。
- **定稿语义是"替换"不是"再拼一段"**：`final=true` 携带完整转写全文，恰好一条，
  先于 chat 首 delta；设备 app 用它覆盖中间转写缓冲。若上游中途无 final，
  `transcriptFinalTimeoutMs`（默认 1500 ms）超时用已累积 interim 兜底定稿，
  可能截断——取舍是宁可早定稿进 chat，也不让整轮悬挂。
- **设备端分时展示 + 有界 signal**：中间/定稿转写只写整数 `vaTxRev` 与单片
  `vaTxFinal` signal，片段入有界数组（≤24×128 字符），render 时才 join；
  LISTEN/THINK 显示 `YOU: <转写>`，SPEAK 显示助手 `text-delta`（无前缀），两路
  永不互相覆盖。取舍：SPEAK 阶段看不到"你说的"全文（分时而非同屏），规避
  typewriter OOM 教训；真机可读性 deferred。
- **旧设备忽略规则**：v1.1 是追加式扩展、线上 `v` 仍为 1；未声明 caps 的旧设备
  收到 `transcript-delta` 仅记日志忽略，不报错/不断连。device-sim `--legacy` 模拟
  该路径；未在真机旧固件上实测。
- **仍 open / 诚实口径**：无真机 / 无出网 / 无真实 key；全部证据来自本地假转写 WS
  + 假 chat SSE + 假 TTS + host harness + 真 `cli.js` + device-sim 集成 smoke
  （`artifacts/r117-smoke.log`）。首条转写早于 chat 的时间序有宿主直接证据，但不声称
  板级 ASR 时延 / 麦克风 barge-in 手感；固件零改动，**未跑 `idf.py build` / `idf.py size`**。

## r118 — 字母环猜词 Wordle 变体（纯 app 层；host harness + --no-emu 哨兵，无真机）

- **合法猜测简化为「任意 5 字母组合」**：答案从内嵌表随机抽，提交只做判定、不查猜测词典。取舍：绕开键盘缺口的同时不内嵌第二份大词典、不做词法校验；代价是乱敲的 5 字母也算一次尝试，没有「非词拒绝」提示。
- **无每日一题**：板子无 RTC 持久保证，答案用 `Math.random()` 抽取；不承诺同一天跨设备/重启一致，每日粘性叙事不成立。
- **环形交互手感 pending board**：tap 左弧/右弧旋转、tap 环心确认，纯 tap 单手设计（无键盘、无 swipe 依赖）。26 个小字形环在 480x430 上字高仅 7px，靠环心大号选中字母补偿可读性；命中半径、连续旋转速度、帧率、误触率全部待接板验收。harness 只验证 host 手势管线与绘制流（含 ~60s smoke），不代表真机手感。
- **词表是近似而非权威词库**：743 个纯 ASCII 小写 5 字母常用词，不是任何商标词库；原创判定文案与配色，不复刻商标 UI / 素材。
- **KV 记录语义有限**：`wr.streak`（连胜，失败清零）与 `wr.best`（最少尝试，严格更少才覆盖）两个 <=15 字符 NVS key；无历史战绩榜、无跨局答案记录。
- **仍 open / 诚实口径**：无真机；主仓与 worktree 均无 build 三件套，且本轮零固件改动按纪律不跑 `idf.py build` / `idf.py size`；全部证据来自 host harness（真 prelude 手势/绘制流）与 `--no-emu` 哨兵。真机视觉、触摸、性能 deferred to board。

## r119 — 语音网关设备 token 门（共享 token 非 HMAC；宿主/假端点证据，无真机/无出网）

- **共享 token 而非逐设备身份 / HMAC 挑战-响应**：一把 token 供所有设备共用，
  无法撤销单台、无法防已持 token 的客户端重放。`lume.crypto.hmacSha256`（r91）
  虽可用，但 `ws://` 明文信道上 HMAC 只防重放、不防窃听，增益有限、复杂度不值，
  本轮取共享 token 相等比较（`timingSafeEqual` 等长常数时间）。取舍：挡住"连上
  WS 端口就能烧真实 API 配额"的任意进程；代价是 token 一旦泄露即全网通用。
- **LAN 信任模型边界**：token 门把"同网段任意进程可信"收窄为"知道 token 的客户端
  可信"，**不等于网络隔离**，不替代 VLAN / 防火墙 / 端口 ACL。真正逐设备身份、
  可撤销凭据与 TLS 留部署轮。
- **`ws://` 明文传输 token**：无 TLS，token 随 hello JSON 明文过 LAN，被动抓包即可
  复制。已登记为已知取舍；不声称抗抓包/抗重放。错误 message 与所有日志均不含
  token 值（网关只记 `deviceAuth=on|off`，app 只记 `VA WS HELLO AUTH`）。
- **开放模式默认**：网关未配置 token 时完全跳过校验，行为与 r118 逐字节一致。
  取舍：存量 LAN 部署零回归；代价是默认仍无设备鉴权，需显式配置才锁死。
- **校验顺序固定**：`not_hello` → `unsupported_version` → `unauthorized` → 建上游。
  "先发音频帧再 hello" 在锁定模式仍优先 `not_hello`，顺序语义不回归；拒绝时
  不回 hello-ack、不创建上游适配器、不发任何上游请求（宿主 harness 直接断言
  工厂零调用，集成 smoke 断言假上游 HTTP 请求数为 0）。
- **仍 open / 诚实口径**：无真机 / 无出网 / 无真实 key；证据来自 host harness
  （`tests/gateway.js` 16 case、`tests/va_ws.js` 9 case）、真 `cli.js` + 本地假
  上游 + device-sim 两路 smoke（`artifacts/r119-smoke.log`）。固件与 runtime
  零改动，按纪律不跑 `idf.py build` / `idf.py size`。

## r120 — 语音网关多轮记忆与可配置人设（宿主/假端点证据，无真机/无出网）

- **滑动窗口而非摘要压缩**：历史按最近 N 条（默认 12）与 8KB 字符预算截断，
  淘汰最旧 user+assistant 对；不做 token 计数、摘要压缩或相关性检索。取舍：
  实现简单、内存有上界；代价是长对话早期事实被无声丢弃，模型无法 recall N 轮
  之前的内容。
- **无跨会话持久化**：历史只存进程内存、按 sessionId 隔离，`session.close`
  （任意 code）即清空；新连接 = 新对话。取舍：满足会话隔离与"不跨连接泄漏"；
  代价是进程重启 / 设备重连即遗忘，无 KV / 磁盘落盘、无跨设备同步。
- **token 与 system 全文不落盘 / 不入历史**：历史只存 user/assistant 文本，
  不存 API key、设备 token 或 system 全文；日志与 error message 只记
  `systemPrompt=custom|default`。取舍：避免敏感配置被日志或后续请求回显；
  代价是诊断人设问题只能靠本地配置核对。
- **会话保活是可选开关**：协议默认在每轮 `state=idle` 后 `close(1000, done)`；
  多轮记忆只在 `--multiturn` / `GATEWAY_MULTITURN=1` 下才在同一连接复用会话。
  取舍：默认零回归 + 设备帧格式零变化；代价是未开启时历史虽写入，但下一轮新
  连接读不到，多轮能力需显式启用。
- **limit 的字符口径是粗算**：N 计 user+assistant 条数（system 之外）；字符预算
  按 JS 字符串长度（UTF-16 code unit）估算，不引入 tokenizer；单条消息超预算时
  整对丢弃。取舍：零新依赖；代价是中文等字符的"字符数"与真实 token 数不等，
  预算只是内存上界而非精确上下文窗口控制。
- **仍 open / 诚实口径**：无真机 / 无出网 / 无真实 key；证据来自宿主 harness
  （`tests/gateway.js` 19 case、`tests/gateway_upstream.js` 36 case、
  `tests/va_ws.js` 9 case）、真 `cli.js` + 本地假上游 + device-sim `--turns 2`
  两轮连续对话 smoke（`artifacts/r120-smoke.log`）。固件与 runtime 零改动，
  按纪律不跑 `idf.py build` / `idf.py size`。

## r121 — voice_assistant 设备侧多轮记忆适配（纯 app + Node 层，无真机/无出网）

- **app 不本地存历史，只靠网关窗口**：设备侧不缓存 user/assistant 文本，也不按帧
  重建上下文；历史完全依赖 r120 网关会话的有界窗口（N=12 / 8KB 字符预算）。轮间
  UI 的 `PREV` 只显示上一轮 app 自己已上屏的回复，不参与下一次 chat 请求。取舍：
  设备内存零增长、协议帧零变化；代价是网关重启 / 连接一断历史即失，app 无离线记忆。
- **多轮是连接复用，不是新帧型**：设备开启后 `state=idle` 时 park WS，下一轮原连接
  直接上行 PCM + `end`，不重发 hello。实证两轮仅 1 次 hello / 1 次 ack / 同一 sessionId，
  §8.1.10 逐帧记录。取舍：零协议破坏、默认关闭逐字节等价 r119；代价是设备与网关
  必须**两侧都开**（`voice_gateway_multiturn` KV + `--multiturn`），单边开等于每轮新连接、
  历史读不到。
- **连接生命周期由 app 手动维护**：`onClose` / 致命 `error` / `onError` / barge-in
  都清掉 park 迫使下一轮全新连接并重新发带 KV token 的 hello。取舍：token 门在重连后
  照常拦截（r121 case 12 断言零上游工厂调用），不引入会话恢复/续传；代价是从 SPEAK
  中途 barge-in 后会丢掉本会话已积累的历史（重连即新对话），未做「先 commit 再断连」。
- **上下文 UI 是展示性、非权威**：`TURN n` 统计本 app 完成轮次，`PREV` 截断到 16 字符，
  只求如实提示「记忆开且已积累几轮」，不是网关历史的镜像（网关超窗淘汰后 UI 不回退）。
  取舍：信号驱动、零新控件复杂度；代价是计数与网关实际窗口条数可能不一致。
- **仍 open / 诚实口径**：无真机 / 无出网 / 无真实 key；证据来自宿主 harness
  （`tests/va_ws.js` 12 case = 9 基线 + 3 r121，`tests/gateway.js` 19，
  `tests/gateway_upstream.js` 36）、`npm test --prefix tools/lume` 50 tests、
  `check_website.py` 无缺失、真 `cli.js --upstream openai` + 本地假 STT/chat/TTS +
  真 `device-sim --turns 2` 两轮 smoke（`artifacts/r121-smoke.log`，第二轮 chat 请求体含
  第一轮 user+assistant 且两轮仅 1 次 hello）。真机时延 / barge-in 手感 / 双 DMA deferred。
  固件与 runtime 零改动，按纪律不跑 `idf.py build` / `idf.py size`。

## r122 — voice_assistant 断连不丢历史（hello.resume 可选字段；无真机/无出网）

- **只解决单次断连，不做进程级持久化**：退休历史存网关进程内存 `resumeStore`
  （默认 TTL 5 分钟 / 上限 64 条，最旧先淘汰），**网关重启 / 进程退出即全丢**，不落
  NVS / LittleFS / 文件。取舍：零新 I/O 与文件系统依赖、协议零新帧型；代价是无跨进程
  恢复、无跨设备同步。被否方案 A（网关文件持久化）否因：仍须在 hello 携带恢复标识，
  并未减少协议增量，反而新增磁盘路径 / 键控 / 锁与陈旧文件问题。
- **被否方案 B（设备 KV 缓存回放）否因**：设备要把 user/assistant 文本存 KV 并用新控制
  帧回放，破坏「协议帧零变化 / 只加可选字段」口径；8 KB 预算与 NVS 空间也与之冲突。
  最终选 C（网关 sessionId 重绑定）：协议仅加 `hello.resume` 一个可选字段，设备侧只多
  存一个 sessionId 字符串。拍板前实证：§3「未知字段 MUST 被忽略」、§9「v1 冻结、只
  追加」、r119 `auth` 追加先例、网关 hello 解析无白名单拒绝未知字段。
- **恢复键是可预测的 sessionId**：值形如 `sN` 且递增，同一共享 token 下的授权客户端
  可猜到邻近 id 并尝试恢复。与 r119 §8.2.3 一致：这是单一共享 token 的 LAN 信任模型，
  不是逐设备身份、不替代网络隔离；恢复仍须通过 token 门，错 token 零恢复。取舍：复用
  既有 sessionId、零新随机标识字段；代价是不防同 LAN 内已授权客户端的猜测重绑定。
- **一次性消费 + TTL**：命中后快照从 store 删除，连续两次带同一 `resume` 的第二次会
  降级为新对话；空闲超过 TTL 也丢弃。取舍：避免陈旧 id 被无限重放；代价是设备若迟迟
  不重连（>5 分钟）仍会丢历史，不做无界保留。
- **只保留已完成的轮**：barge-in / 致命错误中断的当前轮不写历史（r120 既有语义），
  所以恢复的是中断前已收口的轮次；设备 UI 的 `TURN n` 计数与网关实际窗口条数仍可能
  不一致（r121 取舍延续）。
- **非多轮逐字节等价**：`voice_gateway_multiturn` 关闭时设备不发 `resume`，hello 与
  r121 逐字节一致；网关不配 `resume` 也能与旧设备互通。代价是恢复能力必须显式在设备
  侧开启，默认单轮场景仍是新对话。
- **仍 open / 诚实口径**：无真机 / 无出网 / 无真实 key；证据来自宿主 harness
  （`tests/gateway.js` 23 case = 19 基线 + 4 r122，`tests/gateway_upstream.js` 37 =
  36 + 1，`tests/va_ws.js` 13 = 12 + 1）、`npm test --prefix tools/lume`、
  `check_website.py`、真 `cli.js --upstream openai` + 本地假 STT/chat/TTS + 真
  `device-sim --turns 2 --drop-after 1` 强断一次 WS 的续传 smoke
  （`artifacts/r122-smoke.log`，第二轮 chat 请求体含第一轮 user+assistant）。真机时延 /
  barge-in 手感 / 双 DMA deferred。固件与 runtime 零改动，按纪律不跑 `idf.py build` /
  `idf.py size`。

## r123 — 体感挥杆迷你高尔夫 `examples/minigolf`（纯 app 层；无真机）

- **物理简化**：2D 球道用 Coulomb 常量摩擦（`FRICTION_DECEL = 150 px/s²`）+ 每关常向量坡度 +
  壁/环 `RESTITUTION = 0.6` 回弹，取代真实滚动/滚动摩擦/坡面能量守恒。Coulomb 模型保证球
  在有限时间停稳（黏性摩擦 + 常坡度会让球永远达不到静止阈值）；代价是速度-距离关系是
  二次而非指数，果岭手感靠 `FRICTION_DECEL` / `SHOT_MIN` / `SHOT_MAX` 手调。洞以
  `dist <= 16 px 且 speed <= 140 px/s` 判定，快球 lip-out 越洞——不做真实杯沿动力学。
- **挥杆检测是幅值阈值而非手势识别**：取 `hypot(ax, ay)` 超 6 m/s² 为候选、窗口内峰值定
  力度、峰值回落 160 ms 结算、240 ms 冷却。不识别挥杆轨迹形状，也不做重力方向补偿；
  手册假设手表近水平持握（静止时水平幅值近零）。`SIGN_X = -1` 沿用 gravity_ball 本板
  实测的轴向反转；`SIGN_Y = 1` 未在板上核对。真机持握姿态、阈值舒适度、方向直觉全部
  deferred to board，不声称真机验证。
- **demo 触摸交互**：拖拽定方向/力度 + `HIT` 按钮提交，分两步而非拖拽释放即击球。
  这是为规避 prelude 挂在节点 0 的全局 swipe-up 回家手势与向上拖拽释放抢同一 UP 事件
  （`lume_scripts.c:1365-1372`）；代价是 demo 击球多一次按键。compass 双模式自动降级
  先例保留：无 IMU 样本时 `MODE -> IMU` 回落 demo 并记日志。
- **渲染取舍**：单个 480×480 canvas = 230,400 px 恰满预算，球道/障碍/洞/沙坑边框为静态层，
  每关一条 `retainSegments`（6 条 ≤ 8 上限，最坏 78 段 ≤ 240），每帧 `drawPath` 从 C 回放；
  球/瞄准线/洞心走 `snapBox(union(old,new))` 脏区重画，首次整块画布。障碍取 outline-only
  环（无填充），以便脏区用球道底色擦除后回放轮廓即可精确复原；不做障碍阴影或洞深。
- **关卡可解性口径**：6 关由关号确定性生成（四张参数表），par 全为 1。harness 用 72 方向
  × 14 力度的确定性网格搜索证明每关一杆可进洞（sokoban BFS 纪律的数据断言同款），
  不是真机试打；搜索只覆盖离散角度/力度，不能证明连续控制空间里的最优性。
- **hiscore 语义**：`hisc.golf`（9 字符，NVS 上限 15，实证 `lume_kv.c:42`）存**全场通关总
  杆数**的最少值，不是逐关纪录；未通关时 HUD 显示 `BEST 0`。KV 失败时本局仍可玩，纪录
  仅本进程有效。
- **仍 open / 诚实口径**：证据来自 12-case host harness（含 6 关可解性搜索、IMU 降级/弱挥杆
  负向、脏区预算）、全量宿主回归 0 FAIL、`npm test --prefix tools/lume` 49/50 pass（1 skip）、
  `check_website.py` missing/invented/duplicates 均 none、两个 `--no-emu` 哨兵 PASS，以及
  esp32sim 真固件 emu：启动 eval ok、无 crash 日志、独立 /tmp 脚本注入触摸
  `touch 240 380 1 / ... / touch 240 288 0` + `HIT` 后串口实证 `GOLF SHOT L1 strokes=1
  speed=268` → `GOLF HOLE L1 strokes=1`。真机挥杆手感、触摸力度、帧率、掉电持久性 deferred。
  固件/runtime 源码零改动；emu 镜像为本地编译产物，未据此声称固件改动或真机验收。

## r124 — voice_assistant 真 push-to-talk（纯 app 层；零固件 / 零协议帧改动，无真机）

把 GATEWAY 模式录音触发从 tap-to-talk 定窗改成真按住说话。状态机
`IDLE→LISTEN→THINK→SPEAK` 迁移表不变，只改进出 LISTEN 的触发与时长。

- **触发与窗口**：`panstart` 起 `recordStream`（复用 `chunkSamples=1024` → 3840 B
  carry 重组），`panend` 才停流并发 `end` 帧。`VA_PTT_MIN_MS=400`（<400 ms 误触：
  停流但**不发 end**、直接回 IDLE）、`VA_PTT_MAX_MS=15000`（15 s 看门狗强制收窗，
  防手滑长按烧流量/内存）。按住期间卡片显示 ASCII 提示 `HOLDING - RELEASE TO SEND`，
  平时 `HOLD & DRAG TO TALK - RELEASE TO SEND`。DEMO/LIVE 保留 tap 流程与 canned
  应答，`vaDetectMode()` 分叉未改；`tests/voice_assistant.js` 有 demo 模式回归用例。
- **panend 与全局 swipe-up 不冲突（实证，否决按钮兜底）**：读码 `lume_scripts.c`
  `__gestureStep`（DOWN/MOVE/UP → tap/swipe/longpress/panstart/pan/panend 纯状态机）
  与 `lume_ui_bridge.c` `gesture_obj_cb` 证实：全局上滑回家手势挂在**节点 0**、有独立
  手势状态（`__gestureStates[0]`），且只在按下点落入底部边缘区（`y>=480-60`）才 arm，
  只过滤 `dir==='up'`；app 的 pan 处理器在 vaRoot（节点 1）/canvas，状态互相独立，
  **不共享、不吞事件**。UP 时 `__gestureStep` 先 push `panend` 再 push `swipe`，所以
  即便上滑也会先送 end 帧。host harness 双重实证（drivers 在节点 1 注入完整
  DOWN/MOVE/UP）：向下/斜向 40 px 拖拽 → `panstart,pan,pan,panend`（无 swipe，干净提交）；
  向上 60 px 快拖 → `panstart,pan,pan,panend,swipe:up`（panend 仍在 swipe 之前）。
  因此**不需要** r123 minigolf 那种「拖拽定方向 + HIT 按钮二次确认」兜底；用户只需
  向下/斜向轻拖即可干净松手提交（向上滑虽也能送 end，但同时触发回家，属已知边界）。
- **协议零变化**：`end` 仍是 `{"v":1,"type":"end"}`，只补充“设备侧在松手时刻触发”的
  口径（协议 §4.6），不新增字段。多轮复用 / resume 语义不变：按住—松手—再按住的
  第二轮仍复用同一 WS、不重发 hello（`VA WS REUSE turn=2`）；r122 resume 不受影响。
- **保留的取舍 / 仍 open**：① legacy GATEWAY tap 路径仍保留 `VA_STREAM_FRAMES=3`
  定窗，仅为让 r108-r122 的 `va_ws.js` 13-case harness 不经改动继续通过；PTT 路径
  由 `vaPTTActive` 在 `vaWSPump` 中屏蔽该定窗。② <400 ms 误触只停流、不发 end，
  网关侧本轮会话可能等待到超时（非多轮模式）或被下一轮复用（多轮模式）——这是
  「不发 end」口径的直接代价，未额外发 abort/close 帧（协议零变化优先）。③ panstart
  要求手指移动 >12 px（`GESTURE.panMinPx`），静止按住不会产生 panstart；交互上按
  README 指引轻拖触发，未在固件/runtime 做任何手势阈值改动。
- **验证 / 诚实口径**：`node tests/voice_assistant.js` 18 case 全绿（新增 panstart→panend
  开窗、最短窗丢弃、看门狗上限、swipe-up 不吞 panend、双按住无第二 hello、demo 回归），
  全量 `for t in tests/*.js` 0 FAIL、`npm test --prefix tools/lume` 不回归、`check_website.py`
  missing/invented/duplicates 均 none、两个 `--no-emu` 哨兵 PASS、playground 生成物随提交。
  **真机按住手感 / 时延 / 双 DMA 并发 deferred to board，未声称真机验证。固件 / runtime
  源码零改动**（实证过程未触及需改固件的边界，故未构建 / 未贴 size）。

## r126 — image_gallery 的 Sd-first 读图（纯 app 层；零固件 / 零 runtime，无真机插卡）

- **Sd→Fs 逐图降级语义**：`Sd.mounted() !== true` 时三张图全部走原 `Fs.readBinary`
  （即 r125 之前的行为不变）；卡已挂载但某张读回 -2/-3 或抛错时，仅该张回退 Fs；
  Fs 也读不到则该张不出 tile。内嵌 1×1 红 PNG 的 head tile 始终存在，因此即使三张
  卡图与 Fs 图全丢，eval 仍产出一个 tile。每张图各自 try/catch，外层 main() 仍留兜底
  catch，单张失败不拖垮整个 eval。
- **HUD 换算取整口径**：`Sd.statvfs()` 成功返回 `{total,free}` 字节，按 1 MiB=1048576 B
  `Math.floor` 截断成整数 MB，不四舍五入、不显示小数；返回 number（-2 IO / -3 无卡等）
  显示 `NO CARD`；Sd API 缺失或 statvfs 抛错时该 HUD 行不渲染（防御，理论不会发生）。
  容量口径是卡文件系统的总/剩余字节，未做簇对齐之外的额外修正。
- **真机插卡验收 deferred**：宿主 harness 只做源码静态断言，主机无卡；SPI 挂载、真实
  `/gallery/*` 文件、读速、容量与掉电持久性均未在板上验证，不声称真机验证。
- **playground 清单实证纠偏**：简报称 image_gallery 在 43-app 列表内，实证
  `tools/playground/build.mjs` 的 43 项不含它、`website/playground/` 无其产物。本轮未改
  build.mjs（守纯 app 层 / 范围控制），故 playground 重建无 image_gallery 生成物；若需
  该 app 的 playground 版本，须另刀把 id 加入清单并重建。
- **验证 / 诚实口径**：`tests/sd_gallery.js` 6 PASS 且关键断言变异实测非空；全量宿主回归
  0 FAIL；`npm test --prefix tools/lume` 50/0 不回归；`check_website.py` missing/invented/
  duplicates 均 none；两个 `--no-emu` 哨兵 PASS；playground 43 bundles PASS；
  `git diff 5be09c3 -- firmware/ runtime/` 为空故未跑 `idf.py build`。固件 / runtime 源码零改动。

## r127 — examples/files 的 Sd 浏览（app + 工具清单；零固件 / 零 runtime，无真机插卡）

- **SD 导航模式选择理由（实证后定案）**：选「Fs 根追加 `SD/` 虚拟入口 → 点入切独立 `onSd`
  模式（cwd 重置 `/`）」，不把 Sd 路径混进原 cwd。实证：`examples/files/app.js` 的
  `isDirPath`/`loadDir`/`removeTree`/`previewSelected`/`onBack` 全部把 `cwd` 当作「当前后端内
  路径」前缀，而 Fs 与 Sd 的根都写作 `/`；共用 cwd 就得给每个路径附后端标签，侵入面覆盖
  所有操作。虚拟入口仅 `!onSd() && sdReady && clean === '/'` 时出现，以 `e.sd` 标记；SD 根
  `goUp`/BACK 退回 Fs 根而非回桌面。未挂卡时零行为变化。
- **删除语义取舍（实证纠偏）**：任务简报担心 Sd 删除「目录递归语义不明确」，但读码
  `firmware/components/lume-storage/lume_sd.c` 实证：`lume_sd_exists` 与 Fs 一样用
  `exists(path + '/')` + `S_ISDIR` 判目录（:228-242）；`lume_sd_remove` 与 Fs 一样
  unlink 失败后 rmdir 兜底（:195-199）；`lume_sd_list` 的 `full_path(...,true)` 归一化尾斜杠
  （:39-63）。因此递归在 JS 侧 `removeTree` 完成（先删子项再删目录），Sd 侧删除语义明确，
  **启用** SD 模式删除并复用唯一 `askDelete` Dialog，没有第二份删除流程；仅 `SD/` 虚拟入口
  禁删并 ASCII 提示 `Cannot delete SD entry`。代价：真机未插卡验证前，SD 侧删除只在源码
  静态断言层面核对了分发与降级（无行为级探针，deferred），不对真实卡数据做承诺。
- **SD->Fs 同路径回落（兼容性兜底）**：SD 模式每步调用（exists/list/read/remove/mkdir）
  失败（负数错误码 -1/-2/-3/-4 或 native 抛错）时该步回落 Fs 同路径，仍失败才按原失败
  路径处理，保持每步独立 try/catch；卡拔出 / 路径不存在时表现与无卡一致，不把两种后端
  混成一个命名空间。代价：Fs 同路径若恰好有同名项，会成为兜底目标——可接受的兼容取舍。
- **容量取整口径**：`Sd.statvfs()` 成功返回 `{total,free}` 字节，取 `free` 按 1 MiB=1048576 B
  `Math.floor` 截断成整数 MB，不四舍五入、不显示小数；返回 number（-2 IO / -3 无卡等）或
  抛错显示 `NO CARD`；无 Sd API 时该状态不走（被 `sdReady` 门控）。与 r126 image_gallery
  HUD 口径一致。
- **playground 清单变动**：`tools/playground/build.mjs` 的 43-app 清单追加 `image_gallery`
  （r126 遗留尾巴）与 `files`（本轮 Sd 化）。实证两者 esbuild 兼容：`image_gallery` 无
  import，`files` 的 `import '../../runtime/shell.js'` 是副作用导入且 shell.js 为无导出 IIFE，
  esbuild iife bundle 正常。重建为 45 bundles + 45 sources，生成物随 tooling commit 提交。
- **真机插卡验收 deferred**：宿主 harness 只做源码静态断言 + 变异实证，没有跑行为级探针
  （无 stub Sd 的 Node vm 运行探针，行为级探针 deferred）；主机无卡。SPI 挂载、真实卡上
  目录列举/文本读取/删除/掉电持久性、`statvfs` 真实容量、BACK 手势在卡根目录的手感均未
  在板上验证，不声称真机验证。
- **验证 / 诚实口径**：`tests/sd_files.js` 25 source/non-source PASS + 16 变异实证 PASS
  （变异实证抓出并修掉 harness 自身两处假断言：NO CARD 只替换首处、manifest 断言未参数化）；
  `tests/sd_gallery.js` 不回归；全量宿主回归 0 FAIL；`npm test --prefix tools/lume` 50/0 不回归；
  `check_website.py` missing/invented/duplicates 均 none；三个 `--no-emu` 哨兵 PASS；
  playground 45 bundles PASS；`git diff 67b635f -- firmware/ runtime/` 为空故未跑 `idf.py build`。
  固件 / runtime 源码零改动。

## r128 — SNTP 时间同步 / `lume.system.time()`（固件刀，未接板）

- **时间单位 = unix 毫秒**：`time()` 用 `gettimeofday()` 取秒+微秒后拼成毫秒，
  `JS_NewInt64` 在 int32 外退化为 float64；当前纪元毫秒约 1.7e12，远小于 2^53，
  浮点表示仍精确，且与 `Date.now()` 同单位。未同步时返回的是从 1970 起算的**真实**
  小值（不伪造一个看似合理的年份）；调用方应把过小的值当作「时钟尚未校准」。
- **默认 server 选择 `pool.ntp.org`**：通用、DNS 多 IP、无单点；注释与 d.ts 明确提示
  CN 网络可显式传 `ntp.aliyun.com`。`CONFIG_LWIP_SNTP_MAX_SERVERS=1` 只留一个槽位以
  压缩体积；需要多 server 时须改 sdkconfig 并重新走固件验收（本轮未做）。
- **同步阻塞口径**：`setTimeNtp()` 通过 `esp_netif_sntp_sync_wait()` 同步等待，最长
  持有引擎任务 `timeoutMs`（默认 10 s、上限 30 s），期间 touch、热更新与 UI 刷新全部
  停顿——与 `lume.net.httpGet` 同款取舍。异步/callback 版本未做。负 timeout 抛
  `RangeError`、非字符串 server 抛 `TypeError`；0 回落到 10 s 默认。返回码 -1 非法
  server、-2 SNTP init/传输/超时、-3 WiFi 无可用 IPv4（`lume_net_has_ip()` 门控）。
- **幂等与时钟持久化**：每次调用先 `esp_netif_sntp_deinit()`（未初始化时空操作）再
  `init()`，返回前再次 `deinit()`，因此重复调用只是重新对时；`settimeofday()` 由 lwip
  SNTP 在收到同步包时完成，`deinit` 不会回退已设的时钟。`CONFIG_LWIP_SNTP_STARTUP_DELAY`
  保持 IDF 默认（首次请求随机延迟 <=5 s），慢网下 10 s 默认可能偏紧，可显式加大到
  30 s 上限；真机延迟分布未实测。
- **真机 SNTP 实测 deferred**：宿主 harness 只做静态契约/注册/错误码/阻塞注释断言 +
  变异实证，主机无电台、无 NTP 包。DNS 解析、SNTP 往返、`settimeofday()` 后
  `Date.now()` 是否真的跳到正确年份、TLS 证书校验能否因此从 `httpsInsecure` 切回
  安全模式、功耗/启动延迟，全部留接板轮；本轮验收口径 = 编译绿 + IRAM Remain 0 +
  harness + 契约自洽，**不声称真机验证**。
- **轮次哨兵适配**：r126/r127 的 sd_gallery/sd_files harness 含「firmware/ 与 runtime/
  相对旧基线零 diff」的 app-only 轮次哨兵。r128 是固件刀，该不变量按设计失效；
  两个 harness 改为「相对 r127 基线 040fc11，firmware/ 与 runtime/ 仅允许 r128 已知
  文件变更」的 allowlist，保留防误改作用，未删断言。worktree 缺 gitignore 的
  `tools/lume/bin/qjsc`，从主仓复制该测试工具使 `npm test` 回到 50/0/0，源码零改动。
- **验证 / 诚实口径**：`tests/sntp.js` 24 PASS + 9 变异实证 PASS；全量宿主回归 0 FAIL；
  `npm test --prefix tools/lume` 50/0/0；`check_website.py` missing/invented/duplicates 均
  none；`lume check examples/counter --no-emu` `RESULT: PASS`；playground 47 行 PASS；
  `idf.py build` + `idf.py size` 绿，`BUILD_EXIT=0`，Flash Code 2041168、IRAM
  16384/16384 Remain 0（硬线达标）、DIRAM 247491 (72.42%)。未跑 codex review。

## r129 — SNTP 消费方刀取舍（app-only，基线 b5ca082）

- **无真机 SNTP 往返验收**：本轮只改 app JS，SNTP 断言全为宿主静态契约 + 变异
  实证。DNS 解析、SNTP 往返、`settimeofday()` 后 `Date.now()` 是否真跳到正确年份、
  功耗/启动延迟全部留接板轮；**不声称真机验证**。
- **clock SNTP-first 的阻塞窗口**：`setTimeNtp()` 默认 10 s 上限、同步持有引擎
  任务（同 httpGet），期间 touch/热更新/UI 刷新停顿。clock 每 10 min 重同步一次，
  最坏一次同步可阻塞最长 10 s 的 tick；接板后若卡顿可调 timeoutMs 或改异步
  （本轮未做）。HTTP 回落路径每源最多 4 s，维持 r128 口径。
- **offset=0 恒等的锚点改写**：设备 `lume._nowMs()` 是单调 uptime 而非墙钟，
  `wallDate()` 改读 `Date.now() + epochOffsetMs`，HTTP 路径的 offset 锚点同步改为
  `Date.now()`（同步前两者同为 1970 起小值、速率一致，观测等价），`nextSyncMs`
  仍用 `_nowMs()` 保持节拍。宿主桩 `_nowMs() === Date.now()`，行为与现状一致。
- **settings 节点预算口径**：General 页新增恰好 3 节点（1 View + 1 Text + 1
  Button），静态树约 95 → 98/128 slots，两个虚拟 List 的可见行不增加；harness
  以「同步行工厂调用数 === 3」断言，第 4 节点变异必须 FAIL。
- **playground 清单口径纠偏**：brief 假设 settings 在 45-app 清单内，实证为假
  （`tools/playground/build.mjs` 的 `apps` 数组无 settings）。本轮不扩清单，避免
  45→46 文档口径漂移与 tooling 越界；settings 的 app 层改动由 `lume check
  examples/settings --no-emu` 与宿主 runApp 覆盖，playground 重建只刷新 clock 生成物。
- **验证 / 诚实口径**：`tests/sntp_consumers.js` 17 PASS + 17 变异实证 PASS；
  全量宿主回归 0 FAIL；`npm test` 50/0/0；`check_website.py` 三项均 none；
  `lume check` clock/settings/counter --no-emu 均 `RESULT: PASS`；playground 47 行
  PASS（45 bundles + 2 summary）。`git diff b5ca082 HEAD -- firmware/ runtime/`
  为空，固件零改动故未跑 `idf.py build`。未跑 codex review。

## r130 — SNTP 第二波消费方刀取舍（app-only，基线 ffdd757）

- **无真机 SNTP 往返验收**：本轮只改 app JS，SNTP 断言全为宿主静态契约 + 变异实证。
  DNS 解析、SNTP 往返、`settimeofday()` 后 `Date.now()` 是否真跳到正确年份、功耗 /
  启动延迟全部留接板轮；**不声称真机验证**。
- **失败态显示口径（不伪造时间）**：GOT_IP 且 `setTimeNtp()` 返回 0 才把 `new Date()`
  视为有效墙钟并清空状态；-1/-2/-3/抛错/API 缺失/无 WiFi 一律照实显示 1970 起设备
  时间（`new Date()` 原样读，无 offset 补偿、无假 epoch），仅以角落 ASCII 状态提示
  `SYNCING` / `NO WIFI` / `NO SYNC`。demo 语义（无 WiFi 下时钟照旧跳动）保持现状。
- **状态文案落位**：`clock_round` 用左上角 1 行 Text（不打扰表盘）；`aurora_clock`
  复用既有 `AURORA` HUD 文案位（同步时仍显示 AURORA，未同步显示状态，不新增节点）；
  `watchface` 在共享根加 1 个原生 Text（最后子节点覆盖 5 页，空串即已同步）。三处
  文案全 ASCII（r64），`sync` 块内字符串字面量由 harness 断言；watchface 既有中文
  文案不在新增范围内，故 ASCII 断言按 block 收窄而非全文件。
- **watchface 预算约束**：canvas 像素预算已满（228,544/230,400，harness 硬断言
  4 canvas），新状态只走原生 Text，不加 canvas、不扩尺寸、不改 5 页滑动与天气/
  电量/目标 complication。
- **同步节拍与阻塞**：`setTimeNtp()` 默认 10 s 上限且阻塞引擎任务（同 httpGet）；
  三 app 均按 `_nowMs()` 门控，成功 10 min 后重同步、失败 30 s 重试，避免 aurora
  50 ms 帧循环每帧调用。宿主桩 `net.status()` 为 DISCONNECTED，故宿主不触发同步。
  -1（非法 server）在本轮三 app 的调用参数下不可达（均默认 server），归入非空即
  失败态分支。
- **世界表盘缺位**：`examples/worldclock` 不存在且不在 45-app playground 清单内；
  harness 断言清单不含它、无目录，不虚报为第四个消费方。本轮实际迁移三个 app。
- **验证 / 诚实口径**：`tests/sntp_consumers2.js` 18 PASS + 18 变异实证 PASS；全量
  73 宿主 harness 0 FAIL；`npm test` 50/0/0（补齐 gitignore 的 `bin/qjsc`）；
  `check_website.py` 三项 none；`lume check` 三 app `--no-emu` + counter 完整 emu
  均 `RESULT: PASS`；playground 47 行 PASS。worktree 缺 `firmware/build/lume.bin`，
  哨兵 emu 复用主仓 ffdd757 基线固件镜像（固件零改动故等价），未跑 `idf.py build`；
  `git diff ffdd757 HEAD -- firmware/ runtime/ tools/` 为空。未跑 codex review。

## r131 — weather SNTP-first 取舍（app-only，基线 1dc7c76）

- **无真机 SNTP + TLS 全链路验收**：本轮只改 `examples/weather/app.js`，SNTP 断言全为宿主
  源码静态契约 + 变异实证。DNS、SNTP 往返、`settimeofday()` 后证书校验是否真通过、
  冷启动首刷成功率和功耗全部留接板轮；**不声称真机验证**。
- **墙钟未设置的判定阈值**：`lume.system.time()` 早于 `2026-01-01T00:00:00Z`
  （`1767225600000` ms）即视为未设置并先校时。这是一个保守的下界——固件 1 月 1 日之后
  的真实 RTC 不会被误判；若设备时钟被设到 2026 年之前的有效日期，会触发一次多余校时，
  但校时成功即纠正、失败只提示不发请求，不会伪造数据。常量写出并注释，便于接板后按
  实际 RTC 行为调整。
- **失败节流 60 s 口径**：`setTimeNtp()` 是 BLOCKING（同 httpGet，最长 10 s）。校时失败后
  记 `lastSyncFailMs = lume._nowMs()`，60 s 内再点刷新直接显示「校时失败，稍后重试」，
  不重试也不烧 https，避免连点反复阻塞引擎。窗口取 60 s 是 UX 折中（r129/r130 用
  30 s 重试 / 10 min 重同步；weather 是按需刷新、非连续帧循环，无需 30 s 那么激进）。
- **insecure 逃生口边界**：`weather.insecure=1` 的 `skipTls` 用户完全绕过校时门控，直走
  `httpsInsecure`，行为与旧版一致；头注释不再编号推荐，仅标为无 SNTP 可达环境下的受控
  逃生口。代价是跳过证书校验（MITM 风险），会在成功状态显示「（未校验证书）」。
- **-2 文案纠偏**：校时失败分支已单独拦截并提示 ASCII 返回码，能走到 httpGet 的 -2 视为
  传输/TLS 问题，文案从「TLS 需校时」改为「TLS 传输问题」。既有 `tests/weather.js` 的
  `-2` 断言只检查出现 'TLS'，故零改动通过；新 harness 精确断言旧文案已移除。
- **宿主桩门控天然不触发**：`_systemTime: () => Date.now()` 在宿主是 2026 墙钟，
  `time() >= 阈值` 使 SNTP 分支在宿主 app harness 中不执行；SNTP 真实路径靠静态断言 +
  变异实证覆盖，不靠宿主运行。
- **验证 / 诚实口径**：`tests/weather_sntp.js` 15 PASS + 15 变异实证 PASS；`tests/weather.js`
  13 PASS 不回归；全量宿主 harness 0 FAIL；`npm test` 50/0/0（补齐 gitignore 的 `bin/qjsc`）；
  `check_website.py` 三项 none；`lume check` weather + counter `--no-emu` 均
  `RESULT: PASS`；playground 47 行 PASS（45 bundles + 2 summary，含 `weather 8080 bytes`）。
  `git diff 1dc7c76 HEAD -- firmware/ runtime/ tools/` 及工作树 diff 均为空，固件零改动故
  未跑 `idf.py build`；磁盘 88%，本轮日志落 `/tmp`，artifacts 未新增大件。未跑 codex review。

## r132 — OTA 消费方取舍（app-only，基线 d85e69a）

- **Math.random 非安全随机**：设备端没有 `crypto.getRandomValues`，「New token」用
  `Math.random()` 拼 32 个小写 hex。它不是 CSPRNG，熵与不可预测性不满足密码学密钥生成
  要求；当前靠 OTA 通道的 HMAC-SHA256 challenge-response 与 LAN 边界兜底。这是被接受的
  已知简化，不应被误读为「安全随机」；若后续固件提供 CSPRNG 绑定，应替换来源并同步更新
  `tests/ota_consumers.js` 的生成模式断言。
- **token 不上屏**：`OtaStatus.token`（32 hex）只在本地快照与串口 log 出现；settings 与
  dashboard 均不读取该字段，状态行只显示 `running` / `port` / `hmac` / `tokenReady` 的派生
  文案。屏幕截图、远程协助不会泄露 key；代价是用户无法在设备上肉眼核对 token，需从串口
  读取。
- **两段确认的有意摩擦**：`New token` 首点只 arm（3 s 窗口，标题变 `Confirm new token?`），
  再点才真正轮换并写 NVS，避免误触导致 OTA 通道短暂不可用；超时自动撤销。失败只显示
  ASCII 错误码，不伪造成功状态。
- **真机 OTA 端到端 deferred**：本轮全部为宿主源码静态断言 + 变异实证，加一次有限运行时
  烟测（patched 桩验证两次按压才调用一次 `setToken`、生成 32 hex、token 不进任何 UI attr
  消息）。真实 WiFi GOT_IP 自动起监听、HMAC 握手、`setToken()` 写 NVS 后的持久化与重启
  恢复、真机推包全部留接板轮。**不声称真机验证**。
- **dashboard SYSTEM 行预算**：SYSTEM canvas 由 9 行增至 10 行、分隔线 8→9，第 10 行
  y=332（底边 346 < H=360）；未新增 canvas、未改 14 px 文本布局、未扩页高，行数硬断言
  落在 harness 中。
- **验证 / 诚实口径**：`tests/ota_consumers.js` 19 PASS + 19 变异实证 PASS；全量宿主
  harness 0 FAIL；`npm test` 50/0/0；`check_website.py` 三项 none；`lume check` settings /
  counter / dashboard `--no-emu` 均 `RESULT: PASS`；playground 47 行 PASS。
  `git diff d85e69a HEAD -- firmware/ runtime/ tools/` 及工作树 diff 均为空，固件零改动故
  未跑 `idf.py build`；磁盘 88%，本轮日志落 `/tmp`。未跑 codex review。

## r133 — ADC 电压表消费方取舍（app-only + 宿主桩，基线 c4b390a）

- **宿主桩是假值，不是真采样**：`tests/lib/prelude_runner.js` 的 `adc` 桩固定返回
  `config=0 / readRaw=2048 / readMv=1650 / free=0`（可由 harness 注入覆盖）。宿主没有 ADC
  外设，`tests/adc_meter.js` 里所有 raw/mV 数字都是注入值；它证明的是 app 的渲染/分支/
  切换逻辑，不证明任何真实电压测量。
- **真机 ADC 精度与 atten 实测 deferred**：ESP32-S3 的 0/2.5/6/12 dB 衰减对应量程、
  线性度、噪声与参考电压偏差，以及 GPIO 1..10 的实际走线/分压，全部留接板轮。
  app 里 `FULL_SCALE_MV = 3300` 只是 Canvas bar 的**显示比例**，不是校准量程，
  不可当作硬件规格。
- **readMv 校准曲线只在真机生效**：固件用 curve-fitting + eFuse 校准位换算 mV；若芯片
  eFuse 未烧录，`config()` 仍成功、`readRaw()` 可用，但 `readMv()` 返回 -3。宿主桩默认
  给一个任意 mV，只有注入 -3 的 harness 分支能验证 UI 的 `err -3` 文案；真实无校准芯片
  的行为 deferred。
- **表盘只反映注入值**：Canvas bar 比例来自 `mvValue` 信号，`readMv` 注入多少就画多少；
  `RAW OOR`（raw > 4095）是 app 侧的契约防御，不是硬件断言。
- **无卸载钩子所以不 free()**：`lume.app` 只有 start/pause/resume/back，没有 close；
  ADC 槽位状态是引擎任务态且 hot reload 后保留，`config()` last-wins 重建通道，
  所以在 app 里调 `lume.adc.free(pin)` 没有正确时机。代价是槽位在 app 切换后仍占用，
  与 `gpio.pwmAttach` 不主动 `pwmFree` 的既有取舍一致。
- **没有 meta.json**：全仓 examples 均无 meta.json / package.json，meta 文本由 CLI 在 deploy
  时从 `package.json` 的 `lume` 块生成。examples 是源码/playground app，故本轮不创建
  meta.json，避免无人读取的死文件。
- **45→46 清单同步的合法性**：`tools/playground/build.mjs` 的 apps 是**数据清单**，
  新 app 注册使 3 只 consumer 测试的 `list.length === 45` 与 `sd_files.js` 的硬编码变异串
  必须同步到 46；同时把这些测试的 `gitChanged` 路径从 `tools/` 收窄为 `tools/lume/`
  （固件/runtime/CLI 工具面仍钉死各自基线），并在 ota allowlist 登记 r133 新文件。
  这些改动不触碰任何生产行为，仅让「app 数量/清单内容」断言继续有效。
- **验证 / 诚实口径**：`tests/adc_meter.js` 18 PASS（含 4 项变异实证）；全量宿主 harness
  0 FAIL；`npm test` 50/0/0；`check_website.py` 三项 none；`lume check` adc_meter + counter
  `--no-emu` 均 `RESULT: PASS`；playground 46 bundles + 2 summary PASS。
  `git diff c4b390a HEAD -- firmware/ runtime/` 及工作树 diff 均为空，固件零改动故未跑
  `idf.py build`；磁盘 88%，本轮日志落 `/tmp`。未跑 codex review。

## r134 — crypto_check 摘要/校验工具取舍（app-only，基线 c003834）

- **宿主注入的是真 node:crypto，不是真机 mbedTLS**：`lume.crypto` 的权威路径是 ESP-IDF
  mbedTLS（r91），宿主/浏览器桩只返回 -3。`tests/crypto_check.js` 通过 `options.crypto`
  注入 node:crypto（SHA-256 / HMAC-SHA256 / AES-128-CTR）与自写反射表 CRC-32，对拍对象
  是 node:crypto 与 `zlib.crc32`，**不是** mbedTLS。它证明 app 的渲染/分支/切换逻辑正确，
  不证明固件实现在真机上与这些向量一致；mbedTLS 的 NIST 向量与错误码分支仍由
  `tests/crypto.js` / `tests/crypto_host.c` 在宿主编译真 C 源码覆盖，真机实测 deferred。
- **hex 截断口径**：32 B 摘要 = 64 hex 字符，在 480 px 屏上以可读字号无法单行容纳，
  故只显示前 16 B（32 hex 字符）+ `...`。代价是肉眼看不到尾部，两个不同 payload 若前
  16 B 相同则显示相同；harness 把这段前缀与 node:crypto 真摘要逐字符对拍，截断造假
  （改成全量或改长度）会被静态谓词与 live 断言同时抓到。HMAC 同口径（呼应 r132 OTA
  token，但本 app 固定 key，不做密钥轮换）。
- **AES-CTR 回环的证明边界**：app 用同一 key/iv 加密再解密并逐字节比较，OK 表示自洽；
  对短 payload（4 B）密文只有 4 B，显示 8 hex 字符而非 16，空 payload 回环必然 OK
  （无字节可校验，不真正 exercise CTR 分组）。harness 另用 node:crypto 独立算出密文前
  8 B 与 app 显示值对拍，故对非空 payload 实际上是已知答案测试，不只是自证。
- **CRC-32 无符号口径**：`crc32` 返回 u32，`0xFFFFFFFF` 合法值为 4294967295；app 只在
  返回值 `< 0` 时判错，并用 `>>> 0` 保证十进制显示无符号。app 把 payload 分两段链式
  seed（覆盖 seed 参数），harness 断言第二次调用确实以第一段 CRC 为 seed。自写查表
  与 `zlib.crc32` 交叉验证，但 CRC 本身不是密码学原语。
- **UNSUPPORTED 是正常呈现不是异常**：-3 在宿主/浏览器桩里是常态；app 把它渲染为
  ASCII `UNSUPPORTED`，其他负值为 `ERR <code>`，0 与正数一律不是错误。把 -3 当异常吞掉
  会让 playground 里四个数据行全空白，故 harness 专门用默认桩跑一遍确认四行都显示
  UNSUPPORTED。
- **18 节点 / <=20 预算**：宿主 create 消息计数 18，头注释声明 `LUME_MAX_NODES = 128`
  与 <=20 的 app 自定上限；没有列表与运行时建节点。
- **46→47 清单同步的合法性**：`tools/playground/build.mjs` 的 apps 是数据清单，新 app
  注册使 4 只 harness 的清单长度断言与 `sd_files.js` 的硬编码变异串以及三只 consumer
  的**检查名字符串**必须同步到 47；这些改动不改任何生产行为，只让数量/清单断言继续
  有效。`tools/lume/`（CLI 工具面）仍在 gitChanged 钉死范围内且零 diff。
- **验证 / 诚实口径**：`tests/crypto_check.js` 23 PASS + 1 汇总 PASS（含 6 项变异实证）；
  全量宿主 harness 0 FAIL；`npm test` 50/0/0；`check_website.py` 三项 none；
  `lume check` crypto_check + counter `--no-emu` 均 `RESULT: PASS`；playground
  `PASS bundle crypto_check 3175 bytes` + 47 sources + 47 apps。
  `git diff c003834 HEAD -- firmware/ runtime/ tools/lume/` 与工作树 diff 均为空，
  固件零改动故未跑 `idf.py build`；磁盘 88%，本轮日志落 `/tmp`。未跑 codex review。

## r135 — archive_view 压缩档案查看器取舍（app-only，基线 9d1849f）

- **宿主注入的是 node:zlib，不是真机 miniz**：`lume.compress.inflate` 的权威路径是
  固件 vendored miniz tinfl（r92），宿主/浏览器桩只返回 -3。`tests/archive_view.js`
  通过 `options.compress` 注入 `zlib.inflateSync` / `zlib.inflateRawSync`（适配成
  stub 签名并把结果拷进 out），对拍对象是 node:zlib，**不是** miniz。它证明 app 的
  解压渲染/字节统计/压缩比/错误分支/循环逻辑正确，不证明固件在真机上的 DEFLATE
  吞吐与错误码一致；权威覆盖在 `tests/compress.js`（编固件同一份 `lume_compress.c`），
  真机 miniz 实测仍 deferred。
- **payload 是自造样本不是真实数据**：三条字节字面量由 node:zlib 在写入时压缩合成
  boot log（zlib, 181 B）/ 传感器记录（raw, 177 B）/ 前者尾部截短（zlib, 71 B）；
  都是 fixture，不含任何真实设备日志或历史数据。截短流经原生 runner 实测返回 -2
  （而非 -1），DAMAGED 条目据此覆盖损坏流分支；-1/-3/0 由 harness 注入覆盖。
- **文本截断口径**：解压文本截到前 120 字符并追加 `...`，避免整条记录溢出 480 px
  Text 行。代价是肉眼看不完整尾部；harness 把这段前缀与 node:zlib 真结果逐字符对拍，
  截断造假（删截断或改长度）会被静态谓词与 live 断言同时抓到。
- **out 缓冲复用与 -3 防御**：单一 2 KiB Uint8Array 复用，样本解压后约 180 B，远低于
  上限；更大流会返回 -3 而不是越界写，app 把它渲染为 `ERR -3`，harness 注入 -3
  覆盖该分支。宿主默认桩的 -3 也显示为 `ERR -3`，不是 UNSUPPORTED（compress 的 -3
  语义是 out 太小，与 crypto 的 -3 语义不同，故不套用 r134 的 UNSUPPORTED 呈现）。
- **0 不是错误**：`inflate` 返回 0 表示合法空流，app 显示 `OK` 与 `0%`，绝不显示
  `ERR 0`；负值一律用 `n < 0` 数值判别，不用真值判断。harness 注入 0 专门断言此点。
- **14 节点 / <=20 预算**：宿主 create 消息计数 14，头注释声明 `LUME_MAX_NODES = 128`
  与 <=20 自定上限；没有列表与运行时建节点。
- **47→48 清单同步的合法性**：`tools/playground/build.mjs` 的 apps 是数据清单，新 app
  注册使 `crypto_check.js` / `adc_meter.js` 的 `apps.length`、三只 consumer 的检查名
  字符串、`sd_files.js` 的硬编码变异串必须同步到 48；新文件进入 HEAD 后还需把 4 个
  r135 文件加进 `ota_consumers.js` 的 `gitChanged([])` 允许清单，否则该 harness 提交后
  由绿转红。这些改动不改任何生产行为，只让数量/清单断言继续有效。`tools/lume/`
  （CLI 工具面）仍在 gitChanged 钉死范围内且零 diff。
- **验证 / 诚实口径**：`tests/archive_view.js` 21 PASS（含 6 项变异实证）；全量宿主
  harness 0 FAIL；`npm test` 50/0/0；`check_website.py` 三项 none；`lume check`
  archive_view + counter `--no-emu` 均 `RESULT: PASS`；playground `PASS bundle
  archive_view 3455 bytes` + 48 sources + 48 apps。`git diff 9d1849f HEAD --
  firmware/ runtime/ tools/lume/` 与工作树 diff 均为空，固件零改动故未跑 `idf.py
  build`；磁盘 88%，本轮日志落 `/tmp`，`artifacts/r82/fft-host-*/sdkconfig.h` 已清理。
  未跑 codex review。

## r136 — img_view RGB565 缩放演示取舍（app-only，基线 67d37a7）

- **宿主跑的是 prelude JS + imgscale 桩，不是真机 C 绑定**：`lume.imgscale.scale` 的权威
  路径是固件 vendored C 实现（零拷贝视图、8-bit 定点 bilinear）。宿主
  `tests/lib/prelude_runner.js:77-132` 提供同契约的**真实现** JS 桩（nearest 中心采样、
  bilinear 逐通道定点插值），harness 对拍的是这个桩，不是 ESP32-S3 上的 C。它证明 app
  的按钮/HUD/错误分支/像素结果逻辑正确，不证明真机 CO5300 面板上缩放图样的观感、
  帧率与触屏手感；这些仍 deferred，未声称真机验证。
- **fixture 是合成图不是真实图片**：24x24 RGB565 数组由作者期一次性脚本生成后内嵌，
  混合渐变、棋盘硬边与色块条纹，只为让 nearest/bilinear 的差异肉眼可辨；不含任何
  照片、设备截图或历史数据。生成脚本留在 `/tmp`，不进仓。
- **缩放比/裁剪口径**：只放大整数倍（2x/4x/8x），源 24x24 → 目标 48/96/192 方形，
  不引入小数倍或非整数裁剪。采样按中心对齐并**钳制到源边缘**（sampling 不越界）；
  目标在 200x200 Canvas 内居中显示 `floor((200-dw)/2, (200-dh)/2)`，四周留底色边。
  单一 192x192 `Uint16Array` 预分配，每帧取 `subarray(0, dw*dh)` 作为 dst，零拷贝；
  放大后的图通过 `retainImage`/`drawImage` 上传精灵槽（slot 1）重放，避免逐像素 JS 绘制。
- **-3 不可达，仅按数值呈现**：契约把 -3 留作内部保留码，当前实现无可达路径产生它；
  harness 仍现场注入 -3 断言 app 显示 `ERR -3`，不把它误当异常或吞掉。所有负值一律
  `rc < 0` 数值判别，0 显示 `OK`、绝不显示 `ERR 0`，不用真值判断返回码。
- **10 节点 / <=12 预算**：宿主 create 消息计数 10，头注释声明 `LUME_MAX_NODES = 128`
  与 <=12 自定上限；静态树，无列表与运行时建节点，精灵槽原地重定义。
- **48→49 清单同步的合法性**：`tools/playground/build.mjs` 的 apps 是数据清单，新 app
  注册使 `archive_view.js` / `crypto_check.js` / `adc_meter.js` 的 `apps.length`、
  `weather_sntp.js` / `sntp_consumers2.js` / `ota_consumers.js` 的检查名字符串、
  `sd_files.js` 的硬编码变异串都必须同步到 49；新文件进入 HEAD 后还需把 4 个 r136
  文件加进 `ota_consumers.js` 的 `gitChanged([])` 允许清单，否则该 harness 由绿转红。
  这些改动不改任何生产行为，只让数量/清单断言继续有效。`tools/lume/`（CLI 工具面）
  仍在 gitChanged 钉死范围内且零 diff。
- **验证 / 诚实口径**：`tests/img_view.js` 18 条检查 + 1 汇总行全 PASS（含 6 项变异实证）；
  全量宿主 harness 0 FAIL；`npm test` 50/0/0；`check_website.py` 三项 none；
  `lume check` img_view + counter `--no-emu` 均 `RESULT: PASS`；playground
  `PASS bundle img_view 4850 bytes` + 49 sources + 49 apps。`git diff 67d37a7 HEAD --
  firmware/ runtime/ tools/lume/` 与工作树 diff 均为空，固件零改动故未跑 `idf.py
  build`；磁盘 88%，本轮日志落 `/tmp`。未跑 codex review。

## r137 — vec_demo 矢量物理演示取舍（宿主侧刀，基线 7c47db1）

- **宿主/浏览器跑的是 C 语义的 JS 镜像，不是真机 C 绑定**：`lume.math` 的权威路径是
  `firmware/components/lume-engine/lume_math.c` 注册的 QuickJS 原生函数。宿主
  `tests/lib/prelude_runner.js` 与浏览器 `website/playground/runtime.js` 的 `mathStub` 是
  忠实镜像——原地 mutation、返回 a、double dot、交错 acc、Float32Array 单次舍入、
  subarray byteOffset 生效，异常 TypeError/RangeError 照抄。harness 对拍的是这个镜像，
  不是 ESP32-S3 上的 C。它证明 app 的四 API 调用/HUD/反弹/防御分支逻辑正确，不证明真机
  CO5300 面板上的粒子观感、帧率与触屏手感；这些仍 deferred，未声称真机验证。
- **异常契约与 lume 其它命名空间不一致**：`lume.math` 是全仓唯一**抛异常**而非返回负错误码
  的命名空间（非零返回码约定不适用）。stub 不发明负返回码：非 Float32Array → TypeError，
  vecAdd/dot 长度不等 → RangeError，integrate `vx.length !== vy.length || acc.length !==
  vx.length*2` → RangeError。app 因此用 try/catch 而非 `rc < 0` 判别，这是与 img_view /
  archive_view 返回码纪律的**有意差异**，不是回归。
- **物理参数口径**：固定 50 ms 步长、N=24、半径 4 px、240x240 方形画布；重力档
  [40,80,160] px/s²（NEXT 循环），阻尼 0.98/步，水平冲量 6 px/s/步，反弹系数 0.7。
  均为整数取整的演示值，未经真机调参。acc 交错 `[ax0,ay0,...]` 且 ax 恒为 0，水平运动
  来自初始速度与 vecAdd 冲量。位置积分与触壁反弹留在 app 层 JS（C 的 integrate 只改速度）。
- **9 节点 / <=12 预算**：宿主 create 消息计数 9，头注释声明 `LUME_MAX_NODES = 128` 与
  <=12 自定上限；静态树，无列表与运行时建节点。画布刻意取 240x240 而非全屏，控制栅格预算。
- **测试边界**：独立 double 参考积分器与 stub 用完全相同的运算顺序，因此能量与状态逐值
  严格相等、无需容差；参考实现造假会被对拍抓到。try/catch 正常不可达，由注入抛异常的
  vecAdd/integrate 触发，验证 HUD 呈现 MATH ERR 并冻结物理；这不是固件会产生的状态。
- **48→49→50 清单同步的合法性**：`tools/playground/build.mjs` 的 apps 是数据清单，新 app
  注册使 `archive_view.js` / `crypto_check.js` / `adc_meter.js` / `img_view.js` 的
  `apps.length`、`weather_sntp.js` / `sntp_consumers2.js` / `ota_consumers.js` 的检查名
  字符串、`sd_files.js` 的硬编码变异串都必须同步到 50；新文件进入 HEAD 后还需把 4 个 r137
  新文件和被改的 `website/playground/runtime.js` 加进 `ota_consumers.js` 的 `gitChanged([])`
  允许清单（新文件 commit 前对 git diff 不可见，预加防提交后转红），否则该 harness 转红。
  这些改动不改任何生产行为，只让数量/清单断言继续有效。`tools/lume/`（CLI 工具面）
  仍在 gitChanged 钉死范围内且零 diff。
- **验证 / 诚实口径**：`tests/vec_demo.js` 25 条检查 + 1 汇总行全 PASS（含 6 项变异实证）；
  全量宿主 harness 0 FAIL；`npm test` 50/0/0；`check_website.py` 三项 none；`lume check`
  vec_demo + counter `--no-emu` 均 `RESULT: PASS`；playground `PASS bundle vec_demo 2712
  bytes` + 50 sources + 50 apps。`git diff 7c47db1 HEAD -- firmware/ runtime/ tools/lume/`
  与工作树 diff 均为空，固件零改动故未跑 `idf.py build`；磁盘 88%，本轮日志落 `/tmp`，
  测试临时物未进仓。未跑 codex review（主控轮负责）。

## r138 / allocator tracker 实证纠偏与 host-only OOM 注入

- **立项落点已被 r54 覆盖（不是本轮产出）**：roadmap P1 第 1 条的净分配计数、`lume-perf: alloc.net/alloc.live` profile 行、esp32sim 稳态断言，均在 r54（commit `775566aa`）与 `605785c` 落地于基线。本轮读码实证后**不重复实现**，避免重复计数/回归；result 里按真实代码写明偏差。
- **跨任务读口径**：`s_alloc_net_bytes` / `s_alloc_live` 与 host harness 的 `net_bytes` / `live` 均为单任务/单线程访问、O(1) 无锁；QuickJS runtime、eval、回调、GC、teardown 全在 engine task，LVGL task 只投递事件、不调 JS 分配器。若将来新增跨任务读（如诊断任务轮询），必须加原子/锁或明确「快照非一致」口径——本轮读 API `lume_engine_alloc_stats()` 标注 engine-task-only，host harness 为单线程进程。
- **字节口径与边界**：计数只覆盖经过 Lume `JSMallocFunctions` 的 PSRAM 块，字节用 `heap_caps_get_allocated_size`（host harness 用 `malloc_usable_size` 作等价口径）；不含直接 C 分配的 canvas PSRAM、LVGL buffer、其他 native 分配与任务栈。增长是「JS 分配器保留内存」的证据，不等于不可达对象泄漏或物理 PSRAM 碎片。
- **阈值依据（本轮复测）**：counter app 稳态 9 个采样点 `alloc.net=363536` 恒定 → 增长 **0 B**；故意泄漏 app 从 421472 → 740788 → 增长 **319316 B**；阈值 **32768 B** 介于 0 与 319 kB 之间（r54 用 0 / 319300 校准出 32768，本轮正对照漂移 16 B）。该阈值绑定当前固件/app/模拟器时钟，任何运行时或 app 改动后需重新采样校准。采样自最后一次 `app eval ok` 后 +2 s 起，~10 s 稳态窗口。
- **注入仅 host、不进固件路径**：`tests/alloc_inject_host.c` 的倒计时失败只在 host 编译的 QuickJS runtime 生效，固件源码/配置/二进制零改动；与 r77 的固件侧 `LUME_CMD_OOM` verb 有意区分（r139 实证 `r77-oom-wip` 并无该实现，见下条与 r139 节）。host 注入通过先编译 app 函数、再 arm、再调用，让拒绝落在 app 分配而非脚本编译；QuickJS 的 OOM 在本环境**无法被 JS `try/catch` 捕获**（实测仍是 `JS_Call` 抛 `InternalError: out of memory`），故 harness 在 C/引擎边界断言确定性异常，并选择 `JS_FreeRuntime` 后校验 net/live 归零，而不是在 OOM 后重入 JS（该状态 QuickJS 设计上不可用）。
- **既有 OOM drill 的存量失败（r139 已收口）**：`tools/emu/check_oom_inject.py` 在 r138 基线实跑得 `CMD ERR verb` → `EXIT=1`，当时记为「依赖的固件 OOM verb 未合入主线（`git grep` HEAD 无 `LUME_CMD_OOM`）」。这是**存量失败、非 r138 回归**；r138 不复活固件注入路径，改以 host-only harness 满足「确定性失败 + 计数器一致」的验收。**r139 实证纠偏：`r77-oom-wip`（merge-base `f0dd8ef`）只有 playground 清单修复，`git grep` 无任何 `LUME_CMD_OOM` / OOM verb 实现——该 verb 从未被实现过。** r139 已在固件侧实现 profile-only `OOM <ms>` verb，该 drill 现 `EXIT=0`（详见 r139 节）；r138 host-only harness 保留，二者覆盖不同层。
- **harness 位置/形态偏差**：任务书要求 `tests/` 下 CommonJS；但本仓 emu 断言先例是 `tools/emu/*.py`（`check_alloc_leak.py` 用 esp32sim serial log），故稳态断言留在 `tools/emu`（Python），仅新增的 host OOM 注入按 `tests/fft.js` 先例落 `tests/*.js` + `tests/*_host.c`（CommonJS driver + host C）。
- **验证环境事实**：worktree 缺 gitignore 的 `tools/lume/bin/qjsc` 与 esp32sim cache，分别软链主仓只读二进制以对齐基线；首轮 `npm test` 因 qjsc 缺失为 49/0/1（跳过字节码用例），软链后 50/0/0，源码零改动。`idf.py` 构建 profile 固件时自动-normalize `sdkconfig.r54-profile`（+15 行）并重生成 `clock.frame`，两者已 `git checkout --` 撤销，不进提交。
- **真机与收尾**：所有板级项（显示/触摸/音频/睡眠电流/radio/持久化）仍 deferred；本轮证据为 host harness + esp32sim，不是真机验收。固件 C 零 diff，构建 size 与 r137 基线逐字节一致（2041168 / 853084 / 247491 / IRAM 16384 Remain 0 / Total 3036023），IRAM 硬线未破。磁盘 before 5.4G → after 6.0G，已删两个 337M build 目录，日志仅留 `/tmp`。未跑 codex review（主控轮负责）。

## r139 / 固件侧 OOM 注入 verb（profile 门控），check_oom_inject drill 转绿

- **注入窗口参数口径**：任务书表述「从 t+ms 起持续 ~1s」按 drill 实证实现为：`OOM <ms>` 的 `<ms>` 是**从 arm 时刻到窗口开启的延迟**，不是窗口长度；窗口长度固定 `LUME_OOM_WINDOW_US = 1000000`（1 s）。drill 在 t=2.5 arm `2500` → 5.0–6.0 s 失败窗口；实跑日志 `armed 2500 ms` @2688、`ACTIVE` @5207、`window closed` @6208（窗口实际 5207–6208 ms，含 sim 调度偏差）。任务书写的日志名 `oom-inject ACTIVE` 与 drill 正则不一致——drill 实际要求 `oom-inject: ACTIVE`（含冒号）与 `oom-inject: window closed after \d+ denials`，按 drill 正则实现，非按任务书文字。
- **跨 task 标志口径**：LUMC verb 在 USB/TCP RX task 解析（`handle_cmd` ← `on_frame_event` ← `usb_rx_task` / TCP RX），QuickJS 分配钩子与窗口状态机在 engine task（`lume-js`，pinned core 1）。RX 侧**单写** `volatile uint32_t s_oom_gen / s_oom_open_us / s_oom_end_us`，`gen` 最后发布；engine task 独占 `s_oom_active / s_oom_done / s_oom_logged_active / s_oom_denials`，热路径无锁；时间戳用 u32 微秒 + 有符号差比较，规避 ~71 min u32 wrap（窗口仅 ~3.5 s）。USB/TCP 并发 arm 用 `s_pending_mutex` 串行化，维持单写者。快照非强一致（两字段间理论上可 interleaving），profile drill 用途足够；若将来诊断任务跨任务读，需另加原子/锁口径，沿用 r138「cross-task read」原则。
- **denials=0 的诚实边界**：本轮 drill 输出 `oom-inject: window closed after 0 denials`。原因是 `examples/clock` 帧在 t=9.0 才 stage，**窗口 5.0–6.0 s 内没有 QuickJS 分配落入**（开机内置 home 不按 1 s 节拍分配），与 drill docstring 假设不符。drill 正则 `\d+` 接受 0 且总退出 0，主验收达标；但「窗口内确实发生 N>0 次分配拒绝」未被本 app 时序覆盖，登记为未证实的边界。钩子有效性由三路证据支撑：profile-only 代码路径、host 语法门（default 47 / profile 51 checks）、ELF 字符串对拍（default 0 条 `oom-inject`，profile 3 条）。真机/后续 drill 需补 denial-positive 场景，本轮不声称已验证。
- **基线潜在缺陷（profile-only 修复）**：drill 还暴露 `RELOAD OK` 缺失——`lume_engine.c` 在 DATA 帧路径设 `cand_want_reply = false`（blame `9421903`，基线原样），成功 reload 不触发结果回调，hotreload pushed FIFO sink 永不弹出，故无 `RELOAD OK`。这与 OOM verb 无关，是 r138 之前的存量缺陷；本轮在 `CONFIG_LUME_PERF_PROFILE` 门控下改为 `true`，default 构建保留原路径，size 不受影响。任务书未预告此项，属实证纠偏。
- **profile 门控与 default 零增量**：`LUME_CMD_OOM` 枚举、`lume_cmd_t.oom_ms`、parser 分支、dispatch case、engine 状态/函数全部包在 `#if CONFIG_LUME_PERF_PROFILE` 内。可移植头 `lume_cmd.h` 通过 `__has_include("sdkconfig.h")` 取 firmware 门控宏（host 无该头，宏由 `-D` 或缺省决定）。default 固件三次 `idf.py build && size` 均 2041168 / 853084 / 247491 (Remain 94269) / 16384 (Remain 0) / Total 3036023，与 r138 基线**逐字节一致**；`strings build/lume.elf | grep -c oom-inject` = 0。
- **host harness 覆盖与取舍**：`tests/apps_protocol.c` 编两遍（默认 47 checks、profile 51 checks，均 0 failure），覆盖 verb 接受/拒绝与参数校验。**跨 task 分配失败窗口无法在 host 覆盖**（`lume_engine.c` 依赖 ESP-IDF/FreeRTOS），该层由 esp32sim drill 覆盖；如实登记，不伪造 host 断言。
- **app-only 守卫基线重钉**：11 个 `tests/*.js` 含「firmware/ runtime/ 与旧基线零 diff」守卫，本轮固件刻意变更会令其转红。按 r128/r129 既有先例，把这些守卫的 BASE 重钉到 r139 firmware 提交 `d91a038`，并把本轮测试文件加入 `ota_consumers.js` 的 ALLOWED；断言语义不变（任何后续 firmware/runtime 改动仍会转红），非放宽。重钉后 `for t in tests/*.js` → `done`，0 FAIL。
- **验证环境事实**：worktree 缺 gitignore 的 `tools/lume/bin/qjsc`、`tools/lume/node_modules`、esp32sim 与 S3 ROM cache，均软链主仓只读物（源码零改动，与 r128/r137/r138 同一环境事实）；`node_modules` 必须软链 `tools/lume/node_modules`（非仓根）。profile 构建自动 normalize `sdkconfig.r54-profile`（+15 行）并重生成 `clock.frame`，两者 `git checkout --` 撤销不进提交。
- **真机与收尾**：所有板级项仍 deferred，证据为 host harness + esp32sim，**不声称真机验证**。ASCII 纪律：新增日志与 harness 输出全 ASCII；未改 vendored（QuickJS/LVGL）、未改 JS API 契约与 `.d.ts`。commits 拆 feat / test / docs，未推送；日志仅留 `/tmp`，收尾删两个 build 目录，测试临时物未进仓。未跑 codex review（主控轮负责）。

## r140 / OOM drill denial-positive 收口 + profile-only `lume.perf` 绑定

- **denials=0 边界已真实收口**：r139 的诚实边界是 `window closed after 0 denials`——clock 帧 t=9.0 才 stage，窗口 5.0–6.0 s 内无 QuickJS 分配落入。r140 denial-positive case 在窗口内注入必分配表达式，实跑 `window closed after 6 denials`（N=6 ≥ 1），断言正则收紧为 `[1-9]\d*`，零拒绝 FAIL。这是**真实覆盖**，不是放宽正则；counter case 保留 `\d+` 作为 r139 基线负对照（仍输出 0 denials）。
- **窗口内注入形态的实证纠偏（LUME reload → LUMR REPL）**：原计划用轻量 LUME reload 帧直推 source 落入窗口。实跑发现：reload 会先跑 `__lume_shutdown`，而 OOM 窗口把该钩子里的 QuickJS 分配也拒绝 → `E ... JS exception [__lume_shutdown]: InternalError: out of memory` → watchdog 重启，窗口状态机随重启清零，`window closed` 日志永久丢失（case 因缺该行 FAIL，即便侧证已发生拒绝）。改为 **LUMR REPL 帧**：单条表达式在引擎 task 同步 eval 于当前 ctx、不回收 runtime、无 shutdown 钩子，200 次字符串拼接必分配，干净拿到 N≥1 且窗口闭合日志保留。二者都是「直推 source」，但只有 REPL 形态在本固件能稳定产出 denial-positive 证据；任务书原措辞按实证修正。
- **esp32sim 大帧丢弃的实证纠偏（最终 recycle 帧）**：r140 固件在 profile 构建比 r139 多约 600 B（两条绑定 + namespace），esp32sim 在此指令时序下丢弃原 3445 B 的 `clock.frame`（t=9.0 帧写入后仅见 staging 分配、无 `engine recv RELOAD`，`RELOAD OK` 永不出现）。曾临时加两条日志验证：日志改变时序后大帧恢复送达，证明是**模拟器帧投递时序敏感**而非固件逻辑错误。稳定性收敛方案：最终 recycle 校验改用 10 B 的 LUME source 帧 `var a = 1;`，`RELOAD OK \d+` 断言与「运行时回收」语义完全不变；`build_frame`/`examples/clock` 依赖从 drill 移除。真机上大帧无此问题，此为 esp32sim 环境事实，非产品缺陷。
- **`lume.perf` 不进 `.d.ts` 的取舍**：`lume.perf.oomState()` / `allocStats()` 只在 `CONFIG_LUME_PERF_PROFILE=y` 的调试固件存在，是 profile-only 诊断面（app 层自证注入状态/计数用）。写进 `lume.d.ts` 会向所有默认 app/IDE 暴露一个 default 构建根本不存在的 API，制造契约谎言并使 `check_website.py` 的 catalog/declaration 对齐失真。按 r139 此前纪律，profile-only 调试面不进公共类型声明；`.d.ts` 本轮零改动，`check_website.py` 三项 none 天然绿。
- **null prototype 与引擎 task 读口径**：`lume.perf` namespace 与两个返回对象都用 `JS_NewObjectProto(ctx, JS_NULL)`，只有声明字段、无继承属性干扰诊断断言。`s_oom_active` / `s_oom_denials` 是引擎 task 独占状态（RX task 单写的是 volatile `s_oom_gen/open/end`，gen 最后发布）；两个 native 只读引擎 task 状态、不触碰 RX 变量、热路径无锁，沿用 r138/r139「cross-task read」原则。`allocStats()` 直接复用 `lume_engine_alloc_stats()`，与 `lume-perf: alloc.net/alloc.live` 串口行同源。
- **default 零增量与 profile 增量**：所有绑定代码与 token 头都包在 `#if CONFIG_LUME_PERF_PROFILE`；可移植头 `lume_perf_binding.h` 在无该宏时编译为空。default 固件 size 与 r139 逐字节一致（2041168 / 853084 / 247491 / IRAM 16384 Remain 0 / Total 3036023），`strings build/lume.elf | grep -c oom-inject` = 0；profile 构建 `strings ... | grep -c "oom-inject\|lume.perf"` = 40。未改 vendored（QuickJS/LVGL）。
- **host harness 覆盖边界**：`tests/apps_protocol.c` profile mode 的 6 条断言验证的是共享 token 头（`lume_perf_binding.h`）里 namespace/方法/字段的编译期契约，固件注册直接使用同一组宏；**它不运行 QuickJS、不证明运行时对象真的存在**（该 harness 只链 `lume_frame.c` / `lume_cmd.c`）。运行时存在性与返回形状由 profile 固件 + esp32sim drill 覆盖；如实登记，不伪造 host 断言。default mode 不新增断言（47 checks），profile 57 checks，两遍 0 failure。
- **app-only 守卫基线重钉**：11 个 `tests/*.js` 的 firmware-immutability BASE 从 `d91a038` 重钉到本轮 feat `4e00954`，并把 `tools/emu/check_oom_inject.py` 加入 `ota_consumers.js` 的 ALLOWED；断言语义不变（后续 firmware/runtime/CLI 改动仍会转红），非放宽。`for t in tests/*.js` → `done`，0 FAIL。
- **验证环境事实**：worktree 缺 gitignore 的 `tools/lume/bin/qjsc`、`tools/lume/node_modules`、esp32sim 与 S3 ROM cache，均软链主仓只读物（源码零改动，与 r128/r137/r138/r139 同一环境事实）；`node_modules` 必须软链 `tools/lume/node_modules`。profile 构建自动 normalize `sdkconfig.r54-profile`（+15 行），已 `git checkout --` 撤销；drill 覆盖的 tracked artifacts（`clock.frame` / `counter/tft.png`）已 `git checkout --` 还原，不进提交。`idf.py -B build-r54-profile` 的 `-B` 相对 cwd 解析，必须从 `firmware/` 目录调用才落在仓内。
- **真机与收尾**：所有板级项仍 deferred，证据为 host harness + esp32sim，**不声称真机验证**。ASCII 纪律全满足；commits 拆 feat / test / docs，未推送；日志仅留 `/tmp`，收尾删两个 build 目录。未跑 codex review（主控轮负责）。

## r141 / `lume.system.reboot()` 绑定（收口 r8 遗留，固件刀 + 契约 + host + emu）

- **`esp_restart` 语义取舍（实证）**：ESP-IDF v5.5.5 `esp_system.h:71-79` 明确 `esp_restart()` 为 `__noreturn__`、可从任一 CPU/任务调用、重启原因 `SW_CPU_RESET`；`components/esp_system/esp_system.c:47-63` 仅跑 shutdown handlers 后 `vTaskSuspendAll()` + `esp_restart_noos()`，**没有**要求调用方先 flush stdio 或 `vTaskDelay`（ESP_LOG 走 UART 同步写出）。因此在引擎 task 直接 `esp_restart()`，未加冗余延时。C native 返回 `JS_UNDEFINED` 只是不可达的签名形式，`.d.ts` 如实标 `function reboot(): never`，不伪造一个"会返回的重启 API"。
- **状态语义（写进 JSDoc，不假装事务性）**：调用后 JS 任务被就地杀死，**未持久化的 JS 状态全部丢失**；LittleFS 已 journal 化，提交过的写入可存活，但**仍 open 的写句柄会断、其缓冲字节不保证刷出**（调用前须 close/flush）；WiFi / SNTP 状态不保留，下次启动由 app 重建（需要墙钟则重调 `setTimeNtp()`）；KV（NVS）写入是持久的。不做"优雅停机"钩子、不等待在途网络请求完成——这些留后续轮。
- **注册架构与参数校验**：`lume.system` 对象在 prelude（`lume_scripts.c`）组装，不在 `register_bindings()`，故本轮同时改 C native（`_systemReboot` 注册在 `lume` 上，仿 r128 `_systemTime` 先例）与 prelude 一行。prelude 采用 `reboot: lume._systemReboot` 直接赋值（同 `log: lume.log`），**而非转发包装函数**——这样 `lume.system.reboot(1,2)` 的多余参数能真实到达 native 的 `argc > 0` 校验并抛 TypeError；若包一层只转零参的函数，参数会被吞掉、校验形同虚设。新增可移植头 `lume_system_binding.h` 作为 JS 名/native 名/日志 token 的单一真相源（仿 r140 `lume_perf_binding.h`，但 default 可见、无 `#if` 门控）。
- **host 断言只覆盖编译期契约**：`tests/apps_protocol.c` default mode 的 5 条断言 pin 的是共享头里的 namespace / method / native / log / ASCII token，**不运行 QuickJS、不证明运行时对象真的存在**（该 harness 只链 `lume_frame.c` / `lume_cmd.c`）。运行时存在性由 default ELF 字符串（`reboot requested` = 1、`_systemReboot` = 2）与 emu 重启 drill 覆盖；真机由接板轮覆盖。profile mode 不加断言（57 checks 不回归），default 52 checks（47 + 5）。
- **emu 重启 drill（可选加分项达成，但仍是模拟器证据）**：`tools/emu/check_reboot.py` 注入一条 `LUMR` REPL 帧 `lume.system.reboot();`，断言 native 日志 → esp32sim `chip reset ... cause 0xc (RTC_SW_CPU_RESET)` / `rst:0xc (RTC_SW_CPU_RST)` → 复位后再次出现 `engine task up` 的链条。实跑 `EXIT=0`，三链全中。**这不等于真机验证**：硅片复位原因、PMIC 掉电时序、复位延迟、真实串口时序均未实测；真机重启实测 deferred。
- **default 增量与硬线**：所有新代码在 flash `.text/.rodata`（无 IRAM 属性）。对 r140 基线 Flash Code +120 / Flash Data +208 / DIRAM ±0 / Total +328 B；`IRAM 16384 (100.0%, Remain 0)` 硬线未破。未碰 vendored（QuickJS/LVGL），未碰 profile-only 面（`lume.perf` / OOM 不动）。
- **守卫重钉语义不变**：11 个 app-only 守卫 BASE 从 r140 feat `4e00954` 重钉到本轮 feat `2e192d5`，并把 `tools/emu/check_reboot.py` 作为测试工具加入 `ota_consumers.js` ALLOWED。`firmware/ runtime/ tools/lume/` 零 diff 守卫与 ALLOWED 文件集均未放宽；重钉只是把参照点换成新 feat 提交。`for t in tests/*.js` → `done`，0 FAIL。
- **环境事实**：worktree 缺 gitignore 的 `tools/lume/node_modules`、`bin/qjsc` 与 `tools/emu/.cache`，分别从主仓只读软链（源码零改动，与 r128/r137/r138/r139/r140 同一环境事实）；补齐前 `files_dialog.js` / `spectrum.js` 报 `Cannot find module '../tools/lume/node_modules/esbuild'`，`canvas_prims.js` 报 prelude 快照不等——后者由重生成 `website/playground/prelude.js` 解决（已并入 feat 提交）。emu 日志落 `/tmp/lume-emu-reboot`，构建日志落 `/tmp/r141-build.log`，不进仓。
- **不做消费方 app**：本轮只交绑定 + 契约 + host/emu 断言，不写消费方 app，留后续刀（同 r125→r126 节奏）。真机重启、PMIC 协同、在途状态保全全部 deferred；**不声称真机验证**。commits 拆 feat / test / docs，未推送；收尾删 `firmware/build/`，worktree 净空。未跑 codex review（主控轮负责）。

## r143 / settings Reboot 消费方（纯 app 层，基线 92b6f29）

- **真机重启验收 deferred**：宿主 harness 只证明「两段门 + 守卫 + 调用点」的源码契约，esp32sim 只证明 settings app bundle 能被真实固件 `app eval ok`；**两者都不触发 `lume.system.reboot()`**。硅片复位原因、PMIC 掉电时序、复位延迟、真实串口重枚举均未实测；板级重启验收留接板轮，**不声称真机验证**。
- **两段门参数口径**：复用 r132 OTA setToken 的形状，`rebootConfirm` + `rebootArmTimer`：首拍 `set(true)`、清旧 timer、`setTimeout(..., 3000)` 后 `return`，按钮标题翻为 `Confirm reboot?`；3 s 内第二拍 `set(false)`、清 timer 并调用 reboot，超时回退到 `Reboot`。3 s 与文案是写死的防误触演示值，未在真机上调手感，也无配置面；`rebootNote` 只在守卫未命中时显示 `'reboot n/a'`。参数口径与 r132 保持一致，是有意复用而非遗漏可配置性。
- **reboot 后 USB 断连 / 串口重枚举是预期现象**：调用 `esp_restart()` 会重启整颗 SoC，USB Serial/JTAG 与 Lume 设备枚举必然断开再出现；`lume dev` / `deploy` 正在等待的设备句柄会失效，CLI 报错属预期，不是 app 回归。调用前未持久化 JS 状态即失（见 `.d.ts` `reboot(): never` JSDoc）；本行不代替持久化纪律，也不做优雅停机。
- **防御性 typeof 守卫的取舍**：playground 浏览器 stub 可能没有 `lume.system.reboot` 绑定；`if (!lume.system || typeof lume.system.reboot !== 'function')` 命中时只写 ASCII note 并返回，保证 `sources/settings.js` 在浏览器 eval 不崩。守卫不伪造负错误码（reboot 契约是 `never`，无返回值可判别），与 lume 其它「返回 0/负码」命名空间的有意差异。
- **50→51 清单实证纠偏（任务书前提错误）**：任务书称「settings 在 50-app 清单内」并期待 `PASS bundle settings` 与 `sources/settings.js` 字节一致；实证 `tools/playground/build.mjs` 50 个 app **从无 settings**（`git log -S"'settings'"` 零命中，亦无生成物）。按 r133–r137 先例把 settings 注册为第 51 个 app，并同步 8 个 harness 的 `length === 50`（ota_consumers / weather_sntp / sntp_consumers2 / vec_demo / img_view / archive_view / adc_meter / crypto_check）、`sd_files.js` 的清单变异串、`sntp_consumers.js` 的 NTP row slice 终点（改在 `/* r143 REBOOT ROW BEGIN` 截止，保持原「3 节点」断言语义），以及 `ota_consumers.js` ALLOWED 中预加 `tests/reboot_consumers.js` / 两个 playground settings 生成物（commit 前 untracked 对 `git diff` 不可见，先加防提交后转红）。这些改动只让数量/清单断言继续有效，不改生产行为；`tools/lume/`（CLI 工具面）仍在零 diff 范围内。
- **节点预算与行为范围**：Reboot 行严格 3 节点（View + Text + Button），静态树 ~98→~101，仍在 `LUME_MAX_NODES = 128` 内；`examples/dashboard` 与 `examples/files` 一字未动（范围控制）。固件 / runtime / CLI 零 diff，`git diff 92b6f29 HEAD -- firmware/ runtime/ tools/lume/` 与工作树 diff 均空，故未跑 `idf.py build`。
- **验证与收尾口径**：`tests/reboot_consumers.js` 9 断言 + 9 mutation 全绿（每段门/守卫/字节一致/零 diff 都附反例转红实证）；全量宿主 harness 0 FAIL，staged 后复跑仍 0 FAIL；`npm test` 50/0/0；`check_website.py` 三项 none；`lume check` settings + counter `--no-emu` 均 `RESULT: PASS`；playground `PASS bundle settings 13967 bytes` + 51 sources/apps；可选 emu eval `EMU_EXIT=0` 且 `app eval ok`，串口中 `BLE stack not initialized` / `i2s ... allocate DMA buffer failed` / `no battery connected` 为模拟器环境噪声，非 JS 失败。commits 拆 feat / test / docs，未推送；日志仅留 `/tmp`，worktree 保留 gitignore 软链不进提交。ASCII 纪律全满足；未跑 codex review（主控轮负责）。

## r144 / emu-net WiFi 关联收口（诚实负结果：stock 通、Lume 固件 assoc TX 未触发）

- **根因定性（实证收敛，非猜测）**：同一 esp-emu v1.2.0 / IDF v5.5.5 / `--wifi-auth wpa2-psk` 下 stock station 例程 `got ip:192.168.4.2`（exit 0），Lume 固件 `init PASS` / `connect PASS` 后 `assoc -> init (0x400)`。`RUST_LOG=debug` 显示 Lume 打印 `wifi:m f assoc req l=221` 却无 `WiFi TX triggered`，AP 无 `assoc request received`；stock 同窗口 `subtype=11 auth → subtype=0 assoc → 4-way handshake` 完整。**关联请求帧已构造但未进入 esp-emu 的 WiFi TX 通路**，不是模拟器 AP 限制、不是密码/认证/扫描/省电/配置值问题。`0x400` = ASSOC_EXPIRE（关联响应超时）。
- **穷举排除的候选（全部有原始串口证据）**：config-after-start 顺序、raw `esp_netif_new`+attach 路径、WiFi IRAM opt、SoftAP support、全套 SPIRAM（OCT/80M/FETCH_INSTRUCTIONS/RODATA/USE_MALLOC）、240 MHz CPU、`esp_wifi_set_ps(WIFI_PS_NONE)`、显式 `lume.net.scan()`、延迟 6 s connect、`--wifi-auth wpa2-wpa3`、显式 `--psram-size 8M`、console 模式。6 个 stock 差量变体全 PASS，6 个 Lume 变体全 FAIL。
- **不硬造修复的取舍**：不放宽 runner 的 `--exit-on`/超时换绿灯，不改固件伪造「ALL PASS」。`WIFI_PS_NONE` 固件实验（E10）两段构建完成但无改善，已 `git checkout --` 回退，**不构成固件 diff，故 11 个 app-only 守卫 BASE 不重钉、无需 `idf.py size`**。M4 WiFi OTA 行保持不勾；复验条件（上游 >1.2.0、定位具体子系统、真机接板）逐条写在 r144 报告。
- **runner 失败诊断（infra，零固件改动）**：`tools/emu-net/run.sh` 在 `result != 0` 时写 `failure-diag.txt`：esp-emu 版本、非敏感参数摘要（ssid / auth / net / timeout / exit-on）、**密码仅记长度不记值**（沿用 `prepare.py` credential policy）、固件镜像 sha256、串口 WiFi/NETCHECK 关键行。成功路径行为不变。
- **验证环境事实**：worktree 缺 gitignore 的 `tools/lume/bin/qjsc`、`tools/lume/node_modules`、`littlefs` Python 包（用 `/tmp/lume-r142-py` 的 3.12 扩展，系统 3.11 不兼容），分别软链/设 `PYTHONPATH` 主仓只读物后对齐基线；源码零改动。主仓 `firmware/build/lume.bin` mtime `2026-11-21 09:21:41`，其后 27 提交 lume-net/sdkconfig 零改，可作基线复现。
- **真机与收尾**：所有板级项（WiFi 关联、HTTP、TF、显示、触摸、sleep current、radio）仍 deferred，**不声称真机验证**。stock build/merge_bin、临时 flash.bin、失败实验日志全在 `/tmp`，不进仓；artifacts 仅留最终诊断。ASCII 纪律全满足；未改 vendored（QuickJS/LVGL）、未改 `.d.ts`；commits 拆 infra / docs，未推送；未跑 codex review（主控轮负责）。

## r146 / `lume.ble` 外设-only 消费刀 + M5 Board abstraction 取舍

- **`lume.ble` 只有外设角色，没有 central/scan**：契约（`lume.d.ts:1002-1058`）明确是 NimBLE GATT server——广播「Lume」、NUS-shaped RX write / TX notify、20 字节包上限（ATT MTU 23 − 3）、单连接、无配对/绑定/加密、无 deinit（栈存活到进程结束）。**不存在也造不出「BLE 心率计 central 扫描连接」场景**；本刀按实证纠偏把 hr_monitor 做成设备侧心跳遥测广播器，而非扫描 strap。central 必须订阅 TX notify 才能收到 `write()`。
- **`status()` 负错误码判别口径**：`status()` 成功返回 `BleStatus` 对象、失败返回负数（`-1` bad name/data、`-2` NimBLE driver、`-3` stack/connection state）。app 用 `typeof s === 'object' && s !== null` 判别，负码走 ASCII `status err <code>`；`read()` 三态（string / null / 负码）分别处理，收到包 `.slice(0, 20)` 截断后显示。不用 truthy 测试，避免把负错误码当有效对象。
- **遥测 ASCII 格式口径**：`write()` 发定宽 `'HR ' + ('00' + n).slice(-3)`（如 `HR 072`，6 字节 ≤ 20B），BPM 在 60–99 间循环模拟，`setInterval(sendHr, 1000)` 节流 ≥1s 防刷爆 8 包 FIFO（满时丢最旧包）；只在 `state === CONNECTED && subscribed` 时发。`('00' + n).slice(-3)` 是 ES5-safe 补零，避开 `padStart` 在目标 QuickJS 上的可用性假设。格式与节流值是防误触/防拥塞的演示口径，未在真机调吞吐手感。
- **两段门 + 防御守卫**：广播启停复用 r132/r143 的 arm→3s→return 形状（`toggleArm` + `toggleArmTimer`），首拍只 arm、第二拍才 `start()`/`stop()`，防误触断链。无 BLE 栈（playground/stub）时 `typeof lume.ble !== 'undefined'` 守卫命中即降级为 ASCII note，不调用任何 `lume.ble.*`、不崩。3s 窗口与文案写死，无配置面，真机手感未调。
- **无真机 BLE 验收**：宿主 harness 只证明「两段门 + 守卫 + typeof 判别 + 节流 + 截断」的源码契约；`lume check --no-emu` 只做 esbuild bundle，不跑 eval/layout；playground 是浏览器 stub。**三者都不触发真实 NimBLE 广播/GATT 发现/notify**。广播可见性、连接稳定、notify 吞吐、WiFi+BLE 共存、睡眠电流、与 nRF Connect/Web BLE 的互通全部 deferred 到接板轮，**不声称真机验证**，统一为「模拟器/宿主证据，非真机」。r25 已有的板级待验收项继续有效。
- **51→52 清单口径同步（不改生产行为）**：`tools/playground/build.mjs` 清单从 51 加到 52（hr_monitor 第 52 个）。同步 10 个 harness 的计数断言、`sd_files.js` 清单变异串、`ota_consumers.js` ALLOWED 预加 4 个新文件（commit 前 untracked 不可见，先加防提交后转红）。`tools/playground/` 不在 `tools/lume/` CLI 工具面，故 `firmware/ runtime/ tools/lume/` 零 diff 守卫仍成立；`npm test` 50/0/0、`check_website.py` 三项 none 未回归。
- **Part B（M5 Board abstraction 首刀）deferred，本轮未做**：任务书把 Part B 列为可选且「Part A 完成后才做」。Part A 的核心不变量是固件/runtime 零 diff（本刀 harness 显式断言 `gitChanged(['firmware/','runtime/','tools/lume/']).length === 0`）；为 Part B 新增 `firmware/components/lume-board/{include/lume_board.h,lume_board.c}` + CMake 注册会让该守卫及多个存量 app-only 守卫转红，触发多 harness 基线重钉级联，且必须跑全量 `idf.py build`/`size`（IRAM 16384 硬线 + 磁盘紧张）。两者属互斥验证路径（任务书验证项 7 vs 8）。按「都允许只完成部分」口径，Part B 留独立固件刀；本轮 firmware/ runtime/ 零改动，未跑 `idf.py build`。
- **验证与收尾口径**：`tests/hr_monitor.js` 12 断言 + 12 mutation 全绿（守卫/门/typeof/节流/截断/字节一致/零 diff 都附反例转红实证）；全量 83 个宿主 harness 0 FAIL；`npm test` 50/0/0（从主仓拷贝 gitignore 的 `bin/qjsc` 只读构建物对齐基线，源码零改动）；`check_website.py` 三项 none；`lume check` hr_monitor + counter `--no-emu` 均 PASS；playground `PASS bundle hr_monitor 3397 bytes` + 52 sources/apps。commits 拆 feat / test / docs，未推送；实验产物仅留 `/tmp`，仓库只进源码 + docs。ASCII 纪律全满足；未改 vendored（QuickJS/LVGL）、未改 `.d.ts`；未跑 codex review（主控轮负责）。

## r147 / M5 Board abstraction 首刀：`lume-board-hal` 运行时单例桩

- **任务书路径与基线冲突（实证纠偏）**：任务书要求新增 `firmware/components/lume-board/{include/lume_board.h,lume_board.c,CMakeLists.txt}`，但三者**在基线 4155d15 已存在且 git 跟踪**：`lume-board` 是 r27/r44/r45 收口的板级驱动组件（`lume_board_init` / I2C / LVGL / 显示 / 触摸 / PMIC / `lume_pins.h`），且已在 `firmware/main/CMakeLists.txt:4` 的 REQUIRES 中。按原路径写会覆盖工作固件并违反「不改任何既有文件」。按意图改为新建同级组件 `firmware/components/lume-board-hal/`（头/实现名 `lume_board_hal.h` / `.c`，符号名仍为 `lume_board_t` / `lume_board_get` / `lume_board_not_supported`），现有组件零改动。M5 Board abstraction checkbox 不勾。
- **编译期 profile 与运行时 HAL 的分工（桩语义）**：`firmware/boards/<board>/lume_board_profile.h` + Kconfig `choice LUME_BOARD` **仍是 pins / geometry / panel init 表 / touch mapping 的唯一参数真源**；本组件只是在其上叠一层稳定的 vtable 形状单例，供未来第二板或运行时探测填充。当前无消费方、无 profile include、无 ESP/LVGL 依赖（头仅 `<stdint.h>`），四个 op 全返回 `-1`（`LUME_BOARD_ERR_NOT_SUPPORTED`），`board_id = "generic"`。四个指针指向同一 `lume_board_not_supported` 桩的四个带类型 face，避免函数指针互转 UB。**不推翻编译期 profile，不做运行时切换**。
- **four-op 接口的最小性**：只取 panel init / touch init / touch read / power init 四个形状，映射现有驱动调用（`lume_display_init` / `lume_touch_init` / 点读 / `lume_pmic_display_power_on`）。刻意不纳入 I2C bus 创建、LVGL tick、capture、音频、IMU、存储——那些是现有 `lume-board` 的职责，重复建模只会制造第二真源。参数用 `void *` 擦除 ESP/LVGL 类型以换宿主可编译性；`int` 错误码沿用 `lume.*` 硬件 API 的 0/负码约定。
- **ESP-IDF 自动发现实证**：`tools/cmake/build.cmake:532-533`「If not specified, all components known to the build system are processed」+ `component.cmake:445 idf_component_register`；新组件无需 main REQUIRES 即被编译。构建日志 `[100%] Built target __idf_lume-board-hal` 与 `liblume-board-hal.a`（8214 B）为证。因无引用方，目标文件未进链接闭包，**镜像尺寸与 r141 基线逐字节一致（Flash Code 2041288 / Flash Data 853292 / DIRAM 247491 / IRAM 16384 Remain 0 / Total 3036351，增量 0 B）**；这不是「桩无效」，而是纯增量编译的证据。IRAM 16384 硬线未破。
- **宿主 harness 取舍**：优先 C 编译型断言 `tests/board_abi.c`（freestanding 头，`_Static_assert` 锁 4 个前导函数指针 + `board_id` 尾字段布局与尺寸，运行时验单例/四 op 返回 -1），`tests/board_abi.js` 作 node 入口（源码 token + 零改动守卫 + gcc 编译运行 C）。未退化为纯源码正则脚本，因为新头确实可在宿主隔离——与 `tests/board_175c_profile.c` 先例同型。
- **零改动守卫与存量 harness 的 BASE 重钉（主控合并时处理）**：本轮验证按任务书顺序在**提交前**跑（新文件 untracked，`git diff` 不可见），故 `git diff 4155d15 HEAD -- ':!firmware/components/lume-board' ':!tests/board_abi.*' ':!docs'` 原始输出为空（`GUARD_EXIT=0`）；附加排除新同级组件的版本亦空。需明示：13 个存量 app-only harness 以 `git diff --name-only <old-BASE> HEAD -- firmware/...` 断言固件零 diff / 仅允许已知文件（`adc_meter` / `archive_view` / `crypto_check` / `hr_monitor` / `img_view` / `ota_consumers` / `reboot_consumers` / `sd_files` / `sd_gallery` / `sntp_consumers` / `sntp_consumers2` / `vec_demo` / `weather_sntp`），待 r147 提交落 HEAD 后会转红（已复跑实证：`FAIL` 恰为这 13 个），需主控按 r143/r146 先例把这些 BASE / allowlist 重钉到 feat 提交 `6176790`（即新组件落地的那个 commit）。本轮未改这些 harness 的 BASE，以免突破「零既有改动」与守卫口径；`tests/board_abi.js` 自带扩展守卫（额外排除 `lume-board-hal`），故提交前后均绿。
- **验证与收尾口径**：`node tests/board_abi.js` 15 条全绿（`ALL CHECKS PASSED`）；全量 `tests/*.js` 0 FAIL；`npm test` 50/0/0；`check_website.py` 三项 none；`lume check examples/counter --no-emu` PASS；`idf.py build` / `idf.py size` 均 exit 0。build 后磁盘 91%，`rm -rf firmware/build` 后回到 90%，日志仅留 `/tmp/lume-r147-*.log`。真机显示/触摸/第二板探测/sleep current/radio 全部 deferred，**不声称真机验证**，统一为「编译/宿主证据，非真机」。ASCII 纪律全满足；未改 vendored（QuickJS/LVGL）、未改 `.d.ts`；commits 拆 feat / test / docs，未推送；未跑 codex review（主控轮负责）。

## r148 / M5 Component library 第二片：`shell.Keyboard` 软键盘（runtime/ + 纯 app 层）

- **无真机触控手感验收**：宿主 harness 只证明键位节点、`Button` press → `onPress` 回调路由、40 px 几何下限与 dispose 链；`lume check --no-emu` 只做 esbuild bundle，不做 eval/layout/perf。真实触摸命中率、误触、连打、长按、AMOLED 圆屏边角遮挡、戴手套/湿手手感全部未实测；键尺寸 40–128 px / gap 0–32 px 是源码契约而非调参结果。板级验收 deferred，**不声称真机验证**。
- **键位布局取舍**：采用 QWERTY 三排 10 / 9 / 7 + `SPACE` / `BKSP` / `ENTER`（ASCII 键名，r64），纯 `Button` + `View` 原语、不进 prelude、不动原生 ATTR ID。`theme.spacing` 作为键间距默认值，但在 480 px 屏的十列布局上夹到 `maxGap = floor((width - 10*40)/9) = 8`，否则 10 × 40 px 触控下限会溢出；显式 `gap` / `keySize` / `style` 可覆盖，越界即报错（`keySize` 必须 40..128、整数）。`SPACE` 宽 4 键 + 3 间距，其尺寸随 `keySize`/`gap` 推导；更宽屏或异形屏的排布没有做自适应调参，只保证宽度参数可显式传入。没有中文/符号/数字页、候选词、Shift/大小写切换——只覆盖 Wordle 类 ASCII 字母 + 空格输入的最小面。
- **Wordle 完整解锁仍缺什么**：本刀只把「无键盘组件」这一缺口部分解锁（P2 表 Wordle 行仍 🔴、不勾）；完整消费仍需：真实 Wordle app（字典、6×5 网格、颜色反馈、每日一题状态）、对 ASCII 字母以外的输入语义（大小写、标点、复制粘贴/IME）的取舍、真机输入手感与圆屏安全区验收，以及 M5 Component library 整体的接板验收。`examples/keyboard_demo` 只是最小单行输入示例，不是词游。
- **runtime/ diff 与 BASE 重钉（断言不放宽）**：本轮是 M5 shell 组件刀，`runtime/shell.js` / `runtime/types/lume.d.ts` / `website/api.html` 合法变更（shell.js 由 CLI 打包，prelude 未动）；13 个 app-only harness 的 `firmware/ runtime/` 零 diff / allowlist 守卫因此转红，test commit 把 BASE 从 r147 的 `6176790` 重钉到本轮 feat `bbd8627` 并刷新注释，零 diff 断言语义完全保留（未改成自比较、未删守卫）。重钉前全量实证 FAIL 清单 14 项，重钉后 0 FAIL。
- **`board_abi.js` 存量守卫修复**：该 harness 的零 diff 守卫仍钉在 r146 merge `4155d15`，r147 重钉 13 个 app-only harness 后已在基线 `dafa1ed` 转红；且 diff 体积超过 Node 默认 `maxBuffer` 直接 `ENOBUFS`。本轮把它改以 `dafa1ed` 为参照、显式排除本轮合法落地面（runtime/、website/、examples/、tools/、tests/、docs/）并提高 maxBuffer；两板组件之外的任何 firmware 变化仍会转红，不是把守卫改成自比较。属存量债务清理，不改变生产固件。
- **清单/ALLOWED 口径（不改生产行为）**：`tools/playground/build.mjs` 清单 52→53（`keyboard_demo` 第 53 个），同步 10 个 harness 计数断言、`sd_files.js` 清单变异串、`ota_consumers.js` ALLOWED 预加新文件（commit 前 untracked 对 `git diff` 不可见，先加防提交后转红）。`website/playground/apps/files.js` 因内嵌 shell.js 随组件变更重生成，属预期；`examples/files` 源文件未动。
- **验证与收尾口径**：`tests/keyboard_demo.js` 13 静态 + 8 live + 16 mutation 全绿；全量 85 个宿主 harness 0 FAIL；`npm test` 50/0/0（新 worktree 缺 gitignore 的 `bin/qjsc`，从主仓拷贝只读构建物后对齐基线，源码零改动）；`check_website.py` 154 entries、三项 none，`gen_api_docs.py --check` 新鲜；`lume check` keyboard_demo + counter `--no-emu` 均 `RESULT: PASS`；playground 53 sources/apps。`git diff dafa1ed HEAD -- firmware/`、工作树 firmware diff、prelude `lume_scripts.c` diff 均空，故**未跑 `idf.py build`**（shell.js 是 CLI 打包 JS、`.d.ts` 是类型契约，均不进固件构建），IRAM 16384 硬线未触碰。未改 vendored（QuickJS/LVGL）；commits 拆 feat / test / docs，未推送；实验产物只留 `/tmp`；未跑 codex review（主控轮负责）。

## r149 / 完整 Wordle app（shell Keyboard 首个真消费刀）

- **无真机输入手感验收**：宿主 harness 只证明 QWERTY 键节点、真实 `Button` press → `onKey` / `onBackspace` / `onSubmit` 路由、键尺寸下限与 dispose 链；`lume check --no-emu` 只做 esbuild bundle，不跑 eval/layout/perf；playground 是浏览器 stub。真实触摸命中率、连打误触、长按、AMOLED 圆屏边角与安全区遮挡、戴手套/湿手手感**全部未实测**；`keySize:40 / gap:0 / y:300` 是为了让十列在 480 px 内落下的布局取值，不是手感调参结果。板级验收 deferred，**不声称真机验证**。
- **键级染色缺口与替代呈现（如实登记）**：`runtime/shell.js` 的字母键背景固定 `color('surface', '#132435')`，`Keyboard` 没有 per-key background / 状态注入口；本轮坚持**纯 app 层、不改 runtime**。已用字母的最高反馈态改由键盘上方自绘 26 字母状态条呈现（G > Y > X 优先，颜色与格子反馈一致；未用字母用灰色）。代价：字母态没有直接染在物理按键帽上，视觉上与键盘分离；若后续要真键帽染色，需另起 runtime/ 刀扩 `Keyboard` API 并回归 r148 harness（本轮未做）。
- **字典规模与猜测表取舍**：内嵌 300 个常见 5 字母 ASCII 词（200–400 建议区间内，均匀覆盖 A–Z），答案表与**可接受猜测表合并**——非表内 5 字母串提交返回 `invalid` 且不扣次数。没有单独的更大 allowed-guess 表（真实 Wordle 允许更多合法猜测词）、没有每日一题/固定种子（随机取词，无 RTC 依赖）、没有多语言与键盘 IME/粘贴。好处是 bundle 仅 22,571 B（远低于 256 KiB 热更新硬上限）、判定与 harness 可穷举；代价是偶尔会遇到「是合法英文词但不在 300 表内」而被拒的输入，属已知取舍而非 bug。
- **胜负结算与 KV 口径**：结算用原生 `Text` HUD 行（`WIN IN n - TAP NEW` / `LOST - WORD - TAP NEW`）+ 常驻 `NEW` 按钮，**不是模态 Dialog**（无遮罩/无焦点管理），避免引入额外节点与 dispose 复杂度。`hisc.wordle` 记**最长**连胜、`wordle.cur` 记当前连胜（均 ≤15 字符，NVS 上限实证于 `lume.d.ts:631-674`）；读值只接受非负 number，所有读写包 `try/catch`，NVS 不可用时退化为易失记录。真机断电持久性 deferred。
- **canvas 预算独立口径**：单画布 `480x228=109,440 px`，≤ 全帧缓冲 `480x480=230,400 px`；上方 HUD 为原生 `Text`、下方键盘为 shell 节点，均不占画布预算。watchface 五面 228,544 px 是**另一个 app** 的预算口径，不与本 app 混算。harness 断言画布面积、网格与字母条边界、以及每帧脏矩形都在画布内。5x7 字形预计算为 run-length spans（26 个，eval 时一次解码，`spanBuilds` 稳定不变），绘制走硬边整数 `fillRect`（无 AA）。
- **纯 app 层与守卫**：固件 / prelude / runtime / CLI 零 diff（`git diff ca4ba35 HEAD -- firmware/ runtime/` 为空），未跑 `idf.py build`。13 个 app-only 零 diff 守卫与 `board_abi.js`（已含 `:!artifacts/`）全绿，**未重钉 BASE、未放松任何断言**；`ota_consumers.js` 的 `allChanged` allowlist 在 test commit 前预加 4 个新路径，防 untracked 提交后转红。清单 53→54，11 个 harness 计数断言 + `sd_files.js` 变异串同步。校验：`node tests/wordle.js` 全绿（含 10 条 mutation 反例）、全量宿主 harness 0 FAIL、`npm test` 50/0/0、`check_website.py` 三项 none、`lume check` wordle/counter `--no-emu` 均 PASS、playground 54 apps。测试 scratch `artifacts/r82/` 已清除，临时产物只留 `/tmp`。ASCII 纪律全满足；未改 vendored；commits 拆 feat / test / docs，未推送；未跑 codex review（主控轮负责）。

## r151 / M5 Component library 第三片：`shell.Switch` / `shell.Slider` / `shell.Progress`

- **无真机触控/渲染验收**：宿主 harness 只证明三控件的节点结构、受控回调路由、40 px 下限、pan→值域/step 映射、`ATTR_WIDTH` 更新与 dispose 链；`lume check --no-emu` 只做 esbuild bundle，不跑 eval/layout/perf；playground 是浏览器 stub。真实触摸命中率、Slider 拖动手感、误触、长按、AMOLED 圆屏边角与安全区遮挡、戴手套/湿手手感**全部未实测**。板级验收 deferred，**不声称真机验证**。
- **Slider 实现路线（实证后定，未降级）**：任务书允许「若 pan 在 Canvas 上命中/坐标换算有坑则降级 Button 步进」。实证 prelude 中 Canvas 是普通 numeric node id（`lume.createNode(NODE_CANVAS,...)`），`lume.gesture.on(canvas, 'pan')` 直接 `setGestureEvent(id)` 可用；`pan` 的 `dx/dy` 是相对按下点位移，映射无坑。故按首选路线落地 Canvas+pan，未做 Button +/- 降级。Canvas 预算 432×40=17,280 px（默认），远低于 480×480 全帧 230,400 px；画布数量随 app 独立核算，不与 watchface 等混算。piano 先例的「透明 View 覆盖层 + 绝对 e.x」是多个 key 子元素时的做法，单 Slider 无此需要，留作未来异形命中复核的备选。
- **拖动回调口径：每 pan 但仅在量化值变化时发**：`panstart` 捕获当前值，`pan` 按 `startValue + dx*(max-min)/width` 映射后取整到 `step`；只有量化结果与上一次不同才发 `onChange`，`panend` 只结束拖拽、不补发。这样既有实时反馈又避免每帧抖动（step=5 时 4 帧落在同一 5 单位桶只发 1 次）。代价：`pan` 事件本身仍由 LVGL 节流决定，真机频率未测；若后续要「panend 才发」的省电口径，需改 JSDoc 与 harness 的「每步一次」断言。
- **`dx` 而非绝对 `x` 的坐标口径**：`e.dx` 是位移（实证 `__gestureStep` 的 `dx = inp.x - s.sx`），故可从任意按点起拖、不要求先在轨道上按下起点；代价是 tap 到轨道某处不会直接跳值（本控件只实现拖动改值，未做 tap-to-set，未做键盘步进）。
- **Progress 只改宽度 ATTR 的局限**：填充 View 的 `width` 绑定 `Math.round(fraction()*width)`，经 `__bindNumeric` 只写 `ATTR_WIDTH=2`，无 Canvas、零像素预算、owned effect 随节点回收。局限：只有「从左往右填充」一种形态，不支持环形/垂直/不定(indeterminate)进度；label 是兄弟 Text（置于条上方 y-24，因负 y 像素属性非法），不是条内嵌字；圆角随 `height/2` 推导，未做主题 token 化。
- **Switch 受控视觉**：轨道/滑块两个 View，滑块 `x` 绑定信号函数实现移动；颜色走 theme token（accent / surfaceAlt / text）。局限：没有过渡动画（未用 `lume.anim`）、没有自定义 on/off 色注入口、没有禁用态；`labelWidth` 固定 200 px，长文案会截断。`height` 40..128 是触控下限契约而非手感调参结果。
- **gesture 注销的实证后果（写进 harness 断言）**：`lume.gesture.on` 返回的函数做的是从 handler 列表 `splice(cb)`；宿主实证「dispose 不调注销函数 → 随后派发 pan 仍触发 onChange（bright 50→60）」，调了则不触发。故三组件的 gesture 订阅全部在 `cleanups[id]` 中注销；Slider cleanup 同时 `lume.removeChild(canvas)`（r148 全节点移除纪律），dispose 幂等。
- **runtime/ diff 与 BASE 重钉（断言不放宽）**：本轮合法改 `runtime/shell.js` / `runtime/types/lume.d.ts` / `website/api.html`（shell.js 由 CLI 打包、prelude 未动），15 个 runtime/firmware 守卫 harness 的零 diff 断言因此转红；test commit 把 BASE 从 r148 feat `bbd8627` 重钉到本轮 feat `d49fb81` 并刷新注释，零 diff / allowlist 语义完全保留（未自比较、未删守卫），重钉后全量 0 FAIL。固件 / prelude / vendored 零改动，未跑 `idf.py build`，IRAM 16384 硬线未触碰。
- **清单/ALLOWED 口径（不改生产行为）**：`tools/playground/build.mjs` 54→55（`controls_demo` 第 55 个），同步 12 个 harness 计数断言与 `sd_files.js` 变异串；`ota_consumers.js` ALLOWED 在 test commit 前预加 4 个新路径，防 untracked 提交后转红。另修正 `keyboard_demo.js` 一条因新组件复用同款 cleanup 字符串而退化的 mutation 反例（改为移除全部同型串），保持其 load-bearing。
- **验证与收尾口径**：`tests/controls_demo.js` 13 静态 + 10 live + 13 mutation 全绿；全量 87 个宿主 harness 0 FAIL；`npm test` 50/0/0；`check_website.py` 157 entries、三项 none，`gen_api_docs.py --check` 新鲜；`lume check` controls_demo/counter `--no-emu` 均 `RESULT: PASS`；playground 55 sources/apps。`git diff 31adb96 -- firmware/` 与 prelude diff 均空，故未跑 `idf.py build`。ASCII 纪律全满足；未改 vendored；commits 拆 feat / test / docs，未推送；实验产物只留 `/tmp`；未跑 codex review（主控轮负责）。

## r153 / M5 Component library 第四片：`shell.Keyboard` per-key 状态染色 + wordle 真键帽消费

- **无真机触控/配色验收**：宿主 harness 只证明键帽背景经 `ATTR_BG_COLOR` 正确写入、按键 press 路由、缺省色与 dispose 链；`lume check --no-emu` 只做 esbuild bundle，不跑 eval/layout/perf；playground 是浏览器 stub。三种键帽色（`#166B3E` / `#8A6A12` / `#30343E`）与键帽默认文字色的对比度、真实触控命中率、误触/连打、AMOLED 圆屏边角与安全区遮挡、戴手套/湿手手感**全部未实测**。板级验收 deferred，**不声称真机验证**。
- **keyStates 形状取舍**：选「小写字母 → `'hit'|'present'|'miss'`」语义枚举（对象或返回该对象的信号 getter），而非直接注入 `#RRGGBB`。理由：把 Wordle 三态的语义留在公共 API（`.d.ts` JSDoc 写明 hit=绿/right slot、present=黄/wrong slot、miss=灰/absent），颜色由 shell 统一持有，app 不重复配色；代价是 `KEY_STATE_TINTS` 硬编码这三个 hex 与 wordle 格子填充同色，别的 app 若要自定义键帽色需另加 token/覆盖口，本轮未做。键名与 `onKey` 一致用小写（大写键 / 数字 / `ENTER` 等未知项一律忽略），控制键 `SPACE`/`BKSP`/`ENTER` 永不染色（`BKSP` 保持 `danger`、`ENTER` 保持 `accent`）。传对象时只染一次、无响应式；传信号 getter 时每个字母键各有一条 owned effect，状态发布只重写该键 `ATTR_BG_COLOR`（实证 26 条背景写、0 次 `create`，不重建节点）——代价是 26 条 effect 在每次发布都会各跑一次，只是未变色键的值不变，未做「只遍历变化键」的差量优化。
- **字母态条移除后的视觉代价**：r149 的键盘上方 26 字母自绘状态条已删除（连同 `BAR_Y/BAR_H/BAR_CELL`、`COL.RING`、`paintBar`）；实测该条以大写 `ALPHABET` 查询小写 `wdLetterMarks` 映射，本就长期呈默认色（潜在大小写失配），其「反馈」断言由格子边框亮色间接满足。移除后反馈只出现在物理键帽上：优点是态与键一体、无独立条带；代价是失去一行紧凑的 26 字母总览，已猜字母的态分散在 QWERTY 布局中，眼睛需在键盘上定位而非扫一行；未补偿任何替代总览 UI。
- **r148 harness 回归口径（断言不放宽）**：本轮合法改 `runtime/shell.js` / `runtime/types/lume.d.ts`，15 个 runtime/firmware 守卫 harness（13 app-only + `controls_demo` + `keyboard_demo` + `wordle`）的零 diff 断言转红（`board_abi.js` 因显式排除 `runtime/` 始终绿）；test commit 把 BASE 从 `d49fb81` 重钉到本轮 feat `0d1111c`，零 diff / allowlist 语义完全保留，未改成自比较、未删守卫。`tests/keyboard_demo.js` 保留其 r148 键位/回调/40 px/dispose 断言（本轮仅刷新 BASE 与注释），新增 `tests/keyboard_states.js` 专测染色路径，二者互补：`keyboard_demo` 证「r148 键盘契约不变」，`keyboard_states` 证「r153 注入路径与反例转红」。`tests/wordle.js` 的字母条断言改为 keyStates 传递断言（语义不放宽：改为检查 G/Y/X→hit/present/miss、键帽 `ATTR_BG_COLOR` 与 NEW 清空）。`ota_consumers.js` ALLOWED 在 test commit 前预加新 harness 路径防 untracked 转红；固件/prelude/vendored 零改动，未跑 `idf.py build`。
- **验证与收尾口径**：`tests/keyboard_states.js` 9 静态 + 8 mutation + 7 live + 2 live-mutation 全绿；`tests/wordle.js` 21 逻辑/live + 10 静态 + 11 mutation 全绿；全量 88 个宿主 harness 0 FAIL；`npm test` 50/0/0；`check_website.py` 157 entries、三项 none，`gen_api_docs.py --check` 新鲜；`lume check` wordle（27422 B）/counter（2160 B）`--no-emu` 均 `RESULT: PASS`；playground 55 sources/apps，`git diff ba5156e -- firmware/` 与 prelude diff 均空，故未跑 `idf.py build`。ASCII 纪律全满足；未改 vendored（QuickJS/LVGL）；commits 拆 feat / test / docs，未推送；实验产物只留 `/tmp`；未跑 codex review（主控轮负责）。

## r157 / r151 shell 三控件的第一个消费刀：timer_kit 倒计时+秒表（纯 app 层）

- **无真机触控/计时精度/响听听感验收**：宿主 harness 跑真 app + 真 prelude，但时钟是注入的假 `lume._systemTime`，`press`/`gesture` 是宿主派发，`lume check --no-emu` 只做 esbuild bundle（不跑 eval/layout/perf），playground 是浏览器 stub。真实 Slider 拖动手感、Switch/LAP 命中率、误触、AMOLED 圆屏边角与安全区遮挡、戴手套/湿手手感、gettimeofday 在 SNTP 前后的真实跳变、蜂鸣器实际听感与音量**全部未实测**。板级验收 deferred，**不声称真机验证**，统一为「宿主/编译证据，非真机」。
- **`lume.system.now()` 不存在（简报纠偏）**：`runtime/types/lume.d.ts` 只有 `lume.system.time()`（`:451`，prelude `lume_scripts.c:471` 转 `lume._systemTime()`），两者都是毫秒、都读 gettimeofday；`Date.now()` 是等价的全局入口。app 统一用 `tkNow()` 包 `lume.system.time()`，好处是 harness 可覆盖 `lume._systemTime` 注入假时钟。原简报的 `now()` 若真写进代码会在 `lume check` 的未知成员扫描与实机 eval 中失败。
- **计时精度口径（绝对时基差值，非 tick 计数）**：`lume.system.setInterval` 在 prelude 里由 20 ms 引擎队列驱动的 `__lume_tick` 触发，且跳过 missed periods（`lume_scripts.c:501`），若用 `setInterval` 累加计数会系统性漂移。本 app 的倒计时 `left = max(0, endAt - tkNow())`、秒表 `elapsed = swAccum + tkNow() - swStartAt()` 都是绝对时间差；显示精度 10 ms（`mm:ss.cc`）来自 `Math.floor(ms/10)%100`，是**格式化分辨率**而非硬件计时精度，真机晶振误差与 SNTP 跳变 deferred。TICK_MS=100 只是刷新节奏，不是时基。
- **暂停语义取舍**：暂停时 `cdPausedMs = max(0, endAt - tkNow())` / `swAccum += tkNow() - swStartAt()`，恢复时把锚点重设为 `tkNow() + 快照`；暂停期间推进的墙钟时间被完全排除。另一处防御：`tick()` 在 `!running()` 时直接返回，避免引擎排空与 pause 竞态时残留 tick 改写冻结读数。代价：暂停/恢复各读一次 `lume.system.time()`，若恰好跨过 SNTP 校时瞬间会出现一次阶跃，未做单调时钟补偿（真机场景 deferred）。
- **best 记录口径取舍**：`hisc.timer` 记「真正走到 0 的倒计时中最短的设定分钟数」——完成 1 分钟即写入 1，之后更长的完成不会覆盖；中途 RESET 不记。这是可证、可复现的口径，但「最短」意味着记录值越小越难被刷新，与常见「最长坚持」直觉相反，已写进 JSDoc 与 harness。`timer.best` 记「START → 3 次 LAP 且用时 ≤60 s 的秒表钻」的 ms 值（第 3 次 LAP 才结算，更小更好）；固定 3-LAP 是人为约定的口径，不是秒表硬件自带语义；若主控认为牵强，可只保留 `hisc.timer` 单键而删掉本键（对应 harness 断言需同步）。两键均 10 字符（NVS 上限 15），读只接受非负有限 number，读写全包 try/catch，NVS 不可用退化为易失记录，真机断电持久性 deferred。
- **画布预算锁（非「零 canvas」）**：简报偏好零 canvas，但 `shell.Slider` 本体就是 `Canvas`（`runtime/shell.js:457`），消费它不可能零画布。实证唯一画布为 Slider 的 432×40=17,280 px，`≤ 230,400 px`（480×480 全帧），无环形进度、无自绘表盘；其余 UI 全是 View/Text/Button。harness 同时断言画布数量恰为 1、面积恰为 17,280、预算常量 230,400，改大即转红。
- **隐藏面板的取舍**：非活动模式面板通过绑定 `x` getter 移到屏外（x=1000）。`__pixel` 拒绝负值，故不能用 -1000；x=1000 在 480 屏外，真机不可触。代价：面板节点仍驻留、仍订阅 signal effect（两个面板共约 30 个节点），未做按模式的节点销毁/重建；`__lume_shutdown()` 仍全量回收，harness 已证 effects/timers 归零。
- **清单/级联口径（不改生产行为）**：`tools/playground/build.mjs` 56→57（timer_kit 第 57 个），同步 13 个 harness 计数断言与文案（简报列举的 14 个里 `shell_components.js:18` 的 56 是 IconButton 高度 attr，非清单计数，未动）；`sd_files.js` 清单变异串追加 `'timer_kit'`；`ota_consumers.js` ALLOWED 在 commit 前预加 4 个新路径防 untracked 提交后转红。
- **基线存量红灯（非本轮引入，如实登记）**：干净主仓 `6426f7b` 上全量 `tests/*.js` 已有 17 个 FAIL（13 个 app-only 计数守卫 + `keyboard_states` / `sd_files` / `sd_gallery` / `sntp_consumers`），根因是 r151/r153 改了 `runtime/shell.js` 与 `runtime/types/lume.d.ts`，而这些守卫的 BASE 仍钉在更早提交；`git diff --name-only ba5156e 6426f7b -- firmware/ runtime/ tools/lume/` 实证两文件变更。按「先查是否越界、确认清单计数类才同步、断言语义绝不放宽」的纪律，本轮**不重钉 BASE、不放宽断言**；改前/改后 FAIL 集合逐项一致，新增 `tests/timer_kit.js` 全绿，新增 FAIL 为 0。简报验证项 2 期望的「0 FAIL」与基线实况冲突，以实证为准。
- **验证与收尾口径**：`tests/timer_kit.js` 19 静态 + 18 静态 mutation + 10 live + 3 live mutation 全绿，末行 `ALL TIMER KIT HARNESS CASES PASSED`；全量 92 个宿主 harness 的 FAIL 集合与基线逐项一致（17 存量红灯 + 0 新增）；`npm test` 50/0/0；`check_website.py` 158 entries、missing/invented/duplicates/signatures 四类均 none；`lume check` timer_kit（25583 B）/counter（2160 B）`--no-emu` 均 `RESULT: PASS`；playground 57 sources/apps；`git diff 6426f7b HEAD -- firmware/ runtime/ tools/lume/` 原始输出为空（`.d.ts` 未动），故未跑 `idf.py build`，IRAM 16384 硬线未触碰。磁盘紧张，临时产物只留 `/tmp`，未清主仓 build/。ASCII 纪律全满足（全文件非 ASCII 字节 0，字号仅 14/20/32）；未改 vendored（QuickJS/LVGL）；commits 拆 feat / test / docs，未推送；未跑 codex review（主控轮负责）。

## r159 / 三个零消费 shell 组件的首个消费刀：control_center 控制中心（纯 app 层）

- **无真机触控/背光/radio 验收**：宿主 harness 跑真 app + 真 prelude + 真 `runtime/shell.js`，但 `press` 是宿主派发、`lume check --no-emu` 只做 esbuild bundle（不跑 eval/layout/perf），playground 是浏览器 stub。IconButton / Card 的真实触摸命中率、误触、戴手套/湿手手感、AMOLED 圆屏边角与安全区遮挡**全部未实测**。板级验收 deferred，**不声称真机验证**。
- **WiFi / Bluetooth 是模拟态，不是真实 radio**：状态只存在于本地 signal，只经 `lume.storage.kv` 持久化；app **从不调用** `lume.net.*` / `lume.ble.*`。accent 背景色变化仅表达 UI 开关感，不代表 ESP32 已连接 AP 或已广播 BLE。真机联网/广播、失败重试、状态回读 deferred。
- **亮度是分档 UI，无真实背光联动**：`BRT 1..5` 只是 app 内的信号与 KV 记录，不写 PMIC/背光寄存器，CO5300 屏亮度和功耗不受影响；波形条宽度（`brt()*24`）是视觉映射，不是线性 gamma 校准。音量 `VOL 0..10` 同理，不调 `lume.audio.setVolume`。
- **循环步进无滑动手感**：音量/亮度靠 tap 卡片 `+1` 并回绕（10→0 / 5→1），没有 Slider 的 pan 拖动、惯性或长按连续调。这是刻意的差异化选择：Slider/Progress/Switch 是 r157 timer_kit 的消费点，本轮避免两个 app 同质化；代价是没有连续拖动手感、无法一次跨多档。
- **零 Canvas 实证而非假设**：逐行读 `runtime/shell.js`，`Card`（:62-68）是 `View` 包装、`IconButton`（:69-75）是 `Button` 包装、`SafeArea`（:153-178）是 `View` 包装，三者都不分配 Canvas；app 实跑 21 个 `create` 节点中 `kind=3` 为 0。上一刀 timer_kit 的「画布预算锁」口径（Slider=17,280 px）在本轮不适用，harness 直接断言零画布。
- **安全区几何与卡片压缩取舍**：`safeInsets('round',480)` 得 top=70/right=71/bottom=71/left=70、内接方形边长 339。为在 339 px 内放下标题 + 2×2 卡片 + RESET，卡宽 163、卡高 122，并用 `padding:8/gap:4` 覆盖 Card 默认 `padding:16/gap:12`；Card 的 surface 背景、12 px 圆角、column flex 仍继承。代价是卡片内边距比 shell 默认值紧，文字/按钮间距偏紧凑；真机观感 deferred。harness live 断言无 safe-bounds warning。
- **KV 口径与失效退化**：四键 `cc.wifi`/`cc.ble`/`cc.vol`/`cc.brt`（6..7 字符 ≤ NVS 15 上限）；flag 只接受 number `0|1`，step 只接受 `[lo,hi]` 内整数，其它值（含负错误码、字符串、NaN）一律回落默认；get/set 全包 try/catch，NVS 抛异常时退化为易失默认值、UI 仍可操作但不持久。真机断电持久性与 NVS 满盘行为 deferred。
- **dispose/cleanup 链的边界**：三个被消费组件本身**不注册** `cleanups[id]`（与 Switch/Slider/Progress 不同），所以本 app 没有自定义清理器；WiFi/BT 按钮的 accent 背景是 prelude 的 owned effect，harness 实证 `lume.ui.shell.dispose(btn)` 安全、`__lume_shutdown()` 后 `__allEffects.length=0` 且 `__timers` 为空。没有 gesture 订阅需要注销（本 app 不用 pan/swipe）。
- **级联口径与实证纠偏**：`tools/playground/build.mjs` 57→58（`control_center` 第 58 个）；简报写「13 个 harness 计数」，实证 `grep` 为 **14 处**实际计数断言，已逐个同步，未误改 `shell_components.js:18` 的 56（IconButton 高度 attr）；`sd_files.js` 变异串精确追加 `'control_center'`；`ota_consumers.js` ALLOWED 在 commit 前预加 4 个新路径防 untracked 提交后转红。firmware/runtime/tools 零 diff，**未重钉任何 BASE**，断言语义未放宽；改前/改后全量 suite 均 0 FAIL。
- **验证与收尾口径**：`tests/control_center.js` 21 静态 + 19 静态 mutation + 8 live + 3 live mutation 全绿，末行 `ALL CONTROL CENTER HARNESS CASES PASSED`；全量 `tests/*.js` 0 FAIL；`npm test` 50/0/0；`check_website.py` 158 entries、missing/invented/duplicates/signatures 均 none；`lume check` control_center（23510 B）/counter（2160 B）`--no-emu` 均 `RESULT: PASS`；playground 58 sources/apps，二次构建 md5 三项 OK；`git diff 76d2c0c HEAD -- firmware/ runtime/` 与工作树版均空，故未跑 `idf.py build`，IRAM 16384 硬线未触碰。磁盘紧张，测试 scratch 已清除、临时产物只留 `/tmp`，未清主仓 build/。ASCII 纪律全满足（全文件非 ASCII 字节 0，字号仅 14/20/32）；未改 vendored（QuickJS/LVGL）、未改 `.d.ts`；commits 拆 feat `c78e4f1` / test `42963ac` / docs，未推送；未跑 codex review（主控轮负责）。

## r160 / `shell.Launcher` 首个消费刀：launcher_grid 圆屏网格启动器（纯 app 层）

- **无真机触控/图标渲染/app 切换验收**：宿主 harness 跑真 app + 真 prelude + 真 `runtime/shell.js`，但 `press` / `gesture` 是宿主派发、`lume check --no-emu` 只做 esbuild bundle（不跑 eval/layout/perf），playground 是浏览器 stub。9 宫格真实触摸命中率、误触、编辑态滑动手感、48×48 图标在 AMOLED 上的字形清晰度、颜色对比度、戴手套/湿手手感**全部未实测**。板级验收 deferred，**不声称真机验证**。
- **显式 apps 字面量而非 app store**：简报指出 host harness 无法 stub app store，且固件端 boot-pinned 场景与「列出已装 app」语义冲突。app 用 9 个硬编码精选 app（counter / timer_kit / control_center / keyboard_demo / wordle / weather / music_player / clock / settings），**从不读 `lume.apps.entries()`**。代价：新增 app 不会自动出现在网格里，必须改 app.js 字面量；好处是宿主与真机语义一致、可精确锁画布预算。实机若要从已装 app 动态生成，需另起一刀并同步 harness。
- **onLaunch 是演示语义，不真切 app**：宿主回调只把 `launch <id>` 写进 status signal，**不调用真机 app 切换**。实证 `runtime/shell.js:638-639`：传 `onLaunch` 即覆盖默认 `lume.apps.launch(id)`；harness live 断言 `launch` 消息数为 0。真机 app 切换/返回栈语义留固件刀；本 app 仅是 `shell.Launcher` 的首个消费与画布/回调/编辑态验证载体。
- **画布预算口径与 indicator 取舍**：`Launcher.renderItem` 每 app 一个 48×48 Canvas（:641），9 个共 9×2304 = **20,736 px** ≤ 480×480 全帧 **230,400 px**。但 `EdgeNavigation`（:228-285）在 `indicator !== false` 时左右各加一个 24×64 Canvas（:246），若不关会变成 11 个画布。故显式传 `indicator: false`，代价是失去左右边缘滑动进度指示（back swipe 仍可用，harness 实证）。harness 同时断言数量=9、每画布 48×48、总面积精确 20736、预算常量 230400；开 indicator / 改 48 都会转红。
- **status 行与编辑态可见性边界**：status Text 置于列表下方 24 px 条带（y=458，fontSize 14），signal 驱动显示 `READY` / `launch <id>` / `BACK`。`Launcher` 内部 `editing` signal 不对外暴露，app 无法直接观测「正在编辑」，只能从 `onBack` 回调推断普通 back（编辑态 back 被 Launcher 内部消费后才调 `p.onBack`）。故 status 不显示 `editing` 字样，只显示最近 launch 与 back；若未来需要可观测编辑态，须在 shell 增加回调 prop（改 runtime/，另起刀）。
- **级联纠偏（实证超过简报）**：简报称 `length === 58` 为 10 处，实证该语法 10 处外另有 5 处 `assert.equal(apps.length, 58, ...)`，合计 **15 处**全同步 59；只按简报改 10 处会新增 5 个红灯。`tests/control_center.js` 的「58-app」文案标签与 `docs/roadmap.md` 历史快照按纪律未动；`sd_files.js` 变异串精确追加 `'launcher_grid'`；`ota_consumers.js` ALLOWED 在 commit 前预加 4 个新路径防 untracked 提交后转红。firmware/runtime/tools 零 diff，**未重钉任何 BASE**，断言语义未放宽；改前/改后全量 suite 均 0 FAIL。
- **harness load-bearing 自证**：两处曾假绿已修正——APPS/FIELDS 断言从闭包捕获数组改为对现场 source 提取；introspection key 由 `apps` 改名 `appList` 消除 `apps: APPS` 的重复。连续 edge swipe 用相同时间戳时第二次不触发（gesture 时基状态机），`drag` helper 加 `t0` 参数后编辑态退出/宿主 back 两步均可证。19 静态 mutation + 4 live mutation 全部实证转红。
- **验证与收尾口径**：`tests/launcher_grid.js` 16 静态 + 19 静态 mutation + 4 live + 4 live mutation 全绿，末行 `ALL LAUNCHER GRID HARNESS CASES PASSED`；全量 `tests/*.js` 0 FAIL；`npm test` 50/0/0；`check_website.py` 158 entries、missing/invented/duplicates/signatures 均 none；`lume check` launcher_grid（20533 B）/counter（2160 B）`--no-emu` 均 `RESULT: PASS`；playground 59 sources/apps；`git diff 8e42b96 HEAD -- firmware/ runtime/ tools/lume/` 与工作树版均空，故未跑 `idf.py build`，IRAM 16384 硬线未触碰。磁盘紧张，临时产物只留 `/tmp`，未清主仓 build/。ASCII 纪律全满足（全文件非 ASCII 字节 0，字号仅 14/20/32）；未改 vendored（QuickJS/LVGL）、未改 `.d.ts`；commits 拆 feat / test / docs，未推送；未跑 codex review（主控轮负责）。

## r161 / playground 补清单刀：minigolf + ipod_music 入列（纯工具清单层）

- **本刀性质与验收边界**：纯清单缺口补齐， firmware / runtime / examples 源码零改动，`git diff 362af44 HEAD -- firmware/ runtime/ examples/` 原始输出为空，故未跑 `idf.py build`、IRAM 16384 硬线未触碰。浏览器 playground 是 stub，`lume check --no-emu` 只做 esbuild bundle（不跑 eval/layout/perf）；两 app 的真实界面、触控、音频与网络行为**全部未实测**，板级验收 deferred，**不声称真机验证**。
- **r155 遗留收口**：基线已跟踪 `website/playground/apps/ipod_music.js` 与 `sources/ipod_music.js`（r155 一次性构建产物），当时因「禁改 tools/」未把 app 写进 `build.mjs`，重跑重建即令 `sources.js` 丢键。本刀把 `ipod_music` 正式写进 61-app 清单，生成物随 feat commit 落仓，`sources.js` 键数实证 61 且含两 app；该遗留问题就此收口。`apps/ipod_music.js` 再次生成的差异仅 esbuild 压缩变量名（`d/x` → `h/k`），功能等价；`sources/ipod_music.js` 与 example 字节一致。
- **差集 16 app 有意不入 gallery（逐个实证，见 `docs/roadmap.md` r161 表）**：`ai_chat`（在线 AI + WiFi）、`app_manager`（设备端 app 管理）、`ble_uart`（BLE 外设）、`device_monitor`（PMIC/IMU/BLE/net 多硬件）、`gestures`（IMU 手势）、`imu_poll`（IMU）、`launcher`（真机 boot/启动，gallery 已有 `launcher_grid` 替代）、`mochi`（手势硬件，简报初核漏列、本刀实证补登）、`net_check` / `nettest_open`（WiFi/HTTP）、`shell_demo`（内部 shell 组件演示，roadmap 早记「gallery does not list」）、`spectrum`（麦克风 recordStream）、`svg_icon`（r58 SVG 栅格化渲染探针，r98 起故意不进选择列表）、`typewriter_min`（6 行 emu smoke fixture，与已入列 `typewriter` 重复）、`web_config`（内置 web 服务器）、`ws_echo`（WebSocket 对端）。大类为硬件依赖 / 内部演示 / 协议对端，无「该入列而遗漏」者。
- **`svg_icon` / `typewriter_min` 弹性范围判定**：按实证判断**不追加**。`svg_icon` 只画一个静态勾选图标，依赖 `Image` 对 SVG 字节的栅格化（浏览器 stub 不保证），r98 报告明确它「单独注册为 bundle 但不在 38 项选择列表展示」，入列只会得到无交互且可能空白的条目；`typewriter_min` 是 6 行 emu smoke 复现 fixture（commit `03fafb8`），无任何 harness/docs 引用，与已入列的 `typewriter` 功能重复。二者不属被遗漏的展示 app，保持原状。
- **计数级联与断言不放宽**：简报称 16 处，实证为 11 处 `list.length === 59` + 5 处 `assert.equal(apps.length, 59, ...)`，两种语法全同步 61；只改一种会留 5 个红灯。文案标签（`control_center.js` / `launcher_grid.js` 里的「59-app playground manifest」，也是 mutation 查找键）与 `shell_components.js:18` 的 56（IconButton 高度 attr）按纪律未动。`sd_files.js` 变异串精确追加 `'minigolf', 'ipod_music'` 后 `drop image_gallery from playground manifest` 仍转红；`ota_consumers.js` ALLOWED 在 commit 前预加 4 个新生成物路径，16 个被改的 `tests/*.js`、`docs/*.md`、`sources.js`、`build.mjs` 均已在既有 ALLOWED 中，未放宽任何零 diff 守卫、未重钉 BASE。
- **幂等与验证口径**：`npm run build:playground --prefix tools/lume` 二次/三次构建输出逐字一致、`git status` 干净；PASS 行为 `61 editable sources` / `61 apps` / `PASS bundle minigolf 9711 bytes` / `PASS bundle ipod_music 22468 bytes`（非 0、非超大）。改前/改后全量 `tests/*.js` 均 0 FAIL，`npm test` 50/0/0，`check_website.py` 三项 none，`lume check` minigolf / ipod_music / counter `--no-emu` 均 `RESULT: PASS`，`grep -rn 'length === 59\|apps.length, 59' tests/*.js` 无输出，`sources.js` 解析为 61 keys 且含两 app。磁盘 `/` 余 4.9G，临时构建日志只留 `/tmp/r161-playground-build{1,2,3}.txt`；未改 vendored（QuickJS/LVGL）、未改 `.d.ts`；commits 拆 feat `4f12d4e` / test `caa12f2` / docs，未推送；未跑 codex review（主控轮负责）。

## r162 / `shell.Launcher` 编辑态可观测：`onEditingChange` 回调 + launcher_grid 消费

- **无真机触控/视觉验收**：宿主 harness 跑真 app + 真 prelude + 真 `runtime/shell.js`，但 `press` / `gesture` 是宿主派发、`lume check --no-emu` 只做 esbuild bundle（不跑 eval/layout/perf）、playground 是浏览器 stub。edit 按钮真实触摸命中率、编辑态 back 滑动手感、误触、status 行 `EDIT` 在 AMOLED 上的字号/对比度/可读性、戴手套/湿手手感**全部未实测**。板级验收 deferred，**不声称真机验证**。
- **r160 遗留收口**：r160 本节明确登记「`Launcher` 内部 `editing` signal 不对外暴露……若未来需要可观测编辑态，须在 shell 增加回调 prop（改 runtime/，另起刀）」。本刀即该另起刀：新增 `onEditingChange?: (editing: boolean) => void`，两处真实变更点（edit toggle、EdgeNavigation back-out）统一通知，遗留问题就此关闭。
- **回调异常无兜底（与 shell 现状一致）**：`setEditing(v)` 内直接 `p.onEditingChange(v)`，不包 try/catch，也不做 effect 订阅。理由：`shell.js` 现有组件（`onLaunch` / `onBack` / `onChange` 等）对回调异常一律无统一兜底，单为此 prop 加一层会与现状不一致；异常会沿调用栈上抛。副作用：宿主 app 的回调若抛错会中断 `editing.set` 之后的 UI 更新链，调用方需自行保证回调不抛。不订阅 effect 是为避开首帧误报 `false`（signal 初值就会触发）与 `cleanups[root]` dispose 时序坑；代价是外部只能通过回调获知变化，不能像 signal 那样随时读取 shell 内部 editing（本 app 自行镜像了一份 `editing` signal）。
- **契约只增不改**：不传 `onEditingChange` 时 `if (p.onEditingChange)` 为假，与基线逐字等价；harness 专门 boot 一份去掉回调与 `EDIT` 表达式的 app 变体，实证 status 停留在 `READY` / 编辑态 back 仍被内部消费 / 解禁后 tile 仍可 launch，证明旧路径未受影响。`website/api.html` 的 Launcher 签名按名字引用 `LauncherProps`，不含内联 props，故契约扩展后签名行自动一致、无需编辑 api.html（实证 `check_website.py` 四类 none）。
- **launcher_grid status 语义变化**：status 行从 `READY / launch <id> / BACK` 变为编辑态追加 `EDIT` 前缀；退出编辑恢复 `lastAction()`。这是本轮刻意的语义扩展（r160 登记的体验缺口），不是 bug；harness live 用 `statusNode` 过滤 `ATTR_TEXT=0` 消息读取**渲染文本**而非 `lastAction` 信号，避免把前缀变化误判为信号变化。
- **runtime/ diff 与 BASE 重钉（断言不放宽）**：本轮合法改 `runtime/shell.js` / `runtime/types/lume.d.ts`，20 个 runtime/firmware 守卫 harness 的零 diff 断言转红（`ota_consumers.js` / `sd_files.js` / `sd_gallery.js` / `sntp_consumers.js` 等均受影响）。按 `76d2c0c` 先例，test commit 把全部 BASE / 硬编码 diff base 从旧提交重钉到本轮 feat `80e76b2`，零 diff / allowlist 语义完全保留（未改成自比较、未删守卫、未放宽谓词），重钉后全量 0 FAIL。`sd_files.js` 清单变异串未动（app 数量仍 61）；`ota_consumers.js` ALLOWED 无新路径（全是已跟踪文件）。
- **playground 生成物级联（shell 内嵌所致）**：shell.js 由 CLI 打包进每个消费 shell 的 app bundle，故重建后除 launcher_grid 外另有 7 个 app bundle 更新、`sources.js` 同步；二次构建 `git status` 无变化（幂等）。bundle 20683 bytes（r160 为 20533，差值来自新增回调代码与 app 的 EDIT 表达式）。
- **存量 wordle flake（非本轮引入，如实登记）**：一次全量 harness 循环偶发 `FAIL tests/wordle.js`，单独复跑即绿。根因 `tests/wordle.js:428-431` smoke 用 `Math.random()` 掷键，断言「a green or yellow cell fill was drawn」（:388）在随机序列未命中绿/黄格时失败。干净基线 worktree `f6d5853` 同法 40 次跑出 2 次失败（本轮 worktree 30 次 1 次失败），本轮对 `wordle.js` 仅做 BASE/标签重钉、未碰 smoke 与断言；本轮最终 4 次全量循环均 0 FAIL。不修该存量 flake（超出本刀范围）。
- **验证与收尾口径**：`tests/launcher_grid.js` 20 静态 + 25 静态 mutation + 6 live + 9 live mutation 全绿，末行 `ALL LAUNCHER GRID HARNESS CASES PASSED`；全量 `tests/*.js` 0 FAIL；`npm test` 50/0/0；`check_website.py` 158 entries、missing/invented/duplicates/signatures 四类均 none；`lume check` launcher_grid（20683 B）/counter（2160 B）`--no-emu` 均 `RESULT: PASS`；playground 61 sources/apps。`grep -rn 'shell' firmware/main/ firmware/components/lume-engine/` 无输出，`git diff f6d5853 HEAD -- firmware/` 与 prelude diff 均空，故未跑 `idf.py build`，IRAM 16384 硬线未触碰。ASCII 纪律全满足（app 与 harness 全文件非 ASCII 字节 0，字号仅 14）；未改 vendored（QuickJS/LVGL）；commits 拆 feat `80e76b2` / test `690cb07` / docs，未推送；实验日志只留 `/tmp`，磁盘 `/` 余 4.9G；未跑 codex review（主控轮负责）。

## r163 / `shell.Dialog` 消费 settings 危险操作：stub 降级与两段式→模态取舍

- **无真机触控/配色对比度验收**：宿主 harness 跑真 app + 真 prelude + 真 `runtime/shell.js`，live 用真实 `press` 派发到 Dialog 的 handler 节点；但 `lume check --no-emu` 只做 esbuild bundle（不跑 eval/layout/perf），playground 是浏览器 stub。danger 按钮 `#C62828` 背景在 CO5300 AMOLED 上的文字对比度、模态遮罩 0.65 不透明度的观感、Cancel/Rotate/Reboot 的真实触摸命中率与误触、戴手套/湿手手感**全部未实测**。板级验收 deferred，**不声称真机验证**。
- **stub 降级语义：显示 ASCII note，不直接执行危险动作**：实证 playground 因 `tools/playground/build.mjs` 把 shell.js 编进消费 app，`lume.ui.shell.Dialog` 在浏览器与宿主均为 function；但为防「无 Dialog 的假 stub」导致 app 启动即抛或静默执行，两处调用前加 `typeof lume.ui.shell.Dialog === 'function'` 防御，缺失时分别写 `rotate n/a (no dialog)` / `reboot n/a (no dialog)`。**刻意不采用「回落直接执行」**：直接执行会绕过模态确认、对 OTA token 轮换与 esp_restart 这类不可逆操作是安全回归；显示 note 虽让 stub 下无法完成操作，但保留「绝不未经确认就动危险动作」的语义，与 app 既有的 `volNote` / `otaNote` / `rebootNote` 降级风格一致。代价：极简 stub 无 Dialog 时按钮只给 note、无替代确认路径；真机/playground 正常路径不受影响。
- **两段式 → 模态的行为差异（刻意接受）**：原实现是「首 tap arm 3 s 窗口 → 次 tap 执行」，超时自动撤销；模态确认改为「单击开 Dialog → 显式点 danger 执行 / 点 Cancel 或遮罩取消」，**不再有 3 s 自动超时**——模态可无限期停留直到用户或 `onPause` 关闭（shell.js:136 在 pause 时关闭所有 dialog）。这消除了「3 s 内忘点第二次就失效」的体验，但也意味着 Dialog 打开时会拦截底层触摸（`mask` 覆盖全屏、`card` 吞事件），须显式取消才能继续操作。按钮 title 从 arm 时翻转 `Confirm new token?` / `Confirm reboot?` 改为静态 `New token` / `Reboot`，确认语义由模态承载。两段式 signal / arm timer / title 翻转已全删（harness 断言无残留）。
- **`lume.system.reboot` 防御位置变化但语义不变**：原 `typeof lume.system.reboot !== 'function'` + `rebootNote.set('reboot n/a')` 从旧「二次 tap 执行路径」整体移入 Dialog 的 Reboot onPress 内；Cancel、模态展示阶段都不探测该 binding。无 binding 的 stub 下点 Reboot 仅写 note、不抛异常（live 实证）。真机 `reboot()` 仍 `never`、直接 esp_restart，未持久化状态丢失的边界不变。
- **无撤销/幂等语义**：Rotate 的 32-hex token 由 `Math.random()` 生成（非 CSPRNG，见 r132 节），模态只确认「是否轮换」，不提供 token 预览、不提供轮换后回滚；Reboot 不可撤销。Dialog 的 Cancel 仅取消本次弹窗、不回滚任何已生效状态。
- **范围控制与零改动实证**：`examples/files` 既有 Dialog 消费方未动；`powerConfirm`（Power off）的两段式确认不在本刀范围、未动；`firmware/`、`runtime/`、`.d.ts` 零改动（`git diff 9fb12d7 -- firmware/ runtime/` 原始输出为空），未跑 `idf.py build`，IRAM 16384 硬线未触碰。commits 拆 feat `a18a83a` / test `cbf4422` / docs，未推送；未跑 codex review（主控轮负责）；日志只留 `/tmp`。

## r164 / 两段式 confirm 收官刀：settings Power off + hr_monitor BLE gate Dialog 化（纯 app 层）

- **无真机验收（不声称真机验证）**：宿主 harness 跑真 app + 真 prelude + 真 `runtime/shell.js`，live 用真实 `press` 派发到 Dialog 的 handler 节点；但 `lume check --no-emu` 只做 esbuild bundle（不跑 eval/layout/perf），playground 是浏览器 stub。`lume.pmic.powerOff()` 的真实关机时序、BLE 广播/连接/共存、danger 按钮配色在 CO5300 AMOLED 上的文字对比度、遮罩 0.65 不透明度的观感、Cancel/危险按钮的真实触摸命中率与误触、戴手套/湿手手感**全部未实测**。板级验收 deferred。
- **Dialog 化 UX 与两段式的手感差异（刻意接受）**：原两段式是「首 tap arm 3 s → 次 tap 执行」且超时自动撤销；模态改为「单击开 Dialog → 显式点 danger / Cancel / 遮罩取消」，**不再有 3 s 自动超时**，模态可无限期停留直到用户或 `onPause` 关闭（`shell.js:136`）。代价是弹窗期间遮罩拦截底层触摸、必须显式取消才能继续操作；收益是消除「3 s 内忘点第二次就失效」。r163 已在 settings 接受该差异，本刀把它推广到 Power off 与 BLE gate，手感差异本身 deferred。
- **hr_monitor title 静态化选择**：按钮 title 由 `toggleArm()` 翻转的 `Confirm stop?` / `Confirm adv?` 改为静态断言可锚定的 `advertising() ? 'Stop adv' : 'Start adv'`——保留「当前是开始还是停止」的即时语义，但不再承担确认职责，确认完全交给 Dialog。静态 harness 锚定在该表达式字符串上。settings 的 Power off 按钮 title 同理去掉 `Confirm off?` 翻转，仅在 guard 失败时显示 ASCII note（如 `power off n/a`），不新增节点。
- **hr_monitor 补 `import '../../runtime/shell.js'` 的必要性（实证纠偏）**：该 app 此前**没有** import shell.js（与 r163 的 settings 相同）。若不补，Dialog 调用只会命中 typeof guard 写 `BLE n/a (no dialog)`、弹窗根本不出现——「Dialog 化」名存实亡。补后 bundle 3568 → 23003 bytes，live 实证 `lume.ui.shell.Dialog` 为 function。
- **stub 降级语义沿用 r163**：两处调用前均加 `typeof shell.Dialog !== 'function'` 防御，缺失时写 `power off n/a (no dialog)` / `BLE n/a (no dialog)`，绝不直接执行危险动作；binding 自身的 typeof 防御留在 danger 回调内，Cancel / mask / card 阶段绝不触碰 binding。无 pmic / 无 BLE binding 时分别写 `power off n/a` / `BLE n/a (no stack)` 且 0 动作。
- **范围控制与零改动实证**：`startAdv()` / `stopAdv()` 本体、note / advertising / HR 渲染链路零改动；`examples/files`（单向弹窗）、`runtime/`、`firmware/`、`.d.ts`、vendored 全未动。`git diff 8b46c00 HEAD -- firmware/ runtime/` 与工作树版原始输出均为空，未跑 `idf.py build`，IRAM 16384 硬线未触碰。commits 拆 feat `c3ca253` / test `4472867` / docs，未推送；未跑 codex review（主控轮负责）；最终日志只留 `/tmp/r164-final-verify.txt`。ASCII 纪律全满足（两 app 与新 harness 全文件非 ASCII 字节 0）。

## r165 / wordle 每日一题：日序号确定性选词的取舍（纯 app 层）

- **冷启动 dayIndex=0 是诚实行为，不伪装**：`wdDayIndex()` 直接用 `lume.system.time()`（unix 毫秒）除以 86400000。未 SNTP 的冷启动返回 1970 起小值 → dayIndex=0 → `WORDS[0]`='about' 固定词；这与 `runtime/types/lume.d.ts` r128 原文「a small number near zero ... treat small values as 'clock not set' on a cold boot」一致。app 不在 UI 上假装已校时、不填一个伪 epoch；`DAY #0` 如实显示。该口径使「每天看一眼」的粘性叙事在未联网的板上退化为「首词固定」，属已知限制而非 bug。真机 SNTP 校时后的行为见下条。
- **校时跳词边界（如实登记）**：SNTP 成功后 `time()` 从 1970 小值跳到真实 epoch，dayIndex 从 0 跳到真实日序号；若用户在开机后、校时前已看过 `WORDS[0]`（或已开局），校时后的下一次 NEW（或同一局内 HUD）会切到另一词与另一个 `DAY #N`。本轮刻意不做「等校时才允许开局 / 锁住首个词直到次日」的门控——那会引入 WiFi 依赖与状态机，超出纯 app 刀范围。此跳变只在真机冷启动路径出现，宿主 harness 用注入固定时钟覆盖，不模拟该边界。
- **新增 KV 键 `wr.day` 与连胜跨日规则**：`wr.day`（7 字符，≤15 上限）记**最后一次赢的 dayIndex**，不是「上次玩的 dayIndex」；这样只需一个键即可表达「连胜天」：开局时若 `day - wr.day >= 2` 就清零 `wordle.cur`（漏掉一整天），同日重开与次日开局都续连胜，`hisc.wordle` 永不降。代价：输掉当天的一局不会单独写 `wr.day`，但 `wordle.cur` 已被 loss 分支清零，次日续 0 正确；一局跨午夜才赢时按**开局那天的 dayIndex**记账（`s.day`），而非胜利时刻的钟，避免「昨天的题记到今天」。未做「每个日题只计一次」（同一天可重复赢并累加连胜），也未做真机断电后 NVS 持久性验收（deferred）。
- **固定时钟注入只落在 wordle harness，不碰共享 stub**：`tests/sntp.js` 把 `_systemTime: () => Date.now()` 字面量锁死在 `tests/lib/prelude_runner.js` 与 `website/playground/runtime.js`，故本轮不在共享 runner / 浏览器 stub 上改时间源。Part 1 用可写 `mockNowMs` + `system.time` mock，Part 2/3 在 app eval 前用 `lume._systemTime = ...` 前缀注入固定值（prelude 动态读该属性）。浏览器 playground 仍用真实 `Date.now()`（`tools/`、`website/playground/runtime.js` 零改动），因此 playground 显示的是**打开当天**的词，不会被 harness 的固定值污染——这是有意的口径分离，不是 stub 缺失。
- **HUD `DAY #N` 取绝对日序号**：N = `wdDayIndex()` 原值（如 20483），不用 `%300+1`。理由：绝对序号与选词用的 `dayIndex % WORDS.length` 解耦，同一天词表变动也不会让显示含义漂移；代价是数字较大（14 px 字体下整行 HUD 仍在 480 px 内，静态/live 未做像素级测宽，真机排版 deferred）。
- **范围控制与零改动实证**：仅 `examples/wordle/app.js` + 4 个 playground 生成物 + `tests/wordle.js` 改动；`firmware/`、`runtime/`、`.d.ts`、vendored、`tools/`、`examples/wordring` 全未动。`git diff ca6719a HEAD -- firmware/ runtime/ tools/` 与工作树版原始输出均为空，未跑 `idf.py build`，IRAM 16384 硬线未触碰。守卫 BASE 从 `80e76b2` 重钉到本轮 feat `6dddec1`（app 层 feat，零 diff 语义不变，未自比较/未删守卫），wordle 存量 smoke flake 本轮未触发。ASCII 纪律全满足；commits 拆 feat `6dddec1` / test `674d461` / docs，未推送；未跑 codex review（主控轮负责）；最终日志只留 `/tmp/r165-final-verify.txt`。**无真机验收（不声称真机验证）**：词表主观难度、连续多天真机开词的粘性、键帽手感与圆屏安全区全部 deferred。

## r167 / color_demo 入 playground 清单 + manifest 级联的取舍（纯工具清单层）

- **无真机验收（不声称真机验证）**：playground 是浏览器 stub，`lume check --no-emu` 只做 esbuild bundle（不跑 eval/layout/perf）；ColorPicker 色环/滑条的真实触控手感、hex 展示、KV 恢复与 AMOLED 配色对比度全部 deferred，板级验收未涉及。
- **M5 gallery 刻意不动**：`website/examples.html` 是策展型七卡结构，color_demo 虽进入 62-app playground 清单，但本轮不把画廊改成 62 卡、也不新增策展卡，保持策展口径；roadmap M5 gallery 行与所有 milestone checkbox 未动。是否展示留给主控另行决策。
- **needle 口径**：`tests/sd_files.js` 的 `drop image_gallery from playground manifest` mutation 串按 r161 先例精确追加 `'color_demo'`（只动 needle 串、不动断言语义），保证删列表 mutation 仍转红。
- **ALLOWED 预加范围**：只预加两个未跟踪生成物 `website/playground/apps/color_demo.js` / `sources/color_demo.js` 到 `tests/ota_consumers.js` ALLOWED（git diff 看不见 untracked，提交后转红）。`sources.js`、`apps/wordle.js`、`tools/playground/build.mjs` 已在既有 ALLOWED（r133/r148）；未给其他 harness 加 ALLOWED——实证只有 `ota_consumers.js` 有 `gitChanged([])` allChanged 守卫，其余 `fwChanged` 范围不含 `website/` 生成物。
- **无 BASE 重钉**：实证 `grep -rn "gitChanged" tests/*.js | grep "tools/playground"` → NONE；任何 harness 的零 diff 守卫都不含 `tools/playground/`，故 build.mjs 不触发转红，无需按 r162/r165 先例重钉 BASE；零 diff / allowlist 语义完全保留（未自比较、未删守卫、未放宽谓词）。
- **wordle.js 再生成**：重建后 `apps/wordle.js` 出现差异（esbuild 压缩变量名重命名，r165 版本与当前工具链输出功能等价）；该生成物已在 ALLOWED，且无 harness 锁定 `apps/` bundle 字节（wordle harness 只锁 `sources/wordle.js` 字节一致）。连同 `sources.js` 随 feat commit 提交，以保证 `npm run build:playground` 后树干净（幂等）。
- **文本标签不动**：4 处「61-app playground manifest」标签（`launcher_grid.js:12/165/203`、`settings_dialog.js:129`）按 r161 先例刻意保留旧数字，只同步 17 处数值断言到 62；mutation 查找键语义不受影响。
- **验证与收尾口径**：build:playground 62 apps / color_demo 24207 bytes，重建后 `git status` 空；`colorpicker.js` / `color_demo.js` / `ota_consumers.js` / `sd_files.js` 全绿；全量 `tests/*.js` 0 FAIL（98 harness，未触发 wordle 存量 flake）；`npm test` 50/0/0（基线 skipped 0，简报 skipped 1 为过期口径）；`check_website.py` 四类 none；`lume check` color_demo / counter `--no-emu` 均 `RESULT: PASS`；`git diff 2b9a72f HEAD -- firmware/ runtime/` 与工作树版均空，未跑 `idf.py build`；ASCII `grep -Pn '[^\x00-\x7F]' tools/playground/build.mjs` → NONE。未改 vendored（QuickJS/LVGL）、未改 `.d.ts`；commits 拆 feat `3e54f4c` / test `fe57938` / docs，未推送；未跑 codex review（主控轮负责）；最终日志只留 `/tmp/r167-final-verify.txt`，磁盘 `/` 紧张未留多余 build 产物。

## r168 / fishtank 卡顿收口（纯 app 层）

- **根因与改法**：r90 版每 33 ms 做一次 480×480 全幅重绘（119–135 条 Canvas 命令、约 230,400 像素发布/帧），与 `gravity_ball` 记录的全幅 20 fps 压垮 UI 队列同一类问题。本刀保留 33 ms 物理步长与转向/觅食/摆尾语义，改为每 2 步（15 Hz）才发一次 `tankFrame.set()`；工作缓冲区仍整帧重画，但 `onDraw` 返回 1..7 个脏矩形，只发布鱼（旧位置∪新位置）与鱼食的包围盒。槽位固定为 6 条鱼 + 1 个鱼食盒（无 O(n²) 归并），触屏投喂立即强制刷新。`examples/fishtank/app.js` 与 `tests/fishtank.js` 是仅有的源码改动。
- **量化（host）**：`tests/fishtank.js` 全绿，新增断言首帧整屏、后续 90 tick 恰好 45 次绘制、每次 ≤8 个合法且非全屏脏矩形、tap 立即重绘、水草每 8 tick 摆动一次（90 tick 内 11 帧）；最大绘制调用仍为 135（<250）。`/tmp` 基准：JS + 消息生成由 `245.8 us/tick` 降到 `161.4 us/tick`（−34%）；发布像素由整屏 230,400 px/帧降到 `30,234 px/帧`（13.1%，5.3 个脏矩形/帧，含水草摆动帧），面板写带宽约为原来的 1/7。`lume check examples/fishtank --no-emu` PASS；`npm test --prefix tools/lume` 52/52。
- **视觉取舍**：水草保留摆动但降到每 8 个物理 tick（约 267 ms / 每 4 个绘制帧）换一次相位，相位变化帧额外发布一个 424×134 的水草带脏盒；比原本每 30 Hz 全幅刷新便宜得多。光斑仍静态（摆动会把大片水域反复弄脏）；气泡停止上浮（原先 10 个气泡的并集脏盒几乎横跨整屏，慢速漂移不值这个刷新量）。鱼、鱼食、投喂、摆尾、弹跳仍按原语义运动。macOS 无 `idf.py build` / 真机，15 Hz 实际观感、水草 3.75 Hz 摆动是否够自然、AMOLED 色彩与触摸手感 deferred。

## r187 / TLS 验签与网关握手鉴权

- 固件构建和宿主测试只能证明配置、编译与本机握手行为。实际板上 HTTPS 有效证书、无效证书、自定义 CA、`httpsInsecure: true` 及 SNTP 时钟条件尚未验收。
- 网关握手 token 是可选的共享令牌；未配置时 CLI 会警告，但仍允许连接。设备与网关之间的 `ws://` 令牌仍是明文，部署时需限制网络访问或由可信代理终止 TLS。当前 `voice_assistant` 示例会记录连接 URL，不能安全地把 token 放入该 URL；示例尚未接入握手请求头，真实设备连接及令牌配置尚未板上验收。
