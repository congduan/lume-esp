/**
 * Board init — M1 bring-up.
 *
 * Order (each step verified against vendor examples):
 *   1. I2C master on the profile's SDA/SCL — shared by touch/PMIC/IMU/codecs
 *   2. AXP2101: assert display/touch rails (isolated, non-fatal)
 *   3. CO5300 QSPI panel via esp_lcd + LVGL display
 *   4. CST9220 touch -> LVGL indev
 *   5. TF card (SPI/FATFS)                                    (later)
 *
 * LVGL: lv_init -> lv_tick_set_cb(esp_timer) -> lv_display_create ->
 * flush_cb(QSPI DMA) -> lv_timer_handler task. LVGL 9 dropped LV_TICK_CUSTOM,
 * so the 1 ms tick source must be registered at runtime; without it
 * lv_tick_get() stays 0 and no lv_timer (render refresh, ui-bridge drain)
 * ever fires.
 */
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include <stdatomic.h>
#include "driver/i2c_master.h"
#include "esp_check.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "lvgl.h"
#include "lume_pins.h"
#include "lume_board.h"
#include "lume_board_internal.h"
#include "lume_board_hal.h"
#include "lume_perf.h"

static const char *TAG = "lume-board";

/* r176: publish the real drivers into the runtime HAL registry. This is an
 * OBSERVATION POINT only -- lume_board_init() below still calls the drivers
 * directly, so nothing changes at runtime. esp_err_t uses positive error
 * codes while the HAL uses 0 / negative, hence the mapping. */
static int hal_err(esp_err_t err)
{
    if (err == ESP_OK) return 0;
    return err > 0 ? -err : err;
}

static int hal_panel_init(void **out_panel)
{
    return hal_err(lume_display_init((lv_display_t **)out_panel));
}

static int hal_touch_init(void *bus, void *panel)
{
    return hal_err(lume_touch_init((i2c_master_bus_handle_t)bus,
                                   (lv_display_t *)panel));
}

static int hal_touch_read(int *out_x, int *out_y, int *out_pressed)
{
    (void)out_x;
    (void)out_y;
    (void)out_pressed;
    /* lume_touch.c has no standalone point-read API: the real read happens
     * inside its static LVGL indev callback. Exposing a raw read would mean
     * refactoring the driver, which is out of scope for this zero-behaviour-
     * change slice. Advertise this op as unsupported (non-NULL, returns -1)
     * until such an API exists; all three init ops above are real. */
    return LUME_BOARD_ERR_NOT_SUPPORTED;
}

static int hal_power_init(void *bus)
{
    return hal_err(lume_pmic_display_power_on((i2c_master_bus_handle_t)bus));
}

static const lume_board_t s_runtime_board = {
    .panel_init = hal_panel_init,
    .touch_init = hal_touch_init,
    .touch_read = hal_touch_read,
    .power_init = hal_power_init,
    .board_id   = LUME_BOARD_NAME,   /* selected profile's board-name macro */
};

/* Shared I2C bus handle, published for other components (lume-pmic) via
 * lume_board_get_i2c_bus(). Set once by lume_board_init(), never deleted. */
static i2c_master_bus_handle_t s_i2c_bus = NULL;
static atomic_bool s_frame_paused;
static atomic_bool s_redraw_pending;
static SemaphoreHandle_t s_pause_ack;
static bool s_panel_asleep;
static TaskHandle_t s_lvgl_task;

/* LVGL 9 tick source: monotonic milliseconds from esp_timer (already running
 * this early in boot). Registered in lume_board_init() after lv_init(). */
static uint32_t lvgl_tick_get_cb(void)
{
    return (uint32_t)(esp_timer_get_time() / 1000LL);
}

#if LV_USE_SYSMON
/* LV_SYSMON_GET_IDLE. LVGL only implements idle accounting for its OS
 * backends, and this build uses LV_USE_OS 0, so the CPU column is not
 * available: report 0% idle (the log line then always says CPU 100%). The
 * meaningful columns are FPS and the render / flush millisecond split.
 * Symbol must be non-static because lv_sysmon.c declares it locally. */
