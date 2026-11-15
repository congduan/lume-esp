# Roadmap

## M1 — minimal loop (current)
Goal: prove the full stack on real hardware with the smallest possible surface.

- [x] ESP-IDF 5.5 project skeleton + Waveshare BSP (`waveshare/esp32_s3_touch_amoled_2_16`)（代码链路完整；实机验收（点屏/触摸方向/推包）待接板）
- [x] QuickJS-NG as IDF component, engine task with PSRAM heap（代码链路完整；实机验收（点屏/触摸方向/推包）待接板）
- [x] LVGL integrated as render backend (hidden from JS)（代码链路完整；实机验收（点屏/触摸方向/推包）待接板）
- [x] Native bridge: minimal declarative View/Text/Button → lv_obj ops（代码链路完整；实机验收（点屏/触摸方向/推包）待接板）
- [x] CST9220 touch events → QuickJS event loop → JS callback（代码链路已通；mirror_y/swap_xy 方向待实机确认）
- [x] Hot reload over USB CDC（JS 源码推包 + engine runtime 重置；代码链路完整，实机推包验证待接板。bytecode 化留后续）
- [x] Demo app: interactive button counter,全程 JS（代码链路完整；实机验收（点屏/触摸方向/推包）待接板）

## M2 — hardware API surface
- [x] GPIO / PWM / ADC bindings（r6/r7 代码完成 + Codex review 通过；实机采样精度/驱动能力验收待接板）
- [x] AXP2101 power bindings (battery telemetry, power off/reboot)（r8 代码完成 + Codex review P-with-fixes，两条 follow-up 已修并复测；实机电池读数/powerOff 验收待接板。reboot 绑定归 lume.system，后续轮）
- [x] QMI8658 IMU bindings (poll + motion interrupt)（r9 代码完成 + Codex review P-with-fixes（唯一发现：ODR 文档命名 vs 6DOF 有效速率，已修）+ 主控独立复测通过后勾选。polled-only：lume_pins.h 无 IMU INT 定义，运动/数据就绪 INT 中断留接板轮；验收 = 编译绿 + size 达标 + Waveshare 官方例程自查；真机读数验收留接板轮）
- [ ] WiFi + HTTP client bindings（r11 代码完成：新组件 `lume-net` + `lume.net` / `lume.net.http` 绑定，station/WPA2-PSK/同步 httpGet/status 状态机；验收 = 编译绿 + IRAM 16384 不超 + 逐条对照 ESP-IDF v5.5.5 头文件与官方 station/esp_http_client example 自查。WiFi IRAM_OPT/RX_IRAM_OPT=n 压住 IRAM；Flash Code 844742→1398890（+554148，WiFi 栈传递链接 libnet80211/libpp/liblwip/wpa_supplicant/mbedtls，r10 基线被 gc 掉，见 KNOWN-SIMPLIFICATIONS r11 归因）。真机连 WiFi / HTTP 实测留主控接板轮，故整行保持未勾选）
- [ ] NVS KV store + LittleFS partition（r10 Kv（`lume.storage.kv`）**代码完成 + Codex review N→必修（5 发现：map_err 吞 ESP_OK、string 边界值读写不对称、内嵌 NUL key、keys() 吞异常、get() 负值判别歧义）→ 主控已修 + 复审 P-with-fixes（1 发现已修）+ 独立复测绿（IRAM 16384 不变，Flash Code 824086→844742，其中 libnvs_flash.a 首链 14537B / liblume-storage.a 1723B）+ 已推送**。r12 LittleFS / `lume.storage.Fs` 代码完成（组件固定 1.22.3，分区 subtype 改为 littlefs，首挂失败自动格式化；构建与尺寸见 r12 战报）；真机首次挂载、读写和掉电持久性验收留主控接板轮，故整行保持未勾选）
- [ ] ES8311/ES7210 audio playback/record（r13 `lume-audio` + `lume.audio`：16 kHz/16-bit/stereo 裸 PCM 同步放音及最多 10 秒录音，ES8311/ES7210 寄存器序列对照 Waveshare Arduino 示例；构建与尺寸见 r13 战报。GPIO46 PA 实际时序和真机放音/录音验收留接板轮，故整行保持未勾选）

