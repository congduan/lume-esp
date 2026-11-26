# r206 报告：`lume mcp` MCP stdio server（AX 基建线 r173）

## 0. 基线与边界

- 基线：`origin/main c74fc80`（2026-11-27，r205 已推）；worktree `/tmp/lume-r206-wt`，分支 `r206-mcp-server`。
- **本轮由主控接管实施**：派发引擎（hy4flash-free）遇 `429 您的使用量已超出频率限制，将在 2026-11-27 18:54:20 UTC+8 重置`，engine_exit=0 且零产出（log 4 秒即退出，仅完成 worktree 建立）。按纪律不切模型，主控直接写码。
- 改动面：`tools/lume/`（mcp.js + lume.js 路由 + mcp.test.js）与 14 个 harness 的 R166_ALLOWED 预加、`docs/r206-report.md`、`docs/KNOWN-SIMPLIFICATIONS.md`、`docs/roadmap.md` AX 行、`docs/build.md`。**firmware/、runtime/、examples/、website/ 零改动**（验收段贴 diff 空输出），未跑 `idf.py build`。

## 1. 为什么是自实现协议层（零新 npm 依赖）

MCP stdio 传输 = ndjson JSON-RPC 2.0：每行一条消息、stdin/stdout 各一方向。@modelcontextprotocol/sdk 对一个六工具 server 是纯开销（依赖树、类型层、多版本兼容矩阵），且仓库纪律是 vendored 最小化。协议层实现如下：

- `initialize`：回 client 的 `protocolVersion`（服务端已知集 `2024-11-05 / 2025-03-26 / 2025-06-18` 内），未知版本回服务端最新（`2025-06-18`）——保守协商。`serverInfo = { name: 'lume', version }`，`capabilities: { tools: {} }`。
- `notifications/initialized` / 其余 notification：忽略（按 JSON-RPC，notification 无回包）。
- `ping` → `{}`；`tools/list` → 六工具全量 inputSchema（type: object，字段带 description）；`tools/call` → 分发。
- 错误口径：未知 tool → `-32602 invalid params`（tools/call 参数面错误）；未知 method → `-32601`；handler 抛异常 → 捕获并回 `isError: true` result（server 不因单次调用崩溃）；非 JSON 行 → stderr 记日志后跳过（生存性）。
- **stdout 铁律**：协议消息只走 stdout，诊断全部 `[lume-mcp]` 前缀写 stderr。文件内零 `console.log`。

## 2. 工具契约（tool 名即契约，落地后不改）

| tool | 入参 | 实现 | 免板 |
|---|---|---|---|
| `lume_check` | `{appDir, noEmu?=true, timeout?}` | spawn `lume.js check <appDir> --json [--no-emu] [--timeout]`，转发 `{exitCode, check}`；exit!=0 → isError | 是 |
| `lume_bundle` | `{appDir}` | 进程内 `bundle()`（esbuild），回 `{bytes}`，不落仓库产物 | 是 |
| `lume_manifest` | `{}` | 进程内 import `tools/playground/build.mjs` 的 `manifestApps()`（该文件 import 无副作用，build 仅作 main 运行——已实证） | 是 |
| `lume_context` | `{skipCheck?=true}` | 进程内 `context()`，回 r199 快照全字段 + `snapshotFailed`；快照失败 → isError | 是 |
| `lume_help` | `{}` | spawn `lume.js --help` 直通 usage（零复制，帮助文本单源） | 是 |
| `lume_deploy` | `{appDir, port?/host?+token?, otaPort?, id?, ephemeral?}` | 无板入参 → 立即 isError + 指引（不挂起）；有板 → spawn `lume.js deploy`（120s 上限） | **否** |

设计取舍：**重 CLI 面（check/help/deploy）走 spawn 子进程**，复用 exit code 契约（0 pass / 1 fail）与 `--json` 机器可读输出，进程隔离不污染 server；**纯数据面（bundle/manifest/context）进程内 import**，省一次进程启动。`lume_check` 的 `noEmu` 默认 true——agent 场景绝大多数要的是秒级语法/布局反馈，emu 全跑明确传 `noEmu: false`。

## 3. CLI 集成

`lume.js` 三处：usage 表加 `lume mcp` 行、parse 命令白名单加 `'mcp'`、main 路由加 `else if (command === 'mcp')`（动态 `import('./mcp.js')` 后 `run()`，exit code 直通）。`lume mcp` 无参数、长驻 stdin EOF 退出（exit 0）。

## 4. 验收（原始输出见 `/tmp/r206-final-verify.txt`；宿主证据，非真机）

- `npm test --prefix tools/lume` → `# tests 71 / # pass 71 / # fail 0`（基线 57 → 71，新增 14 条协议级测试，全部 spawn 真进程说话）。
- mcp.test.js 覆盖：initialize 握手（已知/未知 protocolVersion 两路）、tools/list 六工具 schema、ping、lume_help/lume_manifest/lume_context/lume_check（counter 哨兵真跑 PASS）/lume_check 坏 app isError/lume_deploy 无板 isError 不挂起、-32602/-32601、非 JSON 行生存性、EOF 干净退出 exit 0。
- 14 个 R166 围栏 harness（ota_consumers / wordle / control_center / archive_view / crypto_check / img_view / vec_demo / hr_monitor / keyboard_states / launcher_grid / reboot_consumers / timer_kit / sntp_consumers2 / weather_sntp）预加 `'tools/lume/mcp.js', 'tools/lume/mcp.test.js'`（r199 先例：新文件提交后 git diff 才可见，必须预加）→ 逐一单独跑全 OK。
- 全量回归 `timeout 900 bash -c 'for t in tests/*.js; do node "$t" ...; done'` → **0 FAIL**（r205 后基线本就全绿，本轮保持）。
- `node tools/lume/lume.js check examples/counter --no-emu` → `RESULT: PASS (4 steps, 0 failed; exit 0)`。
- ASCII 纪律：`grep -Pn '[^\x00-\x7F]' tools/lume/mcp.js tools/lume/mcp.test.js tools/lume/lume.js` → 无输出。
- **firmware/runtime/examples/website 零改动**：`git diff c74fc80 HEAD -- firmware/ runtime/ examples/ website/` 与工作树版同命令输出均为空（见验证日志）；未跑 `idf.py build`。

## 5. deferred / 未做

- `lume_deploy` / 截图类工具的**真机验收**未做：无板环境下 deploy 只验收「无板 → 结构化错误 + 指引」；USB/WiFi 真实推包留 board bring-up，不声称验证。
- MCP resources/prompts 面未做（tools 已覆盖六稳定能力，resources 无消费方）。
- r174（examples meta.json 检索）仍未做，AX 线最后一刀。
