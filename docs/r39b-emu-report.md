# r39b — esp32sim board emulation and screenshot pipeline

Baseline `64ab0bd feat: strengthen music metadata, lyrics, and library recovery`. `git fetch origin && git status --short` returned no status lines. No firmware source or behavior was changed, and no physical board was used.

## Step 0: feasibility

`cargo --version` returned `cargo 1.98.0 (797e8a9bc 2026-08-05)`. The Linux x86_64 esp32sim v0.3.0 release was downloaded and run with the existing `firmware/build` bootloader, partition table and app, the Espressif S3 ROM ELF, `--board none --flash-mb 16 --psram-mb 8 --max-seconds 5`. Raw serial excerpt:

```text
I (293) lume: Lume runtime booting...
W (293) lume-pmic: AXP2101 not detected (id=0x00 err=ESP_ERR_INVALID_STATE); relying on OTP defaults
W (293) lume-board: PMIC rail setup skipped/failed (ESP_ERR_NOT_FOUND); continuing
I (1655) lume-display: CO5300 QSPI + LVGL display up (480x480 RGB565, 2x19200 B SRAM draw buf)
I (1723) lume-board: board init done: CO5300 QSPI + CST9220 + LVGL pipeline up
I (1723) lume-engine: engine task up (pinned core 1), PSRAM free=5786452 bytes
W (1735) lume-imu-hw: write reg 0x60 = 0xb0 failed: ESP_ERR_INVALID_STATE
I (1776) lume-engine: runtime up; eval app '<home>' (5127 bytes)
I (1875) lume-engine: app eval ok; entering event loop
[emu] stop: Halted — core0 54771257 + core1 41398253 insns in 2.9s wall = 33.0 Minsn/s; emulated 5.000s (1200000000 cycles); 295460 exceptions, 14598 interrupts
```

This proves Octal PSRAM 8 MB is sufficient for boot and engine startup in the simulator. Missing PMIC and IMU do not crash initialization; the missing touch device repeatedly triggers bus reset warnings. A custom board is needed to capture pixels.

## Step 1: board model

The released v0.3.0 binary has a fixed 368×448 CO5300. Upstream commit `56ea9b2a559f881aa52f44388cde1a71f9047088` has parameterized `Co5300::new(width,height,column_offset)`. `tools/emu/setup.sh` pins that commit and applies `tools/emu/esp32sim-56ea9b2-lume.patch`; the patch adds `lume-amoled216`, a no-IMU variant, CST9220 16-bit-register/10-byte-frame emulation and `serial-file` binary host input. The patch applies cleanly to a fresh clone (`PATCH_OK`) and the patched release build completed.

Source mapping against `firmware/boards/waveshare_esp32_s3_touch_amoled_2_16/lume_board_profile.h`:

| Profile | Pin/address | Model |
| --- | --- | --- |
| CO5300 SPI2 QSPI | SCLK 38, D0–D3 4/5/6/7, CS 12, RST 39 | SPI2 CO5300, 480×480, offset 0; pin constants recorded |
| Shared I2C0 | SDA 15, SCL 14 | I2C0 devices |
| CST9220 | 0x5A, INT 11, RST 40 | polled point reports; INT held high |
| AXP2101 / QMI8658 | 0x34 / 0x6B | register stub / QMI model (optional) |
| ES8311 / ES7210 | 0x18 / 0x40; MCLK 42, SCLK 9, LRCK 45, DOUT 8, DIN 10 | register stubs; no codec audio path |
| TF | MOSI 1, CLK 2, MISO 3, CS 41 | pin constants, no card model |

The current board API attaches SPI by host and I2C by bus/address. It does not verify that firmware configured every listed GPIO correctly. This matters when interpreting the screenshot as board validation. `tools/emu/README.md` records usage and limitations.

## Step 2: CI and local end-to-end

`.github/workflows/emu.yml` runs on push paths `firmware/**`, `examples/**`, `tools/emu/**` and its own file. It builds with the existing ESP-IDF v5.5.5 action, builds pinned patched esp32sim, fetches the pinned ROM, runs the captures and uploads `artifacts/emu/` even when a capture fails. There is no pixel baseline comparison.