## M3 — declarative UI completeness
- [x] Flex layout engine in the bridge (map to LVGL flex)（r14：flex 方向/主轴/交叉轴/gap/padding/百分比宽高桥接 LVGL flex，CSS camelCase 在 prelude 解析；host harness 校验含负向用例）
- [x] Style resolution (padding/margin/background/border/corner/opacity)（r14 部分：padding/gap/borderRadius/borderWidth/borderColor/opacity/百分比已落地；margin 与分边 padding 登记简化，见 KNOWN-SIMPLIFICATIONS）
- [x] List virtualization, image rendering (PNG/JPG decode)（r19 List 窗口化；r22 PNG/JPG 字节源、PSRAM RGB565/RGB565A8、Image 与 sizeOf 已完成，构建及 host harness 通过。真机视觉、透明混合、缩放与滚动手感验收留接板轮）
- [x] Animation primitives (tween/transition)（r15 代码完成：LVGL lv_anim 桥接、signal transition、lume.anim.to/cancel、完成事件回流与滑入示例；host harness/构建/size 验证，真机视觉流畅度待接板）
- [x] Canvas self-drawing widget（r16 代码完成：LVGL RGB565 canvas + PSRAM 预算、Canvas/onDraw 绘制 API、signal effect 重绘与折线图 flex 混排示例；host harness/构建/size 见 r16 战报。代码项已勾选；真机像素、时序和视觉验收留接板轮）
- [x] Gesture layer (tap/swipe/long-press/pan)（r21 代码完成：复用 LVGL 对象事件做按目标命中/滚动仲裁/`lv_indev_get_gesture_dir()`，纯 JS 手势状态机识别六类事件（tap/swipe/longpress/pan/panstart/panend），`lume.gesture.on(target,type,cb)` 返回注销函数；阈值集中在 `lume.gesture.tuning` 并以 LVGL 默认起步；longpress 后不双发 tap/onPress、可滚动容器手势让给 List 滚动。构建绿 + IRAM 16384 不变 + 24 例 host harness（含 review 必修回归）+ 既有 harness 全绿。代码项已勾选；真机手感、阈值舒适度和与 List 滚动冲突的表现留接板轮。详见 docs/KNOWN-SIMPLIFICATIONS.md r21）
- [x] App lifecycle（r17：生命周期钩子、BACK/PAUS/RESM 协议、timer、热替换释放链；真机待验收）
- [x] Theme system（r18：lume.theme flat color tokens + default radius，命名色通过 owned effect 在 theme.set 时重发 ATTR；fontScale 仅登记，真机视觉待接板验收。详见 docs/brookesia-learnings.md 和 KNOWN-SIMPLIFICATIONS）

## Power management (r20)

- [ ] Light sleep and touch wake: board pause/CO5300 DCS 0x10/0x11, GPIO11 ext0 low-level wake, JS `lume.power.sleepNow/onWake`, and 15-second idle demo are built and host-harness tested. WiFi-started calls return `-1`; actual current, latency, PSRAM retention, and INT wake behavior await board validation.

## M4 — tooling
- [ ] `lume` CLI: create / dev / deploy (esbuild → qjs bytecode → push)
- [ ] WiFi OTA channel (TCP push, port + auth token)
- [ ] Host simulator (LVGL SDL backend + QuickJS on desktop)

## M5 — ecosystem
- [ ] Component library
- [ ] Docs site + example gallery
- [ ] Board abstraction for additional targets

Status after the shell slice (`2172f50`); milestone definitions and checkbox states
are unchanged because full scope and on-device acceptance are still pending:

- **Component library**: first slice landed — `runtime/shell.js` exposes optional
  `StatusBar` / `EdgeNavigation` / `Launcher` / `dispose` components, with
  `runtime/types/lume.d.ts` types, `examples/shell_demo/`, 8 host harness cases (`tests/shell_components.js`)
  and simulator E2E screenshots. Still JS-only: bundled by the CLI rather than
  embedded in firmware, no bundle switching (`onLaunch` only logs), no icon/theme
  system, no CI harness run, no site API docs. On-device feel pending board bring-up.
  r37 adds optional `Dialog` and `Toast`, plus shell-side `theme.spacing` defaults;
  `examples/files` uses the deletion dialog. Component library acceptance remains pending.
- **Docs site + example gallery**: bilingual static site (`website/`, six pages) and
  `.github/workflows/pages.yml` are in place. The gallery does not list `shell_demo`
  yet; Pages triggers only on `website/**`; live deployment is not verifiable from
  the repository.
- **Board abstraction**: not started. Pins, resolution and display init are
  hard-coded for the Waveshare board (`lume_pins.h`, `sdkconfig.defaults`,
  `lume_display.c`); there is no Kconfig, board selector or `boards/` directory.

Status after the r27 board-abstraction first cut (`b3f8e68`..); milestone
definitions and checkbox states are unchanged — a real second target and
on-device acceptance are still pending:

- **Board abstraction** (still `[ ]`): the first cut landed — all Waveshare
  board parameters now live in one compile-time profile under
  `firmware/boards/waveshare_esp32_s3_touch_amoled_2_16/` (
  `lume_board_profile.h` + `sdkconfig.defaults` + `partitions.csv`), selected
  via Kconfig `choice LUME_BOARD` / `LUME_BOARD_DIR` and the
  `SDKCONFIG_DEFAULTS` list. Default-board behaviour is unchanged and
  `idf.py size` IRAM stays 16384/16384 (no overflow). There is still **no
  second board profile**, no runtime hot-switch, no multi-board CI matrix and
  no on-device acceptance. r32 removed the embedded JS prelude canvas `480`
  exception by injecting the selected board's screen width and height before
  prelude evaluation (see `docs/KNOWN-SIMPLIFICATIONS.md` r32). "Additional
  targets" is therefore not yet demonstrated — the checkbox stays unchecked.
