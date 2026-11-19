# Lume 语音网关协议 v1 / v1.1（设备 ↔ 网关）

本文定案 Lume 设备与语音网关之间的 WebSocket 线协议。设计边界：设备端只做薄 WS
客户端（文本控制帧 + 二进制双流），Opus 翻译、ASR/LLM/TTS 等重活全部在网关侧。
本轮只定设备↔网关这一段；网关↔上游（小智官方协议或 ASR/LLM/TTS 三件直连）的选型
未拍板，不在本协议范围内。

**v1.1（r117）是 v1 的追加式扩展**：只新增一种下行消息 `transcript-delta`，线上
`v` 仍固定 `1`，不改动任何 v1 字段语义（§9 的 v1 冻结基线保持成立）。未实现 v1.1
的旧设备 MUST 把未知的下行 `type` 当"忽略"（记日志即可），不得因此报错、断连或
进入错误处理；网关也必须容忍设备不认识该消息。

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
             (v1.1) transcript-delta*  ← 上行帧到达即转写，先于 chat
                                                      |
                        text-delta* + audio* + state ───┘
                                                      |
                                     state=idle + close(1000, done)
```

锁定模式（§8.2）下，`hello` 的 token 校验插在 `v` 校验与 `hello-ack` 之间；
失败分支直接 `error{code:"unauthorized",fatal:true}` → `close(1008)`，不进入
下列任何会话阶段、不回 `hello-ack`、不初始化上游适配器。

一轮内的严格顺序（v1.1 流式转写已协商时）：
`transcript-delta(final=false)*` → `transcript-delta(final=true)` → `text-delta*`
（含 chat 的 `final=true`）→ `audio*` → `state=idle` → `close(1000, done)`。
`text-delta` 的首帧 MUST NOT 早于定稿转写帧；音频仍按 r116 按句流式，
首句音频可早于 chat SSE 收口（§8.1.7），但不会早于定稿转写帧。

1. 设备建连后 MUST 第一帧发 `hello`。在此之前收到任何其它帧（文本或二进制）均为
   `not_hello` 致命错误，网关发 `error` 后关闭（1008）。
2. 网关校验 `hello.v`；若网关处于锁定模式（§8.2），再校验 `hello.auth.token`。
   两者都通过才回 `hello-ack`。收到 ack 前设备 SHOULD NOT 发音频帧。token
   校验失败即 `error{code:"unauthorized",fatal:true}` + close(1008)，**不回
   hello-ack、不建上游会话、不发任何上游请求**。校验顺序固定为
   `not_hello`（首帧类型）→ `unsupported_version`（`v`）→ `unauthorized`（token）。
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
| `seq` | number | 否 | 下行流式序号（text-delta、transcript-delta 与 audio **各自独立**从 0 递增，溢出回绕）。 |

未知字段 MUST 被忽略（向前兼容）。未知 `type` 为非致命 `unknown_type` 错误。

## 4. 文本控制帧逐字段

### 4.1 `hello`（设备 → 网关，首帧）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `v` | 1 | 是 | 协议版本。 |
| `type` | "hello" | 是 | 固定值。 |
| `device` | object | 否 | `{model, fw, app}` 自描述字符串，仅日志用，不影响路由。 |
| `caps` | object | 否 | `{audioFormats: string[]}`；v1 仅识别 `"pcm_s16le_16000_2ch"`。缺省按该值处理。 |
| `auth` | object | 否（锁定模式必填） | `{token: string}`，r119 追加字段（§9 只追加）。开放模式 MUST 忽略该字段；锁定模式缺失/类型错/不匹配均 → `unauthorized` + 1008。 |

示例（ASCII 负载）：
`{"v":1,"type":"hello","device":{"model":"lume","fw":"r106"},"caps":{"audioFormats":["pcm_s16le_16000_2ch"]}}`
锁定模式追加（token 仅示意，真实值由设备 KV / env 注入，不进代码库）：
`{"v":1,"type":"hello",...,"auth":{"token":"SHARED_TOKEN"}}`

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

### 4.3.1 `transcript-delta`（网关 → 设备，用户语音转写；v1.1 新增）

| 字段 | 类型 | 说明 |
|---|---|---|
| `v` / `type` | 1 / "transcript-delta" | 固定值；线上 `v` 仍为 1（追加式扩展）。 |
| `seq` | number | 从 0 递增，**与 text-delta / audio 的 seq 独立**，设备可用于丢包检测。 |
| `text` | string | `final=false`：本段转写增量；`final=true`：**完整定稿转写全文**。 |
| `final` | boolean | 最后一条为 `true`，表示转写定稿；每轮**恰好一条**。 |

语义要点：

1. `final=false` 是增量，设备把各段 `text` 顺序拼接得到当前"你说的"文本；
   `final=true` 携带的是**完整定稿文本而非又一段增量**，设备 MUST 用它**替换**
   已累积的中间转写，不得再次拼接（否则定稿文本会重复上屏）。
2. 定稿帧 MUST 在 chat 的任意 `text-delta` 之前到达设备；即"先定稿你说的，
   再开始播助手答的"。`final=true` 的 `text` 可为空（上游未识别到语音）。
3. **能力协商**：设备在 `hello.caps` 中带 `streamTranscript: true` 表示认识该消息；
   网关还需配置启用流式转写（§8.1.1 的 `OPENAI_STREAM_ASR` + `OPENAI_ASR_WS_URL`）。
   两者缺一，网关 MUST NOT 发 `transcript-delta`，并回退 r113 的一次性 REST ASR。
4. **向后兼容 / 忽略规则**：未实现 v1.1 的旧设备收到未知下行 `type` 时 MUST 忽略
   （仅记日志），不得回 `error`、不得断连、不得把整轮当失败；未知字段同样忽略。
   新设备与 device-sim 均实现"消费 / 忽略"两路（见 §8.1.8）。
5. 该消息不改变 `state` 机与关闭语义；一轮正常完成仍以 `state=idle` +
   `close(1000, done)` 收口。

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
| 设备 token 缺失 / 不匹配（锁定模式） | 1008 | `unauthorized` | `error{fatal:true}`，无 `hello-ack`、无上游请求 |
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
| `unauthorized` | 是 | 锁定模式下 `hello.auth.token` 缺失、非字符串或与网关配置不等（§8.2）；校验在 `v` 之后、建上游之前。message 为固定 ASCII 文案，不回显正确 token。 |
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
`sessionId` / `isOpen()` / `log()`；v1.1 追加 `sendTranscriptDelta(text, final)`
（seq 独立，§4.3.1）与只读 `caps`（hello 协商用）。`stop()` 是建议性的资源释放，
不取消已开始的响应（r117 的转写 WS 中止是管线已启动时的例外，见 §8.1.8）。
真实上游（小智 WS+Opus、ASR/LLM/TTS 三件直连）均为 TODO 桩，
本轮不做实现，也不在协议或网关里臆测任何 API key / 凭据处理。

## 8.1 上游适配器：OpenAI 兼容（r113 拍板，r114 chat 流式化，r116 按句流式 TTS）

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
| `OPENAI_STREAM_ASR` | （空=关闭） | v1.1 流式转写配置开关；仅当值为 `1` 时开启。 |
| `OPENAI_ASR_WS_URL` | （空） | 流式转写 WS 端点（如本地假端点 `ws://127.0.0.1:<port>/asr`）；不硬编码真实地址，必须显式配置。 |

