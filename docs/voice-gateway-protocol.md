# Lume 语音网关协议 v1（设备 ↔ 网关）

本文定案 Lume 设备与语音网关之间的 WebSocket 线协议。设计边界：设备端只做薄 WS
客户端（文本控制帧 + 二进制双流），Opus 翻译、ASR/LLM/TTS 等重活全部在网关侧。
本轮只定设备↔网关这一段；网关↔上游（小智官方协议或 ASR/LLM/TTS 三件直连）的选型
未拍板，不在本协议范围内。

措辞约定：MUST / MUST NOT / SHOULD / MAY 按工程语义使用。`v` 字段为未来兼容留位，
所有 JSON 控制帧与下行二进制帧头都必须携带。

## 1. 传输与帧类型

- 传输：单个 WebSocket 连接（设备为客户端，网关为服务端）。`ws://` 明文本轮即可；
  `wss://` 留待部署轮。
- 文本帧（WS opcode 0x1）：UTF-8 JSON 控制消息，必须含 `v` 与 `type`。
- 二进制帧（WS opcode 0x2）：音频负载。上行（设备→网关）为裸 PCM；下行（网关→设备）
  带 8 字节头（见 §5）。
- 单条 WS 消息上限 64 KiB（与 `lume.net.ws` 的 64 KiB 上限一致）。
- 一条连接承载一轮会话（turn）。每轮结束网关主动关闭；新会话另开连接。

## 2. 会话生命周期

```
设备 connect() ──onOpen──> hello ──hello-ack──> [上行 PCM 帧 / text / end]
                                                      |
                        text-delta* + audio* + state ───┘
                                                      |
                                     state=idle + close(1000, done)
```

1. 设备建连后 MUST 第一帧发 `hello`。在此之前收到任何其它帧（文本或二进制）均为
   `not_hello` 致命错误，网关发 `error` 后关闭（1008）。
2. 网关校验 `hello.v`，回 `hello-ack`。收到 ack 前设备 SHOULD NOT 发音频帧。
3. 会话活跃期：设备持续上行 60 ms PCM 帧；网关流式下行文本 delta 与音频帧。
   `type=text` 与 `type=end` 为可选控制帧（见 §4.4 / §4.6）。
4. 一轮完成：网关发 `final=true` 的 text-delta（若上游有文本）、`state=idle`，
   然后 close(1000, "done")。设备在 onClose 中把该关闭码当正常结束处理。
5. 设备可随时主动 close；网关收到关闭后 MUST 停止并释放本轮上游适配器（幂等）。
6. 致命错误路径：网关先发 `error{fatal:true}` 再关闭；非致命错误只发 `error`，
   连接继续。

## 3. JSON 控制帧公共字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `v` | number | 是 | 协议版本，v1 固定 `1`。未知版本 → `unsupported_version` + 1008。 |
| `type` | string | 是 | 消息类型，见 §4。 |
| `sessionId` | string | 否 | 网关侧会话标识；hello-ack 起下行帧可带。设备侧忽略也可。 |
| `seq` | number | 否 | 下行流式序号（text-delta 与 audio 各自从 0 递增，溢出回绕）。 |

未知字段 MUST 被忽略（向前兼容）。未知 `type` 为非致命 `unknown_type` 错误。

## 4. 文本控制帧逐字段

### 4.1 `hello`（设备 → 网关，首帧）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `v` | 1 | 是 | 协议版本。 |
| `type` | "hello" | 是 | 固定值。 |
| `device` | object | 否 | `{model, fw, app}` 自描述字符串，仅日志用，不影响路由。 |
| `caps` | object | 否 | `{audioFormats: string[]}`；v1 仅识别 `"pcm_s16le_16000_2ch"`。缺省按该值处理。 |

示例（ASCII 负载）：`{"v":1,"type":"hello","device":{"model":"lume","fw":"r106"},"caps":{"audioFormats":["pcm_s16le_16000_2ch"]}}`

### 4.2 `hello-ack`（网关 → 设备）

| 字段 | 类型 | 说明 |
|---|---|---|
| `v` / `type` | 1 / "hello-ack" | 固定值。 |
| `sessionId` | string | 本轮会话标识。 |
| `audioFormat` | string | 网关确认的上行格式，v1 为 `"pcm_s16le_16000_2ch"`。 |

