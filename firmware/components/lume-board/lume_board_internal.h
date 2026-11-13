#pragma once
/* Private, cross-module API for the lume-board component.
 * Not exported through include/ — only the component's own .c files use it. */
#include "esp_err.h"
#include "driver/i2c_master.h"
#include "lvgl.h"

/* lume_display.c — CO5300 QSPI bring-up + LVGL display registration. */
esp_err_t lume_display_init(lv_display_t **out_disp);

/* lume_pmic.c — AXP2101 display/touch power rails (isolated, see TODO there). */
esp_err_t lume_pmic_display_power_on(i2c_master_bus_handle_t bus);

/* lume_touch.c — CST9220 probe + LVGL indev registration. */
esp_err_t lume_touch_init(i2c_master_bus_handle_t bus, lv_display_t *disp);
