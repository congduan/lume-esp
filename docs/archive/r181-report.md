# r181 — esp32sim 全扫 8 项 eval 失败收口

基线 `origin/main b749837`（2026-11-24，r180 已推送）。本轮全部证据来自编译器 / 宿主 / esp32sim；**未连接真机，不能据此声称板级验收通过**。

## 1. 结论速览

| 组 | app | 处理 | 结果 |
|---|---|---|---|
| A 大 bundle | abc123 / settings / wordle | 工具侧分帧注入节奏修复 | 三项 `engine recv RELOAD` + `app eval ok` 通过 |
| B 队列满 | aurora_clock / plasma / skycombat | ui-bridge 队满背压 | 三项不再出现 `ui queue full` / InternalError |
| C 单点 | nettest_open | app API 修正 | eval 通过 |
| C 单点 | files | **deferred** | R5/R6 仍失败（详见 §6） |

79-app esp32sim 全扫：`CHECK_COUNT=79 FAIL_COUNT=1`（仅 files），达到简报目标 `FAIL_COUNT ≤ 2` 且三项大 bundle 必须转绿的要求。

## 2. 任务零：CI 时序 flake

`tests/gateway_upstream.js:614` 的 `(truncated)` 断言在 CI 负载下失败：abrupt `res.destroy()` 可能被 fetch 报为 stream error（走 `seal(' (truncated)')` + non-fatal `upstream_error`），也可能被报为 clean EOF（走空 final，无 error frame）。两种都是同一事件在调度下的合法结果，因此断言按实际观察到的路径分支；两条路径共有的不变量（deltas 保序、单一 final、不重试、残句 TTS、音频播完、idle、clean close）仍然严格检查。测试 25 同族处理。

另发现并加固测试 29 的毫秒粒度断言：`frames[2].at < beforeStop` 在两时间戳落入同一毫秒时会误报，改为 `<=`（`waitFor` 在 stop 之前成功已经证明“按到达转发”）。**未放宽成无条件跳过**。本地连跑 3 次 `node tests/gateway_upstream.js`：`ALL GATEWAY UPSTREAM CASES PASSED (37 cases)` ×3，输出在 `artifacts/r181/gateway-upstream-3x.log`。CI 上的复现无法本地强求，取舍即在报告内。

## 3. 任务一：大 bundle reload —— 阈值实证与根因

### 3.1 阈值扫描（合成 bundle，直接注入单帧）

扫描脚本在 `/tmp/lume-r181-scan/scan.js`（诊断用，未入库），构造精确 payload 长度的合法 `LUME` 帧，esp32sim `--max-seconds 12`。原始输出 `artifacts/r181/threshold-scan.log`，失败样本串口全文 `artifacts/r181/emu-before-fix-32768-serial.log`。

| payload | frame | `engine recv RELOAD` |
|---:|---:|:---:|
| 24576 | 24588 | YES |
| 28672 | 28684 | YES |
| 29194 | 29206 | YES |
| 30720 | 30732 | YES |
| 31744 | 31756 | YES |
| **31800** | 31812 | **YES** |
| **32000** | 32012 | **YES** |
| **32200** | 32212 | **NO** |
| 32700–43008 | — | NO |

失效阈值落在 32000–32200 B 之间（约 32 KiB 下沿）。**失效模式是静默丢弃**：串口既无 `frame rejected`（`bad-crc` / `too-large` / `oom`），也无 RELOAD，帧解析器停在 BODY 状态等永远到不齐的字节；8s / 20s 窗口都不过。不是 CRC 错，也不是 256 KiB 帧上限。

### 3.2 根因（先读源码再下结论）