### 4.3 `text-delta`（网关 → 设备，流式文本）

| 字段 | 类型 | 说明 |
|---|---|---|
| `v` / `type` | 1 / "text-delta" | 固定值。 |
| `seq` | number | 从 0 递增，设备可用于丢包检测。 |
| `text` | string | 本段增量文本（UTF-8 原文； ANSI/设备文案由 app 层决定）。 |
| `final` | boolean | 最后一段为 `true`（可携带空 `text`），表示文本流结束。 |

设备把各段 `text` 顺序拼接；逐字上屏由 app 的 typewriter 效果完成（协议只保证
增量的顺序与完整性）。

### 4.4 `text`（设备 → 网关，可选）

`{"v":1,"type":"text","text":"..."}`：设备侧已有文本输入时喂给上游的
`sendText?`。上游未实现该能力时网关回非致命 `unsupported_text_input`。

### 4.5 `state`（网关 → 设备）

`{"v":1,"type":"state","state":"..."}`。`state` 取值为
`thinking | speaking | idle`，是网关对上游进度的**提示**，设备 app 保留自己的
IDLE/LISTEN/THINK/SPEAK 状态机，不强制同步。

### 4.6 `end`（设备 → 网关，可选）

`{"v":1,"type":"end"}`：设备说话结束，网关调用上游 `stop()` 收口本轮（不关闭 WS；
文本/音频下行可继续，直到网关发 idle + close）。设备直接 close 也等效收口。

### 4.7 `error`（双向，网关主动发为主）

| 字段 | 类型 | 说明 |
|---|---|---|
| `v` / `type` | 1 / "error" | 固定值。 |
| `code` | string | §7 错误码。 |
| `message` | string | 纯 ASCII 说明（面向设备/串口文案纪律）。 |
| `fatal` | boolean | `true` 表示网关随即关闭连接。 |

### 4.8 `pong`（网关 → 设备，可选心跳回执）

`{"v":1,"type":"pong"}` 回应设备 `ping`；本轮不依赖心跳判活，保留字段便于以后加。

## 5. 二进制帧

### 5.1 上行（设备 → 网关）：60 ms PCM 裸帧

v1 上行二进制帧 = **裸 PCM，无头**。格式由协议常量固定，并由 `hello.caps` 确认：

| 属性 | 值 |
|---|---|
| 采样率 | 16000 Hz |
| 位深 / 编码 | signed 16-bit little-endian |
| 声道 | 2，交错（interleaved stereo） |
| 帧长 | 60 ms = 960 立体声帧 = **3840 字节** |

网关对上行帧做严格长度校验：`!= 3840` 字节 → `bad_audio_frame` 致命错误 + 1009。
格式不符（如误发单声道 1920 字节）同等拒绝，不做猜测性转换。

设备侧适配说明：固件 `lume.audio.recordStream` 的 `chunkSamples` 只允许
512/1024/2048（默认 1024 = 64 ms），且 PCM 为 16 kHz/16-bit/交错立体声。
设备 app 必须用小缓冲把原生块重组为 960 帧的 60 ms 线帧后再发送；本轮网关只校验
线帧，不做设备侧重组的实现（属 app 层工作）。

### 5.2 下行（网关 → 设备）：带 8 字节头的音频帧

所有多字节整数为 little-endian：

| 偏移 | 长度 | 字段 | 值 / 说明 |
|---|---|---|---|
| 0 | 1 | `version` | 1（与 JSON `v` 同版，留兼容位） |
| 1 | 1 | `type` | 1 = audio（2..255 保留给未来二进制控制帧） |
| 2 | 1 | `format` | 1 = pcm_s16le（2 = mp3 保留，v1 不生成） |
| 3 | 2 | `sampleRate` | u16，16000（网关可协商 32000/44100/48000） |
| 5 | 1 | `channels` | 2 |
| 6 | 1 | `bits` | 16 |
| 7 | 1 | `seq` | u8，从 0 递增，回绕；与 text-delta 的 seq 独立 |
| 8 | N | payload | 音频字节；pcm 时 N 为 4 的倍数且 **N ≤ 4608** |

