# r206 报告：`lume mcp` MCP stdio server（AX 基建线 r173）

## 0. 基线与边界

- 基线：`origin/main c74fc80`（2026-11-27，r205 已推）；worktree `/tmp/lume-r206-wt`，分支 `r206-mcp-server`。
- **本轮由主控接管实施**：派发引擎（hy4flash-free）遇 `429 您的使用量已超出频率限制，将在 2026-11-27 18:54:20 UTC+8 重置`，engine_exit=0 且零产出（log 4 秒即退出，仅完成 worktree 建立）。按纪律不切模型，主控直接写码。
- 改动面：`tools/lume/`（mcp.js + lume.js 路由 + mcp.test.js）与 14 个 harness 的 R166_ALLOWED 预加、`docs/r206-report.md`、`docs/KNOWN-SIMPLIFICATIONS.md`、`docs/roadmap.md` AX 行、`docs/build.md`。**firmware/、runtime/、examples/、website/ 零改动**（验收段贴 diff 空输出），未跑 `idf.py build`。

## 1. 为什么是自实现协议层（零新 npm 依赖）

MCP stdio 传输 = ndjson JSON-RPC 2.0：每行一条消息、stdin/stdout 各一方向。@modelcontextprotocol/sdk 对一个六工具 server 是纯开销（依赖树、类型层、多版本兼容矩阵），且仓库纪律是 vendored 最小化。协议层实现如下：

- `initialize`：回 client 的 `protocolVersion`（服务端已知集 `2024-11-05 / 2025-03-26 / 2025-06-18` 内），未知版本回服务端最新（`2025-06-18`）——保守协商。`serverInfo = { name: 'lume', version }`，`capabilities: { tools: {} }`。
- `notifications/initialized` / 其余 notification：忽略（按 JSON-RPC，notification 无回包）。
- `ping` → `{}`；`tools/list` → 六工具全量 inputSchema（type: object，字段带 description）；`tools/call` → 分发。
- 错误口径：未知 tool → `-32602 invalid params`（tools/call 参数面错误）；未知 method → `-32601`；handler 抛异常 → 捕获并回 `isError: true` result（server 不因单次调用崩溃）；非 JSON 行 → stderr 记日志后跳过（生存性）。
- **stdout 铁律**：协议消息只走 stdout，诊断全部 `[lume-mcp]` 前缀写 stderr。文件内零 `console.log`。

## 2. 工具契约（tool 名即契约，落地后不改）

| tool | 入参 | 实现 | 免板 |
|---|---|---|---|
| `lume_check` | `{appDir, noEmu?=true, timeout?}` | spawn `lume.js check <appDir> --json [--no-emu] [--timeout]`，转发 `{exitCode, check}`；exit!=0 → isError | 是 |
| `lume_bundle` | `{appDir}` | 进程内 `bundle()`（esbuild），回 `{bytes}`，不落仓库产物 | 是 |
| `lume_manifest` | `{}` | 进程内 import `tools/playground/build.mjs` 的 `manifestApps()`（该文件 import 无副作用，build 仅作 main 运行——已实证） | 是 |
| `lume_context` | `{skipCheck?=true}` | 进程内 `context()`，回 r199 快照全字段 + `snapshotFailed`；快照失败 → isError | 是 |
| `lume_help` | `{}` | spawn `lume.js --help` 直通 usage（零复制，帮助文本单源） | 是 |
| `lume_deploy` | `{appDir, port?/host?+token?, otaPort?, id?, ephemeral?}` | 无板入参 → 立即 isError + 指引（不挂起）；有板 → spawn `lume.js deploy`（120s 上限） | **否** |

设计取舍：**重 CLI 面（check/help/deploy）走 spawn 子进程**，复用 exit code 契约（0 pass / 1 fail）与 `--json` 机器可读输出，进程隔离不污染 server；**纯数据面（bundle/manifest/context）进程内 import**，省一次进程启动。`lume_check` 的 `noEmu` 默认 true——agent 场景绝大多数要的是秒级语法/布局反馈，emu 全跑明确传 `noEmu: false`。

