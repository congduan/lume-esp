/* lv_conf.h — Lume build for ESP32-S3-Touch-AMOLED-2.16 (480x480 QSPI AMOLED) */
#ifndef LV_CONF_H
#define LV_CONF_H

/* Color: RGB565, 16bpp — matches esp_lcd QSPI frame buffer format */
#define LV_COLOR_DEPTH 16

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

/* Tick: we feed lv_tick_inc from a FreeRTOS task (no OS abstraction layer) */
#define LV_TICK_CUSTOM 1
#define LV_TICK_CUSTOM_INCLUDE "esp_timer.h"
#define LV_TICK_CUSTOM_SYS_TIME_EXPR (esp_timer_get_time() / 1000LL)

/* Assertions: log and abort */
#define LV_USE_ASSERT_NULL 1
#define LV_USE_ASSERT_MALLOC 1

/* Draw: default sw renderer */
#define LV_DRAW_SW_DRAW_UNIT_CNT 1

/* Padding/extra trimmed — defaults from lv_conf_internal apply */
#endif /* LV_CONF_H */
