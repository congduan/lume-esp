# r190 — r186/r187 review P2 收口 + roadmap M4 OTA 状态对齐

基线 `origin/main` `418fcd6`（2026-11-25），分支 `r190-review-followups`，
worktree `/tmp/lume-r190-wt`。本轮全部宿主可验证，**未跑 `idf.py build`、
未声称任何真机验收**。磁盘余量约束下，生成器验证按 r186 先例用 host gcc 代替全量固件构建。

## 动手前实证（评审描述是否仍成立）

| 评审项 | 实证结果 | 证据 |
| --- | --- | --- |
| P2-1 `json.dumps` 控制字符 | 当前生成器仍用 `json.dumps(..., ensure_ascii=False)`；当前三份 prelude 只含 `\n`/`"`/`\` 需要转义，故未触发，属潜在构建地雷 | 旧 `gen_lume_scripts.py:24`；`artifacts/r186/host-c-compile.log` 先例；本轮负例复现 29 条 GCC 错误 |
| P2-2 清单双份维护 | `prelude_runner.js:10-14` 硬编码三文件名，与生成器 `SCRIPTS` 重复；`:19` 确有无效第二实参 | 本轮改动前源码 |
| P2-3 CWD 相对路径 | 33 个 harness 提及 `prelude.js`，其中 9 个直接以 `fs.readFileSync('firmware/.../prelude/*.js')` 读取 | 改动前 grep |
| P2-4 重复 allowlist | 20 个 harness 带 `R166_ALLOWED`/`R129_ALLOWLIST` 历史快照，33 处重复 prelude 路径 | 本轮评估，见下文取舍 |
| r187 TLS 互斥 | `lume_net.c:505` 仍直接检查 `(https_insecure && ca_pem != NULL)` → `LUME_NET_ERR_ARG` = `-1`（`lume_net.h:92`）：505 前的 URL/超时校验在前，`:526` 才 `esp_http_client_init`；`httpGet`（`:448`）与 `httpRequest`（`:462`）共用同一 helper | `artifacts/r190/task2-task3-evidence.txt` |
| gateway delayMs | `:390`/`:453` 已是 `delayMs: 100`（r187 改值已合入），缺的是说明注释；`LIMIT_MS = 3000` 在 `:12` | 同上 |
| roadmap M4 | M4 行仍未勾选；`docs/archive/r96-ota-report.md` 与 roadmap r96 result 均登记代码完成、硬件 deferred | `docs/archive/r96-ota-report.md`；`runtime/types/lume.d.ts:1013/:1110-1120`；`tools/lume/lume.js:32-34/:65-67` |

基线全量回归在 `npm ci --prefix tools/lume` 之前有 7 个 harness 因缺 `esbuild` 转红；装好
CLI 依赖后基线为 0 FAIL（`artifacts/r190/baseline-regression.txt`、
`artifacts/r190/npm-ci.log`）。本轮所有 FAIL 数为 0 的结论都指这个已装依赖的环境。

## 任务一：r186 P2

### P2-1 生成器控制字符转义（`firmware/components/lume-engine/gen_lume_scripts.py`）

删掉 `json.dumps`，改为 `c_string()`：短转义表覆盖 `" \ \n \r \t \b \f`（与 json.dumps
输出一致），其余 `0x00-0x1f` 与 `0x7f` 用 `\xNN`。`\xNN` 后面若紧跟十六进制数字则插入
`""` 结束字面量，避免 `\x01` + `a` 被 C 吞成 `0x1a`。NUL 仍按既有逻辑拒绝。

负例实证（`artifacts/r190/generator-negative-old.log` / `generator-negative-new.log`）：
构造 0x01–0x1f + 0x7f 共 32 个控制字节、每个后跟 ASCII `a` 的临时 JS 源。

```
=== OLD generator (json.dumps) under gcc -Wall -Wextra -Werror ===
... error: \u0001 is not a valid universal character
... error: \u001f is not a valid universal character
gcc exit=1

=== NEW generator under gcc -Wall -Wextra -Werror ===
gcc -c exit=0
=== runtime byte round-trip ===
ROUNDTRIP_OK len=94 control_bytes=31 pairs=31
roundtrip exit=0
```

旧实现恰好在 0x08/09/0a/0c/0d（有 C 短转义）之外全红，与 GCC 规则一致；新实现编译干净，
运行时 `strlen=94` 且 31 个 0x01–0x1f 全部按原字节还原、后跟 `a` 未被吞并。

无回归实证（`artifacts/r190/generator-equivalence.txt`）：改前/改后对当前三份 prelude 的产物
**逐字节相同**，不只是语义相同。

```
cmp exit=0 IDENTICAL
bytes baseline=80915 after=80915
d8706f46...  artifacts/r190/generator-baseline.c
d8706f46...  artifacts/r190/generator-after.c
1558 lines each
```

### P2-2 脚本清单单一来源（`tests/lib/prelude_runner.js`）

