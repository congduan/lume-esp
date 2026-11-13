/**
 * lume-adc: ADC1 oneshot + calibration hardware layer for the lume.adc
 * JS bindings (M2).
 *
 * Thread discipline: every entry point is called ONLY from the QuickJS engine
 * task (via the lume_engine.c natives), same thread as the existing lume.*
 * setters. No lv_*, no new locks, no large buffers. All state here (the slot
 * table, the shared unit handle) is engine-task-only state and, like the
 * natives, survives a hot-reload runtime reset.
 *
 * ESP-IDF v5.5.5 APIs verified against the installed headers before coding
 * (examples/peripherals/adc/oneshot_read is the reference):
 *  - esp_adc/adc_oneshot.h (esp_adc): adc_oneshot_new_unit(),
 *    adc_oneshot_config_channel(), adc_oneshot_read(). The unit init struct is
 *    designated-init with only .unit_id = ADC_UNIT_1 (clk_src / ulp_mode
 *    default to 0, mirroring the example). A unit can have only ONE handle:
 *    adc_oneshot_new_unit() returns ESP_ERR_NOT_FOUND ("adc1 is already in
 *    use", adc_oneshot.c:99) on a second claim, so ONE shared ADC1 unit
 *    handle serves every pin and channels are configured independently.
 *  - esp_adc/adc_cali.h + esp_adc/adc_cali_scheme.h: curve fitting is the only
 *    calibration scheme compiled for ESP32-S3
 *    (ADC_CALI_SCHEME_CURVE_FITTING_SUPPORTED=1 in
 *    esp_adc/esp32s3/include/adc_cali_schemes.h); line fitting is NOT defined.
 *    adc_cali_create_scheme_curve_fitting() / _delete_...() +
 *    adc_cali_raw_to_voltage() convert a raw sample to mV. Creation can fail
 *    with ESP_ERR_NOT_SUPPORTED when eFuse calibration bits are not burnt
 *    (adc_cali_curve_fitting.c:79); the official example warns + skips.
 *  - hal/adc_types.h: adc_atten_t ADC_ATTEN_DB_0/2_5/6/12 = 0/1/2/3
 *    (ADC_ATTEN_DB_11 is a DEPRECATED alias of DB_12 in v5.5 -> use _12),
 *    ADC_BITWIDTH_DEFAULT (12-bit on S3 -> raw 0..4095).
 *  - soc/esp32s3/include/soc/adc_channel.h: ADC1 GPIO 1..10 -> channels 0..9
 *    (ADC2 occupies GPIO 11..20, SOC_ADC_PERIPH_NUM=2; deliberately out of
 *    scope, see docs/KNOWN-SIMPLIFICATIONS.md).
 */
#include <stdbool.h>
#include <stdint.h>
#include "esp_adc/adc_oneshot.h"
#include "esp_adc/adc_cali.h"
#include "esp_adc/adc_cali_scheme.h"
#include "esp_err.h"
#include "esp_log.h"
#include "lume_adc.h"

static const char *TAG = "lume-adc";

/* ESP32-S3 ADC1 GPIO -> channel map, hardcoded from
 * soc/esp32s3/include/soc/adc_channel.h (verified in IDF 5.5.5):
 *   ADC1_CHANNEL_0_GPIO_NUM=1 ... ADC1_CHANNEL_9_GPIO_NUM=10.
 * Index = GPIO number; -1 = not an ADC1 pad. GPIO 0 is not ADC1; GPIO 11..20
 * are ADC2 (unused). Validation is deliberately at the "ADC1-samplable set"
 * level only -- no board-specific divider / net assumptions. */
#define LUME_ADC_SLOT_COUNT 11   /* GPIO 0..10 indexable */
static const int8_t s_pin_to_chan[LUME_ADC_SLOT_COUNT] = {
    -1,  /* GPIO0  not ADC1 */
     0,  /* GPIO1  ADC1_CHANNEL_0 */
     1,  /* GPIO2  ADC1_CHANNEL_1 */
     2,  /* GPIO3  ADC1_CHANNEL_2 */
     3,  /* GPIO4  ADC1_CHANNEL_3 */
     4,  /* GPIO5  ADC1_CHANNEL_4 */
     5,  /* GPIO6  ADC1_CHANNEL_5 */
     6,  /* GPIO7  ADC1_CHANNEL_6 */
     7,  /* GPIO8  ADC1_CHANNEL_7 */
     8,  /* GPIO9  ADC1_CHANNEL_8 */
     9,  /* GPIO10 ADC1_CHANNEL_9 */
};

