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
- [x] AXP2101 power bindings (battery telemetry, power off/reboot)（r8 代码完成 + Codex review P-with-fixes，两条 follow-up 已修并复测；实机电池读数/powerOff 验收待接板。reboot 绑定归 lume.system，已由 r141 落地为 `lume.system.reboot()`（真机重启验收仍缺））
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
- [ ] WiFi OTA channel (TCP push, port + auth token)（r26/r96 代码完成：r26 落地 lwIP TCP 监听与帧解析，r96 把明文 token 比对升级为 HMAC-SHA256 每连接挑战应答，补 `lume.ota.status()/setToken()`、`lume.net.otaStatus()`（含 hmac 字段）与 CLI `--host` / `--ota`（legacy alias）/ `--token` / `--ota-port`，端口 8765 由 WiFi GOT_IP 自动托管监听、无 start/stop；详见 r96 战报与 `runtime/types/lume.d.ts`。真机推包与 HMAC 握手端到端验收待接板，故整行保持未勾选）
- [ ] Host simulator (LVGL SDL backend + QuickJS on desktop)

Local web service (r71): the `lume.net.web` server code is complete with
JS-defined routes and pages, token-gated LAN access, bounded HTTP parsing, and
host tests. Browser access over real WiFi remains a board acceptance item; see
`docs/archive/r71-webserv-report.md`.

Firmware distribution (r74): the unmodified Lume firmware boots in the browser
through the esp32sim WASM emulator — `run.html?wasm&fw=lume` on the Pages
origin, trio + manifest synced from `firmware.yml` artifacts by `fw-sync.yml`,
surfaced as the Playground Firmware tab. Verified booting to the launcher home
screen (CO5300 panel); see `docs/archive/r74-realfw-report.md`.

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
3. **Bands as native `Arc` widgets** — **LANDED in r224** (see `### r224 result`
   below; this entry is kept for the historical rationale). Zero new code: `Arc`
   already exposes value/start/end/thickness/track/color and `lv_draw_sw_arc()`
   renders through an LVGL mask (8-bit coverage), i.e. it is anti-aliased. Cost:
   three stacked transparent `Arc` widgets for the three colour bands, with the
   Canvas kept for ticks and needle. Try this first if only the example matters.
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
implementation report in `docs/archive/r81-sprite-report.md`.

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
  `docs/archive/r83-scroller-report.md` 与 `artifacts/r83/`（原始日志/截图）。
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
  渲染层。分数维度拒绝而非截断。详见 `docs/archive/r84-imgscale-report.md`、
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
  构建证据，不代表板上验收。详见 `docs/archive/r85-imgpix-report.md` 与 `artifacts/r85/`。


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
   启动 eval 段、稳态为 0，占比 4.5%/3.2% < 5% 门槛（docs/archive/r43b-gc-report.md）。
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
  日志/历史数据压缩存储（r135 已补纯 app 消费方 `examples/archive_view`）。
  解压优先（压缩 JS 侧用不上）。
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
| **俄罗斯方块**（已落地 `3bfa796`，见 `docs/archive/r62-tetris-report.md`） | 经典品类在 ESP32 生态已被反复验证（LED 矩阵/小屏实现众多），但圆屏高分辨率彩色版缺位 = 差异化空间。10×20 格缩放进 canvas，pan 手势横移 + tap 旋转 + swipe 软降，hiscore 走 `lume.storage.kv`（key ≤15 字符） | 网格类 = canvas 最舒适区（games_2048/breakout 先例）；方块预览+next 提示用双 canvas 或分区重绘；纯 app 层，无缺口 |
| **闭环目标环表盘**（已落地 r63，见 `docs/archive/r63-ringface-report.md`；智能手表原生风格：三同心环 complications） | r48 原生 AA `ctx.arc`：三条进度弧及三条低亮度轨道；步数估算接 IMU 或 demo 数据、电量接 PMIC、站立计数接 timer | watchface 第 4 面已接入 swipe 循环；每帧六条原生弧、46,656 px 脏区；纯 app 层 |
| **模块化信息格表盘**（已落地 r64，见 `docs/archive/r64-modular-report.md`；智能手表 modular 风格：多 complication 网格） | 一次演示主题+Card+signals+轮询全家桶：天气/电池/温度/日历小格，数据源接 `lume.net.httpRequest` 与本地传感器 | watchface 第 5 面已接入 swipe 循环；零 canvas——卡片走原生 View/Text（canvas 全 app 预算 228,544/230,400 px 已满）；纯 app 层 |
| **桌面宠物**（已落地 r65，见 `docs/archive/r65-pet-report.md`；像素电子宠物：喂食/抚摸/作息） | 触摸=抚摸、长按=喂食、翻腕（IMU）=惊醒——单点触摸+IMU 全用上；像素动画走 fillRect 预计算 spans（gravity_ball 模式）；**热更新 = 皮肤商店独有卖点**（换宠物/换装免刷机） | `examples/pet/app.js`：16×16 像素表 → spans 预计算，每拍只重画脏区（闲置 72–96×12 px，睡时不重绘）；状态机纯 JS；两套皮肤 + `lume.storage.kv` 记忆，热更新换肤；host + esp32sim 验证，纯 app 层 |

### P1 — 第二批（有差异化亮点或需性能 spike）

| 候选 | 价值与复刻要点 | 可行性口径 |
|---|---|---|
| **一键飞行（Flappy 类）**（已落地 r105，见 `docs/archive/r105-flapdot-report.md`；`examples/flapdot/`：单点触摸拍翅 + hash 确定性柱对 + 难度渐窄缺口 + KV hiscore） | 单点触摸玩法与硬件形态天作之合；障碍柱水平推进 = 镜头动场景，脏区只救局部动 | 🟢 纯 app 层落地：单 480x400 canvas（192,000 px < 230,400 预算），柱体为原生 fillRect 分带（未走 drawImage，spike 的 blit 路线留作后续优化）；脏区实测稳态增量最大 20,680 px/帧；KV `hisc.flapdot`（12 字符）；host harness 13 组 + 60s smoke 全绿。**接板 60s p95/p99 实测仍是硬门槛**，真机未验（r83 spike 结论继续有效） |
| **康威生命游戏**（已落地 r66，见 `docs/archive/r66-conway-report.md`） | 触摸播种种细胞 + 观察演化，「圆屏上的涌现」演示价值高、实现极小；演示 retained paths（静态网格线）+ canvas（活细胞）分层 | `examples/game_of_life/app.js`：33×33 环面网格 / 9px 格落在 300×300 单 canvas 内（60×60×9px=540px 超出屏幕与 300px 预算，故按预算收敛为 33×33）；静态 72 段 retainSegments 上传一次，活细胞按代脏区重画；实测每代脏区 648–729px = 全帧 0.72–0.81%；代际 200/350/500ms 三档，纯 app 层 |
| **记忆翻牌**（已落地 r75，见 `docs/archive/r75-memory-report.md`；**扫雷已落地 r76**，见 `docs/archive/r76-minesweeper-report.md`） | 单点触摸网格游戏最低成本品类；与 games_* 不重复（都是新玩法）；hiscore 走 KV | `examples/memory/app.js`：4x4 = 8 对原创像素面（berry/sun/cloud/leaf/heart/star/bolt/ring）spans 预计算，tap 翻牌 / 两张比对 / miss 两帧回扣；KV `hisc.memory`（11 字符）最少步纪录；单 canvas 480x480 = 230,400 px 恰满预算；12 例 harness 含负向（重复翻同一张、三张连翻保护）；纯 app 层。**`examples/minesweeper/app.js`（r76）**：10x10 + 15 雷，首击 3x3 必安全（首击后布雷），tap 翻开（显式栈 flood fill）/ 长按插旗（旗格不可翻、不被 flood 掀开、不计入胜利），踩雷全揭晓；数字 5x7 / 旗雷 7x7 像素字形 spans 预计算（spanBuilds=10）；KV `hisc.mine`（9 字符）最快时间纪录；网格 398x398 harness 锁边；15 例 harness 含 20 板可解性；纯 app 层 |
| **流体粒子沙盒**（IMU 晃动 + 触摸扰动） | 宣传效果天花板：圆屏 AMOLED 上粒子随重力流转 | ⚠️ 参考社区同款实证需降级到 200-300 粒子（JS 单线程无 SIMD）；粒子间作用用简化近似（网格邻域）；IMU 单位是 m/s² 非 g |
| **双八度触屏钢琴**（已落地 r67，见 `docs/archive/r67-piano-compass-report.md`） | 经典乐器品类，单点触摸 + pan 滑奏天然适配；演示 play/playStream 混合音频合成与 in-place 键位高亮 | `examples/piano/app.js`：14×34 px 白键一行 + 10 黑键压缝，24 音两八度 + 三档八度移调；基频+2 泛音+指数包络的立体声 PCM，attack ≤48 ms 走 play、release 5×1152 帧走 playStream，包络函数连续避免切换爆音；Demo 曲内置小星星；纯 app 层 |
| **惯性方位角仪表**（已落地 r67，同上战报） | 手表/仪表品类；retained paths 静态刻度环 + 每帧指针脏区 + 常正数字；演示 demo / IMU 双模式 | `examples/compass/app.js`：36 段 retainSegments + 2 条 retainPath 一次上传；demo 18°/s 平滑旋转并可拖动，IMU 模式积分陀螺 Z 得**相对**航向并加 DRIFT 徽章；**无磁力计，不承诺地理北**；浏览器无 IMU 自动降级 demo；纯 app 层 |
| **体感挥杆迷你高尔夫**（已落地 r123，见本节 r123 result；`examples/minigolf/`） | IMU 挥杆速度触发击球——手表形态差异化王牌（手机做不了）；关卡程序化生成无素材依赖 | `examples/minigolf/app.js`：demo 拖拽瞄准+HIT / IMU 峰值挥杆双模式（无 IMU 自动降级，compass 先例）；6 关确定性生成、par=1 由 harness 72×14 网格搜索证明一杆可解；Coulomb 摩擦+坡度+环障回弹；单 480x480 canvas=230,400 px，静态层每关一条 retainSegments（6 条）、球/瞄准线脏区重画；KV `hisc.golf`（9 字符）存全场最少总杆；12-case harness + emu 触摸注入实证一杆进洞；纯 app 层，真机手感 deferred |
| **街机风格射击**（已落地 r68，见 `docs/archive/r68-retro-report.md`；5×11 三档编队 + pan 炮台/tap 射击） | 复古合集首刀；编队整体脏区 ≈26% 全帧、两帧腿部动画同盒重画、UFO 加分 + 波次提速；像素造型为原创近似 | `examples/invaders/app.js`：mario 式 spans 预计算精灵；Game Boy 三档绿；KV key 由 `hiscore.invaders`（16 字符）因 NVS 15 字符上限收敛为 `hisc.invaders`（13 字符）；20ms emu tick 无掉帧日志；纯 app 层 |
| **公路河道穿越**（已落地 r68，同上战报；13 行网格：5 车 + 4 河 + 2 安全 + 中线 + 窝） | 复古合集同批；tap 相对青蛙中心判四向、车辆撞死/浮木承载/落水死/5 窝过关提速；行带独立脏区 | `examples/frogger/app.js`：车/木/蛙全 spans 预计算；NES 灰底低饱和彩块；跳跃简化为瞬移+高亮（登记取舍）；KV `hisc.frogger`；纯 app 层 |
| **推箱子**（已落地 r69，见 `docs/archive/r69-retro2-report.md`） | 益智品类补齐复古合集；标准推箱规则 + 10 关内嵌 + par 最少步 + 过关解锁；swipe 四向推箱为主、tap 相邻格为辅；角位死锁 QoL | `examples/sokoban/app.js`：10 关 11×7 ASCII 表（≤13×10），BFS 解算器在 harness 证明每关可解且 par = 最优步数；墙/地板/目标/双态箱/玩家全 spans 硬边；瞬移+高亮（r68 同款简化）；KV `hisc.soko_pg`（`hisc.soko_progress` 18 字符超 NVS 15 字符上限，已收敛）；纯 app 层 |
| **Game & Watch 风格双游戏 LCD**（已落地 r69，同上战报） | 「segment LCD style」原创形态：所有可能段位以极低对比度常显、激活段高亮，仿非背光透传 LCD 物理特性；MODE 切两小游戏，辨识度高 | `examples/lcd_dual/app.js`：幽灵段 `ctx.retainSegments` 一次上传 2 条（124/99 段）、逐帧 `drawPath` 回放、零 JS 几何；GAME A 接面包（3 段式掉落、3 漏结束）/ GAME B 三车道闪避（一撞结束）；MODE 走单一手势目标避免按钮/画布双触发；KV `hisc.lcd`；**不复刻任何原机造型**；纯 app 层 |

### Retro classics（r68 起的新分组）

本刀起，roadmap 在「经典 app 复刻生态」下新开**Retro classics**叙事行，收编自研、原创近似的街机/益智/段码 LCD 风格像素游戏（不点名原商标、不逐像素复制原始精灵位图）。已落地四款：`examples/invaders/`、`examples/frogger/`（r68）、`examples/sokoban/`、`examples/lcd_dual/`（r69），均在 playground 26-app 列表内；像素字体统一沿用 14px Montserrat，真机手感/帧率/音效待接板验收。详见 `docs/archive/r68-retro-report.md`、`docs/archive/r69-retro2-report.md` 与 `docs/KNOWN-SIMPLIFICATIONS.md`（r68/r69）。

### 幼儿教育（r70 起的新分组，非复刻线）

与上面的社区复刻候选**无关**：教育品类自开叙事行，不放在 Retro classics / 复刻表里。已落地 `examples/abc123/`（`docs/archive/r70-abc-report.md`、`docs/archive/r73-abc-svg-report.md`）：36 张卡（A-Z + 0-9），顺序 / 随机 / 小写 / 竖排 Aa 对照四模式，全屏单手势点屏翻页 + 顶部 HUD 切模式，点击弹跳反馈；早期版本用 Canvas 画数字圆点和 A-E 图标，当前已移除该底部图形并改为静态黑底。Text 字号仍被 bridge 钉死在 14/20/32 三档；r73 将大字形改为 DejaVu Sans Bold 轮廓生成的 mini-SVG，由 Image 节点渲染。esp32sim 首卡解码明显较慢，真机翻页延迟、点屏/色彩/触感待接板验收。

### P2 — 有依赖缺口或需固件刀，如实标注后缓做

| 候选 | 价值 | 缺口（诚实原则） |
|---|---|---|
| **猜词游戏（Wordle 类）** | 热度高、每日一题适合「每天看一眼圆屏」粘性叙事 | 🟡 r149：键盘直输完整版已落地（`examples/wordle`，5×6 网格 / 绿黄灰反馈 / 屏上键盘 + 字母态条 / KV 连胜），原 🔴 blocked「无键盘组件」缺口已解除（r148 `shell.Keyboard` + r149 消费）。r165：原「无 RTC → 无墙钟」blocker 已由 r128 `lume.system.time()` 解除，**app 层每日一题机制已落地**（日序号确定性选词 / 同日同词跨日换词 / `DAY #N` / `wr.day` 跨日连胜规则）。本行仍不标完成：真机输入手感、圆屏安全区、每日一题真机验收（冷启动未 SNTP 的 dayIndex=0 与校时跳词边界、跨日 KV 持久化）与 HTML 完整词表 deferred（详见 r149 / r165 result 与 KNOWN-SIMPLIFICATIONS r149 / r165）。变体 `examples/wordring` 保留 |
| **按住说话语音伴侣** | playStream/recordStream 的终极演示，与语音助手路线（见上节）E 刀合并 | 🔴 blocked：`audio.recordStream`（C 刀）未落地；实时对话链路时延是真机硬仗 |
| **全屏精灵卷轴游戏**（横向卷轴平台跳跃完整版） | mario 单屏已证明玩法链路；r83 已交 blit 卷轴 POC（`examples/scroller/`，含性能口径），钥匙已解除 | 🟡 r83 POC 落地（8 槽精灵全 drawImage、4 脏矩形/帧、20fps 模拟侧可行）；完整版仍需接板帧率/触摸验收与关卡/敌人系统，非纯复刻可照搬 |
| **真·指南针（磁北 / 地理方位）** | 要的是绝对地理方位，而非 r67 惯性方位仪表给的相对航向 | 🔴 blocked：QMI8658 是加速度计+陀螺仪六轴 IMU，**板子没有磁力计**，物理上无法测磁北；需外接磁力计硬件 + 固件刀（新 I2C 传感器绑定、校准/倾斜补偿），非 app 层可解。r67 仪表只登记为「惯性方位/相对航向」，README/UI 均不承诺指北 |
| **儿童绘本故事播放器（StoryBook）** | 圆屏 + TF 卡 + 免插网是儿童设备标准形态；`lume.audio.mp3`（TF 解码）/Image 插画/typewriter 字幕/gesture 翻页/mochi 表情全部现成，纯 app 层可落地 | 🟡 计划 r172（简报已备）：TF 卡故事包协议（`storybook/<名>/page-NN.mp3` + meta：插画/字幕/情绪/互动热点）+ 书架/阅读/自动翻页/续读 + mochi 陪伴 + 无卡降级内置示例。无 TTS（家长 TTS 预生成，内容可控是卖点）；真机音频/触摸 deferred |
| **Agent Experience（AX）基建线** | Lume 的目标作者就是 AI agent——把 agent 派工的实战摩擦产品化 | ✅ 四刀全部落地：r171 manifest 单源化 + `lume check --visual`（已落地）；r172 `lume context`（机器可读快照，已落地 r199）；r173 MCP server（已落地 r206：`lume mcp` ndjson JSON-RPC stdio server，六工具 lume_check / lume_bundle / lume_manifest / lume_context / lume_help / lume_deploy，零 SDK 依赖，见 `docs/r206-report.md`；真机 deploy 验收 deferred）；r174 examples 元数据检索（已落地 r207：`lume examples [name] [--json]`，运行时解析 page.js 元数据单源 + manifest ∪ examples/ 目录并集，见 `docs/r207-report.md`）。原 r174 编号已被 2026-11-23 retained-paths 轮占用，故顺延 |

### 与现有 examples 的去重边界

2048/贪吃蛇（体感）/打砖块/单屏马里奥/重力滚球（游戏）、watchface 三面（表盘）、dashboard/speedometer/device_monitor（仪表）、music_player/ai_chat/typewriter（多媒体与 AI）已覆盖的玩法与形态不再重复立项；上表候选均按「新玩法或新形态」筛选。社区生态复刻的完整溯源（逐项 star、适配要点、排除名单及理由）溯源与排除名单留在项目内部调研档案（不入公开仓库），对外文档一律不点名外部项目。

### r90 result — fishtank 鱼形升级：r89 ellipse 图元回补鱼缸（appended, milestone checkboxes untouched）

纯 app 层刀（无固件改动）：`examples/fishtank/app.js` 鱼身从 r87 的 5 条变宽线段改为 4 站点 `fillEllipse` 椭圆链（沿鱼体轴采样，轴对齐图元贴合任意朝向），腹部叠浅色椭圆（深背浅腹）、条纹鱼叠深色横斑、背鳍/鳃线用小椭圆、眼睛用 `fillCircle`；绘制顺序按体型降序（近大远小）。每帧 137 次绘制调用（<200 断言，简报预算 250 未用满）。验证全绿：`tests/fishtank.js`（60s smoke + 觅食/进食/摆尾 + prelude 集成）、`lume check --no-emu` PASS、全量 `tests/*.js` 0 FAIL、`npm test` 43 pass/0 fail、playground 重生成（35 apps）、simulator verify.js 10 PASS、浏览器截图 3 张 vision 验收确认鱼形已圆润化（橙白条纹鱼可辨为小丑鱼风格）。取舍：最小体型鱼 4 站点仍偏蝌蚪感（加站点超预算）；真机 30fps/色彩/手感 pending board。详见 `docs/archive/r90-fishtank-ellipse-report.md`。本轮引擎额度尽中断（engine_exit=1），主控接管收口。

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
仍 deferred；详见 `docs/archive/r91-crypto-report.md` 与 `docs/KNOWN-SIMPLIFICATIONS.md`。

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
未做，仍 deferred；详见 `docs/archive/r92-compress-report.md` 与
`docs/KNOWN-SIMPLIFICATIONS.md`。

### r93 result — lvgl_task 事件驱动化（appended, milestone checkboxes untouched）

Vendored 魔改候选 #1（标「优先」）落地。**开工实证翻案**：简报/r35b 所述
「33 ms timer + 10 ms 固定轮询」已是过期快照；r92 基线 `lume_board.c:125-133`
早就是 `wait_ms = lv_timer_handler()` 驱动，只是封顶 10 ms（r36b commit
`62bb0ff` 引入，见 `docs/archive/r36b-perf-report.md:9`）。r93 删掉封顶，改为
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

验证原始输出（全文见 `docs/archive/r93-lvglev-report.md`）：固件 build+size 绿——
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
若要真正压低空载唤醒频率另行评估。详见 `docs/archive/r93-lvglev-report.md` 与
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
`docs/archive/r94-particles-report.md`：新 `tests/particles.js` 绿（粒子上限、221
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
功耗仍 deferred。详见 `docs/archive/r94-particles-report.md` 与
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

验证原始输出全见 `docs/archive/r95-voice-report.md`：新 `tests/voice_assistant.js` 13 组绿
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
`docs/archive/r95-voice-report.md` 与 `docs/KNOWN-SIMPLIFICATIONS.md`。

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
`docs/archive/r101-aurora-report.md`。

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

验证原始输出全见 `docs/archive/r105-flapdot-report.md`：新 `tests/flapdot.js` 13 组绿
（含 60s smoke：draws=114918 / paints=5648 / 稳态增量最大 20,680 px）；
全量 `tests/*.js` **59 文件 0 FAIL**；`npm test --prefix tools/lume`
43 pass / 0 fail / 1 skipped；`lume check examples/flapdot --no-emu` 与
counter 哨兵双 PASS；playground 41→42 apps 重生成 +
`tools/simulator/verify.js` 全绿；flapdot 浏览器实跑截图
`artifacts/simulator/flapdot_ready.png` / `flapdot_run.png`（vision 自查
HUD/鸟/地面渲染干净）。未跑 `idf.py build/size`（零固件改动）。
诚实口径：真机触摸手感、帧率、NVS 持久化、功耗均 deferred to board
bring-up，未声称硬件验证。详见 `docs/archive/r105-flapdot-report.md`。

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

验证原始输出全见 `docs/archive/r106-fwhash-report.md`：全量 `tests/*.js` **59 文件 0 FAIL**；
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
详见 `docs/archive/r96-ota-report.md` 与 KNOWN-SIMPLIFICATIONS。

### r108 result — voice_assistant WS transport 对接 lume.net.ws（E 刀收口；appended, milestone checkboxes untouched）

交付：`examples/voice_assistant/app.js` 新增 GATEWAY 模式的 `vaTransportWS`（`lume.net.ws`
薄客户端），按 `docs/voice-gateway-protocol.md` v1 走完 hello → 60 ms recordStream 上行 →
text-delta 逐字上屏 → 下行音频 playStream → state/idle + close 全轮；`vaSetTransport()` 槽
与 `IDLE→LISTEN→THINK→SPEAK` 状态机零改动，无网关/非函数注入回落 legacy canned。
网关 URL 走 KV `voice_gateway_url`（顶部常量 `VA_GATEWAY_URL` 默认
`ws://192.168.1.50:18770/`，CLI 默认 8765 需对齐）；`examples/voice_assistant/README.md`
写用法/协议指针/取舍；`tests/va_ws.js` 用 r107 零依赖 mock 网关 + prelude_runner 桥接
`_connect/_send/_close` 跑全轮，6 用例含 3 条负向；本小节 + `docs/archive/r108-va-ws-report.md`
（原始输出全录）+ KNOWN-SIMPLIFICATIONS r107/r108 登记。固件零改动、未跑 `idf.py build/size`。

先实证后写：读 `lume.d.ts:714-731`（`onClose()` 无关闭码、`onMessage(string|ArrayBuffer)`）+
`lume_ws.c:63-101` + `lume_scripts.c:60-118`（`handle.close()` **同步**触发 `onClose`）后定案；
上行仍是 3840 B 立体声（非错误的 1920 B 单声道），原生 1024 帧=4096 B 块由 app 重组。
实施中实测 barge-in 竞态：先 close 再标记 finished 会被同步 `onClose` 抢先改 SPEAK→IDLE，
改为先标记再 close（`vaWSAbort()`），harness 负向用例覆盖。

验证原始输出摘录（本轮真实执行，全录见 `docs/archive/r108-va-ws-report.md`）：
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

验证原始输出全录见 `docs/archive/r109-round16-report.md`，摘要：模型守卫 green；双板
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

### r121 result — voice_assistant 设备侧多轮记忆适配（E 刀收口续；appended, milestone checkboxes untouched）

基线 HEAD `91a1e25`；分支 `r121-va-multiturn`。commits：feat / test / docs 分开提交，
不推送（主控轮负责 push）。**纯 app + Node 层，零固件 / runtime 改动**，按纪律未跑
`idf.py build` / `idf.py size`。

先实证再动码（`tools/gateway/device-sim.js --turns 2` 对真 `cli.js --multiturn`，
mock 上游；逐帧原始输出见本轮 probe）：`send.hello=1`、`recv.hello-ack=1`、
sessionId 两轮同为 `s1`、`recv.state idle=2`（每轮一次）、`send.end=2`、
`gateway turn.end=2`，网关 `session.close code=1000` 只在**最后一轮设备收口后**出现，
轮间无 close。结论：第二轮直接上行 PCM（**不重发 hello**），网关把 clean close 截获为
同 session re-arm（`state=idle` 后紧接 `state=thinking`）。写入协议 §8.1.10。

实现：`examples/voice_assistant/app.js` 新增 KV `voice_gateway_multiturn` /
常量 `VA_GATEWAY_MULTITURN`（默认 `false`）；开启时 `state=idle` 后 park WS，下一轮原连接
复用（无新 connect / 无 re-hello），token 仅在首轮 hello 发送；关闭时逐字节等价 r119。
`onClose` / 致命 `error` / `onError` / barge-in 清 park，下一轮新连接重发带 token 的 hello
使网关 token 门复拦。UI 新增信号驱动的 `TURN n / PREV: <上一轮回复>` 上下文行。协议帧
零变化（无新控制帧/字段/关闭码）。

验证（原始输出摘录）：

```
$ node tests/va_ws.js
PASS r121: 2 turns / 1 connection / 1 hello, history carries, no close
PASS r121: close clears history, reconnect re-hello carries token, no log leak
PASS r121: wrong token blocked on initial + reconnect, upstream never created
ALL VA WS HARNESS CASES PASSED (12 cases)          # 9 基线 + 3 r121

$ node tests/gateway.js
ALL GATEWAY HARNESS CASES PASSED (19 cases)

$ node tests/gateway_upstream.js
ALL GATEWAY UPSTREAM CASES PASSED (36 cases)

$ for t in tests/*.js; do node "$t" >/dev/null 2>&1 || echo "FAIL $t"; done; echo done
done                                                  # 0 FAIL

$ npm test --prefix tools/lume
# tests 50 / # pass 49 / # fail 0 / # skipped 1

$ python3 scripts/check_website.py
API missing: none / API invented: none / API duplicates: none

$ node tools/lume/lume.js check examples/voice_assistant --no-emu
PASS

$ node tools/lume/lume.js check examples/counter --no-emu
PASS

$ npm run build:playground --prefix tools/lume    # app.js 改动 → 重生成 playground
PASS bundle voice_assistant 12063 bytes
PASS prelude 67016 bytes; 43 apps
（生成物 website/playground/{apps,sources}/voice_assistant.js + sources.js 随本轮提交）
```

集成 smoke（真 `cli.js --upstream openai` + 本地假 STT/chat/TTS + 真 `device-sim --turns 2`，
锁定模式 + `--multiturn`，两端原始日志 `artifacts/r121-smoke.log`）：

```
[SMOKE] fake upstream port=... gateway port=... mode=locked ... limit=12 multiturn=on
[gateway] ready url=ws://127.0.0.1:.../ deviceAuth=on systemPrompt=custom historyLimit=12 multiturn=on
--- PASS A: locked gateway + WRONG device token ---
[gateway] protocol.error sessionId=s1 code=unauthorized message=device token mismatch fatal=true
[gateway] session.close sessionId=s1 code=1008
[SMOKE] PASS A: unauthorized + 1008, upstream requests=0
--- PASS B: locked gateway + CORRECT token + two turns ---
[device] send.hello auth=on
[device] recv.hello-ack sessionId=s2 audioFormat=pcm_s16le_16000_2ch
[FAKE-UP] chat.messages=system,user count=2 stream=true
[device] recv.state state=idle
[device] recv.state state=thinking
[device] send.uplink frames=10 ... turn=2          # 同连接，无第二次 hello
[FAKE-UP] chat.messages=system,user,assistant,user count=4 stream=true
[SMOKE] PASS B: two turns, chat requests=2, turn2 messages=system,user,assistant,user (history=2), device hellos=1
[SMOKE] PASS B detail: turn1.user="STT_TRANSCRIPT_1\nTURN 1 USER UTTERANCE" turn1.assistant="REPLY_1. " turn2.user="STT_TRANSCRIPT_2\nTURN 2 USER UTTERANCE"
[SMOKE] DONE: all r121 smoke assertions passed
```

设备 token / system 全文未出现在任何日志（smoke 直接断言）。设备两轮仅 1 次 hello、
网关仅 1 次 hello-ack（同一 session），与协议 §8.1.10 实证一致。取舍见
`docs/KNOWN-SIMPLIFICATIONS.md` r121 与 `docs/voice-gateway-protocol.md` §8.1.10 / §10。
真机时延 / barge-in 手感 / 双 DMA deferred to board，未声称真机验证。

### r122 result — voice_assistant 设备侧会话历史持久化（E 刀续；close 不再丢历史；appended, milestone checkboxes untouched）

基线 HEAD `6ada61d`；分支 `r122-va-history`。commits：feat / test / docs 分开提交，
不推送（主控轮负责 push）。**纯 app + Node 层，零固件 / runtime 改动**，按纪律未跑
`idf.py build` / `idf.py size`。工作区新建即已存在 `/tmp/lume-r122-wt` worktree，
`git log --oneline -1` 确认为基线 `6ada61d`；开工 `lume_model_guard.sh` 确认
`model=hy4flash-free`。

先实证再动码（读码结论，写入协议 §8.1.9.1）：`tools/gateway/server.js` 的
`ConversationHistory` 归 `DeviceSession` 所有（第 62 行），`conn.on('close')` 无条件
`history.clear()`（第 72-80 行）即 r121 KS 所述丢失点；r119 token 门在 `v` 校验之后、
phase flip / hello-ack / 上游工厂之前（第 222-234 行），hello 解析只读已知字段、
**无白名单拒绝未知字段**；协议 §3「未知字段 MUST 被忽略」、§9「v1 冻结、只追加」，
r119 `auth` 与 r117 `transcript-delta` 均为追加先例。结论：**加可选字段合规**。

设计拍板 **C（网关 sessionId 重绑定）**：hello 加可选 `resume`（上次 sessionId），网关
把退休历史绑到新连接，设备内存只多一个字符串、协议只加一个可选字段。被否：
**A 网关文件持久化**——仍须在 hello 携带恢复标识，协议增量没少，反而多出磁盘路径 /
键控 / 锁 / 陈旧文件；**B 设备 KV 缓存回放**——要新控制帧且吃设备 NVS（8 KB 预算），
破坏「帧零变化 / 只加可选字段」。设备仅在多轮模式记住 sessionId 并发 `resume`，
非多轮 hello 逐字节等价 r121（host harness 的精确 deepEqual 断言保护）。

实现：`tools/gateway/history.js` 加 `clone()`；`tools/gateway/server.js` 加有界 TTL
`resumeStore`（默认 5 分钟 / 64 条），`close` 先退休快照再清连接副本，hello 在 token
门**之后**消费 `resume`（命中单次换入、未命中降级新会话），新增 `history.retire` /
`history.resume` / `history.resume.miss` 日志（只记条数与来源 sessionId，不记 token /
system）；`tools/gateway/device-sim.js` 加 `--drop-after N` 强断重连。协议 §2 / §4.1 /
§8.1.9.1 / §8.1.10(5) / §9 / §10 与 VA README、KNOWN-SIMPLIFICATIONS r122 同步。

验证（原始输出摘录）：

```
$ node tests/gateway.js
PASS r122: close retires history; reconnect with resume restores it
PASS r122: unknown resume id degrades to a fresh session
PASS r122: locked + wrong token + resume -> unauthorized, zero restore, zero upstream
PASS r122: expired resume snapshot degrades to a fresh session
ALL GATEWAY HARNESS CASES PASSED (23 cases)          # 19 基线 + 4 r122

$ node tests/gateway_upstream.js
PASS r122: real adapter injects resumed user+assistant across disconnect
ALL GATEWAY UPSTREAM CASES PASSED (37 cases)         # 36 基线 + 1 r122

$ node tests/va_ws.js
PASS r121: 2 turns / 1 connection / 1 hello, history carries, no close
PASS r122: close retires history, reconnect resumes it + re-sends token, no log leak
PASS r121: wrong token blocked on initial + reconnect, upstream never created
PASS r122: barge-in close -> reconnect with resume -> history of prior turns still continues
ALL VA WS HARNESS CASES PASSED (13 cases)            # 12 基线 + 1 r122（原 close 清史 case 改为 retire+resume）

$ for t in tests/*.js; do node "$t" >/dev/null 2>&1 || echo "FAIL $t"; done; echo done
done                                                  # 0 FAIL

$ npm test --prefix tools/lume
# tests 50 / # pass 49 / # fail 0 / # skipped 1

$ python3 scripts/check_website.py
API missing: none / API invented: none / API duplicates: none

$ node tools/lume/lume.js check examples/voice_assistant --no-emu
RESULT: PASS (4 steps, 0 failed; exit 0)

$ node tools/lume/lume.js check examples/counter --no-emu
RESULT: PASS (4 steps, 0 failed; exit 0)

$ npm run build:playground --prefix tools/lume     # app.js 改动 → 重生成 playground
PASS prelude 67016 bytes; 43 apps
（生成物 website/playground/{apps,sources}/voice_assistant.js + sources.js 随本轮提交）
```

