# r108 report — voice_assistant WS transport 对接 lume.net.ws（E 刀收口）

基线 HEAD `e7bdf5f`（Merge r96-ota），worktree `/tmp/lume-r108-wt`，分支
`r108-va-ws`。开工守卫与基线确认：

```text
GUARD: settings.json model=hy4flash-free ✓
GUARD: model=hy4flash-free ✓ (settings + runtime audit clean)
e7bdf5f Merge branch 'r96-ota'
---BRANCH---
r108-va-ws
```

## 1. 开工实证（先读码，未凭简报硬写）

- `runtime/types/lume.d.ts:714-731`：`lume.net.ws.connect(url, options?, cb?)`
  的 `Connection.send(string|ArrayBuffer)` / `close()`；`Options` 回调
  `onOpen(conn)` / `onMessage(string|ArrayBuffer)` / `onClose()` / `onError(number)`。
  **`onClose` 无关闭码**（与 `docs/voice-gateway-protocol.md` §6 一致），
  结束原因必须由关闭前的 `state`/`error` 帧传达；`onError` 是 WS 层错误，
  不等价于协议 `error` 帧。
- `firmware/components/lume-net/lume_ws.c:63-101`：URL 仅 `ws://`/`wss://`、
  长度 ≤2048、无 IP 返回 -3、两槽满返回 -4、发送 ≤64 KiB；文本帧用
  `send_text`，二进制用 `send_bin`，两者都阻塞 ≤1 s。
- `firmware/components/lume-engine/lume_scripts.c:60-118`：`connect` 的 Promise/
  回调双形态；`_connect/_send/_close` 三件套是 host stub 与真机共用的边界；
  **`handle.close()` 会同步触发 `onClose()`**（本轮 barge-in 竞态根因，见 §4）。
- `examples/voice_assistant/app.js`：`vaSetTransport(fn)` 槽、
  `done(text, err)` 回调、`IDLE→LISTEN→THINK→SPEAK` 六条合法边、逐字
  `vaTypingPos` 整数 signal、`vaAnswerText()` getter 拼串——全部照旧，不重构。
- `docs/voice-gateway-protocol.md` v1：hello 首帧；上行 60 ms = **3840 B**
  裸 PCM（不是错误的单声道 1920 B）；下行 8 字节头
  `version=1/type=1/format=1/rate=16000/ch=2/bits=16/seq` + ≤4608 B；
  `text-delta{seq,text,final}`、`state`、`error`、`end`、`pong`。
- `runtime/types/lume.d.ts:987-1012`：`recordStream.chunkSamples` 仅
  512/1024/2048（默认 1024 stereo 帧 = **4096 B**），重组 3840 B 线帧属
  app 层；`playStream` 单块 ≤4608 B，队列满返回 -3 可重投。
- `tools/gateway/`（r107）：零依赖 mock 网关 + `ws-client.js` 零依赖客户端；
  CLI 默认端口 8765，与 app 顶部常量 18770 不同，URL 必须对齐。
- 结论：**零固件改动、零 `lume.d.ts` 改动**（`git diff --stat -- firmware/`
  与 `-- runtime/types/lume.d.ts` 均为空）；未跑 `idf.py build/size`。

## 2. 实现取舍

- **单一注入点**：GATEWAY 模式下 boot 自动 `vaSetTransport(vaTransportWS)`；
  无 URL / 无 IP → legacy（`vaTransportLegacy`），非函数注入同样回落 legacy。
  状态机、`vaAnswerText`、canned、DEMO 徽章逻辑零改动；既有用例不回归。
- **WS transport 全轮**：`onOpen` 立刻发 `hello` + 起 `recordStream(1024)` +
  pump 定时器；3 个 4096 B 原生块重组为 3×3840 B 线帧，收到 `hello-ack`
  后才 sendBinary；流满 3 帧停流发 `end`，barge-in 走 `vaWSAbort()` 补发 end。
  下行逐帧解头 → `playStream`，-3 时下一 pump 重投；`text-delta` 直接写
  `vaFullText`/`vaTypingPos` 信号逐字上屏，完成时不重启 canned typewriter、
  不重播 demo beep。
