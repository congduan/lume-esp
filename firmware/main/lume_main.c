/**
 * Lume firmware entry point.
 *
 * Boot order:
 *   1. Board init (power rails via AXP2101, display bus, touch, TF card)
 *   2. LVGL render backend init (CO5300 QSPI)
 *   3. QuickJS-NG engine task start (heap in PSRAM)
 *   4. Engine boots the embedded demo JS source (replaceable via hot reload)
 *   5. Push channels: hot-reload RX on USB Serial/JTAG (USB CDC) + WiFi OTA
 *      TCP server (self-starts once the station has an IP)
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

    /* M1: engine runs the embedded demo; the hot-reload RX task can replace
     * the app source over USB Serial/JTAG at runtime. */
    lume_hotreload_start();
}
