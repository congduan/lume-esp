# r96 — WiFi OTA 推送通道（HMAC 鉴权升级）

基线 `de80659`（r95），分支 `r96-ota`，工作目录 `/tmp/lume-r96-wt`（从
`de80659` 显式新建——当前 `main` 已前进到 r105，本轮按简报基线取 r95 而非 main HEAD）。

## 结论

M4 未勾选项「WiFi OTA channel (TCP push, port + auth token)」的代码链路在本轮补齐：
TCP 传输 + 帧解析在 r26 已落地（见 `lume_hotreload.c`），本轮兑现的真正缺口是
**r91 `lume.crypto` 在 roadmap 登记的消费方「OTA 鉴权」**——把明文 token 比对升级为
**HMAC-SHA256 挑战-响应**（防重放），并补齐 `lume.ota` JS API 面与
`lume deploy --host <ip>` 入口。硬件验收（真 WiFi、实测时延、真板 token 流程）一律
deferred to board bring-up，本报告不声称硬件验收。

## 读码实证（先证伪假设，再写码）

| 简报假设 | 实证结果 | 证据 |
| --- | --- | --- |
| 需要新建 TCP 传输 | **r26 已有**：`lume_hotreload.c` 内完整 lwIP socket server（listen/select/accept/recv/send、WiFi gate、单客户端） | `lume_hotreload.c:602-795` |
| 端口可能与 webserv 冲突 | **不冲突**：OTA `CONFIG_LUME_OTA_PORT=8765`，webserv `CONFIG_LUME_WEB_PORT=8080`（Kconfig 互引注释） | `lume-hotreload/Kconfig.projbuild`、`lume-net/Kconfig.projbuild` |
| lwIP 并发上限 | `CONFIG_LWIP_MAX_SOCKETS=10`、`MEMP_NUM_TCP_PCB=5`、`MEMP_NUM_TCP_PCB_LISTEN=8`；单监听 + 单客户端 + webserv 远未触顶 | `firmware/sdkconfig:2073`、IDF `lwip/opt.h` |
| NVS key ≤15 字符 | `NVS_KEY_NAME_MAX_SIZE=16`（含 NUL → 名 ≤15）；现有 `"lume_ota"`(8)/`"token"`(5) 合规 | IDF `nvs.h:61` |
| `lume.crypto` HMAC 细节 | JS API `hmacSha256(key,data,out)` 基于 `mbedtls_md_hmac`；固件 OTA 在 C 侧直接调同一 mbedTLS 原语（JS 层不是固件消费路径） | `lume_crypto.c:99-134` |
| `esp_random()` 可用 | 存在；`esp_fill_random()` 由其实现（IDF `esp_random.h:32/43`），挑战用后者取 16 B | IDF 头文件 |
| 帧解析是否会复制 | r26 已抽出 `lume_frame.c` 便携编解码，USB 与 TCP 各自持一个 reentrant 实例 | `lume_frame.c:1-11`、`lume_hotreload.c:756/672` |

## 设计取舍（登记）

1. **不新建 `lume-ota` 组件，也不并入 `lume-net`**：读码发现 r26 已把 OTA 传输、
   token、NVS、帧 parser sink、回复 FIFO、engine reload 链全部放在 `lume-hotreload`
   并与 USB 共用。此时拆出 `lume-ota` 要么 (a) 只分出鉴权、制造双向头文件依赖/函数指针
   间接层，要么 (b) 搬走 `lume_frame.c` 并重写所有 harness 的 include 路径——两者都是
   高风险低收益的 churn。采用简报允许的「明确登记为何分层」：
   `lume_frame.c/.h` 是 USB/TCP 两条通道**唯一的共享帧入口**（本轮只扩展其鉴权导线助手），
   transport 与鉴权仍留在 `lume-hotreload.c`。
2. **端口保持 8765**（简报「如 7801」只是举例）：与 webserv 8080 无冲突，且是 r26 已
   文档化、CLI 已默认的端口；改号只会破坏既有部署。
3. **token 首次设置走串口 CLI 命令 `TOKEN <32hex>`**，经既有 LUMC 命令帧/回复路径实现，
   最小侵入；NVS key 仍为 `"lume_ota"/"token"`。保留 r26 的首启自动生成 + 串口日志打印
   作为零交互默认。未走 `lume.net.web`：那要新增 web 路由 + JS 暴露，侵入更大（登记为
   pending，非安全必需）。JS 侧另给 `lume.ota.setToken()` 同能力。
4. **`lume.ota` 最小面 = `status()` + `setToken()`**，不做 `start/stop`：监听器由 WiFi
   GOT_IP 门自动启停（r26 既有行为），暴露手动开关反而破坏该不变量。`lume.net.otaStatus()`
   保留并新增 `hmac` 字段。
5. **不做 TLS / mDNS / 固件镜像 OTA 分区**：token 从不上线、每连接新挑战的 HMAC 已高于
   r71 webserv 的明文查询参数水位；TLS（设备证书/内存/IRAM 压力）登记为 pending。
