/**
 * lume-pmic: AXP2101 battery telemetry + power-off hardware layer (M2).
 *
 * Register facts verified against the local XPowersLib copy BEFORE coding
 * (/tmp/ws-demo/examples/arduino/libraries/XPowersLib/). The esp-idf
 * 01_AXP2101 copy is a +21-line-offset revision with IDENTICAL semantics for
 * every function below; the AXP2101 datasheet (REG 00/01/10/30/34-3D/A4
 * descriptions) was also cross-checked where noted.
 *   - AXP2101Constants.h:3  AXP2101_SLAVE_ADDRESS (now in the board profile),
 *     7-bit I2C addr.
 *   - AXP2101Constants.h:5  XPOWERS_AXP2101_CHIP_ID (0x4A), read at
 *                     :9    XPOWERS_AXP2101_IC_TYPE (0x03). Already used by
 *                           lume-board/lume_pmic.c:32-34 for display rails.
 *   - AXP2101Constants.h:7,8 STATUS1 (0x00) / STATUS2 (0x01).
 *   - XPowersAXP2101.tpp:262-265 isBatteryConnect() -> getRegisterBit(STATUS1,3)
 *     = battery present; datasheet REG00 bit3 "Battery present state".
 *     CORRECTION to the brief: STATUS1 bit4 is getBatfetState() (tpp:256-259),
 *     NOT "VBUS in". VBUS presence is STATUS1 bit5 VBUS_GOOD (tpp:251-254)
 *     && !STATUS2 bit3 VINDPM, i.e. isVbusIn() at tpp:307-310; datasheet
 *     REG00 bit5 / REG01 bit3 tables (6.13.2.1 / 6.13.2.2) agree.
 *   - tpp:282-285 isCharging() -> (STATUS2 >> 5) == 0x01 (current direction
 *     bits [6:5]); tpp:312-318 getChargerStatus() -> STATUS2 & 0x07, the
 *     0..5 charger-state enum at tpp:81-87. charging_status() exposes the
 *     latter (STATUS2[2:0], datasheet REG01 "charging status" bits [2:0]).
 *   - tpp:2300-2303 enableBattDetection() -> setRegisterBit(BAT_DET_CTRL,0);
 *     AXP2101Constants.h:97 BAT_DET_CTRL = 0x68. Datasheet 6.7.4: enabled by
 *     default, detection result in reg00H[3].
 *   - ADC_CHANNEL_CTRL = 0x30 (AXP2101Constants.h:46), enable bits:
 *       tpp:2290-2293 enableBattVoltageMeasure()   -> bit0  (VBAT)
 *       tpp:2247-2250 enableVbusVoltageMeasure()   -> bit2  (VBUS)
 *       tpp:2265-2268 enableTSPinMeasure()         -> bit1  (TS, unused)
 *       tpp:2232-2235 enableSystemVoltageMeasure() -> bit3  (VSYS, unused)
 *       tpp:2216-2219 enableTemperatureMeasure()   -> bit4  (die temp)
 *       tpp:2206-2209 enableGeneralAdcChannel()    -> bit5  (GPADC, unused)
 *     Datasheet REG 30 bit table (6.13.2.29) agrees; bits 0/1 default to 1.
 *   - VBAT: tpp:2310-2316 getBattVoltage() -> readRegisterH5L8(
 *     ADC_DATA_RELUST0=0x34, RELUST1=0x35) [AXP2101Constants.h:47,48];
 *     XPowersCommon.tpp:426-432 ((h5 & 0x1F) << 8) | l8, 1 mV/LSB -> mV.
 *   - VBUS: tpp:2257-2263 getVbusVoltage() -> readRegisterH6L8(
 *     ADC_DATA_RELUST4=0x38, RELUST5=0x39) [AXP2101Constants.h:51,52];
 *     XPowersCommon.tpp:418-424 ((h6 & 0x3F) << 8) | l8 -> mV.
 *   - DIE TEMP: tpp:2226-2230 getTemperature() -> readRegisterH6L8(
 *     ADC_DATA_RELUST8=0x3C, RELUST9=0x3D) [AXP2101Constants.h:55,56] then
 *     XPOWERS_AXP2101_CONVERSION(raw) = 22.0 + (7274 - raw)/20.0 [C]
 *     (AXP2101Constants.h:241). Channel CONFIRMED -> INCLUDED this round, but
 *     exposed as the RAW sample (see lume_pmic_hw.h + KNOWN-SIMPLIFICATIONS).
 *   - PERCENT: tpp:2318-2324 getBatteryPercent() -> readRegister(
 *     BAT_PERCENT_DATA=0xA4) [AXP2101Constants.h:132]; datasheet REG A4
 *     (6.13.2.88) bits 7:0 = battery percentage. Fuel-gauge config left at
 *     OTP defaults (NO writes; see KNOWN-SIMPLIFICATIONS.md).
 *   - SHUTDOWN: tpp:393-396 shutdown() -> setRegisterBit(COMMON_CONFIG,0);
 *     AXP2101Constants.h:18 COMMON_CONFIG = 0x10; datasheet REG 10 bit0
 *     "Soft PWROFF" (6.13.2.7). This is the ONLY bit power_off() writes.
 *
 * I2C concurrency (verified in the installed ESP-IDF v5.5.5):
 *   - docs/en/api-reference/peripherals/i2c.rst:652-663 "Thread Safety":
 *     "I2C master operation functions are also guaranteed to be thread safe by
 *     bus operation semaphore", explicitly listing i2c_master_transmit,
 *     i2c_master_multi_buffer_transmit and i2c_master_transmit_receive.
 *   - components/esp_driver_i2c/i2c_master.c:1007-1039
 *     s_i2c_synchronous_transaction() takes i2c_dev->master_bus->bus_lock_mux
 *     (created :1097-1099) before touching shared bus state and gives it back
 *     on success (:1031) and error (:1037).
 *   - i2c_master.c:1316-1338 i2c_master_transmit_receive() and :1274-1299
 *     i2c_master_multi_buffer_transmit() (called by i2c_master_transmit
 *     :1305-1314) both route to that locked path in synchronous mode (the
 *     default, trans_queue_depth == 0). i2c_master_bus_add_device() also takes
 *     the same bus_lock_mux at :1200-1202 for the device-list insert.
 *   => The engine task (PMIC telemetry) and the LVGL task (touch poll) may use
 *      the same bus handle concurrently with NO extra lock in this layer.
 *      (i2c_master.h:349's "can't be used concurrently" note is scoped to
 *      i2c_master_get_bus_handle() retrieving a second handle for the SAME
 *      port, which is not what lume_board_get_i2c_bus() does.)
 *
 * Thread discipline: every entry point is called ONLY from the QuickJS engine
 * task (via the lume_engine.c natives). All state here is engine-task-only and,
 * like the natives, survives a hot-reload runtime reset. No lv_*, no new
 * locks, no large buffers. No board: init() cannot confirm CHIP_ID 0x4A, so
 * every telemetry call returns LUME_PMIC_ERR_STATE (-3) — non-fatal, WARN only.
 */
