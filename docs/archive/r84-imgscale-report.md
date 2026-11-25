# r84 `lume.imgscale` RGB565 缩放原语战报

基线 `fc2534d`（`origin/main`，r83 scroller 已合入）；分支 `r84-imgscale`，
只在 `/tmp/lume-r84-wt` 操作；未推送、未做板上验收。

开工前核对原始输出：

```text
$ git -C /tmp/lume-r84-wt log --oneline -1
fc2534d Merge r83-scroll: sprite scroller app + playground registration

$ bash /home/ubuntu/.hermes/scripts/lume_model_guard.sh
GUARD: settings.json model=hy4flash-free ✓
GUARD: model=hy4flash-free ✓ (settings + runtime audit clean)
```

## 实现与契约

- 按 r82 `lume_fft.c` 先例，新原语放在 `firmware/components/lume-engine/lume_imgscale.c`，
  由 `lume_engine.c` 的 `register_bindings()` 末尾 `extern void lume_imgscale_register(...)`
  注册 `lume.imgscale`；CMakeLists 的 `SRCS` 追加同名文件。未改 prelude、ui-bridge、
  vendored 源码（quickjs-ng / lvgl）。
- `scale(src, sw, sh, dst, dw, dh, mode?)`：`Uint16Array` 视图经
  `JS_GetTypedArrayBuffer` 零拷贝取得，`subarray()` 偏移自动生效；指针存活期间不回调 JS。
  `mode` 省略或 `undefined` 时为 `'nearest'`，`'bilinear'` 逐分量插值，其他值 -1。
- 返回 0 成功；-1 参数/类型/mode；-2 尺寸无效、视图过短、buffer 部分重叠；
  -3 为内部失败保留码（当前实现无可达路径）。维度为整数 1..16384；分数维度
  拒绝而非截断（不同于 `JS_ToInt32` 默认行为）。
- RGB565 按 R5/G6/B5 分开插值再用 `(r<<11)|(g<<5)|b` 合成，8-bit 定点权重
  （1/256），加 32768 后 `>>16` 四舍五入；源坐标先 clamp 到 `[0, size-1]`
  再取整，边缘不越界。从未把打包 16-bit 当整数插值。纯采样，不处理
  0x0000 透明/颜色 key（取舍见下）。
- 同 backing buffer 检测：仅当字节范围完全相同且 `sw==dw && sh==dh` 时允许
  原地拷贝（此时 bilinear 的 fx=fy=0，每个输出只采样自身输入，安全）；其余
  任何范围重叠 -2。`dst` 可与 `src` 长度不同，只要各自 grid 放得进视图。
- `.d.ts`、生成的 `website/api.html`（129 行）、host `tests/lib/prelude_runner.js`
  与 `website/playground/runtime.js` 桩同步；两个桩都是与 C 同算法的纯 JS 实现。

## 契约取舍

- **写调用方 Uint16Array 而非 Canvas work buffer**：路线清单原文写「写 Canvas
  work buffer（r79 模式）」；本轮按任务契约采用 typed-array 进 / typed-array 出，
  缩放结果直接喂 `ctx.retainImage(slot, dw, dh, dst)`（r81 精灵管线，RGB565、
  0x0000 透明、8 槽/画布、460,800 字节预算）。无需新渲染通道，也不碰 ui-bridge。
- **bilinear 无透明/颜色 key 特殊处理**：纯逐像素采样；透明语义继续由
  `retainImage` / `drawImage` 层负责。已登记 `docs/KNOWN-SIMPLIFICATIONS.md`。
- 两项均已跟进 `docs/hardware-api.md`。

## 宿主 harness 原始输出

`node tests/imgscale.js`（宿主 QuickJS-NG 链接**同一份** `lume_imgscale.c`，
另加 `tests/imgscale_host.c` runner；本次独立、无固件构建并行）：

```text
PASS nearest 2x upsample, exact RGB565 bits: 0xf800 0xf800 0x07e0 0x07e0 ...
PASS nearest 2x downsample, centre taps = 0x0006 0x0008 0x000e 0x0010
PASS bilinear hand case 3x1->2x1 = 0xb800 0x05e0
PASS bilinear 2x2->3x3, centre=0x8410 (channel separation)
PASS bilinear 5x4->9x7 reference + omitted-mode defaults to nearest
PASS subarray offset views, guards intact
PASS error codes -1/-2 and identical-view in-place allowance
PERF 64x64->128x128 bilinear mean over 200 calls: JS=17.8550 ms native=0.4000 ms (host single sample; not ESP32-S3)
```

