# r224 — speedometer 色带迁原生 Arc widget（roadmap rendering-backlog #3）

基线：`origin/main 75db189`（2026-11-28）。worktree `/tmp/lume-r224-wt`，分支
`r224-speedometer-arc`（未 push）。本轮证据全部是 host / esp32sim，**不是真机验收**。

## 1. 先实证：三个假设的核对结果

原始证据（`lume_ui_bridge.c:516-550` / `:797-825`、`lv_arc.c:816-830`、
`prelude.js:900-934`）逐行摘录取自 `artifacts/r224/arc-bridge-evidence.txt`。

- **(a) 不传 `track` 时 LVGL 默认 track 会显示。** create 时
  `lv_obj_set_style_arc_width(obj, 8, LV_PART_MAIN)` + `arc_color(0x1B3145)`，且
  `Arc()` 只在 `props.track !== undefined` 时才发 `ATTR_ARC_TRACK`
  （`prelude.js:925`）。所以叠加弧必须显式处理 track。
- **(b) `ATTR_ARC_TRACK` 只改颜色，不能隐藏/改宽/改透明度**
  （`lume_ui_bridge.c:811-813` 只有 `set_style_arc_color(..., LV_PART_MAIN)`）；
  `ATTR_ARC_THICKNESS` 同时把 MAIN 和 INDICATOR 的宽度设为同一值（`:807-810`）。
  结论：**无需改 ABI** —— 用 `track: DIAL_BG`（`'#08121C'`，与 canvas 底色同色）
  把未用的背景环染成画布底色即可视觉隐藏，且让 value 弧的 AA 边缘正确混向底色。
- **(c) 叠放不挡手势、z 序可控。** create 时
  `lv_obj_remove_flag(obj, LV_OBJ_FLAG_CLICKABLE)`（`:536`），Arc 不参与命中测试；
  按创建顺序决定 z 序，三个 Arc 在 Canvas 之后创建即叠在其上。其环带落在
  r=156..160，与 ticks（r=139..152）、needle（r<=128）、labels（r=119）径向不重叠。

### 1.1 额外实证：LVGL 弧半径语义（导致一次几何返工）

首版按 `min(w,h)/2 = 158` 取 316px widget，emu 像素扫描发现色带整体内移 2px。
根因在 `lv_draw_sw_arc.c:81-86`：`area_in` 由外框**内缩整个 `width`**，
`lv_draw_arc()` 的外框是 `center +/- radius`，所以 `radius=R, width=W` 的描边
落在 `R-W..R`、中心 `R-W/2`（不是以 R 为中心）。改用 **320px widget（R=160）、
thickness 5** → 描边 r=156..160，与旧 `ctx.arc(r=158, width=5)` 的
`r_in=156/r_out=160`（`lume_raster_arc`）逐像素对齐。

## 2. 实现

仅改 `examples/speedometer/app.js`（+ 3 个 playground 生成文件以维持 byte-identical 不变量）：

- 删掉 `speedArc()` 与 `speedDialLayer()` 里的 4 条 canvas `ctx.arc`（1 track + 3 色带）；
  Canvas 保留背景填充、ticks 和 needle（needle 脏区策略原样未动）。
- 新增 `speedBand(from, to, color)`：三个叠放原生 `Arc`，`style` 定位
  `x=24+DIAL_CX-160, y=64+DIAL_CY-160, 320x320`，`thickness:5`，
  `track:DIAL_BG`，`value:100`。
- 角度边界沿用 `speedAngle()` 速度域：`135 -> round(speedAngle(120))=260 ->
  round(speedAngle(200))=343 -> 45(==405)`。`value:100` 表示三段是**静态量程标记**，
  与旧 canvas 版一致；速度仍由 needle（dialValue 信号）表达，未把色带改成动态填充。
- 未改 bridge / prelude / `.d.ts` / ABI / 任何 host harness 谓词。

取舍见 `docs/KNOWN-SIMPLIFICATIONS.md` 的 r224 条目。

## 3. emu A/B（参照 r47 的边缘颜色阶梯法）

固件三件套取自主仓 `website/wasm/fw/`（主仓无 `firmware/build/` 目录），
esp32sim 取自主仓 `tools/emu/.cache/bin/`，均拷入 worktree 后用
`EMU_SKIP_BUILD=1` 跑 `tools/emu/run.sh examples/speedometer`（8s 确定性执行）。
改造前后各一份 `tft.png`，归档为 `artifacts/r224/speedo-before.png` /
`artifacts/r224/speedo-after.png`；原始 serial/stop 行见 `emu-before.log` / `emu-after.log`。

- **几何对齐（先决条件）**：表盘中心 `(240,242)`。顶部 x=240 的黄带：
  before `y=82..86`，after `y=82..86`；左侧 y=242 的绿带：
  before `x=80..84`，after `x=80..84`；200° 斜向径向：两版都是 r=156..160 实心带。
