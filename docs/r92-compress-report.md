# r92 report — `lume.compress` 原生原语（vendored miniz tinfl 解压）

Baseline: `5cdd0a0` (origin/main, r91 crypto merged), worktree `/tmp/lume-r92-wt`,
branch `r92-compress`. Model guard raw:
`GUARD: settings.json model=hy4flash-free ✓` /
`GUARD: model=hy4flash-free ✓ (settings + runtime audit clean)`.

## 1. 取材决策（先实证，不是假设）

开工前读码确认：

- `firmware/components/lume-crypto/lume_crypto.c:31-64` — `JS_GetTypedArrayBuffer`
  零拷贝视图 helper、ArrayBuffer 保活、subarray 偏移生效、访问期不回调 JS。
- `docs/roadmap.md:806-818` — 契约纪律（0/-码、零拷贝、独立组件、IRAM
  16384 Remain 0、`.d.ts` + doc 生成 + 双桩同步）。
- `docs/roadmap.md:832-834` — 候选 #4「解压优先（压缩 JS 侧用不上）」。
- 仓库无 `lume-compress` 组件、`runtime/types/lume.d.ts` 无 compress 条目。
- **取材调查**：ESP-IDF 的 `components/esp_rom/include/miniz.h` 是 ROM 实现的
  Apache-2.0 声明头（同 `esp_crc32_le` 坑，host harness 用不了）；LVGL 内
  `lodepng.c` 有 inflate 但绑定 malloc/ucvector、侵入大。最终选用本机已有的
  **miniz 3.1.0 单文件 `miniz_tinfl.c`（770 行）+ `miniz_tinfl.h`（150 行）**
  ——Rich Geldreich，public domain/MIT，正是简报点名的「解压专用 tinfl 子集，
  比整份 miniz.c 小一个量级」。未自己实现 inflate 算法，未引入构建依赖。

**决策：vendored 单文件 = miniz 3.1.0 tinfl 解压协程**。把 `miniz_common.h`
+ `miniz_tinfl.h` 的类型/flag/状态/结构体声明收进同一 `.c` 的 prologue，
`tinfl_clear_tree` + `tinfl_decompress`（上游 36-671 行）逐字节原样保留；
主动丢弃 malloc 版高层 helper；固定 `TINFL_USE_64BIT_BITBUF 0` 使 host
(x86_64) 与固件 (Xtensa 32-bit) 走同一代码路径（输出与位宽无关）。来源、授权、
全部修改登记在 `firmware/components/lume-compress/VENDOR.md`。

**API 决策**：照 `lume.fft`/`lume.imgscale`/`lume.crypto` 变体，写入调用方持有的
`Uint8Array out`，返回正数=写入字节数（空流为 0），错误返回负码：
`-1` 类型/format 非法，`-2` 损坏/截断/校验失败的输入流，`-3` out 太小。
**不加 `adler32` 独立原语**：tinfl 的 `TINFL_FLAG_PARSE_ZLIB_HEADER` 已内置
完整 zlib header 校验（`(CMF<<8|FLG)%31==0`、CM=8、FDICT 拒绝）与 Adler-32
校验，再暴露一个无消费方的 API 是多余侵入。契约与校验口径全部写进 `.d.ts`。

## 2. host harness 原始输出

`node tests/compress.js`（Node zlib 生成 fixture，QuickJS 链接**固件同一份**
`lume_compress.c` + vendored tinfl，逐字节比对）:

```
PASS correctness: empty / repetitive text / RLE / random stored / >64KiB dynamic (raw+zlib, byte-exact)
PASS default format (omitted/null) is raw
PASS damaged streams rejected (truncated / bad header / reserved BTYPE / Adler mismatch)
PASS out-too-small -> -3 with no out-of-bounds write
PASS subarray/byteOffset views on src and out with guards intact
PASS error contract: -1 type / -2 data / -3 length, no exceptions
PERF native inflate 200x 111530B: 23ms (sink=22306000, NOT ESP32-S3)
ALL OK
PERF Node zlib.inflateSync baseline 200x 111530B: 40ms (sink=22306000, native C, host only)
FIXTURES raw/zlib sizes: text=69/75B random=70025B big=5391B big-zlib=5397B
```