- 固件接收侧：`firmware/components/lume-hotreload/lume_frame.c:193` 的 `lume_frame_parser_feed()` 逐字节喂入，payload 由 `psram_alloc()` 按 `total_len` 动态分配（上限 256 KiB），没有 32 KiB 常量；`lume_hotreload.c:794` 的 USB RX 任务按 128 B 分块读。**不是固件帧上限。**
- CLI 分帧：`tools/lume/protocol.js:42` 的 `build()` 一次生成完整帧，CRC 与长度均正确（失败样本 bundle 与 CRC 可被独立重放验证）。**不是编码错误。**
- 模拟器注入侧：`tools/emu/run.sh:36` 与 `tools/lume/scan.js:182` 把整帧写成一个 `2.5 serial-file <path>` 脚本动作。esp32sim 的补丁动作 `ScriptAction::SerialBytes` 调用 `bus.serial_input(&data)`；其 USB Serial/JTAG 模型 `host_input()`（`esp-periph/src/usb_serial_jtag.rs`）把全部字节切成 64 B 包一次性压入 `rx_packets`，`present_packet()` 只在 FIFO 空时投递下一包，对脚本写入方**没有背压**。一帧大于约 32 KiB 时尾包滞留，解析器永远收不齐。

对照实验（同样固件、同样帧）：把 42,574 B 帧拆成 1 KiB/10 ms（42 片）、4 KiB/10 ms（11 片）、512 B/5 ms（84 片）分别注入，全部 `engine recv RELOAD -> recycle runtime`（`artifacts/r181/threshold-scan.log` 末四行、`artifacts/r181/emu-paced-42574-serial.log`）。因此根因是**注入节奏 / 流控**，而非帧大小阈值本身；r180 观察到的 32 KiB 相关性只是单动作批量注入的表征。CI 慢机上 29 KB 的 files 也会超时，与此同族。

### 3.3 修复与取舍

`tools/emu/run.sh` 与 `tools/lume/scan.js`：把同一帧按 4 KiB 分片、每片间隔 10 ms 写入 `actions.txt`（42 KiB 帧在 ~2.93 s 前全部送达，仍落在标准 8 s 窗口内）。**不改 wire 协议、不改固件、不改 payload 内容**；这是模拟器注入节奏修复，真机 USB Serial/JTAG 由主机驱动分块写入并受硬件流控，不受此路径影响。修复后 abc123 / settings / wordle 均 `engine recv RELOAD` + `app eval ok >= 2`（`artifacts/r181/emu-fixed-{abc123,settings,wordle}-serial.log`）。

## 4. 任务二：ui queue full 背压

`lume_ui_bridge_post()` 原本在 384 槽 Queue A 满时重试 8×2 ms 后返回 -1，JS 收到 `InternalError: lume: ui queue full`。三个失败 app 都卡在 `LUME_OP_CANVAS_DRAW`（plasma/skycombat）或同节点的批量绘制：`Canvas.onDraw` 每帧输出几十到数百条 draw / batch 记录，快于 LVGL 任务栅格化速度。

修复（`firmware/components/lume-ui-bridge/lume_ui_bridge.c`）：当 canvas 相关 op 重试后仍满，从队列头回收最多 64 条**同节点的**过期 draw / invalidate / batch 记录（batch 的 `image_pixels` 和 `text_heap` 按 `drain()` 完全相同的路径释放，杜绝泄漏）；非过期记录临时扣留（上限 16 条）并在结尾按原顺序 `xQueueSendToFront()` 还原，不会丢单或乱序；每次 bridge init 仅打一条 high-water 告警（`ui queue high-water: dropped N stale canvas draws`），不刷屏。CREATE/REMOVE/IMAGE_SOURCE/RAYCAST 等持有活跃状态的记录永不回收。

- **不改协议记录 / OP ID**：`tests/bridge_protocol.c` 的 `_Static_assert` 编译运行通过。
- **不回退 20 行 buffer 基线，不放大 DIRAM**：静态内存仅多 1 个 bool（+8 B 对齐噪声：247,523 → 247,531 B）；IRAM 仍为 16384 / Remain 0（`artifacts/r181/idf-size.log`）。
- 语义取舍：持续过载时最多牺牲一帧的过期画布绘制（视觉降级），换取 JS 不再抛异常；下一帧会全量重绘覆盖。
- 修复后三 app 串口均为 `QFULL=0, HWARN=1`（各一条告警），见 `artifacts/r181/emu-fixed-{aurora_clock,plasma,skycombat}-serial.log`。

