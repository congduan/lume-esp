#pragma once
/*
 * Board profile — Waveshare ESP32-S3-Touch-AMOLED-1.8 (V2: CO5300 + CST820)
 *
 * r44: the SECOND compile-time board profile (the first real use of the
 * six-step flow in firmware/boards/README.md, established in r27/r31).
 * Selected through Kconfig `choice LUME_BOARD` / `LUME_BOARD_DIR`. The
 * DEFAULT board is still waveshare_esp32_s3_touch_amoled_2_16 — nothing in
 * this file changes the default build.
 *
 * This is a COMPILE-TIME parameter set ONLY. No hardware has been attached:
 * every board-level acceptance item (panel power-on, colour, touch
 * orientation, column gap, PMIC rails, audio, sleep current, radio,
 * persistence, bundle push) is deferred; see docs/KNOWN-SIMPLIFICATIONS.md
 * (r44 entry). Keep every LUME_* macro name — lume-board/lume-* .c files
 * compile against this contract; the values below are what differ.
 *
 * ---------------------------------------------------------------------------
 * Empirical sources (read before writing; nothing inferred from the 2.16
 * board). "V2" is the current shipping revision: the vendor wiki states V1
 * (SH8601 + FT3168) was discontinued and V2 (CO5300 + CST820) ships after
 * 2026-05-30; the back-label distinguishes them.
 *   - Waveshare wiki (EN) https://www.waveshare.com/wiki/ESP32-S3-Touch-AMOLED-1.8
 *     and (CN) https://www.waveshare.net/wiki/ESP32-S3-Touch-AMOLED-1.8 :
 *       368x448 AMOLED, 16 MB NOR-Flash, 8 MB stacked PSRAM, ESP32-S3R8,
 *       AXP2101 / QMI8658 / PCF85063 / ES8311 on board, V1/V2 split.
 *   - Official Waveshare demo repo (github.com/waveshareteam/
 *     ESP32-S3-Touch-AMOLED-1.8), examples/arduino/libraries/Mylibrary/
 *     pin_config.h : LCD_SDIO0..3 / LCD_SCLK / LCD_CS / LCD_WIDTH 368 /
 *     LCD_HEIGHT 448 / IIC_SDA 15 / IIC_SCL 14 / TP_INT 21 / I2S_* / PA 46 /
 *     SDMMC_CMD 1 / SDMMC_CLK 2 / SDMMC_DATA 3.
 *   - Official ESP-IDF demo examples/esp-idf/13_display_colorbar/main/
 *     display_colorbar_main.c : LCD_HOST SPI2_HOST, LCD_H_RES 368,
 *     LCD_V_RES 448, LCD_BITS_PER_PIXEL 16, LCD_CS 12, LCD_PCLK 11,
 *     LCD_DATA0..3 4/5/6/7, I2C_SDA 15, I2C_SCL 14,
 *     CST816_ADDRESS 0x15, V2_PANEL_X_GAP 0x10, esp_lcd_panel_set_gap
 *     (panel, 0x10, 0), and the CO5300 lcd_init_cmds[] table.
 *   - Official managed BSP waveshare/esp32_s3_touch_amoled_1_8 v2.0.3
 *     (ESP component registry), include/bsp/esp32_s3_touch_amoled_1_8.h
 *     and esp32_s3_touch_amoled_1_8.c : authoritative pin map, I2S/SDMMC
 *     pins, BSP_LCD_RST / BSP_LCD_TOUCH_RST = GPIO_NUM_NC, TP_INT 21,
 *     BSP_IO_EXPANDER_I2C_ADDRESS (TCA9554 @ 0x20), BSP_LCD_H_RES 368 /
 *     V_RES 448, BSP_LCD_CST816S_X_GAP 0x10, lcd_init_cmds[],
 *     tp_cfg {swap_xy=0, mirror_x=0, mirror_y=0}, esp_lcd_touch_cst816s
 *     + esp_lcd_touch_ft5x06 dual-revision probing.
 *   - espressif/esp_lcd_co5300 v2.0.3, include/esp_lcd_co5300.h:131-145
 *     (CO5300_PANEL_IO_QSPI_CONFIG): .spi_mode = 0,
 *     .pclk_hz = 40 * 1000 * 1000, .lcd_cmd_bits = 32,
 *     .lcd_param_bits = 8, .quad_mode = true, .dc_gpio_num = -1.
 *   - esp32sim upstream cross-check: the brief's
 *     https://github.com/nousresearch/esp32sim is 404 ("Repository not
 *     found"); tools/emu/setup.sh:10 pins the real upstream
 *     https://github.com/mikroverk/esp32sim.git at commit 56ea9b2. Its
 *     esp32s3/src/board/waveshare_amoled18.rs declares WIDTH 368,
 *     HEIGHT 448, X_OFFSET 16, Co5300::new(368, 448, 16), SDIO0..3 4..7,
 *     SCLK 11, CS 12, TE 13, I2C SCL 14 / SDA 15, TOUCH_INT 21, and I2C
 *     devices 0x15 (Cst820), 0x20 (Tca9554), 0x34 (AXP2101), 0x51
 *     (PCF85063A), 0x6b (QMI8658). esp-soc/src/devices/co5300.rs maps
 *     physical column x -> framebuffer (x - column_offset), so CASET must
 *     start at 16 for the visible 368 columns.
 *   - Community field notes (github.com/zybzyb1/awesome-esp32
 *     guides/waveshare-amoled-18.md) corroborate CST820 @ 0x15, the 16 px
 *     x-gap, 40 MHz default / 80 MHz optional QSPI clock, 16 MB flash and
 *     8 MB octal PSRAM; used only as corroboration, not as the primary
 *     source.
 *
 * ---------------------------------------------------------------------------
 * Sources that CONFLICT with the r44 brief's premise, resolved in favour of
 * the Waveshare official demo/BSP (per the brief's precedence rule):
 *   1. Touch IC. The brief assumed the CST9217/CST9220 16-bit-register
 *      family (0x5A). The 1.8 V2 board actually carries a CST820
 *      (CST816S-compatible) at 0x15; V1 carries FT3168 at 0x38. The BSP
 *      links esp_lcd_touch_cst816s AND esp_lcd_touch_ft5x06. The macro name
 *      LUME_I2C_ADDR_CST9220 is kept (driver contract) but its value is the
 *      sourced 0x15; the lume_touch.c register protocol (0xD000.., 10-byte
 *      frame) does NOT match this chip. Hardware bring-up needs a CST816S
 *      driver path — recorded in KNOWN-SIMPLIFICATIONS r44.
 *   2. LCD / touch reset. The BSP declares BSP_LCD_RST and
 *      BSP_LCD_TOUCH_RST = GPIO_NUM_NC: the reset lines are behind the
 *      TCA9554 I2C IO expander (0x20), NOT an ESP32 GPIO. lume_display.c /
 *      lume_touch.c drive a direct GPIO (1ULL << LUME_PIN_LCD_RST etc.), so
 *      those two values are unsourced compile-time placeholders.
 *   3. Column offset. 2.16 is 480x480 with offset 0; esp32sim's 1.8 model
 *      and the official BSP/demo both use a 16-column (0x10) gap applied via
 *      esp_lcd_panel_set_gap(panel, 0x10, 0). lume_display.c's flush_cb
 *      builds CASET from the LVGL area with no offset, so the gap is NOT
 *      applied by the current driver. LUME_LCD_COLUMN_OFFSET records the
 *      confirmed value; applying it is deferred (see KNOWN-SIMPLIFICATIONS).
 *   4. SD. 1.8 uses 1-bit SDMMC (CMD 1 / CLK 2 / D0 3); the Lume
 *      mp3_decoder drives SPI SDSPI with MOSI/MISO/CLK/CS. There is no CS
 *      line on this board. Values are mapped where a signal exists and the
 *      mismatch is flagged.
 *   5. ES7210. No ES7210 exists on this board (zero references in the whole
 *      official repo; the BSP uses esp_codec_dev with ES8311 only). The
 *      LUME_I2C_ADDR_ES7210 macro is kept because lume_audio.c needs it,
 *      but its value is an unsourced placeholder.
 *
 * Values with no source are marked "TODO(board): unsourced, verify on
 * hardware" — they are placeholders needed for the driver contract to
 * compile, NOT verified board wiring.
 * ---------------------------------------------------------------------------
 */
