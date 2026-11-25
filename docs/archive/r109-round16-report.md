# r109 — 1.75" 圆屏板 profile：驱动补齐 + 顶栏等宽 + 宿主 harness（B1）

基线 `bccc073`（main，r108 va-ws 已推送），分支 `r109-round16`，工作树
`/tmp/lume-r109-wt`。模型守卫：

```
GUARD: settings.json model=hy4flash-free ✓
GUARD: model=hy4flash-free ✓ (settings + runtime audit clean)
$ git log --oneline -1
bccc073 docs: r108 WS transport report, usage, roadmap and simplifications
$ git branch --show-current
r109-round16
```

无真机在环。本轮全部结论为**编译期 + 宿主证据**；触摸方向、初始化序列、PMIC
上电、音频、复位时序等硬件行为 **deferred to board bring-up**，本轮不声称硬件验收。
例程原文（Waveshare 1.75C BSP）不在仓里，三类差异以 r86 已落盘并检查过的来源
口径与现有序列自查为准，不臆造"已实现"。

## 0. 先实证纠偏：1.75c profile 现状盘点（假设可能错，先读码）

`ls firmware/boards/` 实际三块板（注意目录名拼写）：

```
waveshare_esp32_s3_touch_amoled_1_75c/  lume_board_profile.h(6874B) partitions.csv sdkconfig.defaults
waveshare_esp32_s3_touch_amoled_1_8/     lume_board_profile.h(20891B) partitions.csv sdkconfig.defaults
waveshare_esp32_s3_touch_amoled_2_16/    lume_board_profile.h(7600B)  partitions.csv sdkconfig.defaults
```

`git log --oneline --all -- firmware/boards/.../1_75c/` 与祖先检查：

```
c725d5e fix(board): align 1.75C panel/touch with vendor BSP   ANCESTOR of HEAD: YES
413a6af fix(board): leave 1.75C expander reset macro undefined ANCESTOR of HEAD: YES
2e1a104 feat(board): add Waveshare 1.75C profile               ANCESTOR of HEAD: YES
```

**结论（纠偏）**：简报"r44 交接只写了 Kconfig 有线、驱动全绿未核对"的前提**已过时**。
1.75c 的驱动级补齐在 r86（HEAD 的祖先）已完成并落盘：Kconfig choice 接线
（`ac46b4f`）、profile 全量引脚/几何/I2C/QSPI 参数、CO5300 vendor 初始化序列、
6 列 CASET 偏移、`mirror_x/mirror_y` 触摸映射（`c725d5e`）、无 TF 卡的 SD 守卫、
复位不挂 TCA9554（`413a6af`）。`git log --oneline -20` 确认无 r110 B1 半成品，
故本轮**只做增量**：新增静态断言锁定宏契约、修正两处陈述过时的文档，不重做已实现项。

驱动消费链读码核对（全部为现有代码，未改）：
- `lume_display.c:334` `x1/x2 = area->x + LUME_LCD_COLUMN_OFFSET`（r45 先例的 flush 路径），
  1.75c 取值 6，2.16 取值 0；`capture_copy_area`/`px_count` 仍在逻辑坐标。
- `lume_display.c:425` `#if LUME_HAS_IO_EXPANDER_RESET`：1.75c 该宏未定义 → 走直接 GPIO 复位；
  1.8 走 TCA9554 路径（r45）。
- `lume_display.c:85-87` `LUME_LCD_INIT_CMDS` 直接展开为板级命令表；1.75c 序列为
  `FE,19,1C,FE,C4,3A,35,53,51,63,2A,2B,11,29`，无 MADCTL 旋转。
- `lume_touch.c:39 / 245` `LUME_TOUCH_CHIP` 二路分派；1.75c = `LUME_TOUCH_CHIP_CST9220`
  （16-bit 寄存器 / 10 字节帧，与 CST9217 同族），1.8 = CST816S（8-bit / 6 字节帧）。
