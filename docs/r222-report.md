# r222 报告：USB CDC 推包链路 load 下可靠性（roadmap rendering-backlog #5）

## 0. 基线与诚实口径

- **基线**：`origin/main` `4e89f47`（2026-11-28，r221 已合入），工作树 `/tmp/lume-r222-wt`，分支 `r222-usb-cdc-reliability`，开工时工作树干净。
- **固件 size 基线**：r221 产出的 `artifacts/r221/firmware-build-size.log`（`Total image size: 3038535 bytes`，Flash Code `2044124` B，DIRAM `247159` B / Remain `94601` B，IRAM `16384/16384` B）。
- **改动面**：严格限于简报红线内的 `tools/lume/transport.js`、`tools/lume/lume.test.js`、`firmware/components/lume-hotreload/lume_hotreload.c`、`tests/ota_protocol.c`、`docs/r222-report.md`、`docs/KNOWN-SIMPLIFICATIONS.md`、`artifacts/r222/`。**未动** prelude JS、`lume-engine`、`lume-ui-bridge`、`lume_frame.h/.c`、vendored（`quickjs-ng/`、`lvgl/`）、`runtime/`、`examples/`、`website/`。
- **诚实口径**：本轮全部验收依据为**宿主机可执行证据（`tests/ota_protocol.c` 700 轮随机丢/插/翻字节 fuzz 63/63 PASS、`tools/lume/lume.test.js` mock serial port 分块/节流/重试单测 81/81 PASS、`tests/apps_protocol.c` 52/52 PASS、111 份 `tests/*.js` 全量回归 0 FAIL、`lume check examples/counter --no-emu` PASS、`ADDED_NON_ASCII=0`）与 ESP-IDF `idf.py build`（`lume_hotreload.c` 0 warning）+ `idf.py size`**。**未进行真机带载推包端到端验收——480×480 AMOLED 板上全帧率渲染并发 USB CDC 推包吞吐、真实 USJ RX ring 水位、WiFi/BLE 共存下的内部 DMA 余量、以及 `screenshot` 截断真机复测全部 deferred 至 board bring-up，本报告不构成硬件验收。**

---

## 1. 任务一实证诊断：host -> device 推包 load 丢字节根因

逐层核实 ESP-IDF v5.5.5 驱动源码、固件 `lume-hotreload` 与 host CLI `transport.js` 后，确认 push 链路在渲染满载下的 `frame rejected: bad-crc` 与 `launch ACK timeout` 由**四层耦合问题**共同导致（而 `screenshot payload truncated` 属反向 device -> host 独立根因，见 §3）：

### 1.1 第一层（驱动/硬件）：USJ ISR 无 USB OUT 背压，RX ring 满直接静默丢 64 B 包

实证源码 `/opt/esp/esp-idf/components/esp_driver_usb_serial_jtag/src/usb_serial_jtag.c:144-155`：
```c
if (usbjtag_intr_status & USB_SERIAL_JTAG_INTR_SERIAL_OUT_RECV_PKT) {
    usb_serial_jtag_ll_clr_intsts_mask(USB_SERIAL_JTAG_INTR_SERIAL_OUT_RECV_PKT);
    uint8_t buf[USB_SER_JTAG_RX_MAX_SIZE]; // 64 bytes
    uint32_t rx_fifo_len = usb_serial_jtag_ll_read_rxfifo(buf, USB_SER_JTAG_RX_MAX_SIZE);
    xRingbufferSendFromISR(p_usb_serial_jtag_obj->rx_ring_buf, buf, rx_fifo_len, &xTaskWoken);
}
```
- ISR 每次收到 USB OUT 包都**无条件读空 64 B 硬件 RX FIFO**（导致 USB 外设立刻向主机 ACK，继续接收后续 64 B 包，全速 USB 突发速率可达 ~800 KB/s ≈ 1 KB/ms），随后调用 `xRingbufferSendFromISR()` **且忽略返回值**。
- 一旦软件 `rx_ring_buf` 满，整包 64 B 数据被**静默丢弃**，主机完全无感知。

### 1.2 第二层（固件调度/缓冲）：`usb_rx_task` 优先级低于渲染/JS 任务 + RX 缓冲仅 1024 B