集成 smoke（真 `cli.js --upstream openai` + 本地假 STT/chat/TTS + 真
`device-sim --turns 2 --drop-after 1`；锁定模式 + `--multiturn`，两端原始日志
`artifacts/r122-smoke.log`；强断采用设备主导的 `close(4000, forced-drop)`，因为本仓库
vendored WS 服务端对裸 TCP destroy 要到下次写才察觉，会与重连竞态，故用显式非 1000
的 close 帧表达「轮中途断开」）：

```
[gateway] ready url=ws://127.0.0.1:45943/ deviceAuth=on systemPrompt=custom historyLimit=12 multiturn=on
[SMOKE] --- PASS A: locked gateway + WRONG device token ---
[device] send.hello auth=on resume=off
[SMOKE] PASS A: unauthorized + 1008, upstream requests=0
[SMOKE] --- PASS B: correct token, 2 turns, forced WS drop between them ---
[FAKE-UP] chat.messages=system,user count=2 stream=true
[device] force.drop turn=1 sessionId=s2
[gateway] history.retire sessionId=s2 count=2
[device] reconnect resume=s2
[device] send.hello auth=on resume=on
[gateway] history.resume sessionId=s3 from=s2
[FAKE-UP] chat.messages=system,user,assistant,user count=4 stream=true
[SMOKE] PASS B detail: chat requests=2 turn2.roles=system,user,assistant,user turn1.user+assistant.retained=true
[SMOKE] PASS B: forced drop + resume -> turn2 chat body carries turn1 user+assistant; token gate on
[SMOKE] DONE: all r122 smoke assertions passed
```

设备 token / system prompt 全文均未出现在任何日志（smoke 直接断言，grep 计数 0）。
第二轮 chat 请求体 `system,user,assistant,user` 含第一轮 user+assistant，直接证明断连
后历史续上。取舍见 `docs/KNOWN-SIMPLIFICATIONS.md` r122（进程重启仍丢、sessionId
可预测、TTL 过期仍丢、只恢复已完成轮等）与 `docs/voice-gateway-protocol.md`
§4.1 / §8.1.9.1 / §10。真机时延 / barge-in 手感 / 双 DMA deferred，未声称真机验证。

### r123 result — 体感挥杆迷你高尔夫 `examples/minigolf`（复刻生态 P1 候选；appended, milestone checkboxes untouched）

基线 HEAD `8219a8a`；分支 `r123-minigolf`；`git worktree add /tmp/lume-r123-wt` 后
`git log --oneline -1` 确认为基线。开工 `lume_model_guard.sh` 确认 `model=hy4flash-free`。
**纯 app 层，零固件 / runtime 改动**，按纪律不跑 `idf.py build` / `idf.py size`。
commits 拆分 feat / test / docs，不推送（主控轮负责 push）。

先实证再动码（读码结论，均带行号，先于实现写入本节）：

- IMU 双模式口径沿用 `examples/compass/app.js:57`（`compassMode(s)` 以
  `typeof s.gz === 'number'` 判 imu/demo）、`:68-71`（`imuRead()` try/catch，无样本返回
  null）、`:80-95`（`setMode('imu')` 无样本即降级 demo 并记日志）。浏览器/emu 无 IMU 自动
  演示模式是既有先例，不是本轮发明。
- IMU 读数单位 = m/s²（非 g）：`examples/gravity_ball/app.js:7` 明示
  "read() returns m/s^2 (QMI8658 +/-4g)"；采样路径为 `lume.imu.read()` 在 `tick()` 内
  调用（`:49`），`tick` 由 `lume.system.setInterval(tick, 50)` 驱动（`lume_scripts.c:464-466`，
  20 ms 引擎队列量化）。阈值先例同文件 `:12-14`：`DEAD_ZONE = 0.5` m/s²、`GAIN = 55`
  px/s² per m/s²、`MAX_SPEED = 420`；`:29-32` 的 `impactSpeed` 为撞墙速度峰值事件口径。
  故本轮挥杆阈值以 m/s² 计，不拍脑袋写成 g。
- 验证模式沿用 `tests/sokoban.js:16-22`（app 在 `/* GAME UI */` 处切逻辑/UI，逻辑进裸
  vm）、`:94-139`（BFS 解算器证明每关可解且 par = 最优步数）、`tests/flapdot.js:20-29`
  （UI 字符串 ASCII-only 断言，r64 字体坑）、`:245-272`（脏区预算 + 画布像素预算
  `total <= 230400`）、`tests/sokoban.js:141-161`（KV key ≤15 + 优雅失败）。
- NVS 键长上限实证：`firmware/components/lume-storage/lume_kv.c:42` 与
  `include/lume_kv.h:78` 均为 15 字符（`NVS_KEY_NAME_MAX_SIZE(16) - 1 NUL`）。
  故 hiscore 键取 `hisc.golf`（9 字符）。
- retained paths 上限实证：`lume_scripts.c:1115-1151`（`retainPath`/`retainSegments`
  每条 ≤240 点/段，单 canvas 最多 8 条 path）、`:1152-1158`（`drawPath` 回放）；
  画布像素账 `:1068`（`w*h*2` 字节，受 `SW*SH*2` = 480×480 约束）；脏区校验
  `:1199-1209`（1..8 个矩形、`x+rw<=w && y+rh<=h`）；`ctx.text` 仅 14px（`:1192-1194`），
  HUD 一律用原生 Text 节点。手势 kind 0/1/2/3 = DOWN/MOVE/UP/SWIPEDIR（`:1240-1241`），
  全局 swipe-up 回家挂在节点 0（`:1365-1372`），拖拽交互须避免与之冲突。

设计拍板（写码前定稿）：

1. **挥杆检测窗口**：IMU 模式 50 ms 轮询，取水平加速度幅值
   `mag = hypot(ax, ay)`（轴向符号映射沿用 gravity_ball `SIGN_X=-1`，手表近水平持握时
   静止幅值≈0）。`mag > SWING_THRESHOLD(6 m/s²)` 为一次挥杆候选；连续超限取窗口内峰值
   `peak`，峰值回落或 160 ms 窗口结束即结算一次击球。击球仅在球静止（速度 < 8 px/s）
   且不在冷却（240 ms）时受理，过弱挥杆 `peak <= 阈值` 不触发（负向用例）。demo 模式无
   IMU，走 `panstart`/`pan` 拖拽定方向+力度、`panend` 定稿，`HIT` 按钮提交击球，避免与
   全局 swipe-up 回家手势抢同一释放动作（compass 双模式 + sokoban 单手势目标先例）。
2. **击球力度映射**：`frac = clamp((peak - 6) / (30 - 6), 0, 1)`（m/s²；30 接近 ±4g 上限），
   `speed = 90 + frac * (380 - 90)` px/s；低于阈值直接不击球，杜绝误触。demo 拖拽距离
   `dist` 用同一 `frac = clamp(dist / 140, 0, 1)` 映射到同区间，两条路径共用 `shotSpeed()`。
3. **球物理（简化 2D 坡度+摩擦）**：固定子步 `h <= 0.01 s`（gravity_ball `:21-22` 同款），
   `v = (v + slope*h) * (1 - FRICTION*h)`，`slope` 为每关常向量（px/s²，坡度越大越难），
   `FRICTION = 1.1 /s`，`RESTITUTION = 0.6`；球道四壁回弹，圆形障碍法向反射；障碍取
   outline-only 环（便于脏区重画精确复原）。洞为半径 12 px 圆：`dist < 12 且 speed < 120`
   px/s 即入洞，过快则 lip-out 越洞而过。沙坑/水域 hazard 矩形为惩罚区：入区即回到上一
   静止点并 +1 罚杆。数值发散或离开球道矩形视为出界，同样罚杆复位（负向用例）。
4. **关卡程序化生成**：`golfLevel(i)` 由关卡序号确定性生成（不内嵌素材、不手抄地图），
   球道矩形随屏固定，坡度幅值/方向、圆形障碍个数与半径、洞位、hazard 随 `i` 渐增/变换；
   共 6 关（≥5）。难度维度：L1 无障低速直洞 → L2 加坡度 → L3 单障碍 → L4 双障碍+偏移洞
   → L5 三障碍+hazard → L6 全要素高坡度。每关 par 由 harness 的角度×力度网格搜索解算器
   实证可解（sokoban "数据 bug 在断言处暴露" 纪律）；搜索从发球点枚举 36 方向 × 8 档力度，
   模拟至静止或入洞，≤2 杆内找到解即判可解，否则视为关卡数据错误。
5. **回合与洞流程**：`ready → rolling → holed/penalty → next`。击球杆数 +1（hazard 另 +1）；
   入洞后按本关杆数记最少杆纪录 `hisc.golf`（严格更少才覆盖，等值保留），`NEXT` 按钮推进
   关卡，`RESET` 重开本关；6 关通关后显示完成态。杆数/HUD 为原生 Text，无装饰 Unicode，
   仅 ASCII + 中文。
6. **渲染**：单个 480×480 canvas = 230,400 px 恰满预算（harness 断言）。球道边界、障碍环、
   洞环、hazard 边框为静态层，`retainPath`/`retainSegments` 一次上传（≤8 path），每帧
   `drawPath` 回放；球、瞄准线、洞心为动态层，按 gravity_ball 的 `snapBox(union(old,new))`
   脏区重画（含瞄准线包围盒与洞心盒），首帧全画布。稳态脏区远小于全帧，budget 在 harness
   用 `invalidate` 消息断言。
7. **取舍登记**：真机 IMU 持握姿态、挥杆阈值舒适度、触屏拖拽力度手感 deferred to board；
   验收口径 = 编译/宿主/emu 全绿 + 逻辑自洽，不声称真机验证。写入 KNOWN-SIMPLIFICATIONS。

验证（原始输出摘录；全部在 `/tmp/lume-r123-wt` 执行）：

```
$ node tests/minigolf.js
PASS minigolf UI strings ASCII-only (r64 font rule)
PASS minigolf power mapping (threshold/dead-zone/clamp, shared curve)
PASS minigolf turn flow + shot gating (rolling/rejected putt)
PASS minigolf physics (friction stop, slope deflection, OOB clamp, guard bounce)
PASS minigolf cup capture / lip-out / hazard penalty reset
EVIDENCE L1 OPEN PUTT solvable@par hole-in-one {"angle":90,"power":8,"speed":268}
EVIDENCE L2 SLOPE solvable@par hole-in-one {"angle":90,"power":7,"speed":246}
EVIDENCE L3 ONE GUARD solvable@par hole-in-one {"angle":75,"power":8,"speed":268}
EVIDENCE L4 TWO GUARDS solvable@par hole-in-one {"angle":75,"power":9,"speed":291}
EVIDENCE L5 BUNKERS solvable@par hole-in-one {"angle":70,"power":8,"speed":268}
EVIDENCE L6 GAUNTLET solvable@par hole-in-one {"angle":105,"power":11,"speed":335}
PASS minigolf all 6 procedural holes solvable at par (angle x power search)
PASS minigolf hiscore KV (9-char key, strict-min, graceful failure)
PASS minigolf boot + retained paths + first paint + canvas budget
PASS minigolf demo/imu degradation + stationary no-putt
PASS minigolf IMU swing threshold + one-putt debounce + weak-swing negative
PASS minigolf drag -> aim -> HIT + dirty budget (max inc 9044 px) + pathDraw replay
PASS minigolf RESET/NEXT navigation + 1800-tick finite smoke
ALL MINIGOLF HARNESS CASES PASSED (12 cases)                 # 12/12 绿

$ for t in tests/*.js; do node "$t" >/dev/null 2>&1 || echo "FAIL $t"; done; echo done
done                                                          # 0 FAIL

$ npm test --prefix tools/lume
1..50
# tests 50
# pass 49
# fail 0
# skipped 1

$ python3 scripts/check_website.py
API missing: none
API invented: none
API duplicates: none
API signatures not found in lume.d.ts: none

$ node tools/lume/lume.js check examples/minigolf --no-emu
RESULT: PASS (4 steps, 0 failed; exit 0)
$ node tools/lume/lume.js check examples/counter --no-emu
RESULT: PASS (4 steps, 0 failed; exit 0)
```

emu smoke（真固件 esp32sim；worktree 的 `tools/lume/node_modules` 用主仓软链，
`EMU_BIN` 指向主仓 `tools/emu/.cache/bin/esp32sim`）：主仓 `firmware/build/` 三件套当时
不存在，`website/wasm/fw/` 是 amoled18（368×448）镜像且使 480×480 canvas 在
`__canvasInt` 处抛 `canvas coordinate out of range`（非 app 逻辑错，板型不匹配）。
故按仓库默认 sdkconfig（amoled216 480×480）本地 `idf.py build` 生成 emu 镜像——这是
**环境准备，不是固件源码改动**；固件/runtime 源码本轮零改动，故未按「被迫改动」口径
贴 size 对比。`EMU_SKIP_BUILD=1 tools/emu/run.sh examples/minigolf` 原始输出：

```
I (1737) lume-engine: engine task up (pinned core 1), PSRAM free=5436368 bytes
I (1809) lume-engine: runtime up; eval app '<home>' (5127 bytes)
I (1939) lume-engine: app eval ok; entering event loop
I (2692) lume-engine: engine recv RELOAD -> recycle runtime
I (2923) lume-engine: runtime up; eval app '<embedded-demo>' (9614 bytes)
I (3007) lume-engine: app eval ok; entering event loop
[emu] stop: Halted -- ... emulated 10.000s (2400000000 cycles)
TFT: /tmp/lume-r123-emu-final/tft.png
serial: /tmp/lume-r123-emu-final/serial.log
```

`grep -E "JS exception|eval failed|RELOAD ERR|E \(.*lume-|assert|panic" serial.log` 0 行。
`run.sh` 会覆写 `$EMU_OUTPUT_DIR/actions.txt`，故触摸注入写到独立
`/tmp/lume-r123-emu-touch/actions.txt` 并直接调 esp32sim（r64/r65 先例）：
`2.5 serial-file ...` → `4.0 touch 240 380 1` → `4.1/4.2/4.3 touch 240 <344/310/288> 1`
→ `4.45 touch 240 288 0` → `5.0 touch 182 452 1` / `5.15 touch 182 452 0`（HIT）。
原始串口证据：

```
[script] t=4.000s Touch(240, 380, true)
[script] t=4.450s Touch(240, 288, false)
[script] t=5.000s Touch(182, 452, true)
I (5340) lume-engine: js: GOLF SHOT L1 strokes=1 speed=268
I (9468) lume-engine: js: GOLF HOLE L1 strokes=1
I (10369) lume-engine: js: GOLF tick L1 phase=holed mode=demo
```

最终截图 `/tmp/lume-r123-emu-touch/tft-clean.png`：HUD `L1/6 OPEN PUTT DEMO` /
`STROKES 1 PAR 1 BEST 0` / `HOLED IN 1 PRESS NEXT`，球白点落在黄环洞心，球道与障碍/
洞轮廓无黑边残影，四个按钮在位；emu 日志无 crash。截图/产物只留最终证据。
真机挥杆手感 / 触屏力度 / 帧率 / 掉电持久性 deferred，未声称真机验证。

### r125 result — TF 卡（microSD）SPI 模式 `lume.storage.Sd`（固件刀收口；appended, milestone checkboxes untouched）

上一轮派发（/tmp/lume-r125-run.log）开场即打印 429 限流提示（窗口至 2026-11-20
18:23 UTC+8），但引擎并未立即退出：未建 worktree、直接在主仓降级继续工作了约 20
分钟（03:08-03:23，文件 mtime 与 /tmp/r125-idf-build.log 为证），完成固件/JS API/
harness 主体后因 `statvfs` 编译错误中断退出（engine_exit=0），docs 同步与
api.html 重生成未做。主控接管收口：修唯一编译错误（ESP-IDF FATFS 无 POSIX
`statvfs` → `f_getfree`，`ff.h`；`SS(fs)` → `fs->ssize`），补引擎漏做的 docs 同步
（本节 + KNOWN-SIMPLIFICATIONS r125 节 + hardware-api.md storage 行与 r125 note）
与 `gen_api_docs.py` 重生成。

**实现**（引擎半成品 + 主控收口）：
- `firmware/components/lume-storage/lume_sd.{c,h}`：SDSPI 挂载（SPI3，2.16 profile
  GPIO1/2/3/41，`lume_board_profile.h:49-52`），lazy one-shot 非致命 mount，
  `format_if_mount_failed=false`（绝不毁卡上数据），无卡/无槽全部 API 返 -3；
  write/read/readBinary/append/list/mkdir/remove/exists/statvfs，错误码与 Fs 对齐
  （0/-1/-2/-3，detect 无 CD 脚返 -4）；statvfs 用 FATFS `f_getfree`（csize*ssize*n_fatent，
  JS_NewInt64 精确整数）。
- `lume_engine.c`：`lume.storage.Sd` natives 自注册（Kv/Fs 先例），prelude 零改动。
- `runtime/types/lume.d.ts`：Sd 契约块（契约注释风格对齐 Fs）；`scripts/gen_api_docs.py`
  重生成（150 entries，freshness --check 过）。
- `sdkconfig.defaults` +1 行：`CONFIG_FATFS_API_ENCODING_UTF_8=y`。
- `tests/sdcard.js`：wiring/never-format+lazy-mount 政策锁定/错误码对齐/prelude 未动
  四类静态断言。

**验证**（全部原始输出摘录；调度轮口径=编译绿+size+host harness，真机插卡验收留接板轮）：
- `idf.py build && idf.py size` exit=0：Flash Code 2,037,888（r124 基线 ~2.02x,xxx，
  增量 ~16 KB = sdmmc/sdspi/fatfs 驱动栈）；IRAM .text 15,356 / 16,384（上限不超）；
  DIRAM 72.4%。log: /tmp/r125-idf-build3.log
- `node tests/sdcard.js`：`ALL SD HARNESS CASES PASSED`（4 PASS）
- `for t in tests/*.js`：0 FAIL
- `npm test --prefix tools/lume`：pass 50 / fail 0（r125 简报基线 49 pass +1 skip；
  本轮 skip 项消失为绿，无回归）
- `python3 scripts/check_website.py`：API missing/invented/duplicates 均 none
- `node tools/lume/lume.js check examples/counter --no-emu`：`RESULT: PASS (4 steps, 0 failed)`

**取舍与未验项**：真机插卡 mount/读写/容量/掉电持久性/CD 全部 deferred；10 MHz 默认
速度档起步；1.8 profile 的同名引脚实为 SDMMC（SPI 口径只对 2.16 声称有效，1.75c 无槽
返 -3）。详见 docs/KNOWN-SIMPLIFICATIONS.md r125 节。roadmap M2 的 TF 卡行本轮不勾
（留真机验收后再勾）。

### r126 result — image_gallery 成为 lume.storage.Sd 消费方（纯 app 层；appended, milestone checkboxes untouched）

基线 `5be09c3`（r125 TF 卡 API）；worktree `/tmp/lume-r126-wt`、分支 `r126-sd-gallery`；
开工前 `lume_model_guard.sh` 绿、无 429。r125 的 429 降级教训本轮未重演：未在主仓
`/home/ubuntu/lume` 写任何文件。

**实现**（只改 `examples/image_gallery/app.js`）：
- Sd-first：`lume.storage.Sd` 防御式解析，`mounted() === true` 时三张
  `/gallery/{photo.jpg,icon.png,alpha.png}` 先走 `Sd.readBinary`；非 `ArrayBuffer`
  （-2 IO / -3 无卡）或抛错逐图回退原 `Fs.readBinary` 路径。每张图各自 try/catch，
  单张失败只丢那张；最外层 try/catch 与内嵌 1×1 红 PNG 兜底均保留。
- HUD：`Sd.statvfs()` 用 `typeof stat === 'object'` 判别成功（`{total,free}`）与错误码
  （number）；成功显示 `SD <总MB>MB TOTAL <剩余MB>MB FREE`（`Math.floor(byte/1048576)`），
  错误码显示 `NO CARD`，无 Sd API / statvfs 抛错则不显示该行。UI 文案全 ASCII（r64）。
- `examples/files` 未动（范围控制，留后续刀）；固件 / runtime 源码零改动。

**验证**（宿主口径，真机插卡 deferred；原始输出见本轮日志）：
- `node tests/sd_gallery.js`：6 PASS + `ALL SD GALLERY HARNESS CASES PASSED`；关键断言经
  内存变异实测为非摆设（去掉 Sd.readBinary / typeof 判别 / NO CARD / 逐图 try 或注入
  CJK 文案都会 FAIL）。
- `for t in tests/*.js`：0 FAIL；`npm test --prefix tools/lume`：pass 50 / fail 0（不回归）。
- `check_website.py`：missing/invented/duplicates 均 none。
- `lume check examples/image_gallery --no-emu` 与 `examples/counter --no-emu`：均 `RESULT: PASS`。
- `npm run build:playground --prefix tools/lume`：43 个 `PASS bundle ...` +
  `PASS prelude 67016 bytes; 43 apps`。
- `git diff 5be09c3 -- firmware/ runtime/` 为空 → 未跑 `idf.py build`。

**实证纠偏 / 取舍**：任务简报称「image_gallery 在 43-app 列表内」，实证
`tools/playground/build.mjs` 的 43 项清单并无 `image_gallery`（`has image_gallery=false`，
`website/playground/` 亦无其产物）。因此本轮 playground 重建不产生 image_gallery 生成物、
`PASS bundle image_gallery` 行不存在，也未改 `build.mjs`（守「纯 app 层 / 范围控制」）。
生成物 diff 为空，feat commit 只含 app.js。详见 docs/KNOWN-SIMPLIFICATIONS.md r126 节。
roadmap M2 的 TF 卡行本轮仍不勾（留真机插卡验收后再勾）。

### r127 result — examples/files 的 TF 卡浏览 + playground 补清单（app + 工具清单层；appended, milestone checkboxes untouched）

基线 `67b635f`（r126 image_gallery Sd-first）；worktree `/tmp/lume-r127-wt`、分支
`r127-sd-files`；开工前 `lume_model_guard.sh` 绿、无 429、未在主仓写文件。

**实现**（只改 `examples/files/app.js`、`tools/playground/build.mjs` + 生成物、`tests/sd_files.js`、docs）：
- **导航模式选择（实证后定案）**：采用「Fs 根目录追加 `SD/` 虚拟入口 → 点入切到独立
  `onSd` 浏览模式（cwd 重置 `/`）」，而非把 Sd 路径混进同一 `cwd`。理由：现有导航/删除/
  预览全部以 `cwd` 作为「当前后端内路径」前缀，Fs 与 Sd 的根都写作 `/`；若共用 cwd 必须
  给每个路径额外带后端标签，侵入 `isDirPath`/`loadDir`/`removeTree`/`preview`/`onBack` 全部
  链路。虚拟入口只在 Fs 根且 `sdReady` 时出现，`e.sd` 标记进入 SD 模式；SD 根 BACK/goUp
  退回 Fs 根，不直接回桌面。不挂卡时行为与 r126 之前完全一致。
- **逐操作降级 + SD->Fs 同路径回落**：`listDir`/`readText`/`pathExists`/`removeAt`/`mkdirAt`
  统一按 `onSd` 分发到 `Sd.*` 或 `Fs.*`；Sd 调用失败（负数错误码或 native 抛错）时该步回落
  Fs 同路径，仍失败才退化为「空目录/读取失败」——此回落是兼容性兜底，卡拔出/路径不存在时
  表现与无卡一致。`loadDir`/`isDirPath`/`previewSelected`/`makeDir`/`removeTree` 每步独立
  try/catch，不拖垮整个 eval；`loadDir` 失败分支与成功路径同口径清空 `selected` 并关预览。
  harness 只做源码静态断言 + 变异实证；行为级探针 deferred（未跑 stub Sd 行为探针）。
- **删除取舍**：实证 `lume_sd.c` 确认 `Sd.exists(p + '/')` 沿用 Fs 的「是目录」约定、
  `Sd.remove` 同为 unlink→rmdir 兜底、`Sd.list` 归一化尾斜杠——目录递归在 JS 侧完成，
  SD 侧删除语义明确，故**启用** SD 模式删除并复用同一个 `askDelete` Dialog（无第二份流程）；
  仅 `SD/` 虚拟入口禁删并 ASCII 提示。
- **HUD**：SD 模式顶栏显示 `Sd.statvfs()` 剩余空间，`typeof stat === 'object'` 判别成功
  （`Math.floor(stat.free / 1048576)` 整数 MB），错误码显示 `NO CARD`；UI 文案全 ASCII（r64）。
- **playground**：`tools/playground/build.mjs` 的 43-app 清单追加 `image_gallery`（r126 尾巴）
  与 `files`（本轮 Sd 化）；两者均无 esbuild 不兼容写法（`files` 的 shell.js 副作用导入可被
  esbuild iife 正常打包），重建后 45 apps。

**验证**（宿主口径；真机插卡 deferred，未声称真机验证；原始输出见本轮日志）：
- `node tests/sd_files.js`：25 source/non-source PASS + 16 变异实证 PASS（删掉被断言代码必须
  FAIL；变异实证过程中还抓出并修掉 harness 自身两处「假断言」）；`node tests/sd_gallery.js` 不回归。
- `for t in tests/*.js`：0 FAIL；`npm test --prefix tools/lume`：pass 50 / fail 0 / skipped 0（不回归）。
- `check_website.py`：missing/invented/duplicates 均 none。
- `lume check examples/files --no-emu`、`examples/image_gallery --no-emu`、`examples/counter --no-emu`：
  均 `RESULT: PASS`。
- `npm run build:playground --prefix tools/lume`：45 个 `PASS bundle ...`（含 image_gallery、
  files）+ `PASS prelude 67016 bytes; 45 apps`。
- `git diff 67b635f -- firmware/ runtime/` 为空 → 未跑 `idf.py build`。
详见 docs/KNOWN-SIMPLIFICATIONS.md r127 节。roadmap M2 的 TF 卡行本轮仍不勾（留真机插卡验收后再勾）。

### r128 result — SNTP 时间同步 + `lume.system.time()`（固件刀；appended, milestone checkboxes untouched）

基线 `040fc11`（r127 files SD 浏览）；worktree `/tmp/lume-r128-wt`、分支
`r128-sntp-time`；开工前 `lume_model_guard.sh` 绿、无 429、未在主仓写文件。

**实证纠偏（先实证后编码）**：
- 简报假设 `lume_engine.c` 有 `lume.system` natives 注册块——实证为**假**：
  `lume.system` 是 JS prelude 对象（`lume_scripts.c:464`），`setTimeout`/`setInterval`
  是纯 JS（靠 `lume._nowMs()`，而 `_nowMs` 是单调 `esp_timer`，**非** unix 时间）。
  故沿用 `_nowMs` / `power._sleepNow` 的既有模式：C 侧注册 `_systemTime` /
  `_systemSetTimeNtp` 到 `lume`，prelude 里包成 `lume.system.time()` / `setTimeNtp()`。
- `quickjs.c:57763 date_now()` → `js__gettimeofday_us()/1000` → `gettimeofday()`
  （`cutils.h:1626`）；lwip `sntp_sync_time()` 在 immediate 模式调 `settimeofday()`。
  因此同步成功后 `Date.now()` 自动正确，无需改 QuickJS。
- `esp_netif_sntp.h` 在 ESP-IDF v5.5.5 可用，`esp_netif_sntp_sync_wait()` 存在；
  生成 `sdkconfig` 中 `CONFIG_LWIP_SNTP_MAX_SERVERS=1` 已是默认，未降级到 lwip 裸 API。
  代价/取舍见 docs/KNOWN-SIMPLIFICATIONS.md r128 节。

**实现**（固件 + d.ts + 宿主桩 + harness + docs；examples 不重构）：
- `lume.system.time()`：`gettimeofday()` 的 unix **毫秒**（`JS_NewInt64`；未同步时返回
  1970 起真实小值，不伪造）。`setTimeNtp(server?, timeoutMs?)`：`esp_netif_sntp_init()`
  + `esp_netif_sntp_sync_wait()` 有界等待，默认 server `pool.ntp.org`、默认 10 s、上限
  30 s；负值 timeout 抛 `RangeError`、非字符串 server 抛 `TypeError`。返回 0 / -1 参数 /
  -2 传输或超时 / -3 WiFi 无 IP（`lume_net_has_ip()` 门控）。每次调用先 `deinit` 再
  `init`、返回前再 `deinit`，重复调用幂等重同步。**同步阻塞引擎任务**，UI/touch/
  热更新停顿（d.ts 与 C 注释均如实写明，同 httpGet 先例）。新代码无 `IRAM_ATTR`。
- `sdkconfig.defaults` 显式 `CONFIG_LWIP_SNTP_MAX_SERVERS=1` +
  `CONFIG_LWIP_SNTP_UPDATE_DELAY=3600000`；engine `CMakeLists.txt` 加 `esp_netif`。
- d.ts 追加两个契约；`gen_api_docs.py` 重生成 152 行，`--check` 输出
  `api.html is up to date with lume.d.ts (152 entries)`。
- 宿主桩：`tests/lib/prelude_runner.js` 与 `website/playground/runtime.js` 补
  `_systemTime: () => Date.now()`、`_systemSetTimeNtp: (...) => -3`（browser/host 无电台，
  照实返回 -3）；`npm run build:playground` 重生成 `prelude.js`。

**验证**（真机 SNTP 实测 deferred；不声称真机验证）：
- `node tests/sntp.js`：24 契约 PASS + **9 项变异实证 PASS**（删 d.ts 声明、改错误码、
  删 C 注册、去 sync_wait、改默认 server、去 sdkconfig 项、删 prelude wrapper、删宿主桩
  均必须 FAIL）。
- `for t in tests/*.js; do ... done`：0 FAIL（r126/r127 的「firmware/runtime 零 diff」
  轮次哨兵改为「仅允许 r128 已知文件变更」的 allowlist，因本轮本就是固件刀）。
- `npm test --prefix tools/lume`：pass 50 / fail 0 / skipped 0（worktree 缺 gitignore 的
  `tools/lume/bin/qjsc`，从主仓复制该测试工具后对齐基线，源码零改动）。
- `python3 scripts/check_website.py`：missing/invented/duplicates 均 none。
- `node tools/lume/lume.js check examples/counter --no-emu`：`RESULT: PASS`。
- `npm run build:playground --prefix tools/lume`：45 bundles + 2 summary，共 47 行 PASS。
- **固件构建（本轮必跑）**：`BUILD_EXIT=0`，原始 size 表：
  `Flash Code 2041168`、`Flash Data 853084`、`DIRAM 247491 (72.42%, Remain 94269)`、
  `IRAM 16384 (100.0%, **Remain 0**)`、`Total image size 3036023 bytes`、
  `lume.bin ... 0x35ac10 bytes (54%) free`。`grep -c "error:"` = 0；无 SNTP/time 相关警告。
  日志仅留 `/tmp/lume-r128-idf-build.log`。

详见 docs/KNOWN-SIMPLIFICATIONS.md r128 节。本轮未跑 codex review（主控轮负责）。

### r129 result — `lume.system.time()`/`setTimeNtp()` 消费方刀：clock SNTP-first + settings 手动同步（纯 app 刀；appended, milestone checkboxes untouched）

基线 `b5ca082`（r128 SNTP 原语）；worktree `/tmp/lume-r129-wt`、分支
`r129-sntp-consumers`；开工前 `lume_model_guard.sh` 绿、无 429、未在主仓写文件。

**实证纠偏（先实证后编码）**：
- 简报假设 `examples/settings` 在 playground 45-app 清单内——实证为**假**：
  `tools/playground/build.mjs` 的 `apps` 数组是 45 个精选 app，无 `settings`。
  故本轮不扩清单（避免 tooling 越界与 45→46 文档口径漂移）；重建只刷新 clock
  生成物，settings 由 `lume check examples/settings --no-emu` + 宿主 runApp 覆盖。
- 简报假设 `epochOffsetMs=0` 天然恒等——实证为**假**：设备上 `lume._nowMs()`
  是 `esp_timer_get_time()/1000`（单调 uptime，`lume_engine.c:595`），不是墙钟；
  SNTP 成功后被 `settimeofday()` 修正的是 `Date.now()` / `lume.system.time()`。
  故 `wallDate()` 改读 `Date.now() + epochOffsetMs`，HTTP 回落路径锚点同步从
  `_nowMs()` 改为 `Date.now()`（两者同步前同为 1970 起小值、速率相同，观测等价），
  offset=0 才真正恒等为墙钟；`nextSyncMs` 仍走 `_nowMs()` 域保持节拍。

**实现**（纯 app 层，固件/runtime 零改动）：
- `examples/clock/app.js`：GOT_IP 时先 `lume.system.setTimeNtp()`（默认 server /
  默认 10 s）；0 → `epochOffsetMs=0`、本轮完成（不轮 HTTP、不动 tzMin）；非 0
  （-2/-3）或 API 缺失/抛错 → 保留 r128 HTTP 源列表回落。节拍 SYNC_OK_MS=10 min /
  无 IP SYNC_RETRY_MS=30 s 不变，kv 'clock.tzMin' 语义不变。
- `examples/settings/app.js` General 页：新增恰好 3 节点（View+Text+Button）同步行——
  `TIME SYNC: NTP OK / NOT SYNCED / SYNC FAILED / NO WIFI` + `Sync now`；GOT_IP
  时调 `setTimeNtp()` 并刷新状态，UI 文案 ASCII。
- `tests/sntp_consumers.js`（新，CommonJS）：17 条静态断言 + **17 项变异实证**
  （删 NTP-first、去 offset 置零、去 HTTP 回落、去 API 守卫、回退 wallDate 锚点、
  去 tzMin kv、改节拍、去按钮/状态绑定/第 4 节点、去文案、去 GOT_IP 门控、
  去 -2 映射、去 system.time、注入非 ASCII、改固件文件——全部必须 FAIL）。
- `npm run build:playground`：45 bundles + 2 summary，共 47 行 PASS；
  `PASS bundle clock 3433 bytes` / `PASS prelude 67317 bytes; 45 apps`。

