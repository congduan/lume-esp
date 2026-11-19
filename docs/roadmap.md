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

Local web service (r71): the `lume.net.web` server code is complete with
JS-defined routes and pages, token-gated LAN access, bounded HTTP parsing, and
host tests. Browser access over real WiFi remains a board acceptance item; see
`docs/r71-webserv-report.md`.

Firmware distribution (r74): the unmodified Lume firmware boots in the browser
through the esp32sim WASM emulator — `run.html?wasm&fw=lume` on the Pages
origin, trio + manifest synced from `firmware.yml` artifacts by `fw-sync.yml`,
surfaced as the Playground Firmware tab. Verified booting to the launcher home
screen (CO5300 panel); see `docs/r74-realfw-report.md`.

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
7. **Opt-in single-buffer canvas (`singleBuffer`) — P2, data-driven trigger**. r48's
   frame atomicity doubles every canvas buffer (front + work); the shared
   230,400 px pool therefore fills at half the nominal size (watchface's four
   faces already sit at 228,544 px). A `singleBuffer` opt-in (or automatic
   size-based grading) would halve full-redraw canvases — game-style surfaces
   repaint entirely every tick, so a torn window is overwritten within one
   20 ms tick and the atomicity guarantee matters least there, while dirty-rect
   faces (dial, rings) keep double buffering. Alternatives rejected: raw single
   buffer reopens the mid-frame blit bug r48 closed; a lock trades frame-rate
   determinism; a ready-handshake window (r46 crossfade pattern) downgrades the
   hard guarantee to statistical. Not scheduled: the pool is only exhausted by
   watchface; implement when a real app hits the wall and needs the extra half.
