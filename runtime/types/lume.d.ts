/**
 * Lume JS API types (M1 surface — grows in M2/M3).
 */

declare namespace lume.ui {
  interface Style {
    background?: string;
    color?: string;
    fontSize?: number;
    padding?: number;
  }

  interface ViewProps { id?: string; style?: Style; children?: Node[] }
  interface TextProps { id?: string; text: string; style?: Style }
  interface ButtonProps { id?: string; title: string; onPress: () => void }

  type Node = { kind: 'view'; props: ViewProps }
            | { kind: 'text'; props: TextProps }
            | { kind: 'button'; props: ButtonProps };

  function View(props: ViewProps, children?: Node[]): Node & { setState(id: string, patch: object): void };
  function Text(props: TextProps): Node;
  function Button(props: ButtonProps): Node;
}

declare namespace lume.system {
  function log(msg: string): void;
}

/**
 * GPIO + PWM (LEDC) bindings (M2).
 * Every function returns a status NUMBER: 0 = success, negative = error code
 * (lume_gpio.h: -1 invalid/out-of-range arg, -2 ESP-IDF driver failure,
 * -3 pin/channel state conflict). read() returns the 0/1 level on success.
 * Semantic failures are logged via ESP_LOGW and returned as the negative
 * status; they never abort. Calling with too few arguments throws a
 * TypeError (a QuickJS contract: JS_EXCEPTION always implies a pending
 * exception), and passing non-numeric arguments raises the JS_ToInt32
 * conversion error.
 * Channel range is 0..LEDC_TIMER_MAX-1 (0..3 on ESP32-S3); one timer per
 * channel, so each channel has an independent frequency. pwmFree releases
 * the pin + channel; re-attaching a bound channel resets the old pad.
 */
declare namespace lume.gpio {
  /** mode: 0=INPUT 1=OUTPUT 2=OUTPUT_OD; pull: 0=none 1=up 2=down.
    * rejected (-3) while the pin is PWM-attached; pwmFree first. */
  function setPin(pin: number, mode: number, pull: number): number;
  /** level: 0 or 1. */
  function write(pin: number, level: number): number;
  /** returns the pin level (0/1), or a negative error code. */
  function read(pin: number): number;
  function toggle(pin: number): number;
  /** dutyPct 0..100, 8-bit resolution, LEDC low-speed channel.
    * re-attaching a channel resets the pad it previously drove. */
  function pwmAttach(pin: number, freqHz: number, dutyPct: number, channel: number): number;
  /** change duty of an already-attached pin (usable inside signal/effect). */
  function pwmDuty(pin: number, dutyPct: number): number;
  /** release a PWM pin + channel (stops output, resets the pad). */
  function pwmFree(pin: number): number;
}

/**
 * ADC1 oneshot bindings (M2), ESP32-S3.
 * Every function returns a status NUMBER: 0 = success, negative = error code
 * (lume_adc.h: -1 invalid/out-of-range arg, -2 ESP-IDF adc driver / calibration
 * failure, -3 pin not configured or calibration unavailable). readRaw() /
 * readMv() return a NON-NEGATIVE measurement on success (12-bit raw 0..4095 /
 * calibrated mV); negative values are the error codes. Semantic failures are
 * logged via ESP_LOGW and returned as the negative status; they never abort.
 * Calling with too few arguments throws a TypeError (a QuickJS contract:
 * JS_EXCEPTION always implies a pending exception), and passing non-numeric
 * arguments raises the JS_ToInt32 conversion error.
 *
 * Valid pins are the ADC1-samplable GPIOs 1..10 (hardcoded from the ESP32-S3
 * soc map); ADC2 GPIOs and board-specific dividers are out of scope. Each pin
 * is an independent channel, so there are no cross-pin conflicts: re-running
 * config() on a configured pin is last-wins (rebuilds the channel + calibration
 * for the new atten); free() releases the pin's calibration handle.
 *
 * atten (0..3) selects the input attenuation, which sets the measurable
 * voltage range: 0 = ADC_ATTEN_DB_0, 1 = ADC_ATTEN_DB_2_5, 2 = ADC_ATTEN_DB_6,
 * 3 = ADC_ATTEN_DB_12. Higher attenuation widens the range at the cost of
 * resolution/accuracy near the low end.
 *
 * readMv() returns curve-fitting-calibrated millivolts (ESP32-S3's only
 * compiled calibration scheme), NOT a raw-to-linear estimate. Accuracy is
 * bounded by the chip's eFuse calibration data and the chosen atten; absolute
 * voltage precision is deferred to board-level verification. If eFuse
 * calibration bits are absent, config() still succeeds and readRaw() works,
 * but readMv() returns -3 (calibration unavailable) rather than an
 * uncalibrated guess.
 */
