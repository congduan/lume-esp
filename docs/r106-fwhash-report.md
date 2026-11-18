# r106 — deploy manifest 绑定固件 API tag（fwhash 续刀收口）

基线 `def2ba0`（main，r105 + playground fix）。工作目录 `/tmp/lume-r106-wt`，分支
`r106-fwhash`。上一引擎轮因 429 限流中断留下 2 文件 +152 行 WIP；本轮先审阅实证，
修正后收口。**本刀无真机验证**（deploy/启动兼容性仅限宿主 harness + 固件编译绿），
诚实登记于文末。

## 0. 开工前置（原始输出）

```
$ git -C /tmp/lume-r106-wt log --oneline -1
def2ba0 fix(playground): add missing flapdot script tag (bundle existed but never loaded)

$ bash /home/ubuntu/.hermes/scripts/lume_model_guard.sh
GUARD: settings.json model=hy4flash-free ✓
GUARD: model=hy4flash-free ✓ (settings + runtime audit clean)
```

## 1. 半成品审阅结论（实证，不推倒重来）

`git diff` 逐文件审阅 WIP（`lume_apps.h` +24、`lume_apps.c` +128）后判定：

- **保留**：`LUME_API_TAG`（`const unsigned long = 1`，值取 1 起步、注释写明 bump
  纪律）、错误码 `LUME_APPS_ERR_FWTAG = -7`、递归锁包裹的 FS 读写模式。
- **实证缺陷 1（存储形状偏离简报）**：WIP 用 `apps/<id>/.fwtag` sidecar，由固件在
  `lume_apps_store()` 里打标；但简报明确要求 CLI 查询设备 tag 写入 **meta.json 的
  `fw` 字段**，且宿主 harness 要覆盖「meta 含 fw 字段 / mismatch / 旧 meta WARN」
  三路径。sidecar 与 meta.json 是两套 source of truth → **修正**为 meta.json 方案。
- **实证缺陷 2（校验未接线）**：WIP 的 `lume_apps_tag_check()` 只定义、未被任何 launch
  路径调用（grep 仅命中自身与头文件声明）→ boot 恢复与 `lume.apps.launch`/LAUNCH 命令
  均不会触发校验。
- **实证缺陷 3（无查询通道与 CLI 侧）**：无 FWTAG 命令、无 CLI 打标、无 harness。

实证方式：先读 `lume_apps.c` 全文、`lume_engine.c` 的两条 launch 路径
（`request_launch_common` L3501、`engine_task` boot 块 L3723）、`lume_hotreload.c`
命令分发表（VER 查询 L411）与 `tools/lume/protocol.js`，确认真实链路后再续写。

## 2. 实现摘要

固件：
- `lume_fwtag.h`（新增，portable `static inline`）：`lume_fwtag_extract()` 从单行 meta
  里扫 `"fw": <int>`（无 JSON parser）；`lume_fwtag_decide()` 纯比较，返回
  OK / UNKNOWN / MISMATCH(-7)。同一份源码在固件与宿主 harness 编译。
- `lume_apps.c`：`lume_apps_tag_check(id)` 改为读 meta.json 提取 fw；match → OK，
  mismatch → `ESP_LOGW` 打印 **两个 tag 值**并返回 `ERR_FWTAG`，无 fw / 无 meta /
  非整数值 → WARN + 放行（旧 app 不砖）。移除 WIP 的 sidecar 写入/删除逻辑。
- `lume_engine.c`：两处接线 —— boot 恢复（mismatch 清 `.current` 与 `.boot` 回落
  home/launcher）与 `request_launch_common`（JS `lume.apps.launch` 与 LAUNCH 命令共用
  的运行时启动闸门）。
- `lume_cmd.h/.c` + `lume_hotreload.c`：新增无 id 的 `FWTAG` 命令 → `CMD OK fwt <TAG>`；
  LAUNCH 被 tag 拒绝时回 `CMD ERR fwt-mismatch`（不再误报 stage-oom）。

CLI：
- `protocol.js` 新增 `FWTAG_CMD`；`fwtag.js`（新增，可单测）`queryFirmwareTag(device)`
  校验 `verb==='fwt'` 且 arg 为十进制，失败如实 throw、绝不造假值。
