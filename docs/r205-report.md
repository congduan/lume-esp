# r205 报告：退役 ota_consumers 过期冻结快照守卫（249 文件永久红 → 全量回归 0 FAIL）

## 0. 基线与边界

- 基线：`origin/main 5b6b022`（2026-11-27，r204 已推）；worktree `/tmp/lume-r205-wt`，分支 `r205-guard-retire`。开工时 HEAD 与 `origin/main` 均为 `5b6b022`，工作树干净。
- 改动面：`tests/ota_consumers.js`、`docs/r205-report.md`、`artifacts/r205/`、`docs/KNOWN-SIMPLIFICATIONS.md`。未动 `firmware/` / `runtime/` / `examples/` / `tools/` / `website/`；未 push；git 身份 `congduan`（仓库既有配置，未改 git config）。
- 未跑 `idf.py build`（未动 firmware/）。新增 JS 代码与注释全 ASCII；本报告沿用仓库中文报告体例。

## 1. 实证先行（改前实测，不是推测）

`node tests/ota_consumers.js` 改前输出：

- 前 18 条 PASS（含 `firmware/ runtime/ CLI tooling identical to 674684a`）；
- 第 19 条 `FAIL ... only known r132 + r133 + r134 + r135 + r136 files differ from 674684a`，`ERR_ASSERTION`，栈指 `tests/ota_consumers.js:947`，`EXIT=1`。

派发简报记录：`git diff --name-only 674684a HEAD` 共 825 个文件，其中 249 个不在白名单内（docs/archive 93、website/playground 93、artifacts 各轮、firmware/components 10、tools/gateway 4、website/wasm 4、tools/lume 3、.gitignore 1）。守卫实际 `BASE = '94f5d4e'`，断言文案仍写 `674684a` —— 文案与围栏本身都已陈旧。

对照 `must()` 区：改前 19 个 mutation 与 19 条 check 一一对应；只有 1 个 mutation 引用失败断言（`an out-of-scope file changes vs d85e69a`，旧 :1017-1019）。其余 18 个 mutation 与本次删除无关。

## 2. 删除清单与理由

| 删除项 | 旧位置 | 唯一用途 | 删除理由 |
|---|---|---|---|
| check `only known r132 + ... files differ from 674684a` | :911-943 | 全仓 diff 必须落在 `ALLOWED` / `artifacts/rNNN/` 前缀 / `R188_REMOVED` 之内 | 本是 r132-r136 单轮改动面围栏，后被历轮当作「新增文件登记处」持续追加 40+ 个 `startsWith` 前缀与数百条路径；每个 artifacts 轮都要手工加前缀，漏加即红。r203/r204 均带着它过 |
| `must('an out-of-scope file changes vs d85e69a', ...)` | :1017-1019 | 上述 check 的唯一 mutation | 随 check 一同退役；删后 mutation 数 18，仍与 18 条 check 一一对应、逐条 mutation-proven |
| `const allChanged = gitChanged([])` | :121 | 仅被上述 check + mutation 引用 | 全仓 diff 采集器，无其他消费者 |
| `R188_REMOVED`（注释 + `new Set(read('artifacts/r188/removed-files.txt')...)`） | :122-123 | 仅在上述 check 谓词尾部做「已删除文件」例外 | 只服务已退役 check，不是通用固件/runtime 防护；一并清理避免留下悬空读取 |
| `const ALLOWED = [...]`（719 行） | :124-842 | 仅被上述 check 引用 | 逐轮手工登记的流水账，会持续腐烂 |
| 头注释陈旧分句 | :17-19 | 描述 r132-r136 全仓围栏 | 改为准确描述 R166_ALLOWED 固件围栏，并指向本报告 |

**保留项逐条实证**：`BASE`（新 :30）、`gitChanged()`（新 :77）、`R166_ALLOWED`（新 :93）、`fwChanged`（新 :121）、check #18（新 :188）及其 mutation（新 :259-261）原样保留；前 18 条 check 的名字、谓词、顺序、mutation 区未改一字。diffstat：`3 insertions(+), 761 deletions(-)`。

## 3. 防护覆盖映射（逐条 → 有无真空）

| 被删检查原本保护的东西 | 现由哪些活检查覆盖 | 有无真空 |
|---|---|---|
| `firmware/` / `runtime/` / `tools/lume/` 不得越界改动 | 本文件 check #18 `fwChanged ⊆ R166_ALLOWED` + 其 mutation（firmware 文件变更必须转红）；仓库共 22 份 harness 携带 git diff 守卫，其中 14 份（含本文件）用 `gitChanged(['firmware/','runtime/','tools/lume/'])` 且全部再以 `R166_ALLOWED` 过滤做零 diff | 无 |
| playground 生成物与 app 源码漂移 | byte-identical check（`website/playground/sources/dashboard.js === examples/dashboard/app.js`）+ dashboard manifest check + 各自 mutation | 无 |
| UI 字符串 ASCII 纪律 | ASCII-only check + 注入中文 literal 的 mutation | 无 |
| `docs/` / `website/` / `examples/` / `tools/` / `artifacts/` 的文件改动登记 | git 历史、逐轮报告、各 app harness 的具体源码断言；`tools/gateway` 由 `tests/gateway*.js` 覆盖 | 不再是安全边界：原是人工登记流水账，不是行为约束 |
| 全仓「任何新增文件都必须先登记」的观测能力 | 无单一替代 | **主动放弃**：这正是本轮目标（逐轮维护型断言不可持续）。代价是失去全仓总账；firmware/runtime/CLI 的真实围栏未弱化 |