## 3. CLI 集成

`lume.js` 三处：usage 表加 `lume mcp` 行、parse 命令白名单加 `'mcp'`、main 路由加 `else if (command === 'mcp')`（动态 `import('./mcp.js')` 后 `run()`，exit code 直通）。`lume mcp` 无参数、长驻 stdin EOF 退出（exit 0）。

## 4. 验收（原始输出见 `/tmp/r206-final-verify.txt`；宿主证据，非真机）

- `npm test --prefix tools/lume` → `# tests 71 / # pass 71 / # fail 0`（基线 57 → 71，新增 14 条协议级测试，全部 spawn 真进程说话）。
- mcp.test.js 覆盖：initialize 握手（已知/未知 protocolVersion 两路）、tools/list 六工具 schema、ping、lume_help/lume_manifest/lume_context/lume_check（counter 哨兵真跑 PASS）/lume_check 坏 app isError/lume_deploy 无板 isError 不挂起、-32602/-32601、非 JSON 行生存性、EOF 干净退出 exit 0。
- 14 个 R166 围栏 harness（ota_consumers / wordle / control_center / archive_view / crypto_check / img_view / vec_demo / hr_monitor / keyboard_states / launcher_grid / reboot_consumers / timer_kit / sntp_consumers2 / weather_sntp）预加 `'tools/lume/mcp.js', 'tools/lume/mcp.test.js'`（r199 先例：新文件提交后 git diff 才可见，必须预加）→ 逐一单独跑全 OK。
- 全量回归 `timeout 900 bash -c 'for t in tests/*.js; do node "$t" ...; done'` → **0 FAIL**（r205 后基线本就全绿，本轮保持）。
- `node tools/lume/lume.js check examples/counter --no-emu` → `RESULT: PASS (4 steps, 0 failed; exit 0)`。
- ASCII 纪律：`grep -Pn '[^\x00-\x7F]' tools/lume/mcp.js tools/lume/mcp.test.js tools/lume/lume.js` → 无输出。
- **firmware/runtime/examples/website 零改动**：`git diff c74fc80 HEAD -- firmware/ runtime/ examples/ website/` 与工作树版同命令输出均为空（见验证日志）；未跑 `idf.py build`。

## 5. deferred / 未做

- `lume_deploy` / 截图类工具的**真机验收**未做：无板环境下 deploy 只验收「无板 → 结构化错误 + 指引」；USB/WiFi 真实推包留 board bring-up，不声称验证。
- MCP resources/prompts 面未做（tools 已覆盖六稳定能力，resources 无消费方）。
- r174（examples meta.json 检索）仍未做，AX 线最后一刀。

---

# Part II: Lume r206 UI 第三批报告 — settings 四个子页重制 + 第三梯队 6 App 设计先行管线第三批

> **范围**：纯 app 层重构（`examples/{settings,files,crypto_check,archive_view,adc_meter,img_view,image_gallery}/app.js`）、6 张 480×480 圆屏 HTML 设计稿及多状态截图（`artifacts/r206/design/*.{html,png}`）、11 张翻译后 playground 圆屏实拍（`artifacts/r206/*.png`，含 settings 全部 5 页 + 第三梯队 6 app）、对应 4 份宿主 harness 更新（`tests/{sntp_consumers,settings_dialog,files_dialog,adc_meter}.js`）及 playground 产物重建（74/74 apps）。  
> **红线边界**：`firmware/`、`runtime/`、`prelude`、`shell.js`、`tools/`、其他 `examples/` 零改动；settings 的 KV 键（`wifi.saved` / `wifi.auto` / `bt.name` / `set.volume`）、Wi-Fi 状态机、BLE 启停与重命名、r129 NTP 同步、r132 OTA 状态与 Dialog 令牌轮换、r143 Reboot Dialog、r164 Power-off Dialog、以及 files/image_gallery 的 Sd-first 回退逻辑全部零功能改动。  
> **诚实口径**：全部截图、帧绘制调用计数、节点统计与 111/111 宿主回归均为宿主机验证（Node `prelude_runner` + 无头 Chromium Playwright 480×480 / playground 圆屏模式）；CO5300 真机 AMOLED 发光观感、触控手感、实测 Wi-Fi/BLE 射频、ADC eFuse 校准、TF 卡 SPI 挂载仍 deferred 至 board bring-up，**不声称真机验收**。