**验证**（真机 SNTP 实测 deferred；不声称真机验证）：
- `node tests/sntp_consumers.js`：17 契约 PASS + 17 变异实证 PASS。
- `node tests/clock_round.js` / `node tests/sntp.js`：不回归，全绿。
- `for t in tests/*.js; do ... done`：0 FAIL；`npm test --prefix tools/lume`：
  pass 50 / fail 0 / skipped 0；`check_website.py` missing/invented/duplicates 均 none。
- `node tools/lume/lume.js check examples/clock|settings|counter --no-emu`：
  三者均 `RESULT: PASS`。
- `git diff --stat b5ca082 HEAD -- firmware/ runtime/` 空 → 固件零改动，
  按纪律未跑 `idf.py build`（命令输出为空作证）。

详见 docs/KNOWN-SIMPLIFICATIONS.md r129 节。本轮未跑 codex review（主控轮负责）。

### r130 result — SNTP 第二波消费方刀：clock_round / aurora_clock / watchface（纯 app 刀；appended, milestone checkboxes untouched）

基线 `ffdd757`（r129）；worktree `/tmp/lume-r130-wt`、分支 `r130-sntp-consumers2`；
开工前 `lume_model_guard.sh` 绿（hy4flash-free）、无 429、未在主仓写文件。

**实证纠偏（先实证后编码）**：
- 简报列出 `examples/worldclock`「若存在则纳入」——实证为**假**：`examples/` 无此
  目录，`tools/playground/build.mjs` 的 45-app 清单亦无。harness 反向断言清单不含它，
  不虚报第四个 app，本轮实为**三**个目标 app。
- 简报假设三 app 可直接照 r129 clock 模式改——实证部分成立：`clock_round` /
  `aurora_clock` 的宿主 harness 都按 `/* GAME UI */` 切纯逻辑片，故同步块必须落在该
  标记之后，否则纯 vm 因 `signal`/`lume` 未注入而崩。`watchface` 则相反：其状态 Text
  在文件靠前处创建并立即求值绑定函数，同步块的 signal 必须先声明，否则
  `faceSyncStatus is not a function`（首轮实证确实触发，已前移修复）。
- `watchface` 的 canvas 预算被 harness 硬断言为 4 canvas / 228,544 px（≤230,400），
  且已有非 ASCII 文案（周几 / 步 / 分钟）。故只加**1 个原生 Text**角落状态（不增
  canvas、不扩尺寸），ASCII 断言收窄到新增的 SNTP 同步块，不误伤既有中文文案。
- 宿主桩 `lume.net.status()` 恒为 `state 0`（DISCONNECTED），故三 app 在宿主下 GOT_IP
  门控天然不触发、不会调用阻塞的 `setTimeNtp()`；同步均按 `_nowMs()` 节拍门控，
  避免 aurora 的 50 ms 帧循环 Every-frame 触发同步。

**实现**（纯 app 层；firmware/runtime/tools 零改动）：
- 三 app 同构同步块：GOT_IP 门控 → `lume.system.setTimeNtp()`（默认 server / 默认 10 s）
  → 仅 `r === 0` 置 `<prefix>WallValid=true` 视为墙钟有效并清空状态；-2/-3/抛错/API 缺失
  照实显示 1970 起设备时间 + ASCII 状态（`SYNCING`/`NO WIFI`/`NO SYNC`），**不伪造时间**。
  重同步 10 min / 失败重试 30 s；动画 / 滑动 / IMU / 天气 / 交互逻辑一律未改。
- `examples/clock_round/app.js`：左上角新增一行 ASCII 状态 Text，空串即已同步。
- `examples/aurora_clock/app.js`：复用既有 `AURORA` HUD 文案位，已同步显示 `AURORA`，
  未同步显示同步状态；不新增节点。
- `examples/watchface/app.js`：共享根上新增 1 个原生 Text（最后子节点、覆盖 5 页），
  既有 4 canvas / 228,544 px 预算原样保留。
- `tests/sntp_consumers2.js`（新，CommonJS）：18 条静态断言 + **18 项变异实证**（去
  GOT_IP 门控、把成功条件改成 `r!==0`、解绑状态 Text、注入非 ASCII、去掉节拍门控、
  清单丢 app / 塞入 worldclock、改固件文件——全部必须 FAIL）。
- `npm run build:playground`：45 bundles + 2 summary，共 47 行 PASS；
  `PASS bundle clock_round 1931 bytes` / `aurora_clock 5432` / `watchface 9146` /
  `PASS prelude 67317 bytes; 45 apps`；三 app 生成物随 feat commit 提交。

**验证**（真机 SNTP 实测 deferred；不声称真机验证）：
- `node tests/sntp_consumers2.js`：18 契约 PASS + 18 变异实证 PASS。
- `node tests/clock_round.js`：PASS（71 calls/frame，60 秒 tick 冒烟）；
  `for t in tests/*.js; do ... done`：73 个 harness，0 FAIL（3m8s）。
- `npm test --prefix tools/lume`：pass 50 / fail 0 / skipped 0（worktree 缺 gitignore
  的 `tools/lume/bin/qjsc`，从主仓复制后对齐基线，源码零改动）。
- `python3 scripts/check_website.py`：missing/invented/duplicates 均 none。
- `node tools/lume/lume.js check`：`clock_round` / `aurora_clock` / `watchface` 均
  `--no-emu` `RESULT: PASS`；哨兵 `examples/counter` 跑完整 emu（复用 ffdd757 基线
  `lume.bin`，未跑 idf.py build）`RESULT: PASS`，R1–R7 全过。
- `git diff ffdd757 HEAD -- firmware/ runtime/ tools/` 与工作树 diff 均为空 → 固件零
  改动，按纪律未跑 `idf.py build`。磁盘 88%，artifacts 只留最终日志，已清测试残留。

详见 docs/KNOWN-SIMPLIFICATIONS.md r130 节。本轮未跑 codex review（主控轮负责）。

### r131 result — SNTP 第三波消费方刀：weather 的 SNTP-first verified HTTPS（纯 app 刀；appended, milestone checkboxes untouched）

基线 `1dc7c76`（r130）；worktree `/tmp/lume-r131-wt`、分支 `r131-sntp-weather`；
开工前 `lume_model_guard.sh` 绿（hy4flash-free）、无 429、未在主仓写文件。

**实证纠偏（先实证后编码）**：
- `runtime/types/lume.d.ts:350-374` 契约确认：`time()` 返回毫秒墙钟，冷启动未同步时是
  1970 基点小值；`setTimeNtp()` 默认 server / 默认 10 s 超时、BLOCKING、0 成功 /
  -1 非法 server / -2 SNTP 失败 / -3 无 IPv4。
- 宿主桩实证：`tests/lib/prelude_runner.js` 的 `_systemTime: () => Date.now()`（宿主墙钟
  已是 2026）、`_systemSetTimeNtp: () => -3`。故 `tests/weather.js` 的 UI pass 下
  `time() >= 2026-01-01`，SNTP 门控天然不触发，既有 harness 零改动通过（13 PASS）。
- `weather` 确在 `tools/playground/build.mjs` 的 45-app 清单内；playground 生成物落在
  `website/playground/`（非 `tools/`），故重建不破坏「firmware/runtime/tools 零改动」断言。
- 明确 documented 变通：`examples/weather/app.js` 头注释旧称「没有 SNTP/设时 API」并编号
  推荐 `weather.insecure=1`，`-2` 文案写「TLS 需校时」却无校时动作——本轮全部纠偏。

**实现**（纯 app 层；firmware/runtime/tools 零改动）：
- `examples/weather/app.js` 刷新门：GOT_IP 通过后、`fetchForecast` 之前，仅当
  `!skipTls && lume.system.time() < WEATHER_CLOCK_MIN_MS` 才先 `lume.system.setTimeNtp()`
  （默认参数）；只看 `r === 0` 继续 verified HTTPS，-2/-3/抛错一律不烧 https、`data` 保持
  DEMO、状态显示带 ASCII 返回码的中文短文案（如 `校时失败 -2，未发 HTTPS`），不伪造数据。
- 墙钟阈值常量 `WEATHER_CLOCK_MIN_MS = 1767225600000`（`Date.parse('2026-01-01T00:00:00Z')`，
  写出并注释）；已达标则不重复同步。失败节流 `lastSyncFailMs`（`lume._nowMs()` 域）
  + `WEATHER_SYNC_RETRY_MS = 60000`，60 s 内不重试，避免连点刷新反复阻塞引擎 10 s。
- 保持 `setTimeout(0)` 模式：SNTP 与 httpGet 同处一次回调顺序执行，不拆两段阻塞。
  `skipTls` 为显式逃生口，直接走 httpsInsecure、不经校时门控，行为不变。
- `-2` 文案从「TLS 需校时」改为「TLS 传输问题」：校时失败已在门内单独提示，能走到
  httpGet 的 -2 是传输/TLS 问题。头注释重写为 SNTP-first 现状，insecure 降为受控逃生口。
- `tests/weather_sntp.js`（新，CommonJS）：15 条源码静态断言 + **15 项变异实证**（去调用、
  移阈值、改比较、跳过 skipTls 门、去节流、改文案、恢复旧头注释、生成物漂移、清单丢
  weather、改固件文件——全部必须 FAIL）；ASCII 断言只收窄到新增 SNTP 块。
- `npm run build:playground`：47 行 PASS（45 bundles + 2 summary），含
  `PASS bundle weather 8080 bytes`；`website/playground/{apps/weather.js,sources/weather.js,sources.js}`
  随 feat commit 提交。

**验证**（真机 SNTP + verified HTTPS 全链路 deferred；不声称真机验证）：
- `node tests/weather_sntp.js`：15 契约 PASS + 15 变异实证 PASS。
- `node tests/weather.js`：13 PASS（10 逻辑 + 3 UI），既有 harness 零改动不回归。
- `for t in tests/*.js; do node "$t" >/dev/null 2>&1 || echo FAIL "$t"; done; echo done`：
  0 FAIL、输出 `done`。
- `npm test --prefix tools/lume`：pass 50 / fail 0 / skipped 0（worktree 缺 gitignore 的
  `tools/lume/bin/qjsc`，从主仓复制后对齐基线，源码零改动）。
- `python3 scripts/check_website.py`：missing/invented/duplicates 均 none。
- `node tools/lume/lume.js check examples/weather|counter --no-emu`：两者均
  `RESULT: PASS (4 steps, 0 failed; exit 0)`。
- `git diff 1dc7c76 HEAD -- firmware/ runtime/ tools/` 与工作树 diff 均为空 → 固件零
  改动，按纪律未跑 `idf.py build`。磁盘 88%，本轮日志落 `/tmp`，artifacts 未新增大件。

详见 docs/KNOWN-SIMPLIFICATIONS.md r131 节。本轮未跑 codex review（主控轮负责）。

### r132 result — OTA 消费方刀：settings OTA 状态行 + token 轮换（纯 app 刀；appended, milestone checkboxes untouched）

基线 `d85e69a`（r131）；worktree `/tmp/lume-r132-wt`、分支 `r132-ota-consumers`；
开工前 `lume_model_guard.sh` 绿（hy4flash-free）、无 429、未在主仓写文件。

**实证纠偏（先实证后编码）**：
- `runtime/types/lume.d.ts:848-859` / `956-962` 契约确认：`OtaStatus` 含
  `running/wifiReady/tokenReady/hmac/port/token`；`token` 是 32 小写 hex，只在本地
  快照与串口 log 出现，从不上 WiFi 信道。`lume.ota.status()` 返回快照，
  `setToken(tokenHex)` 返回 0 成功 / 负码失败。
- `examples/settings/app.js`：page 3 = General，`infoRow`、r129 NTP 行（View + Text +
  Button 三节点）、`pollOnce()` 600 ms 轮询、powerOff 两段确认（signal + 3 s
  setTimeout）均为现成先例；头注释声明 LUME_MAX_NODES=128、静态树 ~95 节点，加一行后
  ~98 仍在预算内。
- `examples/dashboard/app.js`：SYSTEM 为 page 2 canvas，`readSlow()` 发 9 行 info、
  `systemStaticLines()` 8 条分隔线，行 y=62+i*30；第 10 行落在 y=332、底边 346 <
  H=360，故加 1 行 + 1 条分隔线安全。
- `tests/lib/prelude_runner.js` 已有 `lume.ota` 桩（status 返回 object、setToken 返回
  -3）；`vm` 中 `Math.random` 可用（宿主非安全随机源已实证）。
- `dashboard` 在 `tools/playground/build.mjs` 的 45-app 清单内，`settings` 不在；生成物
  落在 `website/playground/`（非 `tools/`），不破坏 firmware/runtime/tools 零改动。

**实现**（纯 app 层；firmware/runtime/tools 零改动）：
- `examples/settings/app.js` General 页新增 OTA 行（3 节点）：ASCII 状态文案由
  `lume.ota.status()` 派生 `ota off / ota wifi down / ota no token / ota :8765 hmac`；
  number 返回按错误码显示 `ota err <code>`（判别用 `typeof === 'object'`）。token 全串
  从不读取、从不进入任何 Text 渲染路径。
- 「New token」两段确认：首点标题变 `Confirm new token?` 并起 3 s 计时器，再点才调
  `lume.ota.setToken()`；新 key 由 `Math.random()` 生成 32 个小写 hex；失败显示
  `setToken err <code>`，成功刷新状态行（tokenReady=true）。头注释如实登记
  `Math.random` 非 CSPRNG 的取舍。
- `examples/dashboard/app.js` SYSTEM 页第 10 行 `OTA <status>`，同样 `typeof === 'object'`
  判别、ASCII 文案，分隔线 8→9；canvas 文本行布局不变。
- `tests/ota_consumers.js`（新，CommonJS）：19 条源码静态断言 + 19 项变异实证（删 status
  读、truthy 判别、直接渲染 token、去两段确认、token 位数改 16、生成物漂移、清单丢
  dashboard、改固件文件等——全部必须 FAIL）。
- `npm run build:playground`：45 bundles + 2 summary PASS；
  `website/playground/{apps/dashboard.js,sources/dashboard.js,sources.js}` 随 feat commit。

**验证**（真机 OTA 推包 / HMAC 握手端到端 deferred；不声称真机验证）：
- `node tests/ota_consumers.js`：19 契约 PASS + 19 变异实证 PASS；全量宿主 harness
  0 FAIL；`npm test` 50/0/0；`check_website.py` missing/invented/duplicates 均 none；
  `lume check` settings / counter / dashboard `--no-emu` 均 `RESULT: PASS`；playground
  47 行 PASS。
- 额外运行时烟测（非提交物）：patched 宿主桩按两次按钮 → setToken 仅第二次调用 1 次，
  生成 32 hex 小写 token，且该 token 不出现在任何 UI attr 消息。
- `git diff d85e69a HEAD -- firmware/ runtime/ tools/` 与工作树 diff 均为空 → 固件零
  改动，按纪律未跑 `idf.py build`。磁盘 88%，日志落 `/tmp`。

详见 docs/KNOWN-SIMPLIFICATIONS.md r132 节。本轮未跑 codex review（主控轮负责）。

### r133 result — `lume.adc` 消费方刀：examples/adc_meter 电压表（纯 app + 宿主桩层；appended, milestone checkboxes untouched）

基线 `c4b390a`（r132）；worktree `/tmp/lume-r133-wt`、分支 `r133-adc-consumers`；
开工前 `lume_model_guard.sh` 绿（hy4flash-free）、无 429、未在主仓写文件。

**实证纠偏（先实证后编码）**：
- `runtime/types/lume.d.ts:425-467` / `firmware/components/lume-adc/lume_adc.c` /
  `lume_adc.h:22-32` 确认：`config(pin,atten)` / `readRaw` / `readMv` / `free` 全部以
  NUMBER 返回状态；-1 = 非法 pin/atten 或越界 raw，-2 = ESP-IDF 驱动/校准失败，
  -3 = pin 未配置或 eFuse 校准不可用。有效 pin = ADC1 GPIO 1..10，atten 0..3 =
  DB_0/2_5/6/12。`readRaw` 成功返回 0..4095，`readMv` 是曲线拟合校准 mV；
  无 eFuse 校准位时 `config` 仍成功但 `readMv` 返回 -3。
- **meta.json 假设被证伪**：`find . -name meta.json` 全仓为空，examples 连 `package.json`
  都没有；CLI `tools/lume/lume.js:109-127` 的 `appMeta()` 在 **deploy 时**从
  `package.json` 的 `lume` 块（label/icon/color）生成 meta 文本。examples 是源码/playground
  app，没有也没有必要新增 meta.json——故本轮**不创建**该文件，避免死文件。
- **生命周期先例**：`lume.app` 只有 `onStart/onPause/onResume/onBack`（prelude
  `__lifecycle` 无 close），app 没有卸载钩子可调用 `free()`；ADC 槽位是引擎任务态、
  hot reload 后保留，`config()` last-wins 重建通道。故 app **不调用** `lume.adc.free()`，
  头注释如实登记该取舍（与 gpio.pwmAttach 不主动 pwmFree 同构）。
- `tests/lib/prelude_runner.js` 的 gpio/imu 桩采用 `...(options.xxx || {})` spread 惯例，
  本轮 adc 桩沿用；宿主无真实 ADC，值全靠注入。
- **数量断言实证**：`grep -rn "45 " tests/ tools/lume/test/ scripts/` 命中 3 处
  （weather_sntp.js / ota_consumers.js / sntp_consumers2.js 的 `list.length === 45`）；
  另 `tests/sd_files.js` 的变异串硬编码 `'image_gallery', 'files'];`。清单从 45→46 后
  三处计数改 46、sd_files 变异串同步，理由写入对应 commit message。三只 consumer 测试另把
  `gitChanged(['firmware/','runtime/','tools/'])` 收窄为 `tools/lume/`：playground 清单是
  **数据注册**，不是 CLI 行为变更；固件/runtime/CLI 工具面仍钉死在各自基线。
- `examples/counter/app.js` / `examples/settings/app.js` 头注释给出保守 `var`/`function`
  全局脚本模板与 `LUME_MAX_NODES = 128` 预算声明惯例；本 app 静态树 ~17 节点。

**实现**（固件/runtime 零改动）：
- `examples/adc_meter/app.js`：默认 GPIO3/atten0，Button 循环 pin 1..10 与 atten 0..3，
  重配走 `adc.config()`；250 ms `setInterval` 轮询 `readRaw`/`readMv`，负值按 `< 0`
  **数值分支**显示 `err <code>`，raw > 4095 显示 `RAW OOR`；正常值渲染 raw / mV 整数，
  Canvas bar 按 mV 比例填充。ASCII-only 文案（r64），pin/atten 越界 `clampInt` 防御。
- `tests/lib/prelude_runner.js`：新增 `adc` 桩（config 0 / readRaw 2048 / readMv 1650 /
  free 0 + `...(options.adc || {})`），与 gpio 桩同风格。
- `tests/adc_meter.js`（新，CommonJS）：真跑 app 读 UI attr/draw 消息，断言 raw/mV 渲染、
  `err -3` / `err -2` / `err -1` 错误分支、pin/atten 切换与环绕、零值不误判为错误、
  4096 越界拒绝、无 free 调用；源码静态断言 ASCII/`< 0` 数值分支/无 token 串/节点预算声明；
  变异实证证明删错误分支、注入非 ASCII、改固件文件、readRaw=4096 均 FAIL。
- `tools/playground/build.mjs`：apps 数组加 `'adc_meter'`（46）；`npm run build:playground`
  生成 `website/playground/{apps,sources}/adc_meter.js` 与 `sources.js`，随 feat commit。

**验证**（真机 ADC 采样精度 / atten 电压范围 / eFuse 曲线 deferred；不声称真机验证）：
- `node tests/adc_meter.js`：18 PASS（含 4 项变异实证）。
- `for t in tests/*.js; do node "$t"; done`：**0 FAIL**。
- `npm test --prefix tools/lume`：`# pass 50 / # fail 0 / # skipped 0`（补齐 worktree 内
  gitignore 的 `tools/lume/bin/qjsc` 软链后恢复 50/0/0 基线）。
- `python3 scripts/check_website.py`：missing/invented/duplicates 均 none。
- `node tools/lume/lume.js check examples/adc_meter --no-emu`：`RESULT: PASS (4 steps)`；
  `examples/counter --no-emu` 哨兵 `RESULT: PASS`。
- `npm run build:playground --prefix tools/lume`：`PASS bundle adc_meter 2453 bytes` +
  `PASS esbuild-wasm assets and 46 editable sources` + `PASS prelude 67317 bytes; 46 apps`。
- `git diff c4b390a HEAD -- firmware/ runtime/` 与工作树 diff 均为空 → 固件零改动，
  按纪律未跑 `idf.py build`。磁盘 88%，日志落 `/tmp`，未新增 artifacts 大件（测试生成的
  `artifacts/r82/fft-host-*/sdkconfig.h` 已清理）。

详见 docs/KNOWN-SIMPLIFICATIONS.md r133 节。本轮未跑 codex review（主控轮负责）。

### r134 result — `lume.crypto` 消费方刀：examples/crypto_check 摘要/校验工具（纯 app 层；appended, milestone checkboxes untouched）

基线 `c003834`（r133）；worktree `/tmp/lume-r134-wt`、分支 `r134-crypto-consumers`；
开工前 `lume_model_guard.sh` 绿（hy4flash-free）、无 429、未在主仓写文件。

**实证纠偏（先实证后编码）**：
- `runtime/types/lume.d.ts:1168-1194` 与 `firmware/components/lume-crypto/lume_crypto.c`
  确认契约：`sha256(data,out)` / `hmacSha256(key,data,out)` 写 32 B，返回 0/-1/-2
  （out < 32 B 为 -2）；`crc32(data,seed?)` 返回 u32 或 -1（0xFFFFFFFF 以
  4294967295 返回，不是 -1）；`aesCtr(key,iv,data,out)`（key 16/24/32 B、iv 16 B，
  可原地）返回 0/-1/-2/-3。`-1` = 类型错、`-2` = 长度/重叠非法、`-3` = mbedTLS 内部失败。
- **playground 数量实证**：`tools/playground/build.mjs` 的 apps 数组实为 **46** 项且不含
  `crypto_check`，与简报一致；46→47。钉清单长度的断言不止简报点名的三处：还有
  `tests/adc_meter.js` 的 `apps.length === 46`，以及三只 consumer 测试用**检查名字符串**
  引用同一条断言（`must('dashboard is in the 46-app playground manifest', ...)` 等）。
  故同步 `list.length`、`apps.length`、注释、检查名字符串与 `sd_files.js` 的硬编码变异串，
  理由写入对应 commit message。`bridge_protocol.c:28` 的 `LUME_ATTR_MAX_WIDTH == 46`
  是 ATTR ID，不是 app 数量，未改。
- `tests/lib/prelude_runner.js:170-185` 的 crypto 桩固定返回 -3 并经 `options.crypto`
  spread 注入真实现；宿主/浏览器天然呈现 UNSUPPORTED，不是异常。
- `examples/adc_meter/app.js`（r133 先例）给出 `var`/`function` 保守全局脚本、
  `LUME_MAX_NODES = 128` 预算声明、`< 0` 数值判别、ASCII-only 的范式，本 app 沿用。

**实现**（固件/runtime/CLI 零改动）：
- `examples/crypto_check/app.js`：单屏静态树（宿主 create 计数 **18** 节点）；3 条内置
  payload（短文本 / 长文本 / 空串）由 NEXT 按钮循环。SHA-256 / HMAC-SHA256 取前 16 B
  共 32 hex 字符 + `...`（480 px 宽度取舍）；CRC-32 分两段链式 seed、按 `>>> 0` 无符号
  十进制显示；AES-CTR 16 B key/iv 加解密回环显示 OK/MISMATCH + 密文前 8 B hex。
  所有负值按数值判别显示 `ERR <code>`，`-3` 单独显示 `UNSUPPORTED`；CRC 只有负值才算
  错误，4294967295 正常渲染。头注释登记节点预算与 hex 截断取舍，UI 文案 ASCII-only。
- `tests/crypto_check.js`（新，CommonJS）：经 `options.crypto` 注入 node:crypto 真实现
  （SHA/HMAC/AES-128-CTR 对拍）+ 自写反射表 CRC-32（与 `zlib.crc32` 交叉验证）；真跑 app
  断言 hex/回环/循环/空 payload/ERR -2/-1/-3/UNSUPPORTED/CRC 无符号与 seed 链/ASCII/
  节点预算/清单 47/生成物字节一致；6 项变异实证（删 -3 分支、注入非 ASCII、摘要截断造假、
  改有符号 CRC、改 firmware 文件、改 runtime 文件）全部必须 FAIL。
- `tools/playground/build.mjs`：apps 数组加 `'crypto_check'`（47）；
  `website/playground/{apps/crypto_check.js,sources/crypto_check.js,sources.js}` 随 feat commit。

**验证**（真机 mbedTLS / 触屏手感 deferred；不声称真机验证）：
- `node tests/crypto_check.js`：23 PASS + 1 汇总 PASS（含 6 项变异实证）。
- `for t in tests/*.js; do node "$t"; done`：**0 FAIL**。
- `npm test --prefix tools/lume`：`# pass 50 / # fail 0 / # skipped 0`（worktree 补齐
  gitignore 的 `tools/lume/bin/qjsc` 后恢复基线）。
- `python3 scripts/check_website.py`：missing/invented/duplicates 均 none。
- `node tools/lume/lume.js check examples/crypto_check --no-emu`：`RESULT: PASS (4 steps)`；
  `examples/counter --no-emu` 哨兵 `RESULT: PASS`。
- `npm run build:playground --prefix tools/lume`：`PASS bundle crypto_check 3175 bytes` +
  `PASS esbuild-wasm assets and 47 editable sources` + `PASS prelude 67317 bytes; 47 apps`。
- `git diff c003834 HEAD -- firmware/ runtime/ tools/lume/` 与工作树 diff 均为空 →
  固件/runtime/CLI 零改动，按纪律未跑 `idf.py build`。磁盘 88%，本轮日志落 `/tmp`，
  测试生成的 `artifacts/r82/fft-host-*/sdkconfig.h` 已清理。

详见 docs/KNOWN-SIMPLIFICATIONS.md r134 节。本轮未跑 codex review（主控轮负责）。

### r135 result — `lume.compress` 消费方刀：examples/archive_view 压缩档案查看器（纯 app 层；appended, milestone checkboxes untouched）

基线 `9d1849f`（r134）；worktree `/tmp/lume-r135-wt`、分支 `r135-compress-consumers`；
开工前 `lume_model_guard.sh` 绿（hy4flash-free）、无 429、未在主仓写文件。

**实证纠偏（先实证后编码）**：
- `runtime/types/lume.d.ts:1196-1212` 与 `firmware/components/lume-compress/lume_compress.c`
  确认契约：`inflate(src, out, format?)` 写入调用方持有的 `Uint8Array`，返回写出字节数
  （空流 0），`-1` 类型/format 非法、`-2` 损坏/截断/校验失败、`-3` out 太小；src 任意
  typed array、out 必须 Uint8Array、view 直接用不拷贝。`tests/compress.js` 编固件同一份
  C 源码，已覆盖上述码；另用同一 runner 对**本 app 的三条真实字节**实测：
  zlib payload 返回 181、raw 返回 177、尾部截短流返回 **-2**（不是 -1）、坏 Adler 返回 -2、
  format `'gzip'` 返回 -1、8 B out 返回 -3。破坏流确实落 -2 而非 -1，故 DAMAGED 条目用
  截短的真实 zlib 字节。
- `tests/lib/prelude_runner.js:186-197` 的 compress 桩固定返回 -3 并经 `options.compress`
  spread 注入真实现（宿主无原生 inflate），浏览器/宿主天然呈现 `ERR -3`，不是异常。
- `examples/crypto_check/app.js`（r134 先例）给出 `var`/`function` 保守全局脚本、
  `LUME_MAX_NODES = 128` 预算声明、`< 0` 数值判别、ASCII-only 的范式，本 app 沿用。
- **playground 数量实证**：47→48。钉清单长度的断言不止 `tests/crypto_check.js` 与
  `tests/adc_meter.js` 的 `apps.length === 47`，还有 `weather_sntp.js` / `ota_consumers.js`
  / `sntp_consumers2.js` 用**检查名字符串**引用同一条断言，以及 `sd_files.js` 的硬编码变异串
  `'image_gallery', 'files', 'adc_meter', 'crypto_check'];`。故同步 `list.length`、
  `apps.length`、注释、检查名字符串与变异串到 48，理由写入对应 commit message。
  另因 r135 新文件在 feat/test commit 后才进入 HEAD，`tests/ota_consumers.js` 的
  `gitChanged([])` 允许清单须追加 4 个 r135 新文件（`examples/archive_view/app.js`、
  `tests/archive_view.js`、`website/playground/{apps,sources}/archive_view.js`），
  否则该 harness 在提交后由绿转红。`bridge_protocol.c:28` 的
  `LUME_ATTR_MAX_WIDTH == 46` 是 ATTR ID，未改。

**实现**（固件/runtime/CLI 零改动）：
- `examples/archive_view/app.js`：单屏静态树（宿主 create 计数 **14** 节点）；3 条内置
  压缩 payload（合成 boot log zlib / 合成传感器记录 raw / boot log 的截短 zlib 损坏流），
  字节字面量内嵌、非真实数据。单一 2 KiB Uint8Array 复用；NEXT 按钮循环 3 条；显示
  解压 ASCII 文本（截到前 120 字符 + `...` 以适配 480 px）、前后字节数与整数百分比
  压缩比、ZLIB/RAW 格式标签。所有负值按数值判别显示 `ERR <code>`，0 不算错误
  （不显示 `ERR 0`）；-2 由真实损坏流触发，-1/-3/0 由 harness 注入覆盖。头注释登记
  节点预算、payload 来源与截断取舍，UI 文案 ASCII-only。
- `tests/archive_view.js`（新，CommonJS）：经 `options.compress` 注入 node:zlib 真实现
  （`inflateSync`/`inflateRawSync` 适配成 stub 签名并把结果拷进 out）；真跑 app 断言
  两条正常 payload 的解压文本/字节数/压缩比/格式标签、真实 -2 损坏流、注入 -1/-2/-3/0
  的 `ERR <code>` 与 0 非错误、NEXT 循环与环绕、默认桩 `ERR -3`、ASCII/`< 0`/截断/
  节点预算/清单 48/生成物字节一致；6 项变异实证（删错误分支、注入非 ASCII、解压结果造假
  含 live 断言、删截断、改 firmware 文件、改 runtime 文件）全部必须 FAIL。
- `tools/playground/build.mjs`：apps 数组加 `'archive_view'`（48）；
  `website/playground/{apps/archive_view.js,sources/archive_view.js,sources.js}`
  随 feat commit。

**验证**（真机 miniz 实测 / 触屏手感 deferred；不声称真机验证）：
- `node tests/archive_view.js`：21 PASS（含 6 项变异实证）。
- `for t in tests/*.js; do node "$t" >/dev/null 2>&1 || echo FAIL "$t"; done; echo done`：
  `done`，**0 FAIL**。
- `npm test --prefix tools/lume`：`# pass 50 / # fail 0 / # skipped 0`（worktree 补齐
  gitignore 的 `tools/lume/bin/qjsc` 软链后恢复基线）。
- `python3 scripts/check_website.py`：missing/invented/duplicates 均 none。
- `node tools/lume/lume.js check examples/archive_view --no-emu`：`RESULT: PASS (4 steps)`；
  `examples/counter --no-emu` 哨兵 `RESULT: PASS`。
- `npm run build:playground --prefix tools/lume`：`PASS bundle archive_view 3455 bytes` +
  `PASS esbuild-wasm assets and 48 editable sources` + `PASS prelude 67317 bytes; 48 apps`。
- `git diff 9d1849f HEAD -- firmware/ runtime/ tools/lume/` 与工作树 diff 均为空 →
  固件/runtime/CLI 零改动，按纪律未跑 `idf.py build`。磁盘 88%，本轮日志落 `/tmp`，
  测试生成的 `artifacts/r82/fft-host-*/sdkconfig.h` 已清理。

详见 docs/KNOWN-SIMPLIFICATIONS.md r135 节。本轮未跑 codex review（主控轮负责）。

### r136 result — `lume.imgscale` 消费方刀：examples/img_view RGB565 缩放演示（纯 app 层；appended, milestone checkboxes untouched）

基线 `67d37a7`（r135）；worktree `/tmp/lume-r136-wt`、分支 `r136-imgscale-consumer`；
开工前 `lume_model_guard.sh` 绿（hy4flash-free）、无 429、未在主仓写文件。

**实证纠偏（先实证后编码）**：
- `runtime/types/lume.d.ts:1150-1166` 确认契约：`scale(src, sw, sh, dst, dw, dh, mode?)`
  直接使用调用方持有的 Uint16Array 视图（无拷贝，subarray 偏移生效），mode 默认
  `'nearest'`、可 `'bilinear'`；返回 0 / -1（参数/类型/mode 错）/ -2（尺寸非法、视图过短、
  部分重叠）/ -3（内部保留、当前实现无可达路径）。同 buffer 仅允许 `sw===dw && sh===dh`
  的原位拷贝。
- `tests/lib/prelude_runner.js:77-132` 的 `imgscaleStub()` 是**真实现**（nearest 中心采样、
  bilinear 8-bit 定点 R5/G6/B5 独立插值），不是固定 -3 桩；它没有 `options.imgscale`
  注入点，但 `runApp()` 返回同一个 `lume` 对象，harness 可在 app 求值后替换
  `ui.lume.imgscale.scale` 现场注入 -1/-2/-3/0，覆盖全部返回码分支。
- `examples/crypto_check/app.js` 与 `examples/archive_view/app.js` 给出保守全局脚本
  （`var`/`function`）、`LUME_MAX_NODES = 128` 预算声明、`< 0` 数值判别（0 非错误）、
  ASCII-only 文案的范式，本 app 沿用。
- 写 harness 前先用独立浮点参考实现对桩输出做标定：24x24 fixture 在 2x/4x/8x 下，
  nearest 与 bilinear 的逐通道误差均为 **0**，故对拍用逐值严格相等，不引入容差。
