# r175 — emu-net WiFi 关联差量二分（继续 r144 负结果）

基线 `origin/main 694ed13`（2026-11-23），分支 `r175-emu-wifi-bisect`，worktree `/tmp/lume-r175-wt`。本轮是实施刀：复现基线 → 全量 sdkconfig 差量 → 按组二分 → 能全绿才落修正。

## 结论先行（诚实的部分锁定，不是全绿）

1. **锁定到具体配置项：WiFi/BT SW coexistence**。Lume `sdkconfig` 的 `CONFIG_ESP_COEX_SW_COEXIST_ENABLE=y`（含旧别名 `CONFIG_ESP_WIFI_SW_COEXIST_ENABLE=y`）由 `CONFIG_BT_ENABLED=y`（r25 NimBLE / `lume-ble`）带入；把这一组关掉后，Lume 首次关联从 r144 的 `assoc -> init (0x400)`（ASSOC_EXPIRE）变成 **`assoc -> run (0x10)`**，关联请求帧进入 TX 通路；也就是说 r144 的「assoc 帧构造了但没进 TX」在这一条件下不再成立。
2. **未达到验收线**：`assoc -> run` 之后没有 DHCP / `got ip`，约 6 s 后 `bcn_timeout,ap_probe_send_start`，10 s 后 `run -> init (0xcc00)`，所以 `[NETCHECK] ALL PASS` 仍未出现。全量差量里 LWIP / netif / DHCP 组**零差异**，残余失败不是配置差量驱动的，不能用再改一个配置项收口。
3. **不放行固件修正**：`firmware/sdkconfig.defaults` 零 diff，不伪造 PASS，不放宽 runner 的 `--exit-on`/超时；M4 WiFi OTA checkbox 保持不勾，真机 WiFi 仍 deferred。按「assoc 阶段具体项已锁定、全链未绿」的诚实部分结论收口。
4. 差量规模：原始 diff 1211 行、366 个有效 `CONFIG_*` 符号；分组与全量原文见 `artifacts/r175/sdkconfig-diff.txt`。

## 方法纠偏（先实证再动手）

- stock station 例程是 `MINIMAL_BUILD=y`：整段 Kconfig section 都不存在。逐组「把 Lume 非默认项回灌 stock」在配置空间上不等价，故改为两个方向：
  - **(a) 充分性检验**：stock 源码 + Lume 全量最终 sdkconfig（保留 `CONFIG_IDF_TARGET`，**不跑 `set-target`**，否则 IDF 会用 defaults 重写 sdkconfig）。
  - **(b) 必要性检验**：Lume 固件侧按组回退配置，观察 assoc 是否翻转。
- 第一个实验 B1 踩了 `set-target` 重写 sdkconfig 的坑（结果只剩 5 行差量，等价于 stock + SoftAP=y，r144 已排除），判方法无效并纠正为 B1b；已如实入账，不冒充有效证据。
- B1b 的关键边界：stock 工程的组件图不含 `bt`，所以 Lume sdkconfig 里的 BT/coexist 组在 B1b 中不复存在——B1b 绿**不能**排除 BT/coexist。这正是 r144 的 stock 差量变体（v1–v6）从未覆盖这一组的原因，也解释了为什么本轮在 Lume 侧才把它逼出来。

## 实验矩阵（每轮一行结论 + ≤3 行关键串口）