- **边缘颜色阶梯**：顶部/左侧轴向边两版都是 **2 色硬阶**
  （`(8,16,24)` -> 带色）；200° 斜边两版都是 **2 个过渡色**
  （before `(32,85,82)/(32,76,74)`，after `(16,52,49)/(32,93,82)`）。
  270 个角度的全环聚合（每个角度沿 r=152..164 采 25 点统计非底色/非带色）：
  before 平均 **2.422** 个混合色/角（max 5），after **2.269**（max 5），
  直方图见 `artifacts/r224/ab-analysis.txt`。
  **诚实结论**：r47 的「2 色硬阶 -> 8 色」收益是相对 r47 之前的 Bresenham 光栅；
  本轮 before 已是 r48 的 AA `ctx.arc`，因此 A/B 是 **AA vs AA**——原生 Arc 的
  8-bit coverage 与 canvas AA 的阶梯数相当（本样本略少），**不宣称画质提升**。
- **接缝与端点**：260°/343° 色带接缝均无缺口；135° 起端与 405° 末端两版一致
  （`artifacts/r224/seam-check.txt`）。
- **整帧差异**：3177 变化像素，bbox `(80,82)-(400,351)`，
  `CHANGED_OUTSIDE_DIAL=0`；径向直方图显示 r=150..169 占 2054 px（色带 AA 数值差），
  r<130 的变化来自两轮 demo 速度相位差导致的 needle 位移（64 vs 65 km/h），
  **ticks / labels / HUD 均存在且无错位**。完整像素证据见 `edge-scan-*.txt`、
  `seam-check.txt`、`ab-analysis.txt`。

## 4. 验证（原始输出在 `artifacts/r224/`）

| 项 | 结果 | 指针 |
|---|---|---|
| `idf.py build && idf.py size` | `BUILD_SIZE_EXIT=0`，`lume.bin 0x2e6200` | `firmware-build-size.log` |
| 全量 `for t in tests/*.js; ...` | 112 个 harness，**0 FAIL** | `host-harnesses.log` |
| `npm test --prefix tools/lume` | 87 tests / 86 pass / 0 fail / 1 skipped | `npm-test-tools-lume.log` |
| `tests/bridge_protocol.c` / `tests/apps_protocol.c` | 编译运行 PASS（0 failure / 52 checks） | 本文件 §4.1 |
| `node tools/lume/lume.js check examples/speedometer --no-emu` | `RESULT: PASS`（4 steps, 0 failed） | `lume-check-speedometer.log` |
| emu A/B 截图 | 两份 `tft.png` 均已归档 | `speedo-before.png` / `speedo-after.png` |
| ASCII 纪律 | `ADDED_NON_ASCII=0` | `ascii-check.log` |

### 4.1 ABI 测试（本轮无 ABI 改动，仍回归）

```
gcc -std=c11 -Wall -Wextra -Werror -I firmware/components/lume-ui-bridge/include \
  -I firmware/components/lume-hotreload/include -I firmware/components/lume-engine/include \
  tests/bridge_protocol.c -o /tmp/r224_bridge_protocol && /tmp/r224_bridge_protocol
BRIDGE_PROTOCOL_EXIT=0
gcc -std=c11 -Wall -Wextra -Werror -I firmware/components/lume-hotreload/include \
  -I firmware/components/lume-engine/include tests/apps_protocol.c \
  firmware/components/lume-hotreload/lume_frame.c \
  firmware/components/lume-hotreload/lume_cmd.c -o /tmp/r224_apps_protocol && /tmp/r224_apps_protocol
52 checks, 0 failure(s)
APPS_PROTOCOL_EXIT=0
```

### 4.2 固件 size 增量（对照 r223 基线）

| Memory Type / Section | r223 基线 | r224 | 增量 |
|---|---:|---:|---:|
| Flash Code (`.text`) | 2,045,024 B | 2,045,024 B | **+0 B** |
| Flash Data (`.rodata` + `.appdesc`) | 853,348 B | 853,348 B | **+0 B** |
| DIRAM（静态） | 247,159 B (72.32%, Remain 94,601) | 247,159 B | **+0 B** |
| IRAM | 16,384 / 16,384 B (100%, Remain 0) | 16,384 / 16,384 B | **+0 B**（红线未破） |
| RTC FAST / SLOW | 72 / 32 B | 72 / 32 B | **+0 B** |
| Total image size | 3,039,627 B | 3,039,627 B | **+0 B** |

零增量符合预期：本轮只改 app JS，固件 C 源码零 diff。

### 4.3 playground 生成文件

改 `examples/speedometer/app.js` 会触发 `tests/playground_manifest.js` 的
byte-identical 不变量。运行 `node tools/playground/build.mjs` 后仅保留 3 个必需产物：
`website/playground/sources/speedometer.js`、`apps/speedometer.js`、`sources.js`；
其余 37 个 baseline 已陈旧的 bundle 恢复原状以收敛 diff。

## 5. 未做 / deferred

- 真机视觉、色带 AMOLED 观感、touch、帧时间、功耗全部 deferred 至 board bring-up；
  host/emu 证据不等于硬件验收。
- 未改 milestone checkbox；未 push；未做 code review。
- 未把轨迹条做成随速度动态填充（保持与 canvas 版一致的静态量程语义）。