- `lume_touch.c:183-184 / 359-360` 两路都调用 profile 的 `LUME_TOUCH_MAP_X/Y`，1.75c 为
  `px = 465 - tx, py = 465 - ty`。
- `lume_pins.h` 仅一行 `#include "lume_board_profile.h"`；Kconfig `LUME_BOARD_DIR` 默认
  行已含 1_75c；CMakeLists 把选中板目录加入 public INCLUDE_DIRS。

## 1. 三类差异逐项对照（r45 先例口径 + 现有序列自查）

| 差异类别 | 1.8 V2（r45 先例） | 1.75C 现状（r86 review fix） | 本轮处置 |
|---|---|---|---|
| **触摸 IC/协议** | CST820/CST816S @0x15，新增独立 8-bit/6 字节帧路径 | **不是 CST820**：CST9217（`CST92xx` 族）@0x5A，复用 16-bit/10 字节帧路径；BSP `swap_xy=0,mirror_x=1,mirror_y=1` → 双轴镜像 | 不加驱动分叉；静态断言锁定 `LUME_TOUCH_CHIP==CST9220` 且 `!=CST816S`、映射值 |
| **LCD 初始化** | CO5300，16 列 gap，init 表 CASET 0..367、末尾 `11`+100ms+`29` | CO5300 466×466，**6 列** CASET `00 06 01 D7` / RASET `01 D1`，序列 `FE,19,1C,FE,C4,3A,35,53,51,63,2A,2B,11,29`，`2B` 与 `11` 后各 600ms，无 MADCTL | 静态断言锁定几何/偏移/init 边界/opcode；不改序列 |
| **其他外设路由** | 1-bit SDMMC（无 CS）、**无 ES7210**、复位经 TCA9554 @0x20 | **无 TF 槽**（`LUME_PIN_SD_*` 全未定义，SD 调用返回 -2）；ES8311 @0x18 + ES7210 @0x40；AXP2101 @0x34、QMI8658 @0x6B；屏/触摸复位为**直接 GPIO**（GPIO1/GPIO2），无扩展器 | 静态断言锁定地址、SD 宏缺席、无 expander；不改板级 C |

所有条目的原始来源与"未真机核对"状态登记在 `docs/KNOWN-SIMPLIFICATIONS.md`（r109 条目），
触摸 I2C 地址 0x5A 仍为 r86 继承的"待上电探测"值，不在本轮声称已验证。

## 2. StatusBar 等宽纯 JS 修复

根因：`runtime/shell.js` StatusBar 原用硬编码 `width:432, x:24, y:24`（480 方形布局）。
在 1.8 的 368 宽屏上 `24+432=456 > 368` 溢出；在 1.75C 圆屏（466，r104 SafeArea
内接正方形边长 329、insets `{68,69,69,68}`）上 `24+432=456 > 466-69=397`，
越过安全方块右边界。

修复（`runtime/shell.js`，纯 JS，零固件/零 prelude 改动）：
- 新增可选 `shape` 属性（默认 `'square'`，只接受 `square`/`round`），复用 r104 的
  `safeInsets(shape, screen.w)`，使圆屏 StatusBar 与 SafeArea View **等宽**。
- 方屏：保留 24px 边距，`width = screen.w - 48`；480 → 432（2.16 逐值不变），
  368 → 320（修复溢出，不是回归）。
- 圆屏：边距由 SafeArea insets 提供（margin=0），`width = side = 329`，
  `x/y = (68,68)`；`68+329=397 = 466-69`，刚好落在安全方块内。
- 显式 `p.x/p.y` 仍优先；非法 shape 抛 `TypeError`。
- `runtime/types/lume.d.ts` 的 `StatusBarProps` 同步 `shape?: 'square' | 'round'`。

既有 `safeInsets`/`SafeArea`、`Card`/`Dialog`/`Toast`、`clock` 定时器与 `dispose`
行为全部不回归（见全量回归 + 新 harness）。

## 3. 宿主 harness（新增两项）