uint32_t lume_sysmon_idle_percent(void)
{
    return 0;
}

/* Forward LVGL's own log stream (perf monitor log mode) into ESP-IDF logging so
 * it carries boot timestamps and lands in the same capture as lume-* lines. */
static void lvgl_log_print_cb(lv_log_level_t level, const char *buf)
{
    (void)level;
    ESP_LOGI("lvgl-perf", "%s", buf);
}
#endif /* LV_USE_SYSMON */

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
    extern void lume_ui_bridge_set_wake_cb(void (*wake_cb)(void));

    lv_obj_t *scr = lv_screen_active();
    lv_obj_set_style_bg_color(scr, lv_color_hex(0x0B1E3F), 0);
    lv_obj_set_style_bg_opa(scr, LV_OPA_COVER, 0);

    /* Yield the screen to the declarative JS demo. This also creates the LVGL
     * drain timer here, on the main task BEFORE lvgl_task starts -> no race
     * with a running lv_timer_handler (LV_USE_OS == LV_OS_NONE). */
    lume_ui_bridge_init();
    /* Queue A posts do not create/resume an LVGL timer, so LVGL's own
     * resume callback cannot see them. Register a wake hook so the LVGL
     * task drains a freshly posted message immediately instead of waiting
     * for the next timer deadline. */
    lume_ui_bridge_set_wake_cb(lume_lvgl_wake);
#endif
}

/* LVGL calls this from lv_timer_create/resume/reset/enable via
 * lv_timer_handler_resume() (vendored lv_timer.c:375-382). Mirror LVGL's own
 * libuv/NuttX port (src/drivers/nuttx/lv_nuttx_libuv.c:141-166): a timer that
 * becomes due while we sleep must wake the handler now, not at the old
 * deadline. A null handle means the task has not started yet (bridge init on
 * the main task creates the drain timer before lvgl_task runs). */
static void lvgl_resume_cb(void *data)
{
    (void)data;
    if (s_lvgl_task != NULL) xTaskNotifyGive(s_lvgl_task);
}

/* Board-internal cross-task wake hook. Producers that do not create an LVGL
 * timer (panel wake, screen capture, Queue A posts via the registered
 * ui-bridge callback) call this after publishing their request so the LVGL
 * task services it immediately. Safe before task creation (no-op). */
void lume_lvgl_wake(void)
{
    if (s_lvgl_task != NULL) xTaskNotifyGive(s_lvgl_task);
}

/* LVGL super-loop. M1: all LVGL calls are confined to this task + the ISR
 * flush-ready callback; M3's JS bridge must add a mutex before touching LVGL
 * from the engine task. r93: deadline sleep woken by notifications; no fixed
 * poll cap. */
static void lvgl_task(void *arg)
{
    (void)arg;
    s_lvgl_task = xTaskGetCurrentTaskHandle();
    lv_timer_handler_set_resume_cb(lvgl_resume_cb, NULL);
    for (;;) {
        if (atomic_load(&s_frame_paused)) {
            xSemaphoreGive(s_pause_ack);
            /* Notification-aware pause poll so lume_display_wake() can cut
             * the 10 ms pause tick short. */
            ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(10));
            continue;
        }
        if (atomic_exchange(&s_redraw_pending, false)) lume_display_invalidate_all();
        lume_display_capture_tick();
        uint32_t wait_ms = lv_timer_handler();
#if CONFIG_LUME_PERF_PROFILE
        lume_perf_log_second();
#endif
        /* LV_NO_TIMER_READY is UINT32_MAX: sleep until a notification wakes
         * us. Otherwise sleep exactly to LVGL's next deadline. The sleep is
         * interrupted early by lvgl_resume_cb (an LVGL timer became due) or
         * by lume_lvgl_wake() (a cross-task request). This replaces r36b's
         * `if (wait_ms > 10) wait_ms = 10` fixed poll cap. A zero return
         * means "retry now"; clamp to 1 ms only to avoid a busy loop.
         * lv_tick is driven by esp_timer (lume_board.c:43-46), not by this
         * task's sleep, so animation deadlines do not drift. */
        TickType_t wait_ticks;
        if (wait_ms == LV_NO_TIMER_READY) {
            wait_ticks = portMAX_DELAY;
        } else {
            if (wait_ms == 0) wait_ms = 1;
            wait_ticks = pdMS_TO_TICKS(wait_ms);
        }
        ulTaskNotifyTake(pdTRUE, wait_ticks);
    }
}

