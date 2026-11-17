# r86: Waveshare ESP32-S3-Touch-AMOLED-1.75C compile-time profile

Baseline: `7f902d6`, branch `r86-amoled-175c`. No board was connected; this
report covers source inspection, firmware compilation and host checks only.

## Source and implementation

The [Waveshare 1.75C Arduino pin configuration](https://github.com/waveshareteam/ESP32-S3-Touch-AMOLED-1.75C/blob/main/examples/arduino/libraries/board_config/pin_config.h)
gives the QSPI, reset, I2C, touch and audio pins and the 466×466 geometry.
The [Waveshare board README](https://github.com/waveshareteam/ESP32-S3-Touch-AMOLED-1.75C)
identifies 32 MB flash, 8 MB PSRAM, CO5300, CST9217, AXP2101, QMI8658,
ES8311 and ES7210. The inspected 1.75C sources agree with the brief's pin
table; no pin correction was required. The similarly named non-C 1.75 board
is a distinct design and was not used as a pin source.
The 1.75C `pin_config.h` does not specify the touch I2C address; `0x5A` is
reused from Lume's existing CST92xx contract and remains to be probed on-device.

| Parameter | Existing 2.16 | New 1.75C |
|---|---:|---:|
| Display | CO5300 480×480 | CO5300 466×466 |
| LCD reset | GPIO39 | GPIO1 |
| Touch | CST9220, reset GPIO40 | CST9217, reset GPIO2 |
| Audio MCLK | GPIO42 | GPIO16 |
| Flash | 16 MB | 32 MB |
| TF slot | SPI pins declared | No pins declared; SD-backed calls return `-2` |
| Touch I2C | `0x5A` | `0x5A` |

The new profile preserves the 2.16 panel command sequence and uses column
offset 0 provisionally. The copied touch orientation also requires board
validation. The `lume_touch.c` CST92xx path reads 16-bit registers and logs the
project ID from `0xD204` but never rejects a CST9217 ID, so no new touch
selector or driver fork was introduced. `mp3_decoder.c` now compiles without
SD pin macros and returns its existing unavailable error `-2` for a board
without a TF slot. The `#if defined` branch leaves 2.16 and 1.8 code paths
unchanged. Kconfig selects the new board directory. `firmware/CMakeLists.txt`
has no explicit per-board list needing modification.

The 32 MB partition map keeps the factory app at `0x10000` / `0x640000` and
expands LittleFS storage to `0x1800000` from offset `0x750000`, ending at
`0x1F50000` within the `0x2000000` flash boundary.

## Verification

Raw command output is in `artifacts/r86/`. Build and size details are recorded
in `default-baseline-build-size.log`, `new-board-build-size.log` and
`default-final-build-size.log`; generated-config evidence is in
`new-board-config-evidence.log`. Host evidence is in `host-tests.log`,
`check-counter-no-emu-final.log`, `ctest.log`, `sd-guard-check.log` and
`reset-profile-check.log`. The final new-board incremental rebuild after
removing the expander macro is in `new-board-final-rebuild.log`; it passed with
the same size table as the initial new-board build.

| Check | Result |
|---|---|
| Default 2.16 `idf.py build && idf.py size` | Pass; Flash Code 2,022,976 B, Flash Data 849,428 B, DIRAM 247,267 B, IRAM 16,384/16,384 B, total 3,014,175 B |
| New 1.75C `idf.py build && idf.py size` | Pass; Flash Code 1,978,128 B, Flash Data 838,524 B, DIRAM 246,823 B, IRAM 16,384/16,384 B, total 2,958,075 B |
| 44 `tests/*.js` scripts | Pass; `ALL_JS_TESTS_PASS`, exit 0 |
| `lume check examples/counter --no-emu` | Pass; bundle 2,160 bytes, emu/layout skipped as requested |
| `ctest` | Exit 0, no tests registered in `firmware/build` |

The r84 report embedded in baseline commit `7f902d6` quotes total image size
3,015,759 B; its raw excerpt is in `r84-historical-size.log`. This is a
historical snapshot, 1,584 B above the current default build. To test this
change directly, the default board was rebuilt once with `7f902d6`'s original
`mp3_decoder.c` and once with the new SD guard. The two `idf.py size` tables
are identical field by field, including the 3,014,175 B total; see
`default-original-mp3-build-size.log` and `default-final-build-size.log`.
Their `.bin` SHA-256 values differ. A repeated A/B build (`default-bin-compare.log`)
localizes all 65 changed bytes to two regions: 32 bytes at `0xb0–0xcf`
(app-description ELF hash) and the final 33 bytes at `0x2dfe7f–0x2dfe9f`
(image checksum/hash). All other image bytes are identical; the executable
payload and size are unchanged. This is a build-metadata difference, so an
unqualified byte-for-byte `.bin` identity is not claimed.

The first `check --no-emu` attempt could not import `esbuild` in this clean
worktree; `npm ci --prefix tools/lume` installed the declared CLI dependencies
and the retry passed. The failure and install output are preserved in
`check-counter-no-emu.log` and `npm-ci.log`. `ctest` found no registered tests
in the firmware build directory.

The tracked default `firmware/sdkconfig` overrides `SDKCONFIG_DEFAULTS`; the
new-board build therefore uses an independent `SDKCONFIG` path and build
directory, merging common defaults with the 1.75C defaults. The generated
`sdkconfig.h` can show board choice/directory and 32 MB flash; geometry is a
profile-header macro, so the evidence also checks the selected include path
and the `466` definitions in that header.

The exact new-board command in the brief omits the common defaults and would
reuse the tracked default `firmware/sdkconfig` despite a separate `-B` path.
The verified build used `idf.py -B /tmp/lume-r86-build-175c -D
SDKCONFIG=/tmp/lume-r86-sdkconfig-175c -D
SDKCONFIG_DEFAULTS="sdkconfig.defaults;boards/waveshare_esp32_s3_touch_amoled_1_75c/sdkconfig.defaults"
build`, followed by `idf.py -B /tmp/lume-r86-build-175c size`, within the
specified ESP-IDF v5.5 environment. This preserves both the default config
and build tree. The generated `sdkconfig.h` confirms the 1.75C choice and
32 MB flash; the profile include path and header confirm the 466×466 values.

## Acceptance boundary

Compilation and host tests establish that the selected profile and guarded
code build. The panel's first light-up, column offset, touch orientation and
feel, reset timing, audio, sleep current, WiFi/BLE, persistence and bundle
push await on-device acceptance. No hardware behavior is claimed here.