`--upstream mock` 仍是默认，行为不变（r107 canned 问答 + 合成 PCM）。流式转写需要
**配置开关 + 设备 `hello.caps.streamTranscript` + 非空 WS URL** 三者同时满足，
否则一律走 r113 一次性 REST（§8.1.2），行为与 r113 完全一致。

### 8.1.2 三段映射与收口时序

上行 60 ms PCM 帧（3840 B / 帧）的 STT 段有两条路径（r117 翻案 r113 的"先攒后发"）：

- **流式（v1.1 已协商）**：`sendAudio()` 收到帧即转发给转写 WS（握手未完成时先排队、
  连上后连 PCM 带 end-of-audio commit 一起 flush），中间结果即刻
  `transcript-delta(final=false)`；`stop()` 只负责 commit 并等待**一条**定稿
  `transcript-delta(final=true)`，然后才进 chat。细节与错误语义见 §8.1.8。
- **一次性 REST（默认 / 降级）**：与 r113 完全一致——`sendAudio()` 只累积，
  `stop()`（由 `end` 控制帧经 `_stopUpstream()` 触发，见 §4.6）作为本轮收口信号
  启动三段 one-shot 管线，不产生任何 `transcript-delta`。

三段管线（r116 起 chat 真流式、TTS 按句流式）收口时序：

