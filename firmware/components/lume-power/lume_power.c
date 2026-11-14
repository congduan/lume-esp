#include "lume_power.h"
#include "lume_board.h"
#include "lume_net.h"
#include "lume_pins.h"
#include "driver/gpio.h"
#include "driver/rtc_io.h"
#include "esp_sleep.h"
#include "esp_log.h"

static const char *TAG = "lume-power";

int lume_power_sleep_now(void)
{
    /* WiFi is started at boot by lume-net even before association. IDF's
     * manual light sleep cannot preserve an active station session. */
    if (lume_net_wifi_started()) return LUME_POWER_ERR_WIFI;
    /* CST9220 INT is active low. A held touch would wake immediately. The
     * normal path polls via LVGL and has no GPIO ISR to disable. */
    if (gpio_get_level(LUME_PIN_TP_INT) == 0) return LUME_POWER_ERR_BUSY;
    esp_err_t err = esp_sleep_enable_ext0_wakeup(LUME_PIN_TP_INT, 0);
    if (err != ESP_OK) return LUME_POWER_ERR_DRIVER;

    err = lume_display_sleep();
    if (err != ESP_OK) {
        esp_sleep_disable_wakeup_source(ESP_SLEEP_WAKEUP_EXT0);
        ESP_LOGE(TAG, "panel sleep failed: %s", esp_err_to_name(err));
        return LUME_POWER_ERR_DRIVER;
    }
    /* Keep PSRAM contents (QuickJS heap and LVGL buffers) during light sleep.
     * IDF's S3 half-sleep mode retains contents with this sdkconfig. */
    err = esp_light_sleep_start();
    esp_sleep_disable_wakeup_source(ESP_SLEEP_WAKEUP_EXT0);
    /* EXT0 switches the pad to RTC IO. Restore the digital input before the
     * LVGL task resumes its touch polling (IDF sleep_modes.rst:217). */
    esp_err_t pin_err = rtc_gpio_deinit(LUME_PIN_TP_INT);
    const gpio_config_t touch_int_cfg = {
        .mode = GPIO_MODE_INPUT,
        .pin_bit_mask = 1ULL << LUME_PIN_TP_INT,
        .intr_type = GPIO_INTR_DISABLE,
    };
    if (pin_err == ESP_OK) pin_err = gpio_config(&touch_int_cfg);
    esp_err_t wake_err = lume_display_wake();
    if (err != ESP_OK || pin_err != ESP_OK || wake_err != ESP_OK) {
        ESP_LOGE(TAG, "light sleep/wake failed: sleep=%s pin=%s panel=%s",
                 esp_err_to_name(err), esp_err_to_name(pin_err), esp_err_to_name(wake_err));
        return LUME_POWER_ERR_DRIVER;
    }
    return LUME_POWER_OK;
}

int lume_power_wake(void)
{
    /* A JS call cannot run while its engine task is blocked in light sleep.
     * This is idempotent for code that calls it after an external wake. */
    return lume_display_wake() == ESP_OK ? LUME_POWER_OK : LUME_POWER_ERR_DRIVER;
}