改为文本解析生成器 `SCRIPTS = (...)` 块，构建 `filenames`；解析失败或空块直接 throw。
Node 不能 import Python，所以用正则而非运行时 import；正则要求 `SCRIPTS` 的闭括号单独成行
（即当前生成器格式），格式变化会** loud fail** 而不是静默读旧清单，这是可接受的取舍，
因此没有退回「两处清单 + 一致性断言」。顺带删掉 `extract('lume_prelude_js', 'lume_demo_js')`
的无效第二实参。

实证（`artifacts/r190/prelude-runner-single-source.txt`）：正常加载的 prelude sha256 与 r186
基线一致；把生成器里 `prelude.js` 改成 `MISSING.js` 后，runner 立刻报
`ENOENT ... prelude/MISSING.js`，证明它确实跟随生成器清单，随后已恢复原文件。

### P2-3 harness 路径统一

范围按评审引用点收敛为「读取三份 prelude JS 源」的 9 个 harness（12 处读取）：
`tests/apps.js`、`tests/style_mapping.js`、`tests/gestures.js`、`tests/power.js`、
`tests/list_virtualization.js`、`tests/animation_mapping.js`、`tests/lifecycle.js`、
`tests/image_mapping.js`、`tests/theme_mapping.js`，统一为
`path.join(__dirname, '..', 'firmware/components/lume-engine/prelude/...')`，与
`prelude_runner.js:8` 的 `__dirname` 基准一致。改动后 grep 无残留 CWD 相对 prelude 读取，
这 9 个 harness 单独跑全 PASS。

未改 `examples/*/app.js`、`runtime/shell.js` 及 C 源读取：那些路径不在评审引用点范围内，
且 `node tests/*.js` 在仓库根运行本来就绿；把它们一并改会扩大 diff，不符合最小改动要求。

### P2-4 评估后跳过（低优先）

20 个 harness 各自内嵌 `R166_ALLOWED`/`R129_ALLOWLIST`，重复三条 prelude 路径。抽取共享常量
要同时改 20 个文件，还必须重新钉住各 harness 的 `BASE` 才能保持「历史快照零 diff」语义，
属于高 churn、无功能收益，远超本项 30 分钟预算。本轮只做上述 P2-1/2/3，不碰 allowlist
结构，仅在 `tests/ota_consumers.js` 按先例新增两条 r190 具名放行项（报告 + artifacts），
不改任何既有断言。

## 任务二：r187 P2

- `docs/hardware-api.md:311`：先读码确认 `lume_net.c:505` 的互斥检查与 `-1` 返回
  （`httpGet` 经 `:448` 复用同一 helper），再补「`httpsInsecure` 与 `caPem` 同传返回 -1、
  创建 HTTP client 前拒绝、两者都不传才用证书 bundle、二者只可取其一」。未照抄评审原文。
- `tests/gateway.js:390/:453`：两处 `delayMs: 100` 补一行注释，说明 10→100 是抖动缓解，
  断言仍检查文本/计数且受 `LIMIT_MS = 3000` 约束，未放宽断言、未改回退值。

## 任务三：roadmap M4 OTA 状态对齐

只改 `docs/roadmap.md:38`。先读 `docs/archive/r96-ota-report.md` 与 roadmap r96 result
核实：r26 已落地 TCP 传输 + 帧解析；r96 做 HMAC-SHA256 挑战应答、补 `lume.ota`、
`lume.net.otaStatus().hmac` 与 CLI `--host`/`--ota` alias/`--token`/`--ota-port`，端口 8765
由 GOT_IP 门自动托管；真机推包 deferred。按 M2 未勾选行先例补注「代码完成（r26/r96）+
真机推包验收待接板」，整行保持 `- [ ]`，未改里程碑定义，未改勾选状态。

## 验证（原始输出见 `artifacts/r190/`）

1. 全量回归 `for t in tests/*.js; do node $t || echo "FAIL $t"; done`
   → `full-regression.txt` 为空，**0 FAIL**。
2. `node tools/lume/lume.js check examples/counter --no-emu`
   → `check-counter-no-emu.txt`：`RESULT: PASS (4 steps, 0 failed; exit 0)`。
3. 生成器双保险 → `generator-negative-old.log`、`generator-negative-new.log`、
   `generator-equivalence.txt`（见上，含 cmp/sha256）。
4. `python3 scripts/check_website.py` → `check-website.txt` exit 0
   （70 cards；API 161/161，missing/invented/duplicates 均为 none）。
5. `node tests/ota_consumers.js` → `ota-consumers.txt` exit 0，`ALL OTA CONSUMERS HARNESS CASES PASSED`，
   38 条 PASS（含新增 r190 放行后的 mutation 负例）。

额外：`git diff --check` exit 0；未跑 `idf.py build`；未动 vendored、prelude JS 三份源内容、
`examples/*/app.js`、其他固件 C 源；未 push。