1. `POST {base}/audio/transcriptions`（REST 路径）：multipart `file` = PCM 包的
   44 B 头 WAV（立体声下混单声道、16 kHz / 16-bit），`model` = STT 模型；取 `text`
   为转写。流式路径的等价结果是 §8.1.8 的定稿转写文本，两者都作为 chat 的 user 消息。
2. `POST {chat_base}/chat/completions`：`messages` = system 提示词 + user（转写文本，
   可选拼接设备 `text` 控制帧内容），并带 `stream:true` + `Accept: text/event-stream`。
   r114 起为 SSE 真流式：每个 chunk 的 `choices[0].delta.content` 即时经
   `sendTextDelta(content, false)` 下发并累计为完整回复（见 §8.1.6）。
3. `POST {base}/audio/speech`：**按句多次调用（r116）**。`body` = `model` /
   `input`=**当前完整句**（而非累计全文）/ `voice` / `response_format=pcm`；句子由
   §8.1.7 的切分器从 chat delta 流产出。每段返回的 24 kHz 16-bit mono PCM 立即
   线性插值重采样到 16 kHz stereo s16le，并按 3840 B 帧序
   `session.sendAudio(fmt, pcm)` 下行（帧头见 §5.2）；同一时刻最多 1 个在途请求，
   串行保证音频顺序。细节见 §8.1.7。
4. 文本 deltas 在第 2 步随 SSE chunk 逐段上屏；**第一句 TTS 完成即 `state=speaking`
   并下行音频，不等待 chat 收口**（流式收益点）。SSE 正常结束（`data: [DONE]`
   或 EOF）后由适配器发一条 `sendTextDelta('', true)` 收口；**全部句子播完 + chat
   收口后**才 `state=idle`、`close(1000, done)`，不持上游长连接。

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

宿主 harness（`tests/gateway_upstream.js`，r117 共 **34 case**）用 `node:http` +
`attachWsServer` 本地假端点验证 WAV 头 / 下混、chat 请求体 + SSE 流式、按句 TTS
请求体与帧序、重采样、delta 顺序 / 单次 final、split-line/`[DONE]`、断流收口、
stop 中止与 401 / 超时 / 5xx 负向；r116 的 7 case 覆盖切句 / 首帧早于 chat 收口 /
多句串行顺序 / 单句失败跳过 / 中断补播 / stop abort / chat 收口后 stop；r117 新增
7 case 覆盖 interim seq 递增与单条定稿、定稿早于 chat 首 delta、帧到达即转发的时间戳、
无 caps / 配置关闭回退 REST、stop 中途中止转写流、转写流错误降级 REST、end 早于握手
时 commit 排队。`tests/gateway.js`（11 case）用真会话验证 transcript seq 独立。集成
smoke 用真实 `cli.js --upstream openai` + 假转写 WS + 假 SSE + 假 TTS + device-sim
跑通一轮，断言定稿转写早于 chat 首 delta、REST 未命中、34 帧音频、全链路顺序。
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
- **stop() 交互（r116 收紧）**：`stop()` 幂等；管线已启动时中止**两类**在途读流——
  chat SSE 读与当前 TTS `/audio/speech` 请求，丢弃队列中未开始的句子，保留已播
  音频；被中止的请求不重试（`_withRetry` 见 `_stopAborted` 即停）。不撤已发 delta，
  最终 `idle` + `close(1000)`，无 error 帧。r117 起若流式转写已协商，`stop()` 在管线
  已启动时还会 abort 转写 WS（§8.1.8）；REST 路径的 STT 仍按 r113 建议性语义不取消。
- **TTS**：r114 为整段一次性 `/audio/speech`；r116 已翻案为按句流式流水线，见 §8.1.7。

### 8.1.7 流式 TTS 时序（r116）

