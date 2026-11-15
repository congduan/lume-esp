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
#include "freertos/semphr.h"
#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_check.h"
#include "esp_heap_caps.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_io_spi.h"
#include "esp_log.h"
#include "lvgl.h"
#include "lume_pins.h"
#include "lume_board.h"
#include "lume_board_internal.h"
#include "lume_perf.h"
#include <string.h>

/* Board profile (lume_board_profile.h, re-exported by lume_pins.h) supplies
 * geometry, QSPI bus timing, opcodes and DCS registers. Local aliases keep the
 * driver readable without restating any board value in this file. */
#define LCD_H_RES       LUME_LCD_H_RES
#define LCD_V_RES       LUME_LCD_V_RES
#define LCD_BPP         LUME_LCD_BPP
#define LCD_SPI_HOST    LUME_LCD_SPI_HOST
#define LCD_PCLK_HZ     LUME_LCD_PCLK_HZ
/* The A/B height is selected by Kconfig; 48 falls back to 20 on allocation failure. */
#define DRAW_BUF_LINES CONFIG_LUME_DRAW_BUF_LINES

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
#if CONFIG_LUME_PERF_PROFILE
static bool s_flushed_this_refresh;
static int64_t s_render_start;
static void render_start_cb(lv_event_t *e) { (void)e; s_render_start = lume_perf_now(); }
static void render_ready_cb(lv_event_t *e)
{
    (void)e;
    lume_perf_add(LUME_PERF_RENDER, lume_perf_now() - s_render_start);
}
#endif

/* ------------------------------------------------------------------ */
/* Debug screen capture (r35) — see lume_board.h for the contract.     */
/*                                                                      */
/* Cross-thread model (same discipline as the rest of the file,         */
/* LV_USE_OS == LV_OS_NONE): flush_cb, capture_refr_event_cb and        */
/* capture_tick() run ONLY on the LVGL task. The requesting task        */
/* (lume-hotreload) touches the state only under s_cap_lock, waits on   */
/* its own semaphore and then reads the finished shadow buffer. The     */
/* shadow buffer is allocated once and never freed, so flush_cb can     */
/* never copy into released memory even if a capture is cancelled       */
/* mid-flight (docs/KNOWN-SIMPLIFICATIONS.md).                          */
static SemaphoreHandle_t s_cap_lock;   /* guards done/cancel/req        */
static uint8_t *s_cap_buf;             /* PSRAM shadow, w*h*2 bytes     */
static size_t   s_cap_stride;          /* destination row bytes (w*2)   */
static uint16_t s_cap_w, s_cap_h;
static SemaphoreHandle_t s_cap_done;   /* non-NULL <=> capture pending  */
static volatile bool s_cap_req;        /* request -> LVGL tick          */
static volatile bool s_cap_cancel;     /* cancel   -> LVGL tick         */
static volatile bool s_cap_copying;    /* LVGL task: flush_cb copies    */
static const uint8_t *s_cap_ready;     /* fresh frame, NULL when armed  */

/* flush_cb hook (LVGL task): copy the flushed area into the shadow buffer
 * BEFORE the panel byte swap, so the shadow holds host-order (little-endian)
 * RGB565 — the layout a BMP/PNG encoder on the host expects. */
static void capture_copy_area(const lv_area_t *area, const uint8_t *px_map)
{
    if (!s_cap_copying || s_cap_buf == NULL) {
        return;
    }
    int32_t x1 = area->x1, x2 = area->x2;
    int32_t y1 = area->y1, y2 = area->y2;
    if (x2 >= s_cap_w) x2 = (int32_t)s_cap_w - 1;
    if (y2 >= s_cap_h) y2 = (int32_t)s_cap_h - 1;
    if (x1 < 0 || y1 < 0 || x1 > x2 || y1 > y2) {
        return;
    }
    const uint32_t src_stride = lv_draw_buf_width_to_stride(
        lv_area_get_width(area), lv_display_get_color_format(s_disp));
    const size_t row_bytes = (size_t)(x2 - x1 + 1) * (LCD_BPP / 8);
    for (int32_t y = y1; y <= y2; y++) {
        memcpy(s_cap_buf + (size_t)y * s_cap_stride + (size_t)x1 * (LCD_BPP / 8),
               px_map + (size_t)(y - y1) * src_stride, row_bytes);
    }
}

/* LV_EVENT_REFR_READY (LVGL task): every flush_cb of the refresh cycle ran
 * before this point (lv_refr.c: refr_invalid_areas -> REFR_READY), so the
 * shadow buffer is complete. Never signals a capture the caller cancelled
 * (s_cap_done already cleared under the lock). */