- `tests/board_175c_profile.c`：freestanding C（只含 `<stdint.h>`；两个 touch selector
  值照抄 `lume_board_internal.h`），直接 include 1.75c profile，`_Static_assert` +
  `#error` 锁定引脚、几何/偏移、I2C 地址、触摸路径与映射、SD 宏缺席、无 expander；
  锁定的正是第 1 节三类差异。编译命令见文件头。
- `tests/statusbar_round.js`：经 `prelude_runner` 注入真实 `runtime/shell.js`，以
  `__lumeScreen` 分别模拟 480 方屏 / 368 方屏 / 466 圆屏，用 bridge attr key
  （2=width, 18=x, 19=y）断言实际下发的几何；含**负向断言**（旧 432/24 在 368 与
  圆屏安全区都会溢出，断言中复现该 bug 并确认新值不再溢出）。

## 4. 验证原始输出（全部真实执行）

### 4.1 板级静态断言 harness

```
$ gcc -std=c11 -Wall -Wextra -Werror -I firmware/boards/waveshare_esp32_s3_touch_amoled_1_75c \
    tests/board_175c_profile.c -o /tmp/lume_board_175c_profile && /tmp/lume_board_175c_profile
PASS 1.75C pin map (QSPI/I2C/touch/I2S)
PASS 1.75C no TF slot - SD pins undefined
PASS 1.75C 466x466 + column offset 6 (CASET 0x01D7 / RASET 0x01D1)
PASS 1.75C I2C addresses (AXP2101/CST/IMU/codecs)
PASS 1.75C CST9217 -> CST92xx path + mirror_x/mirror_y mapping
PASS 1.75C direct GPIO resets (no TCA9554 expander)
PASS Waveshare ESP32-S3-Touch-AMOLED-1.75C
```

### 4.2 StatusBar 等宽 harness

```
$ node tests/statusbar_round.js
PASS statusbar-round 2.16 square 480 keeps legacy 432 wide at (24,24) - no regression
PASS statusbar-round 1.8 square 368 clamps the bar to the screen - no overflow
PASS statusbar-round 1.75C round 466 bar is equal-width with the SafeArea inscribed square
PASS statusbar-round custom x/y still override derived geometry
PASS statusbar-round invalid shape throws TypeError (square and round are the only shapes)
PASS statusbar-round round bar keeps signal getters and clock disposal behaviour
PASS 6 statusbar-round cases
```

### 4.3 宿主全量回归（基线 62 + 新增 statusbar_round = 63 文件）

```
$ for t in tests/*.js; do node "$t" || echo FAIL "$t"; done
FAILS: NONE - 0 FAIL
js files: 63
```

首次执行有 2 个失败 `tests/files_dialog.js`、`tests/spectrum.js`，原因均为全新
worktree 缺 `tools/lume/node_modules/esbuild`（`MODULE_NOT_FOUND`），与改动无关；
按 r86 先例把主仓已声明依赖以符号链接接入（**未安装任何新依赖、未改 package.json**）
后复跑 0 FAIL。

### 4.4 npm test

```
$ npm test --prefix tools/lume
1..46
# tests 46
# suites 0
# pass 45
# fail 0
# cancelled 0
# skipped 1
# todo 0
# duration_ms ~2309
```

与基线 45 pass / 0 fail / 1 skip 一致。

### 4.5 check 哨兵

```
$ node tools/lume/lume.js check examples/counter --no-emu
lume check examples/counter

[PASS] bundle   2160 bytes (26 ms)
[SKIP] eval     --no-emu
[SKIP] layout   requires emulator screenshot (--no-emu)
[SKIP] perf     profile disabled

RESULT: PASS (4 steps, 0 failed; exit 0)
```

### 4.6 1.75C 板构建（`idf.py size` 原始输出）

环境铁律：`env -u VIRTUAL_ENV IDF_PYTHON_ENV_PATH=/home/ubuntu/.espressif/python_env/idf5.5_py3.12_env`，
ESP-IDF v5.5 export.sh。为避免脏 tracked `sdkconfig`，使用独立 `SDKCONFIG` 与 `-B`
目录（`r86` 先例，与 `sdkconfig.defaults` 里"选择方式"一致）：

