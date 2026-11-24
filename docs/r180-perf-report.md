# r180 渲染流畅度配置实验

基线：`59c5733`，开工执行 `git fetch origin && git rebase origin/main`，无冲突。实验环境：Linux、ESP-IDF 5.5.5、esp32sim 0.3.0（本仓库补丁）。全部指标为编译器、主机或模拟器结果；未连接真机，不能据此声称主观流畅度已对齐 Brookesia。

## Brookesia 差距逐项销账

| 项目 | r180 核查与处理 | 状态 |
|---|---|---|
| 编译优化 | `CONFIG_COMPILER_OPTIMIZATION_PERF=y` 已在基线生效。 | 基线已消除 |
| LVGL 周期与调度 | `lv_conf.h` 已定义 `LV_DEF_REFR_PERIOD 15`；`lume_board.c` 的 r93 任务按 `lv_timer_handler()` 返回的 deadline 睡眠，由通知提前唤醒。`CONFIG_LUME_REFRESH_PERIOD_MS=33` 在 `sdkconfig` 存在，但没有被消费，不能当作实际刷新周期。 | 基线已消除 |
| 双 draw buffer | 基线是 2×20×480×2=38,400 B 内部 DMA SRAM；48 行挤掉 UI 队列，96 行自动回退 20 行。没有启用 PSRAM buffer。 | 保留 20 行；性能差距仍在，需重新设计内部内存预算 |
| 软件绘制单元 | 实际宏名 `LV_DRAW_SW_DRAW_UNIT_CNT`。临时改为 2 的 `idf.py build` 被 LVGL `#error` 拒绝；回退为 1。 | 未消除；当前 OS 模式下不可用 |
| TE/帧同步 | 没有板级 TE 实测。 | 真机 deferred |

双绘制单元有源码前置约束：`lv_draw_sw.c:33` 在 `LV_DRAW_SW_DRAW_UNIT_CNT > 1 && LV_USE_OS == LV_OS_NONE` 时触发 `#error`。当前 `lv_conf_internal.h` 默认 `LV_USE_OS=LV_OS_NONE`。临时将宏设为 2 的 `idf.py build` 失败，原文：`error: #error "OS support is required when more than one SW rendering units are enabled"`（`artifacts/r180/build-drawunit2.log`）。无可启动固件，故双单元的 heap 变化及 esp32sim harness **不可测**；已回退 1。启用 LVGL OS 与线程模型超出本轮最小配置范围，且单元线程默认各需 8 KiB 栈。

## Draw buffer 矩阵

静态内存来自每档 `idf.py size`；运行时实际行数从 esp32sim 的 `lume-display` 启动日志读取。静态 DIRAM 剩余值不能直接视为可分配的 DMA 连续块。任务栈配置（LVGL 8192 B，engine 24576 B）未随矩阵变更；实际栈水位无板级测量。

| 配置行数 | Flash Code B | Flash Data B | IRAM B | DIRAM used/remain B | 实际 buffer | scroller/flapdot | 结论 |
|---:|---:|---:|---:|---:|---|---|---|
| 20 | 2,046,904 | 853,660 | 16,384 | 247,523 / 94,237 | 2×19,200 B 内部 DMA | 两项通过 | 基线 |
| 48 | 2,047,028 | 853,756 | 16,384 | 247,523 / 94,237 | 2×46,080 B 内部 DMA | 两项 FAIL，桥接队列 OOM 后重启 | 淘汰 |
| 96 | 2,047,028 | 853,756 | 16,384 | 247,523 / 94,237 | 分配失败，回退 2×19,200 B 内部 DMA；`largest-before=131072` | 两项通过，但运行的是 20 行 | 淘汰 |

48 行日志反复出现 `lume-ui-bridge: init: ui queue create failed (OOM)` 和芯片重启，因此构建通过不能作为候选通过。96 行日志出现 `96-line DMA buffers unavailable (each=92160, largest-before=131072); retrying 20 lines`，随后实际显示 `2x19200 B SRAM draw buf`。三档配置的静态 DIRAM/IRAM 近似相同，是因为 buffer 在运行时从内部 DMA 堆分配。最终保留 20 行，且不以 PSRAM buffer 绕过分配失败。

为执行 96 行实验，临时把 `lume-perf/Kconfig` 的上限从 48 改为 96；实验结束与 `sdkconfig` 一起恢复原值。最终 `firmware/sdkconfig`、Kconfig、`lv_conf.h` 相对基线均无差异。

## SVG 与 app 层

`abc123` 在启动时已经把 SVG ASCII 源转换为 `ArrayBuffer` 并复用。每次卡片切换仍调用 `lume.image._setSource`；固件 `js_image_set_source` 总是进入 `lume_image_decode_ex`，SVG 分支全量调用 `lume_svg_render`，再投递新像素缓冲。JS 的 LRU 源字节缓存因此省不了光栅成本。现有 220 ms opacity 动画保留；本轮不实现假缓存。