#include <stdbool.h>
#include <stdint.h>
#include "driver/i2c_master.h"
#include "esp_err.h"
#include "esp_log.h"
#include "lume_board.h"
#include "lume_pins.h"
#include "lume_pmic_hw.h"

static const char *TAG = "lume-pmic-hw";

/* Board profile owns the AXP2101 I2C address; the registers below are
 * AXP2101 chip-level constants. */
#define AXP_I2C_ADDR       LUME_I2C_ADDR_AXP2101
#define AXP_I2C_TIMEOUT_MS 200
#define AXP_IC_TYPE_REG    0x03
#define AXP_CHIP_ID        0x4A
#define AXP_STATUS1        0x00
#define AXP_STATUS2        0x01
#define AXP_COMMON_CONFIG  0x10
#define AXP_ADC_CH_CTRL    0x30
#define AXP_ADC_VBAT_H     0x34
#define AXP_ADC_VBAT_L     0x35
#define AXP_ADC_VBUS_H     0x38
#define AXP_ADC_VBUS_L     0x39
#define AXP_ADC_TDIE_H     0x3C
#define AXP_ADC_TDIE_L     0x3D
#define AXP_BAT_DET_CTRL   0x68
#define AXP_BAT_PERCENT    0xA4

#define ST1_BAT_PRESENT    (1u << 3)  /* STATUS1: battery present state */
#define ST1_VBUS_GOOD      (1u << 5)  /* STATUS1: VBUS good indication */
#define ST2_VINDPM         (1u << 3)  /* STATUS2: in VINDPM (isVbusIn == 0) */
#define ST2_CHG_MASK       0x07       /* STATUS2[2:0]: charging status */
#define ADC_CH_VBAT        (1u << 0)
#define ADC_CH_VBUS        (1u << 2)
#define ADC_CH_TDIE        (1u << 4)
#define BAT_DET_ENABLE     (1u << 0)
#define SHUTDOWN_BIT       (1u << 0)  /* COMMON_CONFIG: soft PWROFF */