#include <stdint.h>

/* ------------------------------------------------------------------ */
/* 1. Pin map                                                          */
/*    Sources: official BSP include/bsp/esp32_s3_touch_amoled_1_8.h    */
/*    :36-62, examples/arduino/.../pin_config.h, 13_display_colorbar.  */
/* ------------------------------------------------------------------ */
#define LUME_PIN_I2C_SCL      14   /* BSP_I2C_SCL / IIC_SCL / I2C_SCL */
#define LUME_PIN_I2C_SDA      15   /* BSP_I2C_SDA / IIC_SDA / I2C_SDA */

/* CO5300 QSPI AMOLED (SPI2_HOST). No TE (13) or backlight pin is used. */
#define LUME_PIN_LCD_SCLK     11   /* BSP_LCD_PCLK / LCD_SCLK / LCD_PCLK */
#define LUME_PIN_LCD_DATA0    4    /* BSP_LCD_DATA0 / LCD_SDIO0 */
#define LUME_PIN_LCD_DATA1    5    /* BSP_LCD_DATA1 / LCD_SDIO1 */
#define LUME_PIN_LCD_DATA2    6    /* BSP_LCD_DATA2 / LCD_SDIO2 */
#define LUME_PIN_LCD_DATA3    7    /* BSP_LCD_DATA3 / LCD_SDIO3 */
#define LUME_PIN_LCD_CS       12   /* BSP_LCD_CS / LCD_CS */
/* TODO(board): unsourced, verify on hardware. The official BSP sets
 * BSP_LCD_RST = GPIO_NUM_NC — the panel reset is driven by the TCA9554
 * IO expander (0x20), not an ESP32 GPIO. 39 is a placeholder carried over
 * from the 2.16 profile so lume_display.c's `1ULL << LUME_PIN_LCD_RST`
 * compiles; it is NOT this board's wiring. */
