# r199 报告 — `lume context` 机器可读仓库快照（AX 基建线第二刀）

基线：**实际 HEAD `83fd750` / `origin/main` 同指**（2026-11-26，r200-ui-quality 合并点），worktree `/tmp/lume-r199-wt`，分支 `r199-lume-context`。**全部证据为宿主机证据**；不涉及真机显示 / 触控 / 射频 / 功耗，不声称真机验证。改动面仅 `tools/lume/`、`tests/`、`docs/`、`artifacts/r199/`。

## 1. 动手前实证：两处简报口径与源码不符

| 简报口径 | 实证结果 | 处理 |
|---|---|---|
| 基线 HEAD = `origin/main 4906a0f`（2026-11-26） | `4906a0f` 存在（r198 docs 提交），但当前分支 HEAD 与 `origin/main` 均已前进到 `83fd750`（r200 合并，2026-11-26 18:24 +0800） | 按「不一致以源码为准」，从 `83fd750` 开工；`git diff origin/main -- firmware/ runtime/ examples/` 仍为 0 字节 |
| `unregistered` 应为空数组（examples ⊇ manifest） | manifest 73 个，`examples/` 82 个目录；差集 **9 个**：`ai_chat`, `device_monitor`, `games`, `launcher`, `net_check`, `nettest_open`, `typewriter_min`, `web_config`, `ws_echo`；反向差集为空（manifest ⊆ examples） | 如实输出 9 个，不改 playground manifest（超授权面、且本轮不重建生成物）；harness 改为「独立复算 examples−manifest 集合相等」断言，并 mutation 自证明其可转红 |

其余简报前提均实证成立：`lume --help` 无 `context` 子命令、`grep context tools/lume/lume.js` 零命中、`examples/` 无 `meta.json`、`manifestApps()` 已导出、`tools/lume/node_modules` 与 `tools/lume/bin/qjsc` 软链就绪。

## 2. 复用点实证（先读源码，再决定接法）

- **`manifestApps()` 可安全 import**：`tools/playground/build.mjs:17` 导出，顶层只有 `createRequire(...)` + `require('esbuild')`，真正的生成逻辑在 `if (process.argv[1] === 本文件路径)` 守卫内。从 CLI 导入时 `process.argv[1]` 是 `lume.js`，守卫为假。实测 `node --input-type=module -e "import {manifestApps} ..."` 输出 `COUNT 73` 且 `git status` 干净 → **直接 import，不降级读文件，未重建 playground**（证据 `artifacts/r199/import-probe.txt`）。
- **`check --json` 契约**：`tools/lume/check.js:227` 的 `check(appDir, options, deps)` 返回 `{ok, app, steps, screenshot}`；`:366` 的 `render(result,{json:true})` 才是 `JSON.stringify(result, null, 2)`。因此不 spawn 子 CLI、不解析打印文本，而是**直接 import `check()`**，传 `{noEmu:true, timeout:60}` 取结果对象；外层 `Promise.race` 做 60s 硬上限，超时记 `timeout:true` + `errors.check`，不挂死。
- **`.d.ts` 命名空间结构**：`runtime/types/lume.d.ts` 有 29 处 `declare namespace lume...`（含裸 `lume` 与 `lume.ui` / `lume.net` / `lume.storage.kv` 等），另有缩进的嵌套 `namespace Toast` / `ws` / `http` / `web` / `mp3`。按简报「如 `declare namespace` 列表」口径取 29 个顶层声明，嵌套子命名空间未列入（见 KNOWN-SIMPLIFICATIONS r199）。`api` 字段实测 29 项。
- **esp32sim 可用性路径**：`tools/emu/run.sh:25` 与 `tools/lume/scan.js:138` 一致取 `tools/emu/.cache/bin/esp32sim`。本 worktree 该二进制不存在 → `env.esp32sim=false`（如实反映，不伪造可用）；`env.qjsc=true`（软链存在）。

## 3. 实现

- `tools/lume/context.js`（ESM，ASCII 纯源码）：`context(options, deps)` 返回 `{data, failed}`；`renderContext(data, {json})` 负责紧凑 / 2 空格缩进输出。字段顺序 `version, repo, head, branch, manifest, examples, unregistered, harnesses, api, check, env, errors`。每个块独立 `section()` try/catch，失败写 `errors.<块名>` 并给安全回落值，其余块照常输出；`--strict` 仅在 `errors` 非空时 exit 1，JSON 照常打印。`deps`（`git` / `check` / `manifestApps`）是给单元测试注入失败用的最小接缝。
- `tools/lume/lume.js:15,18,46-48,434`：注册 `context` 子命令与三个开关，usage/help 同步；派发处按 `strict && failed` 设置 `process.exitCode`。
- `tools/lume/context.test.js`：`node:test` 5 例（必填字段、未注册集合、两种渲染一致、git 块失败隔离、哨兵检查失败隔离）。
- `tests/lume_context.js`：CommonJS 真 spawn CLI，11 组 PASS，含 must-have-fields 删除 `head` 的结构性 mutation 自检（不碰生产代码）。
- `tests/ota_consumers.js`：机械追加 r199 路径到 `R166_ALLOWED` / `ALLOWED` 与 `artifacts/r199/` 前缀；BASE `94f5d4e` 与全部断言谓词未改。改动前先跑基线 107 harness 0 FAIL。`docs/KNOWN-SIMPLIFICATIONS.md` 已在 ALLOWED 中，无需追加。

