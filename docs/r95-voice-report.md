# r95 report — voice_assistant 对讲机 demo（legacy 同步模式，纯 app 层）

Baseline `5db2e9c`（r94 particles 已合入 main），worktree `/tmp/lume-r95-wt`，
branch `r95-voice`。开工守卫与基线确认：

```text
GUARD: settings.json model=hy4flash-free ✓
GUARD: model=hy4flash-free ✓ (settings + runtime audit clean)
---EXIT:0---
```

```text
5db2e9c r94: document particles report, roadmap result and simplifications
---BRANCH---
r95-voice
---STATUS---
(clean)
```

## 1. 开工实证（先读码再写，未重复勘察已核实背景）

- `examples/ai_chat/app.js:22-37`：`lume.ai.chat()` **同步阻塞**；先 `state.set('Loading...')`
  再直接调用，**中间没有让出一帧**。本刀据此改进：THINK/LISTEN 只翻 signal，
  阻塞调用用 `lume.system.setTimeout(..., 0)` 错拍到下一帧（harness 断言
  transport 在错拍前不被调用）。
- `examples/typewriter/app.js:4-6,48-65`：interval 回调里 slice/join 新字符串会在
  esp32sim 触发 QuickJS OOM；本刀逐字上屏只在 timer 里写整数 signal，字符串拼接
  交给 `Text` getter（`vaAnswerText()`）。
- `examples/spectrum/app.js:36-50`：`recordStream` 消费先例；本刀 legacy 用
  `lume.audio.record()/play()`，签名见 `runtime/types/lume.d.ts:948-986`
  （record 整段阻塞、play 阻塞，16-bit stereo 16 kHz）。
- `examples/compass/app.js:68-95`：无硬件自动降级 demo 模式 + 模式徽章先例，照此实现
  `vaDetectMode()`（无 key / 无 GOT_IP → DEMO）。
- `firmware/components/lume-engine/lume_scripts.c:14-55`：`lume.ai.chat` 由 **prelude**
  提供，host harness 经 `runApp` 即可用；`:464-477` 的 `lume.system` timer 由引擎
  `__lume_tick()` 驱动，harness 不自动跑 tick，故把状态迁移做成可直接调用的全局函数，
  timer 只负责错拍。
- `tests/compass.js` / `tests/particles.js`：`runApp` + `ctx` 直接断言 + draw/batch
  消息计数的 harness 模式；`tests/lib/prelude_runner.js:293-308` 的 audio mock
  `record: () => -3`、`play: () => 0`，天然走 DEMO 分支。
- `runtime/types/lume.d.ts:101-164` + `docs/r64-modular-report.md`：canvas 全 app 预算
  460,800 B = 230,400 px；文案 r64 字形纪律 → 全 ASCII。
- 结论：**零固件改动、零 `runtime/types/lume.d.ts` 改动**。若实施中确需固件小改应先停
  下评估——本轮未发生（`git status --short -- firmware/` 为空）。

## 2. 实现取舍

- **状态机** `IDLE→LISTEN→THINK→SPEAK` 全 signal 驱动（`vaState`），6 条合法边写死在
  `VA_LEGAL`（`examples/voice_assistant/app.js:69-84`），非法迁移 `vaSet()` 拒绝并记日志。
  barge-in：SPEAK 中 tap → `vaBargeIn()` 立刻回 IDLE，停 typewriter/播放 timer。
  LISTEN 看门狗 4 s 超时回 IDLE（不发请求）。
- **输入**：`tap` 统一走 `vaActivate()`（IDLE 唤醒 / LISTEN 发送 / SPEAK 打断），
  `longpress` 走同一入口（push-to-talk 语义）。THINK 中 tap 只记 `VA BUSY`，不越界。
- **legacy 阻塞的诚实口径**：`chat`/`record` 确认阻塞引擎；`vaAsk()` 只翻 THINK 并用
  `setTimeout(vaDeferredSend, 0)` 把传输推到下一帧，`vaStartListen()` 同理延迟 `record`。
  本刀**不宣称不卡 UI**——同步阻塞窗口真实存在，流式/网关是 D 刀之后的事。
- **transport 槽**：`vaTransport` 单函数槽 + `vaSetTransport(fn)`；默认 legacy 走
  `lume.ai.chat`，DEMO 走 canned 轮换；未来网关/WS 只换槽，状态机零改动。回调造型
  `done(text, err)` 对同步/异步实现都成立（async-ready）。
- **逐字上屏**：30 cps（33 ms），`vaTypingPos` 整数 signal，`vaAnswerText()` getter 拼串，
  游标 300 ms 闪烁；播报用 0.18 s 660 Hz PCM beep 走 `audio.play()` 闭环。
