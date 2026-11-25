# r144 — emu-net WiFi 关联收口刀：esp-emu WPA2 assoc 失败的实证定位

基线 `254c096`（r143 merge），分支 `r144-emu-wifi`，worktree `/tmp/lume-r144-wt`。
开工纪律：`bash /home/ubuntu/.hermes/scripts/lume_model_guard.sh` → `GUARD: settings.json model=hy4flash-free ✓` / `GUARD: model=hy4flash-free ✓ (settings + runtime audit clean)`，无 429，未在 `/home/ubuntu/lume` 写任何文件。

## 结论先行（诚实负结果 + 精确定义）

1. **上游模拟器不是根因**：同一 IDF v5.5.5、同一 esp-emu v1.2.0、同一组 WiFi 参数下，上游 stock 例程 `examples/wifi/getting_started/station` **关联成功并拿到 IP**（`got ip:192.168.4.2`，exit 0）。NETWORKING.md「ESP-IDF WiFi station firmware will connect and receive an IP address automatically」对 stock 成立。
2. **根因在 Lume 固件侧，但不在 WiFi 配置值**：固件完整走到 `auth -> assoc`，串口打印 `wifi:m f assoc req l=221`（已构造关联请求帧），**但 esp-emu 总线从未记录该帧的 TX 触发**；AP 侧 `RUST_LOG=debug` 无 `assoc request received` 行，1 s 后固件 `assoc -> init (0x400)` = `ASSOC_EXPIRE`（assoc 超时）。也就是说：**关联请求帧在固件内部生成却没有进入模拟器 WiFi TX 通路**，不是密码/认证/扫描问题。
3. **穷举排除的候选**：config-after-start 顺序、raw netif 创建、WiFi IRAM 选项、SoftAP support、SPIRAM（OCT/80M/FETCH_INSTRUCTIONS/RODATA/USE_MALLOC）、CPU 240 MHz、`esp_wifi_set_ps(WIFI_PS_NONE)`、显式 scan、延迟 6 s connect、`--wifi-auth wpa2-wpa3`、显式 `--psram-size 8M`、串口 console 模式。全部不改结果。
4. **本轮不硬造修复**：固件零 diff 落地；runner 只加失败诊断快照（零固件改动）；M4 WiFi OTA 行**保持不勾**。真机 WiFi 验收 deferred，**不声称真机验证**。

## 现场核对

- `tools/emu-net/run.sh`：runner 钉 `--chip esp32s3 --wifi-ssid emu-test --wifi-password emupass123 --wifi-auth wpa2-psk --net user,net=192.168.4.0/24`，`prepare.py` 把 app 注入 `0x750000` LittleFS，`--exit-on '[NETCHECK] ALL PASS'`。
- `firmware/components/lume-net/lume_net.c:159-267`：`lume_net_init()` 用 `WIFI_INIT_CONFIG_DEFAULT()`，`esp_wifi_init` → 注册 handler → `esp_wifi_set_mode(STA)` → `esp_wifi_start()`；**无 `esp_wifi_set_ps`、无 country、无 pmf、无 scan_method 显式设置**。`lume_net_connect()` `lume_net.c:333-362` 用 `memset` 清零的栈上 `wifi_config_t`，只填 ssid/password/`threshold.authmode = WIFI_AUTH_WPA2_PSK`，`esp_wifi_set_config` 后立即 wipe，再 `esp_wifi_connect()`。
- `firmware/sdkconfig`：`CONFIG_ESP_WIFI_*` 与 stock 逐项一致，唯一差异是 IRAM opt 关闭 + SoftAP support=y；两者都已在实验中排除。
- 上游 `NETWORKING.md`：`wpa2-psk` 是合法 pin 模式；S3 默认 PSRAM 8M；无「必须额外配置」条款。上游 issues 检索 assoc/wpa2/station/s3 无直接命中（仅 #69 TAP ARP MAC、#39 C3 TSF、#15 WPA3 support 等相邻项）。
- 基线固件新鲜度：主仓 `firmware/build/lume.bin` mtime `2026-11-21 09:21:41`；其后 27 个提交中 `firmware/components/lume-net/` 与 `firmware/sdkconfig` 零改动，故用主仓 build 做基线复现有效。新鲜三件套仅用于 r144 固件实验（已回退）。

## 实验矩阵（完整命令 + 串口关键行）

