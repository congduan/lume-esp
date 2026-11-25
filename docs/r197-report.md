# r197 report — voice_assistant 双 token 拆分

基线 `origin/main` `974b0fa1e5367883500507c0f99a94305f44d7fe`（r196 已入主干）；
worktree `/tmp/lume-r197-wt`，分支 `r197-va-dual-token`。动手前实证：HEAD 与
origin/main 同值且工作区干净；`app.js` 已漂移到 782 行（简报引用的 367/655/722
行号仅为 r195 时点，实际读取后定位）；playground `build.mjs:13` 确实注册了
`voice_assistant`。基线 `va_ws.js` 14 cases、`gateway_e2e_auth.js` 6 PASS 全绿后才动刀。

## 1. 改动（仅 app 层）

`examples/voice_assistant/app.js`：

- 新增 KV 键 `voice_gateway_handshake_token`（`VA_GATEWAY_HANDSHAKE_TOKEN_KEY` /
  `VA_GATEWAY_HANDSHAKE_TOKEN = ''`，键名后缀 15 字符，与既有 url/token/multiturn
  同风格）。新增 `vaGatewayHandshakeToken()`，未写/空串时返回 `''`。
- `vaTransportWS` 的 fresh-connect 路径：`helloToken = vaGatewayToken()` 仍供
  hello `auth.token` 使用；`hsKey = vaGatewayHandshakeToken()`；
  `handshakeToken = hsKey || helloToken`。**非空 → 升级头用握手键、hello 用原键；
  空/未写 → 两处都用原键**，r119/r195 单键设备逐字节不回归（头字符串与 hello
  帧均由 17-case harness 冻结断言）。reuse 分支仍在读取前 return，新键同样零读。
- 新增 ASCII 日志 `VA WS AUTH SPLIT=0/1`，只记「两键是否为不同非空值」的布尔事实；
  token 值仍不进日志、错误 message、`VA WS HELLO AUTH`。无 HUD 徽标（沿用 r195）。
- `examples/voice_assistant/README.md` §WS 模式用法第 3 步补一句双键配置说明。

未新增 KV 写入面（settings UI / fput / repl 写键不在本刀范围）；`firmware/`、
`runtime/`、`tools/gateway/`、vendored、`.d.ts`、其他 examples 均未改。

## 2. 宿主验证（原始输出见 `artifacts/r197/`）

### 2.1 app 边界层：`tests/va_ws.js` 17 cases 全绿

新增 3 组 case（15 双键拆分、16 单键回落、17 两键全空），并在 r121 reuse case
追加「握手键零读」护栏。原始输出 `artifacts/r197/va-ws-green.log` /
复原后 `va-ws-restored.log`（两者仅 ephemeral 端口一处差异，语义逐字节一致）；
PASS 逐条摘录 `va-ws-pass-lines.txt`：

```
PASS r197: split keys -> Bearer=handshake, hello.auth=device-token, full round
PASS r197: single-KV fallback -> r195 header+hello bytes, SPLIT=0
PASS r197: both keys empty -> open LAN: no headers, no auth, SPLIT=0
ALL VA WS HARNESS CASES PASSED (17 cases)
```

断言要点：双键时 `headers[0] == 'Authorization: Bearer ' + HS + '\r\n'` 且
`hello.auth.token == DT`（HS≠DT）、`SPLIT=1`、两值均不出现在设备/网关日志；单键
回落时头字符串与 hello `textRaw` 均与 r195 冻结字节一致、`SPLIT=0`；两键全空时
`headers[0] == ''`、hello 无 `auth` 且与 r119 `OPEN_LAN_HELLO` 逐字节一致。

### 2.2 mutation 负例（转红后复原再绿）

| 变异 | 转红断言 | 证据 |
|---|---|---|
| M1 `handshakeToken = hsKey`（删回落分支） | `r195: token -> Authorization: Bearer on the WS upgrade`（首个单键回归 case 8） | `mutation-M1-no-fallback.log`，exit=1 |
| M2 `handshakeToken = helloToken`（头误用 hello 键） | `r197: upgrade Bearer comes from the handshake key`（新增拆分 case 15） | `mutation-M2-hello-key-header.log`，exit=1 |

复原后 `va-ws-restored.log` exit=0、17 cases 全绿；`app.js:673` 当前为
`var handshakeToken = hsKey || helloToken;`。

### 2.3 网关 E2E 层：`tests/gateway_e2e_auth.js` 8 cases + 10 连跑

真 `createGateway({token: HS, deviceToken: DT})` + 真 `ws-client connect(url, cb,
headers)`，HS≠DT。原始输出 `gateway-e2e-auth.txt`：