8. **Productise the half-frame check** — the statistical harness used here (take
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

### r81 result — retained canvas sprite blit (appended, milestone checkboxes untouched)

Closes the P2 "全屏精灵卷轴" key: the firmware `ctx.drawImage` blit that was
deferred since r58. A JS pixel array (`Uint16Array`, RGB565, length `w*h`) is
uploaded once via `ctx.retainImage(slot, w, h, pixels)` and replayed from C each
frame via `ctx.drawImage(slot, dx, dy, flip)` — the r45 retained-path pattern for
bitmaps, so a sprite-heavy app pays no per-pixel JS on the ~0.5 Mops/s engine.
New header-only `lume_raster_blit()` (colour key 0x0000 transparent, horizontal
flip, four-edge clipping, stride padding untouched); two tail-appended ops
`LUME_OP_CANVAS_SPRITE_DEFINE` (=18) / `_DRAW` (=19); 8 slots per canvas +
460,800 B PSRAM budget; write into the canvas work buffer then normal
invalidate publish. Full trade-offs in `docs/KNOWN-SIMPLIFICATIONS.md` (r81),
implementation report in `docs/r81-sprite-report.md`.

- **Host**: `tests/canvas_blit.c` (freestanding, new) 6/6 cases green — opaque
  landing, 0x0000 colour key, four-edge clip + padding columns intact, flip,
  NULL/zero-size no-op, fully-off-surface no-op. `tests/canvas_aa.c` 19/19 and
  `tests/bridge_protocol.c` (static asserts for IDs 18/19 + slot count 8) green.
  Raw: `EXIT=0` for all three C harnesses.
- **JS harness**: `for t in tests/*.js; do node "$t" || echo FAIL "$t"; done` →
  `TOTAL_JS=42 JS_HARNESS_FAILURES=0`; 3 new `canvas_mapping.js` sprite cases
  (single upload/multi replay with offset+flip, 6 negative validation cases,
  slot redefinition). `lume check examples/counter` regression sentinel →
  `RESULT: PASS (4 steps, 0 failed; exit 0)`, layout R1-R7 all PASS. Raw:
  `artifacts/r81/host-tests.log`.
- **Size** (default 2.16 board, `idf.py build` + `idf.py size`, `BUILD_SIZE_EXIT=0`):
  Flash Code 2,021,336 -> **2,021,204 B (−132 B**, within codegen noise);
  Flash Data 847,828 -> 849,396 (+1,568); DIRAM 239,043 -> 247,267 (+8,224,
  the `s_sprite_px/w/h[128][8]` BSS arrays — pixel payloads live in PSRAM);
  **IRAM 16384/16384, Remain 0 (unchanged, hard line held)**; Total image
  3,010,935 -> 3,012,371 B (+1,436). Raw: `artifacts/r81/size.log`.
- **Not on-device acceptance**: host / simulator evidence only. AMOLED colour
  of blitted sprites, real frame rate under a scroll demo, PSRAM headroom for
  bulk defines and sprite demo feel remain pending board bring-up. The P2 row
  below still lists the full side-scroller as blocked on app-layer work; r81
  only delivers the firmware blit key, not a finished scrolling game.

### r83 result — 全屏精灵卷轴 POC + 滚动性能口径（appended, milestone checkboxes untouched）

r81 的 blit 钥匙落成第一个 app 层实战：`examples/scroller/app.js`。8 个精灵槽
（sky/hill/ground/hero/jump/crouch/spike/coin）一次 `retainImage` 上传，之后每帧
只发 36~41 次 `drawImage`；host harness 断言 `draw`(fillRect) 恒为 0、60 帧后
`spriteDefine` 仍恰好 8 条（r81 重复上传坑不回归）。相机每 tick +3px、swipe down
20-tick 冲刺下蹲、tap 跳、金币/尖刺碰撞、KV `hisc.scroller`（13 字符）；ASCII
行 → RLE spans → Uint16Array 一次预计算（r68 先例，`TOTAL_SPANS=85`）。

- **脏区纪律**：不整屏发布，只发布相机扫过的两条带（hill 480×40 + ground
  480×62 = 48,960 px）+ 英雄与金币的 old∪new 盒；稳态 4 个矩形（bridge 上限 8）。
  emu 实测脏区 59,441~63,991 px/帧 = 画布 480×352 的 35.2%~37.9%。
- **验证**：`for t in tests/*.js` → 43 脚本 0 FAIL（+`tests/scroller.js` 9 例）；
  `canvas_blit.c` 6/6、`canvas_aa.c` 19/19、`bridge_protocol.c` EXIT=0；
  `lume check examples/counter` 与 `examples/scroller` 均 `RESULT: PASS (4 steps,
  0 failed; exit 0)`，scroller 的 eval + R1-R7 layout 全 PASS、perf 如实
  `[SKIP] profile disabled`；`npm test --prefix tools/lume` 43 pass / 0 fail /
  1 skipped；playground 31-app（+scroller）与 browser simulator verify 全绿。
- **性能口径（核心交付）**：20fps 预算 50ms，emu JS 段 `js_avg_ms≈10`（模拟
  clock 粗粒度上界，host 实测 onDraw 0.682ms/帧）；每模拟秒指令 112.6 Minsn/s
  vs counter 26.1（4.31×，wall `Minsn/s` 因宿主负载不可比）。按 r35b 的
  QSPI 理论口径，约 6 万 px/帧 ×2B×20fps = 2.4 MB/s = 40MHz 理论带宽的 12%。
  **结论：host/emu 口径下滚动类 @20fps 可行且有余量；真机帧率/触摸/PSRAM
  仍未验，不得声称硬件验收**。P1 flappy 立项的 spike 数据由此得到「模拟侧可行」
  这一半，接板 60s `lume-perf` p95/p99 仍是硬门槛。详见
  `docs/r83-scroller-report.md` 与 `artifacts/r83/`（原始日志/截图）。
- **纯 app/工具层**：未改固件 C，不重跑 `idf.py build/size`；emu 镜像复用同
  基线 `ac23133` 的 r81 构建（lume.bin sha256 一致），Flash Code / IRAM 零增量。
  浏览器配套补了 sprite natives 并修正 r81 renderer 在非零 (dx,dy) 的
  ImageData 越界 bug（首次被本 app 暴露）。
- **未做**：flappy 同构 mini demo（留 P1 评估）、真机验收、真 framebuffer
  平移（需新 C 原语）。

### r84 result — `lume.imgscale` RGB565 缩放原语（appended, milestone checkboxes untouched）

原生原语扩展路线清单第 2 项落地：`firmware/components/lume-engine/lume_imgscale.c`
注册 `lume.imgscale.scale(src, sw, sh, dst, dw, dh, mode?)`。Uint16Array 零拷贝
进出，nearest 与逐分量 8-bit 定点 bilinear 均实现，边界 clamp；返回 0/-1/-2/-3，
同视图同尺寸可原地拷贝、部分重叠同 buffer 拒绝。d.ts、生成的 `website/api.html`
（129 行）、host `prelude_runner.js` 与 browser playground 桩同步。

- **验证**：`node tests/imgscale.js` 7 项全绿（宿主 QuickJS 链接同一份 C：
  2x 上/下采样位模式、bilinear 手算 3x1->2x1 与中心 0x8410、5x4->9x7 参考比对、
  subarray 偏移守卫、错误码、原地拷贝）；`for t in tests/*.js` 0 FAIL / 453 条
  PASS/ALL；`npm test --prefix tools/lume` 43 pass / 0 fail / 1 skipped；
  `lume check examples/counter`（`EMU_SKIP_BUILD=1` + 预置镜像）R1-R7 全 PASS；
  `gen_api_docs.py --check` 与 `check_website.py` 全绿。
- **固件 size**：首次标准构建在 ldgen 阶段遇到 `quickjs.c.obj` 0 字节（host
  swap 卡死），按 r78/r82 先例仅对该目标以 `-O2` 末尾加 `-g0` 单独重编后构建
  成功。最终 Flash Code **2,024,560 B**，DIRAM 247,267 B，**IRAM 16,384/16,384、
  Remain 0 硬线守住**。同 worktree 临时回退 C 接线测得 fc2534d 基线
  Flash Code **2,022,792 B**，故 imgscale 净增 **+1,768 B**；对比 r82 报告基线
  2,021,336 B 为 +3,224 B（含 r83 的 app 层增量）。`lume_imgscale.c.obj` 自身
  `.text` 1788 B + `.literal` 180 B + `.rodata` 34 B = 2002 B，`.data/.bss` 为 0，
  无 IRAM 段。
- **取舍**：写调用方 Uint16Array（结果直喂 `retainImage`），非路线清单原文建议的
  r79 直写 Canvas work buffer；bilinear 不处理 0x0000 透明/颜色 key，透明语义留
  渲染层。分数维度拒绝而非截断。详见 `docs/r84-imgscale-report.md`、
  `docs/KNOWN-SIMPLIFICATIONS.md` 与 `artifacts/r84/`（原始日志）。
- **未做/待验**：可选消费方 demo（image_gallery 缩略）未加；缩放耗时、缩略视觉、
  与 retainImage 串联吞吐、PSRAM 余量与 bundle 推送均待接板，不声称硬件验收。

### r85 result — `lume.image.decode` 像素出口 + gallery 缩略（appended, milestone checkboxes untouched）

r84 登记的可选消费方尾巴已收：`firmware/components/lume-engine/lume_image_decode.c`
注册 `lume.image.decode(bytes, maxW?, maxH?)`，复用 `lume_image_decode_ex`；
返回 `{width,height,pixels:Uint16Array}`（RGB565 颜色面，PNG 的 A8 面丢弃），
PSRAM 缓冲拷入 JS 堆后立即释放。可选的 maxW/maxH 复用 r84 抽出的共享缩放核心
`lume_imgscale_pixels`（同 16384 上限/整数校验；重叠规则在新建缓冲场景不适用）。
`examples/image_gallery` 的 TF 图片改走 decode -> 96x96 -> `retainImage` 缩略，
无卡回退内嵌 1x1 PNG；点按看大图未做（已登记）。

- **验证**：新增 `node tests/decode.js`（宿主 QuickJS 直链同一份 decode /
  imgscale / RGB565A8 C 源 + 最小合成 PNG 的 zlib 解码 shim）5 项全绿；
  `for t in tests/*.js` 0 FAIL / 493 行 / 458 条 PASS/ALL；
  `npm test --prefix tools/lume` 43 pass / 0 fail / 1 skipped；
  `lume check examples/counter` 与 `lume check examples/image_gallery`
  均 RESULT: PASS（后者 eval 2x，布局无 expectations）；
  `gen_api_docs.py --check`（130 条）与 `check_website.py` 全绿。
- **固件 size**：QuickJS 汇编再次遇 host swap 卡死，按 r78/r84 先例仅对该目标
  `-g0` 单独重编后构建成功。Flash Code **2,025,296 B**（r84 基线 2,024,560，
  +736 B），DIRAM 247,267 B 不变，**IRAM 16,384/16,384、Remain 0 硬线守住**；
  `lume_image_decode.c.obj` 自身约 938 B 代码+常量，`.data/.bss` 为 0。
- **取舍/未做**：PNG alpha 平面丢弃、缩略 nearest 质量、错误码 -3 透传、
  内存峰值与点按看大图均已写入 `KNOWN-SIMPLIFICATIONS.md`。全部结果为主机/
  构建证据，不代表板上验收。详见 `docs/r85-imgpix-report.md` 与 `artifacts/r85/`。


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
- **C：`audio.recordStream` + `audio.stopStream`**——r72 已实现：64 KiB PSRAM RX 环、独立音频任务、八块有界引擎队列与最旧块淘汰；首个受益者 `examples/spectrum`。E 刀可直接复用 16 kHz PCM 帧上行，真机时延与双向 DMA 并发仍待接板验收。
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

## 原生原语扩展路线（2026-11-16 立项，模式已由 r78/r79 验证）

背景：QuickJS 解释执行对**批量数值/像素/密码学**负载慢 1-2 个数量级（r78 实测
`lume.math.vecAdd` host 单样本 82×），但 UI 状态计算（signals 粒度属性更新）在
JS 里已是微秒级——瓶颈不在语言层。结论：**不换语言，按 r78/r79 模式给
`lume.*` 加 C 原生原语**，JS 只做编排；app 热更新卖点不变。既有先例：
`lume.math`（零拷贝 Float32Array，r78）、`lume.raycast`（C 渲染直写 Canvas
work buffer，r79）、`lume.svg`（mini-SVG 光栅化，r58）。

### 契约纪律（每刀必须遵守）

- 硬件 API 契约不变式：0 成功/负值失败；typed array 用
  `JS_GetTypedArrayBuffer` 零拷贝，访问期间不回调 JS（r78 模式）。
- 渲染类原语写 Canvas work buffer + 走正常 invalidate 发布（r79 模式），
  不绕过 ui-bridge。
- 纯计算类放独立 `firmware/components/lume-<name>/` 组件；新代码全在
  flash `.text/.rodata`，IRAM 16384 硬线 Remain 0 不得突破（每刀 `idf.py size`
  贴数）。
- host harness 必测：正确性（Float32 位模式比较）+ 带偏移视图 + 类型/长度错误
  + 性能对照（JS vs native，标注 host 单样本不代表 ESP32-S3）。
- `.d.ts` 同步 + `gen_api_docs.py --check` 通过 + browser playground stub
  同步（宿主 prelude_runner 与 website/playground/runtime.js 都要有桩）。

### 候选清单（按价值序，逐刀评估后再派）

1. **`lume.fft`（P1，音频可视化直接受益）**——radix-2 实数 FFT，
   512/1024 点 Float32，单帧 <5ms（C 循环估算）。消费方：music_player 频谱
   视图、录音波形、语音助手 VAD 能量条。接口：`fft(re, im?, out?)` +
   `magnitude(out, re, im)`。host 基准：JS 蝶形 vs native。
2. **`lume.imgscale`（P1，图片/精灵通用）**——RGB565 最近邻 + 双线性缩放，
   写 Canvas work buffer（r79 模式）。消费方：image_gallery 缩略、游戏 sprite
   缩放、图片查看器双指缩放。零拷贝进出。
3. **`lume.crypto`（P2，配网/OTA/WS 鉴权）**——SHA-256 + HMAC + CRC32 +
   AES-CTR（封装 esp-idf mbedtls，不自己实现）。消费方：WS 鉴权签名、OTA
   校验、配网 token。接口全部 typed array 进出。
4. **`lume.compress`（P2，热更新大包/日志）**——deflate/raw 解压（miniz 级
   单文件实现 vendored）。消费方：bundle 压缩传输（256KiB 上限内装更多）、
   日志/历史数据压缩存储。解压优先（压缩 JS 侧用不上）。
5. **`lume.raymarch`/`lume.particles`（P3，演示效果类）**——按需立项：
   raycast 模式的推广（体素/粒子系统整帧 C 渲染）。只有具体 demo app 拉动
   时才做，不做无消费方的投机 API。
6. **`lume.dsp`（P3，随语音助手 C/E 刀评估）**——Goertzel 单频检测、
   RMS/峰值、简单 IIR 滤波。与 `lume.fft` 合并考虑，不单独立项。

### 排除项（评估过，不做）

- **通用 JS 引擎加速（编译 JS→native）**：超出「原语」范畴，等于换运行时，
  已在引擎调试基建路线否决过同款思路。
- **每个小函数都下放**：属性赋值/字符串拼接/signals 更新留在 JS（r78 报告
  已明确位置坐标更新由调用方负责）——下放粒度以「批量×重复×数值」为准绳。
- **Rust 实现组件**：2026-11-17 调研结论（GitHub API 实查 esp-rs/Slint/wasm3
  star 与活跃度、Slint 授权条款、社区先例）——**不迁移，维持 JS+C 下沉现状**：
  ①Slint 嵌入式固件 GPLv3 传染或商业付费，与 MIT + 开放 app 生态定位冲突
  （硬否决）；②Rust→WASM 需嵌 wasm3 双解释器，性能 ≈ native/11 与 QuickJS
  同量级，负收益；③Xtensa Rust 工具链（espup fork）绑版本跟进延迟；④渲染
  非瓶颈（LVGL 全帧 SW 2-4ms，天花板在 QSPI 43fps，引擎无关）。保留观察位：
  Slint 授权模式变化可重估；「不受信任第三方 Rust app 沙箱」需求出现时重估
  wasm3 路线；内存安全增量优先在现有 C 层做（freestanding 宏隔离，mini-SVG
  先例）。API 契约不受影响——本路线原语仍按 C 实现。


### 里程碑口径

每刀交付：组件 + d.ts + host harness（正确性/位模式/偏移视图/错误/性能对照）
+ `idf.py size`（IRAM Remain 0）+ playground/browser stub 同步 + 真机 pending
清单。第一个先例刀建议 `lume.fft`（消费方最明确）。


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
| **俄罗斯方块**（已落地 `3bfa796`，见 `docs/r62-tetris-report.md`） | 经典品类在 ESP32 生态已被反复验证（LED 矩阵/小屏实现众多），但圆屏高分辨率彩色版缺位 = 差异化空间。10×20 格缩放进 canvas，pan 手势横移 + tap 旋转 + swipe 软降，hiscore 走 `lume.storage.kv`（key ≤15 字符） | 网格类 = canvas 最舒适区（games_2048/breakout 先例）；方块预览+next 提示用双 canvas 或分区重绘；纯 app 层，无缺口 |
| **闭环目标环表盘**（已落地 r63，见 `docs/r63-ringface-report.md`；智能手表原生风格：三同心环 complications） | r48 原生 AA `ctx.arc`：三条进度弧及三条低亮度轨道；步数估算接 IMU 或 demo 数据、电量接 PMIC、站立计数接 timer | watchface 第 4 面已接入 swipe 循环；每帧六条原生弧、46,656 px 脏区；纯 app 层 |
| **模块化信息格表盘**（已落地 r64，见 `docs/r64-modular-report.md`；智能手表 modular 风格：多 complication 网格） | 一次演示主题+Card+signals+轮询全家桶：天气/电池/温度/日历小格，数据源接 `lume.net.httpRequest` 与本地传感器 | watchface 第 5 面已接入 swipe 循环；零 canvas——卡片走原生 View/Text（canvas 全 app 预算 228,544/230,400 px 已满）；纯 app 层 |
| **桌面宠物**（已落地 r65，见 `docs/r65-pet-report.md`；像素电子宠物：喂食/抚摸/作息） | 触摸=抚摸、长按=喂食、翻腕（IMU）=惊醒——单点触摸+IMU 全用上；像素动画走 fillRect 预计算 spans（gravity_ball 模式）；**热更新 = 皮肤商店独有卖点**（换宠物/换装免刷机） | `examples/pet/app.js`：16×16 像素表 → spans 预计算，每拍只重画脏区（闲置 72–96×12 px，睡时不重绘）；状态机纯 JS；两套皮肤 + `lume.storage.kv` 记忆，热更新换肤；host + esp32sim 验证，纯 app 层 |

### P1 — 第二批（有差异化亮点或需性能 spike）

| 候选 | 价值与复刻要点 | 可行性口径 |
|---|---|---|
| **一键飞行（Flappy 类）**（已落地 r105，见 `docs/r105-flapdot-report.md`；`examples/flapdot/`：单点触摸拍翅 + hash 确定性柱对 + 难度渐窄缺口 + KV hiscore） | 单点触摸玩法与硬件形态天作之合；障碍柱水平推进 = 镜头动场景，脏区只救局部动 | 🟢 纯 app 层落地：单 480x400 canvas（192,000 px < 230,400 预算），柱体为原生 fillRect 分带（未走 drawImage，spike 的 blit 路线留作后续优化）；脏区实测稳态增量最大 20,680 px/帧；KV `hisc.flapdot`（12 字符）；host harness 13 组 + 60s smoke 全绿。**接板 60s p95/p99 实测仍是硬门槛**，真机未验（r83 spike 结论继续有效） |
| **康威生命游戏**（已落地 r66，见 `docs/r66-conway-report.md`） | 触摸播种种细胞 + 观察演化，「圆屏上的涌现」演示价值高、实现极小；演示 retained paths（静态网格线）+ canvas（活细胞）分层 | `examples/game_of_life/app.js`：33×33 环面网格 / 9px 格落在 300×300 单 canvas 内（60×60×9px=540px 超出屏幕与 300px 预算，故按预算收敛为 33×33）；静态 72 段 retainSegments 上传一次，活细胞按代脏区重画；实测每代脏区 648–729px = 全帧 0.72–0.81%；代际 200/350/500ms 三档，纯 app 层 |
| **记忆翻牌**（已落地 r75，见 `docs/r75-memory-report.md`；**扫雷已落地 r76**，见 `docs/r76-minesweeper-report.md`） | 单点触摸网格游戏最低成本品类；与 games_* 不重复（都是新玩法）；hiscore 走 KV | `examples/memory/app.js`：4x4 = 8 对原创像素面（berry/sun/cloud/leaf/heart/star/bolt/ring）spans 预计算，tap 翻牌 / 两张比对 / miss 两帧回扣；KV `hisc.memory`（11 字符）最少步纪录；单 canvas 480x480 = 230,400 px 恰满预算；12 例 harness 含负向（重复翻同一张、三张连翻保护）；纯 app 层。**`examples/minesweeper/app.js`（r76）**：10x10 + 15 雷，首击 3x3 必安全（首击后布雷），tap 翻开（显式栈 flood fill）/ 长按插旗（旗格不可翻、不被 flood 掀开、不计入胜利），踩雷全揭晓；数字 5x7 / 旗雷 7x7 像素字形 spans 预计算（spanBuilds=10）；KV `hisc.mine`（9 字符）最快时间纪录；网格 398x398 harness 锁边；15 例 harness 含 20 板可解性；纯 app 层 |
| **流体粒子沙盒**（IMU 晃动 + 触摸扰动） | 宣传效果天花板：圆屏 AMOLED 上粒子随重力流转 | ⚠️ 参考社区同款实证需降级到 200-300 粒子（JS 单线程无 SIMD）；粒子间作用用简化近似（网格邻域）；IMU 单位是 m/s² 非 g |
| **双八度触屏钢琴**（已落地 r67，见 `docs/r67-piano-compass-report.md`） | 经典乐器品类，单点触摸 + pan 滑奏天然适配；演示 play/playStream 混合音频合成与 in-place 键位高亮 | `examples/piano/app.js`：14×34 px 白键一行 + 10 黑键压缝，24 音两八度 + 三档八度移调；基频+2 泛音+指数包络的立体声 PCM，attack ≤48 ms 走 play、release 5×1152 帧走 playStream，包络函数连续避免切换爆音；Demo 曲内置小星星；纯 app 层 |
| **惯性方位角仪表**（已落地 r67，同上战报） | 手表/仪表品类；retained paths 静态刻度环 + 每帧指针脏区 + 常正数字；演示 demo / IMU 双模式 | `examples/compass/app.js`：36 段 retainSegments + 2 条 retainPath 一次上传；demo 18°/s 平滑旋转并可拖动，IMU 模式积分陀螺 Z 得**相对**航向并加 DRIFT 徽章；**无磁力计，不承诺地理北**；浏览器无 IMU 自动降级 demo；纯 app 层 |
| **体感挥杆迷你高尔夫**（程序化关卡） | IMU 挥杆速度触发击球——手表形态差异化王牌（手机做不了）；关卡程序化生成无素材依赖 | 挥杆检测用 QMI8658 加速度峰值阈值（gravity_ball impactSpeed 先例）；物理简化为 2D 坡度+摩擦；纯 app 层 |
| **街机风格射击**（已落地 r68，见 `docs/r68-retro-report.md`；5×11 三档编队 + pan 炮台/tap 射击） | 复古合集首刀；编队整体脏区 ≈26% 全帧、两帧腿部动画同盒重画、UFO 加分 + 波次提速；像素造型为原创近似 | `examples/invaders/app.js`：mario 式 spans 预计算精灵；Game Boy 三档绿；KV key 由 `hiscore.invaders`（16 字符）因 NVS 15 字符上限收敛为 `hisc.invaders`（13 字符）；20ms emu tick 无掉帧日志；纯 app 层 |
| **公路河道穿越**（已落地 r68，同上战报；13 行网格：5 车 + 4 河 + 2 安全 + 中线 + 窝） | 复古合集同批；tap 相对青蛙中心判四向、车辆撞死/浮木承载/落水死/5 窝过关提速；行带独立脏区 | `examples/frogger/app.js`：车/木/蛙全 spans 预计算；NES 灰底低饱和彩块；跳跃简化为瞬移+高亮（登记取舍）；KV `hisc.frogger`；纯 app 层 |
| **推箱子**（已落地 r69，见 `docs/r69-retro2-report.md`） | 益智品类补齐复古合集；标准推箱规则 + 10 关内嵌 + par 最少步 + 过关解锁；swipe 四向推箱为主、tap 相邻格为辅；角位死锁 QoL | `examples/sokoban/app.js`：10 关 11×7 ASCII 表（≤13×10），BFS 解算器在 harness 证明每关可解且 par = 最优步数；墙/地板/目标/双态箱/玩家全 spans 硬边；瞬移+高亮（r68 同款简化）；KV `hisc.soko_pg`（`hisc.soko_progress` 18 字符超 NVS 15 字符上限，已收敛）；纯 app 层 |
| **Game & Watch 风格双游戏 LCD**（已落地 r69，同上战报） | 「segment LCD style」原创形态：所有可能段位以极低对比度常显、激活段高亮，仿非背光透传 LCD 物理特性；MODE 切两小游戏，辨识度高 | `examples/lcd_dual/app.js`：幽灵段 `ctx.retainSegments` 一次上传 2 条（124/99 段）、逐帧 `drawPath` 回放、零 JS 几何；GAME A 接面包（3 段式掉落、3 漏结束）/ GAME B 三车道闪避（一撞结束）；MODE 走单一手势目标避免按钮/画布双触发；KV `hisc.lcd`；**不复刻任何原机造型**；纯 app 层 |

### Retro classics（r68 起的新分组）

本刀起，roadmap 在「经典 app 复刻生态」下新开**Retro classics**叙事行，收编自研、原创近似的街机/益智/段码 LCD 风格像素游戏（不点名原商标、不逐像素复制原始精灵位图）。已落地四款：`examples/invaders/`、`examples/frogger/`（r68）、`examples/sokoban/`、`examples/lcd_dual/`（r69），均在 playground 26-app 列表内；像素字体统一沿用 14px Montserrat，真机手感/帧率/音效待接板验收。详见 `docs/r68-retro-report.md`、`docs/r69-retro2-report.md` 与 `docs/KNOWN-SIMPLIFICATIONS.md`（r68/r69）。

### 幼儿教育（r70 起的新分组，非复刻线）

与上面的社区复刻候选**无关**：教育品类自开叙事行，不放在 Retro classics / 复刻表里。已落地 `examples/abc123/`（`docs/r70-abc-report.md`、`docs/r73-abc-svg-report.md`）：36 张卡（A-Z + 0-9），顺序 / 随机 / 小写 / 竖排 Aa 对照四模式，全屏单手势点屏翻页 + 顶部 HUD 切模式，点击弹跳反馈，数字卡按值画实心圆点、A-E 配极简 Canvas 图标。Text 字号仍被 bridge 钉死在 14/20/32 三档；r73 将大字形改为 DejaVu Sans Bold 轮廓生成的 mini-SVG，由 Image 节点渲染。esp32sim 首卡解码明显较慢，真机翻页延迟、点屏/色彩/触感待接板验收。

### P2 — 有依赖缺口或需固件刀，如实标注后缓做

| 候选 | 价值 | 缺口（诚实原则） |
|---|---|---|
| **猜词游戏（Wordle 类）** | 热度高、每日一题适合「每天看一眼圆屏」粘性叙事 | 🔴 blocked：无键盘硬件 + Input/键盘组件未建（M5 组件缺口已登记）。变体路线：字母环选字（tap 旋转+确认）可绕开键盘，但输入体验打折 |
| **按住说话语音伴侣** | playStream/recordStream 的终极演示，与语音助手路线（见上节）E 刀合并 | 🔴 blocked：`audio.recordStream`（C 刀）未落地；实时对话链路时延是真机硬仗 |
| **全屏精灵卷轴游戏**（横向卷轴平台跳跃完整版） | mario 单屏已证明玩法链路；r83 已交 blit 卷轴 POC（`examples/scroller/`，含性能口径），钥匙已解除 | 🟡 r83 POC 落地（8 槽精灵全 drawImage、4 脏矩形/帧、20fps 模拟侧可行）；完整版仍需接板帧率/触摸验收与关卡/敌人系统，非纯复刻可照搬 |
| **真·指南针（磁北 / 地理方位）** | 要的是绝对地理方位，而非 r67 惯性方位仪表给的相对航向 | 🔴 blocked：QMI8658 是加速度计+陀螺仪六轴 IMU，**板子没有磁力计**，物理上无法测磁北；需外接磁力计硬件 + 固件刀（新 I2C 传感器绑定、校准/倾斜补偿），非 app 层可解。r67 仪表只登记为「惯性方位/相对航向」，README/UI 均不承诺指北 |

### 与现有 examples 的去重边界

2048/贪吃蛇（体感）/打砖块/单屏马里奥/重力滚球（游戏）、watchface 三面（表盘）、dashboard/speedometer/device_monitor（仪表）、music_player/ai_chat/typewriter（多媒体与 AI）已覆盖的玩法与形态不再重复立项；上表候选均按「新玩法或新形态」筛选。社区生态复刻的完整溯源（逐项 star、适配要点、排除名单及理由）溯源与排除名单留在项目内部调研档案（不入公开仓库），对外文档一律不点名外部项目。

### r90 result — fishtank 鱼形升级：r89 ellipse 图元回补鱼缸（appended, milestone checkboxes untouched）

纯 app 层刀（无固件改动）：`examples/fishtank/app.js` 鱼身从 r87 的 5 条变宽线段改为 4 站点 `fillEllipse` 椭圆链（沿鱼体轴采样，轴对齐图元贴合任意朝向），腹部叠浅色椭圆（深背浅腹）、条纹鱼叠深色横斑、背鳍/鳃线用小椭圆、眼睛用 `fillCircle`；绘制顺序按体型降序（近大远小）。每帧 137 次绘制调用（<200 断言，简报预算 250 未用满）。验证全绿：`tests/fishtank.js`（60s smoke + 觅食/进食/摆尾 + prelude 集成）、`lume check --no-emu` PASS、全量 `tests/*.js` 0 FAIL、`npm test` 43 pass/0 fail、playground 重生成（35 apps）、simulator verify.js 10 PASS、浏览器截图 3 张 vision 验收确认鱼形已圆润化（橙白条纹鱼可辨为小丑鱼风格）。取舍：最小体型鱼 4 站点仍偏蝌蚪感（加站点超预算）；真机 30fps/色彩/手感 pending board。详见 `docs/r90-fishtank-ellipse-report.md`。本轮引擎额度尽中断（engine_exit=1），主控接管收口。

### r91 result — `lume.crypto` 原生原语落地（appended, milestone checkboxes untouched）

原生原语扩展路线候选 #3（P2）落地，新增独立组件 `firmware/components/lume-crypto/`，
封装 ESP-IDF 自带 mbedTLS：`lume.crypto.sha256/hmacSha256/crc32/aesCtr`，不自己实现
SHA/HMAC/AES。契约按 r78/r79 的 `lume.fft`/`lume.imgscale` 变体：typed array 经
`JS_GetTypedArrayBuffer` 零拷贝、subarray 偏移生效、访问期间不回调 JS，全部返回
0/-码（CRC32 例外返回无符号值），定案为写入调用方 `out`（不返回新分配数组），
`.d.ts` 已写清。CRC32 用表无关反射 0xEDB88320 实现（mbedTLS 3.x 无 crc32，
IDF 的 esp_crc32_le 是 ROM 封装，host harness 用不了），非密码学原语。

host 编译方案取 (a)：用唯一命名的最小 mbedTLS config 把 IDF 的
`sha256.c+md.c+aes.c+platform_util.c+constant_time.c` 编入 host QuickJS runner，
直接编译**固件同一份** `lume_crypto.c`（证据强于并行 JS 参考实现）。踩过 config
被 `build_info.h` 同目录同名文件遮蔽、check_config 过早包含等坑，详见报告。
`node tests/crypto.js` 全绿：NIST SHA-256（空/abc/56B）、RFC 4231 HMAC 三例、
CRC32 0xCBF43926 + Node zlib/JS 交叉、SP 800-38A F.5 AES-128/256 CTR 加解密对称、
四类带偏移视图、-1/-2 错误路径；host 单样本 native 55.5x JS（不代表 ESP32-S3）。
`lume check examples/counter --no-emu` PASS、全量 `tests/*.js` 0 FAIL、
`npm test` 43 pass/0 fail、`gen_api_docs.py --check` 过（134 行 +4 crypto）、
`check_website.py` 无缺失/无发明。playground 与 prelude_runner 加 `lume.crypto`
桩（无 mbedTLS，返回 -3 标注 unsupported，可注入实现）。

固件改 C 必跑：基线 Flash Code 2027804 / Flash Data 850132 / DIRAM 247267 /
IRAM 16384(Remain 0) / Total 3019707；r91 后 2031220 / 850164 / 247267 /
16384(Remain 0) / 3023155，逐项 +3416 / +32 / 0 / 0 / +3448。IRAM 硬线未破，
新代码全在 flash `.text/.rodata`。基线 quickjs.c 汇编遇 host swap 卡死，按 r78/r82
先例仅对该 build 目标加 `-g0` 单独重编（不改源码/-O2），构建无新增警告。
接板验收（真机 mbedTLS/AES 硬件路径、WS/OTA/配网消费方接入、时延与功耗）未做，
仍 deferred；详见 `docs/r91-crypto-report.md` 与 `docs/KNOWN-SIMPLIFICATIONS.md`。

### r92 result — `lume.compress` 原生原语（appended, milestone checkboxes untouched）

原生原语扩展路线候选 #4（P2）落地，新增独立组件 `firmware/components/lume-compress/`，
vendored **miniz 3.1.0 `miniz_tinfl.c` 单文件**（Rich Geldreich，public domain/MIT，
解压专用 tinfl 子集，770 行；host ESP-IDF miniz.h 是 ROM 声明头不可用，LVGL
lodepng inflate 绑 malloc 侵入大，均排除）。只做解压不做压缩，符合简报「解压优先」
口径；不自己实现 inflate，不改任何 IDF/vendored 引擎源码。`lume.compress.inflate(src,
out, format?)`：写入调用方持有的 `Uint8Array`，返回字节数（空流 0），错误 `-1`
类型/`-2` 损坏流/`-3` out 太小；typed array 经 `JS_GetTypedArrayBuffer` 零拷贝、
subarray 偏移生效、访问期不回调 JS。zlib 模式由 tinfl 内置完整 header 校验
（CMF/FLG、CM=8、FDICT 拒绝）与 Adler-32 校验，故不另加无消费方的 `adler32` API。

host harness 取 r91 方案：用唯一最小 config 把 IDF 组件编进 host QuickJS runner
的先例不同——本组件无 mbedTLS 依赖，直接把**固件同一份** `lume_compress.c`
（含 `#include "miniz_tinfl.c"`）编入 runner。`node tests/compress.js` 全绿：Node
zlib 生成 fixture（空/高重复文本/RLE/随机 stored 70KB/>64KiB 动态 Huffman
111KB），raw+zlib 逐字节比对；截断流、坏 header、保留 BTYPE=3、坏 Adler 各负码；
out 太小 -3 且视图外守卫不变；带偏移双视图；类型/format/缺参错误路径；host 单样本
native 23ms vs Node zlib 40ms（后者是 native C 基准，均不代表 ESP32-S3）。
踩坑：tinfl `*pOut_buf_size` 是「已写字节数」出参而非剩余容量，已修正返回值。

`lume check examples/counter --no-emu` PASS、全量 `tests/*.js` 0 FAIL、
`npm test` 43 pass/0 fail、`gen_api_docs.py --check` 过（135 行 +1 compress）、
`check_website.py` 无缺失/无发明；playground 与 prelude_runner 加 `lume.compress`
桩（无原生 inflate，返回 -3 标注 unsupported，可 `options.compress` 注入）。

固件改 C 必跑：同 worktree 增量隔离基线 Flash Code 2,029,636 / Flash Data
850,164 / DIRAM 247,267 / IRAM 16384(Remain 0) / Total 3,021,571；r92 后
2,030,276 / 850,196 / 247,267 / 16384(Remain 0) / 3,022,243，逐项 +640 / +32 /
0 / 0 / +672。IRAM 硬线未破，新代码全在 flash `.text/.rodata`。接板验收（真机
DEFLATE 吞吐/时延、热更新大包与日志消费方接入、256KiB bundle 上限内实际压缩比）
未做，仍 deferred；详见 `docs/r92-compress-report.md` 与
`docs/KNOWN-SIMPLIFICATIONS.md`。

### r93 result — lvgl_task 事件驱动化（appended, milestone checkboxes untouched）

Vendored 魔改候选 #1（标「优先」）落地。**开工实证翻案**：简报/r35b 所述
「33 ms timer + 10 ms 固定轮询」已是过期快照；r92 基线 `lume_board.c:125-133`
早就是 `wait_ms = lv_timer_handler()` 驱动，只是封顶 10 ms（r36b commit
`62bb0ff` 引入，见 `docs/r36b-perf-report.md:9`）。r93 删掉封顶，改为
**到期睡眠 + 通知唤醒**：`ulTaskNotifyTake()` 按 `wait_ms` 睡到 LVGL 下一到期，
`LV_NO_TIMER_READY` → `portMAX_DELAY`；用 LVGL 自带的
`lv_timer_handler_set_resume_cb()`（vendored `lv_timer.c:375-382`；参考上游
`lv_nuttx_libuv.c:124-166`）让新建/恢复的 LVGL timer 立即唤醒，并以函数指针
注册 `lume_ui_bridge_set_wake_cb()` 让 Queue A post 立即唤醒（保持
`lume-board → lume-ui-bridge` 单向依赖不成环）。面板 sleep/wake 与抓帧路径
也主动唤醒。触摸由 LVGL indev timer 轮询、属于 deadline 集合；`lv_tick` 走
`esp_timer` 单调时钟，睡眠不令动画时长漂移；esp32sim 加载同一份
`lume.bin`（`run.sh:37-43`），无独立仿真循环，两条路径共用。

未改 vendored lv_conf / LVGL / QuickJS 源码，**无 VENDOR.md 变更**。

验证原始输出（全文见 `docs/r93-lvglev-report.md`）：固件 build+size 绿——
Flash Code 2,030,276 → **2,030,508（+232）** / Flash Data 850,196 不变 /
DIRAM 247,267 不变 / **IRAM 16384 Remain 0 硬线未破** / Total 3,022,243 →
3,022,475；QuickJS 汇编本轮未卡死，无需 `-g0`。全量 `tests/*.js` 51 pass /
0 FAIL，`npm test --prefix tools/lume` 43 pass / 0 fail / 1 skipped，
`lume check examples/counter --no-emu` PASS。emu（worktree 自己 build 的
r93 三件套 + `EMU_SKIP_BUILD=1`）launcher `<home>` 主屏 + counter 10 s、
fishtank 60 s、invaders 60 s 全绿，三份 serial.log 均 eval_ok=2 /
RELOAD ERR=0 / ui queue full=0；invaders 自然 game over 非崩溃。

收益口径（诚实）：**空载功耗/帧率上限量化收益 pending board**——5 ms
drain timer（`lume_ui_bridge.c:40,1811`）常驻使 `lv_timer_handler()` 总返回
≤5 ms，旧 `>10` 封顶在 r92 配置下是死代码，故删封顶**未改变空载唤醒频率**
（host/emu 可证，不代表 ESP32-S3）；r35b 的 30 fps 上限来自 33 ms 刷新
周期本身，本轮不改该配置、不宣称解锁帧率。可证的变化是事件响应延迟
（Queue A post 后立即 drain、timer 新建立即唤醒、`LV_NO_TIMER_READY` 时真睡
眠）。未做 drain timer 暂停优化（跨任务 LVGL API + 满队列回归风险），
若要真正压低空载唤醒频率另行评估。详见 `docs/r93-lvglev-report.md` 与
`docs/KNOWN-SIMPLIFICATIONS.md`。

### r94 result — 流体粒子沙盒 `examples/particles`（appended, milestone checkboxes untouched）

「经典 app 复刻生态 P1」候选落地为**纯 app 层**：220 粒子、单个 480x480
canvas（230,400 px = 全 app 预算，先例 examples/memory），物理用网格邻域位置式
分离 + 阻尼 + IMU 重力矢量做**简化近似**，明确不是 SPH/流体求解；每帧 1 次
dirty-union clear + 220 次 fillRect 小方块（恒 221 draw calls，harness 锁 <250），
禁逐粒子 fillCircle 全帧重画。`lume.imu.read()` 的 m/s^2 单位直接映射（静止
9.81 @ +Z，shake 用 `|a-9.80665|>4 m/s^2` 而非 g 阈值），无板/浏览器返回 null →
自动降级慢转重力 demo（compass 先例）；tap/swipe/STIR 按钮注入速度场；
`pt.mode` KV 存偏好（7 字符）。

零固件改动、零 `runtime/types/lume.d.ts` 改动。验证原始输出全见
`docs/r94-particles-report.md`：新 `tests/particles.js` 绿（粒子上限、221
draw calls/帧、30 s demo 无 NaN/无出界、触摸速度场、手势真 prelude 路径）；
全量 `tests/*.js` 52 文件 0 FAIL；`npm test --prefix tools/lume` 43 pass /
0 fail / 1 skipped；`lume check examples/particles --no-emu` PASS；playground
35→36 apps 重生成 + 浏览器 verify 全绿（顺手修正 verify.mjs 基线即僵化的
31 期望值为从 `LUME_SOURCES` 动态取）；`gen_api_docs.py --check` 与
`check_website.py` 绿。emu 60 s 真跑（从固件源码与基线逐字节相同的
r93 worktree 拷三件套，主仓 firmware/build 本轮为空）eval_ok=2 /
RELOAD ERR=0 / ui queue full=0，无崩溃；3 张 sim 截图 vision 自查粒子形态
可辨。诚实口径：emu 无 JIT 下 JS 57–257 ms（host 仅 1.5–2.5 ms，先例
invaders 93 ms），**不宣称 emu 20 fps 达标**；真机帧率/IMU 方向/触摸观感/
功耗仍 deferred。详见 `docs/r94-particles-report.md` 与
`docs/KNOWN-SIMPLIFICATIONS.md`。

### r95 result — voice_assistant 对讲机 demo `examples/voice_assistant`（appended, milestone checkboxes untouched）

语音助手路线 E 刀先行落地为**纯 app 层** legacy 同步模式 demo：
`IDLE→LISTEN→THINK→SPEAK` 全 signal 状态机，tap/longpress 唤醒与发送、
SPEAK 中 tap 立即 barge-in 回 IDLE、LISTEN 4 s 看门狗超时回 IDLE，非法迁移拒绝并记日志。
`lume.ai.chat` / `lume.audio.record` 同步阻塞的诚实处理：只翻 signal + 用
`setTimeout(...,0)` 错拍到下一帧再发起阻塞调用，**不宣称流式/不卡 UI**；
「发送→回复」抽象为单一 `vaTransport` 槽（`vaSetTransport` 注入，async-ready），
逐字上屏按 typewriter 先例只在 timer 写整数 signal，`Text` getter 拼串；
单 canvas 320×160 = 51,200 px（远低于 230,400 px 全预算），16 电平条 + 局部脏区，
每帧 18 draw calls。无 key/无网络/无 mic → canned 问答轮换 DEMO 模式，`MODE DEMO/LIVE`
徽章如实标注；UI 文案纯 ASCII（r64 纪律）。**零固件改动、零 `lume.d.ts` 改动**。

验证原始输出全见 `docs/r95-voice-report.md`：新 `tests/voice_assistant.js` 13 组绿
（合法性/帧错拍/barge-in/超时/轮换/逐字节拍/canvas 预算/ASCII/transport 注入/
LIVE 委托/音频降级）；全量 `tests/*.js` 53 文件 0 FAIL；
`npm test --prefix tools/lume` 43 pass / 0 fail / 1 skipped；
`lume check examples/voice_assistant --no-emu` 与 counter 哨兵均 PASS；
playground 36→37 apps 重生成 + 浏览器 verify 全绿（新增「无音频/网络进 DEMO 且可点按」
定向用例）；`check_website.py` 与 `gen_api_docs.py --check` 绿。
emu 12 s 烟测（主仓 build 为空，从固件源码与本基线逐字节同一的 r94 worktree
拷三件套，`EMU_SKIP_BUILD=1`）eval_ok=2 / RELOAD ERR=0 / ui queue full=0，
TFT 截图 vision 自查为完整 `MODE DEMO / IDLE` 主屏、非白屏。
未跑 `idf.py build/size`（零固件改动）。诚实口径：legacy 阻塞窗口真实存在、
无 ASR/TTS（canned prompt + beep 播报）、`MODE LIVE` 仅 harness 注入覆盖，
真机音频/时延/触摸 barge-in 手感/功耗 deferred to board bring-up。详见
`docs/r95-voice-report.md` 与 `docs/KNOWN-SIMPLIFICATIONS.md`。

### r101 result — 极光蒙版时钟 `examples/aurora_clock`（appended, milestone checkboxes untouched）

「经典 app 复刻生态」表盘向候选落地为**纯 app 层**极光时钟：单 480x480 RGB565
canvas 20 Hz 动画，三条约六枚重叠椭圆构成的光带 + 预计算重叠色补丁 + 径向渐层
retained 精灵，中央深色椭圆保数字对比度；三套主题（青绿/紫/蓝绿）四锚点 × 8 级
启动期 RGB 插值成 32 行查找表，逐帧只查表零混色。设备字体 32px 上限用「分钟变化
才重建的 76px 七段 retained 精灵」绕过；IMU ax/ay 低通滤波控整体偏移倾斜，静置
60s 相位步进降为 0.3 倍，触摸切主题并唤醒。常态 30 draw calls（上限 33），两枚
retained 精灵共 141,248 字节 < 460,800 字节精灵槽预算。

实施于 r99-aurora 分支（基线 18feda0，engine_exit=0，验证全绿后因 main 已被
skyfire 占用 r99 编号，本主控收口轮改号 r101 合入）。合并轮解 3 处冲突：
playground build.mjs 取 41-app 并集（顺带把 skyfire 轮 verify 报告的
clock_round/dashboard_round 40-vs-38 基线差异正式修复）、index.html script 列表
并集、sources.js 重生成。收口轮验证：`node tests/aurora_clock.js` PASS（含
per-frame draw calls max=30 断言与 60s 空闲漂移）；全量 `tests/*.js` **57/57
零 FAIL**；`lume check examples/aurora_clock --no-emu` 与 counter 哨兵双 PASS；
`npm test --prefix tools/lume` 44 pass / 0 fail；`check_website.py` 绿。截图见
`artifacts/r101/aurora-clock.png`（playground 实跑）与 r99 实施期三张时刻截图。
诚实口径：模拟器未实现 `Text.fontSize`，大数字由 retained 精灵绘制；20 fps 全屏
9.216 MB/s 像素写入为推算非实测；真机 CO5300 渐层台阶感、IMU 轴向/阈值、触摸
唤醒延迟、PMIC 电流均 deferred to board bring-up。详见
`docs/r101-aurora-report.md`。

### r105 result — 拍拍鸟 `examples/flapdot`（appended, milestone checkboxes untouched）

「经典 app 复刻生态」P1 Flappy 类候选落地为**纯 app 层**街机飞行：
单 480x400 canvas（192,000 px < 230,400 px 全预算），HUD 全走原生 Text
零 canvas 像素；世界模型 hash 确定性（柱 i 几何以索引为种子的 PRNG 导出，
host/device 逐位一致，整条赛道可从滚动距离单独重放）；难度 = 缺口宽度随
柱序号渐窄（GAP_STEP px 每 GAP_EVERY 根，GAP_MIN 下限）；柱对原生 fillRect
分带绘制（未走 drawImage，r83 spike 的 blit 路线留作后续优化）；KV
`hisc.flapdot`（12 字符，NVS 15 字符上限内）。r102 半成品经主控接管修复
收口（上一引擎轮派发即遇上游 429 限流零产出）：顶部柱碰撞矩形高度参数
错位（缺口上半段被误判致死）与 harness 碰撞用例滚动量用错（整组断言空转）
两处实锤修正，另加固 `pipeBand` 画布裁剪与三处用例口径。

验证原始输出全见 `docs/r105-flapdot-report.md`：新 `tests/flapdot.js` 13 组绿
（含 60s smoke：draws=114918 / paints=5648 / 稳态增量最大 20,680 px）；
全量 `tests/*.js` **59 文件 0 FAIL**；`npm test --prefix tools/lume`
43 pass / 0 fail / 1 skipped；`lume check examples/flapdot --no-emu` 与
counter 哨兵双 PASS；playground 41→42 apps 重生成 +
`tools/simulator/verify.js` 全绿；flapdot 浏览器实跑截图
`artifacts/simulator/flapdot_ready.png` / `flapdot_run.png`（vision 自查
HUD/鸟/地面渲染干净）。未跑 `idf.py build/size`（零固件改动）。
诚实口径：真机触摸手感、帧率、NVS 持久化、功耗均 deferred to board
bring-up，未声称硬件验证。详见 `docs/r105-flapdot-report.md`。

### r106 result — deploy manifest 绑定固件 API tag（app 兼容性安全网，appended, milestone checkboxes untouched）

承接上一轮 429 限流中断的半成品（2 文件 +152 行）：先逐文件 diff 审阅实证，
修正其偏离简报的 `.fwtag` sidecar 设计，改为 **CLI 查询设备 tag 写入 meta.json
`fw` 字段** 的方案，并接上此前未接线的 `lume_apps_tag_check()`。

固件：`LUME_API_TAG=1` 固化（bump 纪律写入头注释）；`lume_fwtag.h` portable
extract/decide 助手（固件与宿主 harness 共用）；`lume_apps.c` launch 校验 match 放行 /
mismatch 打印两个 tag 值并拒绝 / 无 fw 旧 app WARN 兼容；`lume_engine.c` 接线 boot
恢复（清 `.current`/`.boot` 回落 home）与 `request_launch_common`（JS launch + LAUNCH
命令共闸）；LUMC 新增 `FWTAG` 命令回 `CMD OK fwt <TAG>`，LAUNCH 被拒回
`fwt-mismatch`。CLI：`queryFirmwareTag()` Strict 校验、失败如实报错/降级不造假值；
deploy/dev 打标 meta.fw，`lume apps list` 标注 fw 与 MISMATCH。`lume.d.ts` API 面无
变化未改，`gen_api_docs.py --check` fresh。

验证原始输出全见 `docs/r106-fwhash-report.md`：全量 `tests/*.js` **59 文件 0 FAIL**；
`npm test --prefix tools/lume` 44 pass / 0 fail / 1 skipped；C harness
`apps_protocol` 41 checks / `fwtag_protocol` 14 checks 均 0 failure（覆盖 match /
mismatch / 旧 meta WARN 三路径）；`gen_api_docs.py --check` 绿；
`lume check examples/counter` 哨兵 PASS（r64 worktree 坑：拷三件套 + EMU_SKIP_BUILD=1）。
改 C 已跑 `idf.py build/size`：Flash Code **2,032,860 B**（对比最近基线 r93
2,030,508 为 +2,352 B；简报引用的 r82 基线 2,021,336 为 +11,524 B），Flash Data
850,644，DIRAM 247,267，**IRAM 16,384/16,384、Remain 0 硬线守住**，Total 3,025,275。
QuickJS 调试汇编遇 host swap 停滞，依 r78/r82 先例仅对 build 目录目标 `-g0` 后构建成功，
未改源码/优化选项。

诚实口径：无真机 deploy/launch 校验、无新固件 emu（哨兵用预构建图像），
端到端 mismatch 拒绝留接板轮；真机触摸/显示/功耗全部 deferred to board bring-up，
未声称硬件验证。

### r107 result — 语音网关 D 刀：协议先行 + 可插拔上游（appended, milestone checkboxes untouched）

交付：`docs/voice-gateway-protocol.md`（v1 逐字段定案：hello / hello-ack / text-delta /
state / error / text / end / pong；下行二进制 8 字节头含 version/type/format/rate/channels/
bits/seq；上行 60 ms 裸 PCM；错误码与 WS 关闭码映射）；`tools/gateway/`（Node >=18、
**零运行时依赖**，vendored RFC6455 握手/分帧 + 会话管理 + `UpstreamAdapter` 接口
`start(session)/sendAudio(pcm)/sendText?/stop()`，mock 上游 canned 问答 + 正弦/静音 PCM，
小智/三件直连各留 TODO 桩）；`tests/gateway.js` 宿主端到端 harness（10 用例）；本小节 +
`docs/KNOWN-SIMPLIFICATIONS.md` r107 取舍。README 未动。固件零改动，未跑 `idf.py build/size`。

先实证后写协议：简报称上行「16 kHz/16-bit/单声道，60 ms=960 samples=1920 B」，读码证伪——
`runtime/types/lume.d.ts` 974/986 与 `firmware/components/lume-audio/lume_audio.c` 331 明确
**channels 必须为 2、交错立体声、playStream 单块 ≤4608 B**，故 60 ms = 960 立体声帧 =
**3840 B**；固件 `recordStream.chunkSamples` 仅 512/1024/2048（默认 1024=64 ms），
设备侧需重组为 60 ms 线帧。协议按权威源码定案，harness 用 1920 B 负向用例证明该错帧被拒。

验证原始输出（本轮真实执行，非推断）：
- `node tests/gateway.js` → `PASS` ×10 + `ALL GATEWAY HARNESS CASES PASSED (10 cases)`，
  含未 hello 先发数据 / 1920 B 错帧 / 坏 JSON / 未掩码 WS 帧 / 上游断连 / v=2 版本守卫 6 条负向用例。
- 全量 `for t in tests/*.js; do node "$t" || echo FAIL "$t"; done` → 60 文件（基线 59 + 新增 gateway），
  533 行 `PASS`，`FAIL count: 0`。
- `npm test --prefix tools/lume` → `# tests 45 / # pass 44 / # fail 0 / # skipped 1`。
- `node tools/lume/lume.js check examples/counter --no-emu` → `RESULT: PASS (4 steps, 0 failed; exit 0)`。
- 网关 E2E smoke（mock 网关 + 模拟设备客户端双方日志）：网关侧 `[gateway] hello` → 5×
  `uplink.pcm bytes=3840` → `turn.end` → `session.close code=1000`；设备侧 `open` → `send.hello`
  → `hello-ack` → `send.uplink frames=5 totalBytes=19200` → 29 条 text-delta（28 字符 + final）
  → 3 条 audio（header version=1/type=1/format=1/16000/2ch/16-bit，payload 3840 B）
  → `state=idle` → `close`。

诚实口径：mock 链路只证明协议与网关自身正确、字段/分帧/关闭/异常路径成立；
**网关↔真实 ASR/LLM/TTS（小智官方或三件直连）未接、上游选型未拍板**，无 API key 处理；
无 TLS/鉴权，沿用 LAN 信任模型；无真机验证、无 playStream 边收边播时延、无双 DMA 并发验收。
可选的 app 层 `vaSetTransport` WS 工厂本轮未做（避免触碰既有 59 文件回归面）。

### r96 result — WiFi OTA 推送通道 HMAC 鉴权升级（appended, milestone checkboxes untouched）

M4「WiFi OTA channel」代码链路收口。读码实证：TCP 传输 + 帧解析在 r26 已落地
（`lume_hotreload.c` 的 lwIP socket server + 便携 `lume_frame.c`），本轮真正兑现的是
r91 `lume.crypto` 在路线图登记的消费方「OTA 鉴权」：明文 token 比对升级为
**HMAC-SHA256 挑战-响应**（每连接 `esp_random` 16 B 挑战、token 从不上线、防重放），
并补 `lume.ota.status()/setToken()`、`lume deploy --host <ip>`（CLI 用 node:crypto，
复用同一 `protocol.js` 帧序列化）与串口 `lume token <32hex>` 设 token 入口。端口保持
8765（webserv 8080 无冲突）；新组件/并入 lume-net 均不采用——transport 与共享帧 parser
已在 r26 同处一组件，拆分会制造组件环或大规模 include 重写，登记为「明确为何分层」取舍。
token 首次设置走既有 LUMC 命令帧的串口 `TOKEN <hex>`（最小侵入），web 路径/TLS/mDNS/
固件镜像 OTA 未做。

验证：`tests/*.js` 53 文件 0 FAIL（新增 `tests/ota_auth.js`，56 checks 0 failures，
真实 mbedTLS HMAC 跑 RFC 4231 + CLI 向量 + 重放负向）；`apps_protocol.c` 43 checks 0 fail；
`npm test --prefix tools/lume` 44 pass / 0 fail / 1 skipped；counter 哨兵 PASS
（`EMU_SKIP_BUILD=1`，三件套为本次新构建镜像）；固件构建绿（QuickJS 目标按 r78/r82
先例 `-g0`，无源码/-O2 改动），Flash Code 2,033,760（r95 实际基线 2,030,508，
+3,252）/ Flash Data 850,388 / DIRAM 247,291 / IRAM 16384 Remain 0 硬线不破 /
Total 3,025,919。`gen_api_docs.py --check` 与 `check_website.py` 绿（137 行）。
真 WiFi、实测时延、真板 token 流程 deferred to board bring-up，不声称硬件验收。
详见 `docs/r96-ota-report.md` 与 KNOWN-SIMPLIFICATIONS。

### r108 result — voice_assistant WS transport 对接 lume.net.ws（E 刀收口；appended, milestone checkboxes untouched）

交付：`examples/voice_assistant/app.js` 新增 GATEWAY 模式的 `vaTransportWS`（`lume.net.ws`
薄客户端），按 `docs/voice-gateway-protocol.md` v1 走完 hello → 60 ms recordStream 上行 →
text-delta 逐字上屏 → 下行音频 playStream → state/idle + close 全轮；`vaSetTransport()` 槽
与 `IDLE→LISTEN→THINK→SPEAK` 状态机零改动，无网关/非函数注入回落 legacy canned。
网关 URL 走 KV `voice_gateway_url`（顶部常量 `VA_GATEWAY_URL` 默认
`ws://192.168.1.50:18770/`，CLI 默认 8765 需对齐）；`examples/voice_assistant/README.md`
写用法/协议指针/取舍；`tests/va_ws.js` 用 r107 零依赖 mock 网关 + prelude_runner 桥接
`_connect/_send/_close` 跑全轮，6 用例含 3 条负向；本小节 + `docs/r108-va-ws-report.md`
（原始输出全录）+ KNOWN-SIMPLIFICATIONS r107/r108 登记。固件零改动、未跑 `idf.py build/size`。

先实证后写：读 `lume.d.ts:714-731`（`onClose()` 无关闭码、`onMessage(string|ArrayBuffer)`）+
`lume_ws.c:63-101` + `lume_scripts.c:60-118`（`handle.close()` **同步**触发 `onClose`）后定案；
上行仍是 3840 B 立体声（非错误的 1920 B 单声道），原生 1024 帧=4096 B 块由 app 重组。
实施中实测 barge-in 竞态：先 close 再标记 finished 会被同步 `onClose` 抢先改 SPEAK→IDLE，
改为先标记再 close（`vaWSAbort()`），harness 负向用例覆盖。

验证原始输出摘录（本轮真实执行，全录见 `docs/r108-va-ws-report.md`）：
- `node tests/gateway.js` → `PASS` ×10 + `ALL GATEWAY HARNESS CASES PASSED (10 cases)`，r107 不回归。
- `node tests/va_ws.js` → `PASS` ×6 + `ALL VA WS HARNESS CASES PASSED (6 cases)`：
  happy（hello → 3×3840 B → end → 9 delta → 3 audio → idle/close → IDLE）、
  **3 负向**（网关拒连 / 中途上游断连 / 致命 upstream_error，均回 IDLE 不挂死）、
  barge-in end 送达、无网关回落 legacy。
- 全量 `for t in tests/*.js; do node "$t" || echo FAIL "$t"; done` → `EXIT:0`，
  `FILES:62`（基线 61 + 新增 va_ws）、`FAIL_COUNT:0`、`PASS_LINES:531`。
- `npm test --prefix tools/lume` → `1..46 / # pass 45 / # fail 0 / # skipped 1`，EXIT:0。
- `node tools/lume/lume.js check examples/voice_assistant --no-emu` → `RESULT: PASS (4 steps, 0 failed; exit 0)`；
  哨兵 `examples/counter --no-emu` → `RESULT: PASS`。
- E2E smoke 双方日志：网关侧 `hello` → 3×`uplink.pcm bytes=3840` → `turn.end` →
  `session.close code=1000`；设备侧 `VA WS HELLO` → `VA WS ACK` → 3×`VA WS UPLINK frames=N`
  → `VA WS SEND END` → 8×`VA WS DELTA n=... chars=1..8` → 3×`VA WS AUDIO hdr=1/1/1/16000/2/16`
  → `VA WS STATE idle` → `VA WS CLOSE` → `VA WS REPLY chars=8 audio=3 deltas=9`。

诚实口径：host harness 只证明协议字段与 app 逻辑正确；**网关仍是 mock 上游，真实
ASR/LLM/TTS 未接、选型未拍板**，无 API key / TLS / 鉴权（LAN 信任模型）。真机 WiFi 下
WS 稳定性、时延预算、双 DMA 并发、playStream 边收边播时延、触摸 barge-in 手感 deferred
to board bring-up，**未声称硬件验证**。commits 拆分、未推送。

### r109 result — 1.75" 圆屏板 profile 复核 + 顶栏等宽 + 宿主 harness（B1；appended, milestone checkboxes untouched）

基线 `bccc073`。**实证纠偏**：简报假设"1.75c 只接了 Kconfig、驱动未补齐"已被读码推翻——
r86（HEAD 祖先）已落地 1.75c 全量 profile、CO5300 vendor init + 6 列 CASET 偏移、
CST9217 双轴镜像映射、无 TF 卡 SD 守卫、直接 GPIO 复位（无 TCA9554），且被
`lume_display.c` / `lume_touch.c` 现有宏路径消费；`git log -20` 无 r110 B1 半成品。
本轮不重做，只做增量：① profile 头注释与 boards README 的过时陈述纠正；② 新增
freestanding C 静态断言 `tests/board_175c_profile.c` 锁定第 1 节三类差异的宏契约
（pins/IC 型号宏/几何/SD 宏缺席/无 expander/映射）；③ 新增 `tests/statusbar_round.js`。

StatusBar 纯 JS 修复：移除硬编码 `width:432/x,y:24`，按 `__lumeScreen` + r104
`safeInsets(shape, size)` 派生几何；新增可选 `shape:'square'|'round'`。480 方屏仍是
432/24/24（2.16/1.8 不回归），368 宽屏 clamp 到 320（修复溢出），466 圆屏 round
模式宽 329、位于 (68,68)，与 r104 SafeArea View 等宽且不越过安全方块右边界 397；
显式 x/y 仍优先，非法 shape 抛 TypeError；`runtime/types/lume.d.ts` 同步。

验证原始输出全录见 `docs/r109-round16-report.md`，摘要：模型守卫 green；双板
`idf.py build && idf.py size` 绿——默认 2.16 Flash Code **2,032,588**（简报 r106 基线
2,032,860，−272 B，增量≈0）/ Flash Data 850,836 / DIRAM 247,291 / IRAM 16,384/16,384
Remain 0 / Total 3,025,195；1.75C Flash Code 1,988,068 / Flash Data 839,916 / DIRAM
246,855 / IRAM 16,384/16,384 Remain 0 / Total 2,969,407，配置证据
`CONFIG_LUME_BOARD_..._1_75C=y` + 32 MB flash。两板首次编译窗口内 QuickJS 正常完成、
未现 swap 停滞，第二次增量即刻 RC=0，**未用 `-g0`**；tracked `sdkconfig` 已还原，
worktree 无脏配置。板级静态断言 harness 7 行 PASS（含 2 条编译期 `#error` 负向守卫）；
`statusbar_round.js` 6 用例 PASS（含 2 条负向）；全量 `tests/*.js` 63 文件 0 FAIL
（新增 statusbar_round；缺 esbuild 依赖用主仓已声明依赖符号链接接入，未装新依赖）；
`npm test --prefix tools/lume` 45 pass / 0 fail / 1 skip；counter 哨兵 PASS。

诚实口径：无真机，全部宿主证据；触摸方向、init 序列实机正确性、PMIC/音频/复位/
持久化/bundle 推送 deferred to board bring-up，不声称硬件验收；不做运行时切板、
多板 CI；M5 框仍 `[ ]`。KNOWN-SIMPLIFICATIONS r109 已登记三类差异来源与
"未真机核对"状态。commits 拆分、未推送。

### r110 result — 多板 CI 矩阵（firmware.yml 三板构建；appended, milestone checkboxes untouched）

基线 `99ea903`。上轮（r109 推送后的 r110 引擎轮）引擎遇 429 限流中断于收口前
（`/tmp/lume-r110-run.log`：`429 ... 重置` + `engine_exit=0`），但工作树证据显示
实现与验证均已实质完成、仅差收口（无 commits、roadmap 缺 result 小节）。本轮
主控接管收口：逐文件审阅未提交改动（firmware.yml +62/-5、KNOWN-SIMPLIFICATIONS
r110 小节、boards/README out-of-scope 更新），独立复核证据链后按原意补记 result
并拆 commits 推送；未改动任何实现内容。

实现要点（均已在文件内注释/文档登记）：① firmware.yml 三板 matrix（2_16/1_8/
1_75c，板名引号防 YAML 1.1 整数化），每板经 `SDKCONFIG_DEFAULTS` overlay 构建；
② CI 命令强制 `rm -f sdkconfig` 前置（r44 gotcha：tracked sdkconfig 覆盖
defaults → 三板假绿）；③ 新增 Board-config evidence 步骤（grep 板宏/flash size/
分区表进 CI 日志）；④ artifact 名加板后缀；⑤ Release 决策：tag 跑全矩阵、三板
artifact 均上传，但 Release 资产只从默认 2.16 job 组装（扁平五件套字节兼容，
1.8/1.75c 无真机验收不发布二进制——不夸大就绪度）。

主控独立复测摘录（本轮真实执行）：
- `python3 -c yaml.safe_load(firmware.yml)` → YAML OK。
- 三板 overlay 文件存在性核查：`firmware/boards/{2_16,1_8,1_75c}/sdkconfig.defaults`
  全部在位。
- 引擎轮双板构建证据复核（/tmp/r110-build-18.log、/tmp/r110-build-175c.log，均
  RC=0）：1.8 板 Flash Code **2,051,456** / Total 3,043,783；1.75c 板 Flash Code
  **1,988,068** / Total 2,969,407；与默认 2.16 板（r109 基线 2,032,588）三板数字
  互异 → overlay 确实生效，非 r44 假绿。1.75c 构建目录 sdkconfig.h 板宏证据：
  `CONFIG_LUME_BOARD_WAVESHARE_ESP32_S3_TOUCH_AMOLED_1_75C 1` +
  `CONFIG_ESPTOOLPY_FLASHSIZE "32MB"`。
- 收口后全量宿主回归不适用（本轮零 C/JS 改动，仅 CI YAML + docs），counter
  哨兵等留引擎轮证据。

诚实口径：CI 矩阵只在 CI 侧真正跑通后才算完全验收（本轮推送 main 后由
firmware.yml push 触发自行验证，三板绿 + 板宏证据齐全即闭环）；三板真机验收
仍全部 deferred；运行时切板仍 out of scope；M5 "Board abstraction" 的 HAL 收敛
仍 `[ ]`（本轮只闭环其 CI 半边）。commits 拆分（ci/docs）、推送。

### r111 result — tests.yml 修复：crypto harness 的 mbedTLS 闭包在 CI 可复现（appended, milestone checkboxes untouched）

主控轮顺手修复：`Host regression matrix` 自 r96 OTA 合入起连续 3 次 failure
（44312373088 / 44319740684 / 44330891041，均死于 "JS host harnesses" 第 14 项
`tests/crypto.js`：`mbedtls/sha256.h: No such file or directory`）。根因是
r91/r96 两个 crypto harness（`tests/crypto.js`、`tests/ota_auth.js`）把 mbedTLS
根路径 hardcode 成 `/opt/esp/esp-idf/components/mbedtls/mbedtls`——开发机有
ESP-IDF 所以一直绿，CI runner 没有 → 潜在 CI-only 断裂，红了两天无人察觉
（调度轮只盯引擎，无人看 CI）。

修法（覆盖式，不缩水门禁）：① 两个 harness 的 mbedTLS 根改为
`LUME_MBEDTLS_ROOT` env 优先、IDF 路径回退（本机行为不变）；② tests.yml 新增
"Provision pinned mbedTLS" 步骤：下载 Mbed-TLS **v3.6.2** 官方 tarball
（sha256 校验 `f4a876b1…`，与 ESP-IDF v5.5.5 同代），解包后
`LUME_MBEDTLS_ROOT=/tmp/mbedtls` 注入 `GITHUB_ENV`；同一 r91 最小 config 头
编译固件同一份 `lume_crypto.c`。

主控独立验证（真实执行）：pinned tarball 路径下 `node tests/crypto.js` 全绿
（SHA-256 NIST / HMAC RFC 4231 / CRC32 / AES-CTR SP 800-38A / 偏移视图 / 错误
契约，host 比率 60-63x）；`node tests/ota_auth.js` 56 checks 0 failures（新路径
+ 无 env 回退路径都跑过）；全量 `for t in tests/*.js` 64 文件 0 FAIL；
`yaml.safe_load(tests.yml)` OK。诚实口径：CI 侧真绿以 push 触发的
Host regression matrix 运行为准；本地证据只能证明 provision 步骤的正确性。

### r112 result — fw-sync 修复：ROM ELF 提取从未成功过（appended, milestone checkboxes untouched）

主控轮修复：`Sync firmware to website` 自 r74（2026-11-16）创建起**每次运行都
failure**（连续 15+ 次，含 44357435742 @ 3313ff0），无人察觉——调度轮只盯引擎，
CI 红了三天。表现为 "Fetch mask ROM ELF" 步骤死于
`tar: */esp32s3_rev0_rom.elf: Not found in archive`。

根因（本轮实证）：下载官方 esp-rom-elfs-20241011.tar.gz 并 `tar tzf` 列目录——
`esp32s3_rev0_rom.elf` 位于**归档根目录**（无 `esp-rom-elfs-*/` 前缀），而
yml 用 `--strip-components=2 --wildcards "*/esp32s3_rev0_rom.elf"` 提取，
`*/` 模式在根目录成员上永不匹配（tar 对根目录成员返回 exit 2）。即该步骤
**从未成功过**，Pages 上的固件三件套停在 11-16（`lume.bin` 2,994,512 B），
firmware.yml 之后产的新固件全部没同步上网站。

修法：改为按成员名直接提取
`tar xz -C website/wasm/fw esp32s3_rev0_rom.elf`（无 strip、无 wildcards）。
本地实证：下载同一 tarball → 提取出的 `esp32s3_rev0_rom.elf`（949,552 B）
与仓库内现役副本 `cmp` 逐字节一致 → 修法正确且不引入内容漂移；
`yaml.safe_load(fw-sync.yml)` OK。诚实口径：workflow 真绿以本 push 触发的
fw-sync 运行为准（其 firmware.yml 触发条件 workflow_run conclusion=success +
每夜 21:00 UTC 兜底 cron 双通道，修复后首轮即可验证）。
board-only 项不涉及（纯 CI YAML 改动，零固件/JS 变更）。

### r113 result — 语音网关真实上游 OpenAI 兼容适配器（D 刀续；appended, milestone checkboxes untouched）

上游二选一悬案拍板：**OpenAI 兼容路线**（合规——用户自备 key、env 注入、零 key 入
git；生态——`/audio/transcriptions` + `/chat/completions` + `/audio/speech` 三段兼容
端点一族通用）。落地 `tools/gateway/upstream-openai.js`：与 MockUpstream 同签名的
`OpenAICompatibleUpstream`，CommonJS、零新 npm 依赖、Node 18 内置 fetch/FormData/
Blob。PCM 先攒后发（v1 非流式 ASR），44 B WAV 头 + 立体声下混单声道，TTS 24k mono
线性插值重采样到 16k stereo、3840 B 帧序下行，文本按句/定长 delta 上屏，idle 收口
不持连接。每段 30 s 超时、单轮最多 1 次重试（1 s）、429/5xx/401/超时按 §7 映射、
不挂死不重试风暴。`stop()` 时序先读码实证：server.js `end` 控制经 `_stopUpstream()`
触发（协议 §4.6 即收口本轮），但设备 close / 致命错误也调 → 用 `isOpen()` + 音频帧
计数 + 静默兜底定时器守卫；`stop()` 幂等、不取消在途响应、不调 `session.close()`。
下行接口实证为 `session.sendAudio(fmt, pcm)`（无 `sendAudioOut`）。

CLI 接线 `--upstream openai` + `OPENAI_*` env（BASE_URL / API_KEY / STT / CHAT / TTS /
VOICE / 可选 CHAT_BASE_URL）；无 key 报清晰错误 exit 2，`mock` 默认不变。零新依赖、
零固件/JS runtime 改动。docs 补协议 §8.1、KNOWN-SIMPLIFICATIONS 登记、示例 README
同步。commits 拆分（upstream / test / docs），不推送（主控轮负责 push）。

验证（原始输出见本轮会话）：
- `node tests/gateway_upstream.js` 16/16 PASS（WAV 头/下混、chat 体、chat base 覆盖、
  TTS 体、24k→16k 重采样、帧数、delta 顺序/final、idle 收口、401/5xx/超时负向、
  429 恢复、零音频、stop 幂等）。
- `node tests/gateway.js` 10/10、`node tests/va_ws.js` 6/6 不回归。
- 全量 `for t in tests/*.js` 64 文件 0 FAIL（本地 `node_modules` 用已有安装软链，
  未装依赖、未入 git）。
- `npm test --prefix tools/lume` 46 tests / 0 fail（45 pass + 1 skipped）；
  `lume check examples/voice_assistant --no-emu` 与 counter 哨兵 `--no-emu` 双 PASS。
- 集成 smoke：真实 `cli.js --upstream openai` + 本地假端点 + device-sim 一轮全通
  （hello → uplink×5 → end → delta×3 → audio×17 → idle → close 1000），假端点命中
  stt=1/chat=1/tts=1，双方日志见本轮会话。

诚实口径：无真机、不出网、无真实 API key / 端点；真机 WiFi、时延预算、双 DMA
并发、barge-in 中断上游全部 deferred。宿主假端点证据为准。零固件改动，`lume check
examples/counter` 全 emu 模式在本 worktree 报 emulator 120s timeout（与本轮改动无关，
`--no-emu` 哨兵 PASS）。

### r114 result — OpenAI 上游 chat 段 SSE 流式化（appended, milestone checkboxes untouched）

chat 段由"非流式 POST + `splitTextDeltas` 伪切块"改为 `stream:true` +
`text/event-stream` 真流式：`for await...of` 读 `res.body`，按 SSE 行格式（空行分
事件、`data:` 拼接、`:comment` 忽略、`[DONE]` 终止、半行缓冲）解析，每个
`choices[0].delta.content` 即时 `sendTextDelta(content, false)` 并累计完整文本供
TTS / 空回复判断；正常收口恰好一条 `final=true`。错语义：SSE 头接受后的中断保留
已发 delta + 一条带截断标记的 final，按非 fatal `upstream_error`（同 401）处理且
不重试（重试会重复上屏）；头之前失败维持 r113 映射与 1 次重试。`stop()` 仅在
"静默定时器先启动管线且 chat 正在读"时复用 `AbortController` 中止读流；STT/TTS
在途仍建议性不取消。TTS 仍整段一次性（streaming TTS deferred）；
`splitTextDeltas()` 保留为导出工具但流式路径不再调用。固件 / app JS 零改动。

验证（原始输出摘录）：
- `node tests/gateway_upstream.js` → `ALL GATEWAY UPSTREAM CASES PASSED (20 cases)`
  （原 16 case 全绿 + 4 新 case：split-line/CRLF/comment/`[DONE]` + 累计文本 TTS、
    mid-stream disconnect 收口、stop abort、非 SSE 200 无回退）；连续 5 次重跑均
  20/20。
- `node tests/gateway.js` → `ALL GATEWAY HARNESS CASES PASSED (10 cases)`；
  `node tests/va_ws.js` → `ALL VA WS HARNESS CASES PASSED (6 cases)` 不回归。
- 全量 `for t in tests/*.js` → 仅 `done`，0 FAIL（64 文件）。
- `npm test --prefix tools/lume` → `# tests 46 / # pass 45 / # fail 0 / # skipped 1`。
- `node tools/lume/lume.js check examples/voice_assistant --no-emu` →
  `RESULT: PASS (4 steps, 0 failed; exit 0)`；`examples/counter --no-emu` 同 PASS。
- 集成 smoke（假 SSE 端点 + 真 `cli.js --upstream openai --port 18799` + device-sim）：
  fake `chat stream=true` @10.411，三条 `chat.delta` @10.412 / 10.472 / 10.532，
  `chat.done` @10.591；device `recv.text-delta seq0/1/2` @10.414 / 10.473 / 10.533，
  `final=true seq3` @10.595，17 帧 audio @10.632，`idle` + `close(1000)`，
  `text="HELLO FROM THE SSE STREAM."`；TTS input 为累计全文；gateway 日志无 error；
  `SMOKE PASS`。delta 逐条到达时间戳与 fake 端点写入节奏一一对应（约 60 ms 间隔），
  证明为真流式而非伪切块。

诚实口径：无真机 / 无出网 / 无真实 key；真机 WiFi、SSE 长连接稳定性、流式 TTS、
barge-in deferred。零固件改动，`lume check` 双 `--no-emu` 哨兵 PASS，未跑 `idf.py build`。

### r115 result — 设备 REPL（串口逐行 eval，引擎调试基建 P4；appended, milestone checkboxes untouched）

帧协议新增第 4 种 magic `LUMR`（与 `LUME`/`LUMC`/`LUMB` 共用 12B 头 + CRC-32，
侵入最小：只加一个 magic 分支），payload = 一行 UTF-8 JS 表达式。固件侧 RX 任务
解析到 REPL 帧后，把表达式复制到引擎自有 staging slot 并 post `LUME_EVT_REPL`；
引擎在 inner event loop 的事件处理点、**当前 app 的 `s_ctx` 上同步 `JS_Eval`**
（不回收 runtime、不在 RX/LVGL 任务上碰 QuickJS），`JS_ToString` 取结果，异常
捕获回传错误文本。结果经既有 reply sink 回传为有界报文
（`REPL OK/ERR <len> <trunc>` + `R64<base64>` 行 + `REPL END`），输出先经
`lume_repl_clamp()` 截到 2048B 并置 trunc 标记；OTA 的 64B 回复契约未动。
CLI 新增 `lume repl [--port] [--eval "..."]`，`--eval` 走一次发一条退出。
鉴权沿用原通道（USB 信任 / TCP HMAC），未新增鉴权面。

验证（原始输出摘录，详见 `artifacts/r115-build.log` 与本轮会话）：
- 固件构建（`VIRTUAL_ENV` 剔除 / `IDF_PYTHON_ENV_PATH` 指向 py3.12 env，未触发
  QuickJS 汇编 swap 卡死，无需 `-g0`）：`Built target lume.elf` / `Built target app`，
  `idf.py size` → `Flash Code 2034220`（r109 基线 2032588，+1632 B）、
  `IRAM 16384 100.0% Remain 0`（与基线一致，未突破）、
  `Total image size: 3027147 bytes`，`lume.bin 0x2e3140`，
  `Smallest app partition ... 0x35ced0 bytes (54%) free`。
- `npm test --prefix tools/lume` → `# tests 50 / # pass 49 / # fail 0 /
  # cancelled 0 / # skipped 1`（基线 46 tests / 45 pass / 0 fail / 1 skipped，
  新增 4 条 REPL 协议单测：frame layout/CRC、parseFrame 负向、clamp 截断、R64 解码）。
- `node tests/repl_protocol.js` → 7 行 `PASS: ...` +
  `ALL REPL PROTOCOL CASES PASSED`（编译真实 `lume_frame.c`，字节级断言 + 坏 CRC /
  空 payload / 超长 / 截断标记 / UTF-8 往返 + 源码常量交叉校验）。
- 全量 `for t in tests/*.js; do node "$t" >/dev/null 2>&1 || echo "FAIL $t"; done; echo done`
  → 仅 `done`，0 FAIL。新增枚举触发 `tests/ota_protocol.c` 的 `-Werror=switch`
  后已补 `LUME_FRAME_EV_REPL` 计数分支，`node tests/ota_auth.js` 复跑
  `56 checks, 0 failures -> PASS`。
- 哨兵：`node tools/lume/lume.js check examples/counter --no-emu` 与
  `examples/voice_assistant --no-emu` 均 `RESULT: PASS (4 steps, 0 failed; exit 0)`。

诚实口径：无真机，未做板级 REPL 收发——`tools/gateway/device-sim.js` 是 WebSocket
gateway 模拟而非串口 REPL 设施，无可复用的端到端 REPL 通道，故 **端到端 deferred
to board**；宿主层证据为真实帧编解码 + 引擎 eval 路径的静态核对 + CLI 解析/smoke。
PAUS 语义、app 切换过渡窗口丢弃、无多行续行/历史补全等取舍见
`docs/KNOWN-SIMPLIFICATIONS.md`。commits 按 feat / test / docs 拆分，不推送。

### r117 result — 流式 ASR（上行帧到即转写；翻案 r113「先攒后发」；appended, milestone checkboxes untouched）

协议 v1.1 追加下行 `transcript-delta`（`v/type/seq/text/final`，seq 与 text-delta/audio
各自独立；`final=true` 是**完整定稿全文**而非增量，先于 chat 首 delta，恰好一条）。
线上 `v` 仍为 1，旧设备忽略未知下行 type。网关侧新增可插拔转写 WS 适配
（`tools/gateway/asr-stream.js` + `upstream-openai.js`）：`sendAudio()` 帧到达即转发，
握手未完成时 PCM 与 end-of-audio commit 一起排队 flush；interim 即时
`transcript-delta(final=false)`，收口一条定稿；配置 `OPENAI_STREAM_ASR=1` +
非空 `OPENAI_ASR_WS_URL` + 设备 `hello.caps.streamTranscript` 双门未满足则回退 r113
一次性 REST（不产生 transcript-delta）。转写流错误选"回退 REST"，不引入新错误码、
不重复定稿。设备 app 用整数/单片 signal 驱动，LISTEN/THINK 显示 `YOU: <转写>`、
SPEAK 显示助手文本，分时互不覆盖；device-sim `--legacy` 覆盖旧设备忽略路径。
固件零改动。

验证（原始输出摘录）：
- `node tests/gateway_upstream.js` → `ALL GATEWAY UPSTREAM CASES PASSED (34 cases)`
  （r116 的 27 case 全绿 + r117 新增 7 case：interim seq / 单条定稿早于 chat /
  帧到即转时间戳 / 双门回退 REST / stop 中止转写流 / 流错降级 / 握手前 end 的 commit 排队）。
- `node tests/gateway.js` → `ALL GATEWAY HARNESS CASES PASSED (11 cases)`
  （新 case 用真会话验证 transcript seq 0/1/2 与 text seq 0/1 独立）；
  `node tests/va_ws.js` → `ALL VA WS HARNESS CASES PASSED (7 cases)`（新 case 验证
  app 消费 3 帧转写、答案未被覆盖、定稿日志早于首条 chat delta）。
- 全量 `for t in tests/*.js; do node "$t" >/dev/null 2>&1 || echo "FAIL $t"; done; echo done`
  → 仅 `done`，0 FAIL（软链 `/home/ubuntu/lume/tools/lume/node_modules` 以补齐 esbuild，
  未装依赖、未入 git）。
- `npm test --prefix tools/lume` → `# tests 50 / # pass 49 / # fail 0 / # cancelled 0 / # skipped 1`。
- 哨兵：`node tools/lume/lume.js check examples/voice_assistant --no-emu` 与
  `examples/counter --no-emu` 均 `RESULT: PASS (4 steps, 0 failed; exit 0)`。
- 集成 smoke（假转写 WS + 假 chat SSE 慢速逐字 + 假 TTS + 真
  `cli.js --upstream openai --port 18870` + device-sim；原始日志见
  `artifacts/r117-smoke.log`）：
  ```
  [gateway 18:36:17.597] hello sessionId=s1 device={"model":"lume","fw":"r117"} streamTranscript=true
  [device  18:36:17.599] send.uplink frames=5 bytesEach=3840 totalBytes=19200
  [device  18:36:17.599] send.end
  [FAKE-ASR 18:36:17.606] open path=/asr auth=Bearer smoke-key-not-real
  [FAKE-ASR 18:36:17.608] recv.audio n=1 bytes=3840
  [FAKE-ASR 18:36:17.608] send.interim text=HELLO
  [FAKE-ASR 18:36:17.609] recv.audio n=2 bytes=3840
  [FAKE-ASR 18:36:17.609] send.interim text=LUME
  [FAKE-ASR 18:36:17.609] recv.commit -> send.final
  [device  18:36:17.609] recv.transcript-delta seq=0 chars=6 final=false all="HELLO "
  [device  18:36:17.609] recv.transcript-delta seq=1 chars=4 final=false all="HELLO LUME"
  [device  18:36:17.611] recv.transcript-delta seq=2 chars=10 final=true all="HELLO LUME"
  [device  18:36:17.749] recv.text-delta seq=0 chars=7 final=false
  [device  18:36:17.773] recv.state state=speaking
  [device  18:36:17.774] recv.audio seq=0 bytes=3848 ... rate=16000 channels=2 bits=16
  [device  18:36:17.926] recv.text-delta seq=2 chars=0 final=true
  [device  18:36:17.926] recv.state state=idle
  [device  18:36:17.927] close ack=true uplink=5 deltas=3 audioFrames=34 text="HELLO. THIS IS THE ANSWER. " txDeltas=3 txText="HELLO LUME" legacy=false
  [gateway 18:36:17.927] session.close sessionId=s1 code=1000
  ```
  定稿转写 @17.611 早于 chat 首 delta @17.749（138 ms），中间转写与 5 帧上行
  时间戳一一对应；假端点 REST `/audio/transcriptions` 未命中，TTS 命中 2 次
  （两句各 17 帧，共 34 帧）。全链路顺序：转写 interim → 定稿 → chat delta →
  音频 → idle → close(1000)，`SMOKE PASS`。

诚实口径：无真机 / 无出网 / 无真实 key；上游转写事件形状为适配性假设（单点收口
`asr-stream.js`，可在接真实端点时替换），真机 ASR 时延 / barge-in / 旧设备实际行为
全部 deferred。固件零改动，未跑 `idf.py build`（--no-emu 哨兵足够）。commits 按
feat / test / docs 拆分，不推送（主控轮负责 push）。

### r118 result — 字母环猜词 Wordle 变体（纯 app 层；appended, milestone checkboxes untouched）

P2 表登记的猜词游戏此前 🔴 blocked 于键盘硬件缺口；本轮落地其**变体路线「字母环选字」**，绕开键盘 / swipe，全程单手 tap。新建 `examples/wordring/app.js` + `tests/wordring.js`，并重新生成 playground（43 apps，纳入 wordring）。固件零改动，不动 P2 候选表与任何 milestone checkbox。

玩法：5 字母英文词、6 次机会。屏幕下方 A-Z 26 字母排成椭圆环；tap 左弧旋转回退、tap 右弧旋转前进、tap 环心把选中字母放进当前槽（大号选中字母显示在环心补偿小字形可读性）。DEL 退格、ENTER 提交；不足 5 字母或重复猜测均被拒绝且不扣次数，游戏结束后所有操作锁定。判定绿=位置对 / 黄=词中有位置错 / 灰=词中无，重复字母用「先数词内计数、再从左到右扣减」两遍算法。答案表内嵌 743 个 5 字母常用词（纯 ASCII 小写）随机抽词；KV `wr.streak` / `wr.best`（9/7 字符 < 15）记连胜与最少尝试。HUD / 6x5 猜测网格 / 字母环分区，单 canvas 480x430 = 206,400 px < 230,400 预算；5x7 A-Z 像素字形预计算成 run-length spans（28 键 = 26 字母 + 2 箭头）。全部文案 ASCII（r64）。

验证（原始输出摘录）：

```
$ node tests/wordring.js
PASS wordring UI strings ASCII-only (r64 font rule)
PASS wordring dictionary: 743 unique five-letter ASCII words, all self-green
PASS wordring glyphs: 28 five-by-seven glyphs decoded to valid spans
PASS wordring verdict: green/yellow/grey + input immutability
PASS wordring duplicate letters: two-pass count, no over-awarding
PASS wordring new game + rotation: wrap 0..25 both directions
PASS wordring confirm/backspace: lowercase slots, full guard
PASS wordring submit guards: short + duplicate rejected, no attempt spent
PASS wordring win: verdict all green, streak + best persisted
PASS wordring loss: 6 tries, streak reset, board fully locked
PASS wordring best: fewer overwrites / worse and equal keep
PASS wordring KV: keys <= 15 chars, storage failures non-fatal
PASS wordring canvas budget: 206400/230400 px, grid and ring in bounds
PASS wordring prelude boot: full paint, HUD attrs, span draw stream
PASS wordring tap pipeline: rotate/confirm, DEL/ENTER/NEW, KV write
PASS wordring ~60 s smoke (taps=120, submits=39, restarts=14, draws=90779, paints=187)
ALL tests/wordring.js PASSED
```

- 全量 `for t in tests/*.js; do node "$t" >/dev/null 2>&1 || echo "FAIL $t"; done; echo done` → 仅 `done`，0 FAIL。
- `npm test --prefix tools/lume` → `# tests 50 / # pass 49 / # fail 0 / # cancelled 0 / # skipped 1`。
- 哨兵：`node tools/lume/lume.js check examples/wordring --no-emu` 与 `node tools/lume/lume.js check examples/counter --no-emu` 均 `RESULT: PASS (4 steps, 0 failed; exit 0)`（bundle 分别 13656 / 2160 bytes）。
- playground 重生成：`PASS bundle wordring 13656 bytes` / `PASS esbuild-wasm assets and 43 editable sources` / `PASS prelude 67016 bytes; 43 apps`；顺带同步了此前遗留的 voice_assistant 生成物（r108/r117 改动未重生成）。
- emu：主仓与 worktree 均无 build 三件套（bootloader.bin / partition-table.bin / lume.bin），且本轮零固件改动按纪律不跑 `idf.py build`，故 emu 不可用；`--no-emu` 哨兵足够。

诚实口径：真机环形交互手感、触摸命中半径、帧率 deferred to board；无词典校验、无每日一题、随机抽词等取舍见 `docs/KNOWN-SIMPLIFICATIONS.md` r118 节。commits 按 feat / test / docs 拆分，不推送（主控轮负责 push）。

### r119 result — 语音网关设备鉴权：hello token 门（D 刀续；appended, milestone checkboxes untouched）

D 刀最后一个产品化缺口收口：`tools/gateway` 此前对设备侧零鉴权，任意能连上 WS 端口的
客户端发一个 `hello` 即可触发真实上游（chat/TTS/ASR 配额）并收下行音频。本轮新增
**可选共享 token 门**（env `GATEWAY_DEVICE_TOKEN`，CLI `--device-token` 覆盖）：未配置
= 开放 LAN 模式（向后兼容，零行为变化）；已配置 = 锁定模式，hello 必须带追加字段
`auth.token`，校验插在 `v` 校验之后、上游适配器初始化之前，失败即 `error(unauthorized)`
+ close 1008，不回 hello-ack、不建上游会话、不发任何上游请求。等长比较用
`node:crypto.timingSafeEqual`。设备侧 app 新增 KV `voice_gateway_token`（默认 `''`，
空则不带 auth 字段），`device-sim` 加 `--device-token` 两路可切换。**零固件 / runtime
改动**。协议 §2/§4.1/§6/§7/§8.2/§10 已登记，取舍见 KNOWN-SIMPLIFICATIONS r119 节。

实证纠偏：读码确认 `vaTransportWS` 内 hello 原组装点、`server.js` 的
`not_hello → unsupported_version → hello-ack → _startUpstream` 顺序、§8.1.1 的
`PREFIX_SETTING` env 风格均与简报假设一致，无需纠偏；唯一补充是 §10 原文需保留后再
追加 r119 验证口径。

验证（原始输出摘录）：

```
$ node tests/gateway.js
PASS r119: open mode + hello without auth -> full round unchanged
PASS r119: locked + hello without token -> unauthorized + 1008 + zero upstream calls
PASS r119: locked + wrong token -> unauthorized + 1008 + zero upstream calls
PASS r119: locked + correct token -> full round, upstream engaged
PASS r119: locked + audio before hello -> not_hello wins over token gate
ALL GATEWAY HARNESS CASES PASSED (16 cases)        # 基线 11 -> +5，无回归

$ node tests/gateway_upstream.js
ALL GATEWAY UPSTREAM CASES PASSED (34 cases)       # 基线 34，无回归（不经过 createGateway）

$ node tests/va_ws.js
PASS r119: device KV token -> hello.auth -> locked gateway full round
PASS r119: app token mismatch -> fatal error -> IDLE, no upstream, not hung
ALL VA WS HARNESS CASES PASSED (9 cases)           # 基线 7 -> +2，无回归

$ for t in tests/*.js; do node "$t" >/dev/null 2>&1 || echo "FAIL $t"; done; echo done
done                                               # 0 FAIL

$ npm test --prefix tools/lume
# tests 50 / # pass 49 / # fail 0 / # cancelled 0 / # skipped 1

$ node tools/lume/lume.js check examples/voice_assistant --no-emu
RESULT: PASS (4 steps, 0 failed; exit 0)           # bundle 11321 bytes
$ node tools/lume/lume.js check examples/counter --no-emu
RESULT: PASS (4 steps, 0 failed; exit 0)           # bundle 2160 bytes
```

集成 smoke（真 `cli.js --upstream openai --device-token` + 本地假 STT/chat/TTS +
真 `device-sim`，两端原始日志见 `artifacts/r119-smoke.log`）：

```
[SMOKE] fake upstream port=38123 gateway port=45481 mode=locked (token value withheld from log)
[gateway] ready url=ws://127.0.0.1:45481/ deviceAuth=on
--- PASS A: locked gateway + WRONG device token ---
[device ] send.hello auth=on
[gateway] protocol.error sessionId=s1 code=unauthorized message=device token mismatch fatal=true
[device ] recv.error code=unauthorized fatal=true message=device token mismatch
[device ] close ack=false uplink=0 deltas=0 audioFrames=0 auth=on
[gateway] session.close sessionId=s1 code=1008
[SMOKE] PASS A: unauthorized + 1008, upstream requests=0
--- PASS B: locked gateway + CORRECT device token ---
[device ] recv.hello-ack sessionId=s2 audioFormat=pcm_s16le_16000_2ch
[device ] send.uplink frames=5 bytesEach=3840 totalBytes=19200
[FAKE-UP] POST /audio/transcriptions bodyBytes=9909
[FAKE-UP] POST /chat/completions stream=true bodyBytes=196
[device ] recv.text-delta seq=0 chars=7 final=false
[FAKE-UP] POST /audio/speech pcmBytes=48000
[device ] recv.audio seq=0 bytes=3848 ... rate=16000 channels=2 bits=16
[device ] close ack=true uplink=5 deltas=3 audioFrames=17 text="LOCKED MODE OK." auth=on
[gateway] session.close sessionId=s2 code=1000
[SMOKE] PASS B: full round, upstream requests=3 stt=1 chat=1 tts=1
```

`npm run build:playground --prefix tools/lume` → `PASS bundle voice_assistant 11321 bytes` /
`PASS esbuild-wasm assets and 43 editable sources` / `PASS prelude 67016 bytes; 43 apps`；
`python3 scripts/check_website.py` → `API missing/invented/duplicates: none`。
worktree 原缺 gitignored 的 `tools/lume/node_modules`，已软链主仓安装使测试可跑（不入 git）。
固件零改动，按纪律不跑 `idf.py build` / `idf.py size`。commits 按 feat / test / docs 拆分，
不推送（主控轮负责 push）。

### r120 result — 语音网关多轮记忆与可配置人设（D 刀续；appended, milestone checkboxes untouched）

基线 HEAD `270a715`；分支 `r120-gw-memory`。commits：`773a84d` feat / `50962c5` test /
docs（本条）。不推送。零固件 / runtime 改动，按纪律未跑 `idf.py build` / `idf.py size`。

实现：`DeviceSession` 持有有界 `ConversationHistory`（默认 N=12 / 8192 字符预算，env
`GATEWAY_HISTORY_LIMIT` / CLI `--history-limit`，`0` = r119 逐字节等价）；OpenAI 上游在
chat `messages` 的 system 与 user 之间注入历史，`_finalize()` 在 `await p.promise` 后把
final 文本汇总追加为 assistant；`GATEWAY_SYSTEM_PROMPT` / `--system-prompt` 覆盖默认人设，
日志仅记 `systemPrompt=custom|default`；`session.close`（任意 code）清空历史；可选
`--multiturn` 会话保活使同连接多轮可读历史，默认关闭保持每轮 close 语义。**设备协议帧
零变化**（历史是网关内部状态，不进帧；无新增控制帧）。

验证（原始输出摘录）：

```
$ node tests/gateway.js
PASS r120: two turns carry user+assistant history; close clears; reconnect fresh
PASS r120: history-limit=0 degrades to single-turn (r119 body)
PASS r120: window keeps only the most recent N pairs (oldest dropped first)
ALL GATEWAY HARNESS CASES PASSED (19 cases)          # 16 基线 + 3 r120

$ node tests/gateway_upstream.js
PASS r120: two turns on one session inject prior user+assistant into chat body
PASS r120: history-limit=0 keeps r119 single-turn body (real adapter)
ALL GATEWAY UPSTREAM CASES PASSED (36 cases)         # 34 基线 + 2 r120

$ node tests/va_ws.js
ALL VA WS HARNESS CASES PASSED (9 cases)             # 设备侧协议帧零变化自证

$ for t in tests/*.js; do node "$t" >/dev/null 2>&1 || echo "FAIL $t"; done; echo done
done                                                  # 0 FAIL

$ npm test --prefix tools/lume
1..50
# tests 50 / # pass 49 / # fail 0 / # skipped 1

$ python3 scripts/check_website.py
API: 139 catalog entries, 139 type declarations, 33 function namespaces
API missing: none / API invented: none / API duplicates: none
```

集成 smoke（真 `cli.js --upstream openai` + 本地假 STT/chat/TTS + 真 `device-sim --turns 2`，
token 门开、两轮连续对话；两端原始日志见 `artifacts/r120-smoke.log`）：

```
[SMOKE] fake upstream port=37529 gateway port=41749 mode=locked (token value withheld from log) persona=custom limit=12 multiturn=on
[gateway] ready url=ws://127.0.0.1:41749/ deviceAuth=on systemPrompt=custom historyLimit=12 multiturn=on
--- PASS A: locked gateway + WRONG device token ---
[gateway] protocol.error sessionId=s1 code=unauthorized message=device token mismatch fatal=true
[gateway] session.close sessionId=s1 code=1008
[SMOKE] PASS A: unauthorized + 1008, upstream requests=0
--- PASS B: locked gateway + CORRECT token + two turns ---
[FAKE-UP] POST /v1/chat/completions role=chat bodyBytes=198
[FAKE-UP] chat.messages=system,user count=2 stream=true
[FAKE-UP] POST /v1/chat/completions role=chat bodyBytes=309
[FAKE-UP] chat.messages=system,user,assistant,user count=4 stream=true
[SMOKE] PASS B: two turns, chat requests=2, turn2 messages=system,user,assistant,user (history=2)
[SMOKE] PASS B detail: turn1.user="STT_TRANSCRIPT_1\nTURN 1 USER UTTERANCE" turn1.assistant="REPLY_1. " turn2.user="STT_TRANSCRIPT_2\nTURN 2 USER UTTERANCE"
```

人设全文与设备 token 均未出现在任何网关 / 设备日志中（smoke 直接断言）。`systemPrompt=custom`
只记录来源，不回显内容；上游实际请求体含 system 全文，但假端点日志只记角色序列。
playground 生成物未受影响，未重生成；`python3 scripts/check_website.py` 通过。
取舍见 `docs/KNOWN-SIMPLIFICATIONS.md` r120 与 `docs/voice-gateway-protocol.md` §8.1.9 / §10。