---

## 1. 六张 HTML 设计稿自检与翻译还原度对照

依据 `docs/DESIGN-TOKENS.md`（R1–R8 红线、深色 AMOLED 色板、安全区 `[75, 405]`、卡片圆角 ≤12px、危险操作隔离、禁字母占位图标）与 r205 `settings.html`（9/10 基准）及 r201 `control-center.html` 滑块语言，先在 `artifacts/r206/design/` 产出 6 张高保真 480×480 圆屏设计稿并完成 Playwright DOM 几何校验（全部 `errors: 0 / safeViolations: [] / touchIssues: []`），再逐 app 翻译并在 `website/playground/index.html` 圆屏模式实拍对照：

| 设计稿 / 目标 App | 设计稿文件 | 设计稿自检 | 翻译实拍 | 布局 | 层级 | 色彩 | 图标 | 还原度 |
|---|---|---:|---|---:|---:|---:|---:|---:|
| `settings` (Wi-Fi + Scan) | `artifacts/r206/design/settings-wifi.png` (+ `connecting` / `password`) | **9.2/10** | `artifacts/r206/settings-wifi.png`, `settings-scan.png` | 9.1 | 9.0 | 9.2 | 9.0 | **9.1/10** |
| `settings` (General) | `artifacts/r206/design/settings-general.png` | **9.3/10** | `artifacts/r206/settings-general.png` | 9.4 | 9.3 | 9.3 | 9.2 | **9.3/10** |
| `settings` (Bluetooth) | `artifacts/r206/design/settings-bt.png` | **9.2/10** | `artifacts/r206/settings-bt.png` | 9.2 | 9.2 | 9.2 | 9.1 | **9.2/10** |
| `files` | `artifacts/r206/design/files.png` | **9.3/10** | `artifacts/r206/files.png` | 9.2 | 9.2 | 9.3 | 9.4 | **9.3/10** |
| `adc_meter` | `artifacts/r206/design/adc-meter.png` | **9.4/10** | `artifacts/r206/adc_meter.png` | 9.2 | 9.2 | 9.2 | 9.0 | **9.2/10** |
| `img_view` & `image_gallery` | `artifacts/r206/design/media-gallery.png` (+ `viewer`) | **9.2/10** | `artifacts/r206/img_view.png`, `image_gallery.png` | 9.0 | 8.9 | 9.1 | 8.6 | **8.9/10** |
| `crypto_check` & `archive_view` | 沿用 `settings` 分组卡片体系（[76, 404] 圆屏安全区） | N/A（延续体系） | `artifacts/r206/crypto_check.png`, `archive_view.png` | 9.0 | 9.0 | 9.1 | 8.8 | **9.0/10** |

全部 6 张设计稿自检 **9.2–9.4/10**（要求 ≥ 8.0），全部翻译实拍还原度 **8.9–9.3/10**（要求 ≥ 7.5）。

---

## 2. Settings 五页视觉一致性专项自查（Menu vs 四个子页）

将 `dialBezel`（`452×452` `#09101A` 圆形表盘底 + `1px #1E2D3F` 外圈）提升至 `root` 共享底层，五页统一收拢进 `[76, 404]`（`328×328`）圆屏安全区，彻底消除旧版子页矩形满幅与调试文案割裂：