#define LUME_PIN_LCD_RST      39

/* Touch (CST820 / CST816S family on V2). INT is a real GPIO; RST is not. */
#define LUME_PIN_TP_INT       21   /* BSP_LCD_TOUCH_INT / TP_INT / esp32sim PIN_AMOLED_TOUCH_INT */
/* TODO(board): unsourced, verify on hardware. BSP_LCD_TOUCH_RST =
 * GPIO_NUM_NC (shared with the LCD reset behind the TCA9554). Placeholder
 * only, so lume_touch.c's `1ULL << LUME_PIN_TP_RST` compiles. */
#define LUME_PIN_TP_RST       40

/* ES8311 codec + PA (I2S). Sources: BSP_I2S_* / pin_config.h I2S_*. */
#define LUME_PIN_I2S_MCLK     16   /* BSP_I2S_MCLK  / I2S_MCK_IO / MCLKPIN */
#define LUME_PIN_I2S_SCLK     9    /* BSP_I2S_SCLK  / I2S_BCK_IO / BCLKPIN */
#define LUME_PIN_I2S_LRCK     45   /* BSP_I2S_LCLK  / I2S_WS_IO  / WSPIN  */
#define LUME_PIN_I2S_DOUT     8    /* BSP_I2S_DOUT  / I2S_DO_IO  / DOPIN  */
#define LUME_PIN_I2S_DIN      10   /* BSP_I2S_DSIN  / I2S_DI_IO  / DIPIN  */
#define LUME_PIN_AUDIO_PA     46   /* BSP_POWER_AMP_IO / PA */

/* SD card. TODO(board): unsourced, verify on hardware for the SDSPI path.
 * The 1.8 board uses 1-bit SDMMC: BSP_SD_CMD 1, BSP_SD_CLK 2, BSP_SD_D0 3.
 * Lume's mp3_decoder uses SPI SDSPI (MOSI/MISO/CLK/CS), which is a DIFFERENT
 * bus; CMD/D0 are mapped to MOSI/MISO below only as compile-time numbers.
 * There is no CS line (GPIO_NUM_NC equivalent) on this board. */
#define LUME_PIN_SD_MOSI      1    /* BSP_SD_CMD — SDMMC CMD, not SPI MOSI */
#define LUME_PIN_SD_CLK       2    /* BSP_SD_CLK */
#define LUME_PIN_SD_MISO      3    /* BSP_SD_D0  — SDMMC D0,  not SPI MISO */
#define LUME_PIN_SD_CS        41   /* TODO(board): unsourced; SDMMC has no CS. 2.16 placeholder. */