- **playground 数量实证**：48→49。钉清单长度的断言不止 `tests/archive_view.js` /
  `tests/crypto_check.js` / `tests/adc_meter.js` 的 `apps.length === 48`，还有
  `weather_sntp.js` / `sntp_consumers2.js` / `ota_consumers.js` 用**检查名字符串**引用的
  `list.length === 48`，以及 `sd_files.js` 的硬编码变异串
  `'image_gallery', 'files', 'adc_meter', 'crypto_check', 'archive_view'];`。已逐处同步到
  49；另因新文件在 feat/test commit 后才进入 HEAD，预先把 4 个 r136 新文件加进
  `tests/ota_consumers.js` 的 `gitChanged([])` 允许清单（否则提交后由绿转红），理由写入
  对应 commit message。

**实现**（固件/runtime/CLI 零改动）：
- `examples/img_view/app.js`：单屏静态树（宿主 create 计数 **10** 节点）。内置一张
  24x24 **合成** RGB565 fixture（作者期脚本生成后以数组字面量内嵌，含横向红蓝渐变、
  纵向绿色渐变、黑白棋盘硬边、青色块+红对角条纹，非真实图片）。一张 200x200 Canvas
  每帧调 `imgscale.scale` 把 fixture 放大到 48/96/192 方形，经 `retainImage`/`drawImage`
  呈现；NEXT 按钮循环 2x/4x/8x，MODE 按钮切 nearest/bilinear。HUD 显示 `X<n> <mode>
  24x24 -> <dw>x<dh>` 与状态码；负返回值用 `rc < 0` 数值判别显示 `ERR <code>`，0 显示
  `OK`，绝不显示 `ERR 0`。头注释登记节点预算、fixture 来源与零拷贝 DST 复用取舍，
  UI 文案 ASCII-only。
- `tests/img_view.js`（新，CommonJS）：经 prelude_runner 真跑 app，**独立**写 nearest
  与 bilinear 两个参考缩放实现（浮点坐标、逐通道插值，不抄 stub）做已知答案对拍；
  断言默认 2x、NEXT 三档循环、MODE 双模式切换（含 bilinear 与 nearest 必不同）、
  两个 Button 直连、注入 -1/-2/-3/0 的 `ERR <code>` 与 0 非错误、spy 断言传入的
  mode 字符串与尺寸；静态断言 ASCII/`< 0`/真实 scale 调用/节点预算/清单 49/生成物
  字节一致/固件 runtime CLI 零 diff；**6 项变异实证**（删错误分支、注入非 ASCII、
  scale 结果造假含 live 对拍、参考实现造假、改 firmware 文件、改 runtime 文件）全部
  必须 FAIL。
- `tools/playground/build.mjs`：apps 数组加 `'img_view'`（49）；
  `website/playground/{apps/img_view.js,sources/img_view.js,sources.js}` 随 feat commit。

**验证**（真机面板/触屏 deferred；不声称真机验证）：
- `node tests/img_view.js`：19 PASS 行（18 条检查 + 1 汇总行；其中 6 项为变异实证）。
- `for t in tests/*.js; do node "$t" >/dev/null 2>&1 || echo FAIL "$t"; done; echo done`：
  `done`，**0 FAIL**。
- `npm test --prefix tools/lume`：`# tests 50 / # pass 50 / # fail 0 / # skipped 0`
  （worktree 补齐 gitignore 的 `tools/lume/bin/qjsc` 软链并 `npm ci` 后恢复基线）。
- `python3 scripts/check_website.py`：missing/invented/duplicates 均 none。
- `node tools/lume/lume.js check examples/img_view --no-emu`：`RESULT: PASS (4 steps)`；
  `examples/counter --no-emu` 哨兵 `RESULT: PASS`。
- `npm run build:playground --prefix tools/lume`：`PASS bundle img_view 4850 bytes` +
  `PASS esbuild-wasm assets and 49 editable sources` + `PASS prelude 67317 bytes; 49 apps`。
- `git diff 67d37a7 HEAD -- firmware/ runtime/ tools/lume/` 与工作树 diff 均为空 →
  固件/runtime/CLI 零改动，按纪律未跑 `idf.py build`。磁盘 88%，本轮日志落 `/tmp`，
  测试临时物（fixture 生成脚本）留在 `/tmp`，未进仓。

详见 docs/KNOWN-SIMPLIFICATIONS.md r136 节。本轮未跑 codex review（主控轮负责）。

### r137 Result — vec_demo 矢量物理演示 + 宿主/浏览器 math stub（基线 7c47db1）

**实证纠偏（先实证后编码）**：
- 精读 `firmware/components/lume-engine/lume_math.c` 全文确认语义基准：`vecAdd` 原地
  `a+=b` 并返回 `a`；`vecScale` 原地 `a*=s` 返回 `a`；`dot` 以 double 累加并返回；
  `integrate` 的 acc 交错 `[ax0,ay0,ax1,ay1,...]`、只原地更新 vx/vy（double 运算后一次
  float32 舍入），调用方自行积分位置；`float_view` 按 byteOffset 取指针，subarray 偏移
  生效。**错误契约是抛异常**：非 Float32Array → TypeError，长度不等 / `acc.length !=
  vx.length*2` → RangeError，没有负返回码。`runtime/types/lume.d.ts:1128-1135` 的
  `declare namespace lume.math` 与 `lume.math` 常量核对一致。
- `tests/lib/prelude_runner.js` / `website/playground/runtime.js` 原先**都没有 math 对象**：
  任何用 `lume.math` 的 app 在宿主 harness 与浏览器 playground 会直接 undefined crash。
  两份 stub 追加 `math:` 键，逻辑一致（已用规范化 diff 比对确认）。
- 先例 `examples/img_view/app.js` / `examples/archive_view/app.js` 给出保守全局脚本
  （`var`/`function`）、`LUME_MAX_NODES = 128` 预算声明、ASCII-only 文案的范式，本 app 沿用。

**实现**（固件/runtime/CLI 零改动）：
- `examples/vec_demo/app.js`：24 粒子，Float32Array 存 px/py/vx/vy + 交错 acc；固定
  50 ms 步长每步真实调用四个 API——`integrate` 施重力、`vecScale` 阻尼、`vecAdd` 合成
  水平冲量、`dot(vx,vx)+dot(vy,vy)` 报告速度平方；位置积分与触壁反弹是 app 层 JS。
  240x240 Canvas 逐帧画粒子矩形，HUD 显示 `N24 G<g> E<energy>` 与 `OK`；NEXT 循环
  重力档 40/80/160。四个调用包 try/catch，异常时 HUD 显示 `MATH ERR` 并冻结物理
  （防御分支，正常不可达）。宿主 create 计数 **9** 节点，头注释登记预算与物理口径，
  UI 文案 ASCII-only。
- `tests/lib/prelude_runner.js` + `website/playground/runtime.js`：各加一份
  `mathStub(options)`，忠实镜像 C 语义（原地 mutation、返回 a、double dot、交错 acc、
  Float32Array 单次舍入），异常契约照抄为 TypeError / RangeError，不发明负返回码；
  `options.math` 可供 harness 注入抛异常桩。
- `tests/vec_demo.js`（新，CommonJS）：经 prelude_runner 真跑 app，**独立**写 double 参考
  积分器（不抄 stub）对拍 30 步 vx/vy/px/py/energy 逐值严格相等；断言 200 步反弹不出屏、
  NEXT 档位循环、try/catch 防御（注入TypeError→MATH ERR→冻结）、四 API spy 计数
  （1/2/2/1）；已知答案单测逐值验证 stub 原地性/返回值/byteOffset/dot/integrate 交错
  acc/TypeError+RangeError 契约；静态断言 ASCII/预算/真实调用/清单 50/生成物字节一致/
  固件 runtime CLI 零 diff；**6 项变异实证**（删 try/catch、非 ASCII、app 物理造假、
  对拍参考造假、改 firmware、改 runtime）全部必须 FAIL。
- `tools/playground/build.mjs`：apps 数组加 `'vec_demo'`（50）；
  `website/playground/{apps/vec_demo.js,sources/vec_demo.js,sources.js}` 随 feat commit。

**验证**（真机面板/触屏 deferred；不声称真机验证）：
- `node tests/vec_demo.js`：26 PASS 行（25 条检查 + 1 汇总行；含 6 项变异实证）。
- `for t in tests/*.js; do node "$t" >/dev/null 2>&1 || echo FAIL "$t"; done; echo done`：
  `done`，**0 FAIL**（共享 prelude_runner 改动后全量必跑）。
- `npm test --prefix tools/lume`：`# tests 50 / # pass 50 / # fail 0 / # skipped 0`。
- `python3 scripts/check_website.py`：missing/invented/duplicates 均 none。
- `node tools/lume/lume.js check examples/vec_demo --no-emu`：`RESULT: PASS (4 steps, 0 failed)`，
  bundle 2712 bytes；`examples/counter --no-emu` 哨兵 `RESULT: PASS`。
- `npm run build:playground --prefix tools/lume`：`PASS bundle vec_demo 2712 bytes` +
  `PASS esbuild-wasm assets and 50 editable sources` + `PASS prelude 67317 bytes; 50 apps`。
- `git diff 7c47db1 HEAD -- firmware/ runtime/ tools/lume/` 与工作树 diff 均为空 →
  固件/runtime/CLI 零改动，按纪律未跑 `idf.py build`。磁盘 88%，本轮日志落 `/tmp`，
  测试临时物未进仓。

详见 docs/KNOWN-SIMPLIFICATIONS.md r137 节。本轮未跑 codex review（主控轮负责）。

### r138 result — 分配器泄漏检测 / host OOM 故障注入（实证纠偏；host 新增，固件零改动）

**开工纪律**：`bash /home/ubuntu/.hermes/scripts/lume_model_guard.sh` → `GUARD: model=hy4flash-free ✓`，无 429，未在 `/home/ubuntu/lume` 写任何文件。
新 worktree `/tmp/lume-r138-wt`（分支 `r138-alloc-tracker`，基线 `766e4c4`）。

**实证纠偏（立项假设与真实代码不符，按真实代码走）**：roadmap「推进路线」第 1 条（P1）在 **r54**（commit `775566aa`，2026-11-16）已全部落地，本轮**不重复实现**：
- `firmware/components/lume-engine/lume_engine.c:150-228`：`s_psram_mf` 四个分配钩子（calloc/malloc/free/realloc）已维护 `s_alloc_live` / `s_alloc_net_bytes`，字节口径复用 `heap_caps_get_allocated_size`（`js_usable_size_psram`），O(1) 无锁、engine-task-only；读 API `lume_engine_alloc_stats()` 在 `include/lume_engine.h:9`。
- `lume_engine.c:4431-4434`：`CONFIG_LUME_PERF_PROFILE=y` 下每秒 `I (t) lume-perf: alloc.net=... alloc.live=...`，消费者是 `tools/emu/check_alloc_leak.py`（解析 serial log），非新建通道。
- `tools/emu/check_alloc_leak.py`（commit `605785c`）：esp32sim 稳态断言 harness，`THRESHOLD=32768`，用 counter（负对照，0 B）与故意泄漏 app（正对照，~319 kB）双向校准；落点是 `tools/emu/*.py` 而非任务书写的 `tests/*.js`，因该仓 emu 断言先例就是 Python 脚本，跟随先例。
真实缺口只有「**host runner 内、仅 host 不进固件路径**的 OOM 注入」：基线主线仅有 `tools/emu/check_oom_inject.py`，其依赖的固件侧 `LUME_CMD_OOM` verb 只存在于未合入的 `r77-oom-wip` 分支；基线实跑该 drill 得 `CMD ERR verb` → 脚本 `EXIT=1`（**既有存量失败，非本轮回归**）。r77 的 commit message 虽写 "host OOM fault injection"，实际注入在固件路径，不满足「不进固件路径」。

**本轮实际新增（host-only，2 文件）**：
- `tests/alloc_inject_host.c`：vendored QuickJS-NG 在 host 编译，用自定义 `JSMallocFunctions` 包装倒计时失败注入（arm_at/window/denied）+ net/live 计数（`malloc_usable_size`，host 版 `heap_caps_get_allocated_size`）；单线程、O(1)、无锁。先编译 app 函数再 arm，避免把脚本编译分配误判为注入。
- `tests/alloc_inject.js`：CommonJS driver（跟随 `tests/fft.js` 编译/退出码/临时目录清理先例），断言确定性失败、注入计数、恢复记账与计数器归零。

**验证**（原始输出；真机 deferred，不声称真机验证）：
- `node tests/alloc_inject.js`（新 harness）：
  ```
  setup: calls=69 net=167632 live=54
  inject: armed-at=83 window=1
  engine: exception=InternalError: out of memory
  inject: denied=1 calls=83
  resume: malloc-after-window ok net=167720 live=55
  teardown: net=0 live=0
  RESULT: PASS
  PASS alloc_inject: countdown OOM -> deterministic failure, counter consistent, no crash
  ```
  `EXIT=0`。注入触发时引擎得到确定性 `InternalError: out of memory`（异常而非 crash）；`denied=1` 与计数器一致；窗口关闭后分配恢复且记账；`JS_FreeRuntime` 后 net/live 均回 0。
- `python3 tools/emu/check_alloc_leak.py`（本轮实跑，`EXIT=0`；计数绝对值与 r54 不同，是 app/时钟差异，增长口径与阈值不变）：
  ```
  counter: I (4954) lume-perf: alloc.net=363536 alloc.live=129
  ...（5955/6956/7957/8958/9959/10960/11961 均 363536/129）
  counter: I (12962) lume-perf: alloc.net=363536 alloc.live=129
  counter: steady-growth=0 threshold=32768 PASS
  leak: I (4955) lume-perf: alloc.net=421472 alloc.live=143
  ...（每拍递增，13013 时 740788/221）
  leak: steady-growth=319316 threshold=32768 FAIL
  ```
  counter 基线实测 net=363536 B、稳态增长 **0 B**；故意泄漏正对照增长 **319316 B**；阈值 **32768 B** 介于两者之间（r54 校准 0 / 319300 → 32768，本轮复测漂移 16 B，阈值仍有效）。两个 case 均按预期判定，harness 总退出 0。
- `for t in tests/*.js; do node "$t" >/dev/null 2>&1 || echo FAIL "$t"; done; echo done` → `done`，**0 FAIL**。
- `npm test --prefix tools/lume` → `# tests 50 / # pass 50 / # fail 0 / # skipped 0`。worktree 缺 gitignore 的 `tools/lume/bin/qjsc`，从主仓软链该测试工具后对齐基线（源码零改动；与 r128/r137 记录同一环境事实）。
- `python3 scripts/check_website.py` → `API missing: none` / `API invented: none` / `API duplicates: none` / `API signatures not found in lume.d.ts: none`。
- `node tools/lume/lume.js check examples/counter --no-emu` → `RESULT: PASS (4 steps, 0 failed; exit 0)`。
- **固件完整构建（本轮固件 C 零 diff，仍按纪律跑）**：
  ```
  cd /opt/esp/esp-idf && env -u VIRTUAL_ENV IDF_PYTHON_ENV_PATH=/home/ubuntu/.espressif/python_env/idf5.5_py3.12_env bash -c '. ./export.sh >/dev/null 2>&1; idf.py -C /tmp/lume-r138-wt/firmware build'
  ```
  `BUILD_EXIT=0`，末尾 `Project build complete.` / `Generated .../build/lume.bin` / `lume.bin binary size 0x2e53f0 bytes ... 0x35ac10 bytes (54%) free`。
  `idf.py size` 原始表关键行：`Flash Code 2041168` / `Flash Data 853084` / `DIRAM 247491 (72.42%, Remain 94269)` / `IRAM 16384 (100.0%, Remain 0)` / `Total image size 3036023 bytes`。
  **增量说明**：与最近在册基线（`docs/roadmap.md` r128 result 节记录的 2041168 / 853084 / 247491 / 3036023；r137 为 host-only 刀，固件未变故同值）**逐字节一致，Flash/DIRAM 增量 0 B**；本轮仅加 host 测试文件，未触碰 `firmware/`，故 IRAM 16384 硬线 Remain 0 原样守住。为跑 emu 另建 `build-r54-profile`（`CONFIG_LUME_PERF_PROFILE=y`，`lume.bin 0x2e5d10`），属测试输入。
- `python3 tools/emu/check_oom_inject.py`（既有 drill，非本轮新增）基线实跑 `CMD ERR verb` → `EXIT=1`；原因：固件侧 OOM verb 未合入主线（只在 r77 WIP 分支）。已登记 KNOWN-SIMPLIFICATIONS，不视为本轮回归。
- 磁盘：`/` before `5.4G avail (89%)` → after `6.0G avail (88%)`；收尾删 `firmware/build/` 与 `firmware/build-r54-profile/`（各 337M），日志仅留 `/tmp`，测试临时物未进仓。
- 红线：未改 vendored（QuickJS/LVGL）、未改 JS API 契约与 `.d.ts`、未改 `firmware/`、`runtime/`、`tools/lume/`；既有一切 harness 零回归。commits 拆 feat/test/docs，未推送；**未跑 codex review（主控轮负责）**。ASCII 纪律：新增 host harness 输出全 ASCII，无 app 可见文案改动。

详见 docs/KNOWN-SIMPLIFICATIONS.md r138 节。

### r139 result — 固件侧 OOM 注入 verb（profile 门控），check_oom_inject drill 转绿

**开工纪律**：`bash /home/ubuntu/.hermes/scripts/lume_model_guard.sh` → `GUARD: settings.json model=hy4flash-free ✓` / `GUARD: model=hy4flash-free ✓`，无 429，未在 `/home/ubuntu/lume` 写任何文件。新 worktree `/tmp/lume-r139-wt`（分支 `r139-oom-verb`，基线 `10c93c0`）。

**实证纠偏（假设可能错，先实证）**：
- 通读 `tools/emu/check_oom_inject.py` 全文，drill 精确期望：t=2.5 LUMC 帧 `OOM\t2500\n` → `CMD OK oom 2500` + `oom-inject: armed`；窗口 5.0–6.0 s（`oom-inject: ACTIVE` / `oom-inject: window closed after \d+ denials`）；t=7.5 `LIST` → `CMD OK list \d+`；t=9.0 reload `clock.frame` → `RELOAD OK \d+`；失败判据含 `RELOAD ERR|eval failed`。注意任务书写的 `oom-inject ACTIVE` 与 drill 正则不符（drill 有冒号），按 drill 正则实现。
- `git grep` 复核 `r77-oom-wip`（merge-base `f0dd8ef`）：**无任何 `LUME_CMD_OOM` / OOM verb 实现**，只有 playground 清单修复——r138 KNOWN-SIMPLIFICATIONS 所称「verb 在未合入分支」被证伪，该 verb 从未被实现过。
- 窗口参数口径：`<ms>` 是 arm 到窗口开启的**延迟**，窗口长度固定 1 s（`LUME_OOM_WINDOW_US`）；drill t=2.5 arm 2500 → 5.0–6.0 s，与任务书「t+ms 起持续 ~1s」一致。
- 另查出**存量缺陷**：DATA 帧 reload 设 `cand_want_reply=false`（blame `9421903`），成功 eval 不触发结果回调，`RELOAD OK` 永不发出；即使不 arm OOM 也复现。任务书未预告，属实证纠偏，profile-only 修复，default 路径原样保留。

**实现（firmware 刀，5 文件，全部预处理器门控）**：`lume_cmd.h` 加 `LUME_CMD_OOM` / `oom_ms`（`__has_include("sdkconfig.h")` 取固件门控宏，host 由 `-D` 或缺省决定）；`lume_cmd.c` 加 `OOM <ms>` parser（9 位正整数防 u32 wrap）；`lume_hotreload.c` 加 dispatch（`s_pending_mutex` 串行化 RX 侧单写）；`lume_engine.h`/`lume_engine.c` 加 `lume_engine_oom_inject()`、volatile u32 窗口状态、四个 `s_psram_mf` 分配钩子的 NULL 失败分支、engine loop 边界日志 tick。跨 task 口径：RX task 单写 gen/open/end（gen 最后发布），engine task 独占 flags/denials，u32 微秒有符号差比较规避 wrap，热路径无锁。未动 vendored（QuickJS/LVGL）、JS API 契约与 `.d.ts`。

**验证（原始输出；真机 deferred，不声称真机验证）**：
- default 固件完整构建 + size（命令按环境 quirk `env -u VIRTUAL_ENV IDF_PYTHON_ENV_PATH=.../idf5.5_py3.12_env`）：`BUILD_EXIT=0` / `SIZE_EXIT=0`，`Flash Code 2041168` / `Flash Data 853084` / `DIRAM 247491 (72.42%, Remain 94269)` / `IRAM 16384 (100.0%, Remain 0)` / `Total image size: 3036023 bytes`。与 r138 基线**逐字节一致**（含最后一次门的复验），Flash/DIRAM/IRAM 增量均 0 B；`strings build/lume.elf | grep -c oom-inject` = **0**。
- profile 固件构建 `idf.py -B build-r54-profile -D SDKCONFIG=sdkconfig.r54-profile build`：`BUILD_EXIT=0`，`Project build complete.`；`sdkconfig.r54-profile` 被自动 normalize（+15 行），已 `git checkout --` 撤销不进提交。`strings build-r54-profile/lume.elf | grep oom-inject` → 3 条（`armed` / `ACTIVE` / `window closed after %u denials`）。
- **`python3 tools/emu/check_oom_inject.py`（主验收）全文输出**：
  ```
  bundle /tmp/lume-r139-wt/examples/clock: source 3433 bytes; payload 3433 bytes; frame 3445 bytes (source)
  I (2688) lume-engine: oom-inject: armed 2500 ms
  CMD OK oom 2500
  I (5207) lume-engine: oom-inject: ACTIVE
  I (6208) lume-engine: oom-inject: window closed after 0 denials
  CMD OK list 0
  I (9190) lume-engine: engine recv RELOAD -> recycle runtime
  RELOAD OK 3433
  [emu] wrote /tmp/lume-r139-wt/artifacts/emu/oom-inject/counter/tft.png
  alloc.net drift across run: 17044 B (12 samples)
  PASS: engine survived the OOM window (arm -> 2500 ms -> ACTIVE -> window closed -> LIST ok -> reload ok); artifacts: /tmp/lume-r139-wt/artifacts/emu/oom-inject/counter
  ```
  `DRILL_EXIT=0`。诚实边界：`window closed after 0 denials`——clock 帧 t=9.0 才 stage，窗口内无 QuickJS 分配落入；drill 正则 `\d+` 接受 0，总退出 0。钩子有效性由 profile-only 代码路径 + host 语法门 + ELF 字符串三路证据支撑；denial-positive 场景登记 deferred，不声称已验证。
- host harness 双门编译（`gcc -std=c11 -Wall -Wextra -Werror`，profile 版加 `-DCONFIG_LUME_PERF_PROFILE=1`）：default `mode: default ...` → **47 checks, 0 failure(s)**；profile `mode: profile ...` → **51 checks, 0 failure(s)**。跨 task 分配窗口无法 host 覆盖，如实登记由 esp32sim drill 覆盖。
- `for t in tests/*.js; do node "$t" >/dev/null 2>&1 || echo FAIL "$t"; done; echo done` → `done`，**0 FAIL**。11 个 app-only 守卫的 firmware-immutability BASE 按 r128/r129 先例重钉到 `d91a038`（语义不变，非放宽；详见 KNOWN-SIMPLIFICATIONS r139 节）。
- `npm test --prefix tools/lume` → `# tests 50 / # suites 0 / # pass 50 / # fail 0 / # cancelled 0 / # skipped 0 / # todo 0`，`NPM_EXIT=0`。worktree 缺 gitignore 的 `tools/lume/bin/qjsc` 与 `tools/lume/node_modules`，软链主仓只读物后对齐基线（源码零改动；r128/r137/r138 同一环境事实）。
- `python3 scripts/check_website.py` → `HTML pages: 7...` / `API: 152 catalog entries, 152 type declarations, 34 function namespaces` / `API missing: none` / `API invented: none` / `API duplicates: none` / `API signatures not found in lume.d.ts: none`，`WEBSITE_EXIT=0`。
- `node tools/lume/lume.js check examples/counter --no-emu` → `[PASS] bundle 2160 bytes (17 ms)` / `[SKIP] eval --no-emu` / `RESULT: PASS (4 steps, 0 failed; exit 0)`。
- `python3 tools/emu/check_alloc_leak.py` → `counter: steady-growth=0 threshold=32768 PASS`；`leak: steady-growth=319316 threshold=32768 FAIL`（正对照按预期转红）；`LEAK_EXIT=0`，阈值 32768 判定不变。

**commits（未推送）**：`d91a038 feat(firmware): profile-gated OOM injection verb for check_oom_inject`；`1f2cd1e test(r139): OOM verb gate assertions and re-pin firmware-immutability guards`；docs(r139): append result and known simplifications（本提交）。收尾删 `firmware/build/` 与 `firmware/build-r54-profile/`（各约 337M），日志仅留 `/tmp`，测试临时物未进仓；ASCII 纪律：新增日志与 harness 输出全 ASCII。未跑 codex review（主控轮负责）。

详见 docs/KNOWN-SIMPLIFICATIONS.md r139 节。

### r140 result — OOM drill denial-positive 收口刀 + profile-only `lume.perf` 只读绑定

**开工纪律**：`bash /home/ubuntu/.hermes/scripts/lume_model_guard.sh` → `GUARD: settings.json model=hy4flash-free ✓` / `GUARD: model=hy4flash-free ✓`，无 429，未在 `/home/ubuntu/lume` 写任何文件。新 worktree `/tmp/lume-r140-wt`（分支 `r140-oom-denial-positive`，基线 `3e93fd5`）。

**实证纠偏（假设可能错，先实证）**：
- 读 `lume_engine.c` 确认窗口引擎 task 独占状态为 `static bool s_oom_active` / `static uint32_t s_oom_denials`（跨 task volatile 仅 `s_oom_gen / s_oom_open_us / s_oom_end_us`）；`lume_engine_alloc_stats(size_t *net_bytes, size_t *live)` 始终编译、profile 开才返回真实值；prelude namespace 先例为 `register_bindings()` 里 `JS_NewObject` + `JS_SetPropertyStr(ctx, obj, ..., JS_NewCFunction(...))`；QuickJS-NG 提供 `JS_NewObjectProto(ctx, JS_NULL)` 与 `JS_NewBool/JS_NewUint32/JS_NewInt64`，满足 null-prototype 返回形状。
- drill 实跑两次暴露**两个环境实证纠偏**（任务书未预告，详见 KNOWN-SIMPLIFICATIONS r140 节）：(1) 窗口内推 LUME reload 帧会在 `__lume_shutdown` 触发 `InternalError: out of memory` → watchdog 重启，丢失 `window closed` 日志；改用 LUMR REPL 表达式（同为直推 source、不回收 runtime）后干净拿到 N≥1；(2) 固件 +600 B 后 esp32sim 丢弃原 3445 B 的 `clock.frame`，最终 recycle 校验改用 10 B 的 LUME source 帧，`RELOAD OK \d+` 断言不变。

**实现（两刀）**：
- **固件刀（feat `4e00954`）**：新增 profile 门控只读绑定 `lume.perf.oomState()` → `{active:boolean, denials:number}`（读 `s_oom_active` / `s_oom_denials`）与 `lume.perf.allocStats()` → `{net:number, live:number}`（复用 `lume_engine_alloc_stats()`），namespace 与返回对象均 null-prototype，纯引擎 task 读。共享可移植 token 头 `lume_perf_binding.h` 让固件注册与 host harness 同源。全部包在 `#if CONFIG_LUME_PERF_PROFILE`：default 零增量，**不进 `.d.ts`**（profile-only 调试面），未碰 vendored（QuickJS/LVGL）。
- **drill/app 刀（test 提交）**：`check_oom_inject.py` 加 `--case {counter,denial-positive,all}`（默认 `all`）与 `--denial-positive` 别名；denial-positive 在 t=5.2 / 5.5 推 REPL source 帧，窗口闭合后断言 `window closed after [1-9]\d* denials`（N≥1），零拒绝 FAIL；counter case 其余行为不变。`tests/apps_protocol.c` profile mode 补 6 条 `lume.perf` token/形状断言，default mode 不新增。

**验证（原始输出；真机 deferred，不声称真机验证）**：
- default 固件完整构建 + size（命令 `env -u VIRTUAL_ENV IDF_PYTHON_ENV_PATH=.../idf5.5_py3.12_env`）：`BUILD_EXIT=0` / `SIZE_EXIT=0`，`Flash Code 2041168` / `Flash Data 853084` / `DIRAM 247491 (72.42%, Remain 94269)` / `IRAM 16384 (100.0%, Remain 0)` / `Total image size: 3036023 bytes`。与 r139 基线**逐字节一致**（Flash/DIRAM/IRAM 增量 0 B）；`strings build/lume.elf | grep -c oom-inject` = **0**。
- profile 构建 `idf.py -B build-r54-profile -D SDKCONFIG=sdkconfig.r54-profile build`：`BUILD_EXIT=0`；`strings build-r54-profile/lume.elf | grep -c "oom-inject\|lume.perf"` = **40**（`oom-inject` 3 / `lume.perf` 37）；`sdkconfig.r54-profile` 自动 normalize（+15 行）已 `git checkout --` 撤销。
- **`python3 tools/emu/check_oom_inject.py`（含新 denial-positive case）全文输出**：
  ```
  === case: counter ===
  I (2688) lume-engine: oom-inject: armed 2500 ms
  CMD OK oom 2500
  I (5207) lume-engine: oom-inject: ACTIVE
  I (6208) lume-engine: oom-inject: window closed after 0 denials
  CMD OK list 0
  RELOAD OK 10
  PASS: engine survived the OOM window ...
  === case: denial-positive ===
  I (2688) lume-engine: oom-inject: armed 2500 ms
  CMD OK oom 2500
  I (5207) lume-engine: oom-inject: ACTIVE
  I (6189) lume-engine: oom-inject: window closed after 6 denials
  CMD OK list 0
  RELOAD OK 10
  PASS: denial-positive window closed with >=1 allocation denials ...
  ```
  `DRILL_EXIT=0`。**主验收绿**：denial-positive 窗口闭合 `after 6 denials`，N=6 ≥ 1；r139 的 `denials=0` 边界已真实收口。
- host harness 双门编译（`gcc -std=c11 -Wall -Wextra -Werror`，profile 加 `-DCONFIG_LUME_PERF_PROFILE=1`）：default `47 checks, 0 failure(s)`；profile `57 checks, 0 failure(s)`（含 6 条 `lume.perf` 断言）。
- `for t in tests/*.js; do node "$t" >/dev/null 2>&1 || echo FAIL "$t"; done; echo done` → `done`，**0 FAIL**。11 个 app-only 守卫的 firmware-immutability BASE 按先例重钉到本轮 feat 提交 `4e00954`（语义不变，非放宽）。
- `npm test --prefix tools/lume` → `# tests 50 / # pass 50 / # fail 0`，`NPM_EXIT=0`；`python3 scripts/check_website.py` → missing/invented/duplicates/signatures 均 none，`WEBSITE_EXIT=0`；`node tools/lume/lume.js check examples/counter --no-emu` → `RESULT: PASS (4 steps, 0 failed; exit 0)`。

**commits（未推送）**：`4e00954 feat(firmware): profile-only lume.perf read-only JS bindings (r140)`；test(r140) denial-positive drill case + `lume.perf` host assertions + BASE re-pin；docs(r140) append result and known simplifications（本提交）。收尾删 `firmware/build/` 与 `firmware/build-r54-profile/`，日志仅留 `/tmp`；ASCII 纪律全满足。未跑 codex review（主控轮负责）。

详见 docs/KNOWN-SIMPLIFICATIONS.md r140 节。

### r141 result — `lume.system.reboot()` 绑定（收口 r8 遗留，appended, milestone checkboxes untouched）

**开工纪律**：`bash /home/ubuntu/.hermes/scripts/lume_model_guard.sh` → `GUARD: settings.json model=hy4flash-free ✓` / `GUARD: model=hy4flash-free ✓`，无 429，未在 `/home/ubuntu/lume` 写任何文件。新 worktree `/tmp/lume-r141-wt`（分支 `r141-system-reboot`，基线 `ddde5c9`）。

**实证纠偏（假设可能错，先实证）**：
- 读 `lume_engine.c` 确认 r128 system 先例：`_systemTime` / `_systemSetTimeNtp` 以 `_` 前缀注册在 `lume` 上，再由 `lume_scripts.c` 的 prelude 包成 `lume.system.time/setTimeNtp`；参数校验用 `JS_ThrowTypeError`，日志用 `TAG="lume-engine"` 的 ESP_LOGW。`lume.system` 对象在 prelude（非 `register_bindings()`）组装，故 reboot 必须同时落 C native + prelude 一行。
- 读 ESP-IDF v5.5.5 `esp_system.h:71-79`：`esp_restart()` 标 `__noreturn__`、可从任一 CPU/任务调用、`esp_system.c:47-63` 仅跑 shutdown handlers 后 `vTaskSuspendAll()` + `esp_restart_noos()`；IDF 惯例**不要求**先 flush stdio 或 `vTaskDelay`（ESP_LOG 同步写 UART）。据此在引擎 task 直接调用，未在 native 里加冗余延时。
- 实证 prelude 直接把 native 赋给 `lume.system.reboot`（同 `log: lume.log`），使多余 JS 参数真实到达 native 的 `argc > 0` 校验并抛 TypeError；若用转发包装函数则参数会被吞掉。

