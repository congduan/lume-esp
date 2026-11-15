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
