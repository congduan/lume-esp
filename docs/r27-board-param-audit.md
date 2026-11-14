# r27 — Board-parameter audit (research, pre-change)

Empirical inventory of every Waveshare-ESP32-S3-Touch-AMOLED-2.16-specific
value hardcoded in the firmware, taken at HEAD `eb1345f`. This is the research
deliverable for r27 task 1; it is committed **before** any code change so the
"one place to change" refactor has a fixed reference.

## Correction to the r27 brief (verified against the tree)

- The brief says the pin map is `firmware/main/lume_pins.h`. **It is not.**
  `firmware/main/` contains only `CMakeLists.txt`, `lume_main.c` and
  `include/lume.h` (no pin definitions). The real header is
  `firmware/components/lume-board/include/lume_pins.h`, exported through the
  `lume-board` component's `INCLUDE_DIRS "include"`.
- Display/touch/PMIC init already read `LUME_PIN_*` / `LUME_LCD_*` from that
  header; the header is the *de facto* current board profile. r27 moves it
  under `firmware/boards/<board>/` and adds the remaining free-floating values
  (I2C addresses, QSPI timing, CO5300 init table, `480` literals) to it.

## A. Pin map and display geometry — `firmware/components/lume-board/include/lume_pins.h`

| Line | Macro | Value |
|---|---|---|
| 26 | `LUME_PIN_I2C_SCL` | 14 |
| 27 | `LUME_PIN_I2C_SDA` | 15 |
| 30 | `LUME_PIN_LCD_SCLK` | 38 |
| 31-34 | `LUME_PIN_LCD_DATA0..3` | 4, 5, 6, 7 |
| 35 | `LUME_PIN_LCD_CS` | 12 |
| 36 | `LUME_PIN_LCD_RST` | 39 |
| 38 | `LUME_PIN_TP_RST` | 40 |
| 39 | `LUME_PIN_TP_INT` | 11 |
| 41 | `LUME_PIN_I2S_MCLK` | 42 |
| 42 | `LUME_PIN_I2S_SCLK` | 9 |
| 43 | `LUME_PIN_I2S_LRCK` | 45 |
| 44 | `LUME_PIN_I2S_DOUT` | 8 |
| 45 | `LUME_PIN_I2S_DIN` | 10 |
| 46 | `LUME_PIN_AUDIO_PA` | 46 |
| 48 | `LUME_LCD_H_RES` | 480 |
| 49 | `LUME_LCD_V_RES` | 480 |
| 50 | `LUME_LCD_BPP` | 16 |

Header comment (lines 21-23) also records the shared-I2C device set:
CST9220 `0x5A`, AXP2101 `0x34`, QMI8658, ES8311, PCF85063; and the audio pin
grouping. Line 52 declares `lume_board_init()`.

## B. CO5300 QSPI display bring-up — `firmware/components/lume-board/lume_display.c`

- 43-45: `LCD_H_RES/V_RES/BPP` aliases of `LUME_LCD_*` (already profile-sourced).
- 46: `LCD_SPI_HOST` = `SPI2_HOST` (QSPI host).
- 47: `LCD_PCLK_HZ` = `40 * 1000 * 1000` (40 MHz QSPI clock).
- 48: `DRAW_BUF_LINES` = 50 (PSRAM draw-buffer height).
- 51-52: QSPI opcodes `0x02` (write cmd), `0x32` (write color).
- 55-57: MIPI DCS regs `0x2A`/`0x2B`/`0x2C`.
- 60-63: `qspi_cmd()` 32-bit command word `(opcode<<24)|(reg<<8)`.
- 73-89: **CO5300 vendor init command table** `s_init_cmds[]` — notably
  line 85/86 CASET/RASET `0x00,0x00,0x01,0xDF` (= 0..479, resolution-derived),
  line 80 `0x3A=0x55` (RGB565), line 83 `0x51=0xFF` (brightness),
  line 87 `0x36=0xA0` (MADCTL orientation), lines 74/88 600 ms delays.
- 118-132: `rounder_event_cb` CO5300 2-pixel-window quirk.
- 156-161: RGB565 big-endian byte swap on flush.
- 190-196: `spi_bus_config_t` pin refs + `max_transfer_sz`.
- 203-216: `esp_lcd_panel_io_spi_config_t` — `trans_queue_depth = 3`,
  `lcd_cmd_bits = 32`, `lcd_param_bits = 8`, `quad_mode = true`, `pclk_hz`.