6. **HMAC 归属**：便携层 `lume_frame.c` 只做导线格式/hex/常量时间比较，HMAC 数学由注入的
   `lume_ota_hmac_fn` 提供——固件传 mbedTLS 版，host harness 传同一 mbedTLS 最小 closure
   （复用 r91 的 `r91_crypto_mbedtls_config.h`），CLI 用 `node:crypto`。这样 host 能测真实
   HMAC 向量，又不在 OTA harness 里复制密码学实现。

## 导线协议

```
server -> CHALLENGE <32 hex>\n          (16 B from esp_random, per connection)
client -> AUTH <64 hex HMAC>\n          HMAC-SHA256(key=raw 16 token bytes,
                                       msg=ASCII bytes of the 32-hex challenge)
server -> AUTH OK\n | AUTH ERR\n
(client) -> LUME/LUMC/LUMB frames       (same 12-byte magic+len+crc codec as USB)
         <- RELOAD OK <len>\n / RELOAD ERR <reason>\n (same reply lines)
```

挑战每连接刷新，录制的 AUTH 无法重放。错误纪律：C 函数 0 成功、负数错误码
（`lume_ota_mac_verify` → -1/-2/-3/-4，`lume_ota_token_set` → -1/-2，JS 绑定透传）。

## 改动文件

- 固件：`lume_frame.h/.c`（hex/挑战行/AUTH 解析/常量时间比较/MAC 验证）、
  `lume_hotreload.c/.h`（HMAC provider、token key、challenge-response 握手、TOKEN 命令、
  status hmac 标志、setter 注册）、`lume_cmd.c/.h`（TOKEN 语法）、
  `lume_engine.c`/`lume_engine.h`（`lume.ota` 绑定 + setter 函数指针，避免组件环）。
- CLI：`tools/lume/ota.js`（node:crypto HMAC + 挑战响应）、`tools/lume/lume.js`
  （`--host` 主入口，`--ota` 保留为 legacy alias；`lume token <32hex>` 串口设 token）、
  `tools/lume/lume.test.js`。
- 类型/stub：`runtime/types/lume.d.ts`、`tests/lib/prelude_runner.js`、
  `website/api.html`（regen）。
- harness：`tests/ota_protocol.c`（+§5b 鉴权向量/CRC 负向）、`tests/ota_auth.js`（新，
  把 C harness 编入 `tests/*.js` 回归环）、`tests/apps_protocol.c`（TOKEN 语法）。
- 文档：本报告、roadmap r96 result、KNOWN-SIMPLIFICATIONS、build.md。

## 验证（原始输出摘要，完整日志在 `artifacts/r96/`）

### 1. 全量回归

```
PASS tests/abc123.js ... PASS tests/ws.js   (53 files, 0 FAIL)
```
`artifacts/r96/regression-tests.log`。新增 `tests/ota_auth.js`：
```
56 checks, 0 failures -> PASS
```
`apps_protocol.c`（TOKEN 用例）：`43 checks, 0 failure(s)`。

`npm test --prefix tools/lume`:
```
# tests 45 / # pass 44 / # fail 0 / # skipped 1
```

### 2. counter 哨兵（三件套为本次新构建镜像，EMU_SKIP_BUILD=1）

```
[PASS] bundle   2160 bytes (81 ms)
[PASS] eval     2x "app eval ok; entering event loop"
[PASS] layout   R1 PASS ... R7 PASS
RESULT: PASS (4 steps, 0 failed; exit 0)
```

### 3. 固件构建 + size

简报环境的 r81 期旧数 ~2,021,204 已过时：r95 零固件改动，实际代码基线为 r93 的
Flash Code **2,030,508**。本轮 `-g0` 只用于 QuickJS 目标（host swap 下链接停滞，
按 r78/r82 先例，未改源码/-O2）后构建绿、无新增警告。原始 `idf.py size` 摘要：

```
Flash Code         2,033,760        (r95 实际基线 2,030,508 -> +3,252)
Flash Data           850,388
 DIRAM               247,291
 IRAM                 16,384  100.0%   Remain 0   (硬线未破)
Total image size:  3,025,919 bytes
lume.bin binary size 0x2e2c80; 54% free
```

IRAM Remain 0 硬线保持；增量全在 flash `.text/.rodata`。

## 板验 pending（不得声称已验收）

- 真 WiFi 连接/AP 关联/DHCP、CHALLENGE→AUTH 真板往返、token 首次串口设置与掉电持久性、
  实测推送时延与吞吐、多客户端串行行为——全部 deferred to board bring-up。
- esp32sim 不建模 WiFi；counter emu 烟测只证明本轮改动未破坏既有启动/帧热替换链路。
- `lume.net.web` 设 token 路径、TLS、固件镜像 OTA A/B 分区、mDNS——未做/登记 pending。