实证源码：
- `firmware/components/lume-hotreload/lume_hotreload.c:90-91, 827-828`：`USJ_RX_BUFFER = 1024` B（仅容纳 ~16 个 USB 64 B 包 ≈ ~1 ms 全速突发）、`USB_RX_CHUNK = 128` B、`usb_rx_task` 优先级 **`4`**（未绑核）。
- `firmware/components/lume-board/lume_board.c:367`：`lvgl_task`（`lume-lvgl`）优先级 **`5`**（未绑核；全帧 Canvas 渲染 + QSPI 刷屏耗时 10–42 ms）。
- `firmware/components/lume-engine/lume_engine.c:4875`：`engine_task`（`lume-js`）优先级 **`5`**（绑 Core 1；满帧 app 持续跑 JS tick/draw）。
- `firmware/components/lume-audio/lume_audio.c:106, 340`：音频 worker 优先级 **`5`**。
- **因果链**：app 全帧率运行时，Core 1 被 prio 5 的 `lume-js` 占满，Core 0 被 prio 5 的 `lume-lvgl`（以及更高优的 timer/WiFi 任务）占满，prio 4 的 `usb_rx_task` 被饿死数毫秒乃至数十毫秒 -> 1024 B 的 `rx_ring_buf` 在 1–2 ms 内溢出 -> 64 B 块静默丢失。

### 1.3 第三层（主机突发写入 + 缺失拒绝识别/重试）：单次全量灌包 + 忽略 `LUMC` 的 `RELOAD ERR`

实证源码 `tools/lume/transport.js`：
- `write()`（原 L113-117）：将整个 payload（5–256 KiB）一次性 `port.write(bytes)` + `drain()`，直接把 USB 突发打满，瞬间冲垮 1024 B RX ring。
- **已核实固件确实会回送否定确认**：`lume_hotreload.c:782-785` 在 `LUME_FRAME_EV_ERR`（`bad-crc`/`bad-magic`/`empty`/`too-large`/`oom`）时会调用 `reply_line(sink, false, len, reason)`，向主机回送 **`RELOAD ERR <reason>\n`**（不论出错帧是 `LUME`/`LUMB`/`LUMC`/`LUMR`）。
- **已核实 `transport.js` 的两处缺陷**：
  1. **无任何重试逻辑**：收到 `RELOAD ERR bad-crc` 或超时直接失败。
  2. **`LUMC` / `shot` / `repl` 忽略帧级 `RELOAD ERR`**：`consumeLine()`（原 L44-98）仅在 `pending.kind === 'bundle' || 'launch'` 时匹配 `RELOAD_LINE`。当大包 `LUMC STORE`（`pending.kind === 'cmd'`）发生丢字节并触发设备 `RELOAD ERR bad-crc\n` 时，`transport.js` 将其当普通日志忽略，硬等 **15 s `ACK_TIMEOUT_MS`** 才超时。

### 1.4 第四层（协议状态机与并发互斥核实）：丢字节导致 `ST_BODY` 永久卡死 + 吞噬下一帧（`launch ACK timeout`）

- 实证 `firmware/components/lume-hotreload/lume_frame.c:266-297` 与 `include/lume_frame.h:49`（`"There is NO frame timeout."`）：
  - 若某帧头已完整解析（进入 `LUME_FRAME_ST_BODY` 并按 `payload_len` 分配了 PSRAM 缓冲），但 payload 中途丢失 `D` 字节（如 64 B），parser 停在 `payload_n = payload_len - D` **永不超时**，既不释放 PSRAM，也不回发任何 `RELOAD ERR`。
  - 主机在 15 s 后超时，或下一条短指令（如 `LAUNCH\t<id>`，仅 ~20 B < 64 B）紧接着发来时，整条 `LAUNCH` 被旧帧的 `ST_BODY` 吞进尾部，仍未凑满 `payload_len` -> **零回包 -> `launch ACK timeout`**；若凑满 `payload_len`，则旧帧报 `bad-crc` 进入 `ST_RESYNC`，而新帧头部已被吞噬 -> 同样丢帧超时。
- **互斥/tail-drop 语义核实**（`lume_hotreload.c:107-132, 736-748`）：`s_pending_mutex` 是递归互斥锁，跨 `pending_push(sink)` + `lume_engine_request_reload()` 持有；若引擎同步回调 `on_engine_result("superseded")` 重入该锁，FIFO 头部按顺序弹出被覆盖帧的 sink；若 `request_reload` 返回非 0（如 `stage-oom`），在释放锁前调用 `pending_drop_tail()` 撤销本次尾部入队，避免 USB/OTA 双通道并发交错误删对方 sink。该机制无缺陷，本轮保持原样。

---

## 2. 本轮修复方案（按实证分层落地）