所有 stock 实验构建产物在 `/tmp/lume-r144-stock-*`，未进仓。构建统一 wrapper：
`cd /opt/esp/esp-idf && env -u VIRTUAL_ENV IDF_PYTHON_ENV_PATH=/home/ubuntu/.espressif/python_env/idf5.5_py3.12_env bash -c '. ./export.sh >/dev/null 2>&1; cd <project> && idf.py set-target esp32s3 && idf.py build'`

### E0 基线 Lume（失败）

```
PYTHONPATH=/tmp/lume-r142-py EMU_NET_BUILD_DIR=/home/ubuntu/lume/firmware/build \
EMU_NET_OUTPUT_DIR=/tmp/lume-r144-lume-base EMU_NET_TIMEOUT=30 \
bash tools/emu-net/run.sh examples/net_check   # exit 1
```
```
I (1880) lume-engine: js: [NETCHECK] init PASS ret=0
I (1887) lume-net: connect started (WPA2-PSK); poll status() for state/ip
I (1887) lume-engine: js: [NETCHECK] connect PASS ret=0
I (1904) wifi:state: init -> auth (0xb0)
W (1905) wifi:m f auth
I (1905) wifi:state: auth -> assoc (0x0)
W (1906) wifi:m f assoc req l=221
I (2906) wifi:state: assoc -> init (0x400)
W (2907) lume-net: sta disconnected
```

### E1 上游 stock station（成功；决定性证据）

```
cp -a /opt/esp/esp-idf/examples/wifi/getting_started/station /tmp/lume-r144-stock-station
# sdkconfig.defaults: CONFIG_ESP_WIFI_SSID="emu-test" / PASSWORD="emupass123" / AUTH_WPA2_PSK=y
idf.py set-target esp32s3 && idf.py build        # BUILD_EXIT=0
esptool --chip esp32s3 merge_bin -o merged_flash.bin --format raw --flash_mode dio \
  --flash_freq 80m --flash_size 2MB 0x0 bootloader/bootloader.bin \
  0x8000 partition_table/partition-table.bin 0x10000 wifi_station.bin
esp-emu --chip esp32s3 --firmware merged_flash.bin --wifi-ssid emu-test \
  --wifi-password emupass123 --wifi-auth wpa2-psk --net user,net=192.168.4.0/24 \
  --timeout 60s --exit-on 'got ip:'
# exit 0
```
```
I (139) wifi:state: init -> auth (0xb0)
I (139) wifi:state: auth -> assoc (0x0)
I (139) wifi:state: assoc -> run (0x10)
I (139) wifi:connected with emu-test, aid = 1, channel 1, BW20
I (1139) wifi station: got ip:192.168.4.2
```

### E2–E7 stock 差量变体（全部成功，逐项排除）

| 变体 | 相对 E1 的改动 | 关键串口行 | 结果 |
|---|---|---|---|
| v1 | `esp_wifi_start()` 后延时 120 ms 再 `memset` 栈 cfg + `set_config` + 手动 `connect`（镜像 Lume 顺序） | `assoc -> run (0x10)` / `got ip:192.168.4.2` | PASS |
| v2 | v1 + `esp_netif_new(ESP_NETIF_DEFAULT_WIFI_STA)` + `esp_netif_attach_wifi_station` + `esp_wifi_set_default_wifi_sta_handlers`（镜像 Lume netif 路径） | `assoc -> run` / `got ip` | PASS |
| v3 | v2 + `CONFIG_ESP_WIFI_IRAM_OPT=n` / `RX_IRAM_OPT=n` | `assoc -> run` / `got ip` | PASS |
| v4 | v3 + `CONFIG_ESP_WIFI_SOFTAP_SUPPORT=y` | `assoc -> run` / `got ip` | PASS |
| v5 | v4 + Lume 全套 SPIRAM（OCT/80M/FETCH_INSTRUCTIONS/RODATA/USE_MALLOC/ALLOC_STACK） | `Found 8MB PSRAM device` / `assoc -> run` / `got ip` | PASS |
| v6 | v5 + `CONFIG_ESP_DEFAULT_CPU_FREQ_MHZ_240=y` | `cpu freq: 240000000 Hz` / `assoc -> run` / `got ip` | PASS |

每个变体均已 merge_bin 并在同一 esp-emu 参数下跑到 `--exit-on 'got ip:'` 命中、exit 0。

### E8–E13 Lume 侧运行/固件变体（全部失败）

