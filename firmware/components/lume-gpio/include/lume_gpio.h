/**
 * lume-gpio: hardware layer behind the lume.gpio JS bindings (M2).
 *
 * Pure C, no QuickJS dependency: the lume_engine.c natives marshal JS args
 * and call these functions, returning the int status straight back to JS.
 * Every entry point runs on the QuickJS engine task only (same thread as the
 * other lume.* bindings), so no locking is required.
 *
 * Status contract (returned to JS as a number):
 *   0   success                         (LUME_GPIO_OK)
 *  <0   error code, always paired with an ESP_LOGW line (LUME_GPIO_ERR_*)
 * read() is the one exception: on success it returns the pin level (0/1),
 * negative values are reserved for errors (level can never be negative).
 */
#pragma once

#define LUME_GPIO_OK           0
#define LUME_GPIO_ERR_ARG     (-1)  /* invalid / out-of-range argument */
#define LUME_GPIO_ERR_DRIVER  (-2)  /* ESP-IDF gpio/ledc driver call failed */
#define LUME_GPIO_ERR_STATE   (-3)  /* pin/channel state conflict */

/* setPin() mode / pull encodings (JS-visible contract). */
#define LUME_GPIO_MODE_INPUT     0
#define LUME_GPIO_MODE_OUTPUT    1
#define LUME_GPIO_MODE_OUTPUT_OD 2
#define LUME_GPIO_PULL_NONE      0
#define LUME_GPIO_PULL_UP        1
#define LUME_GPIO_PULL_DOWN      2

/* Configure a GPIO pad. mode ∈ {0,1,2}, pull ∈ {0,1,2}. */
int lume_gpio_set_pin(int pin, int mode, int pull);

/* Write/read/toggle a digital level. write() level ∈ {0,1}. */
int lume_gpio_write(int pin, int level);
int lume_gpio_read(int pin);
int lume_gpio_toggle(int pin);

/* LEDC PWM (low-speed mode, 8-bit duty resolution).
 * pwm_attach binds pin -> channel (channel ∈ [0, LEDC_TIMER_MAX-1]) with the
 * given frequency and initial duty percentage (0..100). pwm_duty updates the
 * duty of an already-attached pin at runtime. pwm_free releases the pin and
 * channel (ledc_stop + pad reset, slot marked free). Re-attaching a channel
 * that was driving a different pin also resets the old pad before reconfig. */
int lume_gpio_pwm_attach(int pin, int freq_hz, int duty_pct, int channel);
int lume_gpio_pwm_duty(int pin, int duty_pct);
int lume_gpio_pwm_free(int pin);
