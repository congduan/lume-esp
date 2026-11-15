# Lume ESP32-S3 board emulation

This captures a 480×480 CO5300 frame from the **real Lume firmware** under esp32sim. It boots the S3 mask ROM, bootloader, partition table and app image, then sends the same `LUME` framed JS source that `lume deploy --ephemeral` uses. The app is built by `tools/lume/bundle.js`.

## Use

On Linux, install Node >=18, Rust/Cargo and ESP-IDF v5.5.5. Then:

```sh
npm ci --prefix tools/lume
tools/emu/setup.sh
tools/emu/fetch-rom.sh
tools/emu/run.sh examples/counter
```

`run.sh` builds firmware with `idf.py build`. Set `EMU_SKIP_BUILD=1` when `firmware/build/{bootloader/bootloader.bin,partition_table/partition-table.bin,lume.bin}` are current. If ESP-IDF is not on `PATH`, `run.sh` sources `/opt/esp/esp-idf/export.sh`; other installations should source their own IDF environment first. `EMU_BIN` and `EMU_ROM` override the local esp32sim binary and ROM ELF. `EMU_SECONDS` controls emulated duration (default 8). `EMU_BOARD=lume-amoled216-no-imu` leaves the QMI8658 absent for failure testing. Output defaults to `artifacts/emu/<app>/tft.png`, `serial.log`, `actions.txt`, and `app.frame`.

`EMU_BYTECODE=1` compiles the app with the host `qjsc` (build it once with `tools/lume/fetch-qjsc.sh`) and injects a `LUMB` bytecode frame instead of a `LUME` source frame; `prepare.mjs` accepts `--bytecode` for direct use. This exercises the firmware's `JS_ReadObject` + `JS_EvalFunction` path under the same boot/reload chain.

`setup.sh` pins upstream esp32sim commit `56ea9b2a559f881aa52f44388cde1a71f9047088`, applies [the Lume patch](esp32sim-56ea9b2-lume.patch), and builds `esp32sim` under `tools/emu/.cache/`. The v0.3.0 release binary booted Lume successfully, but its CO5300 panel geometry is fixed at 368×448. The pinned source accepts `Co5300::new(width, height, column_offset)`, so a source patch is required for a 480×480 PNG. The patch adds `--board lume-amoled216` and a `serial-file` script action for binary hot-reload frames. No esp32sim source is vendored here.

## Board mapping

The authoritative values are in [`lume_board_profile.h`](../../firmware/boards/waveshare_esp32_s3_touch_amoled_2_16/lume_board_profile.h). The patch is based on esp32sim's `waveshare_amoled18.rs`, its `Co5300` panel, `Qmi8658` model, and `Reg8Device` stubs. The CST9220 device follows `lume_touch.c`'s 16-bit register protocol and 10-byte report. It inverts Lume's touch coordinate mapping when injecting script touches.

| Device | Lume wiring | esp32sim model |
| --- | --- | --- |
| CO5300 | SPI2 QSPI SCLK 38, D0–D3 4/5/6/7, CS 12, RST 39; 480×480 | SPI2 transaction decoder, `Co5300::new(480,480,0)` |
| I2C | SDA 15, SCL 14 | I2C0 attached devices |
| CST9220 | 0x5A, INT 11, RST 40 | 16-bit register / point report, polled by Lume |
| AXP2101 | 0x34 | initialization-compatible register stub |
| QMI8658 | 0x6B | shared QMI8658 model; defaults to rest |
| ES8311 / ES7210 | 0x18 / 0x40; I2S MCLK 42, SCLK 9, LRCK 45, DOUT 8, DIN 10 | I2C register stubs; audio pins are not routed to a codec model |
| TF card | MOSI 1, CLK 2, MISO 3, CS 41 | not modeled |

The SPI and I2C models attach by host/bus and address; they do not electrically validate every GPIO route. PMIC power sequencing, codec behavior, touch interrupt timing, display analog properties and TF media are outside this model. A screenshot can validate rendered content in the simulator, but it cannot certify physical orientation, touch feel, sleep current, display timing or audio. `--imu-motion 1` is accepted by the board model; the default captures a stationary IMU. These limits should be considered when reviewing CI artifacts.

CI uploads screenshots and logs for counter, files, image_gallery, games_2048 and imu_ball (with IMU omitted). The first version does not compare pixels automatically. Inspect the artifact when visual changes are expected.

Current local evidence is in [`docs/r39b-emu-report.md`](../../docs/r39b-emu-report.md). `examples/files` uses `List()` and has no `Image()` call. The extra `image_gallery` capture currently shows only its background despite an `Image` node creation log; treat that artifact as a known visual failure. With the no-IMU board, `imu_ball` evaluates and its ball falls to a wall using the app's fallback acceleration, while the driver logs repeated QMI8658 warnings.
