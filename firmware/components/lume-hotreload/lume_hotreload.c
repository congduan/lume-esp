/**
 * Hot reload over USB CDC (M1 stub).
 *
 * Protocol (M1.x): host pushes a bundle framed as
 *   [magic "LUME" | u32 total_len | u32 crc | payload...]
 * runtime validates, stages to storage partition, resets engine task, new
 * bytecode boots. Drivers (LVGL, I2C, TF) stay alive across reload.
 */
#include <stdio.h>
#include "esp_log.h"
#include "lume_hotreload.h"

static const char *TAG = "lume-hotreload";

void lume_hotreload_start(void)
{
    ESP_LOGI(TAG, "hot-reload channel: USB CDC (stub)");
    /* TODO(M1.x): usb serial jtag rx task + bundle framing + engine reset */
}
