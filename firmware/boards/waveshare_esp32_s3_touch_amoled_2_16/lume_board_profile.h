#pragma once
/*
 * Board profile — Waveshare ESP32-S3-Touch-AMOLED-2.16
 *
 * r27: this is the SINGLE source of truth for every compile-time constant
 * tied to this board. To bring up another board, add a sibling directory under
 * firmware/boards/ (see firmware/boards/README.md) and select it through the
 * Kconfig `choice LUME_BOARD`. No firmware .c file should hardcode a pin,
 * resolution, I2C address or panel init value again.
 *
 * Values verified (2026-11-13) against the vendor schematic / BSP /
 * Arduino pin config; the evidence trail is kept in
 * docs/r27-board-param-audit.md and the driver comments in lume-board/.
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
#define LUME_PIN_LCD_RST      39

/* CST9220 touch */
#define LUME_PIN_TP_RST       40
#define LUME_PIN_TP_INT       11

/* ES8311 / ES7210 audio + PA */
#define LUME_PIN_I2S_MCLK     42
#define LUME_PIN_I2S_SCLK     9
#define LUME_PIN_I2S_LRCK     45
#define LUME_PIN_I2S_DOUT     8
#define LUME_PIN_I2S_DIN      10
#define LUME_PIN_AUDIO_PA     46

/* ------------------------------------------------------------------ */
/* 2. Display geometry (RGB565)                                       */
/* ------------------------------------------------------------------ */
#define LUME_LCD_H_RES        480
#define LUME_LCD_V_RES        480
#define LUME_LCD_BPP          16

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
#define LUME_LCD_PCLK_HZ            (40 * 1000 * 1000)
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

/*
 * CO5300 vendor init command table (Waveshare BSP 1.0.0/2.0.1,
 * esp32_s3_touch_amoled_2_16.c:53-71). Expanded as the initializer of
 * lume_init_cmd_t s_init_cmds[] in lume_display.c — that type stays in the
 * driver; only the board-specific command sequence lives here.
 * CASET/RASET upper bounds are derived from the geometry above so a board
 * with a different panel size does not need a second edit.
 */
#define LUME_LCD_CASET_RASET_HI()  ((uint8_t)((LUME_LCD_H_RES - 1) >> 8))
#define LUME_LCD_CASET_RASET_LO()  ((uint8_t)(LUME_LCD_H_RES - 1))
#define LUME_LCD_CASET_RASET_VHI() ((uint8_t)((LUME_LCD_V_RES - 1) >> 8))
#define LUME_LCD_CASET_RASET_VLO() ((uint8_t)(LUME_LCD_V_RES - 1))

#define LUME_LCD_INIT_CMDS                                                       \
    {0x11, (uint8_t[]){0x00}, 0, LUME_LCD_SLEEP_OUT_SETTLE_MS},                \
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
    {0x2A, (uint8_t[]){0x00, 0x00, LUME_LCD_CASET_RASET_HI(),                 \
                       LUME_LCD_CASET_RASET_LO()},                              \
     4, 0},                                                                     \
    {0x2B, (uint8_t[]){0x00, 0x00, LUME_LCD_CASET_RASET_VHI(),                \
                       LUME_LCD_CASET_RASET_VLO()},                             \
     4, 0},                                                                     \
    {0x36, (uint8_t[]){0xA0}, 1, 0},                                           \
    {0x29, (uint8_t[]){0x00}, 0, LUME_LCD_SLEEP_OUT_SETTLE_MS}

/* ------------------------------------------------------------------ */
/* 5. CST9220 touch config / coordinate mapping                       */
/* ------------------------------------------------------------------ */
#define LUME_TOUCH_I2C_SPEED_HZ 400000
/*
 * Board orientation (Waveshare BSP:566-569): mirror_y then swap_xy.
 * px = V_RES - ty, py = tx. A board with a different mounting supplies its
 * own mapping here; the driver just calls these two macros.
 */
#define LUME_TOUCH_MAP_X(tx, ty) ((int32_t)(LUME_LCD_V_RES - (ty)))
#define LUME_TOUCH_MAP_Y(tx, ty) ((int32_t)(tx))

/* ------------------------------------------------------------------ */
/* 6. Board identity (logs / diagnostics)                             */
/* ------------------------------------------------------------------ */
#define LUME_BOARD_NAME "Waveshare ESP32-S3-Touch-AMOLED-2.16"
