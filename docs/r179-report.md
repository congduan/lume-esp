# r179 报告：M4 WiFi 收口刀 —— PS 模式 + coexist 关闭组合（未绿，部分结论）

基线：`origin/main` `b749837`（fire 时 worktree HEAD，与 `origin/main` 一致；简报中的
`59c5733` 是派发时的旧核实值）。分支 `r179-wifi-ps-coex`，worktree `/tmp/lume-r179-wt`。
本轮承接 r175 的下一步建议：把 `esp_wifi_set_ps(WIFI_PS_NONE)` 与
`CONFIG_ESP_COEX_SW_COEXIST_ENABLE=n` 组成一次固件刀，在 emu 在环下验证。

## 1. 结论先行（诚实：不绿，不伪造 PASS）

1. **验收硬指标未达成**。组合固件（`lume_net.c` + `sdkconfig`）在 emu 串口里**没有**
   `assoc -> run (0x10)`，也没有 `got ip:` / `[NETCHECK] ALL PASS`；首次关联仍是
   `assoc -> init (0x400)`（ASSOC_EXPIRE，2906 ms），60 s 窗口内 `[NETCHECK] ip FAIL
   timeout state=0 ip=null`。**这是回到 ASSOC 阶段死，不是 R4b 的 IP 阶段死**。
2. **PS 调用不是原因，摆放位置也不是**。E1（coexist 关、PS 调用完全去掉）与 E2
   （PS 放在 `esp_wifi_start()` 之后，即 r144 E10 位置）都在同一时刻
   `assoc -> init (0x400)`，与组合刀逐字一致。三条曲线在 WiFi 相关行上无法区分。
3. **r175 R4b 的翻转在本基线不可复现**。r175 报告里关 coexist 会把
   `assoc -> init (0x400)` 翻成 `assoc -> run (0x10)`；本轮用同样的声明式配置改动
   （`sdkconfig.defaults` + 生成的 `sdkconfig`，四个 rename 别名一起归零）在
   `b749837` 上得不到该翻转。lume-net 源码自 `694ed13` 起零改动，差异只来自
   `694ed13..b749837` 的 engine / board-hal / svg / lvgl 变更带来的二进制布局/时序变化
   （同配置下 lume.bin 长度相差约 0x970 B）。因此**残余失败不是单一配置差量驱动**，
   与 r175「LWIP/netif/DHCP 零差异」的结论一致。
4. **AP 侧证据（E3）**：`RUST_LOG=debug` 下 AP 日志出现
   `WiFi SoftAP: auth request while authenticated, sending assoc response`，
   说明 assoc 帧**已到达 AP 并收到 assoc response**；失败发生在固件侧对 assoc 响应
   的处理/接收，而不是 r144 E14 时的「帧根本没进 TX 通路」。这与 r144 的负结果不同，
   值得上报 esp-emu 上游（附 R4b 与本轮 E1/E3 串口）。
5. **不放行**：`[NETCHECK] ALL PASS` 未出现，不改 runner 的 `--exit-on` / 超时，
   M4 WiFi OTA checkbox 保持不勾；按 r175 先例以「部分锁定」口径收口。

## 2. 改动面

