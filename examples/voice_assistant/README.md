# voice_assistant 的两种模式

`examples/voice_assistant/app.js` 是纯 app 层对讲机 demo，状态机固定为
`IDLE → LISTEN → THINK → SPEAK`（barge-in 可从 SPEAK 直接回 IDLE）。
「回复从哪来」由单一的 `vaTransport` 槽决定，有两种模式：

| 模式 | 触发条件 | transport | 回复来源 |
|---|---|---|---|
| `GATEWAY` | KV 中有 `voice_gateway_url` 且 WiFi 已 `GOT_IP` | `vaTransportWS` | `lume.net.ws` 连网关，真流式 |
| `LIVE` / `DEMO` | 无网关 URL；有/无 `ai_api_key` + `GOT_IP` | `vaTransportLegacy` | 同步 `lume.ai.chat` 或 canned 问答 |

`MODE GATEWAY` / `MODE LIVE` / `MODE DEMO` 徽章如实显示当前模式。

## WS 模式用法

1. 启动网关（零依赖，Node ≥18）：

   ```bash
   node tools/gateway/cli.js --port 8765 --host 0.0.0.0 --device-token MY_SHARED_TOKEN
   ```

   `--device-token` 优先于 env `GATEWAY_DEVICE_TOKEN`；两者都留空即**开放 LAN 模式**
   （r119 之前的行为，零鉴权，便于本地开发）。非空即**锁定模式**：设备 hello 必须
   带匹配 token，否则网关回 `error{code:"unauthorized",fatal:true}` + close 1008，
   不建上游会话。token 不进日志（只记 `deviceAuth=on/off`）、不进 git。
   完整安全模型见 `docs/voice-gateway-protocol.md` §8.2。

   CLI 默认端口是 **8765**；app 顶部常量 `VA_GATEWAY_URL` 默认是
   `ws://192.168.1.50:18770/`（LAN 占位地址）。两者必须对齐。

   要接真实上游（OpenAI 兼容，需用户自备 key）：

   ```bash
   OPENAI_API_KEY=... OPENAI_BASE_URL=https://api.openai.com/v1 \
     node tools/gateway/cli.js --upstream openai --port 8765 --host 0.0.0.0
   ```

   可选 env：`OPENAI_STT_MODEL` / `OPENAI_CHAT_MODEL` / `OPENAI_TTS_MODEL` /
   `OPENAI_TTS_VOICE` / `OPENAI_CHAT_BASE_URL`（独立覆盖 LLM 端点）。无
   `OPENAI_API_KEY` 时选 `openai` 会报清晰错误并 exit 2；key 不进 git / docs。

2. 在设备上设置网关 URL（KV 优先于顶部常量）：

   ```js
   lume.storage.kv.set('voice_gateway_url', 'ws://192.168.1.10:8765/');
   ```

   也可以直接改 app 顶部 `VA_GATEWAY_URL` 常量后重新部署。URL 必须是
   `ws://` 或 `wss://`，预留最长 2048 字节。

3. 网关处于锁定模式时，在设备上写入**同一个** token（KV 优先于顶部常量）：

   ```js
   lume.storage.kv.set('voice_gateway_token', 'MY_SHARED_TOKEN');
   ```

   app 顶部对应常量是 `VA_GATEWAY_TOKEN`（默认 `''`）。留空 = 开放模式，hello
   不带 `auth` 字段；非空 = hello 追加 `auth.token`（协议 §4.1/§8.2 的追加字段）。
   也可用 deploy 前 meta 预置该 KV。token 值不会写进任何日志行。

4. 重启 app：boot 时 `vaDetectMode()` 看到 URL + `GOT_IP` → `MODE GATEWAY`，
   自动把 `vaTransportWS` 注入 `vaSetTransport()`。无需改状态机。

`vaSetTransport(fn)` 的约定不变：`fn(prompt, done)`，`done(text, err)`。
传空或非函数一律回落到 legacy（`vaSetTransport()` / `vaSetTransport(null)`），
所以「无网关」时 demo 仍可用。

## 一轮 WS 对话的线协议

详见 `docs/voice-gateway-protocol.md` v1。设备侧实现要点：

- 建连第一帧必须是 `hello`（含 `v:1`、`device`、`caps.audioFormats`；锁定模式
  追加 `auth.token`）；收到 `hello-ack` 前不发音频。token 校验失败 →
  `error{code:"unauthorized"}` + close 1008，设备回 IDLE 不挂死。