- **Docs site + example gallery**: r27 completed the API catalog (81/81,
  incl. the 4 `lume.ui.shell.*` + `lume.net.otaStatus` entries) and added
  `examples/shell_demo/` to the gallery. The "does not list `shell_demo` yet"
  line above is a `2172f50` snapshot, now superseded.

Status after the r44 second compile-time board profile; milestone definitions
and checkbox states are unchanged — the box stays `[ ]`:

- **Board abstraction**: a second compile-time profile landed for the Waveshare
  ESP32-S3-Touch-AMOLED-1.8 under
  `firmware/boards/waveshare_esp32_s3_touch_amoled_1_8/`, wired into Kconfig
  `choice LUME_BOARD` / `LUME_BOARD_DIR`. Default-board behaviour is unchanged
  (byte-identical `idf.py size`, IRAM 16384/16384), both boards build green on
  the host, the host harnesses / CLI tests pass, and one 368x448 esp32sim
  screenshot was captured. It remains compile-time-only: the CST820 touch
  protocol, TCA9554-routed resets, 16-column panel gap, SDMMC-vs-SDSPI and
  absent ES7210 are known driver-level gaps, and there is still no runtime
  hot-switch, no multi-board CI matrix and NO on-device acceptance.
  "Additional targets demonstrated" is therefore still unmet — the checkbox
  stays `[ ]`. See `docs/KNOWN-SIMPLIFICATIONS.md` (r44 entry).

Status after the r45 1.8 driver-level gap closure; milestone definitions and
checkbox states are unchanged — the box stays `[ ]`:

- **Board abstraction** (still `[ ]`): r45 closed the three already-evidenced
  driver gaps behind compile-time profile macros — dual CST9220/CST816S touch
  protocol paths (`LUME_TOUCH_CHIP`), TCA9554 IO-expander reset for 1.8
  (`LUME_HAS_IO_EXPANDER_RESET`, default 2.16 direct-GPIO unchanged), and the
  CO5300 16-column gap wired into `lume_display.c` flush (`LUME_LCD_COLUMN_OFFSET`,
  applied at the CASET source because Lume has no `esp_lcd_panel_handle_t` for
  `esp_lcd_panel_set_gap`). Registers / bit map / gap value were verified against
  `espressif/esp_lcd_touch_cst816s` v1.1.1~1, the Waveshare BSP v2.0.3 and
  ESP-IDF demos, the SensorLib CST816 driver and esp32sim. Default-board build
  is zero-regression (`idf.py size` byte-for-byte identical to the b66bebc
  baseline); both boards build green, host harnesses (22 JS + C ABI + 33 CLI
  tests) pass, and the 1.8 build was confirmed to genuinely use the 1.8 profile.
  **All evidence is compile-time / simulator / vendor-source — there is still
  NO on-device acceptance** (no power-on, touch, color, gap, reset timing,
  audio, sleep current, radio, persistence or bundle push), no runtime
  hot-switch, and no multi-board CI matrix; SDMMC / absent ES7210 remain open
  gaps. "Additional targets demonstrated" is still unmet — the checkbox stays
  `[ ]`. See `docs/KNOWN-SIMPLIFICATIONS.md` (r45 entry).

## Rendering backlog (measured, not scheduled)

Milestone definitions and checkbox states above are unchanged; this section only
records what the canvas work left undone, with the on-device numbers that justify
the order, so the same ground is not re-derived later. All measurements are probe
apps on the Waveshare 2.16 board (432×344 canvas, 276 segments, dial repainted
every frame unless stated otherwise).

Landed, do not re-open:

- **Frame atomicity** — two RGB565 images per canvas (`front` displayed / `work`
  raster target); the closing `CANVAS_INVALIDATE` publishes (`lv_canvas_set_buffer`
  swap on a full redraw, rect `memcpy` on dirty rects). A refresh can no longer
  blit a half-drawn canvas. Cost: the canvas budget is two framebuffers.
- **Prelude fast path** — one dial frame 205 → 86 ms (one-entry colour cache,
  integer fast-path range checks, single-pass `polyline`).
- **Span raster** — one row run per span with 32-bit paired stores; drain 1.36 ms
  average, 42 ms maximum for a whole-frame burst.
- **Retained paths** — `retainPath` / `retainSegments` / `drawPath` (8 paths per
  canvas, ≤240 segments, 32 KB total): a full repaint that rebuilt 276 segments
  in JS per frame went 68.7 → 3.5 ms of JS and ~9 → ~36 fps.

Next, in the order I would take it:

