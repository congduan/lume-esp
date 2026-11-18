/*
 * r109 host harness: static assertions for the Waveshare 1.75C board profile.
 *
 * Build + run (from repo root):
 *   gcc -std=c11 -Wall -Wextra -Werror \
 *     -I firmware/boards/waveshare_esp32_s3_touch_amoled_1_75c \
 *     tests/board_175c_profile.c -o /tmp/lume_board_175c_profile && \
 *     /tmp/lume_board_175c_profile
 *
 * The profile is freestanding-friendly (only <stdint.h>); the two touch-chip
 * selector values are copied from lume-board/lume_board_internal.h so this
 * harness needs no ESP-IDF headers. Nothing here talks to hardware: these are
 * compile-time contract assertions that lock the three driver-level
 * differences r86 aligned with the Waveshare 1.75C BSP. On-device acceptance
 * (touch orientation, panel init, reset timing, audio) stays deferred.
 */
#include <stdint.h>
#include <stdio.h>
#include <string.h>

/* From lume_board_internal.h (chip-level protocol selectors, not wiring). */
#define LUME_TOUCH_CHIP_CST9220 1
#define LUME_TOUCH_CHIP_CST816S 2

#include "lume_board_profile.h"

/* --- 1. Pin map: Waveshare 1.75C Arduino pin_config.h (r86 source) -------- */
_Static_assert(LUME_PIN_I2C_SCL == 14, "1.75C I2C SCL");
_Static_assert(LUME_PIN_I2C_SDA == 15, "1.75C I2C SDA");
_Static_assert(LUME_PIN_LCD_SCLK == 38, "1.75C QSPI SCLK");
_Static_assert(LUME_PIN_LCD_DATA0 == 4 && LUME_PIN_LCD_DATA1 == 5 &&
               LUME_PIN_LCD_DATA2 == 6 && LUME_PIN_LCD_DATA3 == 7, "1.75C QSPI data 0..3");
_Static_assert(LUME_PIN_LCD_CS == 12, "1.75C LCD CS");
_Static_assert(LUME_PIN_LCD_RST == 1, "1.75C LCD RST (direct GPIO)");
_Static_assert(LUME_PIN_TP_RST == 2, "1.75C touch RST (direct GPIO)");
_Static_assert(LUME_PIN_TP_INT == 11, "1.75C touch INT");
_Static_assert(LUME_PIN_I2S_MCLK == 16 && LUME_PIN_I2S_SCLK == 9 &&
               LUME_PIN_I2S_LRCK == 45 && LUME_PIN_I2S_DOUT == 8 &&
               LUME_PIN_I2S_DIN == 10 && LUME_PIN_AUDIO_PA == 46, "1.75C I2S + PA");

/* --- Difference 3 (part): no TF slot - SD pins must stay undefined ------- */
#if defined(LUME_PIN_SD_MOSI) || defined(LUME_PIN_SD_CLK) || \
    defined(LUME_PIN_SD_MISO) || defined(LUME_PIN_SD_CS)
#error "1.75C has no TF card: LUME_PIN_SD_* must remain undefined"
#endif

/* --- 2. Geometry + column offset (BSP CASET 00 06 01 D7 / RASET 01 D1) --- */
_Static_assert(LUME_LCD_H_RES == 466 && LUME_LCD_V_RES == 466 && LUME_LCD_BPP == 16,
               "1.75C 466x466 RGB565");
_Static_assert(LUME_LCD_COLUMN_OFFSET == 6, "1.75C 6-column gap");
_Static_assert(LUME_LCD_CASET_RASET_HI() == 0x01 && LUME_LCD_CASET_RASET_LO() == 0xD7,
               "1.75C CASET upper bound 0x01D7");
_Static_assert(LUME_LCD_CASET_RASET_VHI() == 0x01 && LUME_LCD_CASET_RASET_VLO() == 0xD1,
               "1.75C RASET upper bound 0x01D1");
_Static_assert(LUME_LCD_CMD_BITS == 32 && LUME_LCD_PARAM_BITS == 8 &&
               LUME_LCD_SPI_MODE == 0, "1.75C CO5300 QSPI config");
_Static_assert(LUME_LCD_QSPI_OP_WRITE_CMD == 0x02 && LUME_LCD_QSPI_OP_WRITE_COLOR == 0x32,
               "1.75C CO5300 QSPI opcodes");

/* --- Shared-I2C addresses ------------------------------------------------ */
_Static_assert(LUME_I2C_ADDR_AXP2101 == 0x34, "1.75C AXP2101");
_Static_assert(LUME_I2C_ADDR_CST9220 == 0x5A, "1.75C CST9217 on CST92xx address 0x5A");
_Static_assert(LUME_I2C_ADDR_QMI8658 == 0x6B, "1.75C QMI8658");
_Static_assert(LUME_I2C_ADDR_ES8311 == 0x18 && LUME_I2C_ADDR_ES7210 == 0x40,
               "1.75C ES8311 + ES7210");

/* --- Difference 1: CST9217 uses the CST92xx protocol path, NOT CST816S --- */
_Static_assert(LUME_TOUCH_CHIP == LUME_TOUCH_CHIP_CST9220,
               "1.75C CST9217 must select the CST9220 16-bit/10-byte path");
_Static_assert(LUME_TOUCH_CHIP != LUME_TOUCH_CHIP_CST816S,
               "1.75C must not select the 1.8 V2 CST816S path");
_Static_assert(LUME_TOUCH_I2C_SPEED_HZ == 400000, "1.75C touch I2C 400 kHz");
/* BSP tp_cfg swap_xy=0, mirror_x=1, mirror_y=1 -> px=H-1-tx, py=V-1-ty. */
_Static_assert(LUME_TOUCH_MAP_X(100, 200) == 365, "1.75C mirror_x: px = 465 - tx");
_Static_assert(LUME_TOUCH_MAP_Y(100, 200) == 265, "1.75C mirror_y: py = 465 - ty");

/* --- Difference 3 (part): resets are direct GPIO, not the TCA9554 ------- */
#if defined(LUME_HAS_IO_EXPANDER_RESET) && LUME_HAS_IO_EXPANDER_RESET
#error "1.75C resets use direct ESP GPIOs; LUME_HAS_IO_EXPANDER_RESET must be off"
#endif

int main(void)
{
    puts("PASS 1.75C pin map (QSPI/I2C/touch/I2S)");
    puts("PASS 1.75C no TF slot - SD pins undefined");
    puts("PASS 1.75C 466x466 + column offset 6 (CASET 0x01D7 / RASET 0x01D1)");
    puts("PASS 1.75C I2C addresses (AXP2101/CST/IMU/codecs)");
    puts("PASS 1.75C CST9217 -> CST92xx path + mirror_x/mirror_y mapping");
    puts("PASS 1.75C direct GPIO resets (no TCA9554 expander)");
    if (strcmp(LUME_BOARD_NAME, "Waveshare ESP32-S3-Touch-AMOLED-1.75C") != 0) {
        puts("FAIL board name");
        return 1;
    }
    puts("PASS " LUME_BOARD_NAME);
    return 0;
}
