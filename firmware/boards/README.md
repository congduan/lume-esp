# Lume board profiles (r27 first cut)

A **board profile** is the single place that answers "what do I change to build
Lume for a different board?". Everything board-specific — pin map, display
geometry, QSPI timing, the panel init command table, I2C device addresses,
sdkconfig values and the partition table — lives in one directory here.

This is a **compile-time, single-board abstraction**. There is no runtime board
switching and no second board profile yet; see
`docs/KNOWN-SIMPLIFICATIONS.md` (r27 entry) and `docs/r27-board-param-audit.md`.

## Layout

```
firmware/boards/
  README.md                                  <- this file
  waveshare_esp32_s3_touch_amoled_2_16/
    lume_board_profile.h                     <- all C compile-time constants
    sdkconfig.defaults                       <- board-specific CONFIG_* values
    partitions.csv                           <- board flash layout
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
   the drivers depend on that contract (see the header's section list).
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
6. Verify `idf.py build` + `idf.py size` (IRAM must stay ≤ 16384 with no
   overflow), the host harnesses, and — when hardware is available — the
   display/touch orientation, bundle push, audio, sleep current, radio and
   persistence acceptance items in `docs/KNOWN-SIMPLIFICATIONS.md`.

## Explicitly out of scope for this round

- A real second board profile / multi-board CI build matrix.
- Runtime board switching (profiles are compile-time macros only).
- Converging the `480` canvas-coordinate clamps embedded in the JS prelude
  (`lume_scripts.c`): that string is extracted verbatim by the host harnesses
  and r27 forbids JS-layer behavior changes, so it is left as a documented
  follow-up. All C-side resolution literals now reference the profile.
- On-device acceptance of any kind (no board available).