`payload` 直接喂 `lume.audio.playStream(pcm, {sampleRate, channels, bits})`；
4608 上限来自固件 `playStream` 的单块硬限制。设备 MUST 先解析头再决定解码方式，
不得假设固定头长以外的内容。v1 网关生成的 PCM 帧负载为 3840 字节（60 ms），
与上行对称。

## 6. 关闭语义

| 场景 | 网关关闭码 | reason | 前置帧 |
|---|---|---|---|
| 一轮正常完成 | 1000 | `done` | `text-delta(final=true)`? + `state=idle` |
| 设备主动关闭 | 1000（回显） | 设备给的值 | 无 |
| 未 hello 先发数据 / hello 非法 | 1008 | `not-hello` / `bad-hello` | `error{fatal:true}` |
| JSON 解析失败 | 1002 | `bad-json` | `error{fatal:true}` |
| 未知消息类型（非致命） | — | — | `error{fatal:false}`，连接继续 |
| 上行音频帧长度错误 | 1009 | `bad-audio-frame` | `error{fatal:true}` |
| 上游断连 / 内部错误 | 1011 | `upstream-error` | `error{fatal:true}` |

设备侧 `onClose` 不携带关闭码（见 `lume.d.ts`：回调签名 `() => void`），因此
**结束原因必须由关闭前的 `state` / `error` 帧传达**；关闭码仅用于宿主/网关联调日志。
`onError(error: number)` 只在 WS 层错误时触发，不等价于协议 `error` 帧。

## 7. 错误码

| code | fatal | 触发 |
|---|---|---|
| `bad_json` | 是 | 文本帧不是合法 JSON 或不是对象。 |
| `not_hello` | 是 | 首帧不是 `hello`（含首帧即为二进制）。 |
| `bad_hello` | 是 | `hello.v` 缺失/非 1，`type` 不符。 |
| `unsupported_version` | 是 | `v` 不是 1。 |
| `bad_audio_frame` | 是 | 上行二进制帧长度 ≠ 3840。 |
| `unknown_type` | 否 | 控制帧 `type` 未定义。 |
| `unsupported_text_input` | 否 | 上游未实现 `sendText?` 却收到 `text`。 |
| `upstream_closed` | 是 | 上游在响应中途中止/断连。 |
| `upstream_error` | 是 | 上游抛出其它错误。 |

非致命 `error` 帧之后连接保持可用；设备 SHOULD 记录但不进入错误处理流程。

## 8. 与上游适配器的边界（本协议不规定）

网关内部用可插拔 `UpstreamAdapter` 接口承接真实上游：

```
start(session)            会话建立；通过 session 发 text-delta/audio/state/error
sendAudio(pcm: Buffer)    收到设备 3840 B PCM 帧
sendText?(text: string)   可选：收到设备 text 控制帧
stop()                    收口/中止本轮（幂等；不得回调 session.close）
```

`session` 暴露 `sendTextDelta(text, final)` / `sendAudio(header, pcm)` /
`sendState(state)` / `sendError(code, message, fatal)` / `close(code, reason)` /
`sessionId` / `isOpen()` / `log()`。`stop()` 是建议性的资源释放，不取消已开始的响应。
真实上游（小智 WS+Opus、ASR/LLM/TTS 三件直连）均为 TODO 桩，
本轮不做实现，也不在协议或网关里臆测任何 API key / 凭据处理。

## 8.1 上游适配器：OpenAI 兼容（r113 拍板，r114 chat 段流式化）

r113 拍板采用 **OpenAI 兼容路线** 作为首个真实上游，实现在
`tools/gateway/upstream-openai.js`（CommonJS，零新 npm 依赖，Node 18+ 内置
`fetch` / `FormData` / `Blob` / `AbortController`）。选型理由：①合规——不使用任何
绕过/爬取手段，用户自备 API key、网关侧 env 注入，零 key 不进 git；②生态——
OpenAI Audio API 的 `/audio/transcriptions`（Whisper 系）、`/chat/completions`、
`/audio/speech` 三段有大量兼容端点（本地 faster-whisper / piper 服务、各类聚合网关
都按此规范开放），一份适配器服务一族上游。小智协议上游仍留桩（`XiaozhiUpstream`
`NOT_IMPLEMENTED`）。