**实现（两刀 + 文档刀）**：
- **固件刀（feat `2e192d5`）**：新增无参 `lume.system.reboot()` native，打一条 ASCII 日志 `lume.system: reboot requested` 后 `esp_restart()`；`@c` 返回 `JS_UNDEFINED` 仅为签名形式（不可达），语义在 `.d.ts` 标 `never`。新增可移植 token 头 `lume_system_binding.h`（仿 r140 `lume_perf_binding.h`，但 default 可见、无门控）。更新 r8 遗留注释。`website/api.html` 重生成（153 行），playground prelude 快照同步重生成。default 可见 API，小幅增长；未碰 vendored（QuickJS/LVGL）、未碰 profile-only 面（lume.perf/OOM 不动）。
- **契约**：`lume.d.ts` system 块加 `reboot(): never` + JSDoc（不返回、未保存 JS 状态即失、LittleFS 已 journal 但 open 写句柄会断、WiFi/SNTP 重启后重建、KV 持久）。
- **测试刀（test `1f44017`）**：`tests/apps_protocol.c` default mode 补 5 条 token/契约断言（namespace/method/native/log/ASCII），profile mode 不动（57 checks 不回归）；11 个 app-only 守卫 BASE 从 `4e00954` 重钉到 feat `2e192d5`（语义不变、非放宽）；新增 `tools/emu/check_reboot.py` 并加入 `ota_consumers.js` ALLOWED。

**验证（原始输出；真机 deferred，不声称真机验证）**：
- default 完整构建 + size：`BUILD_EXIT=0`、日志 `error:` 计数 0；`Flash Code 2041288`（r140 2041168，+120）、`Flash Data 853292`（853084，+208）、`DIRAM 247491 (72.42%, Remain 94269)`（±0）、`IRAM 16384 (100.0%, Remain 0)`（**硬线未破**）、`Total image size: 3036351`（3036023，+328）。
- `strings firmware/build/lume.elf | grep -c "reboot requested"` = **1**。
- `gcc -std=c11 -Wall -Wextra -Werror` 双门编译 `tests/apps_protocol.c`：default `52 checks, 0 failure(s)`（47 + 5），profile `57 checks, 0 failure(s)`（未回归）。
- `for t in tests/*.js; do node "$t" ...; done; echo done` → `done`，**0 FAIL**（补齐 gitignore 的 `tools/lume/node_modules` 与 `bin/qjsc` 软链后）。
- `npm test --prefix tools/lume` → `# tests 50 / # pass 50 / # fail 0`，`NPM_EXIT=0`。
- `python3 scripts/check_website.py` → 153 catalog / 153 declarations，missing/invented/duplicates/signatures 均 none，`WEBSITE_EXIT=0`。
- `node tools/lume/lume.js check examples/counter --no-emu` → `RESULT: PASS (4 steps, 0 failed; exit 0)`。
- **可选 emu 加分项达成**：`python3 tools/emu/check_reboot.py` → `REBOOT_CHECK_EXIT=0`，原始串口证据：
  ```
  I (2688) lume-engine: lume.system: reboot requested
  [script] t=2.500s serial-file (33 bytes)
  [emu] chip reset at t=2.502s: cause 0xc (RTC_SW_CPU_RESET)
  rst:0xc (RTC_SW_CPU_RST),boot:0xf (SPI_FAST_FLASH_BOOT)
  I (1738) lume-engine: engine task up (pinned core 1), PSRAM free=5433700 bytes
  ```
  断言链：native 日志 → 软件复位 → 引擎重启，全部命中。模拟器证据，非真机。

**commits（未推送）**：`2e192d5 feat(firmware): add lume.system.reboot() binding (r141)`（含契约与重生成的 api.html/playground prelude）；`1f44017 test(r141): reboot token contract + re-pin immutability guards`；docs(r141) 本提交。收尾删 `firmware/build/`，日志仅留 `/tmp`，worktree 净空。ASCII 纪律全满足。未跑 codex review（主控轮负责）。不做消费方 app（留后续刀，同 r125→r126 节奏）。

详见 docs/KNOWN-SIMPLIFICATIONS.md r141 节。

### r143 result — `lume.system.reboot()` 消费方刀：settings Reboot 入口（appended, milestone checkboxes untouched）

**开工纪律**：`bash /home/ubuntu/.hermes/scripts/lume_model_guard.sh` → `GUARD: settings.json model=hy4flash-free ✓` / `GUARD: model=hy4flash-free ✓ (settings + runtime audit clean)`，无 429，未在 `/home/ubuntu/lume` 写任何文件。新 worktree `/tmp/lume-r143-wt`（分支 `r143-reboot-consumers`，基线 `92b6f29`）。

**实证纠偏（假设可能错，先实证）**：
- 读 `examples/settings/app.js` 全文确认 r132 OTA `rotateOtaToken()` 的两段门精确结构：`if (!otaConfirm())` → `otaConfirm.set(true)` + `clearTimeout(otaArmTimer)` + `setTimeout(...3000)` + `return;`；第二拍 `otaConfirm.set(false)` + 清 timer + 实际操作。r141 reboot 契约块在 `lume.d.ts:376-392`（`function reboot(): never`、不可达返回、未持久化状态即失）。`tests/ota_consumers.js` 提供「slice 标记 + 顺序断言 + mutation 实证 + 字节一致 + gitChanged」家族范式，新 harness 照此精简。
- **任务书前提被实证推翻**：`tools/playground/build.mjs` 的 50-app 清单里**根本没有 settings**（`git log -S"'settings'"` 无任何命中，从无生成物）。但验证项要求 `PASS bundle settings` 与 `sources/settings.js` 字节一致，故按 r133–r137 新消费方 app 的既有先例把 settings 注册为第 51 个 app：清单 50→51，8 个 harness 的 `length === 50` 计数、`sd_files.js` 的清单变异串、`sntp_consumers.js` 的 NTP row slice 终点全部同步；`ota_consumers.js` ALLOWED 预加 3 个新文件（commit 前 `git diff` 看不见 untracked，先加防提交后转红）。**这些只是断言口径同步，不改任何生产行为**；`firmware/ runtime/ tools/lume/` 仍零 diff。详见 KNOWN-SIMPLIFICATIONS r143 节。

**实现（feat `7e0cef4`，纯 app 层）**：
- `examples/settings/app.js` General 页新增 3 节点 Reboot 行（View + Text + Button）：按钮标题在 `'Reboot'` / `'Confirm reboot?'` 间翻转，首次点按 arm 3 s 超时回退，窗口内第二拍才动作；`rebootNow()` 完全仿 OTA 两段门（先 arm + `setTimeout(...3000)` + `return`，再 disarm + 清 timer）。防御性守卫 `if (!lume.system || typeof lume.system.reboot !== 'function')` 命中则只写 ASCII note `'reboot n/a'` 并返回，playground stub 无绑定时 eval 不崩。新增文案全 ASCII（r64）。静态树 +3 节点（~98→~101），仍在 `LUME_MAX_NODES = 128` 内。
- playground 重建纳入 feat：`PASS bundle settings 13967 bytes` / `PASS esbuild-wasm assets and 51 editable sources` / `PASS prelude 67428 bytes; 51 apps`，生成物 `sources/settings.js`（与示例逐字节一致）、`apps/settings.js`、`sources.js` 随 feat 提交。

**验证（原始输出；真机 deferred，不声称真机验证）**：
- `node tests/reboot_consumers.js` → 9 条断言 + 9 条 mutation 全绿，`ALL REBOOT CONSUMERS HARNESS CASES PASSED`，`RC_EXIT=0`。关键断言行：
  ```
  PASS reboot_consumers: two-stage gate: first tap arms a 3 s confirm and returns before reboot
  PASS reboot_consumers: typeof guard precedes reboot; stub without binding degrades to ASCII note
  PASS reboot_consumers: firmware/ runtime/ CLI tooling identical to 92b6f29
  PASS reboot_consumers mutation: drop the typeof guard -> FAIL as expected
  PASS reboot_consumers mutation: a firmware file changes vs 92b6f29 -> FAIL as expected
  ```
- `for t in tests/*.js; do node "$t" >/dev/null 2>&1 || echo FAIL "$t"; done; echo done` → `done`，**0 FAIL**（首轮暴露 `sd_files.js` 清单变异串与 `sntp_consumers.js` NTP slice 终点两处存量假设，按实证修正后复跑 0 FAIL；新增文件 staged 后再次复跑仍 `done`，确认提交后不回归）。
- `npm test --prefix tools/lume` → `# tests 50 / # suites 0 / # pass 50 / # fail 0 / # cancelled 0 / # skipped 0 / # todo 0`，`NPM_EXIT=0`。worktree 缺 gitignore 的 `tools/lume/bin/qjsc` 与 `node_modules`，软链主仓只读物后对齐基线（r128/r137/r138/r141 同一环境事实，源码零改动）。
- `python3 scripts/check_website.py` → `API: 153 catalog entries, 153 type declarations, 34 function namespaces` / `API missing: none` / `API invented: none` / `API duplicates: none` / `API signatures not found in lume.d.ts: none`，`WEBSITE_EXIT=0`。
- `node tools/lume/lume.js check examples/settings --no-emu` → `[PASS] bundle 13967 bytes` / `RESULT: PASS (4 steps, 0 failed; exit 0)`；哨兵 `examples/counter --no-emu` → `[PASS] bundle 2160 bytes` / `RESULT: PASS (4 steps, 0 failed; exit 0)`。
- `npm run build:playground --prefix tools/lume` → `PASS bundle settings 13967 bytes` / `PASS esbuild-wasm assets and 51 editable sources` / `PASS prelude 67428 bytes; 51 apps`，`BUILD_PG_EXIT=0`。
- **固件零改动**：`git diff 92b6f29 HEAD -- firmware/ runtime/ tools/lume/` 与工作树 diff 均为空（命令与空输出贴于验证记录），故**未跑 `idf.py build`**。
- **可选 emu 加分项达成**：软链 `firmware/build` 与 `tools/emu/.cache` 只读物后 `EMU_SKIP_BUILD=1 EMU_SECONDS=10 tools/emu/run.sh examples/settings` → `EMU_EXIT=0`，关键串口行：
  ```
  I (2695) lume-engine: engine recv RELOAD -> recycle runtime
  I (2925) lume-engine: runtime up; eval app '<embedded-demo>' (13967 bytes)
  I (3076) lume-engine: app eval ok; entering event loop
  [emu] stop: Halted ... emulated 10.000s ...
  ```
  日志中 `lume-ble: BLE stack not initialized`、`i2s ... allocate DMA buffer failed`、`battPercent: no battery connected` 是模拟器环境噪声，非 JS eval 失败；`eval failed` / `RELOAD ERR` 零命中。仍是模拟器证据，非真机。

**commits（未推送）**：`7e0cef4 feat(settings): add two-stage Reboot row to General page`（含 playground 生成物与清单）；`b0d94fd test(r143): reboot consumer harness and guard updates for 51-app manifest`；docs(r143) 本提交。日志仅留 `/tmp/r143-*.txt` 与 `/tmp/r143-emu-settings/`，artifacts 只留最终日志；worktree 保留 gitignore 软链，未进提交。ASCII 纪律全满足。未跑 codex review（主控轮负责）。真机重启、USB 断连/串口重枚举、3 s 窗口手感全部 deferred。

详见 docs/KNOWN-SIMPLIFICATIONS.md r143 节。

### r144 result — emu-net WiFi 关联收口刀（appended, milestone checkboxes untouched）

**开工**：`bash /home/ubuntu/.hermes/scripts/lume_model_guard.sh` → 两行 `model=hy4flash-free ✓`，无 429，未在 `/home/ubuntu/lume` 写文件。新 worktree `/tmp/lume-r144-wt`（分支 `r144-emu-wifi`，基线 `254c096`）。

**实证纠偏（任务书「上游限制 or Lume 配置」二分被进一步收敛）**：同一 IDF v5.5.5 / esp-emu v1.2.0 / 同一 `--wifi-auth wpa2-psk` 参数下，上游 stock `examples/wifi/getting_started/station` **关联成功并拿到 IP**（`got ip:192.168.4.2`，exit 0）→ 根因**不在模拟器/宿主侧**。随后 6 个 stock 差量变体（config-after-start、raw netif、IRAM off、SoftAP on、全套 SPIRAM、240 MHz）全部关联成功；Lume 侧 6 个变体（transition AP、显式 PSRAM、`WIFI_PS_NONE`、延迟 connect、显式 scan、UART0 console）全部失败。`RUST_LOG=debug` 的 AP 侧日志给出决定性证据：Lume 打印 `wifi:m f assoc req l=221` 但**总线从未触发该帧的 TX**，AP 无 `assoc request received`，1 s 后 `assoc -> init (0x400)` = ASSOC_EXPIRE；stock 同窗口有完整 `subtype=11 auth → subtype=0 assoc → 4-way handshake`。即关联请求帧在固件内部构造却未进入 esp-emu WiFi TX 通路，**不是密码/认证/扫描/省电/配置值问题**。

**取舍（诚实负结果）**：不硬造修复、不放宽 runner 退出断言、不改固件（E10 的 `WIFI_PS_NONE` 实验无改善已回退，未触发 BASE 重钉）；M4 WiFi OTA 行保持不勾。runner 仅加失败诊断快照 `failure-diag.txt`（esp-emu 版本、非敏感参数摘要、密码仅记长度、镜像 sha256、串口关键行），零固件改动。完整实验矩阵、命令、串口原始行、上游文档/issues 线索与复验条件见 `docs/archive/r144-emu-wifi-report.md`。

**验证（原始输出；真机 deferred，不声称真机验证）**：`for t in tests/*.js` → `done`，0 FAIL；`npm test --prefix tools/lume` → `pass 50 / fail 0 / skipped 0`（软链 gitignore 的 `bin/qjsc` 与 `node_modules` 后对齐基线）；`check_website.py` → missing/invented/duplicates 均 none；`lume check examples/net_check --no-emu` 与 `counter --no-emu` 均 `RESULT: PASS`。全链 `tools/emu-net/run.sh examples/net_check` **exit 1**，`[NETCHECK] init PASS` / `connect PASS` / `ip FAIL timeout`，无 `ALL PASS`（负结果）。`git diff 254c096 HEAD -- firmware/` 为空，未跑 `idf.py build/size`。

**commits（未推送）**：infra `tools/emu-net/run.sh` 失败诊断 + docs(r144) 本轮报告/roadmap/KNOWN-SIMPLIFICATIONS。worktree `/tmp` 实验产物不进仓；ASCII 纪律满足；未跑 codex review（主控轮负责）。详见 KNOWN-SIMPLIFICATIONS r144 节。

### r146 result — `lume.ble` 消费刀：examples/hr_monitor BLE 外设心跳广播器（appended, milestone checkboxes untouched）

**开工**：`bash /home/ubuntu/.hermes/scripts/lume_model_guard.sh` → `GUARD: settings.json model=hy4flash-free ✓` / `GUARD: model=hy4flash-free ✓ (settings + runtime audit clean)`，无 429，未在 `/home/ubuntu/lume` 写任何文件。新 worktree `/tmp/lume-r146-wt`（分支 `r146-biometrics`，基线 `27541bb`）。

**实证纠偏（主控已采信，先读源码复核）**：`lume.ble`（r25 NimBLE GATT server，`lume.d.ts:1002-1058`）是**外设角色**——广播「Lume」、Nordic-UART-shaped 服务（RX write / TX notify）、20 字节包上限、无 central/scan/connect 能力。故不存在「BLE 心率计 central 扫描」场景；本刀把 hr_monitor 做成设备侧的**心跳遥测广播器**：连接且 central 订阅 TX 后每秒 `write('HR 072')`，HUD 显示连接/订阅/收发状态。`examples/ble_uart`（BLE 生命周期 + 两段命名）与 `examples/heart_curve`（Canvas 脉搏曲线）作为参照，不复制粘贴。

**manifest 纠偏（同 r143 先例）**：实证 `tools/playground/build.mjs` 清单为 51 个 app，**无 hr_monitor**（ble_uart 亦从未注册），故按先例注册为第 52 个 app：清单 51→52，10 个 harness 的计数断言（`ota_consumers` / `weather_sntp` / `sntp_consumers2` / `vec_demo` / `img_view` / `archive_view` / `adc_meter` / `crypto_check` / `reboot_consumers` + 本刀 harness）、`sd_files.js` 清单变异串、`ota_consumers.js` ALLOWED 预加 4 个新文件全部同步（commit 前 untracked 对 `git diff` 不可见，先加防提交后转红）。只同步口径，不改生产行为；`firmware/ runtime/ tools/lume/` 仍零 diff。

**实现（纯 app 层）**：`examples/hr_monitor/app.js` 全 ASCII UI。广播启停两段门 `toggleAdvert()`（首拍 arm + `setTimeout(...3000)` + `return`，第二拍才 `lume.ble.stop()`/`start()`）；`poll()` 由 `lume.system.setInterval(poll, 200)` 驱动，`status()` 负错误码以 `typeof s === 'object'` 判别，HUD 显示 state/subscribed/pending/mtu；`read()` 收到 string（≠ null）显示最近指令并 `.slice(0, 20)` 截断；`sendHr()` 由 `setInterval(sendHr, 1000)` 节流（≥1s），仅在 `CONNECTED && subscribed` 时写定宽 ASCII `'HR ' + ('00' + n).slice(-3)`（≤20B）；无 BLE 栈时 `typeof lume.ble !== 'undefined'` 守卫降级为 ASCII note `'BLE n/a (no stack)'`，不崩。Canvas 滚动脉搏线参照 heart_curve。playground 重建：`PASS bundle hr_monitor 3397 bytes` / `PASS esbuild-wasm assets and 52 editable sources` / `PASS prelude 67428 bytes; 52 apps`。

**验证（原始输出；真机 deferred，不声称真机验证）**：
- `node tests/hr_monitor.js` → 12 条断言 + 12 条 mutation 全绿，`ALL HR MONITOR HARNESS CASES PASSED`，退出码 0。关键行：
  ```
  PASS hr_monitor: two-stage gate arms a 3 s confirm and returns before start/stop
  PASS hr_monitor: status() negative-number error discriminated via typeof === object
  PASS hr_monitor: firmware/ runtime/ CLI tooling identical to 27541bb
  PASS hr_monitor mutation: drop the typeof lume.ble guard -> FAIL as expected
  PASS hr_monitor mutation: drop the first-tap arm gate -> FAIL as expected
  ```
- `for t in tests/*.js; do node "$t" >/dev/null 2>&1 || echo FAIL "$t"; done; echo done` → `done`，**0 FAIL**（83 个 harness）。
- `npm test --prefix tools/lume` → `# tests 50 / # pass 50 / # fail 0 / # skipped 0`（worktree 缺 gitignore 的 `tools/lume/bin/qjsc`，从主仓拷贝只读构建物后对齐基线，源码零改动，同 r128/r137/r143 环境事实）。
- `python3 scripts/check_website.py` → `API: 153 catalog entries, 153 type declarations, 34 function namespaces` / `API missing: none` / `API invented: none` / `API duplicates: none`。
- `node tools/lume/lume.js check examples/hr_monitor --no-emu` 与 `counter --no-emu` → 均 `RESULT: PASS (4 steps, 0 failed; exit 0)`。
- `npm run build:playground --prefix tools/lume` → `PASS bundle hr_monitor 3397 bytes` / `PASS esbuild-wasm assets and 52 editable sources` / `PASS prelude 67428 bytes; 52 apps`。
- **固件零改动**：`git diff 27541bb HEAD -- firmware/ runtime/` 与工作树 diff 均为空（命令与空输出贴于验证记录），故**未跑 `idf.py build`**。IRAM 16384 硬线未触碰。

**Part B（M5 Board abstraction 首刀）取舍**：本轮未做。Part A 的零固件 diff 不变量与本刀 harness 的 `firmware/ runtime/ tools/lume/` 零 diff 守卫直接冲突；做 Part B 会触发多 harness 基线重钉级联 + 全量 `idf.py build`（磁盘/环境成本）。按任务书「都允许只完成部分」「Part B 可选」的口径，Part B 留独立固件刀，详见 KNOWN-SIMPLIFICATIONS r146 节。

**commits（未推送）**：`feat(hr_monitor app + playground 清单)` / `test(hr_monitor harness + 52-app 口径同步)` / `docs(r146)`。实验产物仅留 `/tmp`，仓库只进源码 + docs。ASCII 纪律全满足；未改 vendored（QuickJS/LVGL）、未改 `.d.ts`；未跑 codex review（主控轮负责）。真机 BLE 广播/GATT 发现/notify 吞吐/WiFi+BLE 共存/睡眠电流全部 deferred，统一为「模拟器/宿主证据，非真机」。

详见 docs/KNOWN-SIMPLIFICATIONS.md r146 节。

### r147 result — M5 Board abstraction 首刀：`lume-board-hal` 运行时单例桩（appended, milestone checkboxes untouched）

**开工**：`bash /home/ubuntu/.hermes/scripts/lume_model_guard.sh` → `GUARD: settings.json model=hy4flash-free ✓` / `GUARD: model=hy4flash-free ✓ (settings + runtime audit clean)`，无 429，未在 `/home/ubuntu/lume` 写文件。新 worktree `/tmp/lume-r147-wt`（分支 `r147-board-hal`，基线 `4155d15`）。

**实证纠偏（任务书前提错误，先读源码复核）**：任务书要求新增 `firmware/components/lume-board/{include/lume_board.h,lume_board.c,CMakeLists.txt}`，并断言「无人引用也编译干净」。实证这三个文件**在基线 4155d15 已存在且被 git 跟踪**：`lume-board` 是 r27/r44/r45 收口的**板级驱动组件**，内含 `lume_board.c/h`（`lume_board_init` / I2C / LVGL / 显示睡眠唤醒 / capture）、`lume_display.c`、`lume_touch.c`、`lume_pmic.c`、`lume_pins.h` 与自己的 CMake 注册；`firmware/main/CMakeLists.txt:4` 已把 `lume-board` 列入 `REQUIRES`。直接按任务书路径写会覆盖工作代码、破坏固件，并违反「不改任何既有文件」硬约束。故按任务书的**意图**（纯新增、零既有改动、无人引用也编译干净的运行时分发桩）新建**同级组件** `firmware/components/lume-board-hal/`，头文件/实现用 `lume_board_hal.h` / `lume_board_hal.c` 避免与现有 `lume_board.h` 撞名；符号名 `lume_board_t` / `lume_board_get` / `lume_board_not_supported` 与任务书一致。现有 `lume-board` 组件一字未动。

**ESP-IDF v5.5.5 自动发现实证**：`build.cmake:532-533` 原文「If not specified, all components known to the build system are processed」，`build.cmake:386-404` 把每个已发现 component 加入 `__BUILD_COMPONENTS`；`component.cmake:445` 的 `idf_component_register` 注册 SRCS/INCLUDE_DIRS。故 `firmware/components/` 下新目录自动纳入构建，**无需 main 加 REQUIRES**（任务书预判正确，未加）。构建日志实证 `[100%] Built target __idf_lume-board-hal`，产物 `build/esp-idf/lume-board-hal/liblume-board-hal.a`（8214 B）——证明桩组件确实被编译，但因无人引用未进入最终镜像链接。

**实现**：`lume_board_t` = 4 个函数指针（`panel_init` / `touch_init` / `touch_read` / `power_init`）+ `const char *board_id`；签名按实证的驱动调用形状定型（`panel_init <- lume_display_init(lv_display_t **)`、`touch_init <- lume_touch_init(bus, disp)`、`touch_read <- 点读(x,y,pressed)`、`power_init <- lume_pmic_display_power_on(bus)`），ESP/LVGL 类型擦成 `void *` 以保持头文件 freestanding（宿主 gcc 可直接编译）；`int` 错误码约定（0 成功、负数失败，桩返回 `LUME_BOARD_ERR_NOT_SUPPORTED = -1`）。单例 `lume_board_get()` 返回静态 `s_lume_board_generic`，四个指针指向同一个 `lume_board_not_supported` 桩的四个带类型 face（避免函数指针互转 UB），`board_id = "generic"`。编译期 profile 仍是参数真源，本组件只是运行时分发桩——两处文件头均写明。

**验证（原始输出；编译/宿主证据，非真机）**：
- `idf.py build`（规定 wrapper，`env -u VIRTUAL_ENV IDF_PYTHON_ENV_PATH=.../idf5.5_py3.12_env`）→ `BUILD_EXIT=0` / `error:` 零命中；`lume.bin binary size 0x2e5540 bytes`。
- `idf.py size` → `SIZE_EXIT=0`，关键行：`Flash Code 2041288` / `Flash Data 853292` / `DIRAM 247491 (72.42%, Remain 94269)` / `IRAM 16384 (100.0%, Remain 0)` / `Total image size: 3036351 bytes`。与最近有固件构建的基线 r141（`ddde5c9`，Flash Code 2041288 / Flash Data 853292 / DIRAM 247491 / IRAM 16384 Remain 0 / Total 3036351）**逐字节一致，增量 0 B**；IRAM 16384 硬线未破。原因：新组件编译成 `.a` 但无引用方，静态库目标文件未进链接闭包，镜像尺寸不变。r146 为零固件 diff 轮，未构建，故用 r141 战报数字对照（任务书允许）。
- `node tests/board_abi.js` → 8 条源码/守卫断言 + 7 条 C 断言全绿，`board_abi: ALL CHECKS PASSED`，`BOARD_ABI_EXIT=0`。C harness `tests/board_abi.c` 以 `_Static_assert` 锁 4 个前导函数指针字段 + `board_id` 尾字段布局、单例非 NULL 且稳定、四 op 全返回 -1。
- `for t in tests/*.js; do timeout 120 node "$t" ...; done; echo done` → `done`，**0 FAIL**。
- `npm test --prefix tools/lume` → `# tests 50 / # pass 50 / # fail 0 / # skipped 0`，`NPM_TEST_EXIT=0`（worktree 缺 gitignore 的 `node_modules` / `bin/qjsc`，软链/拷贝主仓只读物后对齐基线，源码零改动，同 r128/r143/r146 环境事实）。
- `python3 scripts/check_website.py` → `API: 153 catalog entries, 153 type declarations, 34 function namespaces` / `API missing: none` / `API invented: none` / `API duplicates: none` / `WEBSITE_EXIT=0`。
- `node tools/lume/lume.js check examples/counter --no-emu` → `RESULT: PASS (4 steps, 0 failed; exit 0)`。
- **零改动守卫**：基线实证 `git diff 4155d15 HEAD -- ...` 空。提交前原始命令（排除现有 `lume-board` / `board_abi.*` / `docs`）输出**空**，`GUARD_EXIT=0`；附加排除新同级组件的 post-commit-safe 版本亦空，`GUARD2_EXIT=0`。`git status --short` 仅三行新路径：`?? firmware/components/lume-board-hal/`、`?? tests/board_abi.c`、`?? tests/board_abi.js`。
- **磁盘**：build 后 `df -h /` = `43G used / 4.6G avail / 91%`；立即 `rm -rf firmware/build` 后 = `43G used / 5.0G avail / 90%`，build 目录已移除。artifacts 只留 `/tmp/lume-r147-*.log`。

- **提交后实证（如实记录）**：提交后原样命令的输出只剩 `firmware/components/lume-board-hal/` 三个新文件（`git diff` 对 untracked 不可见的窗口已结束），属预期新组件；`tests/board_abi.js` 因内置扩展守卫仍全绿。全量 `tests/*.js` 复跑有 13 个存量 harness 转红（`adc_meter` / `archive_view` / `crypto_check` / `hr_monitor` / `img_view` / `ota_consumers` / `reboot_consumers` / `sd_files` / `sd_gallery` / `sntp_consumers` / `sntp_consumers2` / `vec_demo` / `weather_sntp`），原因是它们以旧 BASE 对 `firmware/` 做零 diff / 已知文件 allowlist 断言——需主控按 r143/r146 先例重钉到 feat 提交 `6176790`。本轮验证按任务书顺序在提交前完成（0 FAIL），未改这些 harness 的 BASE 以守住「零既有改动」。
- **M5 Board abstraction checkbox 不勾**：无第二块板目标、无运行时切换、无真机验收——本刀只是给未来第二板 / 运行时探测留的桩。板级项（显示/触摸/sleep current/radio/第二板探测）全部 deferred，**不声称真机验证**，统一为「编译/宿主证据，非真机」。ASCII 纪律全满足；未改 vendored（QuickJS/LVGL）、未改 `.d.ts`；commits 拆 feat / test / docs，**未推送**，未跑 codex review（主控轮负责）。

详见 docs/KNOWN-SIMPLIFICATIONS.md r147 节。

### r148 result — M5 Component library 第二片：shell `Keyboard` 软键盘（runtime/ + 纯 app 层；appended, milestone checkboxes untouched）

**开工**：`bash /home/ubuntu/.hermes/scripts/lume_model_guard.sh` → `GUARD: settings.json model=hy4flash-free ✓` / `GUARD: model=hy4flash-free ✓ (settings + runtime audit clean)`，无 429，未在 `/home/ubuntu/lume` 写任何文件。新 worktree `/tmp/lume-r148-wt`（分支 `r148-keyboard`，基线 `dafa1ed`）。

**实证先行（假设以源码为准）**：`runtime/shell.js` 的组件挂在闭包内 `shell.X = X`，末尾一次性 `lume.ui = lume.ui || {}; lume.ui.shell = shell;`；cleanup 统一走 `cleanups[id]` + `shell.dispose(id)`；包装后的 `View` 只在 style 未显式给 `padding`/`gap` 时注入 `theme.spacing`。prelude 实证 `NODE_BUTTON = 2`、`ATTR_TEXT=0 / ATTR_WIDTH=2 / ATTR_HEIGHT=3 / ATTR_PADDING=10 / ATTR_GAP=11`，`__lume_dispatchPress` 直接调 `onPress`——故键盘键位复用 `Button` + `onPress`，新组件不改 prelude / ATTR 语义。`scripts/gen_api_docs.py` 解析 `declare namespace lume.ui.shell` 下所有函数，故 `.d.ts` 新增 `Keyboard` 必须重生成 `website/api.html`（`--check` 验证）。

**实现**：`runtime/shell.js` 新增 `Keyboard(props)`：QWERTY 三排（`qwertyuiop` / `asdfghjkl` / `zxcvbnm`）+ `SPACE` / `BKSP` / `ENTER` 共 29 键，4 个 row View + 1 root View；`onKey(char)`（字母小写 + 空格 `' '`）/ `onBackspace()` / `onSubmit()` 经既有 `callback()` 校验；每键 `>= 40 px` 触控下限，间距取 `theme.spacing` 但按 480 px 十列布局夹到 `maxGap = 8`，显式 `gap` / `keySize` / `style` 可覆盖并在越界时报错；cleanup 注册 `cleanups[root]`，`dispose(root)` 一次移除 4 排 + 29 键，二次调用幂等。全部键名 ASCII（r64）。`runtime/types/lume.d.ts` 追加 `KeyboardProps` + `Keyboard()` JSDoc；`python3 scripts/gen_api_docs.py` 重生成 `website/api.html`（153→154 行 API entry，含 `lume.ui.shell.Keyboard`）。`examples/keyboard_demo/app.js` 单行输入显示 + 键盘，提交后显示 `Submitted: <line>`，仿 files 先例 `import '../../runtime/shell.js'`；`examples/files` 一字未动（其 playground bundle 因内嵌 shell.js 随组件变更重生成，属预期）。

**宿主 harness**：`tests/keyboard_demo.js`（CommonJS，仿 hr_monitor/adc_meter）跑真 app + prelude_runner，13 条源码/仓库断言 + 8 条 live 消息流断言（4 排 / 29 键、QWERTY 标签、40 px 目标、`onKey`/`onBackspace`/`onSubmit` 经真 `Button` press 改信号、回调类型校验、dispose 幂等）+ 16 条 mutation 反例，全绿。

**级联同步（先例精确执行）**：
- 清单 52→53：`tools/playground/build.mjs` 注册 `keyboard_demo`（第 53 个）；同步 10 个 harness 的 `52-app` / `length === 52` / `apps.length, 52` 计数断言（`ota_consumers` / `weather_sntp` / `sntp_consumers2` / `vec_demo` / `img_view` / `archive_view` / `adc_meter` / `crypto_check` / `hr_monitor` / `reboot_consumers`），`sd_files.js` 的清单变异串同步加上 `'keyboard_demo'`。
- **BASE 重钉**：重钉前全量 harness 实证 FAIL 清单（14 项）：13 个 app-only 守卫（`adc_meter` / `archive_view` / `crypto_check` / `hr_monitor` / `img_view` / `ota_consumers` / `reboot_consumers` / `sd_files` / `sd_gallery` / `sntp_consumers` / `sntp_consumers2` / `vec_demo` / `weather_sntp`）因 runtime/ diff 转红；另有 `board_abi.js` 在基线 `dafa1ed` 已红（守卫仍钉在 r146 的 `4155d15`，r147 重钉后未同步，且 `git diff` 超过 Node 默认 maxBuffer 报 `ENOBUFS`）。test commit 把这 13 个 BASE 全重钉到本轮 feat `bbd8627` 并刷新过时注释，零 diff / allowlist 断言语义不放宽；`board_abi.js` 守卫改以 `dafa1ed` 为参照、显式排除本轮合法落地面（runtime/、website/、examples/、tools/、tests/、docs/）并提高 maxBuffer，仍禁止两板组件之外的任何 firmware 变化。重钉后全量 0 FAIL。
- `tests/ota_consumers.js` ALLOWED 在 test commit 前预加本轮全部新文件（app / harness / 两个 playground 生成物 / `files.js` / `sources.js` / `shell.js` / `.d.ts` / `api.html`），避免 untracked 对 `git diff` 不可见导致提交后转红。