```
idf.py -B /tmp/lume-r109-build-175c -D SDKCONFIG=/tmp/lume-r109-sdkconfig-175c \
  -D SDKCONFIG_DEFAULTS="sdkconfig.defaults;boards/waveshare_esp32_s3_touch_amoled_1_75c/sdkconfig.defaults" \
  set-target esp32s3
idf.py -B /tmp/lume-r109-build-175c -D SDKCONFIG=/tmp/lume-r109-sdkconfig-175c \
  -D SDKCONFIG_DEFAULTS="sdkconfig.defaults;boards/waveshare_esp32_s3_touch_amoled_1_75c/sdkconfig.defaults" \
  build
idf.py -B /tmp/lume-r109-build-175c -D SDKCONFIG=/tmp/lume-r109-sdkconfig-175c size
```

生成配置证据：

```
#define CONFIG_ESPTOOLPY_FLASHSIZE_32MB 1
#define CONFIG_LUME_BOARD_WAVESHARE_ESP32_S3_TOUCH_AMOLED_1_75C 1
#define CONFIG_LUME_BOARD_DIR "waveshare_esp32_s3_touch_amoled_1_75c"
```

构建尾部 + size：

```
[100%] Built target lume.elf
[100%] Generating binary image from built executable
esptool.py v4.13.0
Creating esp32s3 image...
Merged 3 ELF sections
Successfully created esp32s3 image.
Generated /tmp/lume-r109-build-175c/lume.bin
[100%] Built target gen_project_binary
lume.bin binary size 0x2d4fc0 bytes. Smallest app partition is 0x640000 bytes. 0x36b040 bytes (55%) free.
[100%] Built target app_check_size
[100%] Built target app
Project build complete.
```

```
┏━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━┳━━━━━━━━━━┳━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━┓
┃ Memory Type/Section ┃ Used [bytes] ┃ Used [%] ┃ Remain [bytes] ┃ Total [bytes] ┃
┡━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━╇━━━━━━━━━━╇━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━┩
│ Flash Code          │      1988068 │          │                │               │
│    .text            │      1988068 │          │                │               │
│ Flash Data          │       839916 │          │                │               │
│    .rodata          │       839660 │          │                │               │
│    .appdesc         │          256 │          │                │               │
│ DIRAM               │       246855 │    72.23 │          94905 │        341760 │
│    .bss             │       121896 │    35.67 │                │               │
│    .text            │       101367 │    29.66 │                │               │
│    .data            │        23592 │      6.9 │                │               │
│ IRAM                │        16384 │    100.0 │              0 │         16384 │
│    .text            │        15356 │    93.73 │                │               │
│    .vectors         │         1028 │     6.27 │                │               │
└─────────────────────┴──────────────┴──────────┴────────────────┴───────────────┘
Total image size: 2969407 bytes (.bin may be padded larger)
```

1.75C 构建绿；IRAM 16,384/16,384（Remain 0，**不超**）。
构建完成后已 `rm -rf` 该独立 build 目录与临时 `SDKCONFIG`（disk 91% → 91%），
worktree 未留 1.75c 脏配置。

### 4.7 默认 2.16 板构建（`idf.py size` 原始输出）

简报指定命令（同上环境）：

```
cd /opt/esp/esp-idf && env -u VIRTUAL_ENV IDF_PYTHON_ENV_PATH=/home/ubuntu/.espressif/python_env/idf5.5_py3.12_env \
  bash -c '. ./export.sh >/dev/null 2>&1; cd /tmp/lume-r109-wt/firmware && \
           idf.py set-target esp32s3 && idf.py build && idf.py size'
```

配置证据：`CONFIG_LUME_BOARD_..._2_16=y` / `CONFIG_LUME_BOARD_DIR="..._2_16"`。
构建尾部 + size：