| 轮次 | 配置/工程状态 | 结论 | 关键串口 |
|---|---|---|---|
| B0（基线，不计轮次） | stock 例程，原 defaults + SSID/PASS/AUTH | GREEN，exit 0 | `auth -> assoc (0x0)` / `assoc -> run (0x10)` / `got ip:192.168.4.2` |
| L0（基线，不计轮次） | Lume，跟踪 sdkconfig | FAIL，exit 1 | `wifi:m f assoc req l=221` / `assoc -> init (0x400)` / `sta disconnected` |
| B1（轮 1，方法无效） | stock 源码 + 拷入 Lume sdkconfig，但跑了 `set-target` | GREEN，但配置被 defaults 重写（diff vs stock 仅 5 行），**不作为证据** | `assoc -> run (0x10)` / `got ip:192.168.4.2` |
| B1b（轮 2） | stock 源码 + Lume 全量 sdkconfig（无 `set-target`；已核对分区 0x640000 / 240 MHz / SPIRAM OCT / -O2 / USB console） | GREEN：**配置单独不充分**（且 BT/coexist 组被组件图裁掉） | `assoc -> run (0x10)` / `got ip:192.168.4.2` |
| R3（轮 3） | Lume：`SPIRAM_USE_MALLOC=n` / `CAPS_ALLOC=y` | INVALID：engine 起不来，**不能判 WiFi**；221 B assoc 帧本就 < `ALWAYSINTERNAL=4096`，malloc-PSRAM 理论弱 | `[NETCHECK] init FAIL ret=-2`（无后续 WiFi 行） |
| R4（轮 4，构建失败） | Lume：`BT_ENABLED=n` | BUILD FAIL：`lume-ble` REQUIRES `bt`，配置面无法单独摘除 BT | `BUG: cannot match original component filename for source component lume-ble` |
| R4b（轮 4 重试） | Lume：仅关 `ESP_COEX_SW_COEXIST_ENABLE` / 旧别名 `ESP_WIFI_SW_COEXIST_ENABLE` | **ASSOC 翻转**：`assoc -> run`，但无 DHCP/IP，仍是 FAIL | `wifi:m f assoc req l=221` / `assoc -> run (0x10)` / `run -> init (0xcc00)` |
| R5（轮 5） | R4b + `SPIRAM_FETCH_INSTRUCTIONS=n` / `RODATA=n` | 同 R4b：PSRAM XIP 不是 IP 阶段原因 | `assoc -> run (0x10)` / `bcn_timeout,ap_probe_send_start` / `run -> init (0xcc00)` |
| R6（轮 6） | R4b + 编译器回 -Og + `FREERTOS_HZ=100` | INVALID：`init FAIL ret=-2`，两组在 Lume 上不可单独回退 | `[NETCHECK] init FAIL ret=-2`（无后续 WiFi 行） |

二分预算 ≤8 轮，实际用 6 轮（其中 2 轮因 app 起不来/构建失败判为无效轮），未超预算。逐轮原始串口在 `artifacts/r175/*-serial.log`，一行结论台账在 `artifacts/r175/bisect-ledger.txt`。

## SDKCONFIG 全量差量（分组合并）

| 组 | 差异符号数 | 摘要 |
|---|---|---|
| WIFI | 14 | Lume-only：SoftAP support / SAE、coexist 两项、provisioning 默认；stock-only：example 的 SSID/PASS/AUTH、IRAM opt（r144 已排除） |
| LWIP | 0 | 有效值完全一致 —— **没有 DHCP/LWIP 配置差量** |
| SPIRAM | 16 | Lume-only 全套（OCT / 80M / FETCH_INSTRUCTIONS / RODATA / USE_MALLOC / ALWAYSINTERNAL=4096 / RESERVE_INTERNAL=4096） |
| FREERTOS | 3 | `HZ 100→1000`、`TASK_CREATE_ALLOW_EXT_MEM`、`TASK_FUNCTION_WRAPPER` |
| TASK | 0 | 无 |
| PARTITION | 4 | stock singleapp 2 MB → Lume custom 6.4 MB + littlefs 分区 |
| OTHER | 329 | 关键 DIFF：CPU 160→240 MHz、flash 2→16 MB、console UART→USB-JTAG、INT_WDT 300→800 ms；Lume-only：`BT_ENABLED` / NimBLE / `-O2` / coexist / LVGL 与 LUME_* 项目配置 |

完整分组表 + 1211 行原始 `diff`（`<` = stock，`>` = Lume）落 `artifacts/r175/sdkconfig-diff.txt`；stock 最终 sdkconfig 单独留 `artifacts/r175/stock-sdkconfig.txt`。

## 残余失败排序（未锁定，不猜成结论）

