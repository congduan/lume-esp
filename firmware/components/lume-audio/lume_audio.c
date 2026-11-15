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
#include "freertos/queue.h"
#include "esp_heap_caps.h"
#include "esp_timer.h"
#include <string.h>

/* Codec I2C addresses come from the board profile (lume_pins.h). */
#define ES8311 LUME_I2C_ADDR_ES8311
#define ES7210 LUME_I2C_ADDR_ES7210
static const char *TAG = "lume-audio";
static i2c_master_dev_handle_t s_dac, s_adc;
static i2s_chan_handle_t s_tx, s_rx;
static bool s_ready;
static bool s_i2s_ready;
static int s_volume = 85;
typedef struct { uint8_t *data; size_t bytes; int rate; unsigned generation; } stream_chunk_t;
static QueueHandle_t s_stream_queue;
static TaskHandle_t s_stream_task;
static volatile int s_stream_pending, s_stream_paused;
static int s_tx_rate = 16000;
static unsigned s_stream_generation;
static int64_t s_stream_drain_until_us;
static int tx_rate(int rate)
{
    if (s_tx_rate == rate) return 0;
    if (i2s_channel_disable(s_tx) != ESP_OK) return LUME_AUDIO_ERR_DRIVER;
    i2s_std_clk_config_t cfg = I2S_STD_CLK_DEFAULT_CONFIG(rate);
    if (i2s_channel_reconfig_std_clock(s_tx, &cfg) != ESP_OK ||
        i2s_channel_enable(s_tx) != ESP_OK) return LUME_AUDIO_ERR_DRIVER;
    s_tx_rate = rate;
    return 0;
}

static void stream_worker(void *arg)
{
    (void)arg;
    stream_chunk_t chunk;
    unsigned active_generation = s_stream_generation;
    for (;;) {
        if (xQueueReceive(s_stream_queue, &chunk, portMAX_DELAY) != pdTRUE) continue;
        while (s_stream_paused && chunk.generation == s_stream_generation)
            vTaskDelay(pdMS_TO_TICKS(10));
        if (chunk.generation != s_stream_generation) goto discard;
        if (chunk.generation != active_generation) {
            /* Drop stale DMA samples before the next track starts. */
            i2s_channel_disable(s_tx);
            i2s_channel_enable(s_tx);
            active_generation = chunk.generation;
        }
        if (tx_rate(chunk.rate) < 0) goto discard;
        size_t at = 0;
        while (at < chunk.bytes && s_tx_rate == chunk.rate &&
               chunk.generation == s_stream_generation) {
            while (s_stream_paused && chunk.generation == s_stream_generation)
                vTaskDelay(pdMS_TO_TICKS(10));
            size_t sent = 0;
            esp_err_t err = i2s_channel_write(s_tx, chunk.data + at,
                chunk.bytes - at, &sent, pdMS_TO_TICKS(1000));
            if (err != ESP_OK || !sent) break;
            at += sent;
        }
        /* i2s_channel_write returns after copying to DMA, before the last
         * sample leaves the pin. Default DMA is 6 x 240 frames. */
        __atomic_store_n(&s_stream_drain_until_us,
            esp_timer_get_time() + (int64_t)1440 * 1000000 / chunk.rate + 2000,
            __ATOMIC_SEQ_CST);
discard:
        heap_caps_free(chunk.data);
        __atomic_sub_fetch(&s_stream_pending, 1, __ATOMIC_SEQ_CST);
    }
}

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
        /* The TX DMA ring is circular: with the default auto_clear_after_cb=false
         * the driver re-sends the last descriptor forever, so any short PCM
         * buffer (a 30 ms game beep) repeats as a continuous tone that only a
         * reboot stops. Clearing each descriptor buffer once it has been sent
         * (i2s_common.c i2s_dma_tx_callback) makes the line fall silent as soon
         * as the queued samples run out; i2s_channel_write already returns after
         * the copy, so silence trails the last sample by up to one DMA round. */
        tx_cfg.auto_clear_after_cb = true;
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
    if (!lume_audio_stream_finished()) return LUME_AUDIO_ERR_STATE;
    if (tx_rate(16000) < 0) return LUME_AUDIO_ERR_DRIVER;
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

int lume_audio_play_stream(const void *pcm, size_t bytes, int rate, int channels, int bit_depth)
{
    if (!pcm || !bytes || bytes > 4608 || (bytes & 3) || channels != 2 ||
        bit_depth != 16 || (rate != 44100 && rate != 48000 && rate != 32000 && rate != 16000))
        return LUME_AUDIO_ERR_ARG;
    int r = lume_audio_init();
    if (r < 0) return r;
    if (!s_stream_queue) {
        s_stream_queue = xQueueCreate(16, sizeof(stream_chunk_t));
        if (!s_stream_queue) return LUME_AUDIO_ERR_MEMORY;
        if (xTaskCreate(stream_worker, "lume_audio_stream", 4096, NULL, 5,
                        &s_stream_task) != pdPASS) {
            vQueueDelete(s_stream_queue);
            s_stream_queue = NULL;
            return LUME_AUDIO_ERR_MEMORY;
        }
    }
    if (uxQueueSpacesAvailable(s_stream_queue) == 0) return LUME_AUDIO_ERR_STATE;
    uint8_t *copy = heap_caps_malloc(bytes, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!copy) return LUME_AUDIO_ERR_MEMORY;
    memcpy(copy, pcm, bytes);
    if (bits(s_dac, 0x31, 0x60, 0x00) < 0) { heap_caps_free(copy); return LUME_AUDIO_ERR_DRIVER; }
    stream_chunk_t chunk = {copy, bytes, rate, s_stream_generation};
    __atomic_add_fetch(&s_stream_pending, 1, __ATOMIC_SEQ_CST);
    if (xQueueSend(s_stream_queue, &chunk, 0) != pdTRUE) {
        __atomic_sub_fetch(&s_stream_pending, 1, __ATOMIC_SEQ_CST);
        heap_caps_free(copy);
        return LUME_AUDIO_ERR_STATE;
    }
    return 0;
}

bool lume_audio_stream_finished(void)
{
    return __atomic_load_n(&s_stream_pending, __ATOMIC_SEQ_CST) == 0 &&
        esp_timer_get_time() >= __atomic_load_n(&s_stream_drain_until_us,
                                                __ATOMIC_SEQ_CST);
}

int lume_audio_stream_pause(bool paused)
{
    s_stream_paused = paused;
    if (!s_dac) return LUME_AUDIO_ERR_STATE;
    return bits(s_dac, 0x31, 0x60, paused ? 0x60 : 0x00);
}
int lume_audio_stream_reset(void)
{
    ++s_stream_generation;
    s_stream_paused=0;
    __atomic_store_n(&s_stream_drain_until_us,0,__ATOMIC_SEQ_CST);
    if (s_stream_queue) {
        stream_chunk_t chunk;
        while (xQueueReceive(s_stream_queue,&chunk,0)==pdTRUE) {
            heap_caps_free(chunk.data);
            __atomic_sub_fetch(&s_stream_pending,1,__ATOMIC_SEQ_CST);
        }
    }
    return lume_audio_stop();
}

int lume_audio_record(void *pcm, size_t bytes)
{
    if (!pcm || !bytes || (bytes & 3)) return LUME_AUDIO_ERR_ARG;
    int r = lume_audio_init();
    if (r < 0) return r;
    if (!lume_audio_stream_finished()) return LUME_AUDIO_ERR_STATE;
    if (tx_rate(16000) < 0) return LUME_AUDIO_ERR_DRIVER;
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