- **切句**：纯 Node 状态机 `tools/gateway/sentence-splitter.js`。`feed(chunk)` 跨调用
  缓冲，`seal()` 在 chat 收口时 flush 残留且幂等。边界为 `.!?。！？`；终止符后若紧接
  闭合引号/括号（`"'")]}` 及 `」』）》`）或另一个终止符（`...` / `?!`），留在同一句；
  其后遇到空白或普通字符即成句。发出的句子 trim 后作为 `input`。r113 的
  `splitTextDeltas()` 伪切块不再参与此路径（保留为导出工具）。
- **流水线**：chat SSE 的每个 delta 同步喂给切分器；每凑满一句即入队并触发串行消费。
  同一时刻最多 1 个 `/audio/speech` 在途（避免兼容端点限流风暴、保证顺序）；每段
  PCM 即刻 `resample24kMonoTo16kStereo` + `chunkPcm` 下行，不等后续句子。`speaking`
  在第一帧前置位；`idle` + `close(1000)` 必须等 chat 已收口且队列清空。
- **时序（文字图）**：
  ```
  STT(one-shot) -> chat SSE (逐字 delta) --feed--> splitter --sentence--> TTS queue
                                                        --serial--> /audio/speech
                        -> resample 24k->16k -> 3840B frames -> device
        ^ first-sentence audio starts here, BEFORE chat [DONE] / final delta
  ```
- **并发与守卫**：Node 单线程事件循环下 chat 读与 TTS 消费并发；每段请求前、每帧
  下行前均有 `alive()` 守卫；设备已关则停队列并中止在途请求。
- **错误取舍**：某句 TTS 失败（429/5xx/超时，允许 1 次重试）→ 已播段保留、该句 log
  跳过、继续后续句子；全部句子失败才按既有 `_fail` 映射。chat SSE 中断时已入队
  句子照常合成播完，带截断标记的 final 照旧（r114 语义不变）。
- **验证边界**：本地假端点 + host harness + 集成 smoke（慢速逐字 SSE）给出
  "首帧音频早于 chat SSE 结束"的直接时间序证据；无真机 / 无出网 / 无真实 key，
  真机时延与 barge-in 手感 deferred（见 KNOWN-SIMPLIFICATIONS r116）。

### 8.1.8 流式转写适配（r117；上游协议为适配性假设，非真机实证）

- **启用条件**：`OPENAI_STREAM_ASR=1` + 非空 `OPENAI_ASR_WS_URL` + 设备
  `hello.caps.streamTranscript === true`，三者缺一即走 r113 REST。真实 key / 真实
  端点地址不进 git；WS 握手只带 `Authorization: Bearer <apiKey>`（由 env 注入，
  ws-client 对额外头做 ASCII/名字白名单，防注入），不把 key 放 URL 或日志。
- **上游事件形状（假设，可在 `asr-stream.js` 单点替换）**：面向 OpenAI Realtime
  转写风格端点；interim 接受 `{"type":"transcript.delta","text":...}` 或
  `{"type":"input_audio_transcription.delta","delta":...}`；定稿接受
  `{"type":"transcript.done","text":...}` 或
  `{"type":"input_audio_transcription.completed","transcript":...}`，以及本地假端点
  常用的 `{"text":...,"final":true}`。其它事件忽略，绝不臆造定稿。
- **上行与收口**：每帧 3840 B PCM 以二进制帧到达即转发；握手未完成时帧与
  end-of-audio commit 一起排队，连上后按"先 PCM 后 commit"顺序 flush（真 device-sim
  的 `end` 早于 WS 握手，此路径有专门 case 34）。收口等待定稿有界
  （`transcriptFinalTimeoutMs`，默认 1500 ms），超时用已累积 interim 兜底发**一条**
  定稿，不悬挂、不重复。
- **错误取舍（选"回退 REST"）**：握手失败 / 流中断 / 读错 → 记
  `openai.asr.error` / `openai.asr.handshake` 日志，改走 r113 一次性 REST；
  成功后再发一条定稿转写（内容为 REST 全文，替换 interim），chat / TTS 不中断。
  若 REST 也失败，仍先发一条定稿（可为空文本）再按 §7 既有 `_fail` 映射收口。
  理由：优先保住整轮可用性，且 r113 路径已被 27 case 实证；不把流中断升级为
  新错误码、不另发重复定稿。代价见 KNOWN-SIMPLIFICATIONS r117。
