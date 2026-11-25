# r85 `lume.image.decode` 像素出口 + image_gallery 缩略战报

基线 `7f902d6`（`origin/main`，r84 imgscale 已合入）；分支 `r85-imgpix`，
只在 `/tmp/lume-r85-wt` 操作；未推送、未做板上验收。

开工前核对原始输出：

```text
$ bash /home/ubuntu/.hermes/scripts/lume_model_guard.sh
GUARD: settings.json model=hy4flash-free ✓
GUARD: model=hy4flash-free ✓ (settings + runtime audit clean)

$ git -C /tmp/lume-r85-wt log --oneline -1
7f902d6 docs: r84 imgscale report, roadmap result and API/simplification notes
```

## 先实证：简报与代码的差异（以代码为准）

1. **解码出口确实缺失**：`js_image_size_of` / `js_image_set_source` 在
   `lume_engine.c:681` / `:695`；`lume.image` 只挂了 `sizeOf` 与 `_setSource`。
   `lume_image_decode_ex`（`lume_image.c:36`）只被 `_setSource` 调用，JS 侧无出口。
2. **字节序/内存布局**：简报写「RGB565」，但原生 PNG 路径实际输出
   RGB565A8（`lume_image.c:66` 调 `lume_image_rgba_to_rgb565a8`，3 B/px：
   颜色面 `v&255, v>>8` 在前，A8 面在后），JPEG 路径才是 2 B/px 纯 RGB565。
   因此绑定只拷颜色面进 Uint16Array，A8 面丢弃（已登记简化项）。
3. **错误码**：简报写 -1/-2，但 `lume_image_decode_ex` 在 PSRAM 分配失败时
   返回 -3（`lume_image.c:58`、`:79`），SVG 路径另有码。绑定选择原样透传，
   不折叠成 -2；`.d.ts` 与文档按 -1/-2/-3 如实登记。
4. **480x480 上限**已由 `lume_image_size_of`（`lume_image_header.c:41`）强制，
   无需在绑定里重复实现，`decode` 自动继承。
5. **缩略展示通道**：`Image()` 只接受 PNG/JPEG 字节（`lume_scripts.c:946`），
   没有原生 RGB565 入口。缩略图必须走 r81 的 `ctx.retainImage/drawImage`
   Canvas 路径，不能塞回 `Image()`。
6. **r84 没有可复用的 C 缩放核心**：`lume_imgscale.c` 的循环与 JS 视图校验、
   重叠判定耦合。本轮把逐像素采样抽成 `lume_imgscale_pixels`（新共享头
   `include/lume_imgscale.h`），JS 绑定与 decode 都调它；原重叠规则仍留在 JS
   视图层，decode 的输出是新建 JS 缓冲，不会与源 PSRAM 缓冲重叠。

## 实现与契约

- 新文件 `firmware/components/lume-engine/lume_image_decode.c`（命名对齐
  `lume_imgscale.c`），`lume_image_decode_register(ctx, image)` 在
  `register_bindings()` 里挂到 `lume.image`；`CMakeLists.txt` 追加 SRCS。
  未改 prelude、ui-bridge、帧协议、vendored 源码。
- `decode(bytes, maxW?, maxH?)`：输入仅接受 ArrayBuffer（与 `sizeOf` 一致）；
  两个目标维度必须同时给出或同时省略，单给一个返回 -1；维度为整数
  1..16384（分数/超范围 -2，coercion 抛错 -1），与 r84 同口径。
- 解码后颜色面 `memcpy` 进 `JS_NewArrayBufferCopy` 创建的 JS 堆缓冲，再以
  `JS_NewTypedArray(..., JS_TYPED_ARRAY_UINT16)` 做视图；PSRAM 解码面在返回前
  `heap_caps_free`（host harness 用 `free` shim）。带目标尺寸时直接把源
  RGB565 指针喂给共享核心，输出到目标尺寸缓冲，不产生中间 JS 视图。
- 返回对象 `{width, height, pixels}`；失败返回负码。`lume.imgscale.scale`
  与 `ctx.retainImage` 都可直接消费 `pixels`。
- `.d.ts` 补签名，`gen_api_docs.py` 重生成 `website/api.html`（130 条），
  `website/playground/runtime.js` 与 `tests/lib/prelude_runner.js` 双桩同步
  （照 r84 imgscale 双桩先例；无真实编解码器，返回确定性 RGB565 图案）。