/* NULL until init() fully succeeds. Retry policy (Codex r8 review): a FAILED
 * init does NOT latch — the next call retries from scratch, so a transient
 * I2C failure never poisons the PMIC bindings until reboot. A SUCCESSFUL init
 * latches for the process lifetime: hot-reload runtime resets re-call init()
 * from register_bindings() and return the already-registered handle without
 * ever calling add_device() twice. */
static i2c_master_dev_handle_t s_dev = NULL;
static bool s_init_ok = false;

/* One-byte register read / write, mirroring lume-board/lume_pmic.c:45-54 and
 * XPowersCommon.tpp:286-326 / :328-372. */
static int axp_read_byte(i2c_master_dev_handle_t dev, uint8_t reg, uint8_t *val)
{
    esp_err_t err = i2c_master_transmit_receive(dev, &reg, 1, val, 1,
                                                AXP_I2C_TIMEOUT_MS);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "read reg 0x%02x failed: %s", (unsigned)reg,
                 esp_err_to_name(err));
        return LUME_PMIC_ERR_DRIVER;
    }
    return LUME_PMIC_OK;
}

static int axp_write_byte(i2c_master_dev_handle_t dev, uint8_t reg, uint8_t val)
{
    uint8_t buf[2] = { reg, val };
    esp_err_t err = i2c_master_transmit(dev, buf, sizeof(buf),
                                        AXP_I2C_TIMEOUT_MS);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "write reg 0x%02x failed: %s", (unsigned)reg,
                 esp_err_to_name(err));
        return LUME_PMIC_ERR_DRIVER;
    }
    return LUME_PMIC_OK;
}

/* OR-only read-modify-write, mirroring XPowersCommon.tpp:384-391
 * setRegisterBit(): other bits of the register are preserved. */
static int axp_set_bits(i2c_master_dev_handle_t dev, uint8_t reg, uint8_t bits)
{
    uint8_t cur = 0;
    int r = axp_read_byte(dev, reg, &cur);
    if (r != LUME_PMIC_OK) {
        return r;
    }
    return axp_write_byte(dev, reg, (uint8_t)(cur | bits));
}

/* Mirrors XPowersCommon.tpp:418-424 (H6L8) / :426-432 (H5L8): two separate
 * 1-byte reads combined into one sample. high_mask = 0x3F for the 14-bit
 * VBUS / die-temp channels, 0x1F for the VBAT channel. */
static int axp_read_adc(uint8_t reg_h, uint8_t reg_l, uint8_t high_mask,
                        int *out_raw)
{
    uint8_t h = 0, l = 0;
    int r = axp_read_byte(s_dev, reg_h, &h);
    if (r != LUME_PMIC_OK) {
        return r;
    }
    r = axp_read_byte(s_dev, reg_l, &l);
    if (r != LUME_PMIC_OK) {
        return r;
    }
    *out_raw = (int)((((uint16_t)h & high_mask) << 8) | l);
    return LUME_PMIC_OK;
}

