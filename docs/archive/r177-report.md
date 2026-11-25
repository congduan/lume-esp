# r177 报告：M5 board abstraction 第三刀 —— `lume.system.board`

基线：`origin/main` `358dbb0`（2026-11-23，含 r176）。worktree `/tmp/lume-r177-wt`，
分支 `r177-board-id-js`。开场守卫：
`bash /home/ubuntu/.hermes/scripts/lume_model_guard.sh` ->
`GUARD: settings.json model=hy4flash-free ✓` / `GUARD: model=hy4flash-free ✓ (settings + runtime audit clean)`。

提交（未推送）：

| commit | 内容 |
|---|---|
| `3514c76` | feat：native + prelude getter + `.d.ts` + 两个 stub + playground 生成物 |
| `69af9a9` | test：`tests/board_id.js` + 21 个守卫 BASE 重钉 |
| `dc9755a` | test(ota)：整仓守卫接纳本轮 harness / 报告 / `artifacts/r177/` |

## 1. 实证结论（与简报假设的差异）

1. **HAL 访问函数实际叫 `lume_board_get()`，不存在 `lume_board_hal_get()`。**
   `firmware/components/lume-board-hal/include/lume_board_hal.h:59` 声明
   `const lume_board_t *lume_board_get(void);`，`:52` 结构体字段为 `const char *board_id`。
   未注册时 `lume_board_hal.c:48-54` 的 `s_lume_board_generic.board_id == "generic"`，
   注册后 `lume_board.c` 以 `LUME_BOARD_NAME` 填 `.board_id`。实现按真实 API 走，简报中的
   `lume_board_hal_get()` 名称未采用。
2. **`lume.system` 是 `lume_scripts.c` 内的对象字面量**（`lume_scripts.c:464-476`）。
   `time` 的形态是包装函数 `time: function () { return lume._systemTime(); }`，
   `reboot` 则是直接把 native 挂上来（`reboot: lume._systemReboot`）。native 在
   `lume_engine.c:3297-3305` 以 `_systemTime` / `_systemSetTimeNtp` / `_systemReboot`
   注册到全局 `lume` 对象。
3. **可读性取舍**：board 是编译期常量但要求“只读字符串”，故不采用 `time()` 的函数形态，
   而采用同款包装的 getter：`get board() { return lume._systemBoard(); }`（无 setter，
   非严格模式下 app 赋值被静默忽略）。`.d.ts` 用 `const board: string;` 锁定只读契约。
4. **消费方向**：选 `lume-engine REQUIRES lume-board-hal`（`lume-engine/CMakeLists.txt:4`），
   而不是经 `lume-board` 取值。理由：HAL 是无依赖的纯注册表（`lume-board-hal/CMakeLists.txt`
   无 `REQUIRES`），engine 直接消费只加一行 CMake 依赖；若改走 `lume-board`，engine 需新增对
   整块板级驱动的依赖（display/touch/pmic），侵入面更大。方向保持单向，HAL 不反向依赖 engine。

## 2. 改动面

- `lume_engine.c:32` include HAL；`:726` 新增 `js_system_board()`，读
  `lume_board_get()->board_id` 并用 `JS_NewString()` 拷贝（不别名静态 registry）；`:3314` 注册
  `_systemBoard`（0 参数）。未加 `IRAM_ATTR`。
- `lume_scripts.c:473`：`lume.system.board` getter。
- `runtime/types/lume.d.ts:476`：`const board: string;`，注释写明值域为 `LUME_BOARD` 编译期板名、
  未注册时 `"generic"`、host stub 默认 `"host-stub"`（可经 `options.board` 注入）、
  browser stub `"browser-stub"`，以及“非真机验收”。
- `tests/lib/prelude_runner.js:278`：`_systemBoard: () => (options.board === undefined ? 'host-stub' : options.board)`。
- `website/playground/runtime.js:287`：`_systemBoard: () => 'browser-stub'`。
- 生成物：`website/playground/prelude.js` 由 `npm run build:playground` 从 `lume_scripts.c` 重建；
  `website/api.html` 无需重生成（`check_website.py` 的 catalog 只收 `function` 声明，
  `const board` 不产生条目；`gen_api_docs.py --check` 报 up to date，161 entries）。

## 3. 验证（原始输出见 `artifacts/r177/`）

### 3.1 固件 build + size

`idf.py build` 使用规定 wrapper、`cd /tmp/lume-r177-wt/firmware`。第一次 wrapper 调用在工具前台
超时处被中断（日志停在 96% / `liblvgl.a`）；第二次增量调用完成，`BUILD_EXIT=0`，
`build.log` 为两次调用原始输出的拼接。`idf.py size` 同 wrapper，`SIZE_EXIT=0`。

```
lume.bin binary size 0x2e63c0 bytes. Smallest app partition is 0x640000 bytes. 0x359c40 bytes (54%) free.
| Flash Code          |      2044628 |
| Flash Data          |       853660 |
| DIRAM               |       247523 |    72.43 |          94237 |        341760 |
| IRAM                |        16384 |    100.0 |              0 |         16384 |
Total image size: 3040075 bytes (.bin may be padded larger)
```