- **幂等与中止**：`_emitTranscriptFinal()` 由 `_transcriptFinalSent` 守卫，一轮
  至多一条 `final=true`；`stop()` 在管线已启动时同时 abort 转写 WS 与在途 chat/TTS，
  被中止的等待立即以 `null` 解阻，不产生定稿、不发 error 帧。
- **兼容两路**：新 app / device-sim 消费 `transcript-delta`（device-sim `--legacy`
  模拟旧设备：不声明 caps 且忽略该消息）；旧设备收到未知下行 type 仅记日志忽略（§4.3.1）。
- **验证边界**：全部证据来自本地假端点 + host harness + 真 `cli.js` + device-sim
  集成 smoke；无真机 / 无出网 / 无真实 key，上游转写协议是适配性假设而非已验证的
  真实端点契约（见 KNOWN-SIMPLIFICATIONS r117）。

### 8.1.9 多轮记忆与可配置人设（r120；网关内部行为）

r120 为每路 `DeviceSession` 增加一份有界对话历史（`[{role, content}]`，system
提示词不入历史）。OpenAI 兼容上游每轮构造 chat 请求时，把该会话历史插在 system
消息与本轮 user 消息之间；助手文本在轮收口后追加为 `assistant` 消息。历史是
**网关内部状态，不进任何设备协议帧**：§1-§7 的帧类型、字段、序号与关闭码零变化，
设备侧无需改动，也不消费历史。

| env | CLI | 默认值 | 说明 |
|---|---|---|---|
| `GATEWAY_HISTORY_LIMIT` | `--history-limit N` | `12` | 每会话保留最近 N 条（user+assistant，system 之外），超出从最旧丢起；`0` = 关闭记忆，chat 请求体与 r119 逐字节一致。非整数/负数按默认处理。 |
| `GATEWAY_SYSTEM_PROMPT` | `--system-prompt TEXT` | （空） | 非空即覆盖适配器内置默认 system 提示词；为空保持默认 fallback。日志只记 `systemPrompt=custom\|default`，不回显全文。 |
| `GATEWAY_MULTITURN` | `--multiturn` | （关） | 会话保活：一轮正常收口后不关 WS，复用同一 session 建新适配器，使下一轮读到历史。默认关闭 = r119 每轮 `close(1000, done)` 不变。 |

- **会话隔离与清理**：历史实例归 `DeviceSession` 所有（按 sessionId 天然隔离）；
  `conn.on('close')` 在**任意关闭码**下调 `history.clear()`，新连接 = 新对话，
  不跨连接泄漏。
- **字符预算**：每会话另有 `historyCharBudget`（默认 8192 字符）上限，与条数上限
  同时生效，按最旧 user+assistant 成对淘汰，防止长对话无界增长；取舍见
  KNOWN-SIMPLIFICATIONS r120。
- **收口点实证**：r116 的 final 文本汇总发生在 `_chatStream()` 的 `text` 累加
  （`dispatch()` 内 `text += content`），clean end 时该方法返回全文；`_finalize()`
  原本丢弃返回值，r120 改为接收并在 `await p.promise` 之后一次性 `recordTurn()`。
  被 stop / 流中断 / 错误提前抛出的轮不写历史。
- **配置优先级**：CLI flag 优先于 env；env 在 `cli.js` 启动时读取，直接调用
  `createGateway()` 的调用方可传 `historyLimit` / `historyCharBudget` / `multiturn`。
- **mock 上游**：`MockUpstream` 镜像同样的历史语义（记录 canned 答复与设备
  `text`），但 canned 答复与音频不变，设备侧 harness 不回归。

### 8.1.10 设备侧多轮适配（r121；设备协议帧零变化）

r120 的 `--multiturn` 只改变网关侧关闭时机；r121 让设备 app 复用同一 WS 连接，
把多轮记忆真正用起来。**本节是设备实现约定，不新增任何控制帧 / 字段 / 序号 / 关闭码；
§1-§7 的 v1 冻结基线保持成立。** 实证（`tools/gateway/device-sim.js --turns 2`
对真 `cli.js --upstream openai --multiturn`，原始日志 `artifacts/r121-smoke.log`）：