### 8.1.1 env 配置（CLI `--upstream openai`）

| env | 默认值 | 说明 |
|---|---|---|
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | 三段共用 base URL，兼容端点填这里。 |
| `OPENAI_API_KEY` | （必填） | 缺失则 CLI 报清晰错误并 `exit 2`，与旧 stub 同风格；不进 git / docs 硬编码。 |
| `OPENAI_STT_MODEL` | `whisper-1` | transcription 模型。 |
| `OPENAI_CHAT_MODEL` | `gpt-4o-mini` | chat 模型。 |
| `OPENAI_TTS_MODEL` | `tts-1` | speech 模型。 |
| `OPENAI_TTS_VOICE` | `alloy` | speech voice。 |
| `OPENAI_CHAT_BASE_URL` | （空） | 可选：独立覆盖 LLM 端点，仅 chat 段改打此处，stt/tts 仍走 `OPENAI_BASE_URL`。 |

`--upstream mock` 仍是默认，行为不变（r107 canned 问答 + 合成 PCM）。

### 8.1.2 三段映射与收口时序

一轮内上行 60 ms PCM 帧（3840 B / 帧）**先攒后发**：`sendAudio()` 只累积，
不做流式 ASR；`stop()`（由 `end` 控制帧经 `_stopUpstream()` 触发，见 §4.6）作为
本轮收口信号启动一次三段 one-shot 管线：

1. `POST {base}/audio/transcriptions`：multipart `file` = PCM 包的 44 B 头 WAV
   （立体声下混单声道、16 kHz / 16-bit），`model` = STT 模型；取 `text` 为转写。
2. `POST {chat_base}/chat/completions`：`messages` = system 提示词 + user（转写文本，
   可选拼接设备 `text` 控制帧内容），并带 `stream:true` + `Accept: text/event-stream`。
   r114 起为 SSE 真流式：每个 chunk 的 `choices[0].delta.content` 即时经
   `sendTextDelta(content, false)` 下发并累计为完整回复（见 §8.1.6）。
3. `POST {base}/audio/speech`：`body` = `model` / `input`=累计回复 / `voice` /
   `response_format=pcm`；返回 24 kHz 16-bit mono PCM，线性插值重采样到 16 kHz
   stereo s16le 后按 3840 B 帧序 `session.sendAudio(fmt, pcm)` 下行（帧头见 §5.2）。
4. 文本 deltas 在第 2 步随 SSE chunk 逐段上屏，SSE 正常结束
   （`data: [DONE]` 或 EOF）后由适配器发一条 `sendTextDelta('', true)` 收口；随后
   TTS 音频帧下行、`state=idle`、`close(1000, done)`，不持上游长连接。

`stop()` 是建议性收口（§8）：幂等、不取消已开始的响应、不调 `session.close()`；
仅当会话仍 `isOpen()` 且已收到至少一帧音频时启动管线（设备主动 close / 致命错误
也调 `stop()`，此时不启动）。另设**静默兜底定时器**（默认 3000 ms，每帧重置）：
设备只发音频但不发 `end` 时也能收口，避免轮悬空。

### 8.1.3 24k → 16k 重采样口径（`resample24kMonoTo16kStereo`）

- 输入 24 kHz mono s16le；输出 16 kHz stereo s16le（L=R 复制单声道）。
- 输出样本数 `floor(inSamples × 16000/24000)`；输出第 `i` 点源位置 `i × 1.5`，
  取 `floor` 与 `floor+1` 两点线性插值后四舍五入、clip 到 int16。
- 下行按 3840 B（960 stereo 帧）切帧，尾帧零填充到 3840 B；帧头 format=1 /
  rate=16000 / channels=2 / bits=16（§5.2），单帧负载 ≤4608 的固件上限满足。

### 8.1.4 错误与超时映射（§7 口径）