- **收口**：`state=idle` / `onClose` / 致命 `error` 统一走幂等 `vaWSFinish()`，
  失败回 IDLE 不挂死；`vaOnStreamReply` 只把 SPEAK 状态接到既有 speak timer。
- **竞态修复（实证）**：prelude `handle.close()` 同步回调 `onClose`，原
  `vaWSAbort()` 先 close 后标记 finished，导致 `onClose` 抢先把 SPEAK 改成
  IDLE，`vaBargeIn()` 的 `vaSet('IDLE')` 因 from===next 返回 false。改为先
  置 finished/done 再 close（app.js `vaWSAbort()`）。
- **host bridge**：`tests/lib/prelude_runner.js` 的 `lume.net.ws` 只有
  `_connect/_send/_close` stub；harness 用 `tools/gateway/ws-client.js` 把它们
  接真网关，`onMessage` 把 Node `Buffer` 转成 `ArrayBuffer`，经
  `__lume_dispatchWS` 走完整 prelude 包装层。零新依赖。
- **ASCII 纪律**：新日志/UI 文案全 ASCII；docs 中文正常。

## 3. 验证（原始输出摘录，均为本轮真实执行）

### 3.1 `node tests/gateway.js`（r107 不回归，10 用例）

```text
PASS negative: unmasked WS frame rejected at WS layer + 1002
PASS negative: upstream disconnect -> upstream_closed + 1011
PASS negative: hello v=2 -> unsupported_version + 1008
PASS device close: gateway releases upstream and echoes 1000
PASS control: unknown_type is non-fatal, ping gets pong
ALL GATEWAY HARNESS CASES PASSED (10 cases)
---EXIT:0---
```

### 3.2 `node tests/va_ws.js`（6 用例，含 3 条负向）

```text
PASS happy: hello -> 3x3840B uplink -> end -> 9 deltas -> 3 audio -> idle/close -> IDLE
PASS negative 1: gateway refuse -> IDLE, no uplink, not hung
PASS negative 2: mid-stream upstream disconnect -> partial text, IDLE, no hang
PASS negative 3: gateway fatal upstream_error -> IDLE, no hang
PASS barge-in: SPEAK -> IDLE, end frame delivered, mic stopped, upstream released
PASS fallback: no gateway -> legacy canned; vaSetTransport(non-fn) restores legacy
ALL VA WS HARNESS CASES PASSED (6 cases)
---EXIT:0---
```

### 3.3 端到端 smoke（mock 网关 + app WS transport 双方日志原文）

```text
--- SMOKE gateway side (raw) ---
[GW] hello {"sessionId":"s1","device":"{\"model\":\"lume\",\"fw\":\"r108\",\"app\":\"voice_assistant\"}"}
[GW] uplink.pcm {"sessionId":"s1","bytes":3840,"frames":1}
[GW] uplink.pcm {"sessionId":"s1","bytes":3840,"frames":2}
[GW] uplink.pcm {"sessionId":"s1","bytes":3840,"frames":3}
[GW] turn.end {"sessionId":"s1"}
[GW] session.close {"sessionId":"s1","code":1000}
--- SMOKE device side (raw) ---
[DEV] VA MODE GATEWAY
[DEV] VA WS CONNECT ws://127.0.0.1:34127/
[DEV] VA WS HELLO
[DEV] VA WS MIC START
[DEV] VA WS ACK fmt=pcm_s16le_16000_2ch
[DEV] VA WS STATE thinking
[DEV] VA WS UPLINK frames=1
[DEV] VA WS UPLINK frames=2
[DEV] VA WS UPLINK frames=3
[DEV] VA WS MIC STOP
[DEV] VA WS SEND END
[DEV] VA WS DELTA n=0 chars=1
[DEV] VA WS DELTA n=1 chars=2
[DEV] VA WS DELTA n=2 chars=3
[DEV] VA WS DELTA n=3 chars=4
[DEV] VA WS DELTA n=4 chars=5
[DEV] VA WS DELTA n=5 chars=6
[DEV] VA WS DELTA n=6 chars=7
[DEV] VA WS DELTA n=7 chars=8
[DEV] VA WS STATE speaking
[DEV] VA WS AUDIO hdr=1/1/1/16000/2/16 seq=0 bytes=3840
[DEV] VA WS AUDIO hdr=1/1/1/16000/2/16 seq=1 bytes=3840
[DEV] VA WS AUDIO hdr=1/1/1/16000/2/16 seq=2 bytes=3840
[DEV] VA WS STATE idle
[DEV] VA WS CLOSE
[DEV] VA WS REPLY chars=8 audio=3 deltas=9
--- SMOKE reassembled answer: "HI LUME." (gateway answer "HI LUME.") ---
```

