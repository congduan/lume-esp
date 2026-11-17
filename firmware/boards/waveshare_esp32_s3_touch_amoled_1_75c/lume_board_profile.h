#pragma once
/*
 * Board profile — Waveshare ESP32-S3-Touch-AMOLED-1.75C
 *
 * Pins and geometry: Waveshare's 1.75C Arduino
 * examples/arduino/libraries/board_config/pin_config.h (2026-11-17).
 * Other unchanged constants reuse the 2.16 CO5300/CST92xx profile and
 * require on-device acceptance; see docs/r86-amoled-175c-report.md.
 *
 * Included by lume-board/include/lume_pins.h, which re-exports these names to
 * the rest of the firmware. The selected board directory is added to the
 * lume-board component's public INCLUDE_DIRS by its CMakeLists.txt.
 */
#include <stdint.h>

/* ------------------------------------------------------------------ */
/* 1. Pin map                                                          */
/* ------------------------------------------------------------------ */
#define LUME_PIN_I2C_SCL      14
#define LUME_PIN_I2C_SDA      15

/* CO5300 QSPI AMOLED (J4 connector) */
#define LUME_PIN_LCD_SCLK     38
#define LUME_PIN_LCD_DATA0    4
#define LUME_PIN_LCD_DATA1    5
#define LUME_PIN_LCD_DATA2    6
#define LUME_PIN_LCD_DATA3    7
#define LUME_PIN_LCD_CS       12
#define LUME_PIN_LCD_RST      1

/* CST9217 touch (CST92xx protocol) */
#define LUME_PIN_TP_RST       2
#define LUME_PIN_TP_INT       11

/* ES8311 / ES7210 audio + PA */
#define LUME_PIN_I2S_MCLK     16
#define LUME_PIN_I2S_SCLK     9
#define LUME_PIN_I2S_LRCK     45
#define LUME_PIN_I2S_DOUT     8
#define LUME_PIN_I2S_DIN      10
#define LUME_PIN_AUDIO_PA     46

/* No TF card slot: LUME_PIN_SD_* intentionally undefined. */

/* ------------------------------------------------------------------ */
/* 2. Display geometry (RGB565)                                       */
/* ------------------------------------------------------------------ */
#define LUME_LCD_H_RES        466
#define LUME_LCD_V_RES        466
#define LUME_LCD_BPP          16

/* Waveshare 1.75C BSP CASET starts at column 6 (visible columns 6..471). */
#define LUME_LCD_COLUMN_OFFSET 6

/* ------------------------------------------------------------------ */
/* 3. Shared-I2C device addresses (7-bit)                             */
/* ------------------------------------------------------------------ */
#define LUME_I2C_ADDR_AXP2101 0x34
#define LUME_I2C_ADDR_CST9220 0x5A
#define LUME_I2C_ADDR_QMI8658 0x6B
#define LUME_I2C_ADDR_ES8311  0x18
#define LUME_I2C_ADDR_ES7210  0x40

/* ------------------------------------------------------------------ */
/* 4. CO5300 QSPI bus / panel-io config                               */
/* ------------------------------------------------------------------ */
#define LUME_LCD_SPI_HOST            SPI2_HOST
#define LUME_LCD_PCLK_HZ            (CONFIG_LUME_LCD_PCLK_MHZ * 1000 * 1000)
#define LUME_LCD_DRAW_BUF_LINES     20
#define LUME_LCD_TRANS_QUEUE_DEPTH  3
#define LUME_LCD_CMD_BITS           32
#define LUME_LCD_PARAM_BITS         8
#define LUME_LCD_SPI_MODE           0

/* CO5300 QSPI opcodes (esp_lcd_co5300_spi.c:23-25) */
#define LUME_LCD_QSPI_OP_WRITE_CMD   0x02
#define LUME_LCD_QSPI_OP_WRITE_COLOR 0x32

/* MIPI DCS registers used by the draw / sleep path */
#define LUME_LCD_CMD_CASET     0x2A
#define LUME_LCD_CMD_RASET     0x2B
#define LUME_LCD_CMD_RAMWR     0x2C
#define LUME_LCD_CMD_SLEEP_IN  0x10
#define LUME_LCD_CMD_SLEEP_OUT 0x11