- **波形**：单 canvas 320×160 = **51,200 px**（远低于 230,400 全预算），16 根电平条 +
  中线，每帧 18 draw calls、返回局部 dirty rect；电平 ±sin 动画，`vaRev` 订阅重绘。
- **降级**：无 key 或 net 非 GOT_IP → DEMO，4 条 canned 问答轮换；模式徽章 `MODE DEMO`
  / `MODE LIVE` 如实标注。host/浏览器都是 DEMO。
- UI 文案全 ASCII；无 KV key。

## 3. 验证（全部原始输出摘录）

### 3.1 `node tests/voice_assistant.js`

```text
PASS boot IDLE + honest DEMO badge (no key / no IP)
PASS state table: 6 legal edges, illegal jumps rejected + logged
PASS IDLE->LISTEN->THINK->(next frame)transport->SPEAK + play
PASS barge-in SPEAK->IDLE, repeat tap is harmless no-op
PASS LISTEN timeout -> IDLE; watchdog inert outside LISTEN
PASS DEMO canned replies rotate across 6 turns (wrap at 4, start=1)
PASS typewriter advances 1 char/tick, clamps at 45 (no wall-clock)
PASS canvas budget 51200/230400 px, 18 draw calls/frame, dirty rect
PASS UI text pure ASCII (100 bound strings)
PASS transport slot: fake drives THINK->SPEAK; error path -> IDLE
PASS LIVE detection + legacy lume.ai.chat delegation through transport
PASS record() -3 degrades to demo level; real PCM drives bounded VU
PASS waveform level bounded [0,1] in IDLE and LISTEN over 240 ticks
ALL VOICE ASSISTANT HARNESS CASES PASSED
---EXIT:0---
```

13 组断言覆盖：全迁移路径与非法拒绝、帧错拍（transport 在错拍前 0 次调用）、barge-in、
LISTEN 超时、canned 轮换与按节拍（非 wall-clock）逐字、canvas 预算/18 draw/脏区、
纯 ASCII 文案、注入 fake transport 走通 THINK→SPEAK 及错误路径、LIVE 检测 + 真实
`lume.ai.chat` 委托、`record()` -3 降级与真实 PCM 电平、波形边界。

### 3.2 全量回归 `for t in tests/*.js; do node "$t" || echo FAIL "$t"; done`

```text
TOTAL=53 FAIL=0
---EXIT:0---
```

（基线实际 52 个 `tests/*.js`，本刀新增后 53；简报写的 53→54 与实际计数差 1，
以实测为准。无任何 `FAIL` 行。）

### 3.3 `npm test --prefix tools/lume`

```text
1..44
# tests 44
# suites 0
# pass 43
# fail 0
# cancelled 0
# skipped 1
# todo 0
# duration_ms 2142.714528
---EXIT:0---
```

### 3.4 `lume check ... --no-emu`

```text
=== voice_assistant ===
lume check examples/voice_assistant

[PASS] bundle   6042 bytes (20 ms)
[SKIP] eval     --no-emu
[SKIP] layout   requires emulator screenshot (--no-emu)
[SKIP] perf     profile disabled

RESULT: PASS (4 steps, 0 failed; exit 0)
---EXIT:0---
=== counter sentinel ===
lume check examples/counter

[PASS] bundle   2160 bytes (18 ms)
...
RESULT: PASS (4 steps, 0 failed; exit 0)
---EXIT:0---
```

### 3.5 playground 重生成（36 → 37 apps）

`tools/playground/build.mjs` apps 数组、`website/playground/page.js` examples 列表、
`website/playground/index.html` 的 `<script defer>` 列表各加 `voice_assistant`；
`tools/playground/verify.mjs` 新增定向用例（无音频/网络 → `MODE DEMO` 徽章 +
点击进 LISTEN，不白屏）。计数验证仍从 `window.LUME_SOURCES` 动态取（r94 先例，未改）。

```text
PASS bundle voice_assistant 6042 bytes
PASS esbuild-wasm assets and 37 editable sources
PASS prelude 67016 bytes; 37 apps
---EXIT:0---
```

`PLAYWRIGHT_MODULE=/home/ubuntu/.npm/_npx/705bc6b22212b352/node_modules/playwright node tools/playground/verify.mjs`（节选）：

```text
PASS page loads without JavaScript errors
PASS voice_assistant degrades to DEMO without audio/network and is tappable
  DEMO badge + tap -> LISTEN
PASS all examples load without runtime errors
  ...
  particles: 7 nodes
  voice_assistant: 8 nodes
---EXIT:0---
```

### 3.6 docs / website 检查

