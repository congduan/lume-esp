/**
 * CO5300 QSPI AMOLED — clean-room esp_lcd bring-up + LVGL display.
 *
 * Board wiring, geometry, QSPI timing, opcodes and the vendor init command
 * table all come from the selected board profile (lume_board_profile.h, via
 * lume_pins.h); see firmware/boards/README.md and docs/r27-board-param-audit.md.
 * The driver below deliberately contains no board-specific literals.
 *
 * Protocol evidence (read from vendor / IDF source before writing):
 *  - waveshare/esp32_s3_touch_amoled_2_16 BSP v1.0.0 AND v2.0.1,
 *      esp32_s3_touch_amoled_2_16.c:53-71   -> CO5300 init command table
 *      esp32_s3_touch_amoled_2_16.c:424-468 -> bsp_display_new(): QSPI bus
 *        config, panel-io config, vendor flags, reset/init/display-on order
 *      esp32_s3_touch_amoled_2_16.c:499-542 -> LVGL display: double PSRAM buffer
 *  - espressif/esp_lcd_co5300 v1.0.0,
 *      esp_lcd_co5300_spi.c:23-25    -> QSPI opcodes
 *      esp_lcd_co5300_spi.c:142-160  -> tx_param()/tx_color() encode a 32-bit
 *        QSPI command word: (reg<<8) | (opcode<<24), with lcd_cmd_bits=32
 *      esp_lcd_co5300_spi.c:174-190  -> hardware reset timings
 *      esp_lcd_co5300_spi.c:261-290  -> draw_bitmap(): CASET/RASET/RAMWR
 *  - ESP-IDF v5.5.5 esp_lcd/spi/esp_lcd_panel_io_spi.c:398-401 -> quad_mode
 *    sets SPI_TRANS_MODE_QIO on the color phase (that is the QSPI data path)
 *
 * KEY FINDING — the user's premise "QSPI 用 esp_lcd_panel_io_spi 不对" is only
 * half right: the official driver DOES call esp_lcd_new_panel_io_spi(), but in
 * QSPI mode (lcd_cmd_bits=32 + flags.quad_mode=true) with a 32-bit command
 * word [opcode:8][0:8][reg:8][0:8]. A plain 8-bit SPI config is what is wrong.
 */
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_check.h"
#include "esp_heap_caps.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_io_spi.h"
#include "esp_log.h"
#include "lvgl.h"
#include "lume_pins.h"
#include "lume_board_internal.h"

/* Board profile (lume_board_profile.h, re-exported by lume_pins.h) supplies
 * geometry, QSPI bus timing, opcodes and DCS registers. Local aliases keep the
 * driver readable without restating any board value in this file. */
#define LCD_H_RES       LUME_LCD_H_RES
#define LCD_V_RES       LUME_LCD_V_RES
#define LCD_BPP         LUME_LCD_BPP
#define LCD_SPI_HOST    LUME_LCD_SPI_HOST
#define LCD_PCLK_HZ     LUME_LCD_PCLK_HZ
/* Draw buffer height in lines (profile value: 20). Buffers stay in INTERNAL
 * SRAM (see lume_display_init): the SPI driver copies a non-DMA-capable PSRAM
 * buffer into an internal bounce buffer for every transaction, and a
 * full-frame (460800 B) bounce allocation fails with ESP_ERR_NO_MEM. 20 lines
 * = 19200 B per buffer, 38400 B for double buffering, which fits internal RAM
 * and lets the DMA read the draw buffer directly. It also matches the
 * granularity esp-brookesia uses on this board
 * (BROOKESIA_GUI_LVGL_DISPLAY_SOURCE_DEFAULT_BUFFER_HEIGHT = 20). */
#define DRAW_BUF_LINES  LUME_LCD_DRAW_BUF_LINES

#define QSPI_OP_WRITE_CMD   LUME_LCD_QSPI_OP_WRITE_CMD
#define QSPI_OP_WRITE_COLOR LUME_LCD_QSPI_OP_WRITE_COLOR

#define LCD_CMD_CASET   LUME_LCD_CMD_CASET
#define LCD_CMD_RASET   LUME_LCD_CMD_RASET
#define LCD_CMD_RAMWR   LUME_LCD_CMD_RAMWR