双方对齐：3×3840 B 上行 ↔ 网关 `uplink.pcm`×3；`end` ↔ `turn.end`；
8 字符 + final = 9 条 delta；3 条 audio 头 `1/1/1/16000/2/16`；
`state=idle` → `close` ↔ `session.close code=1000`。

### 3.4 全量回归 `for t in tests/*.js; do node "$t" || echo FAIL "$t"; done`

```text
EXIT:0
FILES:62
FAIL_COUNT:0
PASS_LINES:531
```

（基线 61 文件 + 新增 `va_ws.js` = 62；无任何 `FAIL` 行。）

### 3.5 `npm test --prefix tools/lume`

```text
1..46
# tests 46
# suites 0
# pass 45
# fail 0
# cancelled 0
# skipped 1
# todo 0
# duration_ms 2441.170134
---EXIT:0---
```

### 3.6 `lume check ... --no-emu`

```text
=== voice_assistant ===
lume check examples/voice_assistant
[PASS] bundle   10415 bytes (89 ms)
[SKIP] eval     --no-emu
[SKIP] layout   requires emulator screenshot (--no-emu)
[SKIP] perf     profile disabled
RESULT: PASS (4 steps, 0 failed; exit 0)
---EXIT:0---
=== counter (sentinel) ===
lume check examples/counter
[PASS] bundle   2160 bytes (21 ms)
RESULT: PASS (4 steps, 0 failed; exit 0)
---EXIT:0---
```

### 3.7 磁盘/工作树纪律

```text
=== status ===
 M examples/voice_assistant/app.js
?? examples/voice_assistant/README.md
?? tests/va_ws.js
?? docs/r108-va-ws-report.md
=== firmware diff ===
(空)
=== d.ts diff ===
(空)
```

`tools/lume/node_modules` 是指向 `/home/ubuntu/lume/tools/lume/node_modules` 的
符号链接（`.gitignore` 已忽略），未装新依赖；全量回归产生的
`artifacts/r82/fft-host-*` 临时目录已清理，不进 git。

## 4. 诚实口径与 pending

- host harness 只证明**协议字段与 app 逻辑**：hello 握手、60 ms 分帧长度、
  delta 顺序与逐字上屏、audio 头解析与 playStream 喂入、end/close 纪律、
  拒连/中途断开/致命错误回 IDLE 不挂死。
- **不接真实 ASR/LLM/TTS**、无 API key / TLS / 鉴权（LAN 信任模型不变）；
  上游选型未拍板，网关仍是 mock 上游。
- **无真机验证**：真机 WiFi 下 WS 稳定性、时延预算、双 DMA 并发、
  playStream 边收边播实际时延、触摸 barge-in 手感全部 deferred to
  board bring-up。固件零改动，未跑 `idf.py build/size`。
- commits 拆分（feat app / test harness / docs），**未推送**，留主控 merge+push。