```text
HTML pages: 7; internal href/src and anchors checked
API: 135 catalog entries, 135 type declarations, 32 function namespaces
API missing: none
API invented: none
API duplicates: none
API signatures not found in lume.d.ts: none
---EXIT:0---
=== api docs freshness ===
api.html is up to date with lume.d.ts (135 entries)
---EXIT:0---
```

### 3.7 emu 烟测（12 s，worktree）

固件未改，无需重编。主仓 `/home/ubuntu/lume/firmware/build/` 本轮为空，
从 `/tmp/lume-r94-wt/firmware/build/` 拷三件套（bootloader 22,288 B /
partition-table 3,072 B / lume.bin 3,022,592 B）；
`git diff --stat 5db2e9c 3090bcd -- firmware/` 为空，证明 r94 worktree 与本基线
固件源码逐字节同一，三件套等价。
`EMU_SKIP_BUILD=1 EMU_SECONDS=12 EMU_BIN=/home/ubuntu/lume/tools/emu/.cache/bin/esp32sim EMU_OUTPUT_DIR=artifacts/check/voice_assistant/emu bash tools/emu/run.sh examples/voice_assistant`：

```text
bundle /tmp/lume-r95-wt/examples/voice_assistant: source 6042 bytes; payload 6042 bytes; frame 6054 bytes (source)
I (1736) lume-engine: engine task up (pinned core 1), PSRAM free=5502816 bytes
I (1808) lume-engine: runtime up; eval app '<home>' (5127 bytes)
I (1938) lume-engine: app eval ok; entering event loop
I (2689) lume-engine: engine recv RELOAD -> recycle runtime
I (2923) lume-engine: runtime up; eval app '<embedded-demo>' (6042 bytes)
I (2964) lume-engine: app eval ok; entering event loop
[emu] stop: Halted — core0 295013187 + core1 103063080 insns in 10.7s wall = 37.2 Minsn/s; emulated 12.000s (2880000000 cycles); 547484 exceptions, 35793 interrupts
TFT: artifacts/check/voice_assistant/emu/tft.png
serial: artifacts/check/voice_assistant/emu/serial.log
---EXIT:0---
```

统计（raw grep）：

```text
eval_ok=2
RELOAD_ERR=0
ui_queue_full=0
I (2963) lume-engine: js: VA MODE DEMO
I (2964) lume-engine: js: VA READY mode=DEMO canned=4 canvas=51200
  204 11077 artifacts/check/voice_assistant/emu/serial.log
```

TFT 截图 vision 自查：屏幕完整显示 `LUME VOICE` / `MODE DEMO` / `IDLE` /
16 根青色电平条的波形画布 / `TAP TALK / TAP SEND / TAP INTERRUPT` / `TALK` 按钮，
**非白屏，DEMO 主屏成立**。

### 3.8 固件 build / size（本轮条件不满足，未跑）

任务限定「固件若意外改了 C 才跑」。`git status --short -- firmware/` 输出为空，
零固件改动；r93 基线 Flash Code 2,030,508 / IRAM 16384 Remain 不破。
QuickJS 汇编 host swap 未发生，无需 `-g0`。

## 4. 诚实口径与 pending

- **legacy 同步阻塞真实存在**：`lume.ai.chat` 与 `lume.audio.record` 阻塞单引擎 task；
  本刀只做到「阻塞前先渲染一帧」，**不宣称流式/不卡 UI**。全双工、边收边播、
  真流式 delta 属 D 刀网关 + async 路线，真机时延预算（开口 <2 s）未验证。
- **无 ASR/TTS**：legacy 的「用户语句」是 canned prompt，录音 PCM 只驱动波形，
  播报是合成 beep 而非语音合成；对讲机闭环验证的是产品手感/状态机，不是语音链路正确性。
- **DEMO 降级**：host/浏览器无 key、无网络、无 mic → canned 问答；`MODE LIVE` 只在
  key + GOT_IP 同时满足时出现，本轮仅在 harness 注入下覆盖，未在真机 WiFi 下验证。
- **未做接板验收**：音频链路（ES7210/ES8311）、触摸手感、barge-in 实际打断延迟、
  AMOLED 观感、功耗一律 deferred to board bring-up；emu/simulator 不验证硬件行为
  （esp32sim 触摸模型与 CST9220 不匹配）。
- **磁盘纪律**：artifacts 仅保留 `artifacts/check/voice_assistant/emu/serial.log` +
  `tft.png`；三件套与 `tools/lume/node_modules` 为本地符号链接/未跟踪文件，不进 git。

详见 `docs/roadmap.md` 的 r95 result 小节与 `docs/KNOWN-SIMPLIFICATIONS.md` 的 r95 段。
