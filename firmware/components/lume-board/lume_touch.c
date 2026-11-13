/**
 * CST9220 capacitive touch — clean-room I2C read + LVGL indev feed (M1).
 *
 * Evidence (pulled and read before writing):
 *  - waveshare/esp_lcd_touch_cst9217 v1.0.4, esp_lcd_touch_cst9217.c
 *      :23-33   -> registers 0xD000 (data), 0xD101 (cmd mode), 0xD1FC
 *                  (checkcode), 0xD1F8 (resolution), 0xD204 (project id);
 *                  ACK 0xAB; 1 touch point; 10-byte data frame
 *      :120-164 -> read_data(): ACK at byte 6, point count byte5&0x7F,
 *                  x=(p1<<4)|(p3>>4), y=(p2<<4)|(p3&0x0F), status 0x06
 *      :199-207 -> reset: RST low 10ms, high 50ms
 *      :210-242 -> read_config(): command-mode entry + checkcode/resolution/id
 *      :244-302 -> read_reg()/write_reg(): 16-bit big-endian register address,
 *                  2ms settle, then read/write payload
 *  - include/esp_lcd_touch_cst9217.h:24-36 -> I2C addr 0x5A
 *  - waveshare BSP v1.0.0 esp32_s3_touch_amoled_2_16.c:470-497,566-569
 *      -> rst=40, int=11 (active low), touch_flags swap_xy=1 mirror_y=1
 *  - espressif/esp_lcd_touch v1.2.1 esp_lcd_touch.c:92-106
 *      -> coordinate transform order: mirror_x, mirror_y (y=max-y), swap_xy
 *
 * The board's touch IC is a CST9220; the vendor driver is named "cst9217" but
 * the register map is the same family — the chip reports its own project ID.
 *
 * M1: events are fed to LVGL ONLY via the indev read callback. M3 will also
 * post them to the QuickJS engine event queue.
 */
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/gpio.h"
#include "driver/i2c_master.h"
#include "esp_check.h"
#include "esp_log.h"
#include "lvgl.h"
#include "lume_pins.h"
#include "lume_board_internal.h"

#define TP_I2C_ADDR        0x5A
#define TP_I2C_TIMEOUT_MS  200

#define TP_DATA_REG        0xD000
#define TP_CMD_MODE_REG    0xD101
#define TP_CHECKCODE_REG   0xD1FC
#define TP_RESOLUTION_REG  0xD1F8
#define TP_PROJECT_ID_REG  0xD204

#define TP_ACK             0xAB
#define TP_FRAME_LEN       10       /* CST9217_MAX_TOUCH_POINTS*5 + 5 */
#define TP_STATUS_PRESS    0x06

static const char *TAG = "lume-touch";
static i2c_master_dev_handle_t s_tp;

static esp_err_t tp_reset(void)
{
    const gpio_config_t rst_cfg = {
        .mode = GPIO_MODE_OUTPUT,
        .pin_bit_mask = 1ULL << LUME_PIN_TP_RST,
    };
    ESP_RETURN_ON_ERROR(gpio_config(&rst_cfg), TAG, "TP RST gpio config failed");
    ESP_RETURN_ON_ERROR(gpio_set_level(LUME_PIN_TP_RST, 0), TAG, "TP RST low failed");
    vTaskDelay(pdMS_TO_TICKS(10));
    ESP_RETURN_ON_ERROR(gpio_set_level(LUME_PIN_TP_RST, 1), TAG, "TP RST high failed");
    vTaskDelay(pdMS_TO_TICKS(50));
    return ESP_OK;
}

/* cst9217.c:244-276 — 16-bit big-endian register address, 2ms settle, read. */
static esp_err_t tp_read_reg(uint16_t reg, uint8_t *data, size_t len)
{
    const uint8_t addr[2] = {(uint8_t)(reg >> 8), (uint8_t)reg};
    esp_err_t err = i2c_master_transmit(s_tp, addr, sizeof(addr), TP_I2C_TIMEOUT_MS);
    if (err != ESP_OK) {
        return err;
    }
    vTaskDelay(pdMS_TO_TICKS(2));
    return i2c_master_receive(s_tp, data, len, TP_I2C_TIMEOUT_MS);
}

/* cst9217.c:278-301 — same address phase, then the payload. */
static esp_err_t tp_write_reg(uint16_t reg, const uint8_t *data, size_t len)
{
    const uint8_t addr[2] = {(uint8_t)(reg >> 8), (uint8_t)reg};
    esp_err_t err = i2c_master_transmit(s_tp, addr, sizeof(addr), TP_I2C_TIMEOUT_MS);
    if (err != ESP_OK) {
        return err;
    }
    vTaskDelay(pdMS_TO_TICKS(2));
    return i2c_master_transmit(s_tp, data, len, TP_I2C_TIMEOUT_MS);
}