坚持最小侵入度原则，**不改 `lume_frame.h/.c` 线协议与结构体布局**，在 host 与 firmware 两侧协同修复：

### 2.1 Host 侧（`tools/lume/transport.js`）

1. **分块节流写入**：
   - 新增导出常量与可配置参数：`DEFAULT_CHUNK_SIZE = 256` B、`DEFAULT_CHUNK_DELAY_MS = 4` ms、`DEFAULT_MAX_RETRIES = 2`、`DEFAULT_RESYNC_DELAY_MS = 50` ms、`RESYNC_PREAMBLE = Buffer.alloc(12, 0xff)`。
   - `write()` 将 payload 按 `<= chunkSize` 切片，每片 `port.write()` + `drain()`，片间等待 `chunkDelayMs`（最后一片不等待，因此 `LAUNCH`/`LIST`/`PAUS` 等小帧零额外延迟）。256 B/4 ms 峰值仅占旧固件 1024 B RX ring 的 25%（新固件 4096 B 的 6.25%），持续吞吐 ~64 KB/s（32 KiB 约 0.5 s）。
   - 请求提前 settle（如设备提前回 `RELOAD ERR` 或串口断开）时通过 `shouldAbort` 立即中止剩余分片写入。
2. **全帧类型识别帧级拒绝 + 有界重试 + resync 前导**：
   - `consumeLine()` 为 `cmd` / `shot`（收到 `SHOT` 头前）/ `repl`（收到 `REPL` 头前）以及 `bundle` / `launch` 统一识别帧层拒绝 `RELOAD ERR <bad-crc|bad-magic|empty|too-large|oom|timeout>`，不再对 `LUMC STORE` 丢包傻等 15 s。
   - 仅对可恢复的传输层故障（`bad-crc`、`bad-magic`、`timeout` 以及允许超时重试的请求）在 `port.isOpen` 时执行有界重试（默认最多重试 `2` 次，共 `3` 次尝试）；`eval-failed`、`stage-oom`、`fwt-mismatch`、`CMD ERR ...`、串口断开等语义/硬件错误**立即失败、0 重试**；`repl` 仅在解析层拒绝（表达式未执行）时重试，主机超时不重试以防副作用重放。
   - 每次重试前在 `pending === null` 期间先发送 `RESYNC_PREAMBLE`（12 字节 `0xFF`）并等待 `resyncDelayMs` 吸收前导可能触发的 `RELOAD ERR bad-magic/too-large`：在 `ST_RESYNC` 下静默忽略，在 `ST_MAGIC` 下触发 `bad-magic -> ST_RESYNC`，在 `ST_HDR`（`hdr_n <= 3`）下强制 `total_len >= 0xFF000000 -> too-large -> ST_RESYNC`（不分配 PSRAM）。
   - 抽离并导出 `attachPort(port, selected, options)`，`openPort()` 保持原签名向后兼容，Node 单测可直接注入 mock `EventEmitter` 串口对象覆盖全路径。

### 2.2 Firmware 侧（`firmware/components/lume-hotreload/lume_hotreload.c`）

1. **RX 缓冲与读取块扩容**：`USJ_RX_BUFFER` `1024 -> 4096` B（+3 KiB 启动期内部堆，吸收 64 个 USB 64 B 包 ≈ 4 ms 突发），`USB_RX_CHUNK` `128 -> 256` B（复用既有 8192 B 任务栈，对齐 host 分片大小）。保留 `USJ_TX_BUFFER = 512` B 不额外占内部 RAM。
2. **RX 任务优先级上调**：`USB_RX_PRIO` 由 `4 -> 6`（高于 `lume-lvgl` / `lume-js` 的 `5`）。无 USB 数据时阻塞在 `usb_serial_jtag_read_bytes()` 零 CPU 占用；有包到达时 ISR 立即唤醒并优先抢占把数据拷入 PSRAM，消除渲染负载下的 RX ring 饿死。
3. **帧间空闲超时自恢复**：在 `usb_rx_task` 既有的 `20 ms` 读超时循环中，当 `s_usb_parser` 停留在半帧状态（`ST_HDR`、`ST_BODY` 或 `ST_MAGIC && magic_n > 0`）且超过 `USB_RX_FRAME_TIMEOUT_MS = 1000 ms` 无新字节到达时，主动释放已分配的 PSRAM 暂存缓冲（消除 256 KiB 级内存泄漏）、重置 `s_usb_parser` 到 `ST_MAGIC`，并回送 `RELOAD ERR timeout\n` 让 host 快速 resync 重试（~1 s 恢复，而非 15 s 死等或吞噬下一条 `LAUNCH`）。

