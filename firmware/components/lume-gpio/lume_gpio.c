/**
 * lume-gpio: GPIO + LEDC PWM hardware layer for the lume.gpio JS bindings.
 *
 * Thread discipline: every entry point is called ONLY from the QuickJS engine
 * task (via the lume_engine.c natives), same thread as the existing lume.*
 * setters. No lv_*, no new locks, no large buffers. The PWM state table is
 * engine-task-only state.
 *
 * ESP-IDF v5.5.5 APIs verified against the installed headers before coding:
 *  - driver/gpio.h  (esp_driver_gpio): gpio_config_t, gpio_config(),
 *    gpio_set_level(), gpio_get_level(), GPIO_IS_VALID_GPIO/OUTPUT_GPIO,
 *    gpio_mode_t / gpio_pullup_t / gpio_pulldown_t / gpio_int_type_t.
 *    NOTE: v5.5 gpio_config_t has a CONDITIONAL hys_ctrl_mode member, so the
 *    struct is zero-initialised; gpio_config() overwrites all prior IO config
 *    (no legacy gpio_reset_pin()/gpio_set_direction() call is needed -- the
 *    brief's "gpio_reset_pin is deprecated" note does not hold: it is a normal
 *    function at gpio.h:82). Deprecated items (gpio_iomux_in/out,
 *    gpio_pull_mode_t) are deliberately avoided.
 *  - driver/ledc.h  (esp_driver_ledc): ledc_timer_config_t /
 *    ledc_channel_config_t (designated init mirrors examples/peripherals/ledc/
 *    ledc_basic), ledc_timer_config(), ledc_channel_config(), ledc_set_duty(),
 *    ledc_update_duty(), ledc_stop(). LEDC_TIMER_8_BIT, LEDC_AUTO_CLK,
 *    LEDC_LOW_SPEED_MODE, LEDC_INTR_DISABLE confirmed in hal/ledc_types.h.
 */
#include <stdbool.h>
#include <stdint.h>
#include "driver/gpio.h"
#include "driver/ledc.h"
#include "esp_err.h"
#include "esp_log.h"
#include "lume_gpio.h"

static const char *TAG = "lume-gpio";

/* ---- PWM state (engine-task-only) ---------------------------------------
 * ESP32-S3 LEDC exposes 8 low-speed channels but only 4 timers
 * (LEDC_TIMER_MAX = 4, SOC_LEDC_CHANNEL_NUM = 8). A channel's frequency is
 * set by its timer, so to keep each channel's freqHz independent this binding
 * binds channel N to timer N (1:1) and therefore exposes channels
 * 0 .. LEDC_TIMER_MAX-1. Reusing the remaining 4 hardware channels (which
 * would have to share timers, hence frequencies) is left for a later pass.
 *
 * s_pwm[ch].pin is the GPIO bound to that channel; active=false => free.
 * pwmDuty(pin, pct) resolves pin -> channel through this table because JS
 * passes only a pin, not a channel.
 */
typedef struct {
    int  pin;
    bool active;
} pwm_slot_t;
static pwm_slot_t s_pwm[LEDC_TIMER_MAX];

/* 8-bit resolution: ledc.h states duty range [0, (2**duty_resolution)] i.e.
 * [0, 256]; 256 is the full-duty value. pct ∈ [0,100]. */
#define PWM_DUTY_MAX (1u << 8)
static uint32_t duty_from_pct(int pct)
{
    return (uint32_t)pct * PWM_DUTY_MAX / 100;
}

/* Validate a GPIO number. Short-circuit keeps the 1ULL<<pin macros inside
 * gpio.h's valid range. need_output also requires an output-capable pad. */
static int check_pin(int pin, bool need_output)
{
    if (pin < 0 || pin >= GPIO_PIN_COUNT ||
        !GPIO_IS_VALID_GPIO((gpio_num_t)pin) ||
        (need_output && !GPIO_IS_VALID_OUTPUT_GPIO((gpio_num_t)pin))) {
        ESP_LOGW(TAG, "invalid GPIO pin %d%s", pin,
                 need_output ? " (output-capable required)" : "");
        return LUME_GPIO_ERR_ARG;
    }
    return LUME_GPIO_OK;
}