| 文件 | 改动 |
|---|---|
| `firmware/components/lume-net/lume_net.c` | `!s_started` 分支内，`esp_wifi_set_mode(STA)` 之后、`esp_wifi_start()` 之前加 `esp_wifi_set_ps(WIFI_PS_NONE)`，错误经 `map_err` 上报。位置选择理由：驱动已 init、station 尚未起，PS 在第一个 beacon 之前生效；仍落在可恢复的一次性 `!s_started` 守卫内。E2 实测放到 `start()` 之后同样无效（见第 3 节）。 |
| `firmware/sdkconfig.defaults` | 在 WiFi IRAM 段后加显式 `CONFIG_ESP_COEX_SW_COEXIST_ENABLE=n`。`esp_coex/sdkconfig.rename` 把 `ESP_WIFI_SW_COEXIST_ENABLE` / `ESP32_WIFI_SW_COEXIST_ENABLE` / `SW_COEXIST_ENABLE` 三个旧别名都映射到该符号，故 defaults 只需一个规范项。 |
| `firmware/sdkconfig`（生成物，随 defaults 级联） | 规范项与三个旧别名全部改为 `is not set`。已核对 `firmware/build/config/sdkconfig.h` 中无 `CONFIG_ESP_COEX_SW_COEXIST_ENABLE` 定义；旧别名不复活。 |
| `tests/*.js`（22 + 1 个） | 只往历史 allowlist 数组加入本轮具名对象（3 个固件路径），`ota_consumers.js` 另接纳 `docs/r179-report.md` 和 `artifacts/r179/` 前缀。谓词结构/断言语义未改（原行逐字保留，仅新增一行前缀）。`board_abi.js` 的 zero-diff guard 在 feat commit 落地后才转红（它只看 `git diff BASE HEAD`），补三条 `:!` pathspec 排除后复绿。原始 `git diff -U0 -- tests/` 见 `artifacts/r179/guard-repin.diff`（board_abi 修复在 `artifacts/r179/guard-board-abi.diff`）。 |

未动 prelude、vendored、`runtime/`、`tools/`、`examples/`，未改 runner。

## 3. 实验矩阵（每轮一行结论 + ≤3 行关键串口）

口径照抄 r175：`tools/emu-net/run.sh examples/net_check`，esp-emu v1.2.0，
`--wifi-auth wpa2-psk`，SSID `emu-test`，`exit-on=[NETCHECK] ALL PASS`。
原始串口全文在 `artifacts/r179/`。

| 轮次 | 配置/代码状态 | 结论 | 关键串口（≤3 行） |
|---|---|---|---|
| L0（基线，不计轮次） | `b749837` 未改动，`sdkconfig` 原样（coexist=y） | FAIL，复现 r175 L0：`assoc -> init (0x400)`，emu 环境与 r175 一致 | `wifi:m f assoc req l=221` / `assoc -> init (0x400)` @2905 / `sta disconnected` |
| 组合刀（主轮） | `lume_net.c` 加 PS（start 前）+ coexist=n | **FAIL**：仍 `assoc -> init (0x400)`，无 `assoc -> run`、无 `got ip`；60 s 后 `[NETCHECK] ip FAIL timeout state=0 ip=null` | `auth -> assoc (0x0)` @1905 / `assoc -> init (0x400)` @2906 / `[NETCHECK] ip FAIL timeout` @31892 |
| E1（实验 1） | 只留 coexist=n，PS 调用注释掉 | **FAIL**：与基线逐字一致 → PS 调用不是 ASSOC 死的原因 | `wifi:m f assoc req l=221` @1904 / `assoc -> init (0x400)` @2905 / `sta disconnected` |
| E2（实验 2） | coexist=n + PS 放到 `esp_wifi_start()` 后（r144 E10 位置） | **FAIL**：与组合刀逐字一致 → 摆放位置不是原因 | `wifi:m f assoc req l=221` @1905 / `assoc -> init (0x400)` @2906 / `sta disconnected` |
| E3（实验 3，AP debug） | E1 固件 + `RUST_LOG=debug`，抓 AP 侧 | **FAIL，但提供新证据**：AP 收到 assoc 请求并回 assoc response；失败在固件 RX/处理侧 | `WiFi SoftAP: ... sending assoc response` / `wifi:m f assoc req l=221` / `assoc -> init (0x400)` @2905 |

实验预算 3 轮，实际用 3 轮，未超。E1/E2/E3 原始串口/build 日志分别在
`artifacts/r179/E1/`、`E2/`、`E3-ap-debug-serial.log`。**没有任何一轮放宽 runner 或伪造 PASS**。

串口逐段对照 R4b（`artifacts/r175/R4b-nocoexist-serial.log`）：

- R4b：`assoc -> run (0x10)` @1905 → `bcn_timeout,ap_probe_send_start` @7905 →
  `run -> init (0xcc00)` @11905（IP 阶段死）。
- r179 组合刀：`assoc -> init (0x400)` @2906 → 重连 `auth -> init (0x200)` →
  再 `assoc -> init (0x400)`（ASSOC 阶段死）。无 `bcn_timeout`，无 `got ip`。