### 2.3 协议层 Fuzz（`tests/ota_protocol.c` §8）

新增固定种子（`0x222cafe1`）可复现 fuzz 套件，覆盖全部 4 种帧类型（`LUME`/`LUMC`/`LUMB`/`LUMR`）及内嵌伪 magic 载荷：
- `8a`：200 轮随机 1..6 字节位翻转 + resync 恢复；
- `8b`：200 轮随机 1..64 字节连续丢包（模拟 USJ 64 B FIFO/ring 丢包）+ 刷空恢复；
- `8c`：200 轮随机 1..32 字节插入 + resync 恢复；
- `8d`：100 轮多帧混合噪声/截断/坏帧混沌流 + 末帧哨兵恢复；
- `8e`：显式 `ST_BODY` 缺 64 B 空闲超时复位恢复 + 零泄漏校验（`alloc_count == free_count`）。
- 断言：跨 700 轮试验 **`bad_delivered == 0`**（CRC-32 层永不放行坏帧）、全部恢复率 100%、`allocs == frees == 1481`。

---

## 3. 任务二归因：`screenshot payload truncated 456240 != 460800`（仅诊断，本轮不修）

`screenshot` 截断是 **device -> host 反向大数据流问题**，与任务一（host -> device）独立。

### 3.1 关键算术证据

- 480×480 RGB565 整帧 = `480 × 480 × 2 = 460,800` B。
- `handle_shot()`（`firmware/components/lume-hotreload/lume_hotreload.c:327, 373-391`）按 `SHOT_CHUNK = 240` B 切块，共发送 `1,920` 行 `S64<320 base64>\n`（每行 **324 B**，总计 ~622 KiB）。
- 实测截断差值：`460,800 - 456,240 = 4,560` B = **`19 × 240` B** —— **精确丢失 19 整行 `S64`**，而非随机单字节损坏。

### 3.2 两条直接导致「整行 240 B 丢失」的源码根因

1. **TX ring 过小 + 50 ms 全有或全无静默丢行（主因）**：
   - `USJ_TX_BUFFER = 512` B（`lume_hotreload.c:92`），单行 `S64` 占 `324` B，TX ring 内**同一时刻最多只能容纳 1 行**（余量仅 `188` B < `324` B）。
   - `reply_write()`（`lume_hotreload.c:139-142`）调用 `usb_serial_jtag_write_bytes(line, 324, pdMS_TO_TICKS(50))`。查看 IDF `usb_serial_jtag.c:281` 可知 `xRingbufferSend()` 为 **all-or-nothing**：只要满帧运行下主机 USB IN 轮询稍有抖动或 `ESP_LOG` 占用 >188 B 导致 50 ms 内凑不出 324 B 连续空位，`write_bytes` 返回 `0`，**整行 324 B（= 240 B 原始像素）被丢弃**。
   - `handle_shot()` **不检查 `reply_write()` 失败**，循环照常跑完并仍发出 `SHOT OK\n`；且 `reply_write()` 失败时打印的 `ESP_LOGE` 本身又向同一 VFS TX ring 灌入日志，雪上加霜。
2. **VFS `ESP_LOG` 绕过 `s_tx_mutex` 逐字符穿插，破坏 `^S64...$` 行首锚点（次因）**：
   - `usb_serial_jtag_vfs_use_driver()` 将 `ESP_LOG*` 路由到同一 USJ 驱动，但 `usb_serial_jtag_vfs.c:194-205` 使用 VFS 私有的 `s_ctx.write_lock` 逐字符调用 `usb_serial_jtag_write_bytes(&c, 1, ...)`，**不持有 `lume_hotreload.c` 的 `s_tx_mutex`**。
   - 当高优任务（`lume-lvgl`/`lume-js`）在输出日志行半途被切换、或与 `reply_write("S64...\n", 324)` 交错时，线路上出现 `<log prefix>S64<base64>\n` 或行中插入日志。
   - `tools/lume/shot.js:15, 29` 的 `SHOT_DATA = /^S64([A-Za-z0-9+/=]+)$/` 严格锚定行首行尾，此类被污染行会被 `filter(Boolean)` **静默丢弃整行（同样精确丢 240 B）**，最终触发 `screenshot payload truncated`。

### 3.3 建议后续修复方向（留待后续独立刀）