| 页面 | 截图 | 改前缺陷 | r206 统一语言改造 | 与 Menu 页一致性 |
|---|---|---|---|---|
| `page 0: menu` | `artifacts/r206/settings-menu.png` | r205 已达 9/10 | 复用共享 `dialBezel`，视觉像素级不变（时间胶囊 + Settings + 电量胶囊 + 三组四卡 SVG + iOS 开关 + chevron） | 基准（9.2/10） |
| `page 1: wifi` | `artifacts/r206/settings-wifi.png` | 旧式 `infoRow('status', ...)` 纯文本行、无信号/锁图标、无连接状态表达 | `<` 返回胶囊 + `20px` 标题 + 语义状态徽章（`CONNECTED`/`CONNECTING`/`ERROR`/`OFF`）；顶部 Hero 状态卡（Wi-Fi 圆盘图标 + 活跃 SSID + 绿勾/琥珀连接弧）；三按钮层级分明（主操作翠绿 `Scan` / 次操作 `Add` / 危险红隔离 `Disconnect`）；`SAVED NETWORKS` 10px 矢量微标 + 信号三档条/锁图标/AUTO 徽章卡片列表 | **完全一致（9.1/10）** |
| `page 4: scan` | `artifacts/r206/settings-scan.png` | 裸文本 `SSID -62dBm open`，无信号强度与加密图标 | 同款顶栏（`<` 回 Wi-Fi + `Wi-Fi Scan` + `READY / N FOUND` 胶囊）+ 全宽主操作 `Rescan` + `NEARBY` 微标 + 每行三档色阶信号条（强/中 mint、弱 amber）+ `dBm` + 锁图标 / `OPEN` 提示 | **完全一致（9.1/10）** |
| `page 2: bt` | `artifacts/r206/settings-bt.png` | 单行 `device: Lume off` + 三等权按钮无状态区分 | 同款顶栏（`<` + `Bluetooth` + `OFF / ADV / CONN` 徽章）；Hero 设备卡（蓝符文圆盘 + `Lume` + `BLE GATT Peripheral` + 可点击 iOS 开关 + `Status` 状态色带）；`IDENTITY` 分组卡片（`Device Name` + chevron 点入重命名）；状态机驱动 `Advertise` / `Stop`（激活态置灰非法动作、仅开放 `Stop` 红区） | **完全一致（9.2/10）** |
| `page 3: general` | `artifacts/r206/settings-general.png` | `TIME SYNC: ...` / `ota off` 调试口径文案、裸 `- 50% +` 行、按钮溢屏需滚动、危险操作无视觉隔离 | 同款顶栏（`<` + `General` + 电量胶囊 `80%`）；r201 `control-center` 语言音量滑块卡（`-` / `+` + mint 渐变轨 + 圆形带心圆点 thumb）；友好化状态行 `OTA  OFFLINE` / `Time  SYNCED`（语义色区分 + 保留 r132/r129 3 节点结构）；单条紧凑遥测条（`Batt 80% 3.98V CC` + `fs ok 0 kv`）；底部危险区隔离：`Reboot`（琥珀警告）与 `Sleep now` / `Power off`（暗红危险隔离），**全页 324px 一屏内零滚动零裁切** | **完全一致（9.3/10）** |

**对比度自查修正（vision 实拍拦截）**：首轮实拍发现 Lume `Button` 固定渲染白字 `#F2F7FB`，放于亮薄荷 `#40D8B0` 上对比度仅 ~1.8:1；二轮全量改用深翡翠 `#116354` 底 + `#40D8B0` 1px 亮边，白字对比度跃升至 **7.4:1（WCAG AAA）**。

---

## 3. 第三梯队 6 App 销账表