typedef struct {
    adc_cali_handle_t cali;   /* NULL when calibration is unavailable */
    bool active;              /* channel configured + usable for raw reads */
} adc_slot_t;
static adc_slot_t s_slots[LUME_ADC_SLOT_COUNT];

/* One shared ADC1 unit handle for all pins (the driver allows one handle per
 * unit). Created lazily on the first config and kept for the runtime lifetime;
 * free(pin) does NOT delete it, matching how gpio.pwmFree stops a channel
 * without tearing down the LEDC peripheral. */
static adc_oneshot_unit_handle_t s_unit = NULL;

/* Resolve an ADC1 GPIO to its channel. Returns the channel (0..9) on success
 * or a negative LUME_ADC_ERR_* code. */
static int pin_to_channel(int pin)
{
    if (pin < 0 || pin >= LUME_ADC_SLOT_COUNT || s_pin_to_chan[pin] < 0) {
        ESP_LOGW(TAG, "invalid ADC1 pin %d (valid: GPIO 1..10)", pin);
        return LUME_ADC_ERR_ARG;
    }
    return s_pin_to_chan[pin];
}

/* Map the JS-visible atten tag (0..3) to the enum. The enum values happen to
 * be 0..3 too, but map explicitly so the contract does not rely on that. */
static int atten_from_arg(int atten, adc_atten_t *out)
{
    switch (atten) {
    case LUME_ADC_ATTEN_0DB:   *out = ADC_ATTEN_DB_0;   return LUME_ADC_OK;
    case LUME_ADC_ATTEN_2_5DB: *out = ADC_ATTEN_DB_2_5; return LUME_ADC_OK;
    case LUME_ADC_ATTEN_6DB:   *out = ADC_ATTEN_DB_6;   return LUME_ADC_OK;
    case LUME_ADC_ATTEN_12DB:  *out = ADC_ATTEN_DB_12;  return LUME_ADC_OK;
    default:
        ESP_LOGW(TAG, "config: invalid atten %d (expected 0..3)", atten);
        return LUME_ADC_ERR_ARG;
    }
}

/* Create the curve-fitting calibration handle for (channel, atten).
 * ESP_OK -> *out set; ESP_ERR_NOT_SUPPORTED -> eFuse calibration bits absent,
 * *out stays NULL and the pin remains usable for raw reads only; any other
 * error is a real driver failure. */
static esp_err_t cali_create(adc_channel_t chan, adc_atten_t atten,
                             adc_cali_handle_t *out)
{
    *out = NULL;
#if ADC_CALI_SCHEME_CURVE_FITTING_SUPPORTED
    adc_cali_curve_fitting_config_t cfg = {
        .unit_id  = ADC_UNIT_1,
        .chan     = chan,
        .atten    = atten,
        .bitwidth = ADC_BITWIDTH_DEFAULT,
    };
    return adc_cali_create_scheme_curve_fitting(&cfg, out);
#else
    return ESP_ERR_NOT_SUPPORTED;
#endif
}

static void cali_delete(adc_cali_handle_t handle)
{
#if ADC_CALI_SCHEME_CURVE_FITTING_SUPPORTED
    if (handle != NULL) {
        adc_cali_delete_scheme_curve_fitting(handle);
    }
#else
    (void)handle;
#endif
}

/* Shared helper for readRaw()/readMv(): validate + oneshot-read the raw
 * sample. Returns LUME_ADC_OK with *out_raw set, or a negative error. */
static int do_read(int pin, int *out_raw)
{
    int ch = pin_to_channel(pin);
    if (ch < 0) {
        return ch;
    }
    if (!s_slots[pin].active || s_unit == NULL) {
        ESP_LOGW(TAG, "read: pin %d is not configured (call config first)", pin);
        return LUME_ADC_ERR_STATE;
    }
    esp_err_t err = adc_oneshot_read(s_unit, (adc_channel_t)ch, out_raw);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "read: adc_oneshot_read(pin=%d) failed: %s",
                 pin, esp_err_to_name(err));
        return LUME_ADC_ERR_DRIVER;
    }
    return LUME_ADC_OK;
}