- `examples/image_gallery`：TF 图片走 decode -> 96x96 -> `thumbnailTile()`
  内的 `retainImage(1, w, h, pixels)` / `drawImage(1, 0, 0)`（每个 Canvas 独立
  槽 1，只上传一次）；解码失败或非 ArrayBuffer 回退原 `Image()` 直显，无卡
  回退内嵌 1x1 红色 PNG。保留原 try/catch 与 `lume.system.log` 埋点。
  像素类型检查用 `Object.prototype.toString.call(...) === '[object Uint16Array]'`，
  兼容 host 跨 realm 桩；点按看大图未做（可选，已登记）。

## 取舍

- PNG 丢弃 A8 面；需要透明走 `Image()` 原生路径。
- 缩略固定 nearest，未暴露 mode；需 bilinear 时调用方另调 `imgscale.scale`。
- `-3` PSRAM OOM 透传，不伪装成 -2；`maxW/maxH` 的单参数组合视为参数错误。
- 缩略展示用 Canvas 精灵槽而非 `Image()`，因为后者无像素入口；每 Canvas
  的精灵槽 1..8 与 460,800 B 预算沿用 r81 口径。
- gallery 点按看大图、TF 卡实际读取成功率、PSRAM 峰值、画质均留待接板。
- 详细登记见 `docs/KNOWN-SIMPLIFICATIONS.md`（r85 小节）。

## 宿主 harness 原始输出

`node tests/decode.js`（宿主 QuickJS-NG 直链同一份
`lume_image_decode.c` + `lume_imgscale.c` + `lume_image_pixels.c`；
`tests/decode_host.c` 用 zlib inflate + PNG unfilter 实现最小编解码 shim，
喂给真实 RGB565A8 转换函数；测试素材为手工字节 1x1/2x2 PNG，无第三方依赖）：

```text
PASS 1x1 PNG -> {1,1,Uint16Array(1)}, red 0xf800, LE bytes 00 f8
PASS 2x2 PNG exact RGB565 0xf800 0x07e0 0x001f 0xffff; A8 plane discarded
PASS decode 2x2 -> 4x4 nearest + -> 1x1 centre tap
PASS decode pixels fed into lume.imgscale.scale, bits preserved
PASS error codes -1/-2 (type, dimensions, 480 cap, corrupt input)
```

- 覆盖：对象形状/Uint16Array 类型、RGB565 精确位模式与小端字节序、A8 面丢弃、
  可选缩放（含 1x1 中心抽点）、decode -> imgscale 串联、-1/-2、-3 不可达
  （host shim 不模拟 PSRAM OOM）。
- r84 `node tests/imgscale.js` 在抽出共享核心后原样回归：

```text
PASS nearest 2x upsample, exact RGB565 bits: 0xf800 0xf800 0x07e0 0x07e0 ...
PASS nearest 2x downsample, centre taps = 0x0006 0x0008 0x000e 0x0010
PASS bilinear hand case 3x1->2x1 = 0xb800 0x05e0
PASS bilinear 2x2->3x3, centre=0x8410 (channel separation)
PASS bilinear 5x4->9x7 reference + omitted-mode defaults to nearest
PASS subarray offset views, guards intact
PASS error codes -1/-2 and identical-view in-place allowance
PERF 64x64->128x128 bilinear mean over 200 calls: JS=18.0400 ms native=0.3900 ms (host single sample; not ESP32-S3)
```

- `for t in tests/*.js; do node "$t" || echo FAIL "$t"; done`：退出 0，
  493 行 / 458 条 `PASS`/`ALL`，`^FAIL` 0；完整输出见
  [host-tests.log](../artifacts/r85/host-tests.log)。新增 harness 的 host 直链
  编译需要引擎 include 路径（`lume_imgscale.h`），已在 `tests/imgscale.js`
  与 `tests/decode.js` 的编译参数中补 `-I`。
- `npm test --prefix tools/lume` 尾部原始输出：

```text
1..44
# tests 44
# suites 0
# pass 43
# fail 0
# cancelled 0
# skipped 1
# todo 0
# duration_ms 2068.172917
```

- `lume check` 回归哨兵与演示刀（按 r64 坑预置镜像，`EMU_SKIP_BUILD=1`；
  本轮直接从 worktree 刚构建的 `firmware/build/` 取三件套）：