- 每段 30 s `AbortController` 超时；超时按 `upstream_closed`（fatal）处理。
- HTTP 非 2xx：429 / 5xx 视为可重试瞬断，最多 **1 次重试**（间隔 1 s），仍失败按
  `upstream_error`（fatal）上抛；401 等其它 4xx 不重试，按 `upstream_error`
  （非 fatal）上抛。网络错按 `upstream_closed`（fatal）。
- 任一段失败都回 `state=idle` + `error` 帧，不挂死、不重试风暴；fatal 由网关按
  §6 关 1011，非 fatal 由适配器收尾 `close(1000, done)`。

### 8.1.5 验证边界

宿主 harness（`tests/gateway_upstream.js`，r114 共 20 case）用 `node:http` 本地假端点
验证 WAV 头 / 下混、chat 请求体 + SSE 流式、重采样、delta 顺序 / 单次 final、
split-line/`[DONE]`、断流收口、stop 中止与 401 / 超时 / 5xx 负向；集成 smoke 用
真实 `cli.js --upstream openai` + 假 SSE 端点 + device-sim 跑通一轮。
**不出网、不声称真机验证**；真机 WiFi / 时延 / 双 DMA deferred（见 KNOWN-SIMPLIFICATIONS）。

### 8.1.6 chat SSE 流式口径（r114）

- **请求**：body 在 r113 字段上追加 `stream:true`，头加 `Accept: text/event-stream`；
  `OPENAI_CHAT_BASE_URL` 覆盖规则不变。响应必须 200 且 `Content-Type` 含
  `text/event-stream`，否则按错误路径处理（见下）。
- **行格式**（对照本地 `node:http` 假端点实证）：事件以空行分隔；`field: value`
  去掉一个前导空格；同一事件多条 `data:` 以 `\n` 拼接；`:comment` 忽略；
  `data: [DONE]` 终止。Node 18+ `fetch` 的 `res.body` 支持 `for await...of`，
  分片可落在任意行中间，解析器按 `\n` 缓冲半行，兼容 `\r\n`。
- **delta**：每个含 `choices[0].delta.content` 的非空 chunk 立即
  `sendTextDelta(content, false)`，同时累计完整文本供 TTS 与空回复判断。正常收口
  恰好一条 `final=true`（空回复也发，与 r113 一致）。r113 的 `splitTextDeltas()`
  伪切块不再在流式路径调用，函数保留为导出工具 / 未来非流式端点备用
  （取舍见 KNOWN-SIMPLIFICATIONS）。
- **流中错**：SSE 头已接受后断开 / 读抛错 / 超时 → 已发 delta 不撤回，以一条
  `final=true`（文本可含截断标记）收口，按非 fatal `upstream_error` 处理
  （与 401 同类，`close(1000)`），且**不重试**——重试会重复已上屏 delta。头之前
  失败（非 200、Content-Type 不符、网络错）保持 r113 映射与 1 次重试。
- **stop() 交互**：`stop()` 幂等；若它到达时 chat SSE 正在读（管线由静默定时器
  先启动、`end` / 设备 close 后到），复用同一 `AbortController` 中止读流，不撤
  已发 delta，最终 `idle` + `close(1000)`，无 error 帧。STT / TTS 在途时仍按
  r113 建议性语义不取消。
- **TTS**：仍为整段一次性 `/audio/speech`（输入为累计文本）；流式 TTS deferred。

## 9. 版本兼容策略

- v1 为冻结基线；新增字段只能追加，旧字段语义不得改变。
- 设备发来高于 1 的 `v`：网关回 `unsupported_version` + 1008，不猜测降级。
- 网关未来升 v2 时，必须在 `hello-ack` 中显式给出协商版本；设备只接受自己支持的
  版本。二进制头 `version` 与 JSON `v` 同步演进。
- 未知 WS opcode / 分片：本轮按 WS 层错误处理（1002），不进入本协议解析。

## 10. 本轮验证边界（诚实口径）

宿主 harness 用 mock 上游（canned 问答 + 合成正弦/静音 PCM）验证：协议字段、60 ms
分帧长度、流式序号、关闭与错误语义、未 hello/坏帧/上游断连负向路径。
**不声称真机验证、不声称已接真实 ASR/LLM/TTS 上游**；真实上游接入、真机
`playStream` 边收边播时延与双 DMA 并发留接板轮。