esp_err_t lume_display_sleep(void)
{
    if (s_pause_ack == NULL) return ESP_ERR_INVALID_STATE;
    if (s_panel_asleep) return ESP_OK;
    xSemaphoreTake(s_pause_ack, 0); /* discard an old acknowledgement */
    atomic_store(&s_frame_paused, true);
    lume_lvgl_wake(); /* cut short the current deadline sleep */
    if (xSemaphoreTake(s_pause_ack, pdMS_TO_TICKS(1000)) != pdTRUE) {
        atomic_store(&s_frame_paused, false);
        return ESP_ERR_TIMEOUT;
    }
    esp_err_t err = lume_panel_sleep();
    if (err != ESP_OK) atomic_store(&s_frame_paused, false);
    else s_panel_asleep = true;
    return err;
}

esp_err_t lume_display_wake(void)
{
    if (!s_panel_asleep) return ESP_OK;
    esp_err_t err = lume_panel_wake();
    if (err == ESP_OK) {
        s_panel_asleep = false;
        atomic_store(&s_redraw_pending, true);
        atomic_store(&s_frame_paused, false);
        lume_lvgl_wake(); /* leave the paused 10 ms tick immediately */
    }
    return err;
}

i2c_master_bus_handle_t lume_board_get_i2c_bus(void)
{
    return s_i2c_bus;
}

#if LUME_HAS_IO_EXPANDER_RESET
/* r45: 1.8 V2 — LCD/touch/power-enable resets live on the TCA9554 IO
 * expander (0x20), not ESP GPIOs (BSP BSP_LCD_RST / BSP_LCD_TOUCH_RST are
 * GPIO_NUM_NC). Bit map and sequence are from the official Waveshare
 * ESP-IDF demos 90_axp2101_pmu / 92_qmi8658_imu board_variant.c:23-30,41-71.
 *
 * Only rst_bits are pulled low; SD_CS and the other output bits stay high.
 * Panel init passes LUME_IO_EXPANDER_RST_ALL (LCD + PWR_EN + TOUCH); the
 * touch indev error-recovery path passes TOUCH_RST only, so re-probing the
 * controller never resets the already-initialised CO5300 panel. */
esp_err_t lume_io_expander_reset(uint8_t rst_bits)
{
    const i2c_device_config_t dev_cfg = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = LUME_IO_EXPANDER_ADDR,
        .scl_speed_hz = LUME_TOUCH_I2C_SPEED_HZ,
    };
    i2c_master_dev_handle_t dev = NULL;
    ESP_RETURN_ON_ERROR(i2c_master_bus_add_device(s_i2c_bus, &dev_cfg, &dev),
                        TAG, "TCA9554 add_device failed");

    /* [reg, value] pairs — same as the demo's io_expander_write(). */
    const uint8_t cfg[2]  = {LUME_IO_EXPANDER_REG_CONFIG,
                             (uint8_t)~LUME_IO_EXPANDER_OUTPUT_MASK};
    const uint8_t low[2]  = {LUME_IO_EXPANDER_REG_OUTPUT,
                             (uint8_t)(LUME_IO_EXPANDER_OUTPUT_MASK & ~rst_bits)};
    const uint8_t high[2] = {LUME_IO_EXPANDER_REG_OUTPUT,
                             (uint8_t)LUME_IO_EXPANDER_OUTPUT_MASK};
    esp_err_t err = i2c_master_transmit(dev, cfg, sizeof(cfg), 200);
    if (err == ESP_OK) {
        err = i2c_master_transmit(dev, low, sizeof(low), 200);
    }
    vTaskDelay(pdMS_TO_TICKS(20));               /* demo: reset asserted 20ms */
    if (err == ESP_OK) {
        err = i2c_master_transmit(dev, high, sizeof(high), 200);
    }
    vTaskDelay(pdMS_TO_TICKS(150));              /* demo: settle 150ms */

    esp_err_t rm = i2c_master_bus_rm_device(dev);
    if (err == ESP_OK) {
        err = rm;
    }
    return err;
}
#endif /* LUME_HAS_IO_EXPANDER_RESET */

