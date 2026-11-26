# r207 报告：`lume examples` 元数据检索 CLI（AX 基建线收官刀）

## 0. 基线与边界

- 基线：`origin/main 31f0ea0`（2026-11-27，r206 已推）；worktree `/tmp/lume-r207-wt`，分支 `r207-examples-cli`。
- **本轮由主控接管实施**：派发引擎（hy4flash-free）处于 429 限流窗口（run.log：`429 您的使用量已超出频率限制，将在 2026-11-27 18:54:20 UTC+8 重置`，engine_exit=0），按纪律不切模型，主控直接写码。
- AX 基建线（roadmap r171→r174 计划）四刀全部落地：r171 manifest 单源化（r169 落地）、r172 `lume context`（r199）、r173 MCP server（r206）、本轮 = 第四刀「examples 元数据检索」（原计划编号 r174 已被 2026-11-23 的 retained-paths 轮占用，按顺序落为 r207）。
- 改动面：`tools/lume/`（examples.js + examples.test.js + lume.js 路由）+ 14 个 R166 围栏 harness 预加 + 本报告与 roadmap 登记。**firmware/、runtime/、examples/、website/ 零改动**（`git diff origin/main HEAD -- firmware/ runtime/ examples/ website/` 为空），未跑 `idf.py build`。

## 1. 为什么是运行时解析 page.js，而不是新建 meta.json

- roadmap r146 已证伪「examples 有 meta.json」：全仓 find 为空，CLI `appMeta()` 在 deploy 时从 package.json 的 `lume` 块生成。examples 是源码/playground app，新建 82 个 meta.json 是死文件。
- 每个app 的五元组（icon/en/cn/descriptionEn/descriptionZh）**唯一权威源是 `website/playground/page.js` 的 `examples` 数组**（73 项，r169 结构性修正后 LUME_SOURCES 是目录权威、examples 数组是展示元数据权威）。复制到新文件必然双源漂移（r168/r169 的教训）。
- 故本轮实现为**运行时解析**：`parsePageExamples()` 用正则定位 `const examples = [...]` 字面量并在无作用域 Function 中求值，条目形状变化（非 6 字符串元组/数组缺失）抛指向性错误，不做静默降级。page.js 改形状时会明确报错而不是返回陈旧数据。

## 2. CLI 契约

```
lume examples            # 全量目录：每 app 一行，+ 已注册 / - 未注册，尾行 summary JSON
lume examples <name>     # 单 app 过滤（未知名字 stderr + exit 1）
lume examples --json     # NDJSON：每 app 一行 JSON + 尾行 {summary}
```

- summary 字段：`total / registered / unregistered / missingMeta / missingOnDisk`。
- 目录集合 = `manifestApps()`（playground manifest，73 项）∪ examples/ 真实目录（82 项）：`registered` 是 per-app 布尔，不做过滤——9 个未注册项（`ai_chat, device_monitor, games, launcher, net_check, nettest_open, typewriter_min, web_config, ws_echo`，与 r169 分类结论一致：需真机/服务端/重复变体）以 `-` 前缀可见，`metaSource:'fallback'` 标记无 page.js 元数据的条目。
- `missingOnDisk`：manifest 里有但磁盘上没有的名字（当前 0，若有即是 playground build 会炸的前置信号）。
- 只读：无板、无网络、无写文件。`lume.js` 三处接线（usage 行 / parse 白名单 / main 路由动态 import），`mcp` 命令保持完好（EOF exit 0 实测）。

## 3. 验收（宿主证据，非真机）

- `node --test tools/lume/examples.test.js` → 5/5 pass（真实 page.js 解析、形状漂移负向、注入依赖的确定性、NDJSON/文本双渲染）。
- `npm test --prefix tools/lume` → **pass 76 / fail 0**（r206 基线 71 → 76）。
- e2e：`lume examples` → 82 行 + summary `{total:82, registered:73, unregistered:9, missingMeta:9, missingOnDisk:0}`；`lume examples wordle` / `examples counter --json` / 未知名 exit 1 / `lume mcp` EOF exit 0，全部实测通过。
- 全量回归 `for t in tests/*.js` → **0 FAIL**。
- `node tools/lume/lume.js check examples/counter --no-emu` → `RESULT: PASS (4 steps, 0 failed; exit 0)`。
- ASCII 纪律：`grep -cPn '[^\x00-\x7F]' tools/lume/examples.js tools/lume/examples.test.js` → `0 / 0`（page.js 本身的 CJK 元数据是数据不是工具源码，输出通道原样透传）。
- firmware/runtime/examples/website 零改动：`git diff origin/main HEAD -- firmware/ runtime/ examples/ website/` 为空。

## 4. deferred / 未做

- `lume_deploy` 类真机验收（本轮无板交互，全宿主）。
- 9 个未注册 example 的注册审计仍按 r169 结论维持跳过（需真机/服务端/重复变体）。
- MCP `lume_examples` 工具未加（`lume_manifest`/`lume_context` 已覆盖目录面；等有真实 agent 消费需求再扩，避免六工具契约无谓膨胀）。