| 变体 | 命令/改动 | 关键串口行 | 结果 |
|---|---|---|---|
| E8 AP 默认 transition | esp-emu `--wifi-auth wpa2-wpa3` | `auth -> init (0x200)` / `sta disconnected` | FAIL |
| E9 显式 PSRAM | esp-emu `--psram-size 8M` | `assoc -> init (0x400)` | FAIL |
| E10 固件 PS 关闭 | `lume_net.c` 在 `esp_wifi_start()` 后加 `esp_wifi_set_ps(WIFI_PS_NONE)`；`idf.py build` 两段完成（首段 97% 被 SIGTERM，次段续跑 exit 0） | `assoc -> init (0x400)` | FAIL；改动已 `git checkout --` 回退 |
| E11 延迟 connect | 注入 app：`setTimeout(..., 6000)` 后再 `init/connect` | `7903 init -> auth` / `8905 assoc -> init (0x400)` | FAIL |
| E12 显式 scan | 注入 app：`lume.net.scan()` 命中 1 AP 后再 connect | `scan done: 1 APs` / `5305 assoc -> init (0x400)` | FAIL |
| E13 强制 UART0 console | esp-emu `--console uart0` | Lume 走 USB-Serial/JTAG，UART0 无输出 | 无信息 |

E10 的固件构建原样输出见 `/tmp/lume-r144-fw-build2.log`（`lume.bin binary size 0x2e56e0`，`BUILD_EXIT=0`）；因改动未改善结果，不纳入提交，也未作为「固件改动」重钉 harness BASE。

### E14 决定性诊断：AP 侧 debug（RUST_LOG=debug）

```
RUST_LOG=debug esp-emu --chip esp32s3 --firmware /tmp/lume-r144-lume-base/flash.bin \
  --wifi-ssid emu-test --wifi-password emupass123 --wifi-auth wpa2-psk \
  --net user,net=192.168.4.0/24 --timeout 8s --exit-on 'got ip'
```
Lume（失败）：
```
[DEBUG peers::wifi_softap] WiFi SoftAP: probe request received
W (1905) wifi:m f auth
[DEBUG mem::bus] WiFi TX triggered: slot=0
[DEBUG mem::bus] WiFi TX frame extracted: 30 bytes, type=0 subtype=12
[DEBUG peers::wifi_softap] WiFi SoftAP: deauth received, responding with auth
I (1905) wifi:state: auth -> assoc (0x0)
(1906) wifi:m f assoc req l=221
(此后无 "WiFi TX triggered"，AP 无 "assoc request received")
I (2906) wifi:state: assoc -> init (0x400)
```
Stock（E1 同参数 debug，成功）对照：
```
[DEBUG mem::bus] WiFi TX frame extracted: 30 bytes, type=0 subtype=12
[DEBUG peers::wifi_softap] WiFi SoftAP: deauth received, responding with auth
[DEBUG mem::bus] WiFi TX frame extracted: 34 bytes, type=0 subtype=11
[DEBUG peers::wifi_softap] WiFi SoftAP: auth request while authenticated, sending assoc response
[DEBUG peers::wifi_softap] WiFi SoftAP: starting WPA2 4-way handshake, sending M1
[DEBUG mem::bus] WiFi TX frame extracted: 74 bytes, type=0 subtype=0
[DEBUG peers::wifi_softap] WiFi SoftAP: assoc request received
... M2 MIC verified OK / M4 received, 4-way handshake complete
```
Lume 全程仅 3 次 `WiFi TX triggered`（probe、deauth、第二次重试的 auth），stock 同窗口 6 次。关联请求帧在 Lume 中是「构造了但未触发 TX」。

## 根因定性与可追踪线索

- **定性**：Lume 固件/esp-emu 交互缺陷，位于 WiFi 管理帧 TX 通路口径；**不是**模拟器 AP 限制（stock 同参数可通）、**不是**宿主环境（同机同 IDF）、**不是**密码/认证配置（init/connect 均返回 0，scan 命中 AP，auth 阶段本身完成）。
- **`0x400` 语义**：Espressif 文档与社区排查一致，`assoc -> init (400)` = `ASSOC_EXPIRE`（4）+ 0 = 关联响应超时；`0x200` = AUTH_EXPIRE。本例中 AP 未收到关联请求，故超时。
- **上游线索**：NETWORKING.md 明确 `wpa2-psk` 是 legacy AP 兼容模式，WPA2 station 应自动协商；CLI.md 列出 `--psram-size` 默认 8M（S3）。issues 无 assoc 直接命中；相邻项 #40（S3 Xtensa LOOP 分支回退导致堆破坏，已 closed）提示该平台曾有 CPU 模拟缺陷，但本轮 esp-emu v1.2.0 应已含修复，且 stock 同芯片正常，**不足以归因**。建议后续直接向上游报告「Lume 大固件在 assoc 阶段未触发 mgmt TX」并附 E14 双份 debug 日志。
- **未做**：不修改 vendored（QuickJS/LVGL）、不改 `.d.ts`、不改固件；不硬造「ALL PASS」；不以 runner 放宽 exit-on 换取绿灯。