1. **Anti-aliased canvas raster.** `canvas_line()` stamps an axis-aligned square
   brush along an integer Bresenham centreline and `canvas_span()` writes pure
   colour, so every stroke edge is a hard 1 px staircase — and a 4–5 px stroke
   turns it into 4–5 px steps, which is what makes the gauge arc look blocky.
   Sampling density is *not* the problem: at r=158 a 2° step is a 5.5 px chord
   with a 0.024 px sagitta, so finer polylines change nothing. Fix: coverage from
   the distance to the segment with a 1 px feather (integer squared distance plus
   a small table), same treatment for `canvas_disc` and rect edges. ~30 lines of
   C, no API change, and the speedometer needle, `dashboard`, `watchface` and
   `imu_ball` all benefit at once. Cost to watch: one squared-distance test per
   pixel (~5k px for a 5 px arc).
2. **Native ring/annulus op** — `ctx.arc(cx, cy, r, from, to, width, color)`
   rasterised as a scanline annulus (per row the x span between the inner and
   outer radius) with vertical coverage. Exact geometry (the dial stops sampling
   276 segments in JS at all) and the only path to phone-smooth joins and caps
   without supersampling. Also the natural place to add dashes and gradients.
3. **Bands as native `Arc` widgets** — zero new code: `Arc` already exposes
   value/start/end/thickness/track/color and `lv_draw_sw_arc()` renders through an
   LVGL mask (8-bit coverage), i.e. it is anti-aliased. Cost: three stacked
   transparent `Arc` widgets for the three colour bands, with the Canvas kept for
   ticks and needle. Try this first if only the example matters.
4. **Bigger display draw buffers** (r33 item, currently blocked) — 20 lines
   (4.2 % of the screen). Measured internal DMA headroom is 21.5 KB largest /
   16.7 KB minimum free, while 48 lines needs 46 KB, so this cannot move until
   internal RAM is freed elsewhere. Full-canvas `render` measures 26 ms average,
   so it is the next lever once memory allows.
5. **USB CDC reliability under load.** With an app at full frame rate, host
   transfers lose bytes (`frame rejected: bad-crc`, `screenshot payload truncated
   456240 != 460800`, launch ACK timeouts). Not a rendering defect, but it blocks
   automated visual checks, so the screenshot-scan regression harness described
   below cannot run in CI before it is fixed.
6. **Move whole-frame examples onto retained paths** — `dashboard`, `watchface`
   and `imu_ball` still rebuild geometry in JS every frame; the 36 fps probe shows
   what the move buys. Mechanical, low risk.
7. **Productise the half-frame check** — the statistical harness used here (take
   N screenshots, assert every frame has all expected layers and that each dirty
   rect stays inside its static region) is what caught the mid-frame blit and the
   needle-union bug. It should live in `tools/lume` as a `screenshot --scan N`
   mode so future canvas work is guarded automatically.

### r46 result — app-switch smoothness (appended, milestone checkboxes untouched)

Measured with esp32sim's deterministic instruction-count / emulated-microsecond
metric, NOT board wall-clock; on-device smoothness and dropped frames are still
pending board bring-up. This records the r46 switch work; it does not schedule
or re-order the backlog above.

- **Phase profile** (opt-in `CONFIG_LUME_SWITCH_PROFILE`, default off): a switch
  = teardown (JS_FreeRuntime broken out) + runtime creation (NewRuntime2 /
  NewContext / register_bindings broken out) + prelude eval + app eval +
  first-frame UI ready. Prelude eval dominated: ~85 % of switch time and ~78 %
  of switch instructions — so the bytecode cache was correctly the top priority.
- **Prelude bytecode cache**: compile the ~57 KB prelude once (`JS_Eval`
  COMPILE_ONLY -> `JS_WriteObject`) into a PSRAM-resident blob, then
  `JS_ReadObject` + `JS_EvalFunction` on every later switch. Prelude eval
  74245 -> 12079 us (~6x), whole switch 87536 -> 25392 us (-71 %), prelude
  instructions 18.9 M -> 3.4 M (-82 %). Resident cache 106811 B (prelude
  98395 B + home 8416 B). Version+content-hash guarded, source-eval fallback.
- **Crossfade-through-black (C1)**: LVGL-task black overlay on `lv_layer_top()`,
  fade in before RESET/teardown, fade out after the first-frame message (or a
  500 ms fallback); removes the bare blank screen. Simulator intermediate frames
  show old screen darkening -> near-black -> new app fading in -> full app.
  Real old-screen snapshot crossfade (C2) abandoned: vendored `LV_USE_SNAPSHOT`
  is compiled out, a ~450 KB snapshot buffer is hard to justify in the tight
  PSRAM budget, and vendored edits are not allowed.
- **Teardown chunking** skipped: `JS_FreeRuntime` is only 4.0 % (13.7 % after
  the cache) of switch time, below the 30 % gate — "data does not support it".

Size: Flash Code 1,941,940 -> 1,950,600 B (+8660, new cache/transition C code),
IRAM unchanged at 16,384 B (100 % hard line respected, not exceeded). Bridge ABI
only appends two op ids; app API and the prelude C-string form are unchanged.
See `docs/KNOWN-SIMPLIFICATIONS.md` (r46) and the r46 war report.

### r47 result — anti-aliased canvas stroke rasteriser (appended, milestone checkboxes untouched)