## 4. 验证（原始输出见 `artifacts/r199/`）

| # | 命令 | 结果 | 证据 |
|---|---|---|---|
| 1 | `node tests/lume_context.js` | 11 组 PASS，末行 `ALL LUME CONTEXT HARNESS CASES PASSED`，EXIT 0 | `harness.txt` |
| 2 | `for t in tests/*.js; do node $t \|\| echo FAIL $t; done` | `DONE`，0 FAIL（基线 107 + 新增 1 = 108）；提交后同步 13 个镜像守卫后复跑仍 `DONE` / 0 FAIL | `tests-all.txt`、`post-commit-guard.txt` |
| 3 | `npm test --prefix tools/lume` | `1..57 / pass 57 / fail 0`，EXIT 0（基线 52 + 新增 5） | `cli-tests.txt` |
| 4 | `node tools/lume/lume.js context` | 完整 2 空格缩进 JSON；`version 0.1.0`、`head 83fd750`、`branch r199-lume-context`、`check.run true / ok true`、`errors {}` | `context-default.txt` |
| 5 | `node tools/lume/lume.js context --json \| python3 -m json.tool >/dev/null` | `VALID_JSON` | `json-valid.txt` |
| 6 | `node tools/lume/lume.js check examples/counter --no-emu` | `RESULT: PASS (4 steps, 0 failed; exit 0)` | `check-sentinel.txt` |
| 7 | `python3 scripts/check_website.py` | `API missing/invented/duplicates/signatures: none`，73 cards，EXIT 0 | `website.txt` |
| 8 | `git diff origin/main -- firmware/ runtime/ examples/` | **0 字节**；未跑 `idf.py build`，未重建 playground | `diff-scope.txt` |
| 9 | `grep -Pn '[^\x00-\x7F]' tools/lume/context.js tools/lume/context.test.js tests/lume_context.js` | 0 命中 | `ascii.txt` |
| 10 | `git status --short` | 仅预期改动面（CLI / harness / 白名单 / docs / artifacts） | `status.txt` |

快照关键字段实证：`manifest=73`、`examples=82`、`unregistered=9`、`harnesses=108`、`api=29`、`env.node=v22.23.1`、`env.platform=linux`、`env.qjsc=true`、`env.esp32sim=false`。

## 5. 提交后新发现：镜像零 diff 守卫同步（超出简报列举改动面，已如实登记）

三个提交落地后复跑全量回归，出现 **13 个 FAIL**（`archive_view` / `control_center` / `crypto_check` / `hr_monitor` / `img_view` / `keyboard_states` / `launcher_grid` / `reboot_consumers` / `sntp_consumers2` / `timer_kit` / `vec_demo` / `weather_sntp` / `wordle`）。根因不是功能缺陷：这 13 个 harness 各自复制了一份 `R166_ALLOWED`，并用 `git diff --name-only <BASE> HEAD -- firmware/ runtime/ tools/lume/` 做零 diff 守卫；提交前新增文件是 untracked，`git diff` 看不见，提交后 `tools/lume/context.js` 与 `tools/lume/context.test.js` 进入 HEAD diff，守卫如实转红。

处理：对这 13 份 harness **仅机械追加两个路径**到各自的 `R166_ALLOWED`，不重钉 BASE、不改任何断言谓词、不动 `firmware/` / `runtime/` / `examples/`。这是仓库既有惯例（r172/r195/r196 等同类型同步），也是让提交后的全量回归保持 0 FAIL 的必要维护。简报红线列举的测试改动面只含 `tests/ota_consumers.js`，本轮因该实证被迫扩面，在此明确登记；证据 `artifacts/r199/post-commit-guard.txt`。

## 6. 范围与取舍

- 不改 `firmware/`、`runtime/`、`examples/`、vendored；不重建 `website/playground` 生成物；不 push；未跑 codex review（主控轮负责）。
- `--strict` 只把**块级 error** 视为失败；哨兵 `check.ok=false`（检查正常跑完但结果不绿）不触发 exit 1。本轮未人为注入失败路径测试 strict 的 exit 1，登记 KNOWN-SIMPLIFICATIONS。
- 无真机验收；AX 快照仅描述宿主可实证的仓库事实，`env` 中的 `qjsc` / `esp32sim` 只表示宿主文件存在性，不代表设备侧能力。
- commits 拆 feat / test / docs 三段（另加提交后守卫同步的 test 段与登记该偏差的 docs 段），git 身份沿用 repo 级 `congduan` 配置。