## 验证记录（原始输出）

- `for t in tests/*.js; do node "$t" >/dev/null 2>&1 || echo FAIL "$t"; done; echo done` → `done`，**0 FAIL**（固件零 diff，无 BASE 重钉需求）。
- `npm test --prefix tools/lume` → `# tests 50 / # suites 0 / # pass 50 / # fail 0 / # cancelled 0 / # skipped 0 / # todo 0`。worktree 缺 gitignore 的 `tools/lume/bin/qjsc` 与 `node_modules`，软链主仓只读物后对齐基线（首次未软链 qjsc 时为 `pass 49 / skipped 1`，软链后恢复 50/0）。
- `python3 scripts/check_website.py` → `API: 153 catalog entries, 153 type declarations, 34 function namespaces` / `API missing: none` / `API invented: none` / `API duplicates: none` / `API signatures not found in lume.d.ts: none`（`.d.ts` 零改动，天然绿）。
- `node tools/lume/lume.js check examples/net_check --no-emu` → `[PASS] bundle 1549 bytes` / `RESULT: PASS (4 steps, 0 failed; exit 0)`；哨兵 `examples/counter --no-emu` → `[PASS] bundle 2160 bytes` / `RESULT: PASS (4 steps, 0 failed; exit 0)`。
- runner 失败诊断自检：`EMU_NET_TIMEOUT=8 ... run.sh examples/net_check` → exit 1，`failure-diag.txt` 含 `ESP32 series emulator · v1.2.0` / `params: chip=esp32s3 auth=wpa2-psk ...` / `ssid=emu-test password_len=10 (value redacted)` / sha256 / WiFi 关键行；密码值未落盘。
- 全链：`tools/emu-net/run.sh examples/net_check` **exit 1**，`init PASS` / `connect PASS` / `ip FAIL timeout`，无 `[NETCHECK] ALL PASS`（负结果路径，见 E0）。

## runner 改动（infra，零固件改动）

`tools/emu-net/run.sh`：在 `result != 0` 时写 `$output/failure-diag.txt`，含 esp-emu 版本、非敏感参数摘要（ssid、password **长度**、auth、net、timeout、exit-on）、固件镜像 sha256、串口 WiFi/NETCHECK 关键行。目的：后续轮次无需重跑即可对比失败现场。成功路径行为不变；密码值不写盘（沿用 `prepare.py` 的 credential policy）。

## 复验条件（何时重开本刀）

1. 上游 esp-emu 发布 (>1.2.0) 修复「大固件 mgmt TX 未触发」类问题，或提供 `--wifi-assoc-debug` 等诊断开关；用 E1/E14 同一命令复跑 stock 与 Lume 对比。
2. 有人定位到 Lume 固件中触发该 TX 路径的具体子系统（显示 SPI / I2S / 引擎任务之一），并能给出最小 diff；届时按固件刀流程重跑 `idf.py build && idf.py size`（IRAM 16384 Remain 0 硬线）+ 11 harness BASE 重钉。
3. 真机接板后，WiFi 关联若正常，则本轮结论收敛为「仅 esp-emu 模型限制」，可把 `KNOWN-SIMPLIFICATIONS` 的 r144 条升级为「emu 专属限制，真机另验」。

## 收尾

- stock build/merge_bin、临时 flash.bin、失败实验日志全部在 `/tmp`，不进仓；artifacts 仅留本轮最终诊断与串口关键段。
- 固件零 diff（`git diff 254c096 HEAD -- firmware/` 为空）；未跑 `idf.py size`（无固件改动可对比）。
- ASCII 纪律：日志/harness 输出全 ASCII；新增 runner 注释与报告技术字段全 ASCII，中文仅用于文档叙述。
- commits 拆 infra(runner) / docs，不推送；不跑 codex review（主控轮负责）。真机 WiFi / HTTP / TF / 显示 / 触摸全部 deferred。