/* ------------------------------------------------------------------ */
/* 2. Display geometry (RGB565)                                       */
/*    Sources: wiki 368x448; BSP display.h:19-20; pin_config.h          */
/*    LCD_WIDTH/LCD_HEIGHT; 13_display_colorbar LCD_H_RES/V_RES;        */
/*    esp32sim WIDTH=368 HEIGHT=448.                                    */
/* ------------------------------------------------------------------ */
#define LUME_LCD_H_RES        368
#define LUME_LCD_V_RES        448
#define LUME_LCD_BPP          16

/* Confirmed 16-column (0x10) offset for the CO5300 on this panel.
 * Sources: BSP .c:27 BSP_LCD_CST816S_X_GAP (0x10) applied via
 * esp_lcd_panel_set_gap(panel, 0x10, 0) (BSP .c:461 / colorbar:104);
 * esp32sim waveshare_amoled18.rs X_OFFSET=16 + Co5300::new(368,448,16).
 * TODO(board): NOT consumed by lume_display.c yet — its flush_cb writes
 * CASET [x1,x2] straight from the LVGL area with no gap, so partial-window
 * updates target physical columns 0..367 instead of 16..383. Applying the
 * gap needs a driver change; deferred to the board bring-up round. */
#define LUME_LCD_COLUMN_OFFSET 16

/* ------------------------------------------------------------------ */
/* 3. Shared-I2C device addresses (7-bit)                             */
/* ------------------------------------------------------------------ */
#define LUME_I2C_ADDR_AXP2101 0x34  /* wiki AXP2101; esp32sim 0x34 stub; XPowersLib */
#define LUME_I2C_ADDR_CST9220 0x15  /* CONFLICT (see header): fitted chip is CST820 /
                                      * CST816S-family @ 0x15, NOT CST9220 @ 0x5A.
                                      * Source: colorbar CST816_ADDRESS 0x15,
                                      * board_variant TOUCH_ADDR_CST816 0x15,
                                      * ESP_LCD_TOUCH_IO_I2C_CST816S_CONFIG,
                                      * esp32sim (0, 0x15, Cst820). Macro name
                                      * kept for the lume_touch.c contract. */
#define LUME_I2C_ADDR_QMI8658 0x6B  /* wiki QMI8658; esp32sim (0, 0x6b, Qmi8658) */
#define LUME_I2C_ADDR_ES8311  0x18  /* 15_ES8311/es8311.h:19 ES8311_ADDRESS_0 0x18u;
                                      * 12_i2s_codec ES8311_CODEC_DEFAULT_ADDR */
/* TODO(board): unsourced, verify on hardware. ES7210 is NOT present on the
 * 1.8 board (zero references in the official repo; the BSP drives mic input
 * through ES8311 / esp_codec_dev). 0x40 is a compile-time placeholder kept
 * because lume_audio.c requires the macro; no device will ACK it. */
#define LUME_I2C_ADDR_ES7210  0x40

/* ------------------------------------------------------------------ */
/* 4. CO5300 QSPI bus / panel-io config                               */
/*    Sources: esp_lcd_co5300 v2.0.3 CO5300_PANEL_IO_QSPI_CONFIG       */
/*    (esp_lcd_co5300.h:131-145), colorbar LCD_HOST SPI2_HOST,         */
/*    BSP BSP_LCD_SPI_NUM (SPI2_HOST). Queue depth / draw-buffer lines  */
/*    are Lume driver-level values (not board wiring), same as 2.16.    */
/* ------------------------------------------------------------------ */
#define LUME_LCD_SPI_HOST            SPI2_HOST
#define LUME_LCD_PCLK_HZ            (40 * 1000 * 1000)
#define LUME_LCD_DRAW_BUF_LINES     20
#define LUME_LCD_TRANS_QUEUE_DEPTH  3
#define LUME_LCD_CMD_BITS           32
#define LUME_LCD_PARAM_BITS         8
#define LUME_LCD_SPI_MODE           0

/* CO5300 QSPI opcodes (esp_lcd_co5300_spi.c:23-25) — chip-level. */
#define LUME_LCD_QSPI_OP_WRITE_CMD   0x02
#define LUME_LCD_QSPI_OP_WRITE_COLOR 0x32

/* MIPI DCS registers used by the draw / sleep path — chip-level. */
#define LUME_LCD_CMD_CASET     0x2A
#define LUME_LCD_CMD_RASET     0x2B
#define LUME_LCD_CMD_RAMWR     0x2C
#define LUME_LCD_CMD_SLEEP_IN  0x10
#define LUME_LCD_CMD_SLEEP_OUT 0x11

