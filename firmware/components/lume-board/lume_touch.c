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
 *  - include/esp_lcd_touch_cst9217.h:24-36 -> I2C address (now in profile)
 *  - waveshare BSP v1.0.0 esp32_s3_touch_amoled_2_16.c:470-497,566-569
 *      -> RST/INT pins and orientation flags (now in lume_board_profile.h)
 *  - espressif/esp_lcd_touch v1.2.1 esp_lcd_touch.c:92-106
 *      -> coordinate transform order: mirror_x, mirror_y (y=max-y), swap_xy
 *
 * The board's touch IC is a CST9220; the vendor driver is named "cst9217" but
 * the register map is the same family — the chip reports its own project ID.
 *
 * M1: events are fed to LVGL ONLY via the indev read callback (which produces
 * LV_EVENT_CLICKED -> ui-bridge press_cb -> engine Queue B -> __lume_dispatchPress
 * -> JS onPress, i.e. real touch already reaches the JS event loop). M3 will
 * also post raw touch points to the QuickJS engine event queue. The read_cb
 * emits a throttled (~2 Hz) point log for bring-up observability.
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
#if LUME_TOUCH_CHIP == LUME_TOUCH_CHIP_CST9220
/* Board profile owns the touch I2C address; chip-level registers below are
 * CST9220/cst9217 family constants, not board-wiring values. */
#define TP_I2C_ADDR        LUME_I2C_ADDR_CST9220
#define TP_I2C_TIMEOUT_MS  200

#define TP_DATA_REG        0xD000
#define TP_CMD_MODE_REG    0xD101
#define TP_CHECKCODE_REG   0xD1FC
#define TP_RESOLUTION_REG  0xD1F8
#define TP_PROJECT_ID_REG  0xD204

#define TP_ACK             0xAB
#define TP_FRAME_LEN       10       /* CST9217_MAX_TOUCH_POINTS*5 + 5 */
#define TP_STATUS_PRESS    0x06
#define TP_LOG_INTERVAL_MS 500      /* throttled point log: <=1 line / 500ms */

static const char *TAG = "lume-touch";
static i2c_master_dev_handle_t s_tp;
static lv_point_t s_last_point = {0};
static bool s_was_pressed = false;
static uint32_t s_last_point_log_ms = 0;   /* last throttled point-log tick */
static bool s_point_log_armed = false;     /* false => first press logs immediately */

/* Consecutive-read failure budget (esp_lcd_touch.c:315-329 uses the same
 * pattern: a transient bus glitch must not kill an ongoing press, and a
 * persistent bus fault triggers one controller reset, not a storm). */
#define TP_MAX_READ_ERRORS   10