/* No board / init failed -> every telemetry call returns -3. */
static int require_dev(void)
{
    if (s_dev == NULL) {
        ESP_LOGW(TAG, "AXP2101 not initialised (no board / init failed)");
        return LUME_PMIC_ERR_STATE;
    }
    return LUME_PMIC_OK;
}

static int read_status(uint8_t *st1, uint8_t *st2)
{
    int r = axp_read_byte(s_dev, AXP_STATUS1, st1);
    if (r != LUME_PMIC_OK) {
        return r;
    }
    return axp_read_byte(s_dev, AXP_STATUS2, st2);
}

/* XPowersAXP2101.tpp:262-265 isBatteryConnect(): STATUS1 bit3. */
static int battery_connected(int *out)
{
    uint8_t st1 = 0, st2 = 0;
    int r = read_status(&st1, &st2);
    if (r != LUME_PMIC_OK) {
        return r;
    }
    *out = (st1 & ST1_BAT_PRESENT) ? 1 : 0;
    return LUME_PMIC_OK;
}

/* XPowersAXP2101.tpp:307-310 isVbusIn(): VBUS_GOOD && !VINDPM. */
static int vbus_in(int *out)
{
    uint8_t st1 = 0, st2 = 0;
    int r = read_status(&st1, &st2);
    if (r != LUME_PMIC_OK) {
        return r;
    }
    *out = ((st1 & ST1_VBUS_GOOD) && !(st2 & ST2_VINDPM)) ? 1 : 0;
    return LUME_PMIC_OK;
}

int lume_pmic_hw_init(void)
{
    if (s_init_ok) {
        return s_dev != NULL ? LUME_PMIC_OK : LUME_PMIC_ERR_STATE;
    }

    i2c_master_bus_handle_t bus = lume_board_get_i2c_bus();
    if (bus == NULL) {
        ESP_LOGW(TAG, "init: shared I2C bus not available (board not up)");
        return LUME_PMIC_ERR_STATE;
    }

    const i2c_device_config_t dev_cfg = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address  = AXP_I2C_ADDR,
        .scl_speed_hz    = 400000,
    };
    i2c_master_dev_handle_t dev = NULL;
    esp_err_t err = i2c_master_bus_add_device(bus, &dev_cfg, &dev);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "init: add_device(0x%02x) failed: %s",
                 (unsigned)AXP_I2C_ADDR, esp_err_to_name(err));
        return LUME_PMIC_ERR_DRIVER;
    }

    uint8_t chip_id = 0;
    int r = axp_read_byte(dev, AXP_IC_TYPE_REG, &chip_id);
    if (r != LUME_PMIC_OK) {
        /* Transient I2C failure: drop the handle so the next init() retry
         * starts clean (Codex r8 review: no handle leak on partial init). */
        i2c_master_bus_rm_device(dev);
        return r;
    }
    if (chip_id != AXP_CHIP_ID) {
        ESP_LOGW(TAG, "init: AXP2101 not detected (id=0x%02x, expected 0x%02x); "
                      "telemetry disabled", (unsigned)chip_id,
                      (unsigned)AXP_CHIP_ID);
        i2c_master_bus_rm_device(dev);
        return LUME_PMIC_ERR_STATE;
    }

    /* Idempotent one-shot measurement enables (OR-only, so other channel bits
     * survive). Charging voltages / currents / fuel-gauge params are NEVER
     * written here or anywhere in this component. */
    r = axp_set_bits(dev, AXP_BAT_DET_CTRL, BAT_DET_ENABLE);
    if (r != LUME_PMIC_OK) {
        ESP_LOGW(TAG, "init: enable battery detection (0x68 bit0) failed");
        i2c_master_bus_rm_device(dev);
        return r;
    }
    r = axp_set_bits(dev, AXP_ADC_CH_CTRL,
                     (uint8_t)(ADC_CH_VBAT | ADC_CH_VBUS | ADC_CH_TDIE));
    if (r != LUME_PMIC_OK) {
        ESP_LOGW(TAG, "init: enable ADC channels (0x30 bits 0/2/4) failed");
        i2c_master_bus_rm_device(dev);
        return r;
    }

    s_dev = dev;        /* publish only after full success */
    s_init_ok = true;   /* latch success for the process lifetime */
    ESP_LOGI(TAG, "AXP2101 telemetry ready (chip id 0x%02x)", (unsigned)chip_id);
    return LUME_PMIC_OK;
}