**验证（原始输出；宿主/编译证据，非真机）**：
- `node tests/keyboard_demo.js` → 13 静态 + 8 live + 16 mutation 全绿，`ALL KEYBOARD DEMO HARNESS CASES PASSED`，退出码 0。
- `for t in tests/*.js; do node "$t" >/dev/null 2>&1 || echo FAIL "$t"; done; echo done` → `done`，**0 FAIL**（85 个 harness，含本轮新增 `keyboard_demo.js`）。
- `npm test --prefix tools/lume` → `# tests 50 / # pass 50 / # fail 0 / # cancelled 0 / # skipped 0 / # todo 0`，`NPM_TEST_EXIT=0`（新 worktree 缺 gitignore 的 `tools/lume/bin/qjsc`，先报 49 pass / 1 skip；从主仓拷贝只读构建物后对齐基线，源码零改动，同 r146/r147 环境事实）。
- `python3 scripts/check_website.py` → `HTML pages: 7; internal href/src and anchors checked` / `API: 154 catalog entries, 154 type declarations, 34 function namespaces` / `API missing: none` / `API invented: none` / `API duplicates: none` / `API signatures not found in lume.d.ts: none`，`WEBSITE_EXIT=0`；`python3 scripts/gen_api_docs.py --check` → `api.html is up to date with lume.d.ts (154 entries)`。
- `node tools/lume/lume.js check examples/keyboard_demo --no-emu` → `[PASS] bundle 13356 bytes` / `RESULT: PASS (4 steps, 0 failed; exit 0)`；哨兵 `examples/counter --no-emu` → `[PASS] bundle 2160 bytes` / `RESULT: PASS`。
- `npm run build:playground --prefix tools/lume` → `PASS bundle keyboard_demo 13356 bytes` / `PASS esbuild-wasm assets and 53 editable sources` / `PASS prelude 67428 bytes; 53 apps`。
- **固件零改动，未跑 `idf.py build`**：`git diff dafa1ed HEAD -- firmware/` 与 `git diff dafa1ed -- firmware/` 均空；`git diff dafa1ed HEAD -- firmware/components/lume-engine/lume_scripts.c` 与工作树 diff 亦空（prelude 未动）。shell.js 是 CLI 打包的 JS，`.d.ts` 是类型契约，二者都不进固件构建。IRAM 16384 硬线未触碰；无 build/ 负担，artifacts 只留 `/tmp`。

**里程碑口径**：M5 Component library 行仍不勾（组件仍需真机触控验收）；P2 表「猜词游戏（Wordle 类）🔴 blocked」行不勾，但 result 注明**键盘缺口已部分解锁**：`lume.ui.shell.Keyboard` 已可作为后续 Wordle 类候选的 ASCII 字母输入原语；完整解锁仍需真实词游 app、字典/状态逻辑与真机输入手感验收（详见 KNOWN-SIMPLIFICATIONS r148 节）。真机触控手感、显示/触摸/sleep current/radio 全部 deferred，**不声称真机验证**。ASCII 纪律全满足；未改 vendored（QuickJS/LVGL）；未跑 codex review（主控轮负责）。

**commits（未推送）**：feat `bbd8627`（shell Keyboard + 类型 + api.html + keyboard_demo app + 53-app playground） / test `c68d5a2`（keyboard_demo harness + 守卫 BASE 重钉 + 53-app 口径同步 + board_abi 存量守卫修复） / docs（本节）。

详见 docs/KNOWN-SIMPLIFICATIONS.md r148 节。

### r149 result — 完整 Wordle 类猜词游戏 `examples/wordle`（纯 app 层；appended, P2 行不勾）

**开工**：`bash /home/ubuntu/.hermes/scripts/lume_model_guard.sh` → `GUARD: settings.json model=hy4flash-free ✓` / `GUARD: model=hy4flash-free ✓ (settings + runtime audit clean)`，退出码 0，无 429，未在 `/home/ubuntu/lume` 写任何文件。新 worktree `/tmp/lume-r149-wt`（分支 `r149-wordle`，基线 `ca4ba35`）。

**实证先行（假设以源码为准）**：通读 `runtime/shell.js:287-351` —— `Keyboard` 的字母键由 `key(ch.toUpperCase(), ..., function(){ if(p.onKey) p.onKey(ch); })` 生成，`onKey` 收到的是**小写字母**（`KEY_ROWS` 为小写串），`SPACE` 传 `' '`；`onBackspace` / `onSubmit` **无参数**，只回调不携带提交语义，胜负/字典校验必须由 app 自己做。`key()` 的背景固定为 `color('surface','#132435')`，**没有逐键背景注入口**——因此键态染色改用键盘上方的自绘 26 字母状态条（取舍见 KNOWN-SIMPLIFICATIONS r149）。`shell.dispose(root)` 经 `cleanups[root]` 一次移除 33 个节点。键尺寸：`keySize` 必须 40..128、`gap` 0..32；`y:300` + `keySize:40` + `gap:0` → 键盘高 `4*40+3*0+2*4=168` px，落在 y=300..468。KV 签名实证于 `runtime/types/lume.d.ts:631-674`：key ≤15 字符、返回 0/负码、`get()` 失败返回 null 或负数，故 `hisc.wordle`（11）/ `wordle.cur`（10）合法且读写全包 `try/catch`。Canvas 预算为独立 app 口径：单画布 `480x228=109,440 px` ≤ 230,400（watchface 五面 228,544 是另一 app 的预算，不混算）。

**实现**：`examples/wordle/app.js`（`import runtime/shell.js`，纯 app）。5 字母 × 6 次尝试；两遍判定（先钉绿并统计答案剩余字母，再从左到右发黄）实现标准 Wordle 重复字母规则；300 个内嵌 ASCII 五字母词，答案表与可接受猜测表**合并**（非字典词拒绝，如实登记）；`shell.Keyboard` QWERTY 直输 + `NEW` 再来一局；胜负 HUD 结算行；`wdLetterMarks()` 取每字母 G>Y>X 的最高态，驱动键盘上方自绘字母态条；KV 记最长连胜 `hisc.wordle` 与当前连胜 `wordle.cur`。单画布 480x228（109,440 px），5x7 手工字形预计算成 run-length spans（26 个，eval 时一次解码），硬边 `fillRect` 整数像素。UI 文案 ASCII-only（r64）。固件/prelude/runtime 零改动；未动 `wordring` / `files` / `keyboard_demo`。

**宿主 harness**：`tests/wordle.js`（CommonJS）—— 20 条逻辑/live 检查（字典、字形、绿黄灰与重复字母、胜负迁移、连胜、键态、KV、canvas 预算、真 prelude 启动、键盘回调注入、反馈色进入 draw 流、NEW、dispose、~60 s smoke）+ 10 条静态守卫 + 10 条 mutation 反例（每条都证明对应断言 load-bearing）。

**级联同步（照 r148 执行）**：
- 清单 53→54：`tools/playground/build.mjs` 注册 `wordle`（第 54 个）；按 `grep -rn '=== 53' tests/` 实证后，同步 11 个 harness 的计数断言与文案（`reboot_consumers` / `hr_monitor` / `weather_sntp` / `ota_consumers` / `sntp_consumers2` / `keyboard_demo` 的 `=== 53`，以及 `adc_meter` / `archive_view` / `crypto_check` / `img_view` / `vec_demo` 的 `apps.length, 53`），`sd_files.js` 的清单变异串同步加 `'wordle'`。
- **守卫无需重钉、断言不放宽**：本轮 firmware/ runtime/ tools/lume/ 零 diff，13 个 app-only 守卫的零 diff 断言与 `board_abi.js`（已含 `:!artifacts/` 排除）全绿；`ota_consumers.js` 的 `allChanged` allowlist 在 **test commit 前**预加 4 个新路径（`examples/wordle/app.js` / `tests/wordle.js` / `website/playground/apps/wordle.js` / `website/playground/sources/wordle.js`），避免 untracked 对 `git diff` 不可见导致提交后转红；firmware 守卫未松动，未改成自比较。

**验证（原始输出；宿主/编译证据，非真机）**：
- `node tests/wordle.js` → 14 条逻辑 + 6 条 live + 10 条静态 + 10 条 mutation 全绿，末行 `ALL WORDLE HARNESS CASES PASSED`，退出码 0。
- `for t in tests/*.js; do node "$t" >/dev/null 2>&1 || echo FAIL "$t"; done; echo done` → `done`，**0 FAIL**。
- `npm test --prefix tools/lume` → `# tests 50 / # pass 50 / # fail 0 / # cancelled 0 / # skipped 0 / # todo 0`（新 worktree 缺 gitignore 的 `tools/lume/bin/qjsc`，先报 49 pass / 1 skip；从主仓拷贝只读构建物后对齐基线，源码零改动）。
- `python3 scripts/check_website.py` → `HTML pages: 7; internal href/src and anchors checked` / `API: 154 catalog entries, 154 type declarations, 34 function namespaces` / `API missing: none` / `API invented: none` / `API duplicates: none` / `API signatures not found in lume.d.ts: none`。
- `node tools/lume/lume.js check examples/wordle --no-emu` → `[PASS] bundle 22571 bytes` / `RESULT: PASS (4 steps, 0 failed; exit 0)`（22,571 B ≪ 256 KiB=262,144 B 热更新硬上限）；哨兵 `examples/counter --no-emu` → `[PASS] bundle 2160 bytes` / `RESULT: PASS`。
- `npm run build:playground --prefix tools/lume` → `PASS bundle wordle 22571 bytes` / `PASS esbuild-wasm assets and 54 editable sources` / `PASS prelude 67428 bytes; 54 apps`。
- **固件零改动，未跑 `idf.py build`**：`git diff --name-only ca4ba35 HEAD -- firmware/ runtime/` 与 `git diff --name-only ca4ba35 -- firmware/ runtime/` 原始输出均为空；`git diff --name-only ca4ba35 HEAD -- firmware/components/lume-engine/lume_scripts.c` 亦空（prelude 未动）。IRAM 16384 硬线未触碰；无 build/ 负担，临时产物只留 `/tmp`，测试 scratch `artifacts/r82/` 已清除，不进仓。

**里程碑口径**：P2 表「猜词游戏（Wordle 类）」行**不勾**，仅更新缺口措辞指向 r149——键盘直输完整版已落地，原 🔴 blocked 缺口已解除；剩余 deferred：真机输入手感/误触/圆屏安全区、每日一题与更大字典/_allowed guess_ 表。真机显示/触摸/sleep current/radio 全部 deferred，**不声称真机验证**。ASCII 纪律全满足；未改 vendored（QuickJS/LVGL）；未跑 codex review（主控轮负责）。

**commits（未推送，拆分）**：feat（wordle app + 54-app playground 生成物） / test（wordle harness + 53→54 计数同步 + ALLOWED 预加） / docs（本节 + KNOWN-SIMPLIFICATIONS）。

详见 docs/KNOWN-SIMPLIFICATIONS.md r149 节。

### r151 result — M5 Component library 第三片：shell 表单控件 `Switch` / `Slider` / `Progress`（runtime/ + 纯 app 层；appended, milestone checkboxes untouched）

**开工**：`bash /home/ubuntu/.hermes/scripts/lume_model_guard.sh` → `GUARD: settings.json model=hy4flash-free ✓` / `GUARD: model=hy4flash-free ✓ (settings + runtime audit clean)`，退出码 0，无 429，未在 `/home/ubuntu/lume` 写任何文件。新 worktree `/tmp/lume-r151-wt`（分支 `r151-shell-controls`，基线 `31adb96`）。开场 `pgrep` 实证唯一同场 r151 引擎为自身（PID 2958164）；另有一个眠了 1 天 16h 的 r126 残留引擎（不同 worktree / 分支 / 任务，非同场），按 429 纪律排除后继续。

**实证先行（假设以源码为准）**：通读 `runtime/shell.js` 全文——组件在闭包内 `shell.X = X`，末尾一次性 `lume.ui.shell = shell`；cleanup 统一走 `cleanups[id]` + `shell.dispose(id)`（先 `delete` 再调 fn，故幂等）；`__lume_dispatchRemove` 同步清 `spaced`/`declared`。prelude 实证 `ATTR_WIDTH = 2`（`lume_scripts.c:235`），`size()` 对函数型 `width` 走 `__bindNumeric` → owned effect → `setAttr(id, ATTR_WIDTH, px)`，随节点 dispose 自动回收；Canvas `onDraw` 同为 owned effect（信号读取即订阅）；`lume.gesture.on(target,type,cb)` 返回注销函数，做的是从 `__gestureHandlers[id][type]` 里 `splice(cb)`——**实证后果**：dispose 不调注销函数时，随后向该节点派发 pan 仍会触发 onChange（宿主复现 `bright` 从 50 被改成 60），调了则不触发，故 harness 对该后果做 load-bearing 断言。`pan` 事件的 `dx/dy` 是「相对按下点位移」（`__gestureStep` 的 `inp.x - s.sx`），非绝对坐标，故 Slider 用 `startValue + dx*(max-min)/width` 映射，对齐 `examples/piano/app.js` 的 pan 用法。**纠偏**：任务书允许「pan 在 Canvas 命中/坐标有坑则降级 Button 步进」；实证 Canvas 是普通 node id、可直接做手势目标、`dx` 映射无坑，故按首选路线落地 Canvas+pan，未降级。

**实现**：`runtime/shell.js` 新增三组件（全受控，不自持状态；theme token 配色；全节点注册 `cleanups[id]`）：
- `Switch`：轨道 + 滑块两个 View（+ 可选 label Text），整块 `onPress` 发 `onChange(!value)`；高度 40..128（默认 48）、轨宽 48..480，满足 r148 的 40 px 触控下限；滑块 `x` 为绑定函数随信号移动。
- `Slider`：`Canvas`（默认 432×40 = 17,280 px，远低于 480×480 预算）自绘轨道/填充/滑块；`panstart` 捕获当前值、`pan` 按 `startValue + dx*(range/width)` 映射并取整到 `step`，**仅在量化值变化时发 onChange**（每帧不抖、有实时反馈），`panend` 只收尾不补发；`off()` 注销 + 移除 canvas 节点都进 cleanup。
- `Progress`：外轨 + 内填充两个 View，无 Canvas；`value` 钳制 0..1，填充 `width` 为绑定函数，变化只改 `ATTR_WIDTH`（实证 0.2×432=86 → 0.75×432=324 → 越界钳到 432）；label 作为兄弟 Text 置于条上方（避开负 y 像素属性非法）。
`runtime/types/lume.d.ts` 追加三个 Props 接口 + JSDoc；`python3 scripts/gen_api_docs.py` 重生成 `website/api.html`（154→157 行 API entry）。`examples/controls_demo/app.js`（`import ../../runtime/shell.js`）一屏展示音效 Switch / 亮度 Slider(0..100 step 5) / 充电 Progress，值全走 signal，文案 ASCII-only；`examples/settings` / `keyboard_demo` / `files` 源文件未动（三者 bundle 因内嵌 shell.js 重生成，属预期）。

**宿主 harness**：`tests/controls_demo.js`（CommonJS，仿 keyboard_demo）跑真 app + prelude_runner：13 条静态断言（三注册 / 受控模式 / 40 px 下限 / cleanup 全量 / gesture 注销 / Progress 只改宽度 / app signal 接线 / ASCII / 字节一致 / 55-app 清单 / BASE / 固件 trunk / prelude）+ 10 条 live（真 press、dx→量化、越界钳制、每步一次回调、ATTR_WIDTH 更新、信号驱动重渲染、dispose 幂等 8 节点、注销后无悬空回调、非受控用法证自持状态缺失）+ 13 条 mutation 反例（每例证明断言 load-bearing，含「注销后仍触发」的实证）。

**级联同步（照 r148/r149 精确执行）**：
- 清单 54→55：`tools/playground/build.mjs` 注册 `controls_demo`（第 55 个）；按 `grep` 实证同步 12 个 harness 的 `=== 54` / `apps.length, 54` 与文案（`reboot_consumers` / `hr_monitor` / `weather_sntp` / `ota_consumers` / `sntp_consumers2` / `keyboard_demo` / `adc_meter` / `archive_view` / `crypto_check` / `img_view` / `vec_demo` / `wordle`）；`sd_files.js` 清单变异串同步加 `'controls_demo'`。`invaders`(aliveCount) / `style_mapping` / `bridge_protocol.c` 的 `54` 非清单计数，未动。
- **BASE 重钉（断言不放宽）**：本轮合法改 `runtime/shell.js` / `runtime/types/lume.d.ts` / `website/api.html`，14 个 runtime/firmware 守卫 harness 因此转红（重钉前实证 FAIL：`keyboard_demo` / `wordle` / `ota_consumers` 的清单计数，`sd_files` / `sntp_consumers` 的 runtime diff）。test commit 把 15 个守卫的 BASE 从 r148 feat `bbd8627` 重钉到本轮 feat `d49fb81`，零 diff / allowlist 语义完全保留（未自比较、未删守卫）；重钉后全量 0 FAIL。
- `tests/ota_consumers.js` ALLOWED 在 test commit 前预加本轮全部新路径（app / harness / 两个 playground 生成物），避免 untracked 对 `git diff` 不可见导致提交后转红；并修正 `keyboard_demo.js` 一条因新组件复用同款 cleanup 字符串而变装饰性的 mutation（改为移除全部同型串）。

**验证（原始输出；宿主/编译证据，非真机）**：
- `node tests/controls_demo.js` → 13 静态 + 10 live + 13 mutation 全绿，末行 `ALL CONTROLS DEMO HARNESS CASES PASSED`，`EXIT=0`。
- `for t in tests/*.js; do timeout 120 node "$t" >/dev/null 2>&1 || echo FAIL "$t"; done; echo done` → `done`，**0 FAIL**（87 个 harness：r149 基线 86 + 本轮新增 1）。
- `npm test --prefix tools/lume` → `# tests 50 / # pass 50 / # fail 0 / # cancelled 0 / # skipped 0 / # todo 0`，`EXIT=0`（worktree 缺 gitignore 的 `tools/lume/node_modules` 与 `bin/qjsc`，从主仓只读软链后对齐基线，源码零改动）。
- `python3 scripts/check_website.py` → `HTML pages: 7; internal href/src and anchors checked` / `API: 157 catalog entries, 157 type declarations, 34 function namespaces` / `API missing/invented/duplicates/signatures not found: none`，`EXIT=0`；`python3 scripts/gen_api_docs.py --check` → `api.html is up to date with lume.d.ts (157 entries)`，`EXIT=0`。
- `node tools/lume/lume.js check examples/controls_demo --no-emu` → `[PASS] bundle 18698 bytes` / `RESULT: PASS (4 steps, 0 failed; exit 0)`；哨兵 `examples/counter --no-emu` → `RESULT: PASS`。
- `npm run build:playground --prefix tools/lume` → `PASS bundle controls_demo 18698 bytes` / `PASS esbuild-wasm assets and 55 editable sources` / `PASS prelude 67428 bytes; 55 apps`。
- **固件零改动，未跑 `idf.py build`**：`git diff 31adb96 -- firmware/` 原始输出为空；`git diff 31adb96 HEAD -- firmware/ runtime/types/` 仅含本轮 `.d.ts` 新增（`runtime/` 允许），`firmware/` 段为空；`git diff dafa1ed -- firmware/components/lume-engine/lume_scripts.c` 与 HEAD 版亦空（prelude 未动）。shell.js 是 CLI 打包 JS、`.d.ts` 是类型契约，均不进固件构建；IRAM 16384 硬线未触碰；磁盘紧张，artifacts / 日志只留 `/tmp`。

**里程碑口径**：M5 Component library 行仍不勾（三控件仍需真机触控/渲染验收）；真机 Slider 拖动手感、Switch 命中率、Progress 渲染、圆屏安全区全部 deferred，**不声称真机验证**。ASCII 纪律全满足；未改 vendored（QuickJS/LVGL）；未跑 codex review（主控轮负责）。

**commits（未推送，拆分）**：feat `d49fb81`（三 shell 控件 + 三 Props 类型 + api.html + controls_demo app + 55-app playground） / test `ae7cfd6`（controls_demo harness + 守卫 BASE 重钉 + 54→55 计数同步 + ALLOWED 预加） / docs（本节 + KNOWN-SIMPLIFICATIONS）。

详见 docs/KNOWN-SIMPLIFICATIONS.md r151 节。

### r153 result — M5 Component library 第四片：`shell.Keyboard` per-key 状态染色（runtime/ 刀）+ wordle 真键帽消费（appended, milestone checkboxes untouched）

**开工**：`bash /home/ubuntu/.hermes/scripts/lume_model_guard.sh` → `GUARD: settings.json model=hy4flash-free ✓` / `GUARD: model=hy4flash-free ✓ (settings + runtime audit clean)`，退出码 0，无 429，未在 `/home/ubuntu/lume` 写任何文件。新 worktree `/tmp/lume-r153-wt`（分支 `r153-key-cap-tint`，基线 `ba5156e`）。实证主仓 main 已推进至 r155 ClickWheel（r154/r155 worktree 另存），但按简报基线从 `ba5156e` 起刀，未并入后续轮次。

**实证先行（假设以源码为准）**：通读 `runtime/shell.js:287-351` —— r148 `Keyboard` 的字母键经 `key(ch.toUpperCase(), keySize, onPress)` 生成（回调收到**小写**字母），键帽背景固定 `color('surface','#132435')`，`SPACE` / `BKSP` / `ENTER` 分别用默认 / `danger` / `accent`，**无 per-key 注入口**；`cleanups[root]` 一次移除 33 个节点，`shell.dispose(id)` 先 `delete` 再调 fn（幂等）。实证 prelude `ATTR_BG_COLOR = 1`（`lume_scripts.c:46`），`__applyStyle` 对**函数型 background** 建 owned effect（`effect(() => lume.setAttr(id, 1, color(bg())))`），随节点 dispose 回收；`signal.set` 有 `v === value` 相等短路。`wordle` 的 `wdLetterMarks()` 返回**小写字母 → G/Y/X**（G>Y>X 最高态），旧自绘 26 字母条用大写查询该表（潜在大小写失配），本轮移除该条后此问题不再存在。据此确定最小接口：`keyStates` 接受小写字母 → `'hit'|'present'|'miss'`（绿/黄/灰）的对象**或信号 getter**，每个字母键绑定自己的背景 getter，状态发布只重写该键 `ATTR_BG_COLOR`、不重建节点；缺省返回 r148 同一 helper，未知键 / 控制键忽略。

**实现**：`runtime/shell.js` 增 `KEY_STATE_TINTS`（hit `#166B3E` / present `#8A6A12` / miss `#30343E`，与 wordle 格子填充同色）、`keyStates` 类型校验（对象或函数，否则 `TypeError`）、`letterBackground(ch)` 绑定 getter；控制键与 cleanup 链零改动。`runtime/types/lume.d.ts` 增 `KeyboardKeyState` / `KeyboardKeyStates` 与 `keyStates?` JSDoc；`python3 scripts/gen_api_docs.py` 重生成 `website/api.html`（行数 157 不变，类型别名不产生 API entry），`--check` 新鲜。`examples/wordle/app.js` 增 `keyStatesSig` + `refreshKeyStates()`（G/Y/X → hit/present/miss），在 submit 与 NEW 时发布，`keyStates: keyStatesSig` 喂给 Keyboard；移除 `paintBar()` / `BAR_*` / `COL.RING`；`NEW` / 胜负结算 / KV 连胜逻辑未动；`wdKb` / `wdKeyStates` 等 harness 句柄保留。

**宿主 harness**：新增 `tests/keyboard_states.js`（CommonJS）—— 9 静态 + 8 mutation + 7 live + 2 live-mutation：三态染色、未知/大写键忽略、缺省=默认色、getter 形态、信号发布只改背景 ATTR 且零 `create`、dispose 后重挂状态正确且幂等、非对象/函数拒绝；**mutation 反例含「改错键名（`ch.toUpperCase()`）」与「丢状态映射」两条 live 反例**，证明断言 load-bearing。`tests/wordle.js` 同步：字母条断言改为 keyStates 传递断言（G/Y/X→hit/present/miss、键帽 `ATTR_BG_COLOR`、NEW 清空），canvas 预算断言去掉 `BAR_*`，保留 21 逻辑/live + 10 静态 + 11 mutation。

**级联同步（照 r151/r148 先例）**：本轮合法改 `runtime/shell.js` / `runtime/types/lume.d.ts`，15 个 runtime/firmware 守卫 harness 的零 diff 断言转红（重钉前实证 16 FAIL：13 app-only + controls_demo + keyboard_demo + wordle；`board_abi.js` 排除 `runtime/` 故始终绿）。test commit 把 BASE 从 r148 feat `d49fb81` 重钉到本轮 feat `0d1111c`，零 diff / allowlist 语义完全保留（未自比较、未删守卫），重钉后全量 0 FAIL。`tests/ota_consumers.js` ALLOWED 预加 `tests/keyboard_states.js`（wordle playground 生成物已在册）；`sd_files.js` 清单变异串因无新 app 不改。未新增 app，清单仍 55。

**验证（原始输出；宿主/编译证据，非真机）**：
- `node tests/keyboard_states.js` → 9 静态 + 8 mutation + 7 live + 2 live-mutation 全绿，末行 `ALL KEYBOARD STATES HARNESS CASES PASSED`，`EXIT=0`。
- `node tests/wordle.js` → 21 逻辑/live + 10 静态 + 11 mutation 全绿，末行 `ALL WORDLE HARNESS CASES PASSED`，`EXIT=0`。
- `for t in tests/*.js; do timeout 120 node "$t" >/dev/null 2>&1 || echo FAIL "$t"; done; echo done` → `done`，**0 FAIL**（88 个 harness，新增 1）。
- `npm test --prefix tools/lume` → `# tests 50` / `# pass 50` / `# fail 0` / `# cancelled 0` / `# skipped 0` / `# todo 0`，`EXIT=0`。
- `python3 scripts/check_website.py` → `HTML pages: 7` / `API: 157 catalog entries, 157 type declarations, 34 function namespaces` / `API missing/invented/duplicates/signatures not found: none`；`python3 scripts/gen_api_docs.py --check` → `api.html is up to date with lume.d.ts (157 entries)`。
- `node tools/lume/lume.js check examples/wordle --no-emu` → `[PASS] bundle 27422 bytes` / `RESULT: PASS (4 steps, 0 failed; exit 0)`；哨兵 `examples/counter --no-emu` → `[PASS] bundle 2160 bytes` / `RESULT: PASS`。
- `npm run build:playground --prefix tools/lume` → `PASS bundle wordle 27422 bytes` / `PASS esbuild-wasm assets and 55 editable sources` / `PASS prelude 67428 bytes; 55 apps`；再跑一次 `git status` 空（生成物已随 feat commit 落定）。
- **固件零改动，未跑 `idf.py build`**：`git diff ba5156e HEAD -- firmware/` 与 `git diff ba5156e -- firmware/` 均空；`git diff ba5156e HEAD -- firmware/components/lume-engine/lume_scripts.c` 与工作树版亦空（prelude 未动）。shell.js 是 CLI 打包 JS、`.d.ts` 是类型契约，均不进固件构建；IRAM 16384 硬线未触碰。

**里程碑口径**：M5 Component library 行仍不勾（键帽染色仍需真机触控/渲染验收）；真机键帽配色对比度、误触/连打、圆屏安全区全部 deferred，**不声称真机验证**。ASCII 纪律全满足；未改 vendored（QuickJS/LVGL）；未跑 codex review（主控轮负责）。

**commits（未推送，拆分）**：feat `0d1111c`（Keyboard keyStates + 三态映射 + lume.d.ts + wordle 消费 + 55-app playground 生成物） / test `899751b`（keyboard_states harness + wordle 断言同步 + 15 守卫 BASE 重钉 + ALLOWED 预加） / docs（本节 + KNOWN-SIMPLIFICATIONS）。

详见 docs/KNOWN-SIMPLIFICATIONS.md r153 节。

### r157 result — M5 Component library 第五片：timer_kit 倒计时+秒表（r151 三控件的第一个消费刀，纯 app 层；appended, milestone checkboxes untouched）

**开工**：`bash /home/ubuntu/.hermes/scripts/lume_model_guard.sh` → `GUARD: settings.json model=hy4flash-free ✓` / `GUARD: model=hy4flash-free ✓ (settings + runtime audit clean)`，退出码 0，无 429，未在 `/home/ubuntu/lume` 写任何文件。新 worktree `/tmp/lume-r157-wt`（分支 `r157-timer-kit`，基线 `6426f7b`）；`tools/lume/bin/qjsc` 与 `tools/lume/node_modules` 从主仓只读软链对齐（r148/r151 先例，源码零改动）。

**实证纠偏（方案与实际代码不符处，以源码为准）**：
1. 简报写 `lume.system.now()`，但 `runtime/types/lume.d.ts` 无此成员，prelude 实际为 `lume.system.time()`（`lume_scripts.c:471` → `lume._systemTime()` → gettimeofday 毫秒）。app 用 `tkNow()` 封装 `lume.system.time()`，harness 通过覆盖 `lume._systemTime` 注入假时钟。已写进 app JSDoc 与 KNOWN-SIMPLIFICATIONS。
2. 简报期望「零 canvas」，但 `shell.Slider` 实现本体就是 `Canvas`（`runtime/shell.js:457`，432×40）。改用**画布预算锁**：唯一画布为 Slider 的 17,280 px，≤ 230,400 px 全帧预算；无环形进度画布。静态断言与 live 断言都锁死这一点。
3. 简报称 14 个 harness 含 56 计数，实证 `grep` 后 `tests/shell_components.js:18` 的 `m[3] === 56` 是控件几何 attr 值（IconButton 高度 56），非清单计数，**未动**。实际同步 13 个计数断言。
4. **基线存量红灯（非本轮引入）**：在干净主仓 `6426f7b` 上跑全量 `tests/*.js` 已有 17 个 FAIL（13 个 app-only 计数守卫 + `keyboard_states` / `sd_files` / `sd_gallery` / `sntp_consumers`），根因是 r151/r153 改了 `runtime/shell.js` 与 `.d.ts` 而守卫 BASE 仍钉在更早提交；`git diff --name-only ba5156e 6426f7b -- firmware/ runtime/ tools/lume/` 实证两文件变更。按「先查自己是否越界、确认是清单计数类才同步、断言语义绝不放宽」的纪律，**不重钉这些 BASE、不放宽断言**。本轮改前/改后全量 FAIL 集合逐项一致（均为基线那 17 个），新增 `tests/timer_kit.js` 全绿，**0 个新增 FAIL**。

**实现**：`examples/timer_kit/app.js`（单文件、保守 var/function、唯一一行 shell.js import）。倒计时：Slider(0..60 step 1) 设定 → START/PAUSE/RESET；Progress 显示剩余占比（r151 首消费）；`mm:ss` 用 32 档 Text；归零用 40 ms 立体声 PCM 包络响铃（piano 先例的 attack+exp decay，try/catch 静默）+ `DONE - NN MIN` 结算。秒表：START(→PAUSE/RESUME)/LAP/RESET；`mm:ss.cc`（10 ms 显示）；最近 3 行 LAP 用原生 View/Text。Switch 切模式，非活动面板用绑定 `x` getter 移到屏外（`__pixel` 要求非负，故 x=1000 而非 -1000）。所有值 signal 驱动；暂停记 now 快照、resume 重锚，墙钟暂停时长不计入。

**记录口径（JSDoc + harness 双写）**：`hisc.timer` = 真正走到 0 的倒计时中**最短的设定分钟数**（只认真实归零，不记中途 RESET）；`timer.best` = **3 LAP 钻**在 60 s 内完成的秒表用时（ms，越小越好），第 3 次 LAP 才结算。两键均 10 字符 ≤ NVS 15 上限，读写全包 try/catch、只接受非负有限 number。若后续认为 3-LAP 口径牵强，可只保留前者——本轮两口径都实现且可证。

**宿主 harness**：新增 `tests/timer_kit.js`（CommonJS，仿 controls_demo/wordle）：19 静态断言（三控件真实调用、绝对时基、pause 快照/重锚、KV/bell try/catch、键长、LAP_LIMIT、ASCII、字号三档、画布预算、字节一致、57 清单、固件零 diff）+ 18 静态 mutation + 10 live（真 prelude + 假时钟：Slider pan 量化 5→12、Switch 切视图、now 差推进、pause 冻结、归零结算响铃、LAP 仅留最近 3、KV 错型/抛异常、dispose/cleanup）+ 3 live mutation，全部 load-bearing。

**级联同步（照 r149/r151 精确执行）**：`tools/playground/build.mjs` 清单 56→57（`timer_kit` 第 57 个，命令实证 57 editable sources / 57 apps）；13 个 harness 的计数断言与文案按 `grep` 实证逐个同步；`sd_files.js` 清单变异串追加 `'timer_kit'`（已实证 needle 与 build.mjs 精确匹配）；`tests/ota_consumers.js` ALLOWED 在 commit 前预加 4 个新路径（app / harness / 两个 playground 生成物），防 untracked 对 `git diff` 不可见导致提交后转红。本轮 firmware/runtime 零 diff，13 个 app-only 守卫的 BASE 未重钉（其红灯为基线存量，非本轮清单计数）。

**验证（原始输出；宿主/编译证据，非真机）**：
- `node tests/timer_kit.js` → 末行 `ALL TIMER KIT HARNESS CASES PASSED`，`EXIT=0`。
- 全量 `for t in tests/*.js; ...` → 92 个 harness（基线 91 + 本轮 1）；`done` 行的 FAIL 清单与干净主仓 `6426f7b` **逐项一致**（17 个基线存量红灯），**本轮新增 FAIL = 0**；`timer_kit.js` 自身 PASS。
- `npm test --prefix tools/lume` → `# tests 50 / # pass 50 / # fail 0 / # cancelled 0 / # skipped 0 / # todo 0`。
- `python3 scripts/check_website.py` → `HTML pages: 7` / `API: 158 catalog entries, 158 type declarations, 34 function namespaces` / `API missing/invented/duplicates/signatures not found: none`。
- `node tools/lume/lume.js check examples/timer_kit --no-emu` → `[PASS] bundle 25583 bytes` / `RESULT: PASS (4 steps, 0 failed; exit 0)`；哨兵 `examples/counter --no-emu` → `[PASS] bundle 2160 bytes` / `RESULT: PASS`。
- `npm run build:playground --prefix tools/lume` → `PASS bundle timer_kit 25583 bytes` / `PASS esbuild-wasm assets and 57 editable sources` / `PASS prelude 67428 bytes; 57 apps`。
- **固件零改动，未跑 `idf.py build`**：`git diff 6426f7b HEAD -- firmware/ runtime/ tools/lume/` 原始输出为空（`.d.ts` 亦未动）；IRAM 16384 硬线未触碰；artifacts / 临时产物只留 `/tmp`，未清主仓 build/。

**里程碑口径**：M5 Component library 行仍不勾——三控件被消费 ≠ 真机验收；真机触控命中、Slider 拖感、计时精度、响听听感、圆屏安全区全部 deferred，**不声称真机验证**。ASCII 纪律全满足（全文件非 ASCII 字节 0，字号仅 14/20/32）；未改 vendored（QuickJS/LVGL）、未改 `.d.ts`；未跑 codex review（主控轮负责）。

