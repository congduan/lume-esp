# Lume board profiles (r27 first cut)

A **board profile** is the single place that answers "what do I change to build
Lume for a different board?". Everything board-specific — pin map, display
geometry, QSPI timing, the panel init command table, I2C device addresses,
sdkconfig values and the partition table — lives in one directory here.

This is a **compile-time, single-board-at-a-time abstraction**. There is no
runtime board switching. r44 added a second profile (Waveshare
ESP32-S3-Touch-AMOLED-1.8) as the first real use of the six-step flow below;
r86 adds the 1.75C profile. All profiles are compile-time parameter sets; none has on-device
acceptance. See `docs/KNOWN-SIMPLIFICATIONS.md` (r27 / r31 / r44 entries) and
`docs/r27-board-param-audit.md`. The default board is still the 2.16 profile.

### r45 status (driver-level gap closure, still no on-device acceptance)

r45 closed the three known driver-level gaps for the 1.8 V2 profile. All of it
is behind compile-time profile macros; the default 2.16 board is unchanged
(`idf.py size` byte-for-byte identical to the b66bebc baseline).

- **Touch**: `lume_touch.c` now selects the touch protocol by `LUME_TOUCH_CHIP`
  — 2.16 = `LUME_TOUCH_CHIP_CST9220` (16-bit registers / 10-byte frame,
  verbatim), 1.8 = `LUME_TOUCH_CHIP_CST816S` (8-bit registers / 6-byte frame
  @ 0x15). Registers verified against `espressif/esp_lcd_touch_cst816s`
  v1.1.1~1 (`DATA_START_REG 0x02`, `CHIP_ID_REG 0xA7`; CST820 id 0xB7), the
  Waveshare SensorLib `TouchDrvCST816` driver and the esp32sim Cst820 model.
  Note 0x15 is the I2C slave address, **not** a chip-ID register.
- **Reset**: 1.8 LCD/touch/power resets are on the TCA9554 IO expander @ 0x20
  (`LUME_HAS_IO_EXPANDER_RESET`), not ESP GPIOs (BSP `BSP_LCD_RST` /
  `BSP_LCD_TOUCH_RST = GPIO_NUM_NC`). Bit map — REG_OUTPUT 0x01 / REG_CONFIG
  0x03, LCD_RST BIT(0) / DSI_PWR_EN BIT(1) / TOUCH_RST BIT(2) / SD_CS BIT(7) —
  and the 20/150 ms sequence come from the official Waveshare ESP-IDF demos
  `90_axp2101_pmu` / `92_qmi8658_imu` `board_variant.c`. Default 2.16 keeps
  direct-GPIO reset.
- **Panel gap**: `flush_cb` adds `LUME_LCD_COLUMN_OFFSET` (1.8 = 16, 2.16 = 0)
  to the CASET column coordinates. `esp_lcd_panel_set_gap()` is not applicable:
  Lume drives `esp_lcd_panel_io` directly (self-drawn CASET/RASET/RAMWR, no
  `esp_lcd_panel_handle_t`). Confirmed 0x10 from BSP
  `BSP_LCD_CST816S_X_GAP`, the colorbar demo `V2_PANEL_X_GAP` and esp32sim
  `X_OFFSET=16`.

Both boards build green on the host, host harnesses / CLI tests pass, and the
1.8 build was checked to genuinely use the `1_8` profile (sdkconfig.h,
`flags.make`, `.d` deps and compiled strings). **This is compile-time /
simulator / vendor-source evidence only — the 1.8 board has still NOT been
powered on**: lighting, color, touch orientation, gap, reset timing, audio,
sleep current, radio, persistence and bundle push remain deferred. SDMMC (TF
card), absent ES7210 and runtime board switching stay open gaps. See
`docs/KNOWN-SIMPLIFICATIONS.md` (r45 entry).

## Layout

