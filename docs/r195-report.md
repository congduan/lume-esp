# r195 收口报告 — voice_assistant WS 升级握手鉴权（r187 遗留，纯 app 层）

基线 `origin/main c97d028`（2026-11-26），worktree `/tmp/lume-r195-wt`，分支
`r195-va-handshake-auth`。全部证据为宿主机证据；真机网关 401 拒绝、板上连接、
TLS/部署形态均未实测，deferred 到 board bring-up。

## 1. 任务一：升级请求带握手鉴权头

### 1.1 实证（动手前，不凭简报断言）

- `ls tests/ | grep -i "voice\|va"` 命中 `va_ws.js`、`voice_assistant.js`，
  另有引用者 `gateway.js`、`gateway_upstream.js`、`examples_gallery.js`、
  `ota_consumers.js`。四套相关 harness 基线单跑全绿（原始输出见
  `artifacts/r195/tests-all.txt`，基线单跑记录在 `/tmp/r195-base-*.log`）。
- 读 `firmware/components/lume-engine/prelude/prelude.js:67-91` 确认：
  `connect(url, options, cb)` 在 `cb` 非函数时走 Promise 包装并**递归回调路径**
  （:70-75），headers 构造（:78-90）在两条路径都生效；`options.headers` 经
  `name + ': ' + value + '\r\n'` 拼装后传给 `lume.net.ws._connect(url, headers)`。
  因此 app 只需传 options.headers，固件零改动。
- `tools/gateway/device-sim.js:159` 用 `{ Authorization: 'Bearer ' + handshakeToken }`；
  `tools/gateway/ws-client.js:14-25,57` 把该字典转成升级请求头。字段拼写/空格
  与本轮实现**完全一致**，无需对齐（任务二差异项为空）。
- 宿主 `tools/gateway/server.js:77,256-266` 只实现 `deviceToken` 的 `hello.auth`
  门（phase `await-hello`），**不实现** r187 的升级阶段 401 门。故宿主 harness
  能证明「header 被构造并送到 `_connect` 边界」，但不能证明真实网关 401 行为。

### 1.2 令牌语义取舍：单 KV 双用（同一值同时用于升级头与 hello.auth）

协议 §1 明示握手 token 与 §8.2 `hello.auth.token` 是两个**独立配置**；设备侧
当前只有 `voice_gateway_token` 一个键。本轮**不扩配置面**：同一 KV 值同时作为
`Authorization: Bearer <token>` 与 hello 的 `auth.token`，理由：

- 单键低摩擦——用户只需在设备上写一次令牌，网关侧 `--token` / `--device-token`
  同步配置即可；运营商轮换时两边一起换。
- 拆分两键会让「只配了其中一键」的设备出现半开态（升级过了但 hello 被拒，
  或反过来），在本轮纯 app 刀里反而增加运维面与失败模式。
- 代价（已登记到 `KNOWN-SIMPLIFICATIONS.md` r195 节）：设备**无法**表达
  「握手 token ≠ hello.auth device-token」的部署形态；若网关这样配置，需后续
  另立任务加第二键。

### 1.3 代码改动

- `examples/voice_assistant/app.js:422-431` 新增 `vaWSLogUrl(url)`：在第一个
  `?` 或 `#` 处截断，日志只打 scheme+host+port+path；真实连接仍用原 URL。
- `examples/voice_assistant/app.js:649-657`：`handshakeToken = vaGatewayToken()`
  放在 reuse 提前返回**之后**；日志改打 `vaWSLogUrl(url)`；options 由内联字面量
  改为 `wsOpts` 变量，但回调顺序与内容不变。
- `examples/voice_assistant/app.js:715-722`：仅当 `handshakeToken` 非空时
  `wsOpts.headers = { Authorization: 'Bearer ' + handshakeToken }`；为空时
  **没有 headers 字段**，`lume.net.ws.connect(url, wsOpts, cb)` 的调用形态与
  r119 一致。