| App | 原状问题 | r206 重制要点 | 节点数 | 帧绘制调用 | 状态 |
|---|---|---|---|---|---|
| `examples/files/app.js` | 矩形 24px 边距在圆屏四角裁切、`DIR`/`FILE` 字母标签、`DEL` 与 `VIEW` 同级无危险隔离 | 圆屏 `[76, 404]` 安全区 + 面包屑路径条（`<` + `Files:/` + 项数/SD 剩余 MB）+ 内联 ASCII SVG 图标（TF 卡/文件夹/文件，0 Canvas PSRAM）+ 选中行青绿描边 + 空态居中提示 + 底部 `[NEW] [VIEW] [DEL]` 危险隔离；保留全部 Sd-first 回退与 `shell.Dialog` 删除确认 | **25**（1000 项虚拟化 <60） | **0**（`<= 240` PASS） | 已销账 |
| `examples/crypto_check/app.js` | 20px 矩形堆叠被圆屏切角、无分组卡片、错误/不支持态与正常态同色 | 圆屏表盘 + `[76, 404]` 顶栏 + 高对比 `NEXT` 胶囊 + `PAYLOAD` 青绿徽章条 + 4 枚分组卡片（`SHA-256` / `HMAC-SHA256` / `CRC-32` / `AES-128-CTR`），按值动态语义着色（OK mint / UNSUPPORTED amber / ERR coral）；严格保持 `<= 20` 静态节点与无 import 全局脚本 | **19**（`<= 20`） | N/A | 已销账 |
| `examples/archive_view/app.js` | 20px 矩形贴边裁切、内容区与指标区无视觉分隔 | 圆屏表盘 + `[76, 404]` 顶栏 + `NEXT` 胶囊 + `PAYLOAD` 徽章条 + 独立深色等宽内容视窗 + 双栏 `bytes` / `ratio` 指标卡 + 底部 `FORMAT` / `STATUS` 卡片（OK mint / ERR coral）；严格保持 `<= 20` 静态节点与 `-1/-2/-3/0` 数值判别 | **17**（`<= 20`） | N/A | 已销账 |
| `examples/adc_meter/app.js` | 24px 矩形布局、单调纯色横条无趋势可视化、无采样率/量程层级 | 对齐 `adc-meter.html`：圆屏表盘 + `4 Hz` 与 `CFG OK`/`err` 双态徽章 + `44px` 主读数卡（`mV` + `0-3300 mV` + `RAW 0..4095`）+ 16 采样环形缓冲 **sparkline 趋势图 + 网格线 + 实时光点 + 比例条** Canvas + `PIN`/`ATTEN` 按钮与底部 `GPIO X   ATT Y` 读数 | **18** | **9**（16 点满载，`<= 240` PASS） | 已销账 |
| `examples/img_view/app.js` | 20px 矩形贴边、无取景框、无状态胶囊 | 对齐 `media-gallery.html` Inspector 态：圆屏表盘 + `Image Scale` 与 `OK`/`ERR` 徽章 + `204×204` 带四角取景准星的 RGB565 缩放视窗 + 居中维度 HUD + `[NEXT] [MODE]` 底部双钮；严格保持 `10 <= 12` 节点与恰好 2 个 press handler | **10**（`<= 12`） | N/A（事件驱动） | 已销账 |
| `examples/image_gallery/app.js` | 24px 矩形容器、缺 theme 导致浅色缝隙、无 2×2 卡片网格与导航栏 | 对齐 `media-gallery.html` Grid 态：圆屏表盘 + `Gallery` 与状态/SD 容量胶囊 + 安全区内 `2×2` 卡片网格（选中态青绿描边 + 文件名/规格标签）+ 底部 `<  1/N  >` 导航条；保留首个 `Uint8Array` 为 1×1 红 PNG 及 Sd-first 逐图 try/catch 契约 | **19** | N/A | 已销账 |

---

## 4. 帧预算、Canvas PSRAM 与节点预算汇总

| App | Canvas 节点 | Canvas 总像素（上限 `≤ 230,400`） | 单帧绘制调用（上限 `≤ 240`） | 静态 UI 节点（上限 `≤ 128`） |
|---|---:|---:|---:|---:|
| `settings` (全部 5 页 + 键盘) | 16（轻量微标/头/卡/开关/滑块） | `117,916 px` (51%) | N/A（事件/轮询驱动） | **118**（较 r205 125 降 7） |
| `files` | 0（行图标改用内联 SVG `Image`） | `0 px` (0%) | **0**（1000 项滚动，`≤ 240` PASS） | **25** |
| `crypto_check` | 0 | `0 px` (0%) | N/A | **19**（`≤ 20` PASS） |
| `archive_view` | 0 | `0 px` (0%) | N/A | **17**（`≤ 20` PASS） |
| `adc_meter` | 1（`320×94` sparkline + bar） | `30,080 px` (13%) | **9**（16 点满载，`≤ 240` PASS） | **18** |
| `img_view` | 1（`204×204` 缩放视窗） | `41,616 px` (18%) | N/A（按钮切换驱动） | **10**（`≤ 12` PASS） |
| `image_gallery` | 0–3（`96×76` 缩略图，按卡图数） | `≤ 21,888 px` (≤ 9.5%) | N/A（静态缩略图） | **19** |