/* Build the 32-bit QSPI command word (esp_lcd_co5300_spi.c:142-160). */
static inline int qspi_cmd(uint8_t reg, uint8_t opcode)
{
    return (int)(((uint32_t)opcode << 24) | ((uint32_t)reg << 8));
}

typedef struct {
    uint8_t cmd;
    const uint8_t *data;
    uint8_t len;
    uint16_t delay_ms;
} lume_init_cmd_t;

/* Board profile owns the CO5300 vendor init sequence (Waveshare BSP
 * 1.0.0/2.0.1 esp32_s3_touch_amoled_2_16.c:53-71). CASET/RASET bounds are
 * derived from LUME_LCD_H_RES/V_RES in the profile. */
static const lume_init_cmd_t s_init_cmds[] = {
    LUME_LCD_INIT_CMDS
};

static const char *TAG = "lume-display";
static esp_lcd_panel_io_handle_t s_io;
static lv_display_t *s_disp;

esp_err_t lume_panel_sleep(void)
{
    if (s_io == NULL) return ESP_ERR_INVALID_STATE;
    /* MIPI DCS sleep-in; keep the panel powered so touch stays alive. */
    esp_err_t err = esp_lcd_panel_io_tx_param(s_io,
                        qspi_cmd(LUME_LCD_CMD_SLEEP_IN, QSPI_OP_WRITE_CMD), NULL, 0);
    if (err == ESP_OK) vTaskDelay(pdMS_TO_TICKS(LUME_LCD_SLEEP_IN_SETTLE_MS));
    return err;
}

esp_err_t lume_panel_wake(void)
{
    if (s_io == NULL) return ESP_ERR_INVALID_STATE;
    /* The vendor init table waits after the same sleep-out command. */
    esp_err_t err = esp_lcd_panel_io_tx_param(s_io,
                        qspi_cmd(LUME_LCD_CMD_SLEEP_OUT, QSPI_OP_WRITE_CMD), NULL, 0);
    if (err == ESP_OK) vTaskDelay(pdMS_TO_TICKS(LUME_LCD_SLEEP_OUT_SETTLE_MS));
    return err;
}

void lume_display_invalidate_all(void)
{
    if (s_disp != NULL) lv_obj_invalidate(lv_screen_active());
}

/* CO5300 quirk kept from the vendor BSP (bsp v2.0.1 rounder_event_cb:391-405):
 * round the area start down to even and the end up to odd (2-pixel window).
 * Partial updates at odd boundaries render incorrectly on this panel.
 * LVGL 9 path: LV_EVENT_INVALIDATE_AREA, same hook the BSP uses. */
static void rounder_event_cb(lv_event_t *e)
{
    lv_area_t *area = (lv_area_t *)lv_event_get_param(e);
    if (area == NULL) {
        return;
    }
    area->x1 = (area->x1 >> 1) << 1;
    area->y1 = (area->y1 >> 1) << 1;
    area->x2 = ((area->x2 >> 1) << 1) + 1;
    area->y2 = ((area->y2 >> 1) << 1) + 1;
}

/* Fires in SPI ISR context when the last color DMA chunk completes. */
static bool flush_ready_cb(esp_lcd_panel_io_handle_t io,
                           esp_lcd_panel_io_event_data_t *edata, void *user_ctx)
{
    (void)io;
    (void)edata;
    (void)user_ctx;
    if (s_disp != NULL) {
        lv_display_flush_ready(s_disp);
    }
    return false;
}

