#pragma once
#include "esp_err.h"

/* Board pin map — Waveshare ESP32-S3-Touch-AMOLED-2.16
 * Verified against vendor schematic (schematic PDF, net list):
 *   Display CO5300 QSPI: LCD_CLK=4, LCD_SI=5( MOSI), LCD_IO2/3=6/7, LCD_CS=12, LCD_RST=39, BL=-  (AMOLED self-emissive)
 *   Touch CST9220 I2C:   SDA=15, SCL=14 (+INT/RESET on 11/40 per schematic TP_* nets)
 *   I2C shared bus:      15/14 (CST9220, AXP2101, QMI8658, ES8311, PCF85063 RTC)
 *   TF card (SPI):       MOSI/SCK/MISO/SDCS + CD detect — GPIO numbers to be fixed
 *                        from schematic during M1 bring-up (nets MOSI/SCK/MISO/SDCS/CD)
 *   Audio ES8311:        MCLK=42, SCLK=9, LRCK=45, DOUT=8
 */

#define LUME_PIN_I2C_SCL      14
#define LUME_PIN_I2C_SDA      15

#define LUME_PIN_LCD_CLK      4
#define LUME_PIN_LCD_MOSI     5
#define LUME_PIN_LCD_IO2      6
#define LUME_PIN_LCD_IO3      7
#define LUME_PIN_LCD_CS       12
#define LUME_PIN_LCD_RST      39

#define LUME_PIN_TP_RST       40
#define LUME_PIN_TP_INT       11

#define LUME_PIN_I2S_MCLK     42
#define LUME_PIN_I2S_SCLK     9
#define LUME_PIN_I2S_LRCK     45
#define LUME_PIN_I2S_DOUT     8

esp_err_t lume_board_init(void);