int lume_gpio_set_pin(int pin, int mode, int pull)
{
    int r = check_pin(pin, false);
    if (r != LUME_GPIO_OK) {
        return r;
    }
    /* GPIO_MODE_* are bitmasks (INPUT=1, OUTPUT=2, OUTPUT_OD=6), so the
     * JS-visible 0/1/2 tags must be mapped, not passed through. */
    gpio_mode_t gmode;
    switch (mode) {
    case LUME_GPIO_MODE_INPUT:     gmode = GPIO_MODE_INPUT;     break;
    case LUME_GPIO_MODE_OUTPUT:    gmode = GPIO_MODE_OUTPUT;    break;
    case LUME_GPIO_MODE_OUTPUT_OD: gmode = GPIO_MODE_OUTPUT_OD; break;
    default:
        ESP_LOGW(TAG, "setPin: invalid mode %d (expected 0..2)", mode);
        return LUME_GPIO_ERR_ARG;
    }
    gpio_pullup_t up = GPIO_PULLUP_DISABLE;
    gpio_pulldown_t down = GPIO_PULLDOWN_DISABLE;
    switch (pull) {
    case LUME_GPIO_PULL_NONE: break;
    case LUME_GPIO_PULL_UP:   up = GPIO_PULLUP_ENABLE;     break;
    case LUME_GPIO_PULL_DOWN: down = GPIO_PULLDOWN_ENABLE; break;
    default:
        ESP_LOGW(TAG, "setPin: invalid pull %d (expected 0..2)", pull);
        return LUME_GPIO_ERR_ARG;
    }

    gpio_config_t io = { 0 };   /* zero-init covers conditional hys_ctrl_mode */
    io.pin_bit_mask  = 1ULL << pin;
    io.mode          = gmode;
    io.pull_up_en    = up;
    io.pull_down_en  = down;
    io.intr_type     = GPIO_INTR_DISABLE;
    esp_err_t err = gpio_config(&io);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "setPin: gpio_config(pin=%d) failed: %s",
                 pin, esp_err_to_name(err));
        return LUME_GPIO_ERR_DRIVER;
    }
    return LUME_GPIO_OK;
}

int lume_gpio_write(int pin, int level)
{
    int r = check_pin(pin, true);
    if (r != LUME_GPIO_OK) {
        return r;
    }
    if (level != 0 && level != 1) {
        ESP_LOGW(TAG, "write: invalid level %d (expected 0/1)", level);
        return LUME_GPIO_ERR_ARG;
    }
    esp_err_t err = gpio_set_level((gpio_num_t)pin, (uint32_t)level);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "write: gpio_set_level(pin=%d) failed: %s",
                 pin, esp_err_to_name(err));
        return LUME_GPIO_ERR_DRIVER;
    }
    return LUME_GPIO_OK;
}

int lume_gpio_read(int pin)
{
    int r = check_pin(pin, false);
    if (r != LUME_GPIO_OK) {
        return r;
    }
    return gpio_get_level((gpio_num_t)pin);   /* 0/1; negatives are errors */
}

int lume_gpio_toggle(int pin)
{
    int r = check_pin(pin, true);
    if (r != LUME_GPIO_OK) {
        return r;
    }
    int level = gpio_get_level((gpio_num_t)pin);
    esp_err_t err = gpio_set_level((gpio_num_t)pin, level ? 0u : 1u);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "toggle: gpio_set_level(pin=%d) failed: %s",
                 pin, esp_err_to_name(err));
        return LUME_GPIO_ERR_DRIVER;
    }
    return LUME_GPIO_OK;
}

/* Resolve a pin to its owning LEDC channel for pwmDuty(). */
static int find_channel(int pin, int *out_ch)
{
    for (int ch = 0; ch < LEDC_TIMER_MAX; ch++) {
        if (s_pwm[ch].active && s_pwm[ch].pin == pin) {
            *out_ch = ch;
            return LUME_GPIO_OK;
        }
    }
    ESP_LOGW(TAG, "pin %d is not PWM-attached", pin);
    return LUME_GPIO_ERR_STATE;
}

