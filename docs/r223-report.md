# r223 报告：device->host screenshot TX 链路修复 + device `screenshot --scan N` 工具化

## 0. 基线与诚实口径

- **基线**：`origin/main` `1ba6394`（2026-11-28，r222 已合入），工作树 `/tmp/lume-r223-wt`，分支 `r223-shot-tx-reliability`，开工时工作树干净。
- **固件 size 基线**：r222 产出的 `artifacts/r222/firmware-build-size.log`（`Total image size: 3038799 bytes`，Flash Code `2044308` B，Flash Data `853236` B，DIRAM `247159` B / Remain `94601` B，IRAM `16384/16384` B）。
- **动手前实证核对（假设先核实）**：
  1. `lume_hotreload.c` 行号经 r222 改动后已移位：`USJ_TX_BUFFER = 512` 位于 L95（原引 L92），`reply_write()` 位于 L137-154（原引 L139-142），`handle_shot()` 位于 L333-395（原引 L327, 373-391）。两项根因代码事实与 r222 §3 完全一致。
  2. `tools/lume/scan.js` 与 `tools/lume/lume.js` 已存在 r49 落地的 **esp32sim 专用** `lume screenshot --scan <N> <app-dir> [--json]`，但此前不支持真机串口/OTA（传 `--port`/`--host` 仍强制走 esp32sim 且强校验 `<app-dir>` 必填）。本轮在不破坏既有 esp32sim `--scan` 与 `scan.test.js` 的前提下，扩展真机通道 `scanDevice()` 与 CLI `--port`/`--host` 路径。
  3. 复查 ESP-IDF v5.5.5 驱动源码：`driver/usb_serial_jtag.h` 未暴露 TX ring 剩余空间查询函数，但提供有界等待的 `usb_serial_jtag_wait_tx_done(ticks_to_wait)`；`usb_serial_jtag.c:272-288` 持 `tx_mux` 原子写入整行 324 B，因此单条 `S64` 行不会被 VFS 拆开在中间插字节，而是 `usb_serial_jtag_vfs.c:195-205` 逐字符写日志时把日志前半段粘在 `S64` 行首；`firmware/sdkconfig` 启用 `CONFIG_LOG_VERSION=1`，`esp_log_set_vprintf()` 通过原子指针交换拦截全部 `ESP_LOG*`。
- **改动面红线**：仅涉及 `firmware/components/lume-hotreload/`（`include/lume_cmd.h`、`lume_cmd.c`、`lume_hotreload.c`）、`tools/lume/`（`shot.js`、`transport.js`、`ota.js`、`scan.js`、`lume.js`、`lume.test.js`）、`tests/`（新增 `shot_tx.c`、`shot_tx.js`，及 20 份 `R166_ALLOWED` 围栏补登 `tools/lume/shot.js`）、`docs/`（`r223-report.md`、`KNOWN-SIMPLIFICATIONS.md`）、`artifacts/r223/`。**未动** prelude JS、`lume-engine`、`lume-ui-bridge`、`lume_frame.h/.c`、vendored、`runtime/`、`examples/`、`website/`、`docs/roadmap.md`。
- **诚实口径**：本轮全部验收证据为**宿主机可执行测试（C11 `tests/shot_tx.c` 25/25 PASS、`tests/apps_protocol.c` 52/52 PASS、`npm test --prefix tools/lume` 87/87 PASS、112 份 `tests/*.js` 全量回归 0 FAIL、`lume check examples/counter --no-emu` PASS、`ADDED_NON_ASCII=0`）与 ESP-IDF `idf.py build`（`lume-hotreload` 0 warning）+ `idf.py size`**。**未进行真机串口/OTA 端到端连拍验收——480x480 AMOLED 板上全帧率渲染并发 `SHOT` 吞吐、真实 USJ TX ring 水位、以及真机 `lume screenshot --scan N --port` 实测全部留待主控接板轮，本报告不构成硬件验收。**