static void flush_cb(lv_display_t *disp, const lv_area_t *area, uint8_t *px_map)
{
    (void)disp;
    int32_t x1 = area->x1, x2 = area->x2;
    int32_t y1 = area->y1, y2 = area->y2;

    const size_t px_count = (size_t)(x2 - x1 + 1) * (size_t)(y2 - y1 + 1);
    const size_t len = px_count * (LCD_BPP / 8);

    /* CO5300 0x3A=0x55 (16 bit/pixel) expects big-endian RGB565 on the wire;
     * LVGL renders little-endian and esp_lcd streams the buffer verbatim.
     * Swap in place before DMA, same as esp_lvgl_port_disp.c:739-741 does when
     * swap_bytes is set. Safe with PARTIAL render mode: LVGL rewrites the whole
     * area on the next frame before flushing again. */
    lv_draw_sw_rgb565_swap(px_map, (uint32_t)px_count);

    const uint8_t col[4] = {(uint8_t)(x1 >> 8), (uint8_t)x1,
                            (uint8_t)(x2 >> 8), (uint8_t)x2};
    const uint8_t row[4] = {(uint8_t)(y1 >> 8), (uint8_t)y1,
                            (uint8_t)(y2 >> 8), (uint8_t)y2};

    esp_err_t err = esp_lcd_panel_io_tx_param(s_io, qspi_cmd(LCD_CMD_CASET, QSPI_OP_WRITE_CMD),
                                              col, sizeof(col));
    if (err == ESP_OK) {
        err = esp_lcd_panel_io_tx_param(s_io, qspi_cmd(LCD_CMD_RASET, QSPI_OP_WRITE_CMD),
                                        row, sizeof(row));
    }
    if (err == ESP_OK) {
        err = esp_lcd_panel_io_tx_color(s_io, qspi_cmd(LCD_CMD_RAMWR, QSPI_OP_WRITE_COLOR),
                                        px_map, len);
    }
    if (err != ESP_OK) {
        /* Never leave LVGL's flush wait spinning on a transfer that failed. */
        ESP_LOGE(TAG, "QSPI flush failed: %s", esp_err_to_name(err));
        lv_display_flush_ready(s_disp);
    }
    /* On success lv_display_flush_ready() is called by flush_ready_cb() from
     * on_color_trans_done once the DMA has actually finished. */
}

static esp_err_t panel_io_init(void)
{
    /* CO5300_PANEL_BUS_QSPI_CONFIG — esp_lcd_co5300.h:91-99 */
    const spi_bus_config_t bus_cfg = {
        .sclk_io_num = LUME_PIN_LCD_SCLK,
        .data0_io_num = LUME_PIN_LCD_DATA0,
        .data1_io_num = LUME_PIN_LCD_DATA1,
        .data2_io_num = LUME_PIN_LCD_DATA2,
        .data3_io_num = LUME_PIN_LCD_DATA3,
        .max_transfer_sz = LCD_H_RES * LCD_V_RES * (LCD_BPP / 8),
    };
    ESP_RETURN_ON_ERROR(spi_bus_initialize(LCD_SPI_HOST, &bus_cfg, SPI_DMA_CH_AUTO),
                        TAG, "spi_bus_initialize(QSPI) failed");

    /* CO5300_PANEL_IO_QSPI_CONFIG — esp_lcd_co5300.h:117-131.
     * Queue depth / cmd-width / param-width come from the board profile. */
    const esp_lcd_panel_io_spi_config_t io_cfg = {
        .cs_gpio_num = LUME_PIN_LCD_CS,
        .dc_gpio_num = -1,                 /* QSPI: command encoded in the 32-bit word */
        .spi_mode = LUME_LCD_SPI_MODE,
        .pclk_hz = LCD_PCLK_HZ,
        .trans_queue_depth = LUME_LCD_TRANS_QUEUE_DEPTH,
        .on_color_trans_done = flush_ready_cb,
        .user_ctx = NULL,
        .lcd_cmd_bits = LUME_LCD_CMD_BITS,
        .lcd_param_bits = LUME_LCD_PARAM_BITS,
        .flags = {
            .quad_mode = true,
        },
    };
    ESP_RETURN_ON_ERROR(esp_lcd_new_panel_io_spi((esp_lcd_spi_bus_handle_t)LCD_SPI_HOST,
                                                 &io_cfg, &s_io),
                        TAG, "esp_lcd_new_panel_io_spi(QSPI) failed");
    return ESP_OK;
}