static int s_read_errors = 0;

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
        /* Transient I2C error: keep the previous point/press state instead of
         * reporting an instant release (vendor driver: esp_lcd_touch.c reads
         * keep last data on error). After a sustained failure, reset the
         * controller once — mirrors the vendor recovery path. */
        s_read_errors++;
        if (s_read_errors >= TP_MAX_READ_ERRORS) {
            ESP_LOGW(TAG, "touch bus down after %d read errors, resetting", s_read_errors);
            s_read_errors = 0;
            if (tp_reset() == ESP_OK) {
                /* First reads after reset may be garbage; swallow this cycle. */
                return;
            }
        }
        /* Report release but restore last known point so LVGL doesn't jump. */
        data->point = s_last_point;
        data->state = s_was_pressed ? LV_INDEV_STATE_PRESSED : LV_INDEV_STATE_RELEASED;
        return;
    }
    s_read_errors = 0;

    if (frame[6] != TP_ACK) {                 /* cst9217.c:129 */
        s_was_pressed = false;
        return;
    }
    if ((frame[5] & 0x7F) == 0) {             /* cst9217.c:134 */
        s_was_pressed = false;
        return;
    }
    if ((frame[0] & 0x0F) != TP_STATUS_PRESS) {
        s_was_pressed = false;
        return;
    }

    const uint16_t tx = (uint16_t)(((uint16_t)frame[1] << 4) | (frame[3] >> 4));
    const uint16_t ty = (uint16_t)(((uint16_t)frame[2] << 4) | (frame[3] & 0x0F));

    /* Board orientation (mirror_y + swap_xy) is defined by the profile's
     * LUME_TOUCH_MAP_X/Y (Waveshare BSP:566-569). Clamp to the profile
     * geometry. TODO(M1 / hardware verify): confirm on the real panel. */
    int32_t px = LUME_TOUCH_MAP_X(tx, ty);
    int32_t py = LUME_TOUCH_MAP_Y(tx, ty);
    if (px < 0) px = 0;
    if (py < 0) py = 0;
    if (px >= LUME_LCD_H_RES) px = LUME_LCD_H_RES - 1;
    if (py >= LUME_LCD_V_RES) py = LUME_LCD_V_RES - 1;

    data->point.x = px;
    data->point.y = py;
    data->state = LV_INDEV_STATE_PRESSED;
    s_last_point = data->point;
    s_was_pressed = true;

    /* Throttled point log: at most one line per TP_LOG_INTERVAL_MS while the
     * finger is down, so touch movement is observable without flooding UART on
     * every indev read (LV_DEF_REFR_PERIOD=33ms). Raw + transformed coords are
     * both emitted so the mirror_y/swap_xy mapping can be checked on a panel.
     * CLICKED keeps its own one-shot log in the ui-bridge press_cb. */
    uint32_t now_ms = lv_tick_get();
    /* First press after boot logs immediately (s_last_point_log_ms starts at 0,
     * so a plain interval check would swallow touches inside the first 500ms);
     * afterwards the 500ms throttle applies as declared. */
    if (!s_point_log_armed ||
        (uint32_t)(now_ms - s_last_point_log_ms) >= TP_LOG_INTERVAL_MS) {
        s_point_log_armed = true;
        s_last_point_log_ms = now_ms;
        ESP_LOGI(TAG, "touch p=(%d,%d) raw=(%u,%u)",
                 (int)px, (int)py, (unsigned)tx, (unsigned)ty);
    }
}

