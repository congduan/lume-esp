# r43b — GC 实测与分流分配器决策（任务 B）

基线 `d501ebd`（固件已切 `CONFIG_COMPILER_OPTIMIZATION_PERF` / -O2，任务 C 已完成）。开工 `git log -1` = `d501ebd`，`git fetch origin && git status --short` 无输出（工作区干净）。**未接真机**；全部数据来自 esp32sim 上 booting 的真实固件镜像。`CONFIG_LUME_PERF_PROFILE`（默认关）临时置 `y` 用于测量，最终构建恢复默认关。

## 测量方法

- 构建（r43b 规定的环境包装，必须 `env -u VIRTUAL_ENV` + py3.12 env）：

  ```bash
  cd /opt/esp/esp-idf && env -u VIRTUAL_ENV \
    IDF_PYTHON_ENV_PATH=/home/ubuntu/.espressif/python_env/idf5.5_py3.12_env \
    bash -c '. ./export.sh >/dev/null 2>&1; cd /home/ubuntu/lume/firmware && idf.py build'
  ```

  成功，输出 `Project build complete` / `Successfully created esp32s3 image`。

- 运行（构建产物已是最新，跳过 rebuild）：

  ```bash
  EMU_SKIP_BUILD=1 EMU_SECONDS=30 tools/emu/run.sh examples/counter
  EMU_SKIP_BUILD=1 EMU_SECONDS=30 EMU_OUTPUT_DIR=$PWD/artifacts/emu/games_snake \
    tools/emu/run.sh examples/games_snake
  ```

  各 30 s 模拟时间，board `lume-amoled216`，ROM `esp32s3_rev0_rom.elf`。两次 `run.sh` 的原始收尾输出：

  ```text
  bundle /home/ubuntu/lume/examples/counter: 2160 bytes; frame 2172 bytes
  I (2682) lume-engine: engine recv RELOAD -> recycle runtime
  I (2692) lume-engine: runtime up; eval app '<embedded-demo>' (2160 bytes)
  I (2777) lume-engine: app eval ok; entering event loop
  [emu] stop: Halted — core0 161715216 + core1 103694943 insns in 8.2s wall = 32.5 Minsn/s; emulated 30.000s (7200000000 cycles)
  TFT: /home/ubuntu/lume/artifacts/emu/counter/tft.png
  ```

  ```text
  bundle /home/ubuntu/lume/examples/games_snake: 3718 bytes; frame 3730 bytes
  I (2683) lume-engine: engine recv RELOAD -> recycle runtime
  I (2693) lume-engine: runtime up; eval app '<embedded-demo>' (3718 bytes)
  I (2798) lume-engine: app eval ok; entering event loop
  [emu] stop: Halted — core0 172060902 + core1 131858712 insns in 14.1s wall = 21.5 Minsn/s; emulated 30.000s (7200000000 cycles)
  TFT: /home/ubuntu/lume/artifacts/emu/games_snake/tft.png
  ```

- 数据源：`artifacts/emu/<app>/serial.log` 的 `lume-perf` 每秒摘要。GC 计时来自 r36b 在 vendored `quickjs.c` 的 `JS_RunGC` 上挂的 `lume_perf_add(LUME_PERF_GC, ...)`（`VENDOR.md` 有记录）；本轮另在 `lume_perf.c` 增加 `js_heap_hwm` 高水位字段，使「堆水位 used/high-water」有独立读数。
- 口径：`GC 总耗时 = Σ(n × avg_us)`；占比分别以 **30 s 墙钟**、**全部 5 个 profile 段总和**、**剔除启动 `eval` 后的 render+flush+drain+gc 总和**（最严格）为分母。三者都列，避免靠选分母取巧。

## 原始输出（含 GC 的窗口节选）

counter（`artifacts/emu/counter/serial.log`）：

```text
I (2729) lume-perf: fps=2 flush=48 tx=144 psram_largest=5111808 psram_free=5160308 psram_min_free=5147896 dma_largest=22528 dma_min_free=22708 lvgl_stack_words=3660 engine_stack_words=13028 js_heap=224717 js_heap_hwm=224725
I (2731) lume-perf: render n=2 avg_us=10364 max_us=12143
I (2731) lume-perf: flush n=48 avg_us=235 max_us=239
I (2732) lume-perf: drain n=193 avg_us=46 max_us=7032
I (2732) lume-perf: eval n=2 avg_us=41023 max_us=67668
I (2733) lume-perf: gc n=2 avg_us=1954 max_us=3054
I (3731) lume-perf: fps=1 flush=24 tx=72 psram_largest=5111808 psram_free=5230200 psram_min_free=5145716 dma_largest=22528 dma_min_free=22708 lvgl_stack_words=3052 engine_stack_words=9124 js_heap=218523 js_heap_hwm=218523
I (3733) lume-perf: render n=1 avg_us=20661 max_us=20661
I (3734) lume-perf: drain n=189 avg_us=84 max_us=14596
I (3734) lume-perf: eval n=2 avg_us=41692 max_us=67695
I (3735) lume-perf: gc n=1 avg_us=901 max_us=901
I (4733) lume-perf: fps=0 flush=0 tx=0 psram_largest=5111808 psram_free=5230200 psram_min_free=5145716 dma_largest=22528 dma_min_free=22708 lvgl_stack_words=3052 engine_stack_words=9124 js_heap=218579 js_heap_hwm=218579
I (4737) lume-perf: gc n=0 avg_us=0 max_us=0
```

games_snake（`artifacts/emu/games_snake/serial.log`）：