declare namespace lume.adc {
  /** configure an ADC1 pin (GPIO 1..10) with atten 0..3; last-wins on repeat. */
  function config(pin: number, atten: number): number;
  /** raw 12-bit sample (0..4095), or a negative error code. */
  function readRaw(pin: number): number;
  /** calibrated mV, or a negative error code (-3 if calibration unavailable). */
  function readMv(pin: number): number;
  /** release the pin's calibration handle (keeps the shared ADC1 unit). */
  function free(pin: number): number;
}

/**
 * AXP2101 PMIC bindings (M2): battery telemetry, USB/charge status and power
 * off. NO-ARGUMENT API. Every function returns a status NUMBER: 0 = success,
 * negative = error code (lume_pmic_hw.h: -1 reserved / unused here, -2
 * ESP-IDF i2c_master driver failure, -3 PMIC not detected or required source
 * absent). Semantic failures are logged via ESP_LOGW and returned as the
 * negative status; they never abort. All functions take no arguments, so the
 * "too few arguments -> TypeError" path used by lume.gpio/lume.adc never
 * triggers here.
 *
 * The six telemetry/status reads return a NON-NEGATIVE measurement on success;
 * negative values are the error codes. powerOff() returns the status itself
 * (0 = the shutdown bit was written).
 *
 * NO BOARD: lume_pmic_hw_init() (run once from the engine's binding registrar)
 * cannot confirm AXP2101 CHIP_ID 0x4A @ reg 0x03, so the device handle stays
 * NULL and ALL of battVoltageMv / battPercent / vbusVoltageMv / usbConnected /
 * chargingStatus / dieTempRaw / powerOff return -3. Init failure is non-fatal
 * (WARN only). Battery voltage/percent additionally return -3 when no battery
 * is connected (STATUS1 bit3 clear); vbusVoltageMv returns -3 when VBUS is not
 * in (STATUS1 bit5 VBUS_GOOD clear or STATUS2 bit3 VINDPM set).
 *
 * Register facts are verified against XPowersLib (see lume_pmic_hw.c head
 * comment for the file:line table). Note the verified correction: VBUS in is
 * STATUS1 bit5 + !STATUS2 bit3, NOT STATUS1 bit4 (which is BATFET state).
 *
 * Charging parameters (voltages, currents, target voltage, fuel-gauge config)
 * are NEVER written — only measurement-channel enables at init and the single
 * shutdown bit in powerOff(). No reboot/restart binding this round: esp_restart
 * belongs to the lume.system namespace (next round).
 */
declare namespace lume.pmic {
  /** battery voltage in mV (H5L8 of REG 34h/35h, 1 mV/LSB), or -3 / negative error. */
  function battVoltageMv(): number;
  /** fuel-gauge battery percentage (raw REG A4h byte, 0..100 in practice), or -3 / negative error. */
  function battPercent(): number;
  /** VBUS voltage in mV (H6L8 of REG 38h/39h), or -3 when VBUS not in / negative error. */
  function vbusVoltageMv(): number;
  /** 1 = VBUS in, 0 = not in, negative = error. */
  function usbConnected(): number;
  /** charger status = STATUS2[2:0]: 0 tri_charge, 1 pre_charge, 2 CC,
    * 3 CV, 4 charge done, 5 not charging, 6..7 reserved; negative = error.
    * 0 is a VALID state here, not the OK status — test < 0 for errors. */
  function chargingStatus(): number;
  /** internal die-temperature ADC raw 14-bit sample (H6L8 of REG 3Ch/3Dh),
    * or negative error. Returned RAW: degC = 22 + (7274 - raw)/20 per
    * XPowersLib XPOWERS_AXP2101_CONVERSION (AXP2101Constants.h:241) — the
    * linear fit is left to JS because absolute accuracy needs board
    * verification (see docs/KNOWN-SIMPLIFICATIONS.md). */
  function dieTempRaw(): number;
  /** HIGH-RISK: set COMMON_CONFIG (10h) bit0 = soft PWROFF. The PMIC powers
    * off shortly after; returns 0 once written, or a negative error. This is
    * the ONLY register write and no charging parameters are touched. */
  function powerOff(): number;
}

declare namespace lume {
  const ui: typeof lume.ui;
  const system: typeof lume.system;
  const gpio: typeof lume.gpio;
  const adc: typeof lume.adc;
  const pmic: typeof lume.pmic;
  function start(root: lume.ui.Node): void;
}
