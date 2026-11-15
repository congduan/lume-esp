#pragma once
/* Private, cross-module API for the lume-board component.
 * Not exported through include/ — only the component's own .c files use it. */
#include "esp_err.h"
#include "driver/i2c_master.h"
#include "lvgl.h"

/* Touch controller protocol selector (r45). Board profiles set LUME_TOUCH_CHIP
 * to one of these; the values are chip-level, not board wiring. The two clean-
 * room I2C driver paths in lume_touch.c (CST9220 16-bit / 10-byte frame vs
 * CST820/CST816S 8-bit / 6-byte frame) are selected at compile time. */
#define LUME_TOUCH_CHIP_CST9220 1
#define LUME_TOUCH_CHIP_CST816S 2

/* lume_display.c — CO5300 QSPI bring-up + LVGL display registration. */
esp_err_t lume_display_init(lv_display_t **out_disp);
esp_err_t lume_panel_sleep(void);
esp_err_t lume_panel_wake(void);
void lume_display_invalidate_all(void);
/* Screen-capture state machine step: consumes arm/cancel requests and arms
 * (or aborts) the flush_cb shadow copy. LVGL task only (lvgl_task loop). */
void lume_display_capture_tick(void);

/* lume_pmic.c — AXP2101 display/touch power rails (isolated, see TODO there). */
esp_err_t lume_pmic_display_power_on(i2c_master_bus_handle_t bus);

/* lume_touch.c — CST9220 probe + LVGL indev registration. */
esp_err_t lume_touch_init(i2c_master_bus_handle_t bus, lv_display_t *disp);
