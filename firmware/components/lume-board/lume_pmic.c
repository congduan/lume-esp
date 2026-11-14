/**
 * AXP2101 power sequencing for the display / touch rails.
 *
 * Evidence (pulled and read before writing, not from memory):
 *   - examples/esp-idf/01_AXP2101/main/main.cpp:51-58
 *       -> AXP2101 7-bit I2C address (in the board profile), 400 kHz class bus.
 *   - examples/esp-idf/01_AXP2101/main/port_axp2101.cpp:66-76
 *       -> rail comments: ALDO3 3300 mV, BLDO1 ("OLED VDD") 3300 mV,
 *          BLDO2 3300 mV.
 *   - components/XPowersLib/src/REG/AXP2101Constants.h:5,9,117-127,205-222
 *       -> CHIP_ID 0x4A at IC_TYPE reg 0x03; LDO_ONOFF_CTRL0 0x90;
 *          LDO_VOL2/4/5_CTRL 0x94/0x96/0x97; 500..3500 mV in 100 mV steps.
 *   - components/XPowersLib/src/XPowersAXP2101.tpp
 *       :1846-1872 (setALDO3Voltage: reg&=0xE0 |= (mV-500)/100, enable bit 2)
 *       :1930-1957 (setBLDO1Voltage: 0x96, enable bit 4)
 *       :1976+     (enableBLDO2: bit 5 of 0x90)
 *
 * ISOLATED + TODO (task failure-prevention clause): the exact rail set and
 * voltages cannot be validated without the board. The vendor's own examples
 * LEAVE ALL THESE WRITES COMMENTED OUT — the PMIC's OTP defaults already power
 * the rails. So this function is deliberately NON-FATAL: any failure is logged
 * and board init continues. Adjust this ONE function after hardware checkout
 * (voltages, rail selection, settle time) without touching the display driver.
 */
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/i2c_master.h"
#include "esp_check.h"
#include "esp_log.h"
#include "lume_pins.h"
#include "lume_board_internal.h"

#define AXP2101_I2C_ADDR    LUME_I2C_ADDR_AXP2101
#define AXP2101_IC_TYPE_REG 0x03
#define AXP2101_CHIP_ID     0x4A
#define AXP2101_ONOFF_CTRL0 0x90
#define AXP2101_ALDO3_VOL   0x94
#define AXP2101_BLDO1_VOL   0x96
#define AXP2101_BLDO2_VOL   0x97

#define AXP2101_I2C_TIMEOUT_MS 200
#define RAIL_3300MV_STEP       0x1C  /* (3300-500)/100 = 28 */

static const char *TAG = "lume-pmic";

static esp_err_t axp_read_reg(i2c_master_dev_handle_t dev, uint8_t reg, uint8_t *val)
{
    return i2c_master_transmit_receive(dev, &reg, 1, val, 1, AXP2101_I2C_TIMEOUT_MS);
}

static esp_err_t axp_write_reg(i2c_master_dev_handle_t dev, uint8_t reg, uint8_t val)
{
    uint8_t buf[2] = {reg, val};
    return i2c_master_transmit(dev, buf, sizeof(buf), AXP2101_I2C_TIMEOUT_MS);
}

/* Voltage registers keep their upper 3 bits (XPowersAXP2101.tpp:1869-1871). */
static esp_err_t axp_set_voltage(i2c_master_dev_handle_t dev, uint8_t reg, uint8_t step)
{
    uint8_t cur = 0;
    esp_err_t err = axp_read_reg(dev, reg, &cur);
    if (err != ESP_OK) {
        return err;
    }
    return axp_write_reg(dev, reg, (uint8_t)((cur & 0xE0) | (step & 0x1F)));
}

/* OR-only so we never switch off other rails living in the same register. */
static esp_err_t axp_set_bits(i2c_master_dev_handle_t dev, uint8_t reg, uint8_t bits)
{
    uint8_t cur = 0;
    esp_err_t err = axp_read_reg(dev, reg, &cur);
    if (err != ESP_OK) {
        return err;
    }
    return axp_write_reg(dev, reg, (uint8_t)(cur | bits));
}

esp_err_t lume_pmic_display_power_on(i2c_master_bus_handle_t bus)
{
    const i2c_device_config_t dev_cfg = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = AXP2101_I2C_ADDR,
        .scl_speed_hz = 400000,
    };
    /* Kept registered for the app lifetime (the bus owns the handle). */
    static i2c_master_dev_handle_t dev;
    esp_err_t err = i2c_master_bus_add_device(bus, &dev_cfg, &dev);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "AXP2101 add_device failed: %s", esp_err_to_name(err));
        return err;
    }

    uint8_t chip_id = 0;
    err = axp_read_reg(dev, AXP2101_IC_TYPE_REG, &chip_id);
    if (err != ESP_OK || chip_id != AXP2101_CHIP_ID) {
        ESP_LOGW(TAG, "AXP2101 not detected (id=0x%02x err=%s); relying on OTP defaults",
                 (unsigned)chip_id, esp_err_to_name(err));
        return ESP_ERR_NOT_FOUND;
    }
    ESP_LOGI(TAG, "AXP2101 detected (chip id 0x%02x)", (unsigned)chip_id);

    /* Voltage policy (Codex review P0 fix, 2026-11-13): schematic nets show
     * BLDO1=VL_1.2V, BLDO2=VL_2.8V, ALDO3=VL_3.0V — the rails feed different
     * domains, so blanket-writing 3.3V is wrong. The vendor BSP does NOT set
     * voltages at runtime: the AXP2101 ships with OTP defaults matching this
     * board. We therefore only ENABLE the rails and leave voltages at OTP
     * defaults, exactly like the vendor example. Revisit per-rail voltages
     * only with on-board measurement evidence. */

    /* 0x90: ALDO3=bit2, BLDO1=bit4, BLDO2=bit5. */
    ESP_RETURN_ON_ERROR(axp_set_bits(dev, AXP2101_ONOFF_CTRL0, (1u << 2) | (1u << 4) | (1u << 5)),
                        TAG, "enable display/touch rails");
    vTaskDelay(pdMS_TO_TICKS(10));  /* let rails settle before driving the panel */
    ESP_LOGI(TAG, "ALDO3+BLDO1+BLDO2 rails enabled");
    return ESP_OK;
}