- `onOpen` 内的 hello 构造逐字未动（仍自行读 `vaGatewayToken()` 并只打
  `VA WS HELLO AUTH` 事实，从不打 token 值），open LAN 路径的 hello 帧与
  连接行为不变。

## 2. 任务二：文档回填

`docs/voice-gateway-protocol.md` §1 开头那句「其握手鉴权接入留待解除示例改动
限制后完成」改为「已于 r195 用 header 方式接入（URL 保持无 token，日志裁剪
query）」，协议语义未变。`tools/gateway/device-sim.js` 因字段完全一致零改动。

## 3. 验证（原始输出在 `artifacts/r195/`）

| 项 | 结果 | 证据文件 |
|---|---|---|
| voice/va 四套 harness 基线单跑 | 全绿 | `tests-all.txt`（全量轮含） |
| `va_ws.js` 新增断言后 | 14 cases 全绿 | `harness-green.log` / `harness-restored.log` |
| 全量 `for t in tests/*.js` | `FAIL_COUNT=0` | `tests-all.txt` |
| `lume check examples/voice_assistant --no-emu` | `RESULT: PASS`（13554 B） | `lume-check.txt` |
| 哨兵 `lume check examples/counter --no-emu` | `RESULT: PASS`（2160 B） | `lume-check.txt` |
| playground 重建 73 apps + 二次幂等 | 两次 PASS，git status 一致 | `playground-build.log` |
| `python3 scripts/check_website.py` | missing/invented/duplicates/signatures 全 none | `website-check.txt` |
| `npm test --prefix tools/lume` | 52 pass / 0 fail | `cli-tests.txt` |
| `gen_api_docs.py --check` | `api.html is up to date ... (162 entries)` | `api-docs-check.txt` |
| `git diff origin/main -- firmware/` | 空（0 字节）→ 跳过 `idf.py build` | `firmware-zero-diff.txt` |

新增/锚定的 live 断言：

1. 有 token → `_connect` 收到 `Authorization: Bearer <token>\r\n`（case 8）。
2. 无 token → headers 字符串为 `''`，且 hello 原始文本与冻结的 r119 值
   `JSON.stringify(OPEN_LAN_HELLO)` 逐字节相等（case 1）。
3. token 值不出现在任何设备日志行（case 8/14 与既有 r119/r122 断言）。
4. URL 带 `?token=...#frag` → 日志只含 scheme+host+port+path，真实连接
   URL 仍含完整 query+fragment（新增 case 14）。
5. reuse 路径零 headers、零 token 读取（case 10，KV get 计数器）。
6. `tests/ota_consumers.js` ALLOWED 预加本轮文件与 `artifacts/r195/` 前缀，
   守卫未删、未放宽。

Mutation 负例（均转红后原样复原，复原后 harness 再绿）：

| 变异 | 转红断言 | 证据 |
|---|---|---|
| M1 去掉 headers 赋值 | `r195: token -> Authorization: Bearer on the WS upgrade` | `mutation-M1-no-header.log` |
| M2 日志改回裸 URL | `r195: logged URL is scheme+host+port+path only` | `mutation-M2-url-leak.log` |
| M3 在 reuse 分支读 token | `r195: reuse path performs zero token reads` | `mutation-M3-reuse-token.log` |

## 4. 范围与红线

- `firmware/` 零 diff（原始输出 0 字节），未跑 `idf.py build`；
  `runtime/`、`tools/gateway/`、vendored、`.github/`、其他 `examples/` 均未动，
  `runtime/types/lume.d.ts` 未改。
- `examples/voice_assistant/app.js` 新增字面量全 ASCII（r64）；存量非 ASCII
  只在既有注释的 `—` / `§` 中，本轮未新增。
- 未 push；commits 按 feat / test / docs 拆分；git 身份 `congduan`。
- 未改 `docs/roadmap.md` 里程碑定义。
