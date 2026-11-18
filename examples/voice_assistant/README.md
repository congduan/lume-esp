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
   node tools/gateway/cli.js --port 8765 --host 0.0.0.0
   ```

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

3. 重启 app：boot 时 `vaDetectMode()` 看到 URL + `GOT_IP` → `MODE GATEWAY`，
   自动把 `vaTransportWS` 注入 `vaSetTransport()`。无需改状态机。

`vaSetTransport(fn)` 的约定不变：`fn(prompt, done)`，`done(text, err)`。
传空或非函数一律回落到 legacy（`vaSetTransport()` / `vaSetTransport(null)`），
所以「无网关」时 demo 仍可用。

## 一轮 WS 对话的线协议

详见 `docs/voice-gateway-protocol.md` v1。设备侧实现要点：

- 建连第一帧必须是 `hello`（含 `v:1`、`device`、`caps.audioFormats`）；
  收到 `hello-ack` 前不发音频。
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
  小智官方协议上游仍留桩未接。无 TLS / 鉴权，沿用 trusted-LAN 信任模型。
- host harness（`node tests/va_ws.js`）只证明**协议字段与 app 逻辑**正确；
  真机 WiFi 下 WS 稳定性、时延预算、双 DMA 并发、触摸 barge-in 手感一律
  deferred to board bring-up，**未声称真机验证**。
- 固件零改动：契约已由 `runtime/types/lume.d.ts` 的 `namespace ws` / `audio`
  与 `firmware/components/lume-net/lume_ws.c` 覆盖，本轮不需要改 C。
