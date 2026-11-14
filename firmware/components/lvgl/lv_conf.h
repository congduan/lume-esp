/* lv_conf.h — Lume build for ESP32-S3-Touch-AMOLED-2.16 (480x480 QSPI AMOLED) */
#ifndef LV_CONF_H
#define LV_CONF_H

/* Color: RGB565, 16bpp — matches esp_lcd QSPI frame buffer format */
#define LV_COLOR_DEPTH 16
#define LV_USE_LODEPNG 1
#define LV_USE_TJPGD 1

/* Fonts: Montserrat 14 default; enable 20/32 for UI scale */
#define LV_FONT_MONTSERRAT_14 1
#define LV_FONT_MONTSERRAT_20 1
#define LV_FONT_MONTSERRAT_32 1
#define LV_FONT_DEFAULT &lv_font_montserrat_14

/* No demos/examples in firmware */
#define LV_USE_DEMO_WIDGETS 0

/* Memory: LVGL pools from PSRAM-backed heap is done via custom allocator in
 * lume-engine; LVGL draws into internal-SRAM draw buffer sized in board init. */
#define LV_MEM_CUSTOM 1
#define LV_MEM_CUSTOM_INCLUDE "stdlib.h"
#define LV_MEM_CUSTOM_ALLOC   malloc
#define LV_MEM_CUSTOM_FREE    free
#define LV_MEM_CUSTOM_REALLOC realloc

/* Tick: LVGL 9 removed LV_TICK_CUSTOM; the source must be registered at runtime
 * with lv_tick_set_cb(). lume_board_init() does that right after lv_init()
 * (esp_timer based, 1 ms). Do not re-add the v8 macros here — LVGL 9 ignores
 * them and lv_tick_get() would stay 0, freezing every lv_timer. */

/* Diagnostics: LVGL sysmon performance monitor, LOG mode (FPS + render/flush ms
 * to the serial console instead of covering the screen). OFF by default: the
 * 300 ms log stream floods the USB-Serial/JTAG console and can crowd out the
 * hot-reload "RELOAD OK" ACK, which makes `lume deploy` time out even though
 * the bundle did apply. Flip the three switches to 1 to measure again; see
 * docs/KNOWN-SIMPLIFICATIONS.md r28 for the numbers it produced.
 * lume_board.c registers the lv_log print callback and stubs
 * LV_SYSMON_GET_IDLE (CPU% is meaningless with LV_USE_OS 0: no idle
 * accounting, so the column always reads 100%). */
#define LV_USE_SYSMON 0
#define LV_SYSMON_GET_IDLE lume_sysmon_idle_percent
#define LV_USE_PERF_MONITOR 0
#define LV_USE_PERF_MONITOR_LOG_MODE 0
#define LV_USE_LOG 0
#define LV_LOG_LEVEL LV_LOG_LEVEL_USER

/* Assertions: log and abort */
#define LV_USE_ASSERT_NULL 1
#define LV_USE_ASSERT_MALLOC 1

/* Draw: default sw renderer */
#define LV_DRAW_SW_DRAW_UNIT_CNT 1

/* Padding/extra trimmed — defaults from lv_conf_internal apply */
#endif /* LV_CONF_H */