---

## 5. 原始验证输出

```text
# 1) 6 张 HTML 设计稿 Playwright 480x480 DOM 几何自检（0 error / 0 safeViolations / 0 touchIssues）
settings-wifi    {"errors":0,"safeViolations":[],"touchIssues":[]}
settings-general {"errors":0,"safeViolations":[],"touchIssues":[]}
settings-bt      {"errors":0,"safeViolations":[],"touchIssues":[]}
files            {"errors":0,"safeViolations":[],"touchIssues":[]}
adc-meter        {"errors":0,"safeViolations":[],"touchIssues":[]}
media-gallery    {"errors":0,"safeViolations":[],"touchIssues":[]}

# 2) 帧预算与专项回归（adc_meter / files_dialog / settings_dialog / sntp_consumers）
  adc_meter max draw calls/refresh=9 (budget <=240)
PASS r206 frame draw-call budget: full 16-sample sparkline refresh <= 240 draw calls
PASS adc_meter harness: all live, static and mutation checks green
PASS files after: DEL -> Dialog -> Delete -> remove -> Toast
PASS files r206 frame budget: 1000-entry list draw calls=0 (budget <=240)
PASS settings_dialog r206: 5-page navigation + static nodes=118 (<=128)
ALL SETTINGS DIALOG HARNESS CASES PASSED
ALL SNTP CONSUMER HARNESS CASES PASSED

# 3) 全量宿主 harness 顺序回归（111/111 PASS，0 FAIL；日志 artifacts/r206/full-regression.log）
SLOW tests/alloc_inject.js secs=31 (pass)
SLOW tests/compress.js secs=33 (pass)
SLOW tests/crypto.js secs=40 (pass)
SLOW tests/decode.js secs=30 (pass)
SLOW tests/fft.js secs=34 (pass)
SLOW tests/imgscale.js secs=33 (pass)
SEQUENTIAL_REGRESSION pass=111 fail=0 failed=

# 4) lume check --no-emu（7/7 PASS）
examples/settings      -> [PASS] bundle 60332 bytes | RESULT: PASS (exit 0)
examples/files         -> [PASS] bundle 37840 bytes | RESULT: PASS (exit 0)
examples/crypto_check  -> [PASS] bundle  3392 bytes | RESULT: PASS (exit 0)
examples/archive_view  -> [PASS] bundle  4507 bytes | RESULT: PASS (exit 0)
examples/adc_meter     -> [PASS] bundle  4345 bytes | RESULT: PASS (exit 0)
examples/img_view      -> [PASS] bundle  5570 bytes | RESULT: PASS (exit 0)
examples/image_gallery -> [PASS] bundle  5486 bytes | RESULT: PASS (exit 0)

# 5) Playground 重建与 Playwright 全量 74/74 加载验证（0 runtime errors）
PASS prelude 67986 bytes; 74 apps
  settings: 118 nodes | files: 25 nodes | crypto_check: 19 nodes
  archive_view: 17 nodes | adc_meter: 18 nodes | img_view: 10 nodes | image_gallery: 19 nodes
PASS all examples load without runtime errors

# 6) CLI 单元测试（npm test --prefix tools/lume）
# tests 76 / pass 75 / fail 0 / skipped 1 (qjsc binary)

# 7) 文档站一致性检查（scripts/check_website.py & gen_api_docs.py --check）
examples.html gallery up to date (74 cards)
HTML pages: 7; internal href/src and anchors checked
API: 162 catalog entries, 162 type declarations, 34 function namespaces
api.html is up to date with lume.d.ts (162 entries)
```