Closes rendering-backlog item 1 on the host/simulator; on-device acceptance is
still pending board bring-up. `canvas_line` / `canvas_disc` (integer Bresenham
centreline + square brush, and the eight-stamp circle) are replaced by a
header-only, all-integer 8.8 fixed-point coverage rasteriser
(`firmware/components/lume-ui-bridge/include/lume_raster.h`): line coverage from
exact point-to-segment distance with a 1 px feather, rings as one continuous
annulus, RGB565 channel blending at alpha/256. Fully covered pixels stay opaque,
so repaint/erase is bit-identical. No app API, prelude C-string, bridge ABI
(`LUME_DRAW_CIRCLE` keeps radius `a` / width `draw_width`), or vendored change;
r46 profiling code untouched.

- **Host**: `tests/canvas_aa.c` (freestanding, `-lm`) 11/11 assertions green:
  isqrt 8.8 contract, width=1 axis-aligned no feather, diagonal feather,
  coverage monotonicity, zero-length stroke, width=4 envelope, continuous ring,
  wide-ring-to-disc, 50 % blend, shared joint, set_colour. The stride sentinel
  test now draws past the visible width so the px-bound check is exercised.
- **Size** (default 2.16 board, `idf.py build` + `idf.py size`): Flash Code
  1,950,600 -> 1,951,228 B (**+628 B**, under the ~4 KB budget); **IRAM
  16384/16384 B (100 %, Remain 0, +0)** — the AA code stayed in flash `.text`,
  not IRAM; Flash Data 828,512, DIRAM 230,499, Total 2,921,463 B. Three
  `static lume_raster_surf_t` descriptors are ~72 B of DRAM `.bss`.
- **emu** (esp32sim, real firmware image, 8 s): `examples/speedometer` and
  `examples/counter` both reload clean — 0 "eval failed|RELOAD ERR", `tft.png`
  generated. Controlled A/B at the static yellow band's top edge (y=82,
  `speedArc(...,158,...)` geometry unchanged by the app's dial redraw
  refactor): pre-r47 committed capture = **2 colours** (hard `(8,16,24)` ->
  `(255,198,98)` step), r47 = **8 colours** with a 6-step RGB565 ramp
  `(8,16,24)` -> `(16,24,24)` -> `(57,52,41)` -> `(98,85,49)` -> `(139,113,65)`
  -> `(197,149,82)` -> `(246,194,98)` -> `(255,198,98)`. Whole-frame 57 -> 283
  distinct colours (the app's dial labels also moved from canvas text to LVGL
  Text widgets between the two captures, so the aggregate includes that change;
  the isolated arc edge above is the rasteriser-only evidence). 4,649 changed
  pixels, all inside the dial (x 80..400, y 82..356); zoomed hub crops show the
  old eight-stamp circle as a broken teal arc -> a continuous ring, and the
  jagged needle -> a smooth one.
- **Not on-device acceptance**: host / esp32sim evidence only. AMOLED colour,
  stroke feel, dirty-rect edges, frame time and dial legibility on the real
  panel remain pending. Milestone checkboxes and the backlog numbering above
  are unchanged; this section records the measurement only. Accepted
  simplifications (joint double-blend, small-radius ring degeneracy,
  axis-aligned no-feather) are in `docs/KNOWN-SIMPLIFICATIONS.md` (r47).

### r48 result — native anti-aliased annulus arc op (appended, milestone checkboxes untouched)

Closes rendering-backlog item 2 on the host/simulator: the canvas-level
`ctx.arc(cx, cy, r, from, to, width, color)` op, **not** backlog item 3's LVGL
`Arc` widget route. The speedometer dial stops sampling ~276 polyline segments
in JS — each dial arc is now one native call rasterised as a true continuous
annulus in C. On-device acceptance is still pending board bring-up.

- **Raster** — `lume_raster_arc` in `include/lume_raster.h` (header-only, all
  integer / 8.8 fixed point / no float / no per-pixel transcendental). Radial
  band `|d-r|` with the r47 1px feather, clipped to the `[from,to]` wedge by
  two **cross-product half-plane** tests (the float-free, integer equivalent of
  an atan2 range check), plus **round end caps** at both ends using r47 line
  endpoint-clamped semantics (min of the two squared 8.8 endpoint distances,
  one `lume_raster_isqrt` per pixel for the whole op). An integer q14
  quarter-sine LUT (91 entries, 182 B flash `.rodata`) supplies cos/sin for
  the endpoints and the tight bbox. A full 360° sweep takes the
  `lume_raster_ring` fast path (bit-identical); `from==to` is a bounded round
  dot; `width>=2r-1` closes the inner hole into a filled sector (r47
  degeneracy). A tight angular bbox is clipped to the surface before the loops.