Raw checks:

```text
PATCH_OK
workflow YAML: OK
> @lume/cli@0.1.0 test
> node --test
# tests 17
# pass 17
# fail 0
```

`bash -n tools/emu/*.sh` and `node --check tools/emu/prepare.mjs` exited 0. The first local full run exposed the host's ESP-IDF Python environment mismatch (`idf5.5_py3.11_env/bin/python not found`); `run.sh` now selects the installed `idf5.5_py3.12_env` when present. The subsequent full `tools/emu/run.sh examples/counter` run rebuilt firmware and captured the app:

```text
Generated /home/ubuntu/lume/firmware/build/lume.bin
[100%] Built target gen_project_binary
lume.bin binary size 0x2985c0 bytes. Smallest app partition is 0x640000 bytes. 0x3a7a40 bytes (58%) free.
[100%] Built target app_check_size
[100%] Built target app
bundle /home/ubuntu/lume/examples/counter: 1108 bytes; frame 1120 bytes
I (2697) lume-engine: engine recv RELOAD -> recycle runtime
I (2709) lume-engine: runtime up; eval app '<embedded-demo>' (1108 bytes)
I (2799) lume-engine: app eval ok; entering event loop
TFT: /home/ubuntu/lume/artifacts/emu/counter/tft.png
```

The console capture does not include the USB `RELOAD OK` reply, although the firmware logs reload and successful app evaluation. `run.sh` therefore checks the firmware's receive/evaluation lines and a nonempty PNG. The reply visibility remains an esp32sim/USB observation gap, not proof of a failed reload.

## Step 3: application captures

Each application was bundled from its own `examples/<name>/app.js` and injected as a `LUME` frame. Review [counter](../artifacts/emu/counter/tft.png), [files](../artifacts/emu/files/tft.png), [games_2048](../artifacts/emu/games_2048/tft.png) and [image_gallery](../artifacts/emu/image_gallery/tft.png). The `imu_ball` / `imu_ball_no_imu` captures in this round were the pre-rename maze build; those files were deleted, and that example is now `examples/gravity_ball` (CI writes `artifacts/emu/gravity_ball_no_imu/`). The exact artifacts are in `artifacts/emu/<name>/tft.png`; `serial.log` is generated locally and uploaded by CI, but excluded from Git to avoid committing per-run OTA tokens. Selected raw output:

```text
# counter
I (2709) lume-engine: runtime up; eval app '<embedded-demo>' (1108 bytes)
I (2799) lume-engine: app eval ok; entering event loop
# files
I (2715) lume-engine: runtime up; eval app '<embedded-demo>' (10839 bytes)
I (2847) lume-engine: app eval ok; entering event loop
# games_2048
I (2710) lume-engine: runtime up; eval app '<embedded-demo>' (3243 bytes)
I (2844) lume-engine: app eval ok; entering event loop
# imu_ball (no IMU)
I (2712) lume-engine: runtime up; eval app '<embedded-demo>' (4950 bytes)
I (2827) lume-engine: app eval ok; entering event loop
```

All three requested PNGs are 480×480 and show UI: counter cards/buttons, files List/root directory, and the 2048 canvas/two tiles. The files example contains `List()` but no `Image()` call. The additional image_gallery app logs `create id=1 kind=4` for `Image()` and `app eval ok`, yet its PNG contains only two background colors and no visible image. It needs separate image/UI debugging; this r39b pipeline exposes it but does not fix firmware behavior.

With the QMI model, `imu_ball` renders a ball at the starting point. The no-IMU variant logs:

```text
W (1763) lume-imu-hw: write reg 0x60 = 0xb0 failed: ESP_ERR_INVALID_STATE
I (2827) lume-engine: app eval ok; entering event loop
W (2887) lume-imu-hw: QMI8658 not initialised (no board / init failed)
```

The no-IMU screenshot shows the ball resting on the first wall, lower than its start. This matches the application's fallback (`ay = 9.80665 * GAIN`) and demonstrates that missing IMU does not crash it. The repeated warning on every read is noisy. None of these captures establishes real-board orientation, touch feel, frame rate, sleep current or audio performance.