esp_err_t lume_board_init(void)
{
    /* 0. Publish the real driver vtable to the HAL registry (r176). This is
     * non-fatal and purely observational: the steps below still call the
     * drivers directly, so registration cannot change board behaviour. */
    (void)lume_board_hal_register(&s_runtime_board);

    /* 1. Shared I2C master bus: AXP2101 / CST9220 / IMU / codec / RTC all use
     * the addresses from the board profile (lume_pins.h). */
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
    s_i2c_bus = bus;   /* publish for cross-component users (no init-order change) */

    /* 2. PMIC rails first, before anything drives the panel. Non-fatal by design
     * (see lume_pmic.c): the vendor examples rely on OTP defaults. */
    esp_err_t pmic_err = lume_pmic_display_power_on(bus);
    if (pmic_err != ESP_OK) {
        ESP_LOGW(TAG, "PMIC rail setup skipped/failed (%s); continuing", esp_err_to_name(pmic_err));
    }

    /* 3. LVGL core must be up before any display / indev / widget. */
    lv_init();
    /* LVGL 9: the tick source is runtime-registered. Without this call
     * lv_tick_get() stays 0, so every lv_timer (display refresh and the
     * ui-bridge drain timer) never becomes due: the screen stays blank and
     * JS messages pile up until "ui queue full". */
    lv_tick_set_cb(lvgl_tick_get_cb);

#if LV_USE_SYSMON
    /* Diagnostics: LVGL perf monitor (FPS + render/flush ms) printed through
     * ESP_LOGI("lvgl-perf") every 300 ms. Off unless lv_conf.h turns it on. */
    lv_log_register_print_cb(lvgl_log_print_cb);
    lv_sysmon_show_performance(NULL);
#endif

    lv_display_t *disp = NULL;
    ESP_RETURN_ON_ERROR(lume_display_init(&disp), TAG, "CO5300/LVGL display init failed");
    lv_timer_set_period(lv_display_get_refr_timer(disp), CONFIG_LUME_REFRESH_PERIOD_MS);

    /* 4. Touch -> LVGL indev (M1: LVGL only; M3 also posts to the JS queue). */
    ESP_RETURN_ON_ERROR(lume_touch_init(bus, disp), TAG, "CST9220/LVGL indev init failed");

    create_demo_ui();

    s_pause_ack = xSemaphoreCreateBinary();
    ESP_RETURN_ON_FALSE(s_pause_ack != NULL, ESP_ERR_NO_MEM, TAG, "pause semaphore alloc failed");

    BaseType_t task_ok = xTaskCreate(lvgl_task, "lume-lvgl", 8192, NULL, 5, NULL);
    if (task_ok != pdPASS) {
        ESP_RETURN_ON_ERROR(ESP_ERR_NO_MEM, TAG, "lvgl task creation failed");
    }

    ESP_LOGI(TAG, "board init done: CO5300 QSPI + CST9220 + LVGL pipeline up");
    return ESP_OK;
}