**commits（未推送，拆分）**：feat（timer_kit app + 57-app playground 生成物） / test（timer_kit harness + 56→57 计数同步 + sd_files 变异串 + ota ALLOWED 预加） / docs（本节 + KNOWN-SIMPLIFICATIONS r157 节）。

详见 docs/KNOWN-SIMPLIFICATIONS.md r157 节。

### r159 result — M5 Component library 第六片：control_center 控制中心（Card / IconButton / SafeArea 三个零消费组件的首个消费刀，纯 app 层；appended, milestone checkboxes untouched）

**开工**：`bash /home/ubuntu/.hermes/scripts/lume_model_guard.sh` → `GUARD: settings.json model=hy4flash-free ✓` / `GUARD: model=hy4flash-free ✓ (settings + runtime audit clean)`，退出码 0，无 429，未在 `/home/ubuntu/lume` 写任何文件。新 worktree `/tmp/lume-r159-wt`（分支 `r159-control-center`，基线 `76d2c0c`）；`tools/lume/bin/qjsc` 与 `tools/lume/node_modules` 从主仓只读软链对齐，源码零改动、软链不入 git。干净基线全量 `tests/*.js` = 0 FAIL（r158 重钉后存量红灯已清零）。

**实证纠偏（方案与实际代码不符处，以源码为准）**：
1. 简报称三个组件「零 canvas」——逐行读 `runtime/shell.js` 证实：`Card`（:62-68）/`IconButton`（:69-75）/`SafeArea`（:153-178）确实只是 `View` / `Button` 包装，无 `Canvas`；本 app 实跑 `create` 消息 21 个节点、其中 `kind=3`（Canvas）0 个。无需降级为画布预算锁。
2. `SafeArea(round, size=480)` 的 `safeInsets` 实证为 top=70/right=71/bottom=71/left=70，安全方形边长 **339 px**（`Math.floor(480/√2)=339`）。四张卡与 RESET 全部按 339 内接方形排布（卡 163×122，两列 x=0/176，行 y=38/166，RESET y=290），并以 `padding:8/gap:4` 覆盖 Card 默认 16/12 才装得下；harness live 断言无 `SafeArea child exceeds` 警告。
3. 简报称「13 个 harness 清单计数 57→58」——`grep -rn 'length === 57\|length, 57' tests/*.js` 实证 **14 处**（adc_meter / archive_view / controls_demo / crypto_check / hr_monitor / img_view / keyboard_demo / ota_consumers / reboot_consumers / sntp_consumers2 / timer_kit / vec_demo / weather_sntp / wordle），已逐个同步；`tests/shell_components.js:18` 的 `56` 是 IconButton 高度 attr（r157 教训），未动。`sd_files.js:199` 的 needle 精确匹配 build.mjs 列表尾部，追加 `'control_center'` 后 mutation 仍 load-bearing。
4. 本轮 firmware/runtime/tools 零改动，`git diff 76d2c0c HEAD -- firmware/ runtime/` 与工作树版均空，**无任何 BASE 重钉**；改前/改后全量 suite 均 0 FAIL，符合简报预期。

**实现**：`examples/control_center/app.js`（单文件、保守 var/function、唯一一行 shell.js import）。`SafeArea(round,480)` 包根 + 标题；4 张 `Card`：WiFi / Bluetooth 各用 1 个 `IconButton` 切换模拟态（开=accent、关=surfaceAlt，标题 `ON`/`OFF`），音量/亮度用原生 View/Text 条与分档 Text（VOL 0..10 tap 循环 +1，BRT 1..5 循环），**不消费 Slider**（r157 专属）；底部第 3 个 `IconButton`（RESET）恢复全部默认。四值全 signal 驱动，每次变更经 `lume.storage.kv` 写入，启动读回（flag 只收 0/1，step 只收合法整数），读写全包 try/catch，NVS 失效退化为易失默认值。WiFi/BT 是**本地模拟态，不调 lume.net/lume.ble**；亮度不驱动真实背光。静态树 21 节点（预算 60 / 固件上限 128），字号仅 14/20/32，全文件非 ASCII 字节 0。

**宿主 harness**：新增 `tests/control_center.js`（CommonJS，仿 timer_kit）：21 静态断言（三组件真实消费、signal 图、KV 键 ≤15、两种 get 与 set 的 try/catch、启动读回、循环边界、RESET、零 Slider、零 Canvas、ASCII、字号、节点上限、playground 字节一致、58 清单、固件零 diff）+ 19 静态 mutation + 8 live（真 prelude + 真 shell.js：IconButton tap 写 KV、音量/亮度循环、RESET、非法值/抛异常退化、dispose/shutdown effects+timers 归零）+ 3 live mutation，全部 load-bearing。

**级联同步**：`tools/playground/build.mjs` 清单 57→58（`control_center` 第 58 个，命令实证 `58 editable sources` / `58 apps`）；14 个 harness 计数断言同步；`sd_files.js` 变异串追加 `'control_center'`；`ota_consumers.js` ALLOWED 在 commit 前预加 4 个新路径（app / harness / 两个 playground 生成物）。二次构建 md5 三项 OK，生成物幂等。

**验证（原始输出；宿主/编译证据，非真机）**：
- `node tests/control_center.js` → 末行 `ALL CONTROL CENTER HARNESS CASES PASSED`，`EXIT=0`。
- `for t in tests/*.js; do node "$t" >/dev/null 2>&1 || echo FAIL "$t"; done; echo done` → 仅 `done`，**0 FAIL**。
- `npm test --prefix tools/lume` → `# tests 50 / # pass 50 / # fail 0 / # skipped 0`。
- `python3 scripts/check_website.py` → `HTML pages: 7` / `API: 158 catalog entries, 158 type declarations, 34 function namespaces` / `API missing/invented/duplicates/signatures not found: none`。
- `node tools/lume/lume.js check examples/control_center --no-emu` → `[PASS] bundle 23510 bytes` / `RESULT: PASS (4 steps, 0 failed; exit 0)`；哨兵 `examples/counter --no-emu` → `[PASS] bundle 2160 bytes` / `RESULT: PASS`。
- `npm run build:playground --prefix tools/lume` → `PASS bundle control_center 23510 bytes` / `PASS esbuild-wasm assets and 58 editable sources` / `PASS prelude 67428 bytes; 58 apps`。
- **固件零改动，未跑 `idf.py build`**：`git diff 76d2c0c HEAD -- firmware/ runtime/` 与 `git diff 76d2c0c -- firmware/ runtime/` 原始输出均为空；IRAM 16384 硬线未触碰。
- `grep -Pn '[^\x00-\x7F]' examples/control_center/app.js tests/control_center.js` → 无输出（NONE）；`grep -rn 'length === 57\|length, 57' tests/*.js` → 无输出。

**里程碑口径**：M5 Component library 行仍不勾（三控件被消费 ≠ 真机验收）；真机触控命中、圆屏安全区遮挡、背光联动、radio 状态、滑动/循环手感全部 deferred，**不声称真机验证**。未改 vendored（QuickJS/LVGL）、未改 `.d.ts`；未跑 codex review（主控轮负责）；磁盘紧张，临时产物只留 `/tmp`，未清主仓 build/。

**commits（未推送，拆分）**：feat `c78e4f1`（app + 58-app playground 生成物） / test `42963ac`（control_center harness + 14 处计数同步 + sd_files 变异串 + ota ALLOWED 预加） / docs（本节 + KNOWN-SIMPLIFICATIONS r159 节）。

详见 docs/KNOWN-SIMPLIFICATIONS.md r159 节。

### r160 result — M5 Component library 第七片：launcher_grid 网格启动器（`shell.Launcher` 唯一零消费组件的首个消费刀，纯 app 层；appended, milestone checkboxes untouched）

**开工**：`bash /home/ubuntu/.hermes/scripts/lume_model_guard.sh` → `GUARD: settings.json model=hy4flash-free ✓` / `GUARD: model=hy4flash-free ✓ (settings + runtime audit clean)`，退出码 0，无 429，未在 `/home/ubuntu/lume` 写任何文件。新 worktree `/tmp/lume-r160-wt`（分支 `r160-launcher-grid`，基线 `8e42b96`）；`tools/lume/bin/qjsc` 与 `tools/lume/node_modules` 从主仓只读软链对齐（先建 `bin/` 目录），源码零改动、软链不入 git。干净基线全量 `tests/*.js` = 0 FAIL。

**实证纠偏（方案与实际代码不符处，以源码为准）**：
1. 简报称「每个 app 图标是 48×48 Canvas」——逐行读 `runtime/shell.js` 证实 `Launcher`（:599-655）的 `renderItem` 内确为 `Canvas({ width: 48, height: 48, ... })`（:641），但 `EdgeNavigation`（:228-285）在 `indicator !== false` 时**每侧再加一个 24×64 Canvas**（:246）。故 app 必须显式传 `indicator: false` 才能让画布数恰等于 `apps.length`；harness live 断言 `canvases.length === 9`，mutation 反例实证「开 indicator → 11 个画布」转红。
2. `onLaunch` 语义实证（:638-639）：传 `p.onLaunch` 则**只调宿主回调**，不落 `lume.apps.launch`；未传才走真机 app 切换。本 app 传宿主回调记录 `launch <id>`，harness live 断言 `launch` 消息数为 0。
3. 简报称「`grep -rn 'length === 58' tests/*.js` 当前 10 处」——实证该语法确 10 处，但另有 **5 处**写作 `assert.equal(apps.length, 58, ...)`（adc_meter / archive_view / crypto_check / img_view / vec_demo），合计 **15 处**；若只按简报的 10 处同步，全量 suite 会新增 5 个 FAIL。已全部 58→59 同步。`tests/control_center.js` 第 10/153/193 行的「58-app」是**文案标签**，按纪律未动；`docs/roadmap.md` 的历史 58 记录是快照，未动。
4. `examples/control_center` / `timer_kit` 的 JSDoc 不能照抄字面量：app 注释若写 `lume.apps.entries()` / `lume.apps.launch` 会被静态断言（要求这些串全文件不出现）判红，已改写为「app-store 默认」「不切换 app」等描述。harness 的 `apps: APPS` / 唯一性也因 introspection 对象曾重复一次而退化，已把 introspection key 改名 `appList` 恢复 load-bearing。
5. harness 两处自证修正：(a) APPS/FIELDS 断言曾闭包捕获模块级数组，mutation 改 source 后数组不变 → 假绿，已改为对传入 source 现场提取；(b) 连续两次 edge swipe 用相同时间戳时第二次不触发（gesture 状态机按时基判定），已给 `drag` 加 `t0` 参数，第二次用 200/250/300。

**实现**：`examples/launcher_grid/app.js`（单文件、保守 var/function、唯一一行 shell.js import）。480×480 全幅方屏（非圆屏，不用 SafeArea）；`lume.theme.set` 自定义 bg/primary/surface/accent/text 等色；显式 9 个精选 app 字面量数组（id/label/color/单字母 ASCII glyph：C/T/Q/K/W/E/M/L/S），不依赖 app store；`shell.Launcher({ title:'GRID', columns:3, indicator:false, onLaunch, onBack })`；底栏 24 px 处一条 signal 驱动的 ASCII status Text，显示 `launch <id>` / `BACK` / `READY`。9 个 48×48 图标 = 20,736 px ≤ 230,400 px 全帧预算；静态树 41 个 `create` 节点（远低于 128）。字号仅 14/20/32，全文件非 ASCII 字节 0。

**宿主 harness**：新增 `tests/launcher_grid.js`（CommonJS，仿 `tests/control_center.js`）：16 静态断言（Launcher 真实消费、显式 9 app、4 字段/ASCII glyph、GRID/3 列/indicator off、画布预算常量、onLaunch/onBack/status/theme、ASCII、字号、59 清单、字节一致、固件零 diff）+ 19 静态 mutation + 4 live（真 prelude + 真 shell.js：根节点与精确 9×2304 画布预算、tile onPress → `launch <id>` 且无 real launch、编辑态吞 back + 第二次 back 到宿主、shutdown 后 effects/timers 归零）+ 4 live mutation，全部 load-bearing。

**级联同步（不改生产行为）**：`tools/playground/build.mjs` 清单 58→59（`launcher_grid` 第 59 个，命令实证 `59 editable sources` / `59 apps`，bundle 20533 bytes）；15 个 harness 计数断言逐个同步（10 处 `length === 58` + 5 处 `assert.equal(apps.length, 58, ...)`）；`sd_files.js` 变异串精确追加 `'launcher_grid'`；`ota_consumers.js` ALLOWED 在 commit 前预加 4 个新路径（app / harness / 两个 playground 生成物）。

**验证（原始输出；宿主/编译证据，非真机）**：
- `node tests/launcher_grid.js` → 末行 `ALL LAUNCHER GRID HARNESS CASES PASSED`，`EXIT=0`。
- `for t in tests/*.js; do node "$t" >/dev/null 2>&1 || echo FAIL "$t"; done; echo done` → 仅 `done`，**0 FAIL**。
- `npm test --prefix tools/lume` → `# tests 50 / # pass 50 / # fail 0 / # skipped 0`。
- `python3 scripts/check_website.py` → `HTML pages: 7` / `API: 158 catalog entries, 158 type declarations, 34 function namespaces` / `API missing/invented/duplicates/signatures not found: none`。
- `node tools/lume/lume.js check examples/launcher_grid --no-emu` → `[PASS] bundle 20533 bytes` / `RESULT: PASS (4 steps, 0 failed; exit 0)`；哨兵 `examples/counter --no-emu` → `[PASS] bundle 2160 bytes` / `RESULT: PASS`。
- `npm run build:playground --prefix tools/lume` → `PASS bundle launcher_grid 20533 bytes` / `PASS esbuild-wasm assets and 59 editable sources` / `PASS prelude 67428 bytes; 59 apps`。
- **固件零改动，未跑 `idf.py build`**：`git diff 8e42b96 HEAD -- firmware/ runtime/ tools/lume/` 与 `git diff 8e42b96 -- firmware/ runtime/ tools/lume/` 原始输出均为空；IRAM 16384 硬线未触碰。
- `grep -Pn '[^\x00-\x7F]' examples/launcher_grid/app.js tests/launcher_grid.js` → `NONE`。

**里程碑口径**：M5 Component library 行仍不勾（组件被消费 ≠ 真机验收）；真机触控命中、9 宫格图标渲染/配色、编辑态滑动手感、app 切换语义全部 deferred，**不声称真机验证**。未改 vendored（QuickJS/LVGL）、未改 `.d.ts`；未跑 codex review（主控轮负责）；磁盘紧张，临时产物只留 `/tmp`，未清主仓 build/。

**commits（未推送，拆分）**：feat（app + 59-app playground 生成物） / test（launcher_grid harness + 15 处计数同步 + sd_files 变异串 + ota ALLOWED 预加） / docs（本节 + KNOWN-SIMPLIFICATIONS r160 节）。

详见 docs/KNOWN-SIMPLIFICATIONS.md r160 节。

### r161 result — playground 补清单刀：minigolf + ipod_music 入列（61 apps，纯工具清单层；appended, milestone checkboxes untouched）

**开工**：`bash /home/ubuntu/.hermes/scripts/lume_model_guard.sh` → `GUARD: settings.json model=hy4flash-free ✓` / `GUARD: model=hy4flash-free ✓ (settings + runtime audit clean)`，退出码 0，无 429，未在 `/home/ubuntu/lume` 写任何文件。新 worktree `/tmp/lume-r161-wt`（分支 `r161-playground-gap`，基线 `362af44`）；`tools/lume/bin/qjsc` 与 `tools/lume/node_modules` 已只读软链对齐，源码零改动、软链不入 git。干净基线全量 `tests/*.js` = 0 FAIL，基线 `npm test` = 50/0/0，`check_website.py` 三项 none，均留存。

**实证纠偏（假设以源码为准）**：
1. 简报称计数断言「16 处」——实证 `grep -rn 'length === 59' tests/*.js` 为 **11 处**，`grep -rn 'apps.length, 59' tests/*.js` 为 **5 处**，合计确 16 处，全部 61 化；只改一种语法会留 5 个红灯。`tests/control_center.js:10/130/164` 与 `tests/launcher_grid.js:10/130/164` 的「59-app」是**文案标签**（含 mutation 查找键），按纪律未动；`tests/shell_components.js:18` 的 `56` 是 IconButton 高度 attr（r157 教训），未动。
2. 简报称差集初核 15 app + 两个待入列 app——实证 `examples/` 带 `app.js` 的目录 **77 个**、`build.mjs` 清单 **61 个**，差集 **16 个**：`ai_chat, app_manager, ble_uart, device_monitor, gestures, imu_poll, launcher, mochi, net_check, nettest_open, shell_demo, spectrum, svg_icon, typewriter_min, web_config, ws_echo`。简报初核**漏列 `mochi`**（gesture 依赖，见下），已实证补入登记；`minigolf` / `ipod_music` 入列后差额恰为 16，无悬案。清单中无「无对应 example」的幽灵条目（`manifest-without-example: none`）。
3. r155 遗留实证：基线 `HEAD` 已跟踪 `website/playground/apps/ipod_music.js` 与 `website/playground/sources/ipod_music.js`（r155 一次性构建产物）；重跑 `build.mjs` 不会删文件，但 `sources.js` 不再含其键——这就是「一重跑即丢失」的真因。本刀把 app 正式入列后，两份生成物与新增的 minigolf 两份一并随 feat commit 落仓；`apps/ipod_music.js` 再次构建仅 esbuild 压缩变量名变化（`d/x` → `h/k`），功能等价，`sources/ipod_music.js` 与 example 字节一致。
4. `svg_icon` / `typewriter_min` 弹性范围实证后**不入列**：`svg_icon` 是 r58 的 `Image` + SVG 栅格化渲染能力探针（`examples/svg_icon/app.js` 只画一个静态勾选图标，配套 `tests/lume_svg_test.c`），r98 报告明确其「单独注册为 bundle 但在选择列表展示 38 个、不含它」；浏览器 playground stub 不保证 SVG 栅格化，入列会得到一个无交互且可能空白的条目。`typewriter_min` 是 6 行 emu smoke 复现 fixture（commit `03fafb8`，与已入列的 `typewriter` 重复，无任何 harness/docs 引用）。两者都不属「被遗漏的展示 app」，保持不入列。

**实现**：`tools/playground/build.mjs` 的 `apps` 数组尾部按同款格式追加 `'minigolf', 'ipod_music'`（59→61），构建逻辑零改动。重建生成物：`website/playground/sources.js`（61 keys）、`website/playground/sources/minigolf.js`（新）、`website/playground/apps/minigolf.js`（新）、`website/playground/apps/ipod_music.js`（重生成）、`website/playground/sources/ipod_music.js`（字节不变）。bundle 尺寸 `minigolf 9711 bytes` / `ipod_music 22468 bytes`，均非 0、非超大。

**级联同步（不改生产行为）**：16 处清单计数断言全部 59→61（11 + 5 两种语法）；`sd_files.js` 清单变异串尾部精确追加 `'minigolf', 'ipod_music'`，mutation `drop image_gallery from playground manifest` 仍转红；`ota_consumers.js` ALLOWED 在 feat/test commit 前预加 4 个新路径（两 app 的 `apps/` + `sources/` 生成物；16 个被改的 `tests/*.js` 与 `docs/*.md`、`sources.js`、`build.mjs` 均已在既有 ALLOWED 中）。

**差集 16 app 的不入列登记（逐个实证，原因大类：硬件依赖 / 内部演示 / 协议对端）**：

| app | 实证 API 依赖 | 不入列原因 |
|---|---|---|
| `ai_chat` | `lume.ai.chat`, `lume.net.connect/status` | 依赖在线 AI 端点 + WiFi，浏览器 gallery 离线无意义 |
| `app_manager` | `lume.apps.entries/home/remove` | 设备端 app 安装/卸载管理，非展示型 |
| `ble_uart` | `lume.ble.start/read/write/status` | BLE 外设角色硬件依赖（r25 实证） |
| `device_monitor` | `lume.ble.status`, `lume.imu.read`, `lume.net.status`, `lume.pmic.*` | PMIC/IMU/BLE/网络多硬件依赖 |
| `gestures` | `lume.gesture.on` | IMU/手势硬件依赖 |
| `imu_poll` | `lume.imu.read` | IMU 硬件依赖 |
| `launcher` | `lume.apps.launch/setBoot/entries` | 设备端启动器（真机 boot 语义），gallery 已有 `launcher_grid` 作展示替代 |
| `mochi` | `lume.gesture.on`, `onPause/onResume` | 手势/触摸硬件依赖（简报初核漏列，本刀实证补登） |
| `net_check` | `lume.net.init/connect/httpRequest/status`, `lume.storage.Sd` | WiFi + HTTP + SD 硬件依赖 |
| `nettest_open` | `lume.net.init/connect/status` | WiFi 硬件依赖 |
| `shell_demo` | `lume.ui.shell` | 内部 shell 组件演示，roadmap 早已记「gallery does not list `shell_demo`」 |
| `spectrum` | `lume.audio.recordStream/stopStream` | 麦克风（I2S/PSRAM 环）硬件依赖 |
| `svg_icon` | `Image({src: svgBytes.buffer})` | r58 SVG 栅格化渲染探针，r98 起故意不进选择列表；浏览器 stub 不保证栅格化 |
| `typewriter_min` | `signal` + `lume.system.setInterval` | 6 行 emu smoke 复现 fixture，与已入列 `typewriter` 重复 |
| `web_config` | `lume.net.web`, `lume.storage.kv` | 内置 web 服务器依赖 |
| `ws_echo` | `lume.net.ws` | WebSocket 协议对端依赖，离线 gallery 无对端 |

无「该入列而被遗漏」的 app；后续若要做纯展示补入，候选只有 `svg_icon` / `typewriter_min`，已如上说明为何本刀不动。

**验证（原始输出；宿主/编译证据，非真机）**：
- `npm run build:playground --prefix tools/lume` → `PASS bundle minigolf 9711 bytes` / `PASS bundle ipod_music 22468 bytes` / `PASS esbuild-wasm assets and 61 editable sources` / `PASS prelude 67428 bytes; 61 apps`；二次/三次构建输出逐字一致，`git status` 干净（幂等）。
- `for t in tests/*.js; do node "$t" >/dev/null 2>&1 || echo FAIL "$t"; done; echo done` → 仅 `done`，改前/改后均 **0 FAIL**。
- `npm test --prefix tools/lume` → `# tests 50 / # pass 50 / # fail 0 / # skipped 0`。
- `python3 scripts/check_website.py` → `HTML pages: 7` / `API: 158 catalog entries, 158 type declarations, 34 function namespaces` / `API missing/invented/duplicates/signatures not found: none`。
- `node tools/lume/lume.js check examples/minigolf --no-emu` → `[PASS] bundle 9711 bytes` / `RESULT: PASS (4 steps, 0 failed; exit 0)`；`examples/ipod_music` → `[PASS] bundle 22468 bytes` / `RESULT: PASS`；哨兵 `examples/counter` → `[PASS] bundle 2160 bytes` / `RESULT: PASS`。
- `grep -rn 'length === 59\|apps.length, 59' tests/*.js` → 无输出（grep exit 1）；`node -e` 解析 `website/playground/sources.js` → `keys: 61 | has minigolf: true | has ipod_music: true`。
- **源码零改动，未跑 `idf.py build`**：`git diff 362af44 HEAD -- firmware/ runtime/ examples/` 原始输出为空；本刀只动 `tools/playground/build.mjs`、`website/playground/`、`tests/`、`docs/`。
- 磁盘 `/` 余 4.9G；构建日志只留 `/tmp/r161-playground-build{1,2,3}.txt`，未在主仓 artifacts 新增日志；不声称真机验证。

**里程碑口径**：纯清单刀，无里程碑 checkbox 变化；真机显示/触控/无线电/persistence 全部 deferred，**不声称真机验证**。未改 vendored（QuickJS/LVGL）、未改 `.d.ts`；未跑 codex review（主控轮负责）；未推送。

**commits（未推送，拆分）**：feat `4f12d4e`（build.mjs + 61-app playground 生成物） / test `caa12f2`（16 处计数同步 + sd_files 变异串 + ota ALLOWED 预加） / docs（本节 + KNOWN-SIMPLIFICATIONS r161 节）。

详见 docs/KNOWN-SIMPLIFICATIONS.md r161 节。

### r162 result — `shell.Launcher` 编辑态外露刀：`onEditingChange` 回调 + launcher_grid 消费（runtime/ 小刀 + 纯 app 层；appended, milestone checkboxes untouched）

**开工**：`bash /home/ubuntu/.hermes/scripts/lume_model_guard.sh` → `GUARD: settings.json model=hy4flash-free ✓` / `GUARD: model=hy4flash-free ✓ (settings + runtime audit clean)`，退出码 0，无 429，未在 `/home/ubuntu/lume` 写任何文件。新 worktree `/tmp/lume-r162-wt`（分支 `r162-launcher-editing`，基线 `f6d5853`）；`tools/lume/bin/qjsc` 与 `tools/lume/node_modules` 已只读软链对齐、软链不入 git。干净基线全量 `tests/*.js` = 0 FAIL。

**实证纠偏（假设以源码为准）**：
1. `grep -n 'editing.set' runtime/shell.js` 实证变更点恰两处：edit 按钮 `onPress`（:620）与 `EdgeNavigation` 的 `onBack`（:651）；`var editing = signal(false)` 在 :610。与简报锚点一致。
2. `website/api.html:23` 的 Launcher 签名是 `function Launcher(props: LauncherProps): lume.ui.Node;`，**按名字引用 `LauncherProps`、不含内联 props**；`scripts/check_website.py` 只校验该签名行在 `.d.ts` 中原样存在。故 `onEditingChange` 加进 `interface LauncherProps` 后签名行自动一致，**api.html 无需改动**，实证 `check_website.py` 四类 none。若强行往签名行塞内联 prop 反而转红。
3. 本轮合法改 `runtime/shell.js` / `runtime/types/lume.d.ts`，使 **20 个** harness 的 runtime/firmware 零 diff 守卫转红（简报只预期 app 数量无级联，实证此级联存在）。按既有 `76d2c0c` 先例，test commit 把全部 BASE 从旧提交重钉到本轮 feat `80e76b2`，零 diff / allowlist 语义完全保留（未自比较、未删守卫、未放宽断言），重钉后全量 0 FAIL。`sd_files.js` 的清单变异串未动（app 数量不变，仍 61）。

**实现**：`runtime/shell.js` 引入局部 `setEditing(v)`（`editing.set(v)` 后 `if (p.onEditingChange) p.onEditingChange(v)`），两处变更点统一走它；不用 effect 订阅（避开首帧误报 false 与 dispose 时序），不加 try/catch（与 shell 全部回调现状一致）。`runtime/types/lume.d.ts` `LauncherProps` 增 `onEditingChange?: (editing: boolean) => void;`。`examples/launcher_grid/app.js` 增 `editing` signal，status Text 改为 `editing() ? 'EDIT' : lastAction()`，回调写该 signal；暴露 `statusNode` / `editing` 供 harness 精确观测渲染文本。不传回调时 shell 行为与基线逐字等价（live 变体实证）。

**级联同步（不改生产行为）**：`npm run build:playground` 重建后，除 launcher_grid 生成物外，另有 7 个 app bundle 因内嵌 shell.js 而更新、`sources.js` 同步；61 apps 不变。`ota_consumers.js` ALLOWED 本轮无新路径（改的全是已跟踪文件），未预加。

**验证（原始输出；宿主/编译证据，非真机）**：
- `node tests/launcher_grid.js` → 20 静态 + 25 静态 mutation + 6 live + 9 live mutation 全绿，末行 `ALL LAUNCHER GRID HARNESS CASES PASSED`，`EXIT=0`。新增 live 实证：tap edit → 回调 true / 渲染 `EDIT`、back → false / 恢复 `READY`、无回调变体不炸且保持旧语义；新增 shell 侧 live mutation「删掉通知调用 → app editing 仍 false」证明通知 load-bearing。
- `for t in tests/*.js; do node "$t" >/dev/null 2>&1 || echo FAIL "$t"; done; echo done` → 仅 `done`，**0 FAIL**（feat 后、test commit 后各跑一次；最终又连跑 4 次均 0 FAIL）。一次早期全量跑曾出现 `FAIL tests/wordle.js`，单独复跑即绿；实证 `tests/wordle.js:428-431` 的 smoke 用 `Math.random()` 掷键，断言 `a green or yellow cell fill was drawn`（:388）在随机序列未命中绿/黄格时会偶发失败。干净基线 worktree `f6d5853` 同法 40 次跑出 2 次失败（本轮 worktree 30 次 1 次失败），**确认为存量 flake、非本轮引入**；本轮对 `wordle.js` 的改动只有 BASE/标签重钉，未碰 smoke 与断言。
- `npm test --prefix tools/lume` → `# tests 50 / # pass 50 / # fail 0 / # skipped 0`。
- `python3 scripts/check_website.py` → `HTML pages: 7` / `API: 158 catalog entries, 158 type declarations, 34 function namespaces` / `API missing/invented/duplicates/signatures not found: none`。
- `node tools/lume/lume.js check examples/launcher_grid --no-emu` → `[PASS] bundle 20683 bytes` / `RESULT: PASS (4 steps, 0 failed; exit 0)`；哨兵 `examples/counter --no-emu` → `[PASS] bundle 2160 bytes` / `RESULT: PASS`。
- `npm run build:playground --prefix tools/lume` → `PASS esbuild-wasm assets and 61 editable sources` / `PASS prelude 67428 bytes; 61 apps` / `PASS bundle launcher_grid 20683 bytes`；二次构建输出逐字一致、`git status` 无变化（幂等）。
- **固件零关联实证，未跑 `idf.py build`**：`grep -rn 'shell\.js\|shell\.Launcher\|runtime/shell' firmware/main/ firmware/components/lume-engine/ 2>/dev/null` 与 `grep -rn 'shell' ...` 均无输出（shell.js 是 CLI-bundled JS 层，不进固件 prelude）；`git diff f6d5853 HEAD -- firmware/` 与原 `lume_scripts.c` diff 均为空，IRAM 16384 硬线未触碰。
- ASCII 纪律：`examples/launcher_grid/app.js` 与 `tests/launcher_grid.js` 全文件非 ASCII 字节 0，字号仅 14；未改 vendored（QuickJS/LVGL）。

**里程碑口径**：M5 Component library 行仍不勾（组件被消费 ≠ 真机验收）；编辑态真实触控命中、edit 按钮手感、back 滑动手感、status `EDIT` 在 AMOLED 上的可读性**全部 deferred，不声称真机验证**。r160 登记的「editing 不对外暴露」遗留就此收口。

**commits（未推送，拆分）**：feat `80e76b2`（runtime + 契约 + app + playground 生成物） / test `690cb07`（launcher_grid 断言扩展 + 20 个 runtime 守卫 BASE 重钉） / docs（本节 + KNOWN-SIMPLIFICATIONS r162 节）。未跑 codex review（主控轮负责）。磁盘 `/` 余 4.9G，日志只留 `/tmp`。

详见 docs/KNOWN-SIMPLIFICATIONS.md r162 节。

### r163 result — `shell.Dialog` 消费刀：settings 两处危险操作 Dialog 化（纯 app 层；appended, milestone checkboxes untouched）

**开工**：`bash /home/ubuntu/.hermes/scripts/lume_model_guard.sh` → `GUARD: settings.json model=hy4flash-free ✓` / `GUARD: model=hy4flash-free ✓ (settings + runtime audit clean)`，退出码 0，无 429，未在 `/home/ubuntu/lume` 写任何文件。新 worktree `/tmp/lume-r163-wt`（分支 `r163-settings-dialog`，基线 `9fb12d7`）；`tools/lume/bin/qjsc` 与 `tools/lume/node_modules` 只读软链对齐主仓、软链不入 git。

**实证纠偏（假设以源码为准）**：
1. `grep -n` 实证 `examples/settings/app.js` 的 OTA/reboot 两段式为 signal `otaConfirm`/`rebootConfirm`（:101-102）+ `otaArmTimer`/`rebootArmTimer` + 3 s `setTimeout`；按钮 title 在 arm 窗口翻转（原 :730 / :757），note 文案 `otaNote`/`rebootNote` 走状态 Text（原 :727 / :754）。`powerConfirm`（Power off）是另一处两段式，不在本刀范围、未动。
2. `runtime/shell.js:85-111` 实证 Dialog：`dialogs` 栈、遮罩 `p.modal !== false` 时点按关闭、按钮 style 仅接受 plain/primary/danger、danger 用 `Button` + `background:danger`、press 时先关栈再调 `button.onPress`；`runtime/types/lume.d.ts:216-229` 契约一致。
3. `examples/settings/app.js` 原**未** import shell.js（对照 `examples/files/app.js:22` 等消费方均 `import '../../runtime/shell.js';`），故本刀补上该 import；esbuild 打包后 `lume.ui.shell.Dialog` 在 playground 与宿主均为 function（live 实证）。
4. **stub 降级决策：显示 ASCII note，绝不直接执行危险动作**。playground stub 因 shell.js 被编进 app 而自带 Dialog，但为防「无 Dialog 的假 stub」场景，两处调用前加 `typeof lume.ui.shell.Dialog === 'function'` 防御；缺失时分别写 `rotate n/a (no dialog)` / `reboot n/a (no dialog)`，不静默轮换 token 或重启。取舍见 KNOWN-SIMPLIFICATIONS.md r163 节。
5. **`lume.system.reboot` 防御保留并移入 danger 回调内**：原 `typeof lume.system.reboot !== 'function'` + `rebootNote.set('reboot n/a')` 原样留在 Reboot 的 onPress 里，Cancel 与模态阶段都不触碰它。
6. **live harness 曾踩「假绿」**：初版用 label Text 的 node id 调 `press`，而 plain Cancel 的 handler 挂在父 `View` 上，press 落到 Text 上什么也没发生——Cancel 断言是摆设。实证 `press` 消息序为 `[mask, cancelView, dangerButton, card]` 后改按 handler 节点派发，并用「给 Cancel 注入 onPress → live 断言转红」自证 load-bearing，不摆设。