对照 r176 实测基线（`docs/r176-report.md`：Flash Code 2044520 / Flash Data 853532 / DIRAM 247523 /
Total 3039839 / `lume.bin` 0x2e62e0）：

| 指标 | r176 | r177 | 增量 |
|---|---|---|---|
| Flash Code | 2044520 | 2044628 | +108 B |
| Flash Data | 853532 | 853660 | +128 B |
| DIRAM | 247523 | 247523 | 0 |
| IRAM / Remain | 16384 / 0 | 16384 / 0 | 0 / 0 |
| Total image | 3039839 | 3040075 | +236 B |
| `lume.bin` | 0x2e62e0 | 0x2e63c0 | +224 B |

**IRAM 16384 / Remain 0 硬线未破。** `idf.py size` 抓完后已 `rm -rf firmware/build`；
`/tmp` 盘余量 4.5G。`firmware/sdkconfig` 无 diff。

### 3.2 宿主 harness

- `node tests/board_id.js` -> exit 0（`artifacts/r177/board-id-harness.log`）。12 条静态契约 +
  7 条静态 mutation proof + 3 条 live 断言 + 2 条 live mutation proof：getter 存在、`typeof === 'string'`、
  值等于注入的 stub 值、默认 `"host-stub"`、app 赋值无法改动；删 `.d.ts` 字段/改 number、
  删 prelude getter、删 C 注册、C native 改非 string、两个 stub 改 number、live 注入 number、
  删 backing native 全部转红。`.d.ts` 契约由静态断言锁定。
- 全量 `timeout 600 bash -c 'for t in tests/*.js; do node "$t" >/dev/null 2>&1 || echo FAIL "$t"; done'`：
  重钉前 **21 FAIL**（`artifacts/r177/regression-before-repin.log`；含 `board_abi` 的
  `lume-engine` diff、20 个 `4a2bd29` BASE 守卫；`sntp.js` 等契约型 harness 全程绿），
  重钉并接纳本轮 harness 后 **0 FAIL / 101 个 harness**
  （`artifacts/r177/regression-after-repin.log`、`regression-final.log`）。

### 3.3 BASE 重钉（test commit `69af9a9` / `dc9755a`）

- 21 个失败守卫的 BASE 从 `4a2bd29`（及 `board_abi.js` 的 `dafa1ed`、
  `wordle`/`keyboard_demo`/`keyboard_states`/`controls_demo` 的 `dafa1ed` prelude 守卫）
  重钉到本轮 feat commit `3514c76`。`controls_demo` 的 `HEAD_BASE` 同步重钉。
- **未放宽断言语义**：`git diff` 谓词、allowlist 成员、mutation proof 除 BASE 字符串与
  注释标签外逐字节相同（核对命令 `git diff -U0 -- tests/` 仅显示 hash/注释行）。
- `ota_consumers` 的整仓守卫在 test commit 落盘后因新文件 `tests/board_id.js` 由 untracked
  变为 tracked 而转红；按 r173/r176 先例只接纳本轮三个具名对象（`tests/board_id.js`、
  `docs/r177-report.md`、`artifacts/r177/` 前缀），其余 allowlist 与谓词不变。

### 3.4 其他检查

- `npm test --prefix tools/lume` -> `NPM_TEST_EXIT=0`，`# tests 52 / # pass 52 / # fail 0`
  （`artifacts/r177/npm-test.log`）。worktree 缺 gitignore 的 `tools/lume/node_modules` 与 `bin`
  （r176 先例：主仓只读软链），无 `tools/` 源码改动。
- `python3 scripts/check_website.py` -> `WEBSITE_EXIT=0`，
  `API: 161 catalog entries, 161 type declarations, 34 function namespaces`、
  `API missing/invented/duplicates: none`、`signatures not found: none`
  （`artifacts/r177/website.log`）；`gen_api_docs.py --check` -> `api.html is up to date (161 entries)`。
- 哨兵 `node tools/lume/lume.js check examples/counter --no-emu` -> `LUME_CHECK_EXIT=0`，
  `RESULT: PASS (4 steps, 0 failed; exit 0)`（`artifacts/r177/lume-check.log`）。
- `npm run build:playground --prefix tools/lume` 连续两次 exit 0，第二次后
  `git status --short` 与第一次完全一致（除未跟踪的 `artifacts/r177/` 与软链 `tools/lume/bin`），
  生成物幂等（`artifacts/r177/playground-build-{1,2}.log`）。

## 4. 里程碑 / 诚实口径

- M5 "Board abstraction" checkbox **不勾**：本刀只让 app 读到编译期板名，没有第二块板、
  没有运行时切换、没有真机验收。
- 所有结论均为**编译 / 宿主证据，非真机**。未验证项：真实板上 `board_id` 是否为
  `LUME_BOARD_NAME`、未注册时的 `"generic"` 时序、触摸/显示差异、睡眠电流、射频。
- 未动 vendored（QuickJS-NG / LVGL）、`boards/*/profile`、`tools/lume` 源码；未 push；
  未改里程碑定义；ascii 纪律保持（代码与 fixture UI 字符串 ASCII-only）。