覆盖：空 payload（0 字节写入）、高重复文本/RLE、随机不可压数据（stored blocks,
70,025 B）、>64 KiB 动态 Huffman（111,530 B 输出 / 5,391 B 压缩）、raw+zlib
双格式逐字节比对；截断流、坏 zlib header、保留 BTYPE=3、坏 Adler-32 各返回负码；
out 太小返回 -3 且视图外守卫字节不变；带非零 byteOffset 的 src/out 双视图；
类型/format/缺参错误路径。native 与 Node zlib 的 `sink` 同为 22,306,000
（=200×111,530），交叉确认两边解压字节数一致。仓内无 pako，按简报回退用
Node zlib 作对照基准；它本身是 native C，**不是 JS 解压实现**，也不代表
ESP32-S3。未用 SHA-256 摘要——逐字节比对是严格强于摘要比对的证据（r91
crypto 的 SHA-256 向量另在其 harness 中验证）。

踩坑记录：`tinfl` 的 `*pOut_buf_size` 是**出参=已写字节数**（见上游
`tinfl_decompress_mem_to_mem`），初版误作「剩余容量」取 `out.length - out_left`
导致空流返回 8；已改为直接返回 `out_left`。`MZ_READ_LE16`/`MZ_ASSERT` 两个上游
宏需一并收进 prologue（首次链接报 undefined reference）。

## 3. 验证套件原始输出

```
$ for t in tests/*.js; do node "$t" || echo FAIL "$t"; done
TESTS_DONE fail=0

$ npm test --prefix tools/lume
1..44
# tests 44
# pass 43
# fail 0
# cancelled 0
# skipped 1
# duration_ms 2052.708775
NPM_TEST_EXIT=0

$ node tools/lume/lume.js check examples/counter --no-emu
[PASS] bundle   2160 bytes (19 ms)
[SKIP] eval     --no-emu
[SKIP] layout   requires emulator screenshot (--no-emu)
[SKIP] perf     profile disabled
RESULT: PASS (4 steps, 0 failed; exit 0)
CHECK_EXIT=0

$ python3 scripts/gen_api_docs.py
wrote website/api.html: 135 API rows, 9 global helpers
$ python3 scripts/gen_api_docs.py --check
api.html is up to date with lume.d.ts (135 entries)
$ python3 scripts/check_website.py
HTML pages: 7; internal href/src and anchors checked
API: 135 catalog entries, 135 type declarations, 32 function namespaces
API missing: none
API invented: none
API duplicates: none
API signatures not found in lume.d.ts: none
```

新 worktree 初次跑全量回归时 `tests/files_dialog.js`/`tests/spectrum.js` 与
`npm test`/`lume check` 报 `Cannot find module esbuild`（r91 报告同款缺依赖）。
`npm ci --prefix tools/lume`（`added 30 packages ... found 0 vulnerabilities`）
后复跑全绿，非代码回归。

## 4. 固件构建与 size

命令（与简报逐字一致，基线/隔离/最终三次同款）:

```
cd /opt/esp/esp-idf && env -u VIRTUAL_ENV IDF_PYTHON_ENV_PATH=/home/ubuntu/.espressif/python_env/idf5.5_py3.12_env bash -c '. ./export.sh >/dev/null 2>&1; cd /tmp/lume-r92-wt/firmware && idf.py build && idf.py size'
```

