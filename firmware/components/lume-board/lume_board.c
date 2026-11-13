/**
 * Board init — M1 bring-up.
 *
 * Order (each step verified against vendor examples):
 *   1. I2C master on 15/14 — shared by touch/PMIC/IMU/codecs
 *   2. AXP2101: assert display/touch rails (isolated, non-fatal)
 *   3. CO5300 QSPI panel via esp_lcd + LVGL display
 *   4. CST9220 touch -> LVGL indev
 *   5. TF card (SPI/FATFS)                                    (later)
 *
 * LVGL: lv_init -> lv_display_create -> flush_cb(QSPI DMA) -> pure-LVGL proof
 * screen -> lv_timer_handler task. lv_tick comes from LV_TICK_CUSTOM
 * (esp_timer) in lv_conf.h, so only lv_timer_handler() needs driving.
 */
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/i2c_master.h"
#include "esp_check.h"
#include "esp_log.h"
#include "lvgl.h"
#include "lume_pins.h"
#include "lume_board_internal.h"

static const char *TAG = "lume-board";

/* M1: the JS demo owns the screen by default. Set LUME_BOARD_LEGACY_DEMO=1
 * to restore the original pure-LVGL proof screen (no JS handoff). */
#ifndef LUME_BOARD_LEGACY_DEMO
#define LUME_BOARD_LEGACY_DEMO 0
#endif

static void create_demo_ui(void)
{
#if LUME_BOARD_LEGACY_DEMO
    /* Legacy proof that the render + flush pipeline is alive. */
    lv_obj_t *scr = lv_screen_active();
    lv_obj_set_style_bg_color(scr, lv_color_hex(0x0B1E3F), 0);
    lv_obj_set_style_bg_opa(scr, LV_OPA_COVER, 0);

    lv_obj_t *box = lv_obj_create(scr);
    lv_obj_set_size(box, 300, 180);
    lv_obj_center(box);
    lv_obj_set_style_bg_color(box, lv_color_hex(0xFF7043), 0);
    lv_obj_set_style_bg_opa(box, LV_OPA_COVER, 0);
    lv_obj_set_style_border_width(box, 0, 0);
    lv_obj_set_style_radius(box, 16, 0);

    lv_obj_t *label = lv_label_create(box);
    lv_label_set_text(label, "Lume M1\nLVGL + QSPI OK");
    lv_obj_set_style_text_color(label, lv_color_white(), 0);
    lv_obj_center(label);
#else
    /* Block-scope extern: the ui-bridge component is linked via PRIV_REQUIRES.
     * Keeping the declaration here makes create_demo_ui the only edit point in
     * this frozen board file. */
    extern void lume_ui_bridge_init(void);

    lv_obj_t *scr = lv_screen_active();
    lv_obj_set_style_bg_color(scr, lv_color_hex(0x0B1E3F), 0);
    lv_obj_set_style_bg_opa(scr, LV_OPA_COVER, 0);

    /* Yield the screen to the declarative JS demo. This also creates the LVGL
     * drain timer here, on the main task BEFORE lvgl_task starts -> no race
     * with a running lv_timer_handler (LV_USE_OS == LV_OS_NONE). */
    lume_ui_bridge_init();
#endif
}

/* LVGL super-loop. M1: all LVGL calls are confined to this task + the ISR
 * flush-ready callback; M3's JS bridge must add a mutex before touching LVGL
 * from the engine task. */
static void lvgl_task(void *arg)
{
    (void)arg;
    for (;;) {
        lv_timer_handler();
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}

esp_err_t lume_board_init(void)
{
    /* 1. Shared I2C master bus: AXP2101(0x34), CST9220(0x5A), IMU, codec, RTC. */
    const i2c_master_bus_config_t i2c_cfg = {
        .i2c_port = -1,
        .sda_io_num = LUME_PIN_I2C_SDA,
        .scl_io_num = LUME_PIN_I2C_SCL,
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .glitch_ignore_cnt = 7,
        .flags = {
            .enable_internal_pullup = true,
        },
    };
    i2c_master_bus_handle_t bus = NULL;
    ESP_RETURN_ON_ERROR(i2c_new_master_bus(&i2c_cfg, &bus), TAG, "i2c_new_master_bus failed");

    /* 2. PMIC rails first, before anything drives the panel. Non-fatal by design
     * (see lume_pmic.c): the vendor examples rely on OTP defaults. */
    esp_err_t pmic_err = lume_pmic_display_power_on(bus);
    if (pmic_err != ESP_OK) {
        ESP_LOGW(TAG, "PMIC rail setup skipped/failed (%s); continuing", esp_err_to_name(pmic_err));
    }

    /* 3. LVGL core must be up before any display / indev / widget. */
    lv_init();

    lv_display_t *disp = NULL;
    ESP_RETURN_ON_ERROR(lume_display_init(&disp), TAG, "CO5300/LVGL display init failed");

    /* 4. Touch -> LVGL indev (M1: LVGL only; M3 also posts to the JS queue). */
    ESP_RETURN_ON_ERROR(lume_touch_init(bus, disp), TAG, "CST9220/LVGL indev init failed");

    create_demo_ui();

    BaseType_t task_ok = xTaskCreate(lvgl_task, "lume-lvgl", 8192, NULL, 5, NULL);
    if (task_ok != pdPASS) {
        ESP_RETURN_ON_ERROR(ESP_ERR_NO_MEM, TAG, "lvgl task creation failed");
    }

    ESP_LOGI(TAG, "board init done: CO5300 QSPI + CST9220 + LVGL pipeline up");
    return ESP_OK;
}
