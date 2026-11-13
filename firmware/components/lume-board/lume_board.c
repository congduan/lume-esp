/**
 * Board init — M1 skeleton.
 *
 * M1 bring-up order (each step verified against vendor examples):
 *   1. I2C master on 15/14 (400kHz) — shared by touch/PMIC/IMU/codecs
 *   2. AXP2101: assert ALDO3/ALDO4/BLDO rails used by display & peripherals
 *   3. CO5300 QSPI panel via esp_lcd (with vendor init sequence)
 *   4. CST9220 touch: probe + INT config, events routed to engine queue
 *   5. TF card: SPI mode mount (FATFS), card-detect poll
 *
 * Stub now; real driver code lands as IDF 5.5 install completes.
 */
#include <stdio.h>
#include "esp_log.h"
#include "lume.h"
#include "lume_pins.h"

static const char *TAG = "lume-board";

esp_err_t lume_board_init(void)
{
    ESP_LOGI(TAG, "board init (M1 skeleton)");
    /* TODO(M1): i2c_master init, AXP2101 rails, esp_lcd CO5300, CST9220, TF mount */
    return ESP_OK;
}