- **Bridge ABI** — only appends `LUME_DRAW_ARC = 5` to `lume_draw_t`
  (`LUME_OP_CANVAS_DRAW` and every earlier draw id unchanged). No new
  `lume_op_t`, no `lume_ui_msg_t` field (still exactly 128 B on host): the
  fixed record's spare fields carry the arc — `image_w` = radius,
  `duration_ms`/`token` = the two signed degree angles. `_Static_assert`s added
  in `tests/bridge_protocol.c`. Prelude: `ctx.arc(...)` added to Canvas 2D,
  `runtime/types/lume.d.ts` signature synced; `ctx.polyline` and retained
  paths (`retainSegments` / `drawPath`) untouched (backward compat).
- **Example** — `examples/speedometer` `speedArc` now calls `ctx.arc`; the
  colour bands + track ring go native, ticks (`ctx.line`) and needle
  (`ctx.line` / `ctx.circle`) unchanged. **JS dial-frame geometry: 276
  polyline points (272 segments) -> 4 native arc ops (0 JS points)**, measured
  by instrumenting `speedDialLayer(ctx)` on both app versions (27 tick lines
  unchanged in both).
- **Host** — `tests/canvas_aa.c` 19/19 (11 r47 + 8 r48: wedge/cap/gap, full
  circle == ring memcmp, 0°-wrap normalisation, seam continuity, dot/wide
  degeneracy, bbox clip + stride sentinel, r<=0); ABI static-assert harness
  compiles; `tests/canvas_mapping.js` +2 arc tests (14 PASS); all 22
  `tests/*.js` harnesses green; `npm test --prefix tools/lume` 32 pass / 0
  fail / 1 skipped; `gen_api_docs.py --check` and `check_website.py` green.
- **Size** — `idf.py build` + `idf.py size`, `BUILD_EXIT=0 / SIZE_EXIT=0`:
  Flash Code **1,951,228 -> 1,954,564 B (+3,336 B, < ~4 KB budget)**;
  **IRAM 16384/16384 (100 %, Remain 0, +0)** — all new code stayed in flash
  `.text` / `.rodata`, not IRAM; Flash Data 828,512 -> 829,904; DIRAM 230,499
  unchanged; Total 2,921,463 -> 2,926,191 B.
- **emu A/B** (esp32sim, same firmware image, only the injected app differs;
  fixed 8 s / 1,920,000,000 cycles, deterministic instruction count): BEFORE
  polyline **406,648,268 insns** (core1 engine 85,085,505); AFTER arc
  **403,956,287 insns** (core1 81,057,077). **Total -0.66 % (did not worsen);
  JS core1 -4.03 M / -4.7 %** — the one-time dial-layer JS geometry cost is
  removed (the dial is painted once; steady frames repaint only the needle, so
  the difference is diluted over the 8 s window, but does not regress). Both
  reload clean — 0 `eval failed|RELOAD ERR`, tft.png produced. Pixel checks:
  AA multi-step ramp at diagonal band edges (e.g. 150° = 5 distinct colours),
  no background gap / seam hole across 140..400° and at the 260°/343° band
  joins, 2071 changed pixels all inside the dial bbox (x 80..400, y 82..356),
  dial-disc distinct colours 263 -> 283.
- **Not on-device acceptance** — host / esp32sim evidence only. AMOLED colour,
  arc-edge feel, seam visibility on the real panel and frame time remain
  pending. Milestone checkboxes and the backlog numbering above are unchanged.
  Accepted simplifications (integer-degree angle discretisation, hard angular
  cut + round-cap seams, cap double-blend) are in
  `docs/KNOWN-SIMPLIFICATIONS.md` (r48).

### r49 result — rendering backlog #6 + #7 (host / esp32sim, no on-device acceptance)

Closes rendering-backlog items 6 and 7 on the host/simulator. Milestone
checkboxes, milestone definitions and the backlog numbering above are
unchanged. No board was available: everything below is compile-green +
size + host/esp32sim evidence, **not hardware verification**.

**Empirical corrections to the dispatch premise ("assume wrong, verify first").**
Before editing, the implementation was read (`lume_scripts.c` prelude,
`lume_ui_bridge.h` + `bridge_protocol.c`, the examples, and the emu/screenshot
channels). Three premises in the r45 backlog note turned out to be stale:

- `speedometer` is **not** a retained-path demonstration. `62746fb` landed
  `retainPath` / `retainSegments` / `drawPath`, but the speedometer dial was
  refactored in `02d64ed` to a paint-once flag and in r48 (`00f4982`) to the
  native `ctx.arc`. Before r49 the retained-path API was exercised **only** by
  `tests/canvas_mapping.js`; no shipped example used it.
- The "three whole-frame examples rebuilding 276 segments" is true only for
  `watchface` (three full background rings ~360 polyline segments + 60 ticks
  rebuilt per frame). `dashboard`'s 276-segment gauge ring had already become a
  native LVGL `Arc` widget (`battArc`), and its `arc()` helper is dead code; the
  remaining canvas static geometry is ~11-19 hairlines. `imu_ball` was renamed
  to `gravity_ball` in r36 and replaced by a single-ball incremental dirty-rect
  demo; its per-frame geometry is a **moving filled disc** (49 `fillRect`
  spans), not line segments.