```
firmware/boards/
  README.md                                  <- this file
  waveshare_esp32_s3_touch_amoled_2_16/       <- default board
    lume_board_profile.h                     <- all C compile-time constants
    sdkconfig.defaults                       <- board-specific CONFIG_* values
    partitions.csv                           <- board flash layout
  waveshare_esp32_s3_touch_amoled_1_8/         <- r44: second compile-time profile
    lume_board_profile.h
    sdkconfig.defaults
    partitions.csv
  waveshare_esp32_s3_touch_amoled_1_75c/       <- r86: 466x466 round AMOLED
    lume_board_profile.h
    sdkconfig.defaults
    partitions.csv
```

`lume_board_profile.h` is re-exported to the whole firmware by
`firmware/components/lume-board/include/lume_pins.h` (a one-line shim). No `.c`
file should hardcode a pin, a resolution, an I2C address or a panel command
again — include `lume_pins.h` and use the `LUME_*` macros.

## Waveshare ESP32-S3-Touch-AMOLED-1.75C (r86)

The third compile-time profile targets the 466×466 CO5300 panel, CST9217
touch controller, 32 MB flash and 8 MB PSRAM. The LCD reset is GPIO1, touch
reset is GPIO2 and audio MCLK is GPIO16. Unlike the 1.8 profile, this board
uses direct GPIO resets with no IO expander. It has no TF slot, so the profile
defines no `LUME_PIN_SD_*` pins; SD-backed MP3/file calls return the existing
`-2` unavailable result. The CST9217 reuses the CST92xx touch path because
that path has no hard chip-ID check. The r86 review fix aligned the panel init
sequence, the 6-column CASET offset (`00 06 01 D7`) and the `mirror_x/mirror_y`
touch mapping with the vendor 1.75C BSP. These are compile-time/vendor-source
facts, not on-device measurements: first light-up, column offset, touch
orientation and feel, PMIC rails and audio remain pending board bring-up.
See `docs/r86-amoled-175c-report.md` and `docs/r109-round16-report.md` (the
latter records the freestanding static assertions that lock these macros).

## How the selection works (ESP-IDF v5.5.5 native mechanisms)

1. `firmware/components/lume-board/Kconfig.projbuild` declares the
   `choice LUME_BOARD` (menuconfig-visible) and a hidden derived
   `config LUME_BOARD_DIR` (string).
2. `firmware/components/lume-board/CMakeLists.txt` adds
   `${CMAKE_SOURCE_DIR}/boards/${CONFIG_LUME_BOARD_DIR}` to the component's
   public `INCLUDE_DIRS`, so `lume_board_profile.h` from the selected board is
   the one every component sees. (Verified: `CONFIG_*` are available as CMake
   variables at component-registration time, and `INCLUDE_DIRS` accepts
   absolute paths — `tools/cmake/build.cmake:451`, `component.cmake:319`.)
3. `firmware/CMakeLists.txt` sets `SDKCONFIG_DEFAULTS` to a **list**:
   `firmware/sdkconfig.defaults` (common, board-independent) followed by the
   selected board's `sdkconfig.defaults`. `project.cmake:680-686` merges the
   list in order. A plain `idf.py build` therefore selects Waveshare.
4. Each board's `sdkconfig.defaults` sets `CONFIG_LUME_BOARD_<NAME>=y`, which
   selects the matching choice and hence `LUME_BOARD_DIR`, in addition to the
   board's flash/PSRAM/console/partition/LVGL values.

All board values are compile-time constants. Adding the choice does **not** add
IRAM symbols: the profile is macros, and the IRAM budget is 16384/16384 (0 free)
— always re-check `idf.py size` after any change.

## Adding a new board