## 5. 任务三：nettest_open

`examples/nettest_open/app.js` 用了两个不存在的 API：`Text(...)` 返回节点 id（不支持 `.set()`），以及 `console.log`（运行时只有 `lume.log`）。改成 `var status = signal('BOOT')` + `Text({ text: status })` + `lume.log(...)`，与 `examples/net_check/app.js` 一致。esp32sim check 从 `TypeError: not a function` 转为 PASS（`artifacts/r181/check-nettest_open-{before,after}.json`）。

## 6. files R5/R6（deferred）

app eval 通过，纯布局断言：`check_layout.py` 用 ROI 内精确 RGB565 色块测 bbox。`R5 list/del: vertical gap 36`（允许集 4/8/12/16/24/32 ±1），`R6` 底部三个按钮与 row_delete 的实心色块高度 43–44（阈值 56），原因是底部行被根容器 padding 边界裁切。尝试过 `justifyContent: 'space-between'` 改 `start`、调整 `LIST_H`、marginTop、绝对定位、去掉圆角等 app 层改法：有的把列表推到 gap 88，有的把按钮裁到 25 px，均无法在不同时改弱断言的前提下同时满足 R5/R6。**保留原 app 与断言不动**，记为 deferred（不影响 FAIL_COUNT 目标）。

## 7. 验证汇总（宿主 / 模拟器证据）

| 项目 | 结果 | 原始输出 |
|---|---|---|
| 阈值扫描 | 32000 YES / 32200 NO； pacing 后 42574 YES | `artifacts/r181/threshold-scan.log` |
| `idf.py build` / `make -j2 all` | EXIT=0（ui-bridge 改动后） | `artifacts/r181/build-ui-backpressure-final.log` |
| `idf.py size` | IRAM 16384 / Remain 0；DIRAM 247531 / remain 94229 | `artifacts/r181/idf-size.log` |
| 79-app esp32sim 全扫 | `CHECK_COUNT=79 FAIL_COUNT=1`（files） | `artifacts/r181/check-all-emu-summary.log` + `check-emu-*.json` |
| gateway_upstream 3 连跑 | 37 cases ×3 PASS | `artifacts/r181/gateway-upstream-3x.log` |
| 全量 host harness | `TEST_COUNT=101 FAIL_COUNT=0` | `artifacts/r181/host-all-summary.log` |
| `npm test --prefix tools/lume` | 52 pass / 0 fail | `artifacts/r181/npm-test.log` |
| `node tests/ota_consumers.js` | ALL PASS（守卫重钉仅接纳本轮具名对象） | `artifacts/r181/ota_consumers.log` |
| `python3 scripts/check_website.py` | 7 页、API 161/161、none ×4 | `artifacts/r181/website-check.log` |
| playground rebuild 幂等 | `node tools/playground/build.mjs` EXIT=0，无跟踪文件变化 | `artifacts/r181/playground-build.log` |
| emu.yml capture 四连跑 | counter/files/games_2048/gravity_ball 各 RELOAD=1, eval ok=2 | `artifacts/r181/capture-4run.log` |

守卫重钉只向 allowlist 加入本轮具名对象（`lume_ui_bridge.c`、`tools/lume/scan.js`、gateway/nettest 测试、r181 报告与 artifacts/r181/），断言语义与逐字节谓词未改。

## 8. Deferred（非本轮验收范围）

- 真机显示 / 触摸 / 睡眠电流 / 射频 / 音频 / 持久化 / 撕裂：全部 deferred，esp32sim 执行时间不等于物理板耗时。
- files R5/R6 布局断言（§6）；flapdot 浏览器 `--visual` draw budget（r180 已记录 2072/3736/6856 次）。
- esp32sim USB 包投递为何在约 32 KiB 触发滞留（中断级时序）只做到实证与 pacing 绕开，未反编译模拟器内部调度；wire 协议与固件接收侧已排除。
- CI 三连败中的 Pages artifact API 瞬时故障由主控 rerun，与本轮无关。
- `examples/slots/` 与 `examples/gunship/` 是上一会话未跟踪半成品，按简报未改动、未 commit。
