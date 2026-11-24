# r183 — 固件 SVG 光栅结果缓存

基线 `origin/main 674684a`（2026-11-24，r182-luna 合并后的 fw-sync 提交）。全部证据来自编译器 / 宿主 gcc / esp32sim；**未连接真机，真机帧时间、PSRAM 水位、触摸与功耗全部 deferred**。

## 1. 结论速览

| 项 | 结果 |
|---|---|
| `idf.py build` | 绿 |
| `idf.py size` IRAM | **16384 / Remain 0**（硬线保持） |
| `idf.py size` DIRAM | 247,699 B（r181 为 247,531 B，**+168 B**，仅 4 条静态元数据；光栅在 SPIRAM） |
| esp32sim A/B bench | 两字形首次 268/229 ms（对齐 r180 的 268/228），后续全部 1 ms、rc=0 |
| `lume check examples/abc123` | **PASS**（bundle 42,574 B，2× `app eval ok`） |
| 宿主 C 单测 | hit/miss/逐出/内容变化/尺寸键/容量上限/reset 全绿，allocs=36 frees=36 live=0 |
| 全量 host harness | **103 PASS / 0 FAIL** |
| `npm test --prefix tools/lume` | 51 pass / 0 fail / 1 skipped |

## 2. 先实证再选型

### 2.1 像素所有权：选 memcpy-on-hit，不引用计数

读 `firmware/components/lume-ui-bridge/lume_ui_bridge.c` 确认：

- `apply_image_source()`（L895–915）：把 `m->image_pixels` 存进 `s_image_pixels[id]`，作为 LVGL image data 安装，并 `heap_caps_free(old)` 释放上一帧缓冲；节点校验失败时 L897 直接 `heap_caps_free(m->image_pixels)`。
- `release_dead_images()`（L89–99）：节点死亡时 `lv_image_cache_drop` + `heap_caps_free(s_image_pixels[id])`。

即 **bridge 是投递缓冲的唯一所有者并恰好释放一次**。缓存若把同一块缓冲二次投递，命中路径会被 bridge 释放一次、逐出时再释放一次 → double-free；缓存若只持有指针则会悬垂。因此选方案 (b)：缓存持有自己的 SPIRAM 副本，命中时 `heap_caps_malloc` + `memcpy` 出**新缓冲**交给 bridge。方案 (a) 引用计数要改 bridge 的释放路径，ABI/实现面更大，而 320×320 RGB565A8 ≈ 300 KB 的拷贝在模拟 S3 时钟下实测为 1 ms（见 §4），远低于 268 ms 光栅，不值得。

新缓存模块位置：`firmware/components/lume-engine/lume_svg_cache.c`（头文件 `include/lume_svg_cache.h`），已加入该组件 `CMakeLists.txt`。`lume_image.c` 的 PNG/JPEG 分支**未改**；缓存调用只在 `lume_engine.c:js_image_set_source` 的 `lume_svg_detect()` 守卫内，vendored（quickjs-ng / lvgl / lume-svg）、prelude、`runtime/`、`tools/`、`examples/`、`website/` 未动，bridge ABI 未动。

### 2.2 生命周期：随 QuickJS runtime 释放

`engine_task()` 内共有 3 处 `JS_FreeRuntime(rt)`（约 L4446 / L4522 / L4797），分别对应启动 ctx 创建失败、eval 失败回退、换 app / reload / BACK。每处前面都加了 `lume_svg_cache_reset()`。理由：缓存条目是 app JS 源字节的派生物，而每次 runtime 重建都是一次明确的应用生命周期边界；runtime 释放后条目不再可能被命中，常驻留只会白占 SPIRAM。取舍：跨 app 复用会省一次解码，但 canvas 池已占 230,400 px 双缓冲，SPIRAM 紧张，选干净边界。

### 2.3 键、容量、逐出