static void capture_refr_event_cb(lv_event_t *e)
{
    (void)e;
#if CONFIG_LUME_PERF_PROFILE
    if (s_flushed_this_refresh) lume_perf_frame();
    s_flushed_this_refresh = false;
#endif
    if (!s_cap_copying || s_cap_lock == NULL) {
        return;
    }
    s_cap_copying = false;
    s_cap_ready = s_cap_buf;
    xSemaphoreTake(s_cap_lock, portMAX_DELAY);
    SemaphoreHandle_t done = s_cap_done;
    s_cap_done = NULL;
    xSemaphoreGive(s_cap_lock);
    if (done != NULL) {
        xSemaphoreGive(done);
    }
}

void lume_display_capture_tick(void)
{
    /* LVGL task only (lume_board.c lvgl_task loop, never while paused). */
    if (s_cap_lock == NULL) {
        return;
    }
    bool start = false;
    xSemaphoreTake(s_cap_lock, portMAX_DELAY);
    if (s_cap_cancel) {
        s_cap_cancel = false;
        s_cap_req = false;
        s_cap_copying = false;
        s_cap_done = NULL;      /* caller already gave up; drop its handle */
    } else if (s_cap_req && s_cap_done != NULL) {
        s_cap_req = false;
        s_cap_ready = NULL;
        start = true;
    }
    xSemaphoreGive(s_cap_lock);
    if (start) {
        s_cap_copying = true;
        /* Force a full-frame refresh: with no dirty areas LVGL emits
         * REFR_REQUEST only (lv_refr.c), never START/READY + flushes. */
        lume_display_invalidate_all();
    }
}

esp_err_t lume_display_capture(SemaphoreHandle_t done,
                               uint16_t *out_w, uint16_t *out_h)
{
    if (s_disp == NULL || done == NULL || s_cap_lock == NULL) {
        return ESP_ERR_INVALID_STATE;
    }
    esp_err_t err = ESP_OK;
    xSemaphoreTake(s_cap_lock, portMAX_DELAY);
    if (s_cap_done != NULL) {
        err = ESP_ERR_INVALID_STATE;    /* one capture at a time */
    } else {
        if (s_cap_buf == NULL) {
            const uint16_t w =
                (uint16_t)lv_display_get_horizontal_resolution(s_disp);
            const uint16_t h =
                (uint16_t)lv_display_get_vertical_resolution(s_disp);
            uint8_t *buf = heap_caps_malloc(
                (size_t)w * h * (LCD_BPP / 8), MALLOC_CAP_SPIRAM);
            if (buf == NULL) {
                ESP_LOGE(TAG, "capture shadow alloc failed (%ux%u RGB565)",
                         w, h);
                err = ESP_ERR_NO_MEM;
            } else {
                s_cap_buf = buf;
                s_cap_w = w;
                s_cap_h = h;
                s_cap_stride = (size_t)w * (LCD_BPP / 8);
                ESP_LOGI(TAG, "capture shadow ready (%ux%u RGB565, %u B PSRAM)",
                         w, h, (unsigned)((size_t)w * h * (LCD_BPP / 8)));
            }
        }
        if (err == ESP_OK) {
            s_cap_ready = NULL;
            s_cap_done = done;
            s_cap_req = true;
        }
    }
    xSemaphoreGive(s_cap_lock);
    if (err == ESP_OK) {
        if (out_w != NULL) *out_w = s_cap_w;
        if (out_h != NULL) *out_h = s_cap_h;
    }
    return err;
}

const uint8_t *lume_display_capture_buf(uint16_t *out_w, uint16_t *out_h)
{
    if (out_w != NULL) *out_w = s_cap_w;
    if (out_h != NULL) *out_h = s_cap_h;
    return s_cap_ready;
}

void lume_display_capture_cancel(void)
{
    if (s_cap_lock == NULL) {
        return;
    }
    /* Synchronously invalidate the pending capture so the REFR callback can
     * never signal a semaphore the caller is about to delete (a refresh cycle
     * completing between cancel() and the LVGL task's next tick would still
     * see s_cap_done set otherwise). The tick later resets copying/req. */
    xSemaphoreTake(s_cap_lock, portMAX_DELAY);
    s_cap_cancel = s_cap_done != NULL;
    s_cap_done = NULL;
    xSemaphoreGive(s_cap_lock);
}

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
#if CONFIG_LUME_PERF_PROFILE
    int64_t flush_start = lume_perf_now();
    unsigned transactions = 0;
