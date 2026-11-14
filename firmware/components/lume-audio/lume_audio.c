/* Board-specific, clean-room register implementation from Waveshare Arduino
 * 06_ES7210/es7210.cpp and 07_ES8311/es8311.c (source lines in docs). */
#include "lume_audio.h"
#include "lume_board.h"
#include "lume_pins.h"
#include "driver/i2c_master.h"
#include "driver/i2s_std.h"
#include "driver/gpio.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

/* Codec I2C addresses come from the board profile (lume_pins.h). */
#define ES8311 LUME_I2C_ADDR_ES8311
#define ES7210 LUME_I2C_ADDR_ES7210
static const char *TAG = "lume-audio";
static i2c_master_dev_handle_t s_dac, s_adc;
static i2s_chan_handle_t s_tx, s_rx;
static bool s_ready;
static bool s_i2s_ready;
static int s_volume = 85;

static int put(i2c_master_dev_handle_t dev, uint8_t reg, uint8_t val)
{
    uint8_t data[2] = {reg, val};
    esp_err_t e = i2c_master_transmit(dev, data, sizeof(data), 200);
    if (e != ESP_OK) {
        ESP_LOGW(TAG, "codec reg %02x=%02x: %s", reg, val, esp_err_to_name(e));
        return LUME_AUDIO_ERR_DRIVER;
    }
    return 0;
}

static int get(i2c_master_dev_handle_t dev, uint8_t reg, uint8_t *val)
{
    esp_err_t e = i2c_master_transmit_receive(dev, &reg, 1, val, 1, 200);
    if (e != ESP_OK) ESP_LOGW(TAG, "codec read reg %02x: %s", reg, esp_err_to_name(e));
    return e == ESP_OK ? 0 : LUME_AUDIO_ERR_DRIVER;
}

static int bits(i2c_master_dev_handle_t dev, uint8_t reg, uint8_t mask, uint8_t value)
{
    uint8_t old;
    if (get(dev, reg, &old) < 0) return LUME_AUDIO_ERR_DRIVER;
    return put(dev, reg, (old & ~mask) | value);
}

static int sequence(i2c_master_dev_handle_t dev, const uint8_t (*seq)[2], size_t count)
{
    for (size_t i = 0; i < count; ++i)
        if (put(dev, seq[i][0], seq[i][1]) < 0) return LUME_AUDIO_ERR_DRIVER;
    return 0;
}

static int codecs_init(void)
{
    /* ES8311: reset, MCLK pin / 256fs, Philips slave 16-bit, DAC power. */
    static const uint8_t dac_reset[][2] = {
        {0x00,0x1f},{0x00,0x00},{0x00,0x80},
        {0x01,0x3f}
    };
    static const uint8_t dac_clock[][2] = {{0x03,0x10},{0x04,0x10},{0x05,0x00}};
    static const uint8_t dac_power[][2] = {
        {0x09,0x0c},{0x0a,0x0c},
        {0x0d,0x01},{0x0e,0x02},{0x12,0x00},{0x13,0x10},
        {0x1c,0x6a},{0x37,0x08},{0x17,0xc8},{0x14,0x1a},{0x16,0x03}
    };
    if (sequence(s_dac, dac_reset, sizeof(dac_reset)/sizeof(dac_reset[0])) < 0) return LUME_AUDIO_ERR_DRIVER;
    /* coeff_div[4096000,16000] in vendor es8311.c:73: prediv=1,
     * adc/dac div=1, bclk divisor=4; preserve reg02 low clock-source bits. */
    if (bits(s_dac, 0x02, 0xf8, 0x00) < 0 ||
        sequence(s_dac, dac_clock, sizeof(dac_clock)/sizeof(dac_clock[0])) < 0 ||
        bits(s_dac, 0x06, 0x3f, 0x03) < 0 ||
        bits(s_dac, 0x07, 0x3f, 0x00) < 0 ||
        put(s_dac, 0x08, 0xff) < 0 ||
        bits(s_dac, 0x00, 0x40, 0x00) < 0) return LUME_AUDIO_ERR_DRIVER;
    if (sequence(s_dac, dac_power, sizeof(dac_power)/sizeof(dac_power[0])) < 0) return LUME_AUDIO_ERR_DRIVER;
    if (lume_audio_set_volume(s_volume) < 0) return LUME_AUDIO_ERR_DRIVER;

    /* ES7210 vendor 16k/4.096MHz coefficient row, all four MICs enabled;
     * 1/2 gain 0dB, 3/4 gain 37.5dB, as in 06_ES7210.ino:40-45. */
    static const uint8_t adc[][2] = {
        {0x00,0xff},{0x00,0x41},{0x01,0x1f},{0x09,0x30},{0x0a,0x30},
        {0x40,0xc3},{0x41,0x70},{0x42,0x70},
        {0x02,0xc1},{0x07,0x20},{0x04,0x01},{0x05,0x00},
        {0x11,0x60},{0x12,0x00},
        {0x4b,0xff},{0x4c,0xff},
        {0x4b,0x00},{0x4c,0x00},
        {0x43,0x10},{0x44,0x10},{0x45,0x1e},{0x46,0x1e},
        {0x01,0x00},{0x06,0x00},
        {0x47,0x00},{0x48,0x00},{0x49,0x00},{0x4a,0x00}
    };
    return sequence(s_adc, adc, sizeof(adc)/sizeof(adc[0]));
}