---

## 1. 任务一：firmware device->host screenshot TX 链路修复

### 1.1 `reply_write()` 返回 `bool` + 有界重试 + TX ring 水位评估

- 将可复用的有界重试写入状态机抽入既有无 RTOS 依赖的 `firmware/components/lume-hotreload/lume_cmd.c`（声明在 `include/lume_cmd.h`），供固件 `lume_hotreload.c` 与宿主单测 `tests/shot_tx.c` 共用同一份 C 实现：
  - `lume_tx_write_retry(buf, len, max_retries, ops)`：
    - 正常快速路径（首写成功）零额外开销（0 次 drain、0 次 delay）。
    - USB 方向（`LUME_TX_USB_WRITE_MS = 50 ms`，`LUME_TX_USB_MAX_RETRIES = 4`，最多 5 次尝试）：当 `usb_serial_jtag_write_bytes()` 因 TX ring 满返回 `0` 时，重试前先调用 `usb_serial_jtag_wait_tx_done(pdMS_TO_TICKS(20))` 等待 TX ring 排空（水位回落）；若排空成功立即重试，若仍未排空则短退避 `vTaskDelay(pdMS_TO_TICKS(10))` 让出 CPU 后再试。单次 `reply_write()` 最坏总预算 `50 + 4 * (20 + 10 + 50) = 370 ms`，严格有界，不触发 WDT 也不阻塞 15 s CLI 超时。
    - TCP 方向（`LUME_TX_TCP_MAX_RETRIES = 4`）：支持部分写（`0 < w < len`）继续发送剩余字节，对 `EINTR`/`EAGAIN`/`EWOULDBLOCK` 有界重试，对致命错误（`< 0` 或对端关闭）0 重试立即失败。
  - `reply_write()` 仅在全部重试耗尽后才打印一条 `ESP_LOGE`（且 USB `handle_shot` 期间日志已静默，避免向拥塞的 TX ring 二次灌入日志）。

### 1.2 `handle_shot()` 逐行检查发送结果：失败改发 `CMD ERR shot-tx`，绝不发假 `SHOT OK`

- 在 `lume_cmd.c` 实现便携的 `lume_shot_stream(frame, width, height, ops, failed_offset)`，`lume_hotreload.c:handle_shot()` 直接调用：
  - `SHOT` 头、每条 `S64` 数据行、`SHOT OK` 尾逐条检查 `write_line()` 返回值。
  - 任意一行发送失败即**立刻中止循环**，补发尽力而为的 `\nCMD ERR shot-tx\n` 并返回 `LUME_SHOT_ERR_TX`，**绝不发送 `SHOT OK`**；编码失败同样中止并发送 `\nCMD ERR shot-encode\n`。
- Host 侧（`tools/lume/shot.js`、`transport.js`、`ota.js`）：
  - `shot.js` 新增导出 `formatShotError(reason)`：对 `shot-tx` 给出清晰报错 `device rejected screenshot: shot-tx (device TX timed out while streaming frame; no partial image returned)` 并附 `err.shotReason = 'shot-tx'`；`decodeShot()` 亦识别残留 `CMD ERR <reason>` 行。
  - `transport.js` 与 `ota.js` 统一通过 `formatShotError()` 抛出错误；`ota.js` 的 `collect()` 起始谓词同时匹配 `^CMD ERR `，避免 `SHOT` 头前报错时傻等 15 s 超时。

### 1.3 `USJ_TX_BUFFER` 512 -> 2048 B

- `firmware/components/lume-hotreload/lume_hotreload.c:95` 将 `USJ_TX_BUFFER` 从 `512` 扩至 `2048` B（同时容纳约 6 条 325 B 的 `S64` 行，避免旧配置下 188 B 余量不足一行的紧耦合停顿）。
- 内存代价：静态 DIRAM `+0 B`（剩余仍 `94,601 B`），运行期驱动安装时动态内部堆 `+1,536 B`。