- 上行：`lume.audio.recordStream({chunkSamples:1024})` 产出 4096 B 原生块，
  app 重组为 **60 ms = 3840 B** 裸 s16le 立体声帧（16 kHz / 16-bit / 2ch），
  流满 `VA_STREAM_FRAMES`(3) 帧后停流并发 `{"v":1,"type":"end"}`；
  barge-in 也会停流并补发 end。
- 下行：文本 `text-delta{seq,text,final}` 逐字写信号上屏；二进制帧先解
  8 字节头 `{version,type,format,rate:u16,channels,bits,seq}`，再把 payload
  直接喂 `lume.audio.playStream(pcm,{sampleRate,channels,bits})`，边收边播；
  `playStream` 返回 -3（队列满）时下一 pump tick 重投同一块。
- 收口：`state=idle` 或网关 `close` → `vaWSFinish()` 幂等收尾，状态机回 IDLE；
  `onError` / 致命 `error` 帧同样回 IDLE，不挂死。

## 边界与取舍（诚实口径）

- 网关默认 **mock 上游**（canned 问答 + 合成正弦/静音 PCM），另可选
  **OpenAI 兼容上游**（r113：`--upstream openai` + `OPENAI_*` env，三段
  `/audio/transcriptions` + `/chat/completions` + `/audio/speech`，用户自备 key）；
  小智官方协议上游仍留桩未接。r119 起支持**可选共享 token 设备鉴权**
  （网关 `GATEWAY_DEVICE_TOKEN` / `--device-token` + 设备 KV `voice_gateway_token`），
  但 `ws://` 无 TLS，token 明文传输，只挡住未授权客户端、不防局域网抓包；
  边界与取舍见协议 §8.2 与 `docs/KNOWN-SIMPLIFICATIONS.md` r119 节。
- host harness（`node tests/va_ws.js`）只证明**协议字段与 app 逻辑**正确；
  真机 WiFi 下 WS 稳定性、时延预算、双 DMA 并发、触摸 barge-in 手感一律
  deferred to board bring-up，**未声称真机验证**。
- 固件零改动：契约已由 `runtime/types/lume.d.ts` 的 `namespace ws` / `audio`
  与 `firmware/components/lume-net/lume_ws.c` 覆盖，本轮不需要改 C。

## r121 多轮记忆（设备侧连接复用；零固件 / 零协议帧改动）

r120 给网关加了有界会话历史与可选 `--multiturn` 会话保活；r121 让本 app 真正
用上它。**设备协议帧零变化**：多轮不是新帧型，而是同一 WS 连接被连续多轮复用。

开启方式（KV 优先于顶部常量，与网关 URL / token 同风格）：

```js
lume.storage.kv.set('voice_gateway_multiturn', '1');   // 或 true / 'true'
```

- 顶部常量 `VA_GATEWAY_MULTITURN` 默认 `false`；网关侧必须同时开
  `--multiturn` / `GATEWAY_MULTITURN=1`，否则网关每轮仍 close，设备下一轮自动
  回退到新连接（历史随之清零）。
- **开**：第一轮 `hello`（锁定模式带 `auth.token`）→ 流式回复 → `state=idle`
  后 app **不关 WS**，把它 park；再次 TALK 直接在该连接上发 3840 B 上行帧 +
  `end`，**不重发 hello**，token 也不重发（该连接已通过门）。`MODE` 行下方新增
  信号驱动的上下文行：`TURN n  PREV: <上一轮回复>`。
- **关**（默认）：每轮行为与 r108/r119 逐字节等价 —— `state=idle` 即 close，
  下一轮新连接、新 hello；不显示上下文行。
- 连接被网关关闭、致命 `error`、`onError` 或 barge-in 中止都会清掉 park；下一次
  TALK 走全新连接并重新发送带 KV token 的 hello，网关 token 门**照常拦截**。
  历史只活在网关侧窗口内，app 不本地存历史；重连即遗忘（见 KNOWN-SIMPLIFICATIONS r121）。

Host 验证：`node tests/va_ws.js` 现 12 case（9 基线 + 3 r121：跨轮保活 / 无重 hello /
close 重连历史清零 + token 门复拦）；真 `device-sim --turns 2` + 锁定网关 +
`--multiturn` 的两轮 smoke 见 `artifacts/r121-smoke.log`。真机时延 / barge-in 手感
deferred to board，未声称真机验证。