/* Hardware-reset / sleep settle timings (ms). Chip-level CO5300 values;
 * the 100 ms sleep-out delay is the Waveshare 1.8 BSP's lcd_init_cmds[]
 * 0x11 delay (esp32_s3_touch_amoled_1_8.c:67 / colorbar:47). The hardware
 * reset lines themselves are NOT GPIOs on this board (see section 1). */
#define LUME_LCD_RST_LOW_MS         10
#define LUME_LCD_RST_HIGH_MS        150
#define LUME_LCD_SLEEP_IN_SETTLE_MS 150
#define LUME_LCD_SLEEP_OUT_SETTLE_MS 100

/* CASET/RASET upper bounds derived from the geometry above. For 368x448
 * these evaluate to 0x016F / 0x01BF, exactly the official BSP/demo init
 * values {0x00,0x00,0x01,0x6F} and {0x00,0x00,0x01,0xBF}. */
#define LUME_LCD_CASET_RASET_HI()  ((uint8_t)((LUME_LCD_H_RES - 1) >> 8))
#define LUME_LCD_CASET_RASET_LO()  ((uint8_t)(LUME_LCD_H_RES - 1))
#define LUME_LCD_CASET_RASET_VHI() ((uint8_t)((LUME_LCD_V_RES - 1) >> 8))
#define LUME_LCD_CASET_RASET_VLO() ((uint8_t)(LUME_LCD_V_RES - 1))

/*
 * CO5300 vendor init command table for the 1.8 V2 panel — Waveshare
 * official BSP waveshare/esp32_s3_touch_amoled_1_8 v2.0.3,
 * esp32_s3_touch_amoled_1_8.c:57-69, and the official ESP-IDF demo
 * examples/esp-idf/13_display_colorbar/main/display_colorbar_main.c:37-48.
 * NOTE the differences from the 2.16 table: no 0xFE=0x20 / 0x19 / 0x1C /
 * 0x36 (MADCTL) entries, CASET/RASET 0..367 / 0..447, and sleep-out (0x11)
 * comes near the END with a 100 ms delay followed by display-on (0x29).
 * Expanded as the initializer of lume_init_cmd_t s_init_cmds[] in
 * lume_display.c — that type stays in the driver.
 */
#define LUME_LCD_INIT_CMDS                                                       \
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
    {0x11, (uint8_t[]){0x00}, 0, LUME_LCD_SLEEP_OUT_SETTLE_MS},                \
    {0x29, (uint8_t[]){0x00}, 0, 0}

/* ------------------------------------------------------------------ */
/* 5. Touch config / coordinate mapping                              */
/* ------------------------------------------------------------------ */
/* r45: selects the clean-room touch protocol path in lume_touch.c. V2
 * carries a CST820 / CST816S-compatible controller at 0x15 (8-bit
 * registers / 6-byte point frame), NOT a CST9220. Verified against
 * espressif/esp_lcd_touch_cst816s v1.1.1~1 and the Waveshare SensorLib
 * TouchDrvCST816 driver (official 1.8 demos). */
#define LUME_TOUCH_CHIP        LUME_TOUCH_CHIP_CST816S
/* 400 kHz I2C — wiki (FT3168 10 kHz..400 kHz) and the CST816S BSP config
 * (CONFIG_BSP_I2C_CLK_SPEED_HZ). Bus-level, not board wiring. */
#define LUME_TOUCH_I2C_SPEED_HZ 400000
/*
 * Identity mapping. Source: official BSP esp32_s3_touch_amoled_1_8.c
 * tp_cfg { .swap_xy = 0, .mirror_x = 0, .mirror_y = 0 } (lines ~490-494).
 * This differs from the 2.16 board's mirror_y + swap_xy. NOTE: the mapping
 * is moot until lume_touch.c speaks the CST816S register protocol instead
 * of the CST9220 16-bit / 10-byte-frame one (see header conflict 1).
 * TODO(board): confirm orientation on hardware.
 */
#define LUME_TOUCH_MAP_X(tx, ty) ((int32_t)(tx))
#define LUME_TOUCH_MAP_Y(tx, ty) ((int32_t)(ty))

/* ------------------------------------------------------------------ */
/* 6. Board identity (logs / diagnostics)                             */
/* ------------------------------------------------------------------ */
#define LUME_BOARD_NAME "Waveshare ESP32-S3-Touch-AMOLED-1.8 (V2 CO5300/CST820)"
