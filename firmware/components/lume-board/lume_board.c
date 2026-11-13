/**
 * Board init — M1 bring-up.
 *
 * Order (each step verified against vendor examples):
 *   1. I2C master on 15/14 — shared by touch/PMIC/IMU/codecs  (M1 next step)
 *   2. AXP2101: assert display/touch rails                    (M1 next step)
 *   3. CO5300 QSPI panel via esp_lcd + LVGL display           (here)
 *   4. CST9220 touch -> LVGL indev                            (M1 next step)
 *   5. TF card (SPI/FATFS)                                    (later)
 *
 * This stage wires the display pipeline: lv_init -> lv_display_create ->
 * flush_cb(QSPI DMA) -> pure-LVGL proof screen -> lv_timer_handler task.
 */
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_check.h"
#include "esp_log.h"
#include "lvgl.h"
#include "lume_pins.h"
#include "lume_board_internal.h"

static const char *TAG = "lume-board";

/* Minimal pure-LVGL proof that the render + flush pipeline is alive. */
static void create_demo_ui(void)
{
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
}

/* LVGL super-loop. lv_tick comes from LV_TICK_CUSTOM (esp_timer) in lv_conf.h,
 * so only lv_timer_handler() needs driving. M1: all LVGL calls are confined to
 * this task + the ISR flush-ready callback; M3's JS bridge must add a mutex. */
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
    lv_init();

    lv_display_t *disp = NULL;
    ESP_RETURN_ON_ERROR(lume_display_init(&disp), TAG, "CO5300/LVGL display init failed");

    create_demo_ui();

    xTaskCreate(lvgl_task, "lume-lvgl", 8192, NULL, 5, NULL);

    ESP_LOGI(TAG, "board init done: CO5300 QSPI + LVGL pipeline up");
    return ESP_OK;
}