```
[100%] Built target lume.elf
[100%] Generating binary image from built executable
esptool.py v4.13.0
Creating esp32s3 image...
Merged 3 ELF sections
Successfully created esp32s3 image.
Generated /tmp/lume-r109-wt/firmware/build/lume.bin
[100%] Built target gen_project_binary
lume.bin binary size 0x2e29a0 bytes. Smallest app partition is 0x640000 bytes. 0x35d660 bytes (54%) free.
[100%] Built target app_check_size
[100%] Built target app
Project build complete.
```

```
┏━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━┳━━━━━━━━━━┳━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━┓
┃ Memory Type/Section ┃ Used [bytes] ┃ Used [%] ┃ Remain [bytes] ┃ Total [bytes] ┃
┡━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━╇━━━━━━━━━━╇━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━┩
│ Flash Code          │      2032588 │          │                │               │
│    .text            │      2032588 │          │                │               │
│ Flash Data          │       850836 │          │                │               │
│    .rodata          │       850580 │          │                │               │
│    .appdesc         │          256 │          │                │               │
│ DIRAM               │       247291 │    72.36 │          94469 │        341760 │
│    .bss             │       121984 │    35.69 │                │               │
│    .text            │       101679 │    29.75 │                │               │
│    .data            │        23628 │     6.91 │                │               │
│ IRAM                │        16384 │    100.0 │              0 │         16384 │
│    .text            │        15356 │    93.73 │                │               │
│    .vectors         │         1028 │     6.27 │                │               │
└─────────────────────┴──────────────┴──────────┴────────────────┴───────────────┘
Total image size: 3025195 bytes (.bin may be padded larger)
```

**Flash Code 对比**：本轮默认板 2,032,588 B vs 简报给定 r106 基线 2,032,860 B =
**−272 B**（无增长，落在"增量≈0"口径内）。IRAM 16,384/16,384（Remain 0）不超。
本轮默认板路径**没有任何 C 行为改动**（仅板级 profile 头注释、JS/harness/docs），
故镜像体积相对 HEAD 基线不变；r106 基线之后 r96 OTA HMAC 合入 main 也改变过代码基线与
分区元数据，因此不对"与 r106 逐字节相同"作承诺，只如实记录上述差值。
`idf.py set-target` 曾向 tracked `sdkconfig` 追加一行 `# CONFIG_..._1_75C is not set`
（语义无变化），已 `git checkout -- firmware/sdkconfig` 还原到 HEAD；还原后增量复建
`idf.py build && idf.py size` 数字逐项一致，最终 worktree 无脏 sdkconfig。

**`-g0` 说明**：两板首次全量构建均在 10 分钟首次编译窗口内未结束（QuickJS 目标
**已正常完成**于 98% `libquickjs-ng.a`，未出现 debug 汇编 swap 停滞），第二次增量
`idf.py build` 立即 RC=0。因此**本轮未使用 `-g0` 变通**，未改任何 vendored/源码编译选项。

### 4.8 1.75c emu 截图（可选）

未做。按简报"不强制"，且无真机/无现成 1.75c 三件套，不声称任何 board/emu 视觉验收。

## 5. 诚实口径与 deferred

- 全部证据为**编译期 + 宿主**：C 静态断言、JS harness、全量回归、npm test、哨兵、
  双板 `idf.py build/size`。
- **触摸方向正确**（CST9217 `mirror_x/mirror_y` 映射）、**CO5300 初始化序列正确**、
  6 列 gap 实机效果、复位时序、AXP2101 轨电压、ES8311/ES7210 音频、睡眠电流、
  WiFi/BLE、持久化、bundle 推送 —— 一律 **deferred to board bring-up**，本轮
  只声称"按 r86 BSP 例程口径实现且宿主断言通过"，不声称硬件验收。
- 未做运行时热切板、多板 CI 矩阵（边界所限）；`docs/roadmap.md` M5 "Board
  abstraction for additional targets" 仍 `[ ]`。
- 固件/串口文案纯 ASCII；docs 中文正常。build 产物与临时日志不进 git。
  commits 拆分、未推送（主控轮负责 merge+push）。
