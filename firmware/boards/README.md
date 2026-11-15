# Lume board profiles (r27 first cut)

A **board profile** is the single place that answers "what do I change to build
Lume for a different board?". Everything board-specific — pin map, display
geometry, QSPI timing, the panel init command table, I2C device addresses,
sdkconfig values and the partition table — lives in one directory here.

This is a **compile-time, single-board-at-a-time abstraction**. There is no
runtime board switching. r44 added a second profile (Waveshare
ESP32-S3-Touch-AMOLED-1.8) as the first real use of the six-step flow below;
both profiles are compile-time parameter sets and NEITHER has on-device
acceptance. See `docs/KNOWN-SIMPLIFICATIONS.md` (r27 / r31 / r44 entries) and
`docs/r27-board-param-audit.md`. The default board is still the 2.16 profile.

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
```

`lume_board_profile.h` is re-exported to the whole firmware by
`firmware/components/lume-board/include/lume_pins.h` (a one-line shim). No `.c`
file should hardcode a pin, a resolution, an I2C address or a panel command
again — include `lume_pins.h` and use the `LUME_*` macros.

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

## Explicitly out of scope (r27 first cut; status after r44)

- r27 out of scope: a real second board profile / multi-board CI build matrix.
  r44 added the second **compile-time** profile, but there is still no
  multi-board CI matrix and no on-device acceptance of any board.
- Runtime board switching (profiles are compile-time macros only).
- Converging the `480` canvas-coordinate clamps embedded in the JS prelude
  (`lume_scripts.c`): that string is extracted verbatim by the host harnesses
  and r27 forbids JS-layer behavior changes, so it is left as a documented
  follow-up. All C-side resolution literals now reference the profile.
- On-device acceptance of any kind (no board available).