### 1.4 消除 `S64` 与 VFS `ESP_LOG` 行内交错：方案对比与取舍

基于 ESP-IDF v5.5.5 源码实证，对比两种候选方案：

| 方案 | 原理 | 优点 | 缺陷/风险 |
|---|---|---|---|
| **方案 A（本轮采用）：USB `handle_shot` 期间 `esp_log_set_vprintf` 短暂静默 + 协议行首 `\n` 边界** | 进入 USB `handle_shot` 前原子替换 `esp_log_set_vprintf(shot_quiet_vprintf)` 并 `wait_tx_done(20ms)` 排空在途日志；每条 `SHOT`/`S64`/`SHOT OK`/`CMD ERR` 均带前导 `\n`；退出时无条件恢复原 `vprintf` | 1. 彻底消除日志字符与 `S64` / `SHOT OK` / `CMD ERR` 的行首粘连；<br>2. 同时消除 VFS 逐字节 `tx_mux` 争抢与 TX ring 拥塞；<br>3. 无锁（原子指针交换 + 空返回函数），零死锁风险；<br>4. 仅 ~15 行改动，向后兼容旧版 CLI | 约 0.6-1.5 s 截图传输期间其他任务的 `ESP_LOG` 被丢弃（仅影响调试串口日志，不影响业务逻辑）；直接 `printf()` 不走 `ESP_LOG`（由前导 `\n` 兜底行首隔离） |
| **方案 B（否决）：仅加 `\n` + `shot.js` 放宽正则匹配行中 `S64`** | 保留并发日志输出，靠放宽正则在被污染行中提取 `S64...` | 不丢传输期日志 | 1. 日志逐字节打断处若最后一个字符在 `[A-Za-z0-9+/=]`（如 `I (12) lS64...`），无法可靠区分边界；<br>2. Base64 正文本身可包含 `S64` 子串，宽松正则存在误截断风险；<br>3. 无法防止日志前缀粘连到 `SHOT OK` 或 `CMD ERR shot-tx` 导致主机超时；<br>4. 仍保留 VFS 逐字符争抢 `tx_mux` 与 TX ring |

综上选择**方案 A（`esp_log_set_vprintf` 静默 + 前导 `\n` 边界）**，同时 `shot.js` 保持严格锚定 `/^S64([A-Za-z0-9+/=]+)\r?$/`（仅容忍可选 `\r`），避免误匹配污染载荷。

---

## 2. 任务二：device `lume screenshot --scan N` 模式（roadmap rendering-backlog #8）

- 现状核实：`tools/lume/scan.js` 已有 r49 面向 `esp32sim` 的 `lume screenshot --scan <N> <app-dir> [--json]`。
- 本轮新增面向真实设备通道（USB Serial / WiFi OTA）的 `scanDevice(device, options, deps)`（`tools/lume/scan.js`）及 `rgbFromRgb565()`（`tools/lume/shot.js`），并接入 `tools/lume/lume.js`：
  - CLI 用法：`lume screenshot --scan <N> (--port <path> | --host <ip> --token <t>) [app-dir|spec] [--json]`（无 `--port`/`--host` 时完整保留既有 esp32sim 模式，零破坏）。
  - 连拍 `N` 帧：逐帧调用 `device.screenshot()`，断言帧完整性（无 `shot-tx`、无 `screenshot payload truncated`、无 CRC 错、字节数严格等于 `width * height * 2`）；任意一帧失败立即中止并返回 `ok: false`（`exit 1`），绝不假 PASS。
  - 可选静态区域脏区断言：传入 `[app-dir|spec]`（查 `scan_specs.json`）、自定义 `spec` 或 `staticRegions` 时，将 RGB565 解码为 RGB8 复用 `analyzeFrames()`，逐帧校验静态层 ink 与 `staticIntrusions === 0` / `outOfBounds === 0`。
  - `renderScan()` 同时支持文本汇总与 `--json` 机器可读输出。