1. **第二轮如何开始**：复用连接后设备直接上行 3840 B PCM 帧 + 可选 `text` + `end`，
   **不重发 `hello`**。实证计数：两轮 `send.hello` 恰好 1 次、`hello-ack` 恰好 1 次，
   sessionId 两轮同为 `s2`。
2. **网关 close 时机**：非多轮时每轮 `state=idle` + `close(1000, done)`；多轮时适配器
   的 clean close 被网关截获为「re-arm 同 session 的新适配器」（下发 `state=idle` 后紧接
   `state=thinking`），**轮间不关 WS**。socket 只在设备主动 close、致命错误或非 `done`
   reason 时关闭；最后一轮是设备决定收口后 close，网关 `session.close code=1000`。
   逐帧顺序：`end` → `turn.end` → `text-delta*` → `state=idle` → `state=thinking`（re-arm）
   → 下一轮上行；`end` 始终先于本轮全部下行。
3. **设备配置**：app 新增 KV `voice_gateway_multiturn`（或顶部常量 `VA_GATEWAY_MULTITURN`，
   默认 `false`，接受 `true`/`1`/`'1'`/`'true'`），与网关 `--multiturn` 需**两侧都开**。
   关 = 每轮新连接 + 新 hello，与 r119 逐字节等价；开 = `state=idle` 后 park 连接，
   下一轮原连接复用。
4. **token 门在重连仍生效**：复用连接内 token 只在首轮 hello 发送一次（该连接已通过门）；
   一旦 park 的连接被网关关闭 / 致命错误 / barge-in 中止，设备清掉 park，下一轮走
   新连接并重新发 `hello.auth.token`，网关 token 门照常校验（失败 → `unauthorized` + 1008，
   上游工厂零调用）。host harness 对此有专门断言（`tests/va_ws.js` r121 case 11/12）。
5. **历史归属**：历史仍只在网关会话窗口内，app 不本地存历史、不消费历史帧；`close`
   （任意 code）即清空，重连 = 新对话（见 KNOWN-SIMPLIFICATIONS r121）。

## 8.2 设备鉴权：共享 token 门（r119；非 HMAC）

### 8.2.1 模式判定与配置

| 模式 | 判定 | 行为 |
|---|---|---|
| 开放 LAN 模式 | 网关未配置 token（env 为空且无 CLI 覆盖） | `hello` 无 `auth` 也接受；行为与 r118 完全一致（向后兼容，不回归）。 |
| 锁定模式 | 网关配置了非空 token | `hello` 必须带 `auth.token` 且相等；否则 `unauthorized` + 1008。 |

配置来源与优先级：CLI `--device-token TOKEN` > env `GATEWAY_DEVICE_TOKEN` >
空。命名沿用 §8.1.1 的「前缀 + 配置项」env 风格。设备侧对应 KV
`voice_gateway_token`（app 顶部常量 `VA_GATEWAY_TOKEN` 默认 `''`）：空则 hello
不带 `auth` 字段，非空则追加 `auth: {token}`。token 值不进任何日志（网关 `ready`
只记 `deviceAuth=on|off`，app 只记 `VA WS HELLO AUTH`）、不进错误 message、
不进 git；用 `node:crypto.timingSafeEqual` 做等长常数时间比较。

### 8.2.2 校验位置与失败语义

固定顺序（实证见 `tools/gateway/server.js` 的 `DeviceSession._onMessage`）：
① 首帧类型 `not_hello` → ② `hello.v` 的 `unsupported_version` → ③ token 的
`unauthorized` → ④ `phase=active` + `hello-ack` + `upstreamFactory()`。
第 ③ 步失败时**只发 `error{code:"unauthorized",fatal:true}` 再 close(1008)**，
不回 `hello-ack`、不创建上游适配器、不发任何上游请求（真实 key 的 chat/TTS/ASR
配额不会被烧）。"先发音频帧再 hello" 仍命中 ① 的 `not_hello`，顺序语义不回归。

### 8.2.3 安全模型边界与已知取舍