```text
$ EMU_SKIP_BUILD=1 node tools/lume/lume.js check examples/counter
[PASS] bundle   2160 bytes (37 ms)
[PASS] eval     2x "app eval ok; entering event loop"
[PASS] layout   R1 PASS  R2 PASS  R3 PASS  R4 PASS  R5 PASS  R6 PASS  R7 PASS
[SKIP] perf     profile disabled
screenshot: artifacts/check/counter/tft.png
RESULT: PASS (4 steps, 0 failed; exit 0)

$ EMU_SKIP_BUILD=1 node tools/lume/lume.js check examples/image_gallery
[PASS] bundle   2312 bytes (21 ms)
[PASS] eval     2x "app eval ok; entering event loop"
[SKIP] layout   no layout expectations for image_gallery
[SKIP] perf     profile disabled
screenshot: artifacts/check/image_gallery/tft.png
RESULT: PASS (4 steps, 0 failed; exit 0)
```

- gallery 缩略路径的 host stub 冒烟（把 `Fs.readBinary` 打成返回 70 B
  ArrayBuffer，经 `runApp` 跑 app.js）：3 个 `Canvas` 节点（kind 3）创建，
  无 fatal 文本；内嵌 PNG 的 `Image` 在 host 桩因 `sizeOf` 恒 -1 不建节点，
  属桩行为，不影响真机路径。

```text
create count: 8 kinds: 3,3,3,1,1,1,0,0
canvas creates: [["create",1,3,0,96,96],["create",2,3,0,96,96],["create",3,3,0,96,96]]
fatal: false
eval ok, messages: 54
```

- 文档检查原始输出：

```text
$ python3 scripts/gen_api_docs.py --check
api.html is up to date with lume.d.ts (130 entries)

$ python3 scripts/check_website.py
HTML pages: 7; internal href/src and anchors checked
API: 130 catalog entries, 130 type declarations, 30 function namespaces
API missing: none
API invented: none
API duplicates: none
API signatures not found in lume.d.ts: none
```

## 固件构建与尺寸

命令为简报指定的 ESP-IDF v5.5 环境。首次标准构建在前台 10 分钟限制内推进到
97%（LVGL 链接完成），`quickjs.c.obj` 仍未生成——与 r78/r82/r84 同款 host
swap 卡死。按先例只从 `compile_commands.json` 取该目标原命令，末尾追加 `-g0`
单独重编（`QUICKJS_G0_EXIT= 0`），再跑原构建命令成功。未改任何 vendored 或
工程源码的编译选项。

最终 `idf.py build` / `idf.py size` 关键原始输出：

```text
[100%] Built target lume.elf
[100%] Built target gen_project_binary
lume.bin binary size 0x2e07e0 bytes. Smallest app partition is 0x640000 bytes. 0x35f820 bytes (54%) free.
[100%] Built target app_check_size
[100%] Built target app
Built target size
                            Memory Type Usage Summary
┏━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━┳━━━━━━━━━━┳━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━┓
┃ Memory Type/Section ┃ Used [bytes] ┃ Used [%] ┃ Remain [bytes] ┃ Total [bytes] ┃
┡━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━╇━━━━━━━━━━╇━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━┩
│ Flash Code          │      2025296 │          │                │               │
│    .text            │      2025296 │          │                │               │
│ Flash Data          │       849476 │          │                │               │
│    .rodata          │       849220 │          │                │               │
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
Total image size: 3016543 bytes (.bin may be padded larger)
```

对比 r84 基线（见 `r84-imgscale-report.md`）：Flash Code 2,024,560 ->
**2,025,296 B（+736 B）**；Flash Data 849,428 -> 849,476（+48 B）；
DIRAM 247,267 不变；**IRAM 16,384/16,384、Remain 0 硬线守住**，新代码未进 IRAM。

新/改对象的 `xtensa-esp32s3-elf-size -A`（调试段略）：

```text
lume_image_decode.c.obj: .text 136+570+46=752  .literal 40+100+16=156  .rodata 23+7=30
lume_imgscale.c.obj:     .text 118+136+877+434+78=1643  .literal 16+40+24+80+28=188  .rodata 17+17=34
```

即 decode 自身约 938 B 代码+常量；imgscale 抽出共享核心后从 r84 的
2002 B（.text 1788 + .literal 180 + .rodata 34）降到约 1865 B，链接增量另含
注册代码与库调用。两个对象 `.data/.bss` 均为 0。完整日志见
[firmware-build-final.log](../artifacts/r85/firmware-build-final.log)。

## 未做与待真机验证

- gallery 点按看大图未做（可选）；缩略图未做 bilinear 质量控制。
- PSRAM/JS 堆峰值、GC 时序、TF 卡 <=64 KiB 读取成功率、缩略解码耗时、
  retainImage 串联吞吐、bundle 推送、AMOLED 观感与触摸手感均 pending board。
- host、浏览器桩与固件 `idf.py size` 绿均不代表板上验收。