/* Informational probe; failure is non-fatal (M1 can still read points). */
static void tp_probe(void)
{
    const uint8_t enter_cmd_mode[2] = {0xD1, 0x01};   /* cst9217.c:215 */
    if (tp_write_reg(TP_CMD_MODE_REG, enter_cmd_mode, sizeof(enter_cmd_mode)) != ESP_OK) {
        ESP_LOGW(TAG, "command-mode entry failed (continuing)");
        return;
    }
    vTaskDelay(pdMS_TO_TICKS(10));                     /* cst9217.c:219 */

    uint8_t data[4] = {0};
    if (tp_read_reg(TP_CHECKCODE_REG, data, 4) == ESP_OK) {
        ESP_LOGI(TAG, "checkcode %02X%02X%02X%02X",
                 (unsigned)data[0], (unsigned)data[1], (unsigned)data[2], (unsigned)data[3]);
    }
    if (tp_read_reg(TP_RESOLUTION_REG, data, 4) == ESP_OK) {
        ESP_LOGI(TAG, "resolution %u x %u",
                 (unsigned)(((uint16_t)data[1] << 8) | data[0]),
                 (unsigned)(((uint16_t)data[3] << 8) | data[2]));
    }
    if (tp_read_reg(TP_PROJECT_ID_REG, data, 4) == ESP_OK) {
        ESP_LOGI(TAG, "chip type 0x%04X project id 0x%04X",
                 (unsigned)(((uint16_t)data[3] << 8) | data[2]),
                 (unsigned)(((uint16_t)data[1] << 8) | data[0]));
    }
}

/* LVGL indev read callback — invoked from lv_timer_handler() in the LVGL task. */
static void indev_read_cb(lv_indev_t *indev, lv_indev_data_t *data)
{
    (void)indev;
    uint8_t frame[TP_FRAME_LEN] = {0};
    data->state = LV_INDEV_STATE_RELEASED;
    data->continue_reading = false;

    if (tp_read_reg(TP_DATA_REG, frame, sizeof(frame)) != ESP_OK) {
        return;
    }
    if (frame[6] != TP_ACK) {                 /* cst9217.c:129 */
        return;
    }
    if ((frame[5] & 0x7F) == 0) {             /* cst9217.c:134 */
        return;
    }
    if ((frame[0] & 0x0F) != TP_STATUS_PRESS) {
        return;
    }

    const uint16_t tx = (uint16_t)(((uint16_t)frame[1] << 4) | (frame[3] >> 4));
    const uint16_t ty = (uint16_t)(((uint16_t)frame[2] << 4) | (frame[3] & 0x0F));

    /* BSP touch_flags swap_xy=1 mirror_x=0 mirror_y=1 (BSP:566-569), applied
     * in the esp_lcd_touch order (mirror_y: y=max-y, then swap_xy).
     * TODO(M1 / hardware verify): confirm orientation on the real panel. */
    int32_t px = (int32_t)(LUME_LCD_V_RES - ty);
    int32_t py = (int32_t)tx;
    if (px < 0) px = 0;
    if (py < 0) py = 0;
    if (px >= LUME_LCD_H_RES) px = LUME_LCD_H_RES - 1;
    if (py >= LUME_LCD_V_RES) py = LUME_LCD_V_RES - 1;

    data->point.x = px;
    data->point.y = py;
    data->state = LV_INDEV_STATE_PRESSED;
}

esp_err_t lume_touch_init(i2c_master_bus_handle_t bus, lv_display_t *disp)
{
    const i2c_device_config_t dev_cfg = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = TP_I2C_ADDR,
        .scl_speed_hz = 400000,
    };
    ESP_RETURN_ON_ERROR(i2c_master_bus_add_device(bus, &dev_cfg, &s_tp),
                        TAG, "CST9220 add_device failed");

    ESP_RETURN_ON_ERROR(tp_reset(), TAG, "CST9220 reset failed");

    const gpio_config_t int_cfg = {
        .mode = GPIO_MODE_INPUT,
        .pin_bit_mask = 1ULL << LUME_PIN_TP_INT,
        .intr_type = GPIO_INTR_DISABLE,  /* M1 polls via LVGL timer; M3 can use the IRQ */
    };
    ESP_RETURN_ON_ERROR(gpio_config(&int_cfg), TAG, "TP INT gpio config failed");

    tp_probe();

    lv_indev_t *indev = lv_indev_create();
    ESP_RETURN_ON_FALSE(indev != NULL, ESP_ERR_NO_MEM, TAG, "lv_indev_create failed");
    lv_indev_set_type(indev, LV_INDEV_TYPE_POINTER);
    lv_indev_set_read_cb(indev, indev_read_cb);
    lv_indev_set_display(indev, disp);

    ESP_LOGI(TAG, "CST9220 -> LVGL indev ready (addr 0x%02x, INT=%d)",
             (unsigned)TP_I2C_ADDR, LUME_PIN_TP_INT);
    return ESP_OK;
}