- 2x 上采样 `[R,G;B,W] -> 4x4` 与 2x 下采样 `4x4 -> [6,8,14,16]` 均按
  Uint16 位模式精确比对，另与 JS 参考实现逐位一致。
- bilinear 手算：3x1 `[红,黑,绿] -> 2x1`，`sx(0)=0.25`、`sx(1)=1.75`，
  `out0.R=round(0.75*31)=23 -> 0xB800`，`out1.G=round(0.75*63)=47 -> 0x05E0`；
  2x2 `[R,G;B,W] -> 3x3` 中心四像素各 0.25，
  `R=(31+0+0+31)/4=16`、`G=(0+63+0+63)/4=32`、`B=(0+0+31+31)/4=16 -> 0x8410`，
  证明逐分量而非整字插值。
- 性能为单次宿主样本（200 次均值），**不代表 ESP32-S3**；并行宿主负载会显著影响数值。

`for t in tests/*.js; do node "$t" || echo FAIL "$t"; done`：退出 0，原始输出
488 行（453 行以 `PASS`/`ALL` 开头，`^FAIL` 计数 0）；完整输出见
[host-tests.log](../artifacts/r84/host-tests.log)。首次运行时因 worktree 缺
`tools/lume/node_modules` 导致 `tests/files_dialog.js`、`tests/spectrum.js`
`MODULE_NOT_FOUND`；从主仓软链依赖后全量归零，与实现无关。

`node tools/lume/lume.js check examples/counter`（emu 步骤按 r64 坑用
`EMU_SKIP_BUILD=1` + 从 r83 worktree 预置 bootloader/partition-table/lume 三件套；
不设该变量时 emu 会重编 LVGL 并在 120s 超时）：

```text
lume check examples/counter

[PASS] bundle   2160 bytes (22 ms)
[PASS] eval     2x "app eval ok; entering event loop"
[PASS] layout   R1 PASS  R2 PASS  R3 PASS  R4 PASS  R5 PASS  R6 PASS  R7 PASS
[SKIP] perf     profile disabled

screenshot: artifacts/check/counter/tft.png
RESULT: PASS (4 steps, 0 failed; exit 0)
```

`npm test --prefix tools/lume` 尾部原始输出：

```text
1..44
# tests 44
# suites 0
# pass 43
# fail 0
# cancelled 0
# skipped 1
# todo 0
# duration_ms 2341.041985
```

两个 JS 桩的 bit 一致性检查（host `runApp` 与 browser `LumePlaygroundSession`
各跑一遍同一手算 case）：

```text
HOST stub: 0 b800 5e0
BROWSER stub messages: [["gesture",0],["attr",1,1,"0,b800,5e0"]]
BROWSER stub result: 0,b800,5e0
```

`python3 scripts/gen_api_docs.py --check` 与 `python3 scripts/check_website.py`
原始输出：

```text
api.html is up to date with lume.d.ts (129 entries)
HTML pages: 7; internal href/src and anchors checked
API: 129 catalog entries, 129 type declarations, 30 function namespaces
API missing: none
API invented: none
API duplicates: none
API signatures not found in lume.d.ts: none
```

## 固件构建与尺寸

命令为简报指定的 ESP-IDF v5.5 环境、`idf.py build` 与 `idf.py size`。首次标准构建
到 ldgen 阶段报 `quickjs.c.obj: file format not recognized`；检查发现该文件为
**0 字节**（host swap 卡死导致编译被杀，与 r78/r82 同款）。按先例仅对 build 目录中
QuickJS 目标以原命令（`-ggdb -O2`，`compile_commands.json` 原文）末尾追加 `-g0`
单独重编，再跑原构建命令成功。未改任何 vendored 或工程源码编译选项。