首次调用在 98%（LVGL 编译）撞上 10 分钟命令上限被 SIGTERM，非 swap 卡死；
重跑增量续编到完成（`BUILD_EXIT=0`，`Project build complete`）。本机 quickjs
目标正常编译，未触发 r78/r82/r91 的 swap 卡死，**未使用 `-g0` 变通**，
未改任何源或优化级别。新组件无 warning（日志中仅既有 LVGL `LV_LOG_LEVEL`
重定义与 `lume_pmic.c` 未用函数告警）。

同 worktree 增量隔离：临时摘掉 `lume_engine.c` 的两行接线与
`lume-engine/CMakeLists.txt` 的 `lume-compress` 依赖 → 编译得到基线，再原样
恢复 → 重编得到最终值（两次最终构建逐项一致）。

基线（未接线）原始：

```
│ Flash Code          │      2029636 │          │                │               │
│ Flash Data          │       850164 │          │                │               │
│ DIRAM               │       247267 │    72.35 │          94493 │        341760 │
│ IRAM                │        16384 │    100.0 │              0 │         16384 │
Total image size: 3021571 bytes (.bin may be padded larger)
```

r92 最终（接线恢复）原始：

```
│ Flash Code          │      2030276 │          │                │               │
│ Flash Data          │       850196 │          │                │               │
│ DIRAM               │       247267 │    72.35 │          94493 │        341760 │
│ IRAM                │        16384 │    100.0 │              0 │         16384 │
│    .text            │        15356 │    93.73 │                │               │
│    .vectors         │         1028 │     6.27 │                │               │
Total image size: 3022243 bytes (.bin may be padded larger)
lume.bin binary size 0x2e1e20 bytes. Smallest app partition is 0x640000 bytes. 0x35e1e0 bytes (54%) free.
```

| metric | baseline (unwired) | r92 final | delta |
|---|---|---|---|
| Flash Code (`.text`) | 2,029,636 | 2,030,276 | **+640** |
| Flash Data (`.rodata`+`.appdesc`) | 850,164 | 850,196 | +32 |
| DIRAM | 247,267 | 247,267 | 0 |
| IRAM | 16384 / 16384, Remain 0 | 16384 / 16384, Remain 0 | 0 |
| Total image | 3,021,571 | 3,022,243 | +672 |

IRAM 硬线未破：used 恒为 16384、Remain 恒为 0。新增代码全在 flash
`.text/.rodata`；DIRAM 无增量（解压器状态 `tinfl_decompressor` 在调用栈上，
函数调用期存活，无新静态缓冲）。注意 r91 报告的 post 值 2,031,220 与本
worktree 的未接线基线 2,029,636 相差 -1,584（r91 分支 tip 与 origin/main
merge 的内容差），故增量以**同 worktree 隔离实测**为准，不直接跨报告相减。

## 5. 同步面

新增 `firmware/components/lume-compress/{CMakeLists.txt,include/lume_compress.h,
lume_compress.c,miniz_tinfl.c,VENDOR.md}`；`lume-engine/CMakeLists.txt` 加
`lume-compress` 依赖，`lume_engine.c` 注册 `lume_compress_register`；
`runtime/types/lume.d.ts` 加 `lume.compress.inflate` 契约（135 条 API，
+1）；重生成 `website/api.html`；`website/playground/runtime.js` 与
`tests/lib/prelude_runner.js` 加 `lume.compress` unsupported 桩（-3 +
onWarn，可 `options.compress` 注入，照抄 r91 crypto 模式）；host harness
`tests/compress.js`、`tests/compress_host.c`、`tests/lib/compress_cases.js`。
未改 quickjs-ng / lvgl / 任何 IDF 源码。构建产生的 `firmware/sdkconfig`
单行噪声已 `git restore`；`artifacts/r92/` 临时 fixture 已清理（harness
修正了 `process.exit` 绕过 `finally` 导致 scratch 残留的问题）。

## 6. deferred acceptance

见 `docs/KNOWN-SIMPLIFICATIONS.md` r92 节与 roadmap r92 result。本轮无 UI
改动，未跑 emu（纯计算原语，不需要三件套拷贝）。