**结论**：没有行为级防护真空。唯一消失的是「全仓新增文件登记册」这种需要逐轮人工维护的观测能力，它不是安全边界，且 git 历史 + 逐轮报告已是权威来源。

## 4. 可选加固：评估后不加

考虑过「`docs/rXXX-report.md` 与 `artifacts/rXXX` 在最近 N 轮内成对出现」这类结构性断言。不加，理由：

- 需要维护滑动窗口 N 或逐轮枚举 → 本身就是新的逐轮维护项，与本轮「删掉逐轮腐烂断言」的目标相悖；
- 历轮存在合法无 artifacts 的纯 docs / 纯测试刀，会引入新 flake 并需要历史数据豁免；
- 结构性配对检查不会比 git 历史更权威。

## 5. 验证原始输出

完整日志在 `artifacts/r205/`：`ota_consumers.log`、`full-regression.log`、`npm-test.log`。

### 5.1 `node tests/ota_consumers.js`（18 check + 18 mutation，EXIT=0）

```
PASS ota_consumers: OTA helper reads lume.ota.status() locally
PASS ota_consumers: number return discriminated via typeof === object, ASCII err code
PASS ota_consumers: four flags + port rendered; .token / [token] never read in either app
PASS ota_consumers: OTA row is exactly View + Text + Button (3 nodes)
PASS ota_consumers: row Text shows only status; New-token opens a Dialog
PASS ota_consumers: setToken sits in the danger Rotate onPress of a Dialog
PASS ota_consumers: Dialog guard degrades to an ASCII note; no 3 s arm timer remains
PASS ota_consumers: replacement token is 32 lowercase hex chars from Math.random
PASS ota_consumers: setToken failure renders ASCII code; success refreshes status
PASS ota_consumers: 600 ms poll refreshes OTA status
PASS ota_consumers: header registers Math.random as NOT cryptographically secure
PASS ota_consumers: dashboard SYSTEM reads status() with typeof === object discrimination
PASS ota_consumers: dashboard publishes OTA row with 9 separators inside 360 px
PASS ota_consumers: dashboard OTA line never reads token
PASS ota_consumers: playground sources/dashboard.js byte-identical to example
PASS ota_consumers: dashboard is in the playground manifest
PASS ota_consumers: all UI string literals ASCII-only (r64)
PASS ota_consumers: firmware/ runtime/ CLI tooling identical to 674684a
PASS ota_consumers mutation: drop the lume.ota.status() read -> FAIL as expected
PASS ota_consumers mutation: truthy test replaces typeof === object discrimination -> FAIL as expected
PASS ota_consumers mutation: render the full token straight into the status text -> FAIL as expected
PASS ota_consumers mutation: drop the OTA row Text -> FAIL as expected
PASS ota_consumers mutation: New-token button no longer opens a Dialog -> FAIL as expected
PASS ota_consumers mutation: danger Rotate button downgraded -> FAIL as expected
PASS ota_consumers mutation: Dialog guard hardened (no ASCII fallback) -> FAIL as expected
PASS ota_consumers mutation: token length shrinks from 32 to 16 hex chars -> FAIL as expected
PASS ota_consumers mutation: setToken failure loses its ASCII return code -> FAIL as expected
PASS ota_consumers mutation: poll no longer refreshes OTA status -> FAIL as expected
PASS ota_consumers mutation: header drops the non-CSPRNG registration -> FAIL as expected
PASS ota_consumers mutation: dashboard truthy test replaces typeof === object -> FAIL as expected
PASS ota_consumers mutation: dashboard separators revert to 8 -> FAIL as expected
PASS ota_consumers mutation: dashboard renders the full token on canvas -> FAIL as expected
PASS ota_consumers mutation: playground generated source drifts from the example -> FAIL as expected
PASS ota_consumers mutation: playground manifest drops dashboard -> FAIL as expected
PASS ota_consumers mutation: a non-ASCII UI literal slips in -> FAIL as expected
PASS ota_consumers mutation: a firmware file changes vs d85e69a -> FAIL as expected
ALL OTA CONSUMERS HARNESS CASES PASSED
OTA_CONSUMERS_EXIT=0
```

### 5.2 全量回归（`for t in tests/*.js; do node $t || echo "FAIL $t"; done`；0 FAIL）

```
SLOW tests/alloc_inject.js secs=31 (pass)
SLOW tests/compress.js secs=31 (pass)
SLOW tests/crypto.js secs=32 (pass)
SLOW tests/decode.js secs=30 (pass)
SLOW tests/fft.js secs=33 (pass)
SLOW tests/imgscale.js secs=34 (pass)
TEST_FILES_RUN=110
SLOW_PASS=6
FULL_LOOP_EXIT=0
```

参数透明度记录（**非 flake**）：第一次用 20s/测试预算跑，6 个 C 编译 harness（`alloc_inject` / `compress` / `crypto` / `decode` / `fft` / `imgscale`，每次 `cc -O2` 编译 QuickJS）全部 `ec=124`，`FULL_LOOP_EXIT=1`。这是验证脚本参数给得太紧；单次计时 `tests/fft.js` 实测 33s。改 150s/测试后 110/110 PASS。wordle/flake 本轮未触发，无需重跑。

### 5.3 `npm test --prefix tools/lume`（0 fail）

```
# tests 57
# suites 0
# pass 57
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 2580.04316
NPM_TEST_EXIT=0
```

## 6. 提交拆分与收尾

- test 段：`tests/ota_consumers.js` + `artifacts/r205/*.log`。
- docs 段：`docs/r205-report.md` + `docs/KNOWN-SIMPLIFICATIONS.md`（r205 取舍登记）。
- 未 push；未跑 `idf.py build`（firmware 零改动）；未做真机验收，板级指标仍 deferred。