int lume_gpio_pwm_attach(int pin, int freq_hz, int duty_pct, int channel)
{
    int r = check_pin(pin, true);
    if (r != LUME_GPIO_OK) {
        return r;
    }
    if (freq_hz <= 0) {
        ESP_LOGW(TAG, "pwmAttach: invalid freqHz %d (must be > 0)", freq_hz);
        return LUME_GPIO_ERR_ARG;
    }
    if (duty_pct < 0 || duty_pct > 100) {
        ESP_LOGW(TAG, "pwmAttach: dutyPct %d out of range (0..100)", duty_pct);
        return LUME_GPIO_ERR_ARG;
    }
    if (channel < 0 || channel >= LEDC_TIMER_MAX) {
        ESP_LOGW(TAG, "pwmAttach: channel %d out of range (0..%d)",
                 channel, LEDC_TIMER_MAX - 1);
        return LUME_GPIO_ERR_ARG;
    }

    /* ---- channel / pin conflict policy ----
     * 1) pin already bound to a DIFFERENT channel -> reject. One GPIO pad can
     *    be driven by only one LEDC channel; silently re-binding it would
     *    leave the old channel's state out of sync with hardware. Caller must
     *    re-attach on the original channel or stop it first.
     * 2) same channel re-attached (any pin) -> last-wins reconfigure: stop the
     *    old output, mark the slot free, then re-apply timer + channel config.
     *    A repeat with the same pin just refreshes freq/duty.
     * On any driver failure the slot is left inactive so state never claims a
     * channel is running when hardware is not configured. */
    int owner = -1;
    for (int ch = 0; ch < LEDC_TIMER_MAX; ch++) {
        if (s_pwm[ch].active && s_pwm[ch].pin == pin) {
            owner = ch;
            break;
        }
    }
    if (owner >= 0 && owner != channel) {
        ESP_LOGW(TAG, "pwmAttach: pin %d already bound to channel %d "
                      "(requested %d)", pin, owner, channel);
        return LUME_GPIO_ERR_STATE;
    }
    if (s_pwm[channel].active) {
        ESP_LOGW(TAG, "pwmAttach: re-attach channel %d (pin %d -> %d)",
                 channel, s_pwm[channel].pin, pin);
        ledc_stop(LEDC_LOW_SPEED_MODE, (ledc_channel_t)channel, 0);
        s_pwm[channel].active = false;
    }

    /* Designated init (ledc_basic example pattern): sleep_mode/flags and
     * deconfigure default to 0/false. channel N <-> timer N, independent freq. */
    ledc_timer_config_t timer = {
        .speed_mode      = LEDC_LOW_SPEED_MODE,
        .duty_resolution = LEDC_TIMER_8_BIT,
        .timer_num       = (ledc_timer_t)channel,
        .freq_hz         = (uint32_t)freq_hz,
        .clk_cfg         = LEDC_AUTO_CLK,
    };
    esp_err_t err = ledc_timer_config(&timer);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "pwmAttach: ledc_timer_config(ch=%d, freq=%d) failed: %s",
                 channel, freq_hz, esp_err_to_name(err));
        return LUME_GPIO_ERR_DRIVER;
    }

    ledc_channel_config_t ch_conf = {
        .speed_mode = LEDC_LOW_SPEED_MODE,
        .channel    = (ledc_channel_t)channel,
        .timer_sel  = (ledc_timer_t)channel,
        .intr_type  = LEDC_INTR_DISABLE,
        .gpio_num   = pin,
        .duty       = duty_from_pct(duty_pct),
        .hpoint     = 0,
    };
    err = ledc_channel_config(&ch_conf);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "pwmAttach: ledc_channel_config(ch=%d, pin=%d) failed: %s",
                 channel, pin, esp_err_to_name(err));
        return LUME_GPIO_ERR_DRIVER;
    }

    s_pwm[channel].pin = pin;
    s_pwm[channel].active = true;
    return LUME_GPIO_OK;
}

int lume_gpio_pwm_duty(int pin, int duty_pct)
{
    int r = check_pin(pin, true);
    if (r != LUME_GPIO_OK) {
        return r;
    }
    if (duty_pct < 0 || duty_pct > 100) {
        ESP_LOGW(TAG, "pwmDuty: dutyPct %d out of range (0..100)", duty_pct);
        return LUME_GPIO_ERR_ARG;
    }
    int channel;
    r = find_channel(pin, &channel);
    if (r != LUME_GPIO_OK) {
        return r;
    }
    /* ledc_basic example uses the set_duty + update_duty pair. Both run on the
     * engine task only, so the "not thread-safe" note in ledc.h does not apply. */
    esp_err_t err = ledc_set_duty(LEDC_LOW_SPEED_MODE,
                                  (ledc_channel_t)channel,
                                  duty_from_pct(duty_pct));
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "pwmDuty: ledc_set_duty(ch=%d) failed: %s",
                 channel, esp_err_to_name(err));
        return LUME_GPIO_ERR_DRIVER;
    }
    err = ledc_update_duty(LEDC_LOW_SPEED_MODE, (ledc_channel_t)channel);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "pwmDuty: ledc_update_duty(ch=%d) failed: %s",
                 channel, esp_err_to_name(err));
        return LUME_GPIO_ERR_DRIVER;
    }
    return LUME_GPIO_OK;
}