esp_err_t lume_touch_init(i2c_master_bus_handle_t bus, lv_display_t *disp)
{
    const i2c_device_config_t dev_cfg = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = TP_I2C_ADDR,
        .scl_speed_hz = LUME_TOUCH_I2C_SPEED_HZ,
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
#else
/* ==================================================================== *
 * CST820 / CST816S path — Waveshare ESP32-S3-Touch-AMOLED-1.8 V2 (r45).
 *
 * Empirical sources (read before writing; the r44 "0x15 is a chip-ID
 * register" premise was wrong — 0x15 is the I2C SLAVE ADDRESS):
 *  - espressif/esp_lcd_touch_cst816s v1.1.1~1 (BSP dependency),
 *      esp_lcd_touch_cst816s.c:22-23  -> DATA_START_REG 0x02,
 *                                       CHIP_ID_REG 0xA7
 *      esp_lcd_touch_cst816s.c:102-131 -> 8-bit register pointer, 5-byte
 *        point frame [num, x_h:4, x_l, y_h:4, y_l], POINT_NUM_MAX 1,
 *        x = (x_h<<8)|x_l, y = (y_h<<8)|y_l
 *      esp_lcd_touch_cst816s.c:206-212 -> single write of the 8-bit reg
 *        address then rx_param read (repeated-start combined transfer)
 *  - Waveshare SensorLib TouchDrvCST816.h/.cpp (official 1.8 demos):
 *      CST816_SLAVE_ADDRESS 0x15; regs 0x00 status / 0x02 point num /
 *      0x03 XH / 0x04 XL / 0x05 YH / 0x06 YL / 0xA7 CHIP_ID
 *      (CST820 = 0xB7) / 0xA9 FW_VERSION; getPoint() reads 13 bytes
 *      from 0x00 and masks the high coordinate nibble with 0x0F.
 *  - esp32sim esp32s3/src/i2c.rs Cst820 model: 0xA7..0xA9 = B7/41/02,
 *      0x02 = down, 0x03/0x04 = X, 0x05/0x06 = Y (sequential 8-bit reads).
 *
 * Frame: 6 bytes read from register 0x01 (the "6-byte frame"):
 *   [0]=gesture(0x01) [1]=num(0x02) [2]=XH(0x03) [3]=XL(0x04)
 *   [4]=YH(0x05) [5]=YL(0x06).
 * This is a superset of the espressif driver's 5-byte read from 0x02
 * (the extra leading byte is the gesture register) and matches the 1.8
 * demo's 13-byte read from 0x00.
 *
 * Reset is routed through the TCA9554 IO expander (see lume_board.c);
 * the CST9220 path above drives a direct ESP GPIO.
 * ==================================================================== */
#define TP816_I2C_ADDR         LUME_I2C_ADDR_CST9220  /* profile value 0x15 */
#define TP816_I2C_TIMEOUT_MS   200
#define TP816_DATA_REG         0x01   /* 6-byte point-frame start (gesture) */
#define TP816_FRAME_LEN        6
#define TP816_CHIP_ID_REG      0xA7   /* CST820 chip id 0xB7 */
#define TP816_ID_LEN           3      /* 0xA7..0xA9: chip / project / fw */
#define TP816_MAX_READ_ERRORS  10
#define TP816_LOG_INTERVAL_MS  500

static const char *TAG = "lume-touch";
static i2c_master_dev_handle_t s_tp;
static lv_point_t s_last_point = {0};
static bool s_was_pressed = false;
static uint32_t s_last_point_log_ms = 0;
static bool s_point_log_armed = false;
static int s_read_errors = 0;

/* r45: 1.8 board — touch reset is a TOUCH_RST pulse on the TCA9554 IO
 * expander (0x20), not an ESP GPIO (BSP_LCD_TOUCH_RST = GPIO_NUM_NC).
 * Pulse TOUCH_RST only, so indev error recovery never resets the panel. */
static esp_err_t tp_reset(void)
{
    return lume_io_expander_reset(LUME_IO_EXPANDER_TOUCH_RST);
}

/* esp_lcd_touch_cst816s.c:206-212 — 1-byte register address, then read.
 * i2c_master_transmit_receive is the ESP-IDF 5.5 combined write+read
 * (repeated START), the same shape esp_lcd_panel_io_rx_param() uses. */
static esp_err_t tp_read_reg(uint8_t reg, uint8_t *data, size_t len)
{
    return i2c_master_transmit_receive(s_tp, &reg, 1, data, len,
                                       TP816_I2C_TIMEOUT_MS);
}

/* Informational probe; failure is non-fatal (M1 can still read points). */
static void tp_probe(void)
{
    uint8_t id[TP816_ID_LEN] = {0};
    if (tp_read_reg(TP816_CHIP_ID_REG, id, sizeof(id)) == ESP_OK) {
        ESP_LOGI(TAG, "CST816S chip 0x%02X project 0x%02X fw 0x%02X",
                 (unsigned)id[0], (unsigned)id[1], (unsigned)id[2]);
    } else {
        ESP_LOGW(TAG, "CST816S id read failed (continuing)");
    }
}

/* LVGL indev read callback — invoked from lv_timer_handler() in the LVGL task. */
static void indev_read_cb(lv_indev_t *indev, lv_indev_data_t *data)
{
    (void)indev;
    uint8_t frame[TP816_FRAME_LEN] = {0};
    data->state = LV_INDEV_STATE_RELEASED;
    data->continue_reading = false;

    if (tp_read_reg(TP816_DATA_REG, frame, sizeof(frame)) != ESP_OK) {
        /* Transient I2C error: keep the previous point/press state (vendor
         * drivers keep last data on error). After a sustained failure, reset
         * the controller once — mirrors the CST9220 recovery path above. */
        s_read_errors++;
        if (s_read_errors >= TP816_MAX_READ_ERRORS) {
            ESP_LOGW(TAG, "touch bus down after %d read errors, resetting", s_read_errors);
            s_read_errors = 0;
            if (tp_reset() == ESP_OK) {
                return;
            }
        }
        data->point = s_last_point;
        data->state = s_was_pressed ? LV_INDEV_STATE_PRESSED : LV_INDEV_STATE_RELEASED;
        return;
    }
    s_read_errors = 0;

    const uint8_t num = frame[1];             /* reg 0x02: point count */
    if (num == 0 || num == 0xFF) {            /* SensorLib: 0xFF = not ready */
        s_was_pressed = false;
        return;
    }
    const uint16_t tx = (uint16_t)(((uint16_t)(frame[2] & 0x0F) << 8) | frame[3]);
    const uint16_t ty = (uint16_t)(((uint16_t)(frame[4] & 0x0F) << 8) | frame[5]);

    /* Board orientation comes from the profile's LUME_TOUCH_MAP_X/Y (the
     * official BSP uses identity: swap_xy/mirror_x/mirror_y = 0). Clamp. */
    int32_t px = LUME_TOUCH_MAP_X(tx, ty);
    int32_t py = LUME_TOUCH_MAP_Y(tx, ty);
    if (px < 0) px = 0;
    if (py < 0) py = 0;
    if (px >= LUME_LCD_H_RES) px = LUME_LCD_H_RES - 1;
    if (py >= LUME_LCD_V_RES) py = LUME_LCD_V_RES - 1;

    data->point.x = px;
    data->point.y = py;
    data->state = LV_INDEV_STATE_PRESSED;
    s_last_point = data->point;
    s_was_pressed = true;

    uint32_t now_ms = lv_tick_get();
    if (!s_point_log_armed ||
        (uint32_t)(now_ms - s_last_point_log_ms) >= TP816_LOG_INTERVAL_MS) {
        s_point_log_armed = true;
        s_last_point_log_ms = now_ms;
        ESP_LOGI(TAG, "touch p=(%d,%d) raw=(%u,%u)",
                 (int)px, (int)py, (unsigned)tx, (unsigned)ty);
    }
}

esp_err_t lume_touch_init(i2c_master_bus_handle_t bus, lv_display_t *disp)
{
    const i2c_device_config_t dev_cfg = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = TP816_I2C_ADDR,
        .scl_speed_hz = LUME_TOUCH_I2C_SPEED_HZ,
    };
    ESP_RETURN_ON_ERROR(i2c_master_bus_add_device(bus, &dev_cfg, &s_tp),
                        TAG, "CST816S add_device failed");

    ESP_RETURN_ON_ERROR(tp_reset(), TAG, "CST816S reset failed");

    const gpio_config_t int_cfg = {
        .mode = GPIO_MODE_INPUT,
        .pin_bit_mask = 1ULL << LUME_PIN_TP_INT,
        .intr_type = GPIO_INTR_DISABLE,
    };
    ESP_RETURN_ON_ERROR(gpio_config(&int_cfg), TAG, "TP INT gpio config failed");

    tp_probe();

    lv_indev_t *indev = lv_indev_create();
    ESP_RETURN_ON_FALSE(indev != NULL, ESP_ERR_NO_MEM, TAG, "lv_indev_create failed");
    lv_indev_set_type(indev, LV_INDEV_TYPE_POINTER);
    lv_indev_set_read_cb(indev, indev_read_cb);
    lv_indev_set_display(indev, disp);

    ESP_LOGI(TAG, "CST816S -> LVGL indev ready (addr 0x%02x, INT=%d)",
             (unsigned)TP816_I2C_ADDR, LUME_PIN_TP_INT);
    return ESP_OK;
}
#endif /* LUME_TOUCH_CHIP == LUME_TOUCH_CHIP_CST9220 */