#endif
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
    capture_copy_area(area, px_map);   /* debug capture: pre-swap LE copy */
    lv_draw_sw_rgb565_swap(px_map, (uint32_t)px_count);

    const uint8_t col[4] = {(uint8_t)(x1 >> 8), (uint8_t)x1,
                            (uint8_t)(x2 >> 8), (uint8_t)x2};
    const uint8_t row[4] = {(uint8_t)(y1 >> 8), (uint8_t)y1,
                            (uint8_t)(y2 >> 8), (uint8_t)y2};

    esp_err_t err = esp_lcd_panel_io_tx_param(s_io, qspi_cmd(LCD_CMD_CASET, QSPI_OP_WRITE_CMD),
                                              col, sizeof(col));
#if CONFIG_LUME_PERF_PROFILE
    transactions++;
#endif
    if (err == ESP_OK) {
        err = esp_lcd_panel_io_tx_param(s_io, qspi_cmd(LCD_CMD_RASET, QSPI_OP_WRITE_CMD),
                                        row, sizeof(row));
#if CONFIG_LUME_PERF_PROFILE
        transactions++;
#endif
    }
    if (err == ESP_OK) {
        err = esp_lcd_panel_io_tx_color(s_io, qspi_cmd(LCD_CMD_RAMWR, QSPI_OP_WRITE_COLOR),
                                        px_map, len);
#if CONFIG_LUME_PERF_PROFILE
        transactions++;
#endif
    }
#if CONFIG_LUME_PERF_PROFILE
    lume_perf_flush_count(transactions);
    lume_perf_add(LUME_PERF_FLUSH, lume_perf_now() - flush_start);
    s_flushed_this_refresh = true;
#endif
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

    /* Both buffers must be internal DMA SRAM. A failed 48-line attempt is
     * released completely before retrying the known 20-line configuration. */
    const uint32_t internal_caps = MALLOC_CAP_INTERNAL | MALLOC_CAP_DMA | MALLOC_CAP_8BIT;
    unsigned lines = DRAW_BUF_LINES;
    size_t buf_bytes = (size_t)LCD_H_RES * lines * (LCD_BPP / 8);
    size_t largest = heap_caps_get_largest_free_block(internal_caps);
    void *buf1 = NULL, *buf2 = NULL;
    if (largest >= buf_bytes) buf1 = heap_caps_malloc(buf_bytes, internal_caps);
    if (buf1) buf2 = heap_caps_malloc(buf_bytes, internal_caps);
    if ((!buf1 || !buf2) && lines != 20) {
        free(buf1);
        free(buf2);
        ESP_LOGW(TAG, "%u-line DMA buffers unavailable (each=%u, largest-before=%u); retrying 20 lines",
                 lines, (unsigned)buf_bytes, (unsigned)largest);
        lines = 20;
        buf_bytes = (size_t)LCD_H_RES * lines * (LCD_BPP / 8);
        buf1 = heap_caps_malloc(buf_bytes, internal_caps);
        buf2 = heap_caps_malloc(buf_bytes, internal_caps);
    }
    if (!buf1 || !buf2) {
        free(buf1);
        free(buf2);
        ESP_LOGE(TAG, "20-line DMA draw buffer allocation failed (each=%u)", (unsigned)buf_bytes);
        return ESP_ERR_NO_MEM;
    }
    lv_display_set_buffers(disp, buf1, buf2, (uint32_t)buf_bytes,
                           LV_DISPLAY_RENDER_MODE_PARTIAL);
    lv_display_set_flush_cb(disp, flush_cb);
    /* Vendor BSP registers the same rounder right after display creation
     * (bsp v2.0.1 esp32_s3_touch_amoled_2_16.c:532). */
    lv_display_add_event_cb(disp, rounder_event_cb, LV_EVENT_INVALIDATE_AREA, NULL);
    /* Screen capture completion point: REFR_READY closes every refresh cycle
     * (lv_refr.c:429), after all flush_cb calls of that cycle. */
    lv_display_add_event_cb(disp, capture_refr_event_cb, LV_EVENT_REFR_READY, NULL);
#if CONFIG_LUME_PERF_PROFILE
    lv_display_add_event_cb(disp, render_start_cb, LV_EVENT_RENDER_START, NULL);
    lv_display_add_event_cb(disp, render_ready_cb, LV_EVENT_RENDER_READY, NULL);
#endif

    s_cap_lock = xSemaphoreCreateMutex();
    if (s_cap_lock == NULL) {
        ESP_LOGE(TAG, "capture lock alloc failed (captures disabled)");
    }

    *out_disp = disp;
    ESP_LOGI(TAG, "CO5300 QSPI + LVGL display up (%dx%d RGB565, 2x%u B %s draw buf)",
             LCD_H_RES, LCD_V_RES, (unsigned)buf_bytes, "SRAM");
    return ESP_OK;
}