```
PASS gateway e2e auth: no headers: HTTP 401, ws-client onError(1), no upgrade
PASS gateway e2e auth: wrong Bearer: HTTP 401, ws-client onError(1), no session
PASS gateway e2e auth: correct Bearer: HTTP 101 + hello-ack with correct device token
PASS gateway e2e auth: correct Bearer + wrong device token: hello gate rejects (unauthorized)
PASS gateway e2e auth: x-gateway-token compatibility form: HTTP 101 + hello-ack
PASS gateway e2e auth: ?token= compatibility form: HTTP 101 + hello-ack
PASS gateway e2e auth: r197: Bearer=device-token (wrong handshake) -> HTTP 401, no upgrade
PASS gateway e2e auth: r197: Bearer=handshake + hello=handshake (wrong device token) -> unauthorized/1008
ALL GATEWAY E2E AUTH CASES PASSED
```

`gateway-e2e-auth-10-runs.txt`：

```
=== gateway E2E auth: 10 consecutive runs ===
OK run 1 ... OK run 10
FAILURES=0/10
```

1008 的可观测口径：网关 `_error('unauthorized')` 同步置
`closeReason='unauthorized'` 并按 `CLOSE_FOR_ERROR.unauthorized = 1008` 发关闭帧；
ws-client 的 `onClose()` 不带 code，故 E2E 断言稳定的服务端 fault marker +
`error{code:"unauthorized"}`，不赌客户端读到的关闭码。

### 2.4 全量回归

```
for t in tests/*.js; do node $t || echo "FAIL $t"; done
```

`artifacts/r197/full-tests-sweep.txt`：exit=0，`FAIL` 行 **0**（1815 行原始输出）。

`npm test --prefix tools/lume`（`npm-test-tools-lume.txt`）：
`# tests 52` / `# pass 52` / `# fail 0`，exit=0。

### 2.5 零固件 diff / ASCII / playground / 网站

- `firmware-zero-diff.txt`：`git diff origin/main -- firmware/` 输出 0 行，
  `git status --short -- firmware/` 空 → 合法跳过 `idf.py build`。
- `non-ascii-check.txt`：`grep -Pn '[^\x00-\x7F]' examples/voice_assistant/app.js`
  仅 3 行存量注释（`—` / `§`）；与 origin/main 的唯一非 ASCII 字符集合同为
  `§—`，**r197 新增非 ASCII 字面量 0**。
- playground 重建：`playground-build.log` 73 apps / PASS；二次
  `playground-build-idempotent.log` 后 `git status` 与首次构建后逐字节相同
  （仅 `apps/voice_assistant.js`、`sources/voice_assistant.js`、`sources.js`
  三个生成物变化）。`website-check.txt`：`API missing/invented/duplicates/
  signatures not found` 四类均 `none`，gallery 73 cards。

## 3. 范围、偏离与诚实口径

- **偏离说明（必要的最小偏离）**：简报改动面未列 `tests/ota_consumers.js`，但
  该 harness 的 `allChanged` 守卫按 ALLOWED 白名单逐路径核对自固定 BASE
  `674684a` 起的全部变更；本轮新增的 `examples/voice_assistant/README.md`、
  `docs/r197-report.md` 与 `artifacts/r197/` 不在白名单，首次全量 sweep 因此
  产生 1 条 FAIL（已原样留在 `artifacts/r197/` 的构建过程之外，最终 sweep 为
  0 FAIL）。按 r195/r196 的同款先例，仅机械追加 3 个条目到 ALLOWED 数组与
  1 个 `artifacts/r197/` 前缀分支；**未重钉 BASE、未改任何断言或 mutation 逻辑**，
  变更 9 行，已随 test commit 提交。
- 全量 sweep 一次通过不得归功于放宽守卫：上述白名单是「本轮新路径登记」，
  不是绕过；固件零 diff 守卫、BASE pin、mutation 自比较均保持原样。
- **仅为宿主语义桥，不声称真机验证**：本轮证明 app 构造的 header/hello 字节、
  真 server + 真 ws-client 的两门串联语义；板级 WiFi 稳定性、真实 401 拒绝、
  明文 `ws://` 令牌暴露面、TLS 终止方式、触摸手感全部 deferred to board
  bring-up / 部署验收，与 r195/r196 口径一致。
- 未 push；commits 按 feat / test / docs 拆分（hash 见 `git log`）；git 身份
  `congduan`。未跑 codex review（主控轮负责）。未改 `docs/roadmap.md` 里程碑定义。

## 4. 证据索引

`artifacts/r197/`：

| 文件 | 内容 |
|---|---|
| `va-ws-green.log` / `va-ws-pass-lines.txt` | 扩展后 17 cases 全绿原始输出 / PASS 逐条 |
| `mutation-M1-no-fallback.log` / `mutation-M2-hello-key-header.log` | 两组 mutation 转红原始输出 |
| `va-ws-restored.log` | 复原后再次全绿原始输出 |
| `gateway-e2e-auth.txt` / `gateway-e2e-auth-10-runs.txt` | E2E 8 cases / 10 连跑 0 失败 |
| `full-tests-sweep.txt` / `npm-test-tools-lume.txt` | 全量 0 FAIL / 52-0-0 |
| `firmware-zero-diff.txt` / `non-ascii-check.txt` | 零固件 diff / ASCII 纪律 |
| `playground-build.log` / `playground-build-idempotent.log` / `website-check.txt` | 重建 PASS / 幂等 / 四类 none |