**#6 — move static/low-frequency geometry off per-frame JS** (three examples,
each treated by what its geometry actually is, not copied rigidly):

- `watchface`: `analogDraw`'s 60 tick marks -> two `retainSegments` paths
  (48 minor + 12 major, split because they differ in colour/width);
  `ringDraw`'s three full background rings -> three `retainPath` paths
  (121 segments each). Both replay through the same `canvas_line()` raster as
  the old `polyline()`/`line()`, so pixels are unchanged. The three progress
  arcs and the three hands stay dynamic.
- `dashboard`: the GAUGE separator, TRACE grid (10 lines) and SYSTEM
  separators (8 lines) become per-page `retainSegments` paths replayed with
  `drawPath`; dynamic text/trace/bars stay per frame.
- `gravity_ball` (a filled disc, not line geometry): a `retainSegments` +
  `drawPath(pid, bx, by)` variant was measured and **rejected** — it drops
  core1 by 41M but raises core0 by 71M (49 anti-aliased `canvas_line` replays
  instead of one cheap `canvas_span` per row), net total **+12 %**. The shipped
  form caches the disc's 49 `[dy, half]` spans in JS once (`BALL_SPANS`) and
  replays them as `fillRect` rows — no per-frame `sqrt`/`floor`/`max`/`min`,
  identical pixels, identical dirty rects, `tests/gravity_ball.js` unchanged.

emu A/B (esp32sim, same clean firmware image, only the injected app frame
differs, fixed 8 s / 1,920,000,000 cycles, deterministic instruction count;
stop lines):

```text
watchface    BEFORE core0 277183813 + core1 109426622 insns   total 386610435
             AFTER  core0 277109240 + core1  69403611 insns   total 346512851   core1 -40023011 (-36.6%), total -40097584 (-10.4%)
dashboard    BEFORE core0 206939394 + core1  73250145 insns   total 280189539
(GAUGE)      AFTER  core0 206970149 + core1  73410988 insns   total 280381137   core1 +160843 (+0.22%), total +191598 (neutral / bundle-size timeline noise)
dashboard    BEFORE core0 289855315 + core1  94606789 insns   total 384462104
(TRACE,BOOT) AFTER  core0 289882616 + core1  92974922 insns   total 381857538   core1 -1631867 (-1.7%), total -2604566
gravity_ball BEFORE core0 136262457 + core1 109877479 insns   total 246139936
             AFTER  core0 137682272 + core1  99749037 insns   total 245431309   core1 -10128442 (-9.2%), total -708627 (-0.3%)
```

`dashboard`'s default GAUGE page is measurement-neutral because its per-frame
JS geometry is ~one hairline on top of a ~73M core1 engine-idle baseline
(`counter` core1 = 54,573,730); the retained grid's benefit shows on the TRACE
page (same BOOT-press script for BEFORE and AFTER). All reloads clean — 0
`eval failed|RELOAD ERR`, tft.png produced. Pixel comparison BEFORE vs AFTER
is **bit-identical** for all three (0 changed pixels, 0 lost-ink, identical ink
bbox): watchface (33,40,283,340), dashboard (24,28,455,469), gravity_ball
(216,216,264,264).

**#7 — `lume screenshot --scan N`** (new `tools/lume/scan.js`, `png.js`,
`scan_specs.json`; wired into `lume.js`). esp32sim only writes one
`--tft-png` at end of run, so N consecutive frames of the same deterministic
execution are captured as N boots at increasing `--max-seconds` (fixed
firmware + fixed app frame + fixed script). A dependency-free RGB8 PNG decoder
(`zlib.inflateSync` + all five PNG row filters) feeds two per-frame assertions:
(A) the expected layer set — every declared static-layer ROI still has
`>= minInk` ink; (B) changed pixels in bounds — frame-to-frame changed pixels
stay inside `dynamicRegion` and never intrude into a static-layer ROI. Exit
0/1 like `lume check`, `--json` supported, products under
`artifacts/check/<app>/scan/`. Specs are calibrated from esp32sim captures;
`dashboard` uses a `press 0` BOOT-button action to reach the visible TRACE
canvas (the default GAUGE page hides its canvas behind metric cards).

- Positive: `speedometer` N=5 PASS (5/5, changed bbox confined to the needle
  / value region), `dashboard` N=5 PASS (5/5), `--json` smoke-tested.
