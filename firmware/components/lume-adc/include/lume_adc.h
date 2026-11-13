/**
 * lume-adc: hardware layer behind the lume.adc JS bindings (M2).
 *
 * Pure C, no QuickJS dependency: the lume_engine.c natives marshal JS args
 * and call these functions, returning the int status straight back to JS.
 * Every entry point runs on the QuickJS engine task only (same thread as the
 * other lume.* bindings), so no locking is required.
 *
 * Status contract (returned to JS as a number):
 *   0   success                         (LUME_ADC_OK)
 *  <0   error code, always paired with an ESP_LOGW line (LUME_ADC_ERR_*)
 * readRaw()/readMv() are the exceptions: on success they return a
 * non-negative measurement (12-bit raw 0..4095 / calibrated mV); negative
 * values are reserved for errors (a measurement can never be negative).
 *
 * ESP32-S3 scope: ADC1 only (GPIO 1..10 -> ADC1 channels 0..9). The pin set
 * is hardcoded from the soc ADC1 map; see lume_adc.c and
 * docs/KNOWN-SIMPLIFICATIONS.md for the tradeoffs.
 */
#pragma once

#define LUME_ADC_OK           0
#define LUME_ADC_ERR_ARG     (-1)  /* invalid / out-of-range argument */
#define LUME_ADC_ERR_DRIVER  (-2)  /* ESP-IDF adc driver / calibration call failed */
#define LUME_ADC_ERR_STATE   (-3)  /* pin not configured / calibration unavailable */

/* config() atten encodings (JS-visible contract): 0..3 ->
 * ADC_ATTEN_DB_0 / 2_5 / 6 / 12. */
#define LUME_ADC_ATTEN_0DB   0
#define LUME_ADC_ATTEN_2_5DB 1
#define LUME_ADC_ATTEN_6DB   2
#define LUME_ADC_ATTEN_12DB  3

/* Configure an ADC1 pin (GPIO 1..10) with attenuation atten (0..3).
 * Lazily creates the single shared ADC1 oneshot unit handle (one handle per
 * unit is a driver constraint) plus a per-pin calibration handle.
 * Re-configuring an already-configured pin is last-wins: the old calibration
 * handle is torn down, the channel is re-applied and a fresh handle is built
 * for the new atten. No free() is required first. */
int lume_adc_config(int pin, int atten);

/* Read the raw 12-bit conversion result (0..4095) of a configured pin.
 * Negative = error. */
int lume_adc_read_raw(int pin);

/* Read the calibrated voltage (mV) of a configured pin. Negative = error.
 * Requires a curve-fitting calibration handle; if eFuse calibration data is
 * missing, config() still succeeds (raw reads work) but readMv() returns
 * LUME_ADC_ERR_STATE. */
int lume_adc_read_mv(int pin);

/* Release a configured pin's calibration handle and mark it free (analogue
 * of gpio.pwmFree). The shared ADC1 unit handle is kept for other pins. */
int lume_adc_free(int pin);
