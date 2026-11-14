# r20 power implementation report

## Sequence and evidence

| Step | Implementation | Reference |
| --- | --- | --- |
| Stop frames before panel sleep | `lume_board.c`: `lume_display_sleep()` waits for the LVGL task pause acknowledgement after `lv_timer_handler()` returns. | `lume_board.c:89-131`; `esp_lcd_panel_io_spi.c:208-221` drains queued color DMA before the DCS polling command. |
| Sleep in | `lume_display.c`: QSPI command word carries DCS 0x10, then 150 ms delay. | IDF `esp_lcd_panel_commands.h:19` defines SLPIN 0x10; vendor CO5300 driver uses the same QSPI command encoder already documented in `lume_display.c:8-25`. IDF ST7789 sleep uses 100 ms (`esp_lcd_panel_st7789.c:315-334`); 150 ms is conservative. |
| Wake | `lume_display.c`: QSPI DCS 0x11, 600 ms delay; LVGL task invalidates the active screen before its next handler call. | Vendor BSP `esp32_s3_touch_amoled_2_16.c:54` uses 0x11 and 600 ms at init; `lume_display.c:74` mirrors it. |
| Touch wake | `lume_power.c`: reject low INT before entry, configure GPIO11 ext0 low level, disable wake source on exit, then return the pad to digital input before LVGL resumes. | Vendor CST9217 driver `esp_lcd_touch_cst9217.c:75-85` selects falling edge for interrupt level 0; BSP `esp32_s3_touch_amoled_2_16.c:481-485` sets GPIO11 and level 0. IDF `sleep_modes.c:1927-1943` accepts ext0 level 0; `docs/en/api-reference/system/sleep_modes.rst:217` requires `rtc_gpio_deinit` after wake. |

The existing LVGL timer loop is paused directly. This keeps LVGL's node and draw-buffer state intact; `lv_display_set_power` is absent in the vendored LVGL 9.3 API. The board driver configures `GPIO_INTR_DISABLE` and polls touch, so there is no running normal GPIO ISR to disable or restore.

## Validation

Build command used `env -u VIRTUAL_ENV IDF_PYTHON_ENV_PATH=/home/ubuntu/.espressif/python_env/idf5.5_py3.12_env` and sourced `/opt/esp/esp-idf/export.sh`.

```text
Project build complete. To flash, run:
idf.py flash
lume.bin binary size 0x1d3020 bytes. Smallest app partition is 0x640000 bytes. 0x46cfe0 bytes (71%) free.
```

`idf.py size` raw summary:

```text
Flash Code  1461546
Flash Data   326348
DIRAM        199479
IRAM          16384 (100.0%, remain 0)
RTC FAST        112
RTC SLOW         32
Total image size: 1912733 bytes (.bin may be padded larger)
```

r19 baseline `0x1cffc0` (1,900,480 bytes) to r20 `0x1d3020` (1,912,864 bytes) is +12,384 bytes. The r19 `idf.py size` total was 1,900,361 bytes; r20 is +12,372. IRAM remains exactly 16,384 bytes.

```text
PASS wake registration, unregister, and success-only dispatch
PASS touch feeds idle timer and wake resets activity
PASS shutdown clears wake callbacks
```

Hardware validation remains: actual sleep current, wake latency, INT wake reliability/pulse width, and PSRAM content retention. No board was connected in this run.