主机 `-O2`、x86 的同一 `lume_svg_render` 对 A/B 两个 320×320 字形各运行 10 次，中位数分别为 3,728.5/4,622 μs；这不是 S3 耗时。原始样本在 `artifacts/r180/svg-host-bench.log`。

固件 esp32sim 的实际 `lume.image._setSource(Image, glyph, 320, 320)` 交替重复 11 次：A 为 228 ms（5 次），B 为 268 ms（6 次），全部 `rc=0`。这是模拟的 S3 时钟时间，不是宿主墙钟；原始日志在 `artifacts/r180/emu-svg-bench/serial.log`。超过 100 ms 门槛，**固件 SVG 光栅结果缓存**列入后续固件轮候选，需设计尺寸/源内容键、容量限制、像素所有权与换图生命周期；本轮没有改引擎。

`compass` 的指针与 `mochi` 的呼吸姿态持续变化，现有逐帧重绘有画面依据。`lcd_dual` 的 game-over 后静态画面已停止定时重绘，harness 验证 2 次后续 tick 不新增失效区域。

`lcd_dual` 已登记到 playground，源码必须与 `website/playground/sources/lcd_dual.js` 保持字节一致。本轮运行 `tools/playground/build.mjs` 同步该 app 的 source、bundle 和聚合 `sources.js`，再以 `tests/playground_manifest.js` 与网站检查验证；这三份生成文件随同一个 app 优化提交。

## 验证边界与待真机项

- `npm test --prefix tools/lume`：51 pass、0 fail、1 skipped；`lume check --no-emu` 对 79 个 examples：79 pass、0 fail。最终配置下 23 个旧范围守卫全部通过。
- 最终源码的独立 JS host harness 全扫：`TEST_COUNT=101 FAIL_COUNT=0`，原始逐项日志见 `artifacts/r180/host-js-final-summary.log` 与各 `host-final-*.log`。
- `abc123` 的普通 esp32sim app check 在默认 8 秒窗口未见 `engine recv RELOAD`；把模拟窗口延长到 20 秒仍未见该标记（`artifacts/r180/check-emu-abc123-20s.json`、`artifacts/r180/emu-fail-abc123-serial.log`）。bundle 成功，初始 `<home>` app eval 成功；不能把这项记为 app eval 通过。单独的 `abc-bench` 固件模拟器已成功 reload 并完成 11 次 `_setSource` 测量。
- 最终 20 行固件的 79-app esp32sim 全扫：`CHECK_COUNT=79 FAIL_COUNT=8`（71 通过），原始 `artifacts/r180/check-all-emu-summary.log` 与逐 app `check-emu-*.json`。失败项如下；这项未达到简报的 0 FAIL 门槛，不能当作全量回归通过。

| app | 检查失败 | 日志结论 |
|---|---|---|
| `abc123` | eval | 42,574 B bundle；8/20 秒窗口均未见 `engine recv RELOAD`。 |
| `settings` | eval | 37,449 B bundle；8/20 秒窗口均未见 `engine recv RELOAD`。 |
| `wordle` | eval | 33,452 B bundle；8/20 秒窗口均未见 `engine recv RELOAD`。 |
| `aurora_clock` | eval | 运行中 `InternalError: lume: ui queue full`。 |
| `plasma` | eval | 运行中 `InternalError: lume: ui queue full`。 |
| `skycombat` | eval | 运行中 `InternalError: lume: ui queue full`。 |
| `nettest_open` | eval | reload 后 `TypeError: not a function`。 |
| `files` | layout | app eval 通过，R5/R6 布局断言失败。 |

三个未见 reload 的 bundle 都大于 32 KiB，而本轮通过的最大 bundle 为 29,234 B；可能涉及大帧注入/接收路径，但没有把相关性当成根因。失败原始串口日志已复制到 `artifacts/r180/emu-fail-*-serial.log`。`scroller`、`flapdot`、`lcd_dual` 均在最终档的 esp32sim 检查中通过。
- `python3 scripts/check_website.py`：7 个 HTML 页面链接/锚点通过，API 161 条与 `.d.ts` 对齐；`tools/playground/build.mjs` 与 `tests/playground_manifest.js` 通过。
- `lume check examples/counter --visual`：通过。`examples/flapdot --visual`：画面非空且有绘制，但现有 draw-budget 断言失败（1.8/3.4/6.5 秒累计绘制 2072/3736/6856 次，结果副本见 `artifacts/r180/visual-flapdot.json`）。该浏览器检查与固件模拟器结果分列。
- `artifacts/r180/` 保存构建、size、host 与模拟器原始日志；`artifacts/check/` 保存 visual 结果。
- 真机 FPS、p50/p95/p99 帧间隔、连续 DMA 最大块、heap 水位、任务栈水位、触摸手感、功耗与撕裂均 deferred。esp32sim 的执行时间不是物理板上的耗时。