```text
gcc exit 0
-rw-rw-r-- 1 ubuntu ubuntu 2791736 Nov 17 20:19 firmware/build/esp-idf/quickjs-ng/CMakeFiles/__idf_quickjs-ng.dir/quickjs.c.obj
```

最终构建尾部原始输出：

```text
[100%] Built target lume.elf
[100%] Built target gen_project_binary
lume.bin binary size 0x2e04e0 bytes. Smallest app partition is 0x640000 bytes. 0x35fb20 bytes (54%) free.
[100%] Built target app_check_size
[100%] Built target app
Built target size
```

最终 `idf.py size` **全表原始输出**：

```text
                            Memory Type Usage Summary
┏━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━┳━━━━━━━━━━┳━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━┓
┃ Memory Type/Section ┃ Used [bytes] ┃ Used [%] ┃ Remain [bytes] ┃ Total [bytes] ┃
┡━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━╇━━━━━━━━━━╇━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━┩
│ Flash Code          │      2024560 │          │                │               │
│    .text            │      2024560 │          │                │               │
│ Flash Data          │       849428 │          │                │               │
│    .rodata          │       849172 │          │                │               │
│    .appdesc         │          256 │          │                │               │
│ DIRAM               │       247267 │    72.35 │          94493 │        341760 │
│    .bss             │       121960 │    35.69 │                │               │
│    .text            │       101679 │    29.75 │                │               │
│    .data            │        23628 │     6.91 │                │               │
│ IRAM                │        16384 │    100.0 │              0 │         16384 │
│    .text            │        15356 │    93.73 │                │               │
│    .vectors         │         1028 │     6.27 │                │               │
│ RTC FAST            │           72 │     0.88 │           8120 │          8192 │
│    .text            │           44 │     0.54 │                │               │
│    .rtc_reserved    │           24 │     0.29 │                │               │
│    .force_fast      │            4 │     0.05 │                │               │
│ RTC SLOW            │           32 │     0.39 │           8160 │          8192 │
│    .force_slow      │           32 │     0.39 │                │               │
└─────────────────────┴──────────────┴──────────┴────────────────┴───────────────┘
Total image size: 3015759 bytes (.bin may be padded larger)
```

为测同配置增量，在本 worktree 临时将 `CMakeLists.txt`、`lume_engine.c` 恢复为
`fc2534d` 内容并移走 `lume_imgscale.c`，增量构建并取 `idf.py size`，随后恢复 r84
文件并重新构建、取尺寸。fc2534d 基线 **Flash Code 2,022,792 B**，
r84 **2,024,560 B**，差 **+1,768 B**；对比 r82 报告基线 **2,021,336 B** 为
**+3,224 B**（其中含 r83 的 app 层增量，非全部归 imgscale）。基线与 r84 的
DIRAM 都是 247,267 B，IRAM 都是 **16,384/16,384 B，Remain 0**，
未突破硬线。基线完整原始表见
[baseline-build-size.log](../artifacts/r84/baseline-build-size.log)，
最终完整日志见 [firmware-build-final.log](../artifacts/r84/firmware-build-final.log)。

新 `.c` 自身的体量（`xtensa-esp32s3-elf-size -A`，按 r82 报告口径单列）：

```text
.literal.u16_view                          16      0
.literal.read_dim                          40      0
.literal.imgscale_scale                    96      0
.literal.lume_imgscale_register            28      0
.text                                       0      0
.data                                       0      0
.bss                                        0      0
.text.u16_view                            118      0
.text.read_dim                            136      0
.rodata.imgscale_scale.str1.4              17      0
.text.imgscale_scale                     1456      0
.rodata.lume_imgscale_register.str1.4      17      0
.text.lume_imgscale_register               78      0
```

即 `.text` 1788 B + `.literal` 180 B + `.rodata` 34 B = **2002 B**，
`.data`/`.bss` 为 0，无 IRAM 段；链接增量另含注册代码与库调用。

## 未做与待真机验证

可选消费方 demo（`examples/image_gallery` 缩略路径）本轮未加，留待下轮接入。
缩放调用耗时、缩略图视觉质量、与 `retainImage` 串联的实际吞吐、大图 PSRAM
余量、bundle 推送、以及真机帧率/触摸/色彩均 pending board。host、浏览器、
固件构建结果均不代表板上验收。
