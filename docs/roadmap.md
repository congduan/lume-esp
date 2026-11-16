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

### r55 result — mario 浏览器模拟器端到端验证 (appended, milestone checkboxes untouched)

Appended note only: milestone definitions, checkbox states and the rendering-
backlog numbering above are unchanged. This round adds a Playwright browser-sim
verification script for `examples/mario`; no firmware C, embedded prelude,
bridge ABI, frame protocol or `runtime/types/lume.d.ts` change, and
`examples/mario/app.js` is untouched. Pure host/browser evidence, NOT on-device
acceptance.

- **`tools/simulator/verify_mario.js` (new)** — CommonJS Playwright script in
  the style of `verify.js` / `verify_music_player.js` (uses `PLAYWRIGHT_MODULE`
  or `playwright`). It spawns `sim.js examples/mario/app.js` (port 8799), opens
  the 480x480 `#device`, asserts the 6-node structure (LEFT/RIGHT/JUMP Buttons
  + 1 Canvas with drawn pixels) and initial HUD `S 0  C 0  L 3  LV 1`. Score
  assertions read the HUD Text node `textContent` — renderer.js does draw Canvas
  pixels into `#device`, but live frames are non-deterministic, so no pixel
  diff. RIGHT + short JUMP click -> `BRICK score=25`; partial RIGHT + HIGH jump
  (JUMP `longpress` gesture injected on `/input`) + LEFT air-control ->
  `COIN score=35` (`C 1`). Final `#device` screenshot (HUD + Canvas) ->
  `artifacts/simulator/mario.png`. The header comment records the
  esp32sim-vs-browser differences: input injection (DOM clicks + `/input`
  longpress vs firmware `actions.txt`), real-time 50 ms `__lume_tick()`
  non-determinism / frame timing, and that `STOMP 85` / `LEVEL 2 185` are not
  reproduced here (recorded, not forced).
- **CI not expanded** — no `.github/workflows/*` job runs Playwright browser
  verify (r50 recorded "浏览器验证不在 CI"); Playwright install is heavy /
  timeout-prone, so this stays a manual run. `docs/KNOWN-SIMPLIFICATIONS.md`
  r50 entry gains the mario entry point + manual command, plus a short r55 entry
  for the browser/esp32sim coverage difference.
- **Docs** — `examples/mario/README.md` gains a "Browser simulator verification"
  section (command, assertion coverage, division of labor with the esp32sim
  `actions.txt` evidence).

**Verification (all host / browser, EXIT=0; NO real device / 无真机):**
`node tools/simulator/verify_mario.js` -> 6 PASS lines (initial HUD, BRICK 25,
COIN 35, `canvas pixels nonzero=168960`, screenshot, BRICK+COIN coverage),
exit 0, repeated 4/4 green. Regression `verify_music_player.js` -> 2 PASS lines
(`PASS library`, `PASS playing lyrics`), exit 0.
`lume check examples/mario --no-emu` -> `RESULT: PASS (4 steps, 0 failed; exit 0)`.
`git diff examples/mario/app.js` empty (verify script is read-only on the app).
Browser path reproduces esp32sim's `BRICK score=25` -> `COIN score=35` exactly;
the longer esp32sim `STOMP 85` / `LEVEL 2 185` are NOT reproduced here. Firmware
build/size not required (pure host, no firmware-touching change); start-of-round
baseline `idf.py size` at `03fafb8`: Total 2,926,703 B (Flash Code 1,954,964 /
Flash Data 830,016 / DIRAM 230,499 / IRAM 16384/16384 Remain 0, `lume.bin`
0x2ca8f0). On-device acceptance (display / touch / audio / sleep current /
radio / persistence / bundle push) remains **not** performed.


## 引擎调试基建与分发加固路线（2026-11-16，结论固化防重复评估）

背景：对同类单板 JS 运行时的公开实现做过一轮对比调研（含一个 QuickJS-NG 同源的 TS-first 运行时），
结论是**不移植整体架构**：standalone C++ 平台抽象层对 Lume 的 ESP-IDF+板级 profile 绑定是负价值；
TS-first 与「朴素全局脚本、AI 友好免编译」的定位冲突；Observable 与既有 signals 重复。
**已具备、无需重复建设**：malloc_usable_size/heap_caps_get_allocated_size 记账 hook（Lume 的
js_usable_size_psram 已实现）；Result typed errors（0/负值码契约已固化 lume.d.ts，翻盘代价大于收益）。