- `lume.js`：`install()` 先查 tag 再写入 `meta.fw`；查询失败 WARN 降级为「不写 fw」
  （设备按 unknown 处理）。`lume apps list` 查询设备 tag，逐 app 标注 `fw=N` 与
  `MISMATCH`。
- `lume.d.ts` **未改**：JS `lume.apps.*` API 面无变化（meta 仍以原文/现有 entries 结构
  返回，`fw` 是 meta.json 的额外字段）；`gen_api_docs.py --check` 已确认 fresh。

## 3. 验证（原始输出）

### 3.1 全量宿主 JS harness：`for t in tests/*.js; do node "$t" || echo FAIL "$t"; done`

```
OK count: 59
FAILS:
none
```

（59 个 harness 全部退出 0，无 `FAIL <t>` 行。逐文件日志：`/tmp/alljs.log`。）

### 3.2 CLI 单测：`npm test --prefix tools/lume`

```
# tests 45
# suites 0
# pass 44
# fail 0
# cancelled 0
# skipped 1
# todo 0
# duration_ms 2215.933702
```

新增用例：`r106 FWTAG is an id-less LUMC verb and parses the device reply`
（ success / 旧固件报错 / 畸形reply 三支）全绿。

### 3.3 C 宿主 harness（三路径，原始输出）

```
$ gcc -std=c11 -Wall -Wextra -Werror \
    -I firmware/components/lume-hotreload/include \
    -I firmware/components/lume-engine/include \
    tests/apps_protocol.c firmware/components/lume-hotreload/lume_frame.c \
    firmware/components/lume-hotreload/lume_cmd.c \
    -o /tmp/lume_apps_protocol && /tmp/lume_apps_protocol
...
41 checks, 0 failure(s)

$ gcc -std=c11 -Wall -Wextra -Werror \
    -I firmware/components/lume-engine/include \
    tests/fwtag_protocol.c -o /tmp/lume_fwtag_protocol && /tmp/lume_fwtag_protocol
r106 fwtag host harness
  ok  : path1: fw matches current -> allow
        fw='1' current=1
  ok  : path1: fw with surrounding whitespace -> allow
        fw='7' current=7
  ok  : path2: fw differs from current -> refuse
        fw='1' current=2
  ok  : path3: no fw field -> unknown (WARN + allow)
  ok  : path3: non-integer fw -> unknown (WARN + allow)
  ok  : NULL meta rejected
  ok  : NULL out rejected
  ok  : lookalike keys do not match fw
14 checks, 0 failures
```

### 3.4 API 文档 fresh：`python3 scripts/gen_api_docs.py --check`

```
api.html is up to date with lume.d.ts (137 entries)
```

### 3.5 回归哨兵：`node tools/lume/lume.js check examples/counter`

首次直接运行命中 r64 worktree 坑（emu 触发 `idf.py build`，120s 超时，`eval FAIL /
emulator timed out`）。按简报纪律从主仓拷三件套 + `EMU_SKIP_BUILD=1` 重跑：

```
$ EMU_SKIP_BUILD=1 EMU_BIN=/home/ubuntu/lume/tools/emu/.cache/bin/esp32sim \
  EMU_ROM=/home/ubuntu/lume/website/wasm/fw/esp32s3_rev0_rom.elf \
  node tools/lume/lume.js check examples/counter

lume check examples/counter

[PASS] bundle   2160 bytes (77 ms)
[PASS] eval     2x "app eval ok; entering event loop"
[PASS] layout   R1 PASS  R2 PASS  R3 PASS  R4 PASS  R5 PASS  R6 PASS  R7 PASS
[SKIP] perf     profile disabled

screenshot: artifacts/check/counter/tft.png
RESULT: PASS (4 steps, 0 failed; exit 0)
=== sentinel exit: 0 ===
```

口径说明：该 emu 用的是 `website/wasm/fw/` 的**既有预构建 lume.bin**（r105 期），
用于 CLI/app 回归哨兵，不承载本刀 C 改动；C 改动由 §3.3 harness + §3.6 编译验证。

### 3.6 固件构建与尺寸（改了 C，必跑）

命令（环境铁律：剔除 VIRTUAL_ENV，python_env=py3.12）：

```bash
cd /opt/esp/esp-idf && env -u VIRTUAL_ENV \
  IDF_PYTHON_ENV_PATH=/home/ubuntu/.espressif/python_env/idf5.5_py3.12_env \
  bash -c '. ./export.sh >/dev/null 2>&1; \
           cd /tmp/lume-r106-wt/firmware && idf.py build && idf.py size'
```