- 226-234: hardware reset timing 10 ms low / 150 ms high.
- 259: `lv_display_create(LCD_H_RES, LCD_V_RES)` = 480x480.
- 265-275: PSRAM draw buffers, `LV_DISPLAY_RENDER_MODE_PARTIAL`.

## C. CST9220 touch — `firmware/components/lume-board/lume_touch.c`

- 40: `TP_I2C_ADDR` = `0x5A` (touch I2C address).
- 41: `TP_I2C_TIMEOUT_MS` = 200.
- 43-47: chip regs `0xD000`, `0xD101`, `0xD1FC`, `0xD1F8`, `0xD204`.
- 49-52: `TP_ACK 0xAB`, `TP_FRAME_LEN 10`, `TP_STATUS_PRESS 0x06`,
  `TP_LOG_INTERVAL_MS 500`.
- 178-186: **orientation transform** (`mirror_y` + `swap_xy`, BSP:566-569)
  using `LUME_LCD_V_RES`/`LUME_LCD_H_RES`.
- 216-218: `i2c_device_config_t` addr `0x5A` @ 400 kHz.
- 226: `LUME_PIN_TP_INT` input config.
- 239-240: log line prints `0x5A` and INT pin.

## D. AXP2101 PMIC rails — `firmware/components/lume-board/lume_pmic.c`

- 32: `AXP2101_I2C_ADDR` = `0x34`.
- 33-38: regs `0x03`/`0x90`/`0x94`/`0x96`/`0x97`, chip id `0x4A`.
- 41: `RAIL_3300MV_STEP` = `0x1C`.
- 110-111: rail enable bits ALDO3=2, BLDO1=4, BLDO2=5.

## E. AXP2101 telemetry PMIC (separate component) — `firmware/components/lume-pmic/lume_pmic_hw.c`

- 90: `AXP_I2C_ADDR` = `0x34` (used line 241; log literals `0x34` at 247,
  `0x4A` expected at 260).

## F. Audio codecs — `firmware/components/lume-audio/lume_audio.c`

- 13: `ES8311` = `0x18` (DAC I2C address); 14: `ES7210` = `0x40` (ADC).
- 57-91: ES8311/ES7210 vendor register init sequences (board-specific codec
  wiring, cleaned from Waveshare 06_ES7210 / 07_ES8311 examples).
- 108-109: I2C config @ 100 kHz.
- 119-141: I2S channel config referencing `LUME_PIN_I2S_*` (MCLK/BCLK/WS/DOUT/DIN),
  16 kHz / 16-bit / Philips stereo.
- 143-145: `LUME_PIN_AUDIO_PA` PA enable (log string hardcodes `GPIO46`).

## G. QMI8658 IMU — `firmware/components/lume-imu/lume_imu_hw.c`

- 101: `QMI_I2C_ADDR` = `0x6B` (used 199; log literal `0x6B` at 227).
- 73-76 (comment): schematic routes `QMI_INT1`=GPIO17 / `QMI_INT2`=GPIO21 but
  `lume_pins.h` defines none; polled-only. Chip registers are chip-level, not
  board-wiring, but the address is a board-level constant.

## H. Board init / shared I2C bus — `firmware/components/lume-board/lume_board.c`

- 133-143: `i2c_master_bus_config_t` — SDA/SCL via macros, `glitch_ignore_cnt=7`,
  internal pullups. Comment line 5 hardcodes `15/14`.
- 169: LVGL task stack 8192 (app-level, not board).

## I. Sleep/wake touch pin — `firmware/components/lume-power/lume_power.c`

- 19-20, 35, 38: `LUME_PIN_TP_INT` used for `ext0` wakeup (active-low).

## J. Free-floating resolution literals (NOT referencing the pin header)

These are the `480` values the r27 `git grep` gate targets — they are screen
geometry expressed as bare constants in unrelated components:

- `firmware/components/lume-ui-bridge/lume_ui_bridge.c:43`
  `#define CANVAS_BUDGET (480u * 480u * 2u)`; `:297` `w > 480 || h > 480`.
