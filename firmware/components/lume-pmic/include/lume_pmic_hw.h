/**
 * lume-pmic: AXP2101 hardware layer behind the lume.pmic JS bindings (M2).
 *
 * Pure C, no QuickJS dependency: the lume_engine.c natives marshal JS args
 * (there are none) and return the int status straight back to JS. Every entry
 * point runs on the QuickJS engine task only, same thread as the other lume.*
 * bindings. The shared I2C bus is ALSO used by the LVGL task (touch polling);
 * ESP-IDF v5.5.5 i2c_master operation functions are thread-safe via the bus
 * operation semaphore (see the evidence block in lume_pmic_hw.c), so this
 * layer takes no lock of its own.
 *
 * Status contract (returned to JS as a number):
 *   0   success                         (LUME_PMIC_OK)
 *  <0   error code, always paired with an ESP_LOGW line (LUME_PMIC_ERR_*)
 * The six telemetry/status reads are the exceptions: on success they return
 * a NON-NEGATIVE measurement / status value; negative values are reserved for
 * errors. powerOff() returns the status itself (0 = shutdown bit written).
 * All functions are no-argument, so the "too few arguments -> TypeError"
 * path that lume.gpio/lume.adc use never triggers here.
 *
 * No board / no AXP2101: lume_pmic_hw_init() cannot verify CHIP_ID 0x4A, so
 * the device handle stays NULL and EVERY telemetry call and powerOff() return
 * LUME_PMIC_ERR_STATE (-3). Init failure is NON-FATAL (WARN only) and does NOT
 * latch: the next register_bindings() pass retries init from scratch (Codex
 * r8 review), so a transient I2C failure cannot poison the bindings until
 * reboot. Only a SUCCESSFUL init latches for the process lifetime.
 *
 * Register facts are verified against XPowersLib before coding; see the
 * file-top comment in lume_pmic_hw.c for the file:line table.
 */
#pragma once

#define LUME_PMIC_OK           0
#define LUME_PMIC_ERR_ARG     (-1)  /* reserved for contract symmetry; no-arg API */
#define LUME_PMIC_ERR_DRIVER  (-2)  /* ESP-IDF i2c_master call failed */
#define LUME_PMIC_ERR_STATE   (-3)  /* PMIC not detected, or required source absent */

/* One-time AXP2101 setup: add the profile's device @ 400 kHz on the shared bus, verify
 * CHIP_ID 0x4A @ reg 0x03, then (idempotently) enable battery detection and
 * the VBAT / VBUS / die-temperature ADC channels. A SUCCESSFUL init is
 * latched for the process lifetime; any FAILURE (including partial failures
 * after add_device) drops the device handle and does NOT latch, so the next
 * call retries from scratch — a transient I2C error never leaves the PMIC
 * bindings dead until reboot, and add_device() is never called twice with a
 * live handle. Non-fatal on failure: WARN + negative status, no abort. */
int lume_pmic_hw_init(void);

/* Battery voltage in mV, or a negative error. Returns -3 when no battery is
 * connected (STATUS1 bit3 clear) so 0 mV is never an ambiguous "absent". */
int lume_pmic_hw_batt_voltage_mv(void);

/* Fuel-gauge battery percentage (raw REG A4 byte, 0..100 in practice),
 * or a negative error. -3 when no battery is connected. */
int lume_pmic_hw_batt_percent(void);

/* VBUS voltage in mV, or a negative error. -3 when VBUS is not in
 * (STATUS1 bit5 VBUS_GOOD clear, or STATUS2 bit3 VINDPM set). */
int lume_pmic_hw_vbus_voltage_mv(void);

/* 1 = VBUS in, 0 = not in; negative = error. Same predicate as the VBUS
 * voltage read (mirrors XPowersLib isVbusIn()). */
int lume_pmic_hw_usb_connected(void);

/* Charger status = STATUS2[2:0], or a negative error:
 *   0 tri_charge / 1 pre_charge / 2 constant current (CC) /
 *   3 constant voltage (CV) / 4 charge done / 5 not charging /
 *   6..7 reserved. 0 is a valid state, not LUME_PMIC_OK; check < 0 for errors. */
int lume_pmic_hw_charging_status(void);

/* Internal die-temperature ADC channel: raw 14-bit H6L8 sample (REG 3C/3D),
 * or a negative error. Returned RAW (not degrees) so the non-negative
 * measurement contract cannot collide with negative error codes for sub-zero
 * temperatures; the library's linear fit
 * XPOWERS_AXP2101_CONVERSION(raw) = 22.0 + (7274 - raw)/20.0 [C] is documented
 * in lume.d.ts for the JS-side conversion (board verification pending). */
int lume_pmic_hw_die_temp_raw(void);

/* HIGH-RISK: write ONLY COMMON_CONFIG (0x10) bit0 (soft PWROFF). No voltage,
 * charge current, target voltage or other parameter registers are touched.
 * Returns LUME_PMIC_OK once the bit is written (the PMIC powers off shortly
 * after), or a negative error. */
int lume_pmic_hw_power_off(void);
