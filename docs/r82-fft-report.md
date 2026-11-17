# r82 `lume.fft` 原生 FFT 战报

基线：`ac7799e`（`origin/main`），实施分支 `r82-fft`，只在 `/tmp/lume-r82-wt` 操作；未推送、未做板上验收。

## 实现与契约

- 按 r78 `lume_math.c` 先例，新原语放在 `firmware/components/lume-engine/lume_fft.c`，由 `register_bindings` 注册 `lume.fft`，不修改 prelude 或 vendored 源码。
- `realfft(re, out?)` 接受 2–4096 点、长度为 2 的幂的 `Float32Array`。正向 FFT **不归一化**；省略 `out` 时原地写入，提供时要求长度恰为 N。结果用 N 个 float 打包为 `[DC, Nyquist, Re(1), Im(1), …, Re(N/2−1), Im(N/2−1)]`。返回 0；非 Float32Array 为 -1；长度无效为 -2；虚部 scratch 分配失败为 -3。
- `magnitude(out, re, im?)` 输出 N/2 个非负幅度，bin 0 到 N/2−1，**不包括 Nyquist**。省略 `im` 时读取上述打包格式；提供 `im` 时 `re`、`im` 各须 N/2 项。`out` 必须恰为 N/2 项且不得与输入视图重叠。返回 0；类型错误 -1；长度或重叠错误 -2。
- 用迭代 radix-2 DIT 蝶形、逐次位反转、每层旋转因子递推。先跑 N 点复数 FFT（虚部初始为 0），再原地打包实数输入的半谱；**未做 N/2 点实数打包优化，也未放置静态位反转表**。虚部 scratch 最多 16 KiB，在堆上分配，避免占用任务栈。`JS_GetTypedArrayBuffer` 获取含偏移视图的 backing store，无 JS↔C backing store 复制；提供 `out` 时用一次 `memmove` 将输入放入输出。指针存活期间不回调 JS。`out` 与输入视图即使部分重叠也由 `memmove` 处理。
- `.d.ts`、生成的 `website/api.html`、host prelude runner 和浏览器 playground stub 均同步。浏览器 stub 为纯 JS 同契约 FFT。现有 `examples/spectrum` 是麦克风示例；本轮未新增可选合成正弦 demo。

## 原始验证输出

`node tests/fft.js`（宿主 QuickJS-NG 链接**同一份** `lume_fft.c`，本次独立、无固件构建并行）：

```text
PASS 8/16-point known DFT, Float32 bit patterns, packed magnitude
PASS 1kHz peak bin 64/1024 and Parseval
PASS 4096-point inclusive upper bound
PASS offset views, guards, split magnitude
PASS error codes for type, length, non-power-of-two, limit, overlap
PERF 1024-point mean over 1000 calls: JS butterflies=2.0930 ms native=0.0270 ms (host single sample; not ESP32-S3)
```

8/16 点冲激的已知 DFT 按 Float32 位模式比较，另对非平凡样本与直接 DFT 数值比较；正弦峰值与 Parseval 均通过。性能每种 1000 次取每次均值，是单次宿主样本，**不代表 ESP32-S3**。全量测试与固件并行时曾得到 JS 10.4160 ms / native 0.1080 ms，显示宿主负载会影响结果。

`for t in tests/*.js; do node "$t" || exit 1; done`：退出码 0，原始输出 466 行（其中 432 行以 `PASS` 或 `ALL` 开头）；完整输出见 [host-tests.log](../artifacts/r82/host-tests.log)。`npm test --prefix tools/lume` 的尾部原始输出：

```text
1..44
# tests 44
# suites 0
# pass 43
# fail 0
# cancelled 0
# skipped 1
# todo 0
# duration_ms 8446.622038
```

`node tools/lume/lume.js check examples/counter --no-emu`：

```text
lume check examples/counter

[PASS] bundle   2160 bytes (93 ms)
[SKIP] eval     --no-emu
[SKIP] layout   requires emulator screenshot (--no-emu)
[SKIP] perf     profile disabled

RESULT: PASS (4 steps, 0 failed; exit 0)
```

网页 stub 分别通过 host `runApp` 和浏览器 `LumePlaygroundSession` 的 8 点冲激调用；`python3 scripts/gen_api_docs.py` 输出 `wrote website/api.html: 128 API rows, 9 global helpers`，其 `--check` 原始输出：