**推进路线（按价值序，自研实现）：**

1. **分配器泄漏检测（P1，调试基建，每轮受益）**——在 QuickJS 分配器钩子挂 live-allocs 净计数器
   + host OOM 故障注入（倒计时后分配器按计划失败）。落地：`lume_engine.c` 的 `s_psram_mf`
   加净分配计数 + r36b profile 点暴露 `alloc.net/alloc.live`；esp32sim harness 断言「app 稳态运行
   N 秒 alloc.net 增长 < 阈值」。对症案例：typewriter 的 interval 回调每拍 slice/join 触发
   `InternalError: out of memory`（8MB 堆碎片化），当时只能靠二分试错定位——有此计数一眼可见。
2. **deploy manifest 绑定固件 hash（P2，app store 产品化前安全网）**——deploy 清单每行携带
   firmware hash，不匹配即整份丢弃，防固件升级后旧 app 的 API 假设失效。Lume 的字节码路径已有
   双端版本校验（r43b），但源码模式 app 与 apps/*/meta.json 无此层。落点：lume_apps_store
   meta 加固件 hash + boot 时校验拒绝明显不匹配组合。
3. **OTA A/B 配置槽（P3，接板后评估）**——双槽配置 registry + 切换/回滚，OTA 产品化（r26 是
   传输层，无配置回滚）时实现。
4. **设备 REPL（P4）**——串口逐行 eval 复用现有 runtime，开发体验加分项，hotreload 通道加
   REPL 模式即可。

## 语音助手基础设施路线（小智类产品，2026-11-16 立项，结论已定案）

目标：在 Lume 圆屏设备上复刻小智 AI 语音助手体验——**流式输出、不卡 UI、不阻塞**。
产品形态差异化：点屏/按键唤醒（不做离线唤醒词，esp-sr vs IRAM 16384 满线风险 spike 不值当），
文本 delta 逐字上屏 + 语音流式播放，状态机全在 app 层热更新迭代（固件只卖原语）。

### 已核实的引擎事实（2026-11-16 读码，勿重新勘察）

- engine task 单任务单线程，20ms `s_evt_queue` 等待即 timer tick 源；事件→JS 回调派发
  helper 已齐（lume_engine.c ~2648-2718，含背压保护 `uxQueueSpacesAvailable<=4`），
  `streamFinished` 已走「C 任务→队列→JS 回调」事件回流——异步基建管线**已存在**，缺的是：
- **全仓无 `JS_ExecutePendingJob` 调用** → Promise 微任务队列从不 drain，
  async/await 现状写了不执行（语言支持在，事件循环缺失）。
- 阻塞点三处：`ai.chat`（同步最长 120s）、`httpRequest`（同步等响应）、
  `audio.record`（整段录音阻塞，最长 10s，一次性返回）。
- `playStream`（r37b）是分块非阻塞的正确范式，录音侧需镜像对称化。

### 设计决策（已定案）

1. **并发模型 = 补事件循环，不做多线程**。engine 主循环每轮加
   `while (JS_ExecutePendingJob(rt, &ctx) > 0)`，Promise/async-await 即全面可用；
   不动 ABI、不动内存模型。明确不做：Worker/双线程 JS（框架红线）、一次性大改 async I/O。
2. **协议 = 设备薄 WS 客户端 + 网关重活**。设备只用 `lume.net.ws`（ESP-IDF 官方
   esp_websocket 组件，mbedTLS 已在固件），绑定为 Promise 造型
   `connect(url)→Promise<WsConn>`，`onmessage/onclose` 走既有事件队列派发（owned payload
   沿用 TEXT 消息所有权模式）。**Opus 编码不做在设备端**（CPU 最重刀，IRAM 压力）——
   小智官方协议（WS+Opus 60ms 帧）由网关翻译，对设备说「PCM/MP3 简单双流协议」：
   下行 JSON text delta（逐字上屏）+ binary 音频帧（喂 playStream 边收边播）；
   上行 60ms PCM binary 帧（流式喂 ASR）。
3. **音频对称化 = recordStream + stop**。ES7210 I2S DMA 在独立 audio 任务持续跑，
   60ms 帧入 PSRAM 环形缓冲（~2 秒/64KB 级，远小于 record 整段 1.28MB），事件送 JS；
   `audio.stop()` C 侧立即生效（barge-in 打断 <100ms，不等 JS）。回调纪律写进 API 文档：
   **JS 回调必须几 ms 内返回——只做转发/置 signal，拼接解码全留 C 任务**（typewriter
   OOM 教训的推广）。
4. **并发正确性**：录音、播放、HTTP 各在独立 C 任务，JS 只是事件汇合点；引擎 task
   事件间隙照常处理触摸/timer——UI 永远活着。全双工对话 = 两个独立 DMA 通道。
5. **状态机在 app 层**：IDLE→LISTEN→THINK→SPEAK 全 JS（signal 驱动），热更新迭代不刷固件。

### 流式全链路时延预算（目标开口 < 2s）

触摸打断 <100ms（C 侧 stop）｜说话→ASR 中间结果 ~300-500ms（流式 ASR）｜
LLM 首 token ~500ms（网关按句切分，首句完成即送 TTS）｜TTS 首音频 ~500ms-1s（流式合成）。
文本 delta 上屏走 signal 毫秒级，可加逐字效果（typewriter 30cps 已验证）。

### 刀序（A/B/C 三固件刀可并行 worktree 隔离；D 不碰固件可同时开工；E 收口）

- **A：job drain + Promise**——一切 async API 的前置，改动最小；prelude/timer 回调路径
  回归（回调产生 Promise 现状静默丢失，补后行为变化）。
- **B：`lume.net.ws`**——esp_websocket 组件 + 事件派发 + owned payload。
- **C：`audio.recordStream` + `audio.stop`**——镜像 playStream 架构，环缓冲 64KB 级。
- **D：网关服务**（Node，独立仓库/目录）——协议先行可定：上游二选一待拍板
  （①小智官方协议：复用小智生态角色/记忆/配置；②直连 ASR/LLM/TTS 三件：自由度大不受
  小智服务端约束）。
- **E：voice_assistant example**——状态机 + UI 卡片（THINK 卡片/逐字文本/波形动画），
  A/B/C 就绪前可先用 legacy 同步模式出对讲机 demo 验证产品手感。

### 风险登记

- PSRAM 峰值叠加：录音环 + 播放流 + UI 并存，按 r33 叠加预算核（环缓冲 64KB 级，估计无虞）。
- 同步 chat 冻结期间录音流不能跑（单线程）→ v1 时序天然错开不冲突；流式版无此问题。
- WS + 新固件代码的 IRAM/flash 余量：分区 56% 有余量，盯 IRAM 16384 硬线。
- 真机验收项照例 pending board：时延预算、双 DMA 并发、触摸打断手感、esp_websocket
  在真机 WiFi 下的稳定性。

### Vendored 魔改候选（2026-11-16 评估，按 VENDOR.md 纪律排期）

背景：用户问「能否在 LVGL 和 QuickJS 本身上魔改优化」。两个 vendored 组件已有魔改先例与
记录纪律（lvgl/VENDOR.md 29 行、quickjs-ng/VENDOR.md 49 行：PSRAM 分配器、CJK fallback
字体、-O2 等）。对照既有实测数据逐项评估后，剩余油水按价值序：

1. **lvgl task 事件驱动化（优先，改动小收益直接）**——现状 `lume_board.c lvgl_task`
   循环 33ms LVGL timer + 10ms 轮询（r35b 实测空载 30fps 上限来源）。改为
   `lv_timer_handler()` 返回 wait_ms 驱动的到期睡眠/通知（r36b 引擎侧已做同款改造，
   模式现成）。收益：空载功耗↓（voice assistant 常驻待命场景直接受益）+ 动画帧率
   上限解锁。风险低；真机功耗数字 pending board。
2. **LV_USE_SNAPSHOT 翻案刀（体验上限项）**——r46 真快照方案当时因「vendored 禁改 +
   PSRAM 预算 + 禁开 LV_USE_SNAPSHOT」放弃（KNOWN-SIMPLIFICATIONS 有登记）。重开条件：
   先过 r33 PSRAM 峰值叠加细账（快照缓冲 = 480×480×2B ≈ 461KB，与满屏解码/Canvas/录音
   并存的瞬时峰值核算），账过得去才动 lv_conf.h。收益：app 切换免 UI 重建（比 r46
   crossfade-through-black 更进一步的丝滑）。
3. **全屏 draw buffer 双缓冲**——即上文 backlog 第 4 条（blocked：内部 RAM 21.5KB 余量
   vs 48 行需 46KB），不重复立项；等内存释放路径出现再动。
4. **QuickJS GC size-class 分流：数据否决，不做**——r43b 实测 30s 仅 3 次 GC 且全在
   启动 eval 段、稳态为 0，占比 4.5%/3.2% < 5% 门槛（docs/r43b-gc-report.md）。
   除非未来负载画像变化（如语音助手长跑产生稳态 GC 压力），否则不重开。
5. **JIT / QuickJS 升级 / LVGL 9.4：不做**——quickjs-ng 无 JIT 可移植且 IRAM 16384
   满线；vendored 版本升级 rebase 成本 > 收益，等上游有硬需求特性再评估。

评估口径：魔改必须有可对拍的前后数据（收益量化），否则不动；改 lv_conf.h /
vendored 源码前先核对该项是否踩 KNOWN-SIMPLIFICATIONS 既有登记，翻案要在登记处注明
翻案依据与数据。
### r54 result — QuickJS PSRAM allocator profile (host + esp32sim; board pending)

`s_psram_mf` now counts live blocks and net allocated bytes at the four Lume allocator hooks, using `heap_caps_get_allocated_size` before free and on successful allocation/reallocation. The `lume_engine_alloc_stats` read API is engine-task-only. `CONFIG_LUME_PERF_PROFILE=y` compiles in the counters and a one-second `lume-perf` allocator line; the default config compiles them out. QuickJS runtime creation, eval, callbacks, GC and teardown all run on the sole engine task; the LVGL task posts events and does not call the JS allocator. Vendored sources, prelude, bridge ABI, frame protocol, `.d.ts` and `tools/lume` were not changed.

The leak gate lives in `tools/emu/check_alloc_leak.py`, separately from `lume check`: the latter's perf step is best-effort and a deliberate leak control must fail its stability assertion. Both apps run roughly 10 s after a 2.5 s frame injection. Sampling starts 2 s after app eval. The threshold is 32,768 B, calibrated between the observed counter growth of 0 B and deliberate leak growth of 319,300 B. Raw simulator stdout (the leak case was also invoked alone and exited 1):

```text
counter: I (4948) lume-perf: alloc.net=331840 alloc.live=117
counter: I (5949) lume-perf: alloc.net=331840 alloc.live=117
counter: I (6950) lume-perf: alloc.net=331840 alloc.live=117
counter: I (7951) lume-perf: alloc.net=331840 alloc.live=117
counter: I (8952) lume-perf: alloc.net=331840 alloc.live=117
counter: I (9953) lume-perf: alloc.net=331840 alloc.live=117
counter: I (10954) lume-perf: alloc.net=331840 alloc.live=117
counter: I (11955) lume-perf: alloc.net=331840 alloc.live=117
counter: I (12956) lume-perf: alloc.net=331840 alloc.live=117
counter: steady-growth=0 threshold=32768 PASS
leak: I (4950) lume-perf: alloc.net=402156 alloc.live=134
leak: I (5951) lume-perf: alloc.net=443476 alloc.live=144
leak: I (6969) lume-perf: alloc.net=480664 alloc.live=153
leak: I (7970) lume-perf: alloc.net=521984 alloc.live=163
leak: I (8971) lume-perf: alloc.net=563304 alloc.live=173
leak: I (9988) lume-perf: alloc.net=601260 alloc.live=183
leak: I (10989) lume-perf: alloc.net=642580 alloc.live=193
leak: I (11991) lume-perf: alloc.net=683900 alloc.live=203
leak: I (13008) lume-perf: alloc.net=721456 alloc.live=212
leak: steady-growth=319300 threshold=32768 FAIL
LEAK_CASE_EXIT=1
```

Default 2.16-board `idf.py build && idf.py size` passed. A same-config A/B rebuilt HEAD's original engine source and restored the r54 source in this worktree; both size outputs were identical (the r50 historical 1,954,564 B precedes later code on this HEAD):

```text
baseline: │ Flash Code        │      1954964 │
r54:      │ Flash Code        │      1954964 │
r54:      │ IRAM              │        16384 │    100.0 │              0 │         16384 │
r54:      Total image size: 2926703 bytes (.bin may be padded larger)
```

Profile firmware was built in `build-r54-profile` with `CONFIG_LUME_PERF_PROFILE=1`; its `quickjs.c` object needed `-g0` after debug-symbol assembly stalled under host swap, then `idf.py build` completed and linked the image. This changed debug information only, not optimization or source. Profile-off `tools/emu/run.sh examples/counter` completed reload/eval and produced a TFT image with no allocator lines. Raw 8 s stop line: `[emu] stop: Halted — core0 149980033 + core1 54622219 insns in 13.1s wall = 15.6 Minsn/s; emulated 8.000s (1920000000 cycles); 319200 exceptions, 23689 interrupts`. The repository's earlier counter core1 value was 54,573,730; this is the same instruction-count scale, and the r54 default Flash Code is byte-identical to same-HEAD baseline.

Host regression raw summary: 22 `tests/*.js` scripts printed `PASS`; `npm test --prefix tools/lume` printed `# tests 44`, `# pass 43`, `# fail 0`, `# skipped 1`. All evidence here is host or esp32sim. Physical display, touch, memory fragmentation, power, radio, storage and bundle push remain pending board acceptance; the counter does not count direct C/canvas PSRAM allocations or task stacks (see `KNOWN-SIMPLIFICATIONS.md`).

## 经典 app 复刻生态（2026-11-16 立项，分优先级候选清单）

背景：对社区圆屏/手表项目生态做过一轮调研（s0lness 维护的 awesome-esp32 类目录 + 高星仓库扫描，溯源与逐项 star 数据留在内部调研文档，不在此点名外部项目）。结论：社区最活跃的复刻方向收敛于三类——**AI agent 桌面屏、桌面宠物、经典游戏/表盘**；其中十余个高星项目原生跑在与默认板同款的 AMOLED 圆屏硬件上，复刻这些品类 = 直接覆盖现成目标用户群。本节只收「**纯 app 层可复刻、演示价值高、与现有 examples 不重复**」的候选，复杂度与依赖缺口逐条如实标注。性能口径（所有候选的设计前提）：canvas 20-30fps、无 image blit（静态资产可走 SVG）、单点触摸、retained paths 可用于静态层；刀序上优先挑能复用 r47/r48 canvas AA 与 retained paths 的候选。

### P0 — 第一批 demo/宣传刀（硬件/API 全对齐，难度低，建议排进下一轮）

| 候选 | 价值与复刻要点 | 可行性口径 |
|---|---|---|
| **俄罗斯方块** | 经典品类在 ESP32 生态已被反复验证（LED 矩阵/小屏实现众多），但圆屏高分辨率彩色版缺位 = 差异化空间。10×20 格缩放进 canvas，pan 手势横移 + tap 旋转 + swipe 软降，hiscore 走 `lume.storage.kv`（key ≤15 字符） | 网格类 = canvas 最舒适区（games_2048/breakout 先例）；方块预览+next 提示用双 canvas 或分区重绘；纯 app 层，无缺口 |
| **闭环目标环表盘**（智能手表原生风格：三同心环 complications） | r48 原生 AA `ctx.arc` 正中靶心——三个抗锯齿同心环各一条原生指令；步数目标接 IMU 或 demo 数据、电量接 PMIC、站立时段接 timer | watchface 现有三面（数字/模拟/环形信息）之外的第 4 面，swipe 翻面直接挂进现有切换；静态刻度走 retained paths；纯 app 层 |
| **模块化信息格表盘**（智能手表 modular 风格：多 complication 网格） | 一次演示主题+Card+signals+轮询全家桶：天气/电池/温度/日历小格，数据源接 `lume.net.httpRequest` 与本地传感器 | 与 dashboard 定位区分：表盘口径（时间为主视觉+小格环绕）非遥测口径；与 device_monitor 不重复（它是 2Hz 遥测仪表）；纯 app 层 |
| **桌面宠物**（像素电子宠物：喂食/抚摸/作息） | 触摸=抚摸、长按=喂食、翻腕（IMU）=惊醒——单点触摸+IMU 全用上；像素动画走 fillRect 预计算 spans（gravity_ball 模式）；**热更新 = 皮肤商店独有卖点**（换宠物/换装免刷机） | 帧动画 = 每拍局部脏区，性能无忧；状态机（睡眠/饥饿/情绪）纯 JS；纯 app 层 |

### P1 — 第二批（有差异化亮点或需性能 spike）

| 候选 | 价值与复刻要点 | 可行性口径 |
|---|---|---|
| **一键飞行（Flappy 类）** | 单点触摸玩法与硬件形态天作之合；障碍柱水平推进 = 镜头动场景，脏区只救局部动 | ⚠️ 性能 spike 先行：柱体连续推进需全帧重绘（230k px@20fps 是 r35b 实测瓶颈位），需先量出柱体分段 fillRect + 局部失效的真实帧率再立项； Bird/柱体像素精灵用预计算 spans |
| **康威生命游戏** | 触摸播种种细胞 + 观察演化，「圆屏上的涌现」演示价值高、实现极小；演示 retained paths（静态网格线）+ canvas（活细胞）分层 | 全帧重绘场景：细胞网格 ≤60×60 时 JS 侧每帧遍历+fillRect 活细胞即可控（死细胞不画）；代际间隔 200-500ms 低于帧率压力 |
| **记忆翻牌 / 扫雷** | 单点触摸网格游戏最低成本品类；翻牌动画走 signal transition + lv_anim；扫雷旗帜=长按手势（gesture 层已有） | 与 games_* 不重复（都是新玩法）；hiscore 走 KV；纯 app 层，半天级工作量 |
| **流体粒子沙盒**（IMU 晃动 + 触摸扰动） | 宣传效果天花板：圆屏 AMOLED 上粒子随重力流转 | ⚠️ 参考社区同款实证需降级到 200-300 粒子（JS 单线程无 SIMD）；粒子间作用用简化近似（网格邻域）；IMU 单位是 m/s² 非 g |
| **体感挥杆迷你高尔夫**（程序化关卡） | IMU 挥杆速度触发击球——手表形态差异化王牌（手机做不了）；关卡程序化生成无素材依赖 | 挥杆检测用 QMI8658 加速度峰值阈值（gravity_ball impactSpeed 先例）；物理简化为 2D 坡度+摩擦；纯 app 层 |

### P2 — 有依赖缺口或需固件刀，如实标注后缓做

| 候选 | 价值 | 缺口（诚实原则） |
|---|---|---|
| **猜词游戏（Wordle 类）** | 热度高、每日一题适合「每天看一眼圆屏」粘性叙事 | 🔴 blocked：无键盘硬件 + Input/键盘组件未建（M5 组件缺口已登记）。变体路线：字母环选字（tap 旋转+确认）可绕开键盘，但输入体验打折 |
| **按住说话语音伴侣** | playStream/recordStream 的终极演示，与语音助手路线（见上节）E 刀合并 | 🔴 blocked：`audio.recordStream`（C 刀）未落地；实时对话链路时延是真机硬仗 |
| **全屏精灵卷轴游戏**（横向卷轴平台跳跃完整版） | mario 单屏已证明玩法链路 | 🔴 blocked：真精灵图与卷轴的钥匙 = 固件 canvas drawImage blit（deferred 登记）；先 app 层单屏 demo 攒数据，再评估 B 刀 |

### 与现有 examples 的去重边界

2048/贪吃蛇（体感）/打砖块/单屏马里奥/重力滚球（游戏）、watchface 三面（表盘）、dashboard/speedometer/device_monitor（仪表）、music_player/ai_chat/typewriter（多媒体与 AI）已覆盖的玩法与形态不再重复立项；上表候选均按「新玩法或新形态」筛选。社区生态复刻的完整溯源（逐项 star、适配要点、排除名单及理由）溯源与排除名单留在项目内部调研档案（不入公开仓库），对外文档一律不点名外部项目。
