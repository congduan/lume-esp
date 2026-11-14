#pragma once
#include "esp_err.h"

/* Board pin map — Waveshare ESP32-S3-Touch-AMOLED-2.16
 *
 * Verified (2026-11-13) against the vendor schematic and both the ESP-IDF BSP
 * and the Arduino pin config shipped with the board:
 *   - schematic/ESP32-S3-Touch-AMOLED-2.16-Schematic.pdf, J4 display connector
 *     net list: QSPI_SCL=GPIO38, QSPI_SIO0=GPIO4, QSPI_SI1=GPIO5,
 *     QSPI_SI2=GPIO6, QSPI_SI3=GPIO7, LCD_CS=GPIO12, LCD_RESET=GPIO39
 *   - waveshare/esp32_s3_touch_amoled_2_16 BSP v1.0.0 / v2.0.1,
 *     include/bsp/esp32_s3_touch_amoled_2_16.h:34-55 (same values)
 *   - examples/arduino/libraries/Mylibrary/pin_config.h (same values)
 *
 * M1 correction: an earlier revision of this header labelled GPIO4 as
 * "LCD_CLK" and listed only three data lines (5/6/7). QSPI needs SCLK plus
 * FOUR data lines; GPIO4/5/6/7 are the data lines and the clock is a separate
 * GPIO38. The old names are gone so no driver can accidentally wire the clock
 * onto a data line.
 *
 *   Touch CST9220 I2C: SDA=15, SCL=14, TP_INT=11, TP_RST=40
 *   I2C shared bus:    AXP2101(0x34), CST9220(0x5A), QMI8658, ES8311, PCF85063
 *   Audio ES8311:      MCLK=42, SCLK=9, LRCK=45, DOUT=8
 */

#define LUME_PIN_I2C_SCL      14
#define LUME_PIN_I2C_SDA      15

/* CO5300 QSPI AMOLED */
#define LUME_PIN_LCD_SCLK     38
#define LUME_PIN_LCD_DATA0    4
#define LUME_PIN_LCD_DATA1    5
#define LUME_PIN_LCD_DATA2    6
#define LUME_PIN_LCD_DATA3    7
#define LUME_PIN_LCD_CS       12
#define LUME_PIN_LCD_RST      39

#define LUME_PIN_TP_RST       40
#define LUME_PIN_TP_INT       11

#define LUME_PIN_I2S_MCLK     42
#define LUME_PIN_I2S_SCLK     9
#define LUME_PIN_I2S_LRCK     45
#define LUME_PIN_I2S_DOUT     8
#define LUME_PIN_I2S_DIN      10
#define LUME_PIN_AUDIO_PA     46

#define LUME_LCD_H_RES        480
#define LUME_LCD_V_RES        480
#define LUME_LCD_BPP          16

esp_err_t lume_board_init(void);