- 这是**单一共享 token**，不是逐设备身份：所有设备共用一把，无法撤销单台、
  无法防同一 LAN 内已拿到 token 的客户端重放。它只把"能连上 WS 端口的任意进程"
  收窄为"知道 token 的客户端"，**不等于网络隔离**，不替代 VLAN / 防火墙。
- `ws://` **无 TLS**，token 随明文 hello 帧在 LAN 上传输，被动抓包即可复制。
  因此本轮选择共享 token 相等比较而非 HMAC 挑战-响应（`lume.crypto.hmacSha256`
  r91 已可用）：在明文信道上 HMAC 只能防重放、不能防窃听，增益有限、复杂度不值。
  该取舍登记于 `docs/KNOWN-SIMPLIFICATIONS.md` r119 节；`wss://` 与真正的
  挑战-响应留待部署轮。
- 字段名 `auth` / `auth.token` 是 §9 允许的**追加字段**：旧设备不发送、开放模式
  网关忽略；旧网关收到未知字段按 §3 忽略，均不构成协议破坏。

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

r119 追加：开放模式无 `auth` 全轮不回归；锁定模式缺 token / 错 token →
`unauthorized` + 1008 + **上游适配器工厂零调用**（宿主 harness 直接断言）；对 token
全轮跑通；锁定模式 `not_hello` 仍优先；设备 app KV 注入 token 与"token 不进日志"
断言（`tests/va_ws.js`）；真 `cli.js` + 本地假上游 + device-sim 的两路集成 smoke
（两端原始日志见 `artifacts/r119-smoke.log`）。不声称抗 LAN 抓包或抗重放。

r120 追加：每会话有界对话历史（默认 N=12 / 8KB 字符预算，`GATEWAY_HISTORY_LIMIT`
或 `--history-limit` 可配，`0` = r119 逐字节等价）；助手 final delta 汇总文本在轮
收口后追加为 assistant 消息；`GATEWAY_SYSTEM_PROMPT` / `--system-prompt` 覆盖默认
人设且日志只记 `custom|default`；历史在 `session.close`（任意 code）清空、新连接
零残留。**设备协议帧零变化**（历史是网关内部状态，不进帧；`--multiturn` 仅改变
网关侧关闭时机，不新增控制帧）。验证口径：宿主 harness `tests/gateway.js` 19 case
（16 基线 + 3 r120）、`tests/gateway_upstream.js` 36 case（34 基线 + 2 r120，真
OpenAI 适配器两轮注入）、`tests/va_ws.js` 9 case；`npm test --prefix tools/lume`
50 tests；真 `cli.js --upstream openai` + 本地假 STT/chat/TTS + device-sim
`--turns 2` 集成 smoke（token 门开、两轮连续对话；第二轮 chat 请求体含第一轮
user+assistant，原始日志 `artifacts/r120-smoke.log`）。`--multiturn` 为可选会话
保活，默认关闭保持每轮 close 语义。不声称真机 / 出网 / 真实 key；固件与 runtime
零改动，按纪律不跑 `idf.py build` / `idf.py size`。

r121 追加（设备侧适配，**协议帧零变化**）：设备 app 新增 KV `voice_gateway_multiturn` /
常量 `VA_GATEWAY_MULTITURN`（默认关），开启后在 `state=idle` 后 park WS、下一轮原连接
复用不重发 hello，网关保活同 session 的历史（§8.1.10 的实证轮次语义）；关 = r119
逐字节等价。UI 以信号驱动如实呈现 `TURN n / PREV` 上下文。验证口径：`tests/va_ws.js`
12 case（9 基线 + 3 r121：跨轮保活 / 无重 hello / close 重连历史清零 + token 门复拦）、
`tests/gateway.js` 19 case、`tests/gateway_upstream.js` 36 case、`npm test --prefix tools/lume`
50 tests、`check_website.py` 无缺失；真 `cli.js --upstream openai` + 本地假 STT/chat/TTS
+ 真 `device-sim --turns 2` 集成 smoke（锁定模式 + 双轮，第二轮 chat 请求体含第一轮
user+assistant，设备两轮仅 1 次 hello，原始日志 `artifacts/r121-smoke.log`）。不声称真机；
固件 / runtime 零改动，按纪律不跑 `idf.py build` / `idf.py size`。