static esp_err_t panel_init(void)
{
    /* Hardware reset — esp_lcd_co5300_spi.c:174-190; timings from profile. */
    const gpio_config_t rst_cfg = {
        .mode = GPIO_MODE_OUTPUT,
        .pin_bit_mask = 1ULL << LUME_PIN_LCD_RST,
    };
    ESP_RETURN_ON_ERROR(gpio_config(&rst_cfg), TAG, "LCD RST gpio config failed");
    ESP_RETURN_ON_ERROR(gpio_set_level(LUME_PIN_LCD_RST, 0), TAG, "LCD RST low failed");
    vTaskDelay(pdMS_TO_TICKS(LUME_LCD_RST_LOW_MS));
    ESP_RETURN_ON_ERROR(gpio_set_level(LUME_PIN_LCD_RST, 1), TAG, "LCD RST high failed");
    vTaskDelay(pdMS_TO_TICKS(LUME_LCD_RST_HIGH_MS));

    for (size_t i = 0; i < sizeof(s_init_cmds) / sizeof(s_init_cmds[0]); i++) {
        const lume_init_cmd_t *c = &s_init_cmds[i];
        ESP_RETURN_ON_ERROR(esp_lcd_panel_io_tx_param(s_io,
                                                      qspi_cmd(c->cmd, QSPI_OP_WRITE_CMD),
                                                      c->data, c->len),
                            TAG, "init cmd 0x%02x failed", (unsigned)c->cmd);
        if (c->delay_ms != 0) {
            vTaskDelay(pdMS_TO_TICKS(c->delay_ms));
        }
    }
    /* The BSP additionally calls esp_lcd_panel_disp_on_off(panel, true), which
     * just re-sends 0x29; our table already ends with 0x29 + 600ms, so the
     * display-on step is covered without the redundant transfer. */
    return ESP_OK;
}

esp_err_t lume_display_init(lv_display_t **out_disp)
{
    ESP_RETURN_ON_FALSE(out_disp != NULL, ESP_ERR_INVALID_ARG, TAG, "out_disp is NULL");

    ESP_RETURN_ON_ERROR(panel_io_init(), TAG, "QSPI panel IO init failed");
    ESP_RETURN_ON_ERROR(panel_init(), TAG, "CO5300 init failed");

    lv_display_t *disp = lv_display_create(LCD_H_RES, LCD_V_RES);
    ESP_RETURN_ON_FALSE(disp != NULL, ESP_ERR_NO_MEM, TAG, "lv_display_create failed");
    s_disp = disp;

    /* Draw buffers live in INTERNAL SRAM so the QSPI DMA reads them in place.
     * A PSRAM buffer is not DMA-capable: spi_master copies every transaction
     * into an internal "priv" bounce buffer (setup_dma_priv_buffer), which
     * costs one extra copy per flush and fails with ESP_ERR_NO_MEM as soon as
     * the transfer gets large (a full-frame 460800 B bounce cannot be
     * allocated). PSRAM is kept as a fallback in case internal RAM is tight. */
    const size_t buf_bytes = (size_t)LCD_H_RES * DRAW_BUF_LINES * (LCD_BPP / 8);
    const uint32_t internal_caps = MALLOC_CAP_INTERNAL | MALLOC_CAP_DMA | MALLOC_CAP_8BIT;
    void *buf1 = heap_caps_malloc(buf_bytes, internal_caps);
    void *buf2 = heap_caps_malloc(buf_bytes, internal_caps);
    const char *where = "SRAM";
    if (buf1 == NULL || buf2 == NULL) {
        free(buf1);
        free(buf2);
        buf1 = heap_caps_malloc(buf_bytes, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
        buf2 = heap_caps_malloc(buf_bytes, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
        where = "PSRAM";
    }
    if (buf1 == NULL || buf2 == NULL) {
        ESP_LOGE(TAG, "draw buffer alloc failed (%u bytes each)", (unsigned)buf_bytes);
        free(buf1);
        free(buf2);
        return ESP_ERR_NO_MEM;
    }
    lv_display_set_buffers(disp, buf1, buf2, (uint32_t)buf_bytes,
                           LV_DISPLAY_RENDER_MODE_PARTIAL);
    lv_display_set_flush_cb(disp, flush_cb);
    /* Vendor BSP registers the same rounder right after display creation
     * (bsp v2.0.1 esp32_s3_touch_amoled_2_16.c:532). */
    lv_display_add_event_cb(disp, rounder_event_cb, LV_EVENT_INVALIDATE_AREA, NULL);

    *out_disp = disp;
    ESP_LOGI(TAG, "CO5300 QSPI + LVGL display up (%dx%d RGB565, 2x%u B %s draw buf)",
             LCD_H_RES, LCD_V_RES, (unsigned)buf_bytes, where);
    return ESP_OK;
}