1. Copy `waveshare_esp32_s3_touch_amoled_2_16/` to `boards/<new_board>/`.
2. Edit `<new_board>/lume_board_profile.h`: set the pin map, geometry, I2C
   addresses, QSPI timing, the panel init command table and the touch
   coordinate mapping for the new hardware. Keep every `LUME_*` macro name —
   the drivers depend on that contract (see the header's section list). r44
   practice: cite a source (wiki / vendor BSP / demo file:line) for every
   value, record source conflicts in the header comment, and mark values with
   no verifiable source `/* TODO(board): unsourced, verify on hardware */`
   rather than guessing silently — such values are compile-time placeholders
   needed by the driver contract, not verified wiring.
3. Edit `<new_board>/sdkconfig.defaults`: flash size/mode/freq, PSRAM type,
   console, partition CSV path, LVGL color depth. Set
   `CONFIG_LUME_BOARD_<NEW>=y` (replace the Waveshare line) and update
   `CONFIG_PARTITION_TABLE_CUSTOM_FILENAME` to this board's `partitions.csv`.
   Edit `<new_board>/partitions.csv` for the new flash layout.
4. In `firmware/components/lume-board/Kconfig.projbuild`: add a
   `config LUME_BOARD_<NEW> bool "..."` member to the `choice`, and a
   `default "<new_board>" if LUME_BOARD_<NEW>` line to `LUME_BOARD_DIR`.
5. Build with the default unchanged (still Waveshare) or select the new board:
   ```
   cd /opt/esp/esp-idf && env -u VIRTUAL_ENV \
     IDF_PYTHON_ENV_PATH=/home/ubuntu/.espressif/python_env/idf5.5_py3.12_env \
     bash -c '. ./export.sh >/dev/null 2>&1; cd /home/ubuntu/lume/firmware && \
     idf.py -DSDKCONFIG_DEFAULTS="sdkconfig.defaults;boards/<new_board>/sdkconfig.defaults" \
     build && idf.py size'
   ```
   (To make the new board the default instead, change the `SDKCONFIG_DEFAULTS`
   list in `firmware/CMakeLists.txt`.)

   **r44 gotcha — the tracked `firmware/sdkconfig` wins over defaults.**
   `firmware/sdkconfig` is a tracked, generated file; ESP-IDF applies
   `SDKCONFIG_DEFAULTS` only while (re)generating it. An existing `sdkconfig`
   keeps its stored `CONFIG_LUME_BOARD_*`, `CONFIG_LUME_BOARD_DIR` and
   `CONFIG_PARTITION_TABLE_CUSTOM_FILENAME` values and silently IGNORES the new
   board's defconfig — so `-DSDKCONFIG_DEFAULTS=...` alone produces a FALSE
   green build of the OLD board (verified in r44). Before switching boards,
   move the tracked `sdkconfig` aside (or delete it) so idf.py regenerates it
   from the defaults list; then confirm `build/config/sdkconfig.h`, the
   component `flags.make` and the compiler `.d` dependency files really
   reference the intended `boards/<name>/lume_board_profile.h`. After the
   other-board build, restore the default `sdkconfig` and re-run the default
   `idf.py build` + `idf.py size` to prove zero regression before committing.
6. Verify `idf.py build` + `idf.py size` (IRAM must stay ≤ 16384 with no
   overflow), the host harnesses, and — when hardware is available — the
   display/touch orientation, bundle push, audio, sleep current, radio and
   persistence acceptance items in `docs/KNOWN-SIMPLIFICATIONS.md`.

## Explicitly out of scope (r27 first cut; status after r44/r110)

- r27 out of scope: a real second board profile / multi-board CI build matrix.
  r44 added the second **compile-time** profile. **r110 closed the CI half of
  this gap**: `.github/workflows/firmware.yml` now builds all three profiles
  in a 3-entry matrix (push main / workflow_dispatch / tag), each with its
  board's `sdkconfig.defaults` overlay and the tracked `sdkconfig` deleted
  first (r44 gotcha). Release assets are still published from the default
  2.16 job only (see the firmware.yml header for the rationale). There is
  still no on-device acceptance of any board.
- Runtime board switching (profiles are compile-time macros only).
- Converging the `480` canvas-coordinate clamps embedded in the JS prelude
  (`lume_scripts.c`): that string is extracted verbatim by the host harnesses
  and r27 forbids JS-layer behavior changes, so it is left as a documented
  follow-up. All C-side resolution literals now reference the profile.
- On-device acceptance of any kind (no board available).