- 键：FNV-1a 32 位源字节哈希 + 源长度 + 目标 `tw/th`；命中时再对存储的源字节做 `memcmp`，哈希碰撞也不会显示错字形。
- 容量：`LUME_SVG_CACHE_MAX_ENTRIES 4` 且像素总量 ≤ 1 MiB。320×320 A8 满幅字形 = 307,200 B，实际只容 3 条；宿主测试确认第 4 条触发逐出后停在 3 条。
- 逐出：单调 tick 的 LRU；命中刷新 tick。
- 分配：像素副本与源字节副本均 `heap_caps_malloc(..., MALLOC_CAP_SPIRAM)`；元数据是 C 静态全局（+168 B DIRAM）。头文件声明 `heap_caps_malloc/free` 原型并在本文件本地定义 `MALLOC_CAP_SPIRAM == 1<<10`（与 `esp-idf/.../esp_heap_caps.h:39` 一致），使同一份源码可在 x86 直接编译测试。

## 3. 构建与尺寸原始输出

构建 / size 全文：`artifacts/r183/build-size.log`，提取表：`artifacts/r183/idf-size.log`。

```
│ DIRAM               │       247699 │    72.48 │          94061 │        341760 │
│    .bss             │       122376 │    35.81 │                │               │
│ IRAM                │        16384 │    100.0 │              0 │         16384 │
```

r181 对照（`artifacts/r181/idf-size.log`）：DIRAM 247,531 B；差值 +168 B 即 4 条 `svg_cache_entry_t` 的静态元数据，光栅本身全部在 SPIRAM，IRAM 无变化。

## 4. esp32sim bench 复测

复刻 `artifacts/r180/emu-svg-bench/` 的做法：`Image(...)` 之后用 `lume.system.setInterval` 每 400 ms 交替 `lume.image._setSource(img, A/B, 320, 320)`，用 `Date.now()` 量时。app 源在 `artifacts/r183/emu-svg-bench/`，驱动日志 `artifacts/r183/emu-svg-bench.log`，串口全文 `artifacts/r183/emu-svg-bench/serial.log`，样本提取 `artifacts/r183/emu-bench-samples.log`。bundle 为 24,205 B，与 r180 完全一致。

```
I (3910) ... R183 SVG sample=0 ms=268 rc=0 glyph=B
I (4051) ... R183 SVG sample=1 ms=1 rc=0 glyph=A
I (4452) ... R183 SVG sample=2 ms=1 rc=0 glyph=B
... sample=3..10 全部 ms=1 ...
I (7660) ... R183 SVG sample=10 ms=1 rc=0 glyph=B
I (8061) ... R183 SVG sample=11 ms=1 rc=0 glyph=A
```

注意点（如实记录）：prelude 的 `Image(props)` 会先调用 `_setSource(id, props.src, style.width, style.height)`，而 r180 的原始 app 用 `src:aa` 创建且 style 为 320×320，所以 A 在首次显式 `_setSource` **之前**就已被预热进缓存，sample=1 即命中。为让两个字形都从冷启动，另跑 `artifacts/r183/emu-svg-bench-cold/`（创建时用第三字形 C 预热），串口 `artifacts/r183/emu-svg-bench-cold/serial.log`，样本 `artifacts/r183/emu-bench-cold-samples.log`：

```
I (3914) ... R183-COLD SVG sample=0 ms=268 rc=0 glyph=B
I (4283) ... R183-COLD SVG sample=1 ms=229 rc=0 glyph=A
I (4464) ... R183-COLD SVG sample=2 ms=1 rc=0 glyph=B
... sample=3..10 全部 ms=1 ...
```

冷启动 268/229 ms 与 r180 的 268/228 ms 同一量级，说明 miss 仍走完整 `lume_svg_render`；命中为 1 ms（含 300 KB `memcpy`、队列投递、bridge 安装，不是零成本；`Date.now()` 为毫秒整数粒度）。实测 12 个样本而 r180 为 11 个（模拟窗口边界多打了一次 timer），不改写为 11。图像正确性：`artifacts/r183/emu-svg-bench/tft.png` 可见完整白色字形 A，无空白 / 损坏。**这些是模拟 S3 时钟时间，不是真机帧时间。**

## 5. 其他验证