/* Hardware-reset / sleep settle timings (ms) */
#define LUME_LCD_RST_LOW_MS         10
#define LUME_LCD_RST_HIGH_MS        150
#define LUME_LCD_SLEEP_IN_SETTLE_MS 150
#define LUME_LCD_SLEEP_OUT_SETTLE_MS 600

/* LCD and touch reset use direct ESP GPIOs; no IO expander. */

/*
 * CO5300 vendor init command table (Waveshare 1.75C BSP,
 * esp32_s3_touch_amoled_1_75c.c:52-68). Expanded as the initializer of
 * lume_init_cmd_t s_init_cmds[] in lume_display.c — that type stays in the
 * driver; only the board-specific command sequence lives here.
 * CASET/RASET upper bounds are derived from the geometry above. The round
 * panel init has no MADCTL rotation; touch orientation uses the BSP's two
 * mirror flags.
 */
#define LUME_LCD_CASET_RASET_HI()  ((uint8_t)((LUME_LCD_COLUMN_OFFSET + LUME_LCD_H_RES - 1) >> 8))
#define LUME_LCD_CASET_RASET_LO()  ((uint8_t)(LUME_LCD_COLUMN_OFFSET + LUME_LCD_H_RES - 1))
#define LUME_LCD_CASET_RASET_VHI() ((uint8_t)((LUME_LCD_V_RES - 1) >> 8))
#define LUME_LCD_CASET_RASET_VLO() ((uint8_t)(LUME_LCD_V_RES - 1))

#define LUME_LCD_INIT_CMDS                                                       \
    {0xFE, (uint8_t[]){0x20}, 1, 0},                                           \
    {0x19, (uint8_t[]){0x10}, 1, 0},                                           \
    {0x1C, (uint8_t[]){0xA0}, 1, 0},                                           \
    {0xFE, (uint8_t[]){0x00}, 1, 0},                                           \
    {0xC4, (uint8_t[]){0x80}, 1, 0},                                           \
    {0x3A, (uint8_t[]){0x55}, 1, 0},                                           \
    {0x35, (uint8_t[]){0x00}, 1, 0},                                           \
    {0x53, (uint8_t[]){0x20}, 1, 0},                                           \
    {0x51, (uint8_t[]){0xFF}, 1, 0},                                           \
    {0x63, (uint8_t[]){0xFF}, 1, 0},                                           \
    {0x2A, (uint8_t[]){0x00, LUME_LCD_COLUMN_OFFSET, LUME_LCD_CASET_RASET_HI(), \
                       LUME_LCD_CASET_RASET_LO()},                              \
     4, 0},                                                                     \
    {0x2B, (uint8_t[]){0x00, 0x00, LUME_LCD_CASET_RASET_VHI(),                \
                       LUME_LCD_CASET_RASET_VLO()},                             \
     4, LUME_LCD_SLEEP_OUT_SETTLE_MS},                                         \
    {0x11, (uint8_t[]){0x00}, 0, LUME_LCD_SLEEP_OUT_SETTLE_MS},                \
    {0x29, (uint8_t[]){0x00}, 0, 0}

/* ------------------------------------------------------------------ */
/* 5. CST9217 touch config / coordinate mapping                       */
/* ------------------------------------------------------------------ */
/* CST9217 uses the existing CST92xx 16-bit-register / 10-byte-frame path.
 * Its project ID is logged by lume_touch.c, not checked against CST9220. */
#define LUME_TOUCH_CHIP        LUME_TOUCH_CHIP_CST9220
#define LUME_TOUCH_I2C_SPEED_HZ 400000
/*
 * Waveshare 1.75C BSP bsp_display_start: swap_xy=0, mirror_x=1, mirror_y=1.
 * The round panel maps px = H_RES - 1 - tx, py = V_RES - 1 - ty.
 */
#define LUME_TOUCH_MAP_X(tx, ty) ((int32_t)(LUME_LCD_H_RES - 1 - (tx)))
#define LUME_TOUCH_MAP_Y(tx, ty) ((int32_t)(LUME_LCD_V_RES - 1 - (ty)))

/* ------------------------------------------------------------------ */
/* 6. Board identity (logs / diagnostics)                             */
/* ------------------------------------------------------------------ */
#define LUME_BOARD_NAME "Waveshare ESP32-S3-Touch-AMOLED-1.75C"
