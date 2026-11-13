/**
 * Lume firmware entry point.
 *
 * Boot order:
 *   1. Board init (power rails via AXP2101, display bus, touch, TF card)
 *   2. LVGL render backend init (CO5300 QSPI)
 *   3. QuickJS-NG engine task start (heap in PSRAM)
 *   4. Load app bytecode (built-in fallback until hot-reload lands)
 *   5. Hot-reload server on USB CDC
 */
#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "lume.h"

static const char *TAG = "lume";

void app_main(void)
{
    ESP_LOGI(TAG, "Lume runtime booting...");

    esp_err_t err = lume_board_init();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "board init failed: %s", esp_err_to_name(err));
        return;
    }

    lume_engine_start();

    /* M1: engine runs a built-in bytecode bundle; hot reload hooks in M1.x */
    lume_hotreload_start();
}