QuickJS 调试信息汇编在 host swap 压力下停滞（与 r78/r82 同一现象，`quickjs.c.obj`
始终未生成）。依先例，**仅对 build 目录中的 quickjs-ng 目标用同一命令行加末尾
`-g0` 单独重编**（`compile_commands.json` 提取原命令 + ` -g0`，RC=0），未改任何
vendored 或工程源码编译选项；随后原命令 `idf.py build` 成功。

构建尾部原始输出：

```
[100%] Built target __idf_lume-engine
[100%] Built target __idf_lume-hotreload
[100%] Built target __idf_main
[100%] Built target lume.elf
[100%] Built target gen_project_binary
lume.bin binary size 0x2e29f0 bytes. Smallest app partition is 0x640000 bytes. 0x35d610 bytes (54%) free.
[100%] Built target app_check_size
[100%] Built target app
=== build exit: 0 ===
```

`idf.py size` 原始表：

```
                            Memory Type Usage Summary
┏━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━┳━━━━━━━━━━┳━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━┓
┃ Memory Type/Section ┃ Used [bytes] ┃ Used [%] ┃ Remain [bytes] ┃ Total [bytes] ┃
┡━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━╇━━━━━━━━━━╇━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━┩
│ Flash Code          │      2032860 │          │                │               │
│    .text            │      2032860 │          │                │               │
│ Flash Data          │       850644 │          │                │               │
│    .rodata          │       850388 │          │                │               │
│    .appdesc         │          256 │          │                │               │
│ DIRAM               │       247267 │    72.35 │          94493 │        341760 │
│    .bss             │       121960 │    35.69 │                │               │
│    .text            │       101679 │    29.75 │                │               │
│    .data            │        23628 │     6.91 │                │               │
│ IRAM                │        16384 │    100.0 │              0 │         16384 │
│    .text            │        15356 │    93.73 │                │               │
│    .vectors         │         1028 │     6.27 │                │               │
│ RTC FAST            │           72 │     0.88 │           8120 │          8192 │
│ RTC SLOW            │           32 │     0.39 │           8160 │          8192 │
└─────────────────────┴──────────────┴──────────┴────────────────┴───────────────┘
Total image size: 3025275 bytes (.bin may be padded larger)
```

尺寸对比（如实记录）：

| 项 | r106 | 简报引用基线（r82 期） | 最近 roadmap 基线（r93） |
| --- | --- | --- | --- |
| Flash Code | 2,032,860 | 2,021,336（+11,524） | 2,030,508（+2,352） |
| Flash Data | 850,644 | — | 850,196（+448） |
| DIRAM | 247,267 | — | 247,267（0） |
| IRAM | 16,384 / 16,384，Remain 0 | 同 | 同（硬线守住） |
| Total image | 3,025,275 | — | 3,022,243（+3,032） |

简报里的 2,021,336 是 r82-era 数字；与最近一次有记录的基线（r93 2,030,508）比，
本刀 Flash Code 净增约 **+2,352 B**，IRAM 维持 16,384 上限 Remain 0，未破硬线。

## 4. 诚实口径 / deferred

- **无真机 deploy 校验**：meta 打标 → STORE → launch mismatch 拒绝回落 的唯一端到端
  验证依赖接板轮。本刀仅证明宿主 harness 三路径 + 固件编译 + CLI 单测绿。
- emu 哨兵使用预构建图像（§3.5），未加载本刀新固件。
- `lume apps list` 的 mismatch 标注逻辑在 CLI 层由 `queryFirmwareTag` + meta.fw 比较
  覆盖（单测含 FWTAG 查询），但没有真实设备回包集成测试。
- ASCII 纪律：新增串口/CLI 文案均纯 ASCII（已对改动文件做非 ASCII 扫描，无命中）。
- 磁盘：build 产物未入 git（gitignored）；`firmware/sdkconfig` 被 idf.py 自动追加的
  一行 board 注释已 `git restore` 还原；测试临时产物已清理。

## 5. 提交拆分（不推送）

- `feat`: 固件 tag 校验 + FWTAG 命令 + CLI 打标/列表
- `test`: 宿主 harness（fwtag_protocol.c）+ apps_protocol FWTAG + CLI 单测
- `docs`: 本报告 + roadmap r106 result 小节