## 4. 固件编译与 IRAM 硬线

`idf.py build && idf.py size` 原始输出：`artifacts/r179/build-size.log`
（因本机 2 核 / 1.9 GB 内存、并行 agent 抢占，两段完成；中间在 quickjs.c 汇编处
SIGTERM，复用 r180 worktree 的 `quickjs.c.obj`——两仓 quickjs.c 源码逐字节相同、
规范化后的编译命令逐字节相同，仅 debug 路径串来自 donor——再续跑；细节见
`artifacts/r179/quickjs-object-reuse.txt` 与日志内 `[r179]` 标记）。

```
lume.bin binary size 0x2e5460 bytes. Smallest app partition is 0x640000 bytes. 0x35aba0 bytes (54%) free.
Project build complete.
| Flash Code          │      2042664 │
| Flash Data          │       852212 │
| DIRAM               │       246983 │    72.27 │          94777 │        341760 │
| IRAM                │        16384 │    100.0 │              0 │         16384 │
Total image size: 3036131 bytes (.bin may be padded larger)
```

**IRAM 16384 / Remain 0 硬线保持**。对照基线 `0x2e6cb0` → 组合刀 `0x2e5460`
（-0x1850 B），与 r175 R4b 关 coexist 带来的二进制收缩同量级，说明配置确实生效，
但 assoc 行为未翻转。最终代码状态下再次 `idf.py build` 绿（`artifacts/r179/final-build.log`）；
每次构建时间戳不同，hash 不同属预期，源码与配置一致。

## 5. 宿主回归（原始输出见 `artifacts/r179/`）

```
host harnesses (before re-pin): HARNESS_FAILS=22 TOTAL=101   [host-regression-prerepin.txt]
host harnesses (after re-pin):   HARNESS_FAILS=0  TOTAL=101   [host-regression-final.txt]
npm test --prefix tools/lume:    # tests 52 / # pass 52 / # fail 0   [npm-test.log]
python3 scripts/check_website.py: missing none / invented none / duplicates none /
                                  signatures not found none         [check-website.log]
```

转红的 22 个 harness 全部按 r173/r176/r177 先例只接纳本轮具名对象后复绿；
`board_abi.js` 的 commit-sensitive zero-diff guard 在 feat commit 落地后追加三条
`:!` 排除后复绿（共 23 个守卫文件）。`git diff -U0 -- tests/` 见
`artifacts/r179/guard-repin.diff`（仅 allowlist / 前缀行）。

## 6. 诚实口径与 deferred

- emu 是 **pipeline 保真**（真实 ROM / bootloader / 分区表 / 固件 + net_check app 注入 +
  user-mode 网络），**不是真机**。本轮结论只对 esp-emu v1.2.0 的 WiFi/SoftAP 模型成立。
- 真机 WiFi 首次关联、DHCP、HTTP、吞吐、与 NimBLE 共存、sleep current、显示/触摸等
  **全部仍 deferred**，不声称任何硬件验收。
- 建议后续：把 R4b 串口 + 本轮 E1/E3 双份日志上报 esp-emu 上游，请其补 assoc response
  在固件侧的接收/处理诊断；或在真机板 bring-up 时重测该组合。
- 磁盘卫生：每轮 emu 的 8 MB `flash.bin` 副本与失效的主仓旧产物探针已删除，
  只留文本证据（39 个文件，3.5 MB）。

## 7. 提交拆分（未推送）

| commit | 内容 |
|---|---|
| `750f3be` | feat：`lume_net.c` PS 调用 + `sdkconfig.defaults` / `sdkconfig` coexist 归零 |
| `e3fba64` | test：22 个 harness 守卫 allowlist 重钉 |
| `74fe253` | test：`board_abi` zero-diff guard 追加 r179 固件路径排除 |
| `b18540f` | fix：去掉实验恢复时 `lume_net.c` 里重复的 r179 注释（纯注释，无行为变化） |
| docs | 本报告 + `artifacts/r179/` 原始证据（docs commit，未推送） |

git 身份 `congduan`；ASCII 纪律（日志/台账/技术字段全 ASCII，中文仅用于文档叙述）；
未 push。