- `node tools/lume/lume.js check examples/abc123 --timeout 180`：**PASS**（`artifacts/r183/check-emu-abc123.log`）。r180 记录过 8 s / 20 s 窗口都见不到 `engine recv RELOAD`；r181 的 `tools/emu/run.sh` 分帧注入节奏修复已在本基线，本次复现正常（`artifacts/r183/check-emu-abc123-serial.log`）。未改任何工具代码。
- 宿主缓存单测：`tests/svg_cache.js` + `tests/svg_cache_test.c`，gcc 编译真实 `lume_svg_cache.c` 并打桩 `heap_caps_malloc/free`（带 magic 守卫检测 double-free / 无效释放）。覆盖：冷 miss、put→hit、命中副本独立（释放第一次命中副本后再次命中仍正确）、内容变化 miss、尺寸键不同 miss、4 条条目上限 + LRU 逐出、1 MiB 字节上限（满幅只容 3 条）、reset 清空且无泄漏、退化输入。结果 `ALL CHECKS PASSED (allocs=36 frees=36 live=0)`。
- 全量 host harness：提交后最终复核 `artifacts/r183/host-all-post-commit.log`，103 个 `node tests/*.js`，**103 PASS / 0 FAIL**（重钉前 20 项红，见 `artifacts/r183/host-all-before-repin.log`；提交后发现 3 项新增文件守卫红，补钉过程见 `artifacts/r183/host-all-post-commit.log`）。
- `npm test --prefix tools/lume`：`artifacts/r183/npm-test.log`，51 pass / 0 fail / 1 skipped。
- 未动 website，跳过 `check_website.py`。

### 5.1 历史守卫重钉（谓词结构未改）

按 r173/r176/r177/r179/r181 先例，只动 allowlist / 夹具，不改任何断言谓词：

- 23 个守卫加入本轮具名对象：R166_ALLOWED / R173_FIRMWARE / R129_ALLOWLIST / ota_consumers ALLOWLIST 共 20 个在首轮重钉；提交后 `board_abi` 的零差异排除表与 `sd_files` / `sd_gallery` 的 R128_FIRMWARE_FILES 又补了 3 个——`git diff` 只看已提交的 HEAD 内容，新增文件在提交前是 untracked，提交后才进入这些守卫的视野。具名对象：`lume-engine/CMakeLists.txt`、`lume_engine.c`、新 `lume_svg_cache.c` 与头文件、新测试、`docs/r183-report.md`、`artifacts/r183/` 前缀。
- 8 个守卫的 mutation proof 原以 `lume_engine.c` 作为“必须被守卫拒绝”的夹具；该文件本轮已合法进 allowlist，夹具改为同样不在 allowlist 的 `firmware/components/lume-adc/lume_adc.c`，使证明仍然 load-bearing。
- `tests/ota_consumers.js` 的 `allChanged` 守卫在基线 HEAD 已是红的（`git show HEAD:tests/ota_consumers.js` 独立运行同样失败，原始输出 `artifacts/r183/ota-guard-baseline-check.log`）：HEAD 提交 `674684a` 更新了 `website/wasm/fw/partition-table.bin`，而该守卫的 BASE 停在 r177 的 `3514c76`。把 BASE 重钉到基线 `674684a`，谓词与 allowlist 语义不变。

## 6. 验证边界 / deferred

- 真机帧时间、p50/p95、SPIRAM 水位、canvas 与缓存叠加后的实际占用、触摸手感、显示方向、功耗与撕裂：全部 deferred。
- esp32sim 的 `ms` 是模拟 S3 时钟下的 `Date.now()` 读数，且为毫秒整数；1 ms 命中是“包含 memcpy 与投递”的读数的**量级**，不是零成本，也不代表物理板耗时。
- 缓存只覆盖 `lume.image._setSource` 的 SVG 分支；`lume.image.decode()`（tw/th=0 的独立解码 API）未接入缓存，PNG/JPEG 未缓存（按任务约束）。
- app API、bridge ABI（`tests/bridge_protocol.c` 的 `_Static_assert` 原样通过）、prelude、vendored 源均无改动。