```text
api.html is up to date with lume.d.ts (128 entries)
```

`python3 scripts/check_website.py` 原始输出：

```text
HTML pages: 7; internal href/src and anchors checked
API: 128 catalog entries, 128 type declarations, 29 function namespaces
API missing: none
API invented: none
API duplicates: none
API signatures not found in lume.d.ts: none
```

## 固件构建与尺寸

命令为简报指定的 ESP-IDF v5.5 环境、`idf.py build` 与 `idf.py size`。首次标准构建到 97% 时 QuickJS 调试信息汇编持续换页数分钟；依 r78 先例，仅对 **build 目录中的 QuickJS 目标**以同一 `-O2` 加末尾 `-g0` 单独编译，然后原命令 `idf.py build` 成功。未改任何 vendored 或工程源码编译选项。最终构建尾部原始输出：

```text
[100%] Linking CXX executable lume.elf
[100%] Built target lume.elf
[100%] Generating binary image from built executable
esptool.py v4.13.0
Creating esp32s3 image...
Merged 3 ELF sections
Successfully created esp32s3 image.
Generated /tmp/lume-r82-wt/firmware/build/lume.bin
[100%] Built target gen_project_binary
lume.bin binary size 0x2df1f0 bytes. Smallest app partition is 0x640000 bytes. 0x360e10 bytes (54%) free.
[100%] Built target app_check_size
[100%] Built target app
```

`idf.py size` **全表原始输出**：

```text
                           Memory Type Usage Summary                            
┏━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━┳━━━━━━━━━━┳━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━┓
┃ Memory            ┃              ┃          ┃                ┃               ┃
┃ Type/Section      ┃ Used [bytes] ┃ Used [%] ┃ Remain [bytes] ┃ Total [bytes] ┃
┡━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━╇━━━━━━━━━━╇━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━┩
│ Flash Code        │      2021336 │          │                │               │
│    .text          │      2021336 │          │                │               │
│ Flash Data        │       847828 │          │                │               │
│    .rodata        │       847572 │          │                │               │
│    .appdesc       │          256 │          │                │               │
│ DIRAM             │       239043 │    69.94 │         102717 │        341760 │
│    .bss           │       113736 │    33.28 │                │               │
│    .text          │       101679 │    29.75 │                │               │
│    .data          │        23628 │     6.91 │                │               │
│ IRAM              │        16384 │    100.0 │              0 │         16384 │
│    .text          │        15356 │    93.73 │                │               │
│    .vectors       │         1028 │     6.27 │                │               │
│ RTC FAST          │           72 │     0.88 │           8120 │          8192 │
│    .text          │           44 │     0.54 │                │               │
│    .rtc_reserved  │           24 │     0.29 │                │               │
│    .force_fast    │            4 │     0.05 │                │               │
│ RTC SLOW          │           32 │     0.39 │           8160 │          8192 │
│    .force_slow    │           32 │     0.39 │                │               │
└───────────────────┴──────────────┴──────────┴────────────────┴───────────────┘
Total image size: 3010935 bytes (.bin may be padded larger)
Note: The reported total sizes may be smaller than those in the technical 
reference manual due to reserved memory and application configuration. The total
flash size available for the application is not included by default, as it 
cannot be reliably determined due to the presence of other data like the 
bootloader, partition table, and application partition size.
```

为测同配置增量，在本 worktree 临时将 `lume_engine.c` 与 CMakeLists 恢复为 `ac7799e` 内容，增量构建并取 `idf.py size`，随后在 `finally` 恢复 r82 文件并重新构建、取尺寸。基线 Flash Code **2,018,884 B**，r82 **2,021,336 B**，差 **+2,452 B**（低于 4 KiB）；基线与 r82 IRAM 都是 **16,384/16,384 B，Remain 0**。`lume_fft.c.obj` 的 `.text`、`.literal`、`.rodata` 共 2,269 B，无 IRAM 段；最终链接增量包括注册代码与库调用。基线和恢复后的完整原始表分别见 [baseline-size.log](../artifacts/r82/baseline-size.log)、[restored-size.log](../artifacts/r82/restored-size.log)。

## 待真机验证

FFT 调用耗时、最大 4096 点时的堆余量、频谱 UI 使用效果，以及音频/录音/VAD 上层接入均 pending board。当前 host、浏览器和固件构建结果不代表板上验收。