```text
I (2729) lume-perf: fps=2 flush=48 tx=144 psram_largest=5111808 psram_free=5163532 psram_min_free=5147896 dma_largest=22528 dma_min_free=22708 lvgl_stack_words=3660 engine_stack_words=13028 js_heap=224717 js_heap_hwm=224725
I (2731) lume-perf: render n=2 avg_us=10365 max_us=12143
I (2731) lume-perf: flush n=48 avg_us=241 max_us=546
I (2732) lume-perf: drain n=193 avg_us=46 max_us=7032
I (2732) lume-perf: eval n=2 avg_us=41023 max_us=67668
I (2733) lume-perf: gc n=2 avg_us=1953 max_us=3053
I (3730) lume-perf: fps=6 flush=34 tx=102 psram_largest=4718592 psram_free=4915312 psram_min_free=4914908 dma_largest=22528 dma_min_free=22708 lvgl_stack_words=3660 engine_stack_words=13028 js_heap=227105 js_heap_hwm=227105
I (3732) lume-perf: render n=6 avg_us=2644 max_us=13162
I (3732) lume-perf: flush n=34 avg_us=186 max_us=238
I (3733) lume-perf: drain n=189 avg_us=138 max_us=24414
I (3733) lume-perf: eval n=2 avg_us=51731 max_us=67680
I (3734) lume-perf: gc n=1 avg_us=781 max_us=781
I (4730) lume-perf: fps=5 flush=10 tx=30 psram_largest=4718592 psram_free=4915312 psram_min_free=4914908 dma_largest=22528 dma_min_free=22708 lvgl_stack_words=3660 engine_stack_words=13028 js_heap=227497 js_heap_hwm=227497
I (4734) lume-perf: gc n=0 avg_us=0 max_us=0
I (5733) lume-perf: fps=2 flush=18 tx=54 psram_largest=4718592 psram_free=4913548 psram_min_free=4910600 dma_largest=10752 dma_min_free=10808 lvgl_stack_words=3660 engine_stack_words=13028 js_heap=227497 js_heap_hwm=227497
I (6733) lume-perf: fps=0 flush=0 tx=0 psram_largest=4718592 psram_free=4913548 psram_min_free=4910600 dma_largest=10752 dma_min_free=10736 lvgl_stack_words=3660 engine_stack_words=13028 js_heap=228049 js_heap_hwm=228049
```

30 s 内其余窗口均为 `gc n=0 avg_us=0 max_us=0`（两个 app 稳态都不再触发 GC）。

## 汇总（由原始日志逐行累加，非估算）

| 指标 | counter | games_snake |
|---|---:|---:|
| GC 次数 | 3 | 3 |
| GC 总耗时 | 4,809 us | 4,687 us |
| GC 单次 max_us | 3,054 | 3,053 |
| GC / 30 s 墙钟 | 0.0160 % | 0.0156 % |
| GC / 全部 5 段总和 | 1.773 % | 1.406 % |
| GC / (render+flush+drain+gc)（最严格） | **4.543 %** | **3.172 %** |
| render 总耗时 / n | 49,648 us / 4 | 56,459 us / 16 |
| flush 总耗时 / n | 22,512 us / 96 | 27,968 us / 134 |
| drain 总耗时 / n | 28,877 us / 5,487 | 58,642 us / 5,480 |
| eval 总耗时 / n | 165,430 us / 4 | 185,508 us / 4 |
| JS 堆 used（稳态） | 218,579 B | 228,049 B |
| JS 堆 high-water | 224,725 B | 228,049 B |
| 最大连续 PSRAM（最小观测） | 5,111,808 B | 4,718,592 B |
| PSRAM min_free（最小观测） | 5,145,716 B | 4,910,600 B |
| 内部 DMA 最大连续块（最小观测） | 22,528 B | 10,752 B |

## 决策（B2）

三个分母下 GC 耗时占比全部 **< 5 %**（最严格的剔除启动 eval 后仍只有 4.543 % / 3.172 %）。按 r43b B2 判定：

> **不实施 size-class 分流分配器。明确结论：暂不需要。**

理由：

1. 30 s 内各 app 仅 3 次 GC，合计 4.8 ms / 4.7 ms，且**全部发生在启动与 prelude+app eval 阶段**；t ≥ 4 s 的稳态 GC 次数为 0。分流优化的是稳态分配成本，而当前稳态根本没有 GC。
2. JS 堆高水位仅 224,725 / 228,049 B（≈220 KiB），相对 8 MiB 账面上限和 8 MiB PSRAM 都极小；最大连续 PSRAM 4.7–5.1 MiB，无外存压力。
3. 分流要改动 `lume_engine.c:98-132` 的 `JS_NewRuntime2(&s_psram_mf)` 分配器族，先算 DIRAM 余量（基线 65.47 % / 118,021 B）作为分流上限，再加分配失败回退 PSRAM 与前后对比。收益只能来自一个实测近零的项，还要动 IRAM 已满线（16384/16384）的构建，风险与收益不匹配。**不为优化而优化。**

## 局限与真机项（如实声明）

- esp32sim 不注入触摸：counter 为静态画面，snake 无输入几秒后撞墙 game over，因此 t ≥ 4–6 s 的稳态 `fps=0`。本轮测到的是「启动 + 空闲」负载，不是持续交互负载；这不改变本轮基于实测数据的「暂不需要」结论，但意味着结论覆盖范围是这两个 app 的该负载。
- **实际启动时间、长跑 GC 行为（8 小时循环、图片/录音/HTTP/WiFi 混合负载）留接板轮**，本轮不声称已验证。若真机长跑出现 GC 占比 > 5 %，再按 B2 的 >5 % 分支重新评估分流（届时必须先算 DIRAM 分流上限与回退）。
- esp32sim 的墙钟与真机不等价；`avg_us` 是模拟环境下的 `esp_timer_get_time` 观测值，不能当真机毫秒数用。