int lume_adc_config(int pin, int atten)
{
    int ch = pin_to_channel(pin);
    if (ch < 0) {
        return ch;
    }
    adc_atten_t hw_atten;
    int r = atten_from_arg(atten, &hw_atten);
    if (r != LUME_ADC_OK) {
        return r;
    }

    /* Lazily create the single shared ADC1 unit handle. */
    if (s_unit == NULL) {
        adc_oneshot_unit_init_cfg_t init = { .unit_id = ADC_UNIT_1 };
        esp_err_t err = adc_oneshot_new_unit(&init, &s_unit);
        if (err != ESP_OK) {
            ESP_LOGW(TAG, "config: adc_oneshot_new_unit(ADC_UNIT_1) failed: %s",
                     esp_err_to_name(err));
            s_unit = NULL;
            return LUME_ADC_ERR_DRIVER;
        }
    }

    /* ---- conflict / re-config policy (cf. lume-gpio pwmAttach comment) ----
     * Each GPIO is a distinct ADC1 channel, so there are no cross-pin channel
     * conflicts (unlike PWM channel sharing). The only overlapping case is a
     * repeat config of the SAME pin: last-wins rebuild -- tear down the old
     * calibration handle, mark the slot inactive, then re-apply the channel
     * config and create a fresh handle for the new atten. A prior free() is
     * not required. On any driver failure the slot is left inactive, so state
     * never claims a pin is configured when hardware is not. */
    if (s_slots[pin].active) {
        ESP_LOGW(TAG, "config: re-config pin %d (last-wins rebuild)", pin);
        cali_delete(s_slots[pin].cali);
        s_slots[pin].cali = NULL;
        s_slots[pin].active = false;
    }

    adc_oneshot_chan_cfg_t ch_cfg = {
        .atten    = hw_atten,
        .bitwidth = ADC_BITWIDTH_DEFAULT,
    };
    esp_err_t err = adc_oneshot_config_channel(s_unit, (adc_channel_t)ch,
                                               &ch_cfg);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "config: adc_oneshot_config_channel(pin=%d) failed: %s",
                 pin, esp_err_to_name(err));
        return LUME_ADC_ERR_DRIVER;
    }

    /* Calibration may be unavailable (eFuse not burnt): the official example
     * warns and skips. Keep the pin usable for raw reads; readMv() reports
     * LUME_ADC_ERR_STATE when no handle exists. */
    adc_cali_handle_t cali = NULL;
    err = cali_create((adc_channel_t)ch, hw_atten, &cali);
    if (err == ESP_OK) {
        s_slots[pin].cali = cali;
    } else if (err == ESP_ERR_NOT_SUPPORTED) {
        ESP_LOGW(TAG, "config: pin %d calibration unavailable (eFuse not "
                      "burnt); readMv disabled, readRaw still works", pin);
        /* s_slots[pin].cali stays NULL */
    } else {
        ESP_LOGW(TAG, "config: calibration scheme create (pin=%d) failed: %s",
                 pin, esp_err_to_name(err));
        return LUME_ADC_ERR_DRIVER;
    }

    s_slots[pin].active = true;
    return LUME_ADC_OK;
}

int lume_adc_read_raw(int pin)
{
    int raw = 0;
    int r = do_read(pin, &raw);
    if (r != LUME_ADC_OK) {
        return r;
    }
    return raw;   /* 0..4095; negative values are errors */
}

int lume_adc_read_mv(int pin)
{
    int raw = 0;
    int r = do_read(pin, &raw);
    if (r != LUME_ADC_OK) {
        return r;
    }
    if (s_slots[pin].cali == NULL) {
        ESP_LOGW(TAG, "readMv: pin %d has no calibration handle (eFuse not "
                      "burnt); readRaw still available", pin);
        return LUME_ADC_ERR_STATE;
    }
    int mv = 0;
    esp_err_t err = adc_cali_raw_to_voltage(s_slots[pin].cali, raw, &mv);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "readMv: adc_cali_raw_to_voltage(pin=%d) failed: %s",
                 pin, esp_err_to_name(err));
        return LUME_ADC_ERR_DRIVER;
    }
    return mv;   /* mV; negative values are errors */
}

int lume_adc_free(int pin)
{
    int ch = pin_to_channel(pin);
    if (ch < 0) {
        return ch;
    }
    if (!s_slots[pin].active) {
        ESP_LOGW(TAG, "free: pin %d is not configured", pin);
        return LUME_ADC_ERR_STATE;
    }
    cali_delete(s_slots[pin].cali);
    s_slots[pin].cali = NULL;
    s_slots[pin].active = false;
    /* The shared ADC1 unit handle is intentionally kept (see the header and
     * the file-top comment): other pins and future configs still use it, just
     * as gpio.pwmFree leaves the LEDC peripheral alive. */
    return LUME_ADC_OK;
}