int lume_audio_set_volume(int percent)
{
    if (percent < 0 || percent > 100) return LUME_AUDIO_ERR_ARG;
    s_volume = percent;
    if (!s_dac) return LUME_AUDIO_ERR_STATE;
    return put(s_dac, 0x32, percent ? (percent * 256 / 100) - 1 : 0);
}

int lume_audio_init(void)
{
    if (s_ready) return 0;
    i2c_master_bus_handle_t bus = lume_board_get_i2c_bus();
    if (!bus) return LUME_AUDIO_ERR_STATE;
    i2c_device_config_t cfg = {.dev_addr_length=I2C_ADDR_BIT_LEN_7,
                               .scl_speed_hz=100000};
    if (!s_dac) {
        cfg.device_address=ES8311;
        if (i2c_master_bus_add_device(bus, &cfg, &s_dac) != ESP_OK) return LUME_AUDIO_ERR_DRIVER;
    }
    if (!s_adc) {
        cfg.device_address=ES7210;
        if (i2c_master_bus_add_device(bus, &cfg, &s_adc) != ESP_OK) return LUME_AUDIO_ERR_DRIVER;
    }
    if (!s_i2s_ready) {
        i2s_chan_config_t tx_cfg = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_MASTER);
        i2s_chan_config_t rx_cfg = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_1, I2S_ROLE_SLAVE);
        if (!s_tx && i2s_new_channel(&tx_cfg, &s_tx, NULL) != ESP_OK) return LUME_AUDIO_ERR_DRIVER;
        if (!s_rx && i2s_new_channel(&rx_cfg, NULL, &s_rx) != ESP_OK) return LUME_AUDIO_ERR_DRIVER;
        i2s_std_config_t tx = {
            .clk_cfg=I2S_STD_CLK_DEFAULT_CONFIG(16000),
            .slot_cfg=I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO),
            .gpio_cfg={.mclk=LUME_PIN_I2S_MCLK,.bclk=LUME_PIN_I2S_SCLK,
                       .ws=LUME_PIN_I2S_LRCK,.dout=LUME_PIN_I2S_DOUT,.din=I2S_GPIO_UNUSED}
        };
        i2s_std_config_t rx = tx;
        rx.gpio_cfg.mclk=I2S_GPIO_UNUSED;
        rx.gpio_cfg.dout=I2S_GPIO_UNUSED;
        rx.gpio_cfg.din=LUME_PIN_I2S_DIN;
        /* Configure slave inputs first; master output routing owns BCLK/WS. */
        if (i2s_channel_init_std_mode(s_rx, &rx) != ESP_OK ||
            i2s_channel_init_std_mode(s_tx, &tx) != ESP_OK) return LUME_AUDIO_ERR_DRIVER;
        if (gpio_input_enable(LUME_PIN_I2S_SCLK) != ESP_OK ||
            gpio_input_enable(LUME_PIN_I2S_LRCK) != ESP_OK) return LUME_AUDIO_ERR_DRIVER;
        if (i2s_channel_enable(s_rx) != ESP_OK ||
            i2s_channel_enable(s_tx) != ESP_OK) return LUME_AUDIO_ERR_DRIVER;
        s_i2s_ready = true;
    }
    /* Vendor enables PA after I2S setup and before codec setup. */
    esp_err_t pa = gpio_set_direction(LUME_PIN_AUDIO_PA, GPIO_MODE_OUTPUT);
    if (pa == ESP_OK) gpio_set_level(LUME_PIN_AUDIO_PA, 1);
    else ESP_LOGW(TAG, "PA GPIO%d output unavailable: %s",
                  LUME_PIN_AUDIO_PA, esp_err_to_name(pa));
    if (codecs_init() < 0) return LUME_AUDIO_ERR_DRIVER;
    s_ready = true;
    return 0;
}

int lume_audio_play(const void *pcm, size_t bytes)
{
    if (!pcm || !bytes || (bytes & 3)) return LUME_AUDIO_ERR_ARG;
    int r = lume_audio_init();
    if (r < 0) return r;
    if (bits(s_dac, 0x31, 0x60, 0x00) < 0) return LUME_AUDIO_ERR_DRIVER;
    const uint8_t *p=pcm;
    while (bytes) {
        size_t sent=0;
        size_t n=bytes > 4096 ? 4096 : bytes;
        if (i2s_channel_write(s_tx, p, n, &sent, 1000) != ESP_OK || !sent)
            return LUME_AUDIO_ERR_DRIVER;
        p += sent; bytes -= sent;
    }
    return 0;
}

int lume_audio_record(void *pcm, size_t bytes)
{
    if (!pcm || !bytes || (bytes & 3)) return LUME_AUDIO_ERR_ARG;
    int r = lume_audio_init();
    if (r < 0) return r;
    uint8_t *p=pcm;
    while (bytes) {
        size_t got=0;
        size_t n=bytes > 4096 ? 4096 : bytes;
        if (i2s_channel_read(s_rx, p, n, &got, 1000) != ESP_OK || !got)
            return LUME_AUDIO_ERR_DRIVER;
        p += got; bytes -= got;
    }
    return 0;
}

int lume_audio_stop(void)
{
    /* Synchronous calls run on the engine task, so stop mutes future playback.
     * There is no concurrent playback worker to interrupt in M1. */
    if (!s_dac) return LUME_AUDIO_ERR_STATE;
    return bits(s_dac, 0x31, 0x60, 0x60);
}