- Negative (proves #7 is not a no-op): temporarily commented out
  `canvas_publish(m.node_id, &m)` in the `LUME_OP_CANVAS_INVALIDATE` drain
  (a mid-frame-blit-style break), rebuilt, re-scanned `speedometer` -> **all 5
  frames FAIL** with `MISSING: band-left 83 < 400 ink; band-top 0 < 300 ink;
  band-right 167 < 450 ink`, `RESULT: FAIL ... exit 1`. Restored the C file
  via `git checkout`, rebuilt, re-scanned -> PASS again. No break code left.

**Regression / size (all host, EXIT=0):** `lume check examples/counter`
(regression backstop) + `dashboard` / `watchface` / `gravity_ball` all PASS
(dashboard layout R1-R7 all PASS); 22/22 `tests/*.js` green
(`JS_HARNESS_FAILURES=0`); `npm test --prefix tools/lume` 44 pass / 0 fail
(new `scan.test.js` covers decodeRgb / inkCount / changedPixels /
analyzeFrames / renderScan / injected-capture engine / no-spec CLI failure);
`tests/canvas_aa.c` 19/19 and `tests/bridge_protocol.c` static assertions
PASS; `gen_api_docs.py --check` (110 entries) and `check_website.py` green.
`runtime/types/lume.d.ts` unchanged (retained-path API was already declared;
no API change this round). Firmware `idf.py build && idf.py size`
`BUILD_SIZE_EXIT=0`: **IRAM 16384/16384 (100 %, Remain 0)**, Flash Code
1,954,564 B (identical to the r48 baseline — no firmware C change, +0 B),
Flash Data 829,904, DIRAM 230,499, Total 2,926,191, `lume.bin` 0x2ca6f0.

### r50 result — CI 测试流水线 (appended, milestone checkboxes untouched)

Appended note only: milestone definitions, checkbox states and the rendering-
backlog numbering above are unchanged. This round moves the existing local
verification loop into GitHub Actions; no firmware C, embedded prelude, bridge
ABI, frame-protocol or `runtime/types/lume.d.ts` change. It closes the
"no CI harness run" status gap recorded in the `2172f50` snapshot above.

- **`tests.yml` (new)** — host regression matrix triggered by `push` to `main`
  (curated `paths`), `pull_request` and `workflow_dispatch`; one `ubuntu-latest`
  / node 20 job runs `npm ci --prefix tools/lume`, 22 JS host harnesses,
  `npm test`, 8 C host assertion harnesses, `gen_api_docs.py --check` +
  `check_website.py`, plus a `hashFiles()`-guarded
  `lume check examples/counter --no-emu` step. Every run block uses
  `set -euo pipefail` (no `|| true`); `if: failure()` uploads tee'd diagnostics.
  The 8 C commands are copied verbatim from `docs/build.md` and the `.c`
  file-header comments; `id3v2.c` / `mp3_decoder.c` / `record_buffer.c` have
  **no** command in their headers, so those three were derived empirically
  (r38b report / minimp3 header-only / vendored-QuickJS host build with an
  `sdkconfig.h` stub) with provenance recorded in the workflow. `--no-emu`
  covers the **bundle step only** — eval / layout R1-R7 / perf are skipped
  (`check.js:164-209`) — so it is documented as bundle-only, NOT a layout gate.
- **`emu.yml`** — a `screenshot --scan 5 examples/speedometer --json` +
  `examples/dashboard --json` gate appended after the existing screenshot
  matrix, reusing the `setup.sh` / `fetch-rom.sh` esp32sim + ROM cache
  (`EMU_BIN` / `EMU_ROM`) and the esp-idf-ci-action firmware images. `set -e`
  plus scan's exit-1-on-fail turns a broken scan red; `artifacts/check/<app>/scan/`
  now rides the `if: always()` artifact upload. esp32sim is a headless chip
  emulator writing PNGs (no display / font dependency), so the step stays in
  the push-triggered job rather than being downgraded to dispatch-only. Local
  ROM bytes equal the CI-pinned `20260528` sha256, so no ROM version skew.

**Verification (all host / esp32sim, EXIT=0; NO real device / 无真机):**
`JS_HARNESS_COUNT=22 JS_HARNESS_FAILURES=0`; 8/8 C harnesses compiled + run
EXIT=0 (`ALL_C_HARNESSES_DONE`); `npm test --prefix tools/lume` 44 pass /
0 fail; `gen_api_docs.py --check` "api.html is up to date with lume.d.ts
(110 entries)" and `check_website.py` "API missing: none / API invented: none";
`lume check examples/counter --no-emu` `RESULT: PASS (4 steps, 0 failed;
exit 0)`; `speedometer` N=5 and `dashboard` N=5 both `RESULT: PASS (5 frames,
0 failed; exit 0)` with `--json` smoke (`ok=True`, 5/5 frames). Workflow YAML
`yaml.safe_load` OK for both files; `actionlint` is not installed on the host
— skipped. Firmware `idf.py build && idf.py size` `BUILD_SIZE_EXIT=0`:
**IRAM 16384/16384 (100 %, Remain 0)**, Flash Code 1,954,564 B, Flash Data
829,904, DIRAM 230,499, Total 2,926,191, `lume.bin` 0x2ca6f0 — byte-for-byte
the r49 baseline (no firmware C change, +0 B). On-device acceptance (display /
touch / audio / sleep current / radio / persistence / bundle push) is still
**not** performed. CI coverage gaps are recorded in
`docs/KNOWN-SIMPLIFICATIONS.md` (r50 entry).