---

## 3. 验收表与原始输出指针（`artifacts/r223/`）

| # | 验收项 | Artifact 指针 | 原始实测结果 |
|---|---|---|---|
| 1 | C 固件 TX 重试 + `handle_shot` 失败路径单测（`node tests/shot_tx.js`） | `artifacts/r223/shot-tx-c.log` | `SUMMARY: 25 checks, 0 failures`（含 mid-stream/header/exhausted TX 失败 -> `CMD ERR shot-tx` 且 `SHOT OK == 0` 断言） |
| 2 | `apps_protocol.c` C11 `-Wall -Wextra -Werror` 回归 | `artifacts/r223/apps-protocol.log` | `52 checks, 0 failure(s)` |
| 3 | CLI 单测（含 6 条新增 r223 mock serial `shot-tx` / `scanDevice` 用例） | `artifacts/r223/npm-test-lume.log` | `87 pass / 0 fail / 0 skip`（r222 为 81 -> r223 为 87，+6 条 `r223` 用例） |
| 4 | 全量 JS 宿主回归（`for t in tests/*.js`） | `artifacts/r223/regression-after.log` | `REGRESSION DONE pass=112 fail=0`（含新增 `tests/shot_tx.js` 及全部 20 份 `R166_ALLOWED` 守卫） |
| 5 | `idf.py build` + `idf.py size`（ESP-IDF v5.5） | `artifacts/r223/firmware-build-size.log` | `BUILD_SIZE_EXIT=0`；`lume-hotreload`（`lume_hotreload.c` / `lume_cmd.c`）0 warning；见 §3.1 增量表 |
| 6 | `lume check` 哨兵 | `artifacts/r223/lume-check-counter.log` | `lume check examples/counter --no-emu` -> `RESULT: PASS (4 steps, 0 failed; exit 0)` |
| 7 | ASCII 纪律检查 | `artifacts/r223/ascii-check.log` | `ADDED_NON_ASCII=0`（覆盖 `firmware/`、`tools/`、`tests/` 全部新增/改动行） |

### 3.1 固件 `idf.py size` 基线对比（`artifacts/r223/firmware-build-size.log` vs `artifacts/r222/firmware-build-size.log`）

| Memory Type / Section | 基线 (r222 / `1ba6394`) | r223 | 增量 (Delta) |
|---|---:|---:|---:|
| **Flash Code (`.text`)** | `2,044,308` B | `2,045,024` B | **+716 B** |
| **Flash Data (`.rodata` + `.appdesc`)** | `853,236` B (`852,980` + `256`) | `853,348` B (`853,092` + `256`) | **+112 B** |
| **DIRAM（静态）** | `247,159` B (`72.32%`, Remain `94,601`) | `247,159` B (`72.32%`, Remain `94,601`) | **+0 B**（注：运行期动态内部堆 `+1,536` B，`USJ_TX_BUFFER` `512 -> 2048` B） |
| **IRAM** | `16,384` / `16,384` B (`100.0%`, Remain `0`) | `16,384` / `16,384` B (`100.0%`, Remain `0`) | **+0 B**（零 `IRAM_ATTR`） |
| **RTC FAST / SLOW** | `72` / `32` B | `72` / `32` B | **+0 B** |
| **Total image size** | `3,038,799` B (`lume.bin` `0x2e5ed0`) | `3,039,627` B (`lume.bin` `0x2e6200`) | **+828 B** |

---

## 4. 提交拆分与范围纪律

本地分支 `r223-shot-tx-reliability`（未 push），按 `feat` / `test` / `docs` 拆 commit：
1. `feat(hotreload): harden screenshot TX reliability and add device screenshot --scan mode`
2. `test(hotreload): add C shot-tx abort tests and mock-serial device scan tests`
3. `docs(r223): record screenshot TX fix, device --scan mode and verification artifacts`