- `firmware/components/lume-engine/lume_engine.c:254-256` `canvas_w > 480`,
  `canvas_h > 480`, `480u*480u*2u`, error string `"480x480"`.
- `firmware/components/lume-engine/lume_image_header.c:38`
  `width > 480 || height > 480`.

## K. sdkconfig-level board values — `firmware/sdkconfig.defaults`

- 5: `CONFIG_IDF_TARGET="esp32s3"`.
- 8-10: 16 MB flash, QIO, 80 MHz.
- 13-20: 8 MB Octal PSRAM @ 80 M, XIP + rodata in PSRAM, internal-malloc
  thresholds 4096/4096.
- 23: `CONFIG_FREERTOS_HZ=1000`.
- 26: `CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG=y` (USB CDC console on this board).
- 29: `CONFIG_LUME_OTA_PORT=8765` (r26 project-level, NOT board).
- 32-33: `CONFIG_PARTITION_TABLE_CUSTOM=y`, filename `partitions.csv`.
- 36: `CONFIG_LV_COLOR_DEPTH_16=y` (16 bpp; note this is an *unknown kconfig
  symbol* warning at build — the effective color depth comes from `lv_conf.h`).
- 39-40: FATFS LFN (project-level).
- 49-50: WiFi IRAM mitigation (r11 — tied to the IRAM-full constraint, not a
  board param, keep common).
- 58-61: BLE NimBLE (r25 project-level feature, keep common).

Generated `firmware/sdkconfig` (tracked) mirrors these values.

## L. Partition table — `firmware/partitions.csv`

- 4: `factory` app @ `0x10000`, size `0x640000`.
- 5: `storage` littlefs @ `0x750000`, size `0x100000`.
(16 MB flash layout.)

## M. LVGL config — `firmware/components/lvgl/lv_conf.h`

- 6: `LV_COLOR_DEPTH 16` (matches the RGB565 QSPI framebuffer).
- 1: comment references 480x480.

## N. Existing Kconfig mechanism

- `firmware/components/lume-hotreload/Kconfig.projbuild`: sole
  `Kconfig.projbuild` in the tree; declares `config LUME_OTA_PORT`. This is the
  established native pattern r27 follows for `choice LUME_BOARD`.

## Scope decision for the r27 "first cut"

Converge into `firmware/boards/waveshare_esp32_s3_touch_amoled_2_16/`:

1. **All C compile-time constants** from A–H and J (pins, geometry, I2C
   addresses, QSPI host/clock/draw-buffer/opcodes/DCS regs/reset timings,
   CO5300 init table, touch orientation + address, codec/PMIC/IMU addresses).
   `lume_pins.h` becomes a shim; every C file references the profile.
2. **Board-specific sdkconfig values** from K (flash/PSRAM/console/partition/
   LVGL color) as a board `sdkconfig.defaults` fragment, selected alongside the
   common defaults via the ESP-IDF v5.5.5 `SDKCONFIG_DEFAULTS` list mechanism
   (verified: `tools/cmake/project.cmake:680-686`).
3. **Partition table** L as `boards/<board>/partitions.csv`.

Kept common / project-level (documented, not moved): `CONFIG_IDF_TARGET`,
FreeRTOS tick, OTA port, FATFS, WiFi IRAM mitigation, BLE — none are
board-geometry/pin values and moving them would needlessly churn the
IRAM-full baseline config.

Mechanism (verified against installed ESP-IDF v5.5.5):
- `choice LUME_BOARD` in a `Kconfig.projbuild` (menuconfig-visible);
- `CONFIG_LUME_BOARD_DIR` string derived from the choice, consumed by the
  `lume-board` component's `INCLUDE_DIRS` (component.cmake:319 resolves
  `${CMAKE_SOURCE_DIR}/...` absolute paths);
- `SDKCONFIG_DEFAULTS` defaults list in the top-level `CMakeLists.txt`, so a
  plain `idf.py build` still selects Waveshare; `-DSDKCONFIG_DEFAULTS=...`
  selects another board (documented in `firmware/boards/README.md`).

Real second board, runtime hot-switch, and multi-board CI matrix are explicitly
out of scope (see `docs/KNOWN-SIMPLIFICATIONS.md` r27 entry).