- `reply_write()` 改为带重试/更长超时（或返回 `bool`）并在 `handle_shot()` 发送失败时中止改发 `CMD ERR shot-tx`（绝不发假 `SHOT OK`）；
- 适当增大 `USJ_TX_BUFFER`（如 `512 -> 1024/2048` B）或在 `handle_shot` 中每发若干行短暂让出；
- 消除 `S64` 与 VFS 日志的行内交错（例如对 `S64` 行前后加 `\n` 防行首粘连，或在 `SHOT` 期间短暂停用/加锁 VFS 日志输出）。

---

## 4. 验收表与原始输出指针（`artifacts/r222/`）

| # | 验收项 | Artifact 指针 | 原始实测结果 |
|---|---|---|---|
| 1 | 协议层 fuzz + 既有 OTA 协议 C harness（`node tests/ota_auth.js`） | `artifacts/r222/ota-protocol-fuzz.log` | `63 checks, 0 failures -> PASS`；`flip=200/200 drop=200/200 ins=200/200 stream=100/100 bad_delivered=0 allocs=1481 frees=1481` |
| 2 | CLI 单测（含 5 条新增 mock serial port 分块/节流/重试用例） | `artifacts/r222/npm-test-lume.log` | `81 pass / 0 fail / 0 skip`（r221 为 76 -> r222 为 81，+5 条 `r222 transport` 用例） |
| 3 | 全量 JS 宿主回归（`for t in tests/*.js`） | `artifacts/r222/regression-after.log` | `REGRESSION DONE pass=111 fail=0`（含全部 21 份 `R166_ALLOWED` 围栏守卫，0 修改守卫） |
| 4 | `apps_protocol.c` C11 `-Wall -Wextra -Werror` 编译运行 | `artifacts/r222/apps-protocol.log` | `52 checks, 0 failure(s)` |
| 5 | `idf.py build` + `idf.py size`（ESP-IDF v5.5） | `artifacts/r222/firmware-build-size.log` | `BUILD_SIZE_EXIT=0`；`lume_hotreload.c` 0 warning；见 §4.1 size 增量表 |
| 6 | `lume check` 哨兵 | `artifacts/r222/lume-check-counter.log` | `lume check examples/counter --no-emu` -> `RESULT: PASS (4 steps, 0 failed; exit 0)` |
| 7 | ASCII 纪律检查 | `artifacts/r222/ascii-check.log` | `ADDED_NON_ASCII=0`（覆盖 `firmware/`、`tools/`、`tests/` 全部新增行） |

### 4.1 固件 `idf.py size` 基线对比（`artifacts/r222/firmware-build-size.log` vs `artifacts/r221/firmware-build-size.log`）

| Memory Type / Section | 基线 (r221 / `4e89f47`) | r222 | 增量 (Delta) |
|---|---:|---:|---:|
| **Flash Code (`.text`)** | `2,044,124` B | `2,044,308` B | **+184 B** |
| **Flash Data (`.rodata` + `.appdesc`)** | `853,156` B (`852,900` + `256`) | `853,236` B (`852,980` + `256`) | **+80 B** |
| **DIRAM（静态）** | `247,159` B (`72.32%`, Remain `94,601`) | `247,159` B (`72.32%`, Remain `94,601`) | **+0 B**（注：运行期动态内部堆 `+3,072` B，栈内 `+128` B） |
| **IRAM** | `16,384` / `16,384` B (`100.0%`, Remain `0`) | `16,384` / `16,384` B (`100.0%`, Remain `0`) | **+0 B**（零 `IRAM_ATTR`） |
| **RTC FAST / SLOW** | `72` / `32` B | `72` / `32` B | **+0 B** |
| **Total image size** | `3,038,535` B (`lume.bin` `0x2e5dc0`) | `3,038,799` B (`lume.bin` `0x2e5ed0`) | **+264 B** |

---

## 5. 提交拆分与范围纪律

本地分支 `r222-usb-cdc-reliability`（未 push），按 `feat` / `test` / `docs` 拆 commit：
1. `feat(hotreload): harden USB CDC push reliability with chunking, retry, RX buffer/priority and idle timeout`（`tools/lume/transport.js`、`firmware/components/lume-hotreload/lume_hotreload.c`）
2. `test(hotreload): add frame-codec drop/insert/flip fuzz and mock-serial chunk/retry tests`（`tests/ota_protocol.c`、`tools/lume/lume.test.js`）
3. `docs(r222): record USB CDC reliability diagnosis, screenshot attribution and verification artifacts`（`docs/r222-report.md`、`docs/KNOWN-SIMPLIFICATIONS.md`、`artifacts/r222/`）