**实现**：`examples/settings/app.js` 纯 app 层：两处危险操作各开一个 `shell.Dialog({title, message, buttons:[Cancel plain, Rotate/Reboot danger]})`；删除 `otaConfirm`/`rebootConfirm` signal、`otaArmTimer`/`rebootArmTimer` 与 3 s 超时、button title 翻转；保留 setToken 错误码 → `otaNote`、成功 `refreshOta()`、`reboot n/a` 防御。UI 两行仍 View+Text+Button，title 改静态 `New token` / `Reboot`。`examples/files` 未动；`firmware/`、`runtime/` 零改动。

**既有 harness 同步（不改断言语义）**：`tests/ota_consumers.js`（3 个检查 + 3 个 mutation 改 Dialog 口径）、`tests/reboot_consumers.js`（2 个检查 + 3 个 mutation 改 Dialog 口径）；`tests/settings_dialog.js` 新文件，并在 `ota_consumers.js` ALLOWED 预加防 untracked 提交后转红。`tests/settings.js` 不存在（实证 `ls tests/settings*.js` 无输出）。

**验证（原始输出；宿主/编译证据，非真机）**：
- `node tests/settings_dialog.js` → 14 静态 + 10 静态 mutation + 7 live + 1 live mutation 全绿，末行 `ALL SETTINGS DIALOG HARNESS CASES PASSED`，`EXIT=0`。live 实证：Cancel → 0 setToken / 0 reboot；Rotate → 1 次 setToken(32 lowercase hex)；setToken -7 → `setToken err -7`；Reboot → 1 次 reboot；无 reboot binding → `reboot n/a`；无 Dialog → 两条 `(no dialog)` note 且 0 动作；给 Cancel 注入 onPress → 转红。
- `for t in tests/*.js; do node "$t" >/dev/null 2>&1 || echo FAIL "$t"; done; echo done` → 仅 `done`，**0 FAIL**（唯一一次默认 timeout 被 SIGTERM 后用 600 s 重跑即 0 FAIL；本刀未触发 wordle flake）。
- `npm test --prefix tools/lume` → `# tests 50 / # pass 50 / # fail 0 / # cancelled 0 / # skipped 0`。
- `python3 scripts/check_website.py` → `API missing: none` / `API invented: none` / `API duplicates: none` / `API signatures not found in lume.d.ts: none`。
- `node tools/lume/lume.js check examples/settings --no-emu` → `[PASS] bundle 33621 bytes` / `RESULT: PASS (4 steps, 0 failed; exit 0)`；哨兵 `examples/counter --no-emu` → `[PASS] bundle 2160 bytes` / `RESULT: PASS`。
- `npm run build:playground --prefix tools/lume` → `PASS bundle settings 33621 bytes` / `PASS esbuild-wasm assets and 61 editable sources` / `PASS prelude 67428 bytes; 61 apps`。
- **固件/runtime 零改动，未跑 `idf.py build`**：`git diff 9fb12d7 HEAD -- firmware/ runtime/` 与工作树版 `git diff 9fb12d7 -- firmware/ runtime/` 原始输出均为空。
- ASCII 纪律：`grep -Pn '[^\x00-\x7F]' examples/settings/app.js tests/settings_dialog.js` → `NONE`（新 harness 的变异载荷用 `String.fromCharCode(0x4E2D)` 运行时构造，源码全 ASCII）。

**里程碑口径**：Dialog 获得第二个真实消费方（files + settings），但组件被消费 ≠ 真机验收；危险按钮 danger 配色在 AMOLED 上的对比度、模态命中率、两段式→模态手感差异**全部 deferred，不声称真机验证**。未改 vendored（QuickJS/LVGL）、未改 `.d.ts`；未跑 codex review（主控轮负责）；未推送。

**commits（未推送，拆分）**：feat `a18a83a`（app + playground 生成物） / test `cbf4422`（新 harness + 两个既有 harness 同步） / docs（本节 + KNOWN-SIMPLIFICATIONS r163 节）。磁盘 `/` 余约 5 G，日志只留 `/tmp`。

详见 docs/KNOWN-SIMPLIFICATIONS.md r163 节。

### r164 result — 两段式 confirm 收官刀：settings Power off + hr_monitor BLE gate Dialog 化（纯 app 层；appended, milestone checkboxes untouched）

**开工**：`bash /home/ubuntu/.hermes/scripts/lume_model_guard.sh` → `GUARD: settings.json model=hy4flash-free ✓` / `GUARD: model=hy4flash-free ✓ (settings + runtime audit clean)`，退出码 0，无 429，未在 `/home/ubuntu/lume` 写任何文件。新 worktree `/tmp/lume-r164-wt`（分支 `r164-confirm-sweep`，基线 `8b46c00`）；`tools/lume/bin/qjsc` 与 `tools/lume/node_modules` 只读软链对齐主仓、软链不入 git。

**实证纠偏（假设以源码为准）**：
1. `grep -rn 'powerConfirm\|toggleArm\|Confirm off\|Confirm adv\|Confirm stop' examples/*/app.js` 实证两段式残留恰两处：settings `powerConfirm`(:100) + `armTimer`(:377) + 3 s `setTimeout` + title 翻转(:773)；hr_monitor `toggleArm`/`toggleArmTimer`(:37-38) + r146 TWO-STAGE GATE(:101-117) + `Confirm adv?` title(:176)。`examples/files` 的 Dialog 是单向弹窗、非 confirm gate，未动。收官后同一 grep 无输出。
2. `runtime/shell.js:85-111` 实证 Dialog 契约：按钮 style 仅 plain/primary/danger，press 先 `closeDialog` 再调 `button.onPress`；plain Cancel 的 handler 挂在父 `View`，label `Text` 无 handler。
3. **hr_monitor 原本没有 `import '../../runtime/shell.js'`**（对照 settings / files / wordle 等消费方均有）。实证若不补 import，`lume.ui.shell.Dialog` 为 undefined，Dialog 调用永远走 typeof guard 写 note、弹窗根本不出现；本刀补上该 import 后 bundle 由 3568 → 23003 bytes（与 r163 settings 同一坑）。
4. r163 教训沿用：live harness 按 `[mask, cancelView, dangerButton, card]` 的 press 消息序取 handler 节点派发，不按 label id；并以「给 Cancel 注入 onPress → live 断言转红」自证 load-bearing。
5. settings 以 `powerNote` signal 替掉 `powerConfirm` 原位作 ASCII note 载体，guard 失败时写 `power off n/a` / `power off n/a (no dialog)`，并在 Power off 按钮 title 的错误态显示，不新增节点。

**实现（纯 app 层）**：两处各开 `shell.Dialog({title, message, buttons:[Cancel plain, danger]})`，删除两段式 signal / arm timer / 3 s 超时 / title 翻转；`lume.pmic.powerOff` 与 BLE binding 的 typeof 防御移入 danger 回调内，Cancel / mask / card / 无 Dialog 的 stub 阶段绝不触碰 binding。`lume.pmic.powerOff()` 与 `startAdv()`/`stopAdv()` 本体零改动；hr_monitor 只动信号声明、r146 gate 块、按钮行与顶部 import；note / advertising / HR 渲染链路零改动。`firmware/`、`runtime/`、`.d.ts`、vendored、`examples/files` 全未动。

**harness 同步（不改断言语义）**：新建 `tests/confirm_sweep.js`（10 静态 + 10 静态 mutation + 12 live + 2 live mutation）；`tests/settings_dialog.js` 的 Dialog guard 计数 2→3 并同步文案与 live mutation 切片（powerOff 的 Cancel 现在在文件更前面，裸 `app.replace` 会改错目标）；`tests/hr_monitor.js` 的 gate slice/check/mutation 改 Dialog 口径；`tests/ota_consumers.js` ALLOWED 预加 `tests/confirm_sweep.js` 防 untracked 提交后转红。

**验证（原始输出见 `/tmp/r164-final-verify.txt`；宿主/编译证据，非真机）**：
- `node tests/confirm_sweep.js` → 10 静态 + 10 静态 mutation + 12 live + 2 live mutation 全绿，末行 `ALL CONFIRM SWEEP HARNESS CASES PASSED`，`CONFIRM_SWEEP_EXIT=0`。live 实证：power Cancel / mask → 0 powerOff、danger → 1 次 powerOff、无 pmic binding → `power off n/a` 且 0 动作、无 Dialog → `power off n/a (no dialog)`；BLE Cancel → 0 start/stop、idle danger → 1 startAdv、advertising danger → 1 stopAdv、无 BLE binding → `BLE n/a (no stack)` 且 0 动作、无 Dialog → `BLE n/a (no dialog)`；两处 Cancel 注入 onPress 均转红。
- `timeout 600 bash -c 'for t in tests/*.js; do node "$t" >/dev/null 2>&1 || echo FAIL "$t"; done; echo done'` → 仅 `done`，**0 FAIL**（`FULL_LOOP_EXIT=0`）；本轮未触发 wordle flake。
- `npm test --prefix tools/lume` → `# tests 50 / # pass 50 / # fail 0 / # cancelled 0 / # skipped 0`，`NPM_TEST_EXIT=0`。
- `python3 scripts/check_website.py` → `API missing: none` / `API invented: none` / `API duplicates: none` / `API signatures not found in lume.d.ts: none`。
- `node tools/lume/lume.js check examples/settings --no-emu` → `[PASS] bundle 33860 bytes` / `RESULT: PASS (4 steps, 0 failed; exit 0)`；`examples/hr_monitor --no-emu` → `[PASS] bundle 23003 bytes` / `RESULT: PASS`；哨兵 `examples/counter --no-emu` → `[PASS] bundle 2160 bytes` / `RESULT: PASS`。
- `npm run build:playground --prefix tools/lume` → `PASS bundle settings 33860 bytes` / `PASS bundle hr_monitor 23003 bytes` / `PASS esbuild-wasm assets and 61 editable sources` / `PASS prelude 67428 bytes; 61 apps`，幂等。
- **固件/runtime 零改动，未跑 `idf.py build`**：`git diff 8b46c00 HEAD -- firmware/ runtime/` 与工作树版 `git diff 8b46c00 -- firmware/ runtime/` 原始输出均为空；IRAM 16384 硬线未触碰。
- ASCII 纪律：`grep -Pn '[^\x00-\x7F]' examples/settings/app.js examples/hr_monitor/app.js tests/confirm_sweep.js` → `NONE`。

**里程碑口径**：examples/ 的两段式 confirm 信号清零、Modal 消费方增至 settings + hr_monitor + files，但组件被消费 ≠ 真机验收；真关机与 BLE 广播的真实行为、danger 配色在 CO5300 AMOLED 上的对比度、模态命中率与两段式→模态手感差异**全部 deferred，不声称真机验证**。未改 vendored（QuickJS/LVGL）、未改 `.d.ts`；未跑 codex review（主控轮负责）；未推送。磁盘紧张，最终日志只留 `/tmp/r164-final-verify.txt`。

**commits（未推送，拆分）**：feat `c3ca253`（app + playground 生成物） / test `4472867`（新 harness + 三个既有 harness 同步） / docs（本节 + KNOWN-SIMPLIFICATIONS r164 节）。

详见 docs/KNOWN-SIMPLIFICATIONS.md r164 节。

### r165 result — wordle「每日一题」：`lume.system.time()` 日序号确定性选词（纯 app 层；appended, milestone checkboxes untouched）

**开工**：`bash /home/ubuntu/.hermes/scripts/lume_model_guard.sh` → `GUARD: settings.json model=hy4flash-free ✓` / `GUARD: model=hy4flash-free ✓ (settings + runtime audit clean)`，退出码 0，无 429，未在 `/home/ubuntu/lume` 写任何文件。新 worktree `/tmp/lume-r165-wt`（分支 `r165-wordle-daily`，基线 `ca6719a`）；`tools/lume/bin/qjsc` 与 `tools/lume/node_modules` 只读软链对齐主仓、软链不入 git。

**实证先行（假设以源码为准）**：通读 `examples/wordle/app.js` 全文——旧 `wdPick(rnd)` 为 `rnd ? rnd() : Math.random()` 再 clamp；`wdNewGame(answer, rnd)` 在 :138；KV `hisc.wordle`(11)/`wordle.cur`(10) ≤15 字符；`wdEmit` 推调试串。读 `tests/wordle.js` 三部分（Part 1 裸 vm 逻辑 / Part 2 真 prelude live / Part 3 静态 + mutation）、`BASE='80e76b2'` 重钉先例、`tests/lib/prelude_runner.js:275` 的 `_systemTime: () => Date.now()` 注入点。干净基线 `node tests/wordle.js` 全绿（EXIT=0）后再动手。读 `runtime/types/lume.d.ts` r128 契约原文「a small number near zero ... treat small values as 'clock not set' on a cold boot」，确认冷启动小值诚实口径。实证 `tests/sntp.js` 把 `_systemTime: () => Date.now()` 字面量锁死在 host stub 与 `website/playground/runtime.js` browser stub 上——故不在共享 runner / stub 上动刀。

**决策（取舍见 KNOWN-SIMPLIFICATIONS r165）**：
1. 日序号口径：`wdDayIndex() = Math.floor(lume.system.time() / 86400000)`，对 `typeof !== 'number' / !isFinite` 防御回 0；`time()` 契约是 number 且不 throw。选词 `wdPick(day) = WORDS[day % WORDS.length]`（简报的 `ANSWERS` 在源码里叫 `WORDS`；300 词表不变，负数环绕）。
2. 固定时钟注入：只在 `tests/wordle.js` 内于 app eval 前注入 `lume._systemTime`（prelude 动态读该属性）；Part 1 用可写 `mockNowMs`，Part 2/3 用 `probe(clockMs)` 前缀。`tests/lib/prelude_runner.js` 与 playground stub 零改动（保留被 sntp harness 锁定的 `Date.now()` 字面量）。
3. 连胜/每日新局关系：KV 新增 `wr.day`（7 字符）记**最后一次赢的 dayIndex**；`wdNewGame` 发现 `day - wr.day >= 2` 才清零 `wordle.cur`（漏一天断连胜），同日/次日续连胜；`hisc.wordle` 永不降。
4. HUD 增 `DAY #N`（N=绝对 dayIndex，与词表长度无关，避开 `%300` 口径歧义）；`WIN IN n - TAP NEW` / `LOST - WORD - TAP NEW` 等存量文案未动。
5. 冷启动诚实：未 SNTP 时 dayIndex=0 → `WORDS[0]`='about'，UI 不伪装；真机 SNTP 后自动切真实日序号，同日内可能跳词，如实登记。

**实现（纯 app 层）**：仅 `examples/wordle/app.js` + playground 生成物（4 个 `website/playground/` 文件）。`firmware/`、`runtime/`、`.d.ts`、vendored、`tools/`、`examples/wordring` 零改动；未跑 `idf.py build`。

**harness 同步（不改断言语义）**：`tests/wordle.js` 增 2 条逻辑（日序号/确定性选词含冷启动 0 + 连胜跨日 gap）、1 条 live（同钟两次同词 / +1 日换词 / `DAY #N` 随钟推进）、4 条静态 + 4 条 mutation（random 回退、时钟改 0、KV_DAY 超长、HUD 丢 DAY 全部转红）；BASE 从 `80e76b2` 重钉到本轮 feat `6dddec1`，零 diff / allowlist 语义完全保留（未自比较、未删守卫）。

**验证（原始输出见 `/tmp/r165-final-verify.txt`；宿主/编译证据，非真机）**：
- `node tests/wordle.js` → 16 逻辑 + 7 live + 14 静态 + 14 mutation 全绿（52 条 PASS 行，smoke 双行打印），末行 `ALL WORDLE HARNESS CASES PASSED`，`WORDLE_EXIT=0`。live 实证：注入固定钟两次 `wdNewGame` 同词，钟推进 86400000 ms 后换词且 `DAY #N` 同步推进。
- `timeout 600 bash -c 'for t in tests/*.js; do node "$t" >/dev/null 2>&1 || echo FAIL "$t"; done; echo done'` → 仅 `done`，**0 FAIL**（`FULL_LOOP_EXIT=0`）；本轮未触发 wordle 存量 flake。
- `npm test --prefix tools/lume` → `# tests 50 / # pass 50 / # fail 0 / # cancelled 0 / # skipped 0`，`NPM_TEST_EXIT=0`。
- `python3 scripts/check_website.py` → `API missing: none` / `API invented: none` / `API duplicates: none` / `API signatures not found in lume.d.ts: none`，`WEBSITE_EXIT=0`。
- `node tools/lume/lume.js check examples/wordle --no-emu` → `[PASS] bundle 29867 bytes` / `RESULT: PASS (4 steps, 0 failed; exit 0)`；哨兵 `examples/counter --no-emu` → `[PASS] bundle 2160 bytes` / `RESULT: PASS`。
- `npm run build:playground --prefix tools/lume` → `PASS bundle wordle 29867 bytes` / `PASS esbuild-wasm assets and 61 editable sources` / `PASS prelude 67428 bytes; 61 apps`；二次构建后 `git status --short` 空（幂等）。
- **固件/runtime/tools 零改动，未跑 `idf.py build`**：`git diff ca6719a HEAD -- firmware/ runtime/ tools/` 与工作树版 `git diff ca6719a -- firmware/ runtime/ tools/` 原始输出均为空。
- ASCII 纪律：`grep -Pn '[^\x00-\x7F]' examples/wordle/app.js` → NONE。

**里程碑口径**：P2 wordle 行的「每日一题」blocker（无 RTC→无墙钟）由 r128 `lume.system.time()` 解除，本刀落地 app 层日序号机制；但真机输入手感、圆屏安全区、每日一题真机验收（冷启动未 SNTP 的 dayIndex=0、校时跳词、跨日 KV 持久化）与 HTML 完整词表仍 deferred，**本行仍不标完成**，不声称真机验证。未改 vendored（QuickJS/LVGL）、未跑 codex review（主控轮负责）、未推送。磁盘紧张，最终日志只留 `/tmp/r165-final-verify.txt`。

**commits（未推送，拆分）**：feat `6dddec1`（app + playground 生成物） / test `674d461`（harness + BASE 重钉） / docs（本节 + KNOWN-SIMPLIFICATIONS r165 节）。

详见 docs/KNOWN-SIMPLIFICATIONS.md r165 节。

### r167 result — color_demo 注册进 playground（62 apps）+ manifest 断言级联（纯工具清单层；appended, milestone checkboxes untouched）

**开工**：`bash /home/ubuntu/.hermes/scripts/lume_model_guard.sh` → `GUARD: settings.json model=hy4flash-free ✓` / `GUARD: model=hy4flash-free ✓ (settings + runtime audit clean)`，退出码 0，无 429，未在 `/home/ubuntu/lume` 写任何文件。新 worktree `/tmp/lume-r167-wt`（分支 `r167-colorpicker-playground`，基线 `2b9a72f`）；`tools/lume/bin/qjsc` 与 `tools/lume/node_modules` 只读软链对齐主仓、软链不入 git。

**实证先行（以源码为准，不照抄简报数字）**：
1. `grep -n "const apps" tools/playground/build.mjs` → :10 硬编码列表；node 解析当前 61 app，末尾 `'minigolf', 'ipod_music'`。
2. `grep -rn "=== 61\|apps.length, 61" tests/*.js` → 17 处数值断言（12 处 `list.length === 61` + 5 处 `assert.equal(apps.length, 61, ...)`，含 `tests/wordle.js:586`）；另 4 处文本标签「61-app playground manifest」按 r161 先例刻意不动。
3. `git show caa12f2`（r161 的 59→61 cascade）完整 diff：只改数字、保留文本标签、needle 精确追加、ALLOWED 预加生成物路径、无 BASE 重钉。
4. `tests/sd_files.js:200` 的 manifest-mutation needle 原文含 `'minigolf', 'ipod_music'];`。
5. `grep -rn "gitChanged" tests/*.js | grep "tools/playground"` → NONE：**无任何 harness 的零 diff 守卫范围含 `tools/playground/`**（全为 `firmware/`、`runtime/`、`tools/lume/`），故 build.mjs 不触发转红，无需按 r162/r165 先例重钉 BASE；`gitChanged([])` allChanged 守卫仅 `tests/ota_consumers.js` 一处。
6. `git diff 2b9a72f HEAD -- firmware/ runtime/ tools/lume/` 与工作树版 `git diff 2b9a72f -- firmware/ runtime/ tools/lume/` 原始输出均为空（基线空）。

**实现（纯工具清单层）**：`tools/playground/build.mjs` apps 列表末尾追加 `'color_demo'`（列表其余内容逐字不动），重建生成 62 apps：新增 `website/playground/apps/color_demo.js`（24207 bytes）+ `website/playground/sources/color_demo.js`，`sources.js` 加键；`apps/wordle.js` 因 esbuild 压缩变量名漂移再生成（r165 版本与当前工具链输出功能等价，无 harness 锁定 `apps/` bundle 字节，已在 ALLOWED）。`firmware/`、`runtime/`、`runtime/types/lume.d.ts`、vendored、`examples/color_demo/app.js` 零改动；未跑 `idf.py build`。

**断言级联（不改断言语义）**：17 处数值断言 61→62，文本标签不动；`tests/sd_files.js` needle 精确追加 `'color_demo'` 后删列表 mutation 仍转红；`tests/ota_consumers.js` ALLOWED 预加两个未跟踪生成物路径（git diff 看不见 untracked，提交后转红）。无 BASE 重钉、无守卫删除或放宽。`tests/colorpicker.js` / `tests/color_demo.js` 无 app 数量断言，无需同步。

**验证（原始输出见 `/tmp/r167-final-verify.txt`；宿主/编译证据，非真机）**：
- `npm run build:playground --prefix tools/lume` → `PASS bundle color_demo 24207 bytes` / `PASS esbuild-wasm assets and 62 editable sources` / `PASS prelude 67428 bytes; 62 apps`；二次构建及提交后重建的 `git status --short` 均为空（幂等）。
- `node tests/colorpicker.js` → `ALL COLORPICKER CASES PASSED`，`COLORPICKER_EXIT=0`；`node tests/color_demo.js` → `ALL COLOR_DEMO CASES PASSED`，`COLOR_DEMO_EXIT=0`。
- `timeout 600 bash -c 'for t in tests/*.js; do node "$t" >/dev/null 2>&1 || echo FAIL "$t"; done; echo done'` → 仅 `done`，**0 FAIL**（98 个 harness）；本轮未触发 wordle 存量 flake。
- `npm test --prefix tools/lume` → `# tests 50 / # pass 50 / # fail 0 / # cancelled 0 / # skipped 0`（基线同值；简报所述 skipped 1 为过期口径，无回归），`NPM_TEST_EXIT=0`。
- `python3 scripts/check_website.py` → 161 entries，`API missing/invented/duplicates/signatures not found in lume.d.ts` 均 none。
- `node tools/lume/lume.js check examples/color_demo --no-emu` → `[PASS] bundle 24207 bytes` / `RESULT: PASS (4 steps, 0 failed; exit 0)`；哨兵 `examples/counter --no-emu` → `RESULT: PASS`。
- **固件/runtime 零改动，未跑 `idf.py build`**：`git diff 2b9a72f HEAD -- firmware/ runtime/` 与工作树版 `git diff 2b9a72f -- firmware/ runtime/` 原始输出均为空。
- ASCII 纪律：`grep -Pn '[^\x00-\x7F]' tools/playground/build.mjs` → `NONE`。

**里程碑口径与取舍**：M5 gallery 行不动——`website/examples.html` 是策展型七卡结构，本轮刻意不改画廊（color_demo 只在 playground 清单中可编辑/预览，不新增策展卡），checkbox 不动。playground 是浏览器 stub，`lume check --no-emu` 只做 esbuild bundle（不跑 eval/layout/perf）；ColorPicker 色环手感、S/V 滑条精度、hex 展示与 KV 恢复的真机行为**全部 deferred，不声称真机验证**。未改 vendored（QuickJS/LVGL）、未改 `.d.ts`；未跑 codex review（主控轮负责）；未推送。磁盘 `/` 紧张，artifacts 只留 `/tmp/r167-final-verify.txt`，worktree 重建后 git 状态干净。

**commits（未推送，拆分）**：feat `3e54f4c`（build.mjs + 生成物） / test `fe57938`（17 断言 + needle + ALLOWED） / docs（本节 + KNOWN-SIMPLIFICATIONS r167 节）。

详见 docs/KNOWN-SIMPLIFICATIONS.md r167 节。

### r212 result — 渲染性能审计 + Canvas 热点 app 层优化（纯 app 层；appended, milestone checkboxes untouched）

**实证先行（任务 A，全量 54 Canvas app 测量表）**：基于 `tests/lib/prelude_runner.js`（与 `tests/skycombat.js` 同口径 `draws()` 计数）完成全仓 54 个 Canvas app 的 boot / 动画或交互 / idle 三口径普查（原始 JSON `artifacts/r212/audit-full.json`，全表见 `docs/r212-report.md`）。按数据驱动条款（`<=240` 且 `idle == 0` 即判达标不硬改），33 个非 OPT app（含 `speedometer`/`spectrum`/`spectrum_music`/`plasma`/`mochi`/`clock`/`weather`/`music_player`/`scroller`/`vec_demo` 等）及 11 个既有 OPT app 均已达标未动；明确检出 **TOP 5 热点**（均客观突破 `<=240` 或 `idle == 0` 红线）：`invaders`（901/帧 + paused 880）、`frogger`（315/帧 + over 300）、`sokoban`（boot 2774 / move 1388）、`minesweeper`（boot 602 / dig 371）、`skyfire`（over 态 33ms 持续 43 draw/帧整屏重绘）。

**app 层优化（任务 B，纯 app 层，`firmware/`/`runtime/`/`prelude_runner.js`/vendored 零改动）**：
- `invaders`：8 精灵一次预烘 RGB565 + `retainImage(1..8)` + `drawImage` + `paused`/`over` 0 绘制门控。boot `877 -> 2` draws（58 total ops），active `901 -> 3` draws（59 total ops），paused/over `880 -> 0`；宿主 RGB565 diff = **0/230,400 px**。
- `frogger`：8 精灵一次 `retainImage(1..8)` + `drawImage` + 左右安全边距遮罩 + `over` 0 绘制门控。boot `347 -> 21` draws（53 total ops），active `315 -> 16` draws（48 total ops），over `300 -> 0`；宿主棋盘区内 diff = **0 px**。
- `sokoban`：6 精灵 `retainImage(1..6)` + 省略墙下不透明 `floor` + 紧缩脏区 + 去 boot 重复绘。boot `2,774 -> 1` draw（81 total ops），move `1,388 -> 2` draws（82 total ops），idle = `0`；宿主 RGB565 diff = **0/230,400 px**。
- `minesweeper`：8 瓦片（hidden/flagged/rev0/mine/boom/rev1..3）`retainImage(1..8)` + 增量脏格（`prevSnap`，1-8 格逐格脏区、>8 格合并单脏区）+ 去 boot 重复绘。boot `602 -> 1` draw（101 total ops），flag `309 -> 0` draw（1 op），dig `371 -> 0` draw（22-50 ops），idle = `0`；宿主 RGB565 diff = **0/230,400 px**。
- `skyfire`：照抄 `skycombat` r177 纪律加 `SF_IDLE_DT=100` + `sfSchedule()` + `sfOverPainted`，over 态 10 tick 0 绘制且周期 `33 -> 100ms`，restart 恢复 `33ms`（active max 70/240 不变）。

**esp32sim 指令数 A/B（任务 C，同 `lume.bin` 固件、固定 8.000s / 1.92G cycles，`RELOAD_ERR=0`）**：
- `counter` 冒烟：`core0 154,053,792 + core1 59,024,748`（`eval_ok=2`）。
- `invaders`：`core0 384.5M -> 252.8M (-34.3%)`，**`core1 1,046.3M -> 307.1M (-70.7%)`**，**总指令 `-60.9%`**（-870.9M insns）。
- `frogger`：`core0 345.5M -> 278.3M (-19.4%)`，**`core1 480.6M -> 129.2M (-73.1%)`**，**总指令 `-50.7%`**（-418.5M insns）。
- `sokoban`：`core0 170.4M -> 155.8M (-8.5%)`，**`core1 130.8M -> 71.4M (-45.4%)`**，**总指令 `-24.5%`**，eval `326ms -> 77ms`；**真固件 TFT PNG diff = 0/230,400 px（bit-identical）**。
- `minesweeper`：`core0 151.7M -> 146.6M (-3.3%)`，`core1 78.5M -> 74.8M (-4.8%)`，总指令 `-3.8%`；**真固件 TFT PNG diff = 0/230,400 px（bit-identical）**。

**验证（全部宿主机 / esp32sim 证据，非真机；原始日志 `artifacts/r212/`）**：5 份更新 harness 全绿（新增 `<=240` 与 10-tick idle 0 绘制断言）；全量回归 `TOTAL_JS=111 FAIL_JS=0`；`npm test --prefix tools/lume` 76 pass / 0 fail；`node tools/playground/build.mjs` 74 apps 重建通过；Playwright `tools/playground/verify.mjs` 全 PASS（含 `all examples load without runtime errors`）；`check_website.py` 四类 none；`firmware/`/`runtime/`/`prelude_runner.js` diff 为空；未跑 `idf.py build`；新增字面量全 ASCII；未 push。真机帧率、触控手感、PSRAM 峰值与 AMOLED 实拍全部 deferred，不声称真机验收。详见 `docs/r212-report.md` 与 `docs/KNOWN-SIMPLIFICATIONS.md` r212 节。

### r224 result — rendering backlog #3: speedometer 色带迁原生 Arc widget（host + esp32sim，无真机验收）

Closes the last item of the rendering backlog on the host/simulator. Only
`examples/speedometer/app.js` changed (+3 generated playground files to keep the
byte-identical invariant); **firmware C, bridge ABI, prelude, `.d.ts` and test
predicates are untouched**. The three colour bands become three stacked native
LVGL `Arc` widgets with `track: DIAL_BG` (hides the default track because
`ATTR_ARC_TRACK` only recolours it), `thickness: 5`, `value: 100`; Canvas keeps
background/ticks/needle and its dirty-rect strategy.

- **Assumption check** (`artifacts/r224/arc-bridge-evidence.txt`): default track
  is width 8 / `0x1B3145` and `ATTR_ARC_TRACK` cannot hide it; arcs are
  `LV_OBJ_FLAG_CLICKABLE`-free so stacking does not block touches. A first emu
  capture exposed a 2 px inward shift: this LVGL draws the stroke *inside*
  `radius` (`area_in = bbox - width`), so a 320 px widget (R=160) + thickness 5
  lands the ring on r=156..160, matching the old `ctx.arc(r=158, width=5)`.
- **emu A/B** (`artifacts/r224/speedo-before.png` -> `speedo-after.png`, same
  firmware, 8 s deterministic): band geometry identical (top y=82..86, left
  x=80..84, diagonal r=156..160); seams at 260°/343° have no gaps; needle/ticks/
  labels present. Edge colour steps (r47 methodology): axis-aligned edges 2
  colours both; diagonal 2 transition colours both; 270-angle aggregate mean
  2.422 -> 2.269 blended colours/angle. Before is already r48 AA `ctx.arc`, so
  this is AA-vs-AA — **no image-quality claim, equivalence only**. 3177 changed pixels,
  all inside the dial bbox; r<130 changes are demo-needle phase only.
- **Verification** (raw output in `artifacts/r224/`): `idf.py build && idf.py
  size` `BUILD_SIZE_EXIT=0` with **+0 B** vs r223 on Flash Code (2,045,024),
  Flash Data (853,348), DIRAM (247,159), IRAM (16,384/16,384, Remain 0), Total
  (3,039,627); 112 `tests/*.js` harnesses 0 FAIL; `npm test --prefix tools/lume`
  87 tests / 86 pass / 0 fail / 1 skipped; `bridge_protocol.c` +
  `apps_protocol.c` (52 checks, 0 failure); `lume check examples/speedometer
  --no-emu` PASS; `ADDED_NON_ASCII=0`.
- **Not on-device acceptance**: host/esp32sim evidence only. AMOLED colour,
  touch, frame time, sleep current and radio remain deferred to board bring-up.
  Full record: `docs/r224-report.md`, `docs/KNOWN-SIMPLIFICATIONS.md` (r224).

### r227 result — 466×466 圆屏自适应迁移第一批（29/29 崩溃 app 收口，纯 app 层，无真机验收）

Closes the r226 §2.2 prerequisite: all 29 apps that crashed under a native
466×466 `__lumeScreen` now load and tick. Implemented as an inlined per-app
adaptive shim (identity at 480, proportional `SW/480` / `SH/480` scale at 466)
across 13 `'round'` flagships (incl. `watchface`'s PSRAM budget) and 16 square
games. `firmware/`, `runtime/`, `tools/lume/`, the prelude and vendored sources
are untouched; no `idf.py build`.

- **Audit**: 466 before `ok=45 fail=29` (exact r226 reproduction) -> after
  `ok=74 fail=0`; 480 stays `ok=74 fail=0`. Raw logs `artifacts/r227/audit-466*.log`
  and `audit-480.log`.
- **480 regression**: all 29 changed apps have byte-identical native message
  streams before/after (frozen wall clock), `TOTAL=29 IDENTICAL=29 DIFFERENT=0`
  (`artifacts/r227/stream-equivalence-480.txt`), including 5 sampled games
  (`invaders`, `frogger`, `sokoban`, `mario`, `flapdot`). No esp32sim/host RGB565
  rasterizer available, so stream identity is the stated equivalence evidence.
- **watchface**: 466 canvas budget `861,208/868,624 B`; harness gained a new 466
  assertion while keeping the original 480 `228544 px` assertion unchanged.
- **Verification**: full `tests/*.js` loop 0 FAIL; `npm test --prefix tools/lume`
  87 pass / 0 fail; `npm run build:playground` PASS and idempotent on second
  build; `lume check examples/counter --no-emu` PASS; `check_website.py` four
  `none`; 0 added non-ASCII lines (37 pre-existing unchanged).
- **Not on-device acceptance**: 466 CO5300 round visuals, touch, frame time,
  PSRAM peak and double-buffer behaviour remain deferred to board bring-up.
  Full record: `docs/r227-report.md`, `docs/KNOWN-SIMPLIFICATIONS.md` (r227).