int lume_pmic_hw_batt_voltage_mv(void)
{
    int r = require_dev();
    if (r != LUME_PMIC_OK) {
        return r;
    }
    int present = 0;
    r = battery_connected(&present);
    if (r != LUME_PMIC_OK) {
        return r;
    }
    if (!present) {
        ESP_LOGW(TAG, "battVoltage: no battery connected (STATUS1 bit3 clear)");
        return LUME_PMIC_ERR_STATE;
    }
    int mv = 0;
    r = axp_read_adc(AXP_ADC_VBAT_H, AXP_ADC_VBAT_L, 0x1F, &mv);
    if (r != LUME_PMIC_OK) {
        return r;
    }
    return mv;   /* 0..8191 mV; negatives are errors */
}

int lume_pmic_hw_batt_percent(void)
{
    int r = require_dev();
    if (r != LUME_PMIC_OK) {
        return r;
    }
    int present = 0;
    r = battery_connected(&present);
    if (r != LUME_PMIC_OK) {
        return r;
    }
    if (!present) {
        ESP_LOGW(TAG, "battPercent: no battery connected (STATUS1 bit3 clear)");
        return LUME_PMIC_ERR_STATE;
    }
    uint8_t pct = 0;
    r = axp_read_byte(s_dev, AXP_BAT_PERCENT, &pct);
    if (r != LUME_PMIC_OK) {
        return r;
    }
    return (int)pct;   /* REG A4 bits 7:0, 0..100 in practice */
}

int lume_pmic_hw_vbus_voltage_mv(void)
{
    int r = require_dev();
    if (r != LUME_PMIC_OK) {
        return r;
    }
    int in = 0;
    r = vbus_in(&in);
    if (r != LUME_PMIC_OK) {
        return r;
    }
    if (!in) {
        ESP_LOGW(TAG, "vbusVoltage: VBUS not in (VBUS_GOOD clear / VINDPM set)");
        return LUME_PMIC_ERR_STATE;
    }
    int mv = 0;
    r = axp_read_adc(AXP_ADC_VBUS_H, AXP_ADC_VBUS_L, 0x3F, &mv);
    if (r != LUME_PMIC_OK) {
        return r;
    }
    return mv;   /* 0..16383 mV; negatives are errors */
}

int lume_pmic_hw_usb_connected(void)
{
    int r = require_dev();
    if (r != LUME_PMIC_OK) {
        return r;
    }
    int in = 0;
    r = vbus_in(&in);
    if (r != LUME_PMIC_OK) {
        return r;
    }
    return in;   /* 1/0; negatives are errors */
}

int lume_pmic_hw_charging_status(void)
{
    int r = require_dev();
    if (r != LUME_PMIC_OK) {
        return r;
    }
    uint8_t st2 = 0;
    r = axp_read_byte(s_dev, AXP_STATUS2, &st2);
    if (r != LUME_PMIC_OK) {
        return r;
    }
    return (int)(st2 & ST2_CHG_MASK);   /* 0..7; see lume_pmic_hw.h */
}

int lume_pmic_hw_die_temp_raw(void)
{
    int r = require_dev();
    if (r != LUME_PMIC_OK) {
        return r;
    }
    int raw = 0;
    r = axp_read_adc(AXP_ADC_TDIE_H, AXP_ADC_TDIE_L, 0x3F, &raw);
    if (r != LUME_PMIC_OK) {
        return r;
    }
    return raw;   /* 0..16383; negatives are errors */
}

int lume_pmic_hw_power_off(void)
{
    int r = require_dev();
    if (r != LUME_PMIC_OK) {
        return r;
    }
    /* HIGH-RISK: the ONLY write in this function. OR-only so the other
     * COMMON_CONFIG bits (incl. bit1 "Restart the SoC") are untouched. */
    return axp_set_bits(s_dev, AXP_COMMON_CONFIG, SHUTDOWN_BIT);
}