1. **esp-emu 对大固件 assoc 后阶段（EAPOL/DHCP TX 或 AP beacon）的模型限制**：stock 同参数全通、Lume 关 coexist 后 assoc 通但 DHCP 不通；`RUST_LOG=debug` 会让本工作负载被 I2S 日志拖慢到 12 s 内跑不到 WiFi 初始化，拿不到可用 AP 侧证据，本轮不对此下结论。
2. **Lume 运行时任务/外设与 WiFi 的耦合**：engine（core1）、LVGL、touch 总线在 R4b/R5 中持续报错/重挂，sys_evt 在 core0；可能是时序而非配置。
3. **WiFi PS 模式**：`esp_wifi_set_ps(WIFI_PS_NONE)` 属固件代码面（r144 E10 在 coexist 开启时测过，仍 assoc 失败）；在 coexist 关闭后是否影响 beacon timeout 未测，**超出本轮红线**（不动 `lume-net` 源码）。

下一步建议：在 `lume-net` 侧把 PS 模式与 coexist 组合成一次固件刀（需重跑 IRAM 16384 硬线 + harness BASE 重钉），或把 R4b 的双份串口 + r144 E14 的 AP debug 一并上报 esp-emu 上游，请其补 assoc 后阶段诊断。

## 验证记录（原始输出摘要，完整见 `artifacts/r175/host-regression.txt`）

```
100 host harnesses: HARNESS_FAILS=0 TOTAL=100
npm test --prefix tools/lume: # tests 52 / # pass 52 / # fail 0 / # cancelled 0 / # skipped 0 / # todo 0
python3 scripts/check_website.py: HTML pages 7; API 161 catalog / 161 declarations / 34 namespaces;
                                 missing none / invented none / duplicates none / signatures none
node tools/lume/lume.js check examples/net_check --no-emu:
    [PASS] bundle 1549 bytes; RESULT: PASS (4 steps, 0 failed; exit 0)
```

worktree 缺 gitignore 的 `tools/lume/node_modules` 与 `tools/lume/bin/qjsc`，软链主仓只读构建物后对齐基线；源码零改动。未跑 `idf.py size`（固件/配置零 diff，无尺寸可比；IRAM 16384 硬线未被触碰）。

- stock green：`artifacts/r175/stock-green-serial.log`（`got ip:192.168.4.2`，exit 0）。
- Lume 基线 fail：`artifacts/r175/lume-base-serial.log` + `lume-base-failure-diag.txt`（`assoc req l=221` / `assoc -> init (0x400)`，exit 1）。

## 磁盘清理记录

- 开工 `df -h /`：50 G 总量、43 G 已用、**4.7 G 可用**（91%）。
- 复用单一实验 build 目录 `/tmp/lume-r175-fw`（峰值 343 M）；stock 115 M、`cfgstock` 121 M；`idf.py build` 因 10 min 超时分两段续跑，计入同一轮而非新一轮。
- 每轮 emu 输出目录（含 ~1 MB flash.bin）跑完即删，只把串口文本和 failure-diag 拷进 `artifacts/r175/`；R4b 的 AP 侧 debug 诊断产物因 `RUST_LOG=debug` 把本工作负载拖慢到跑不到 WiFi 初始化，无有效证据，连同实验目录一并删除。
- 收尾删除 `/tmp/lume-r175-stock`、`/tmp/lume-r175-cfgstock`、`/tmp/lume-r175-fw` 及全部 `/tmp/lume-r175-*-diag`；全程可用量未低于 2 G 红线（最低 4.1 G）。

## 收尾

- 改动面：`docs/r175-report.md` + `artifacts/r175/`；`firmware/sdkconfig.defaults` / `firmware/sdkconfig`（生成物）/ `lume-net` 源码 / runner 语义全部零改动；任务二（roadmap r144 复验段落）因未全绿按约定跳过。
- ASCII 纪律：日志、台账、技术字段全 ASCII，中文仅用于文档叙述。未 push；commits 按 docs 单类拆分；git 身份 `congduan`。
- 真机 WiFi / HTTP / TF / 显示 / 触摸 / sleep current / radio 依然 deferred，**不声称真机验证**。未跑 codex review（主控轮负责）。
