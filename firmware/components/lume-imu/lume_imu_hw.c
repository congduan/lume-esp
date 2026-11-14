/**
 * lume-imu: QMI8658 hardware layer (M2 / r9). POLLED-ONLY this round.
 *
 * Register facts were verified BEFORE coding against the Waveshare SensorLib
 * shipped for this board (/tmp/ws-demo/examples/arduino/libraries/SensorLib/)
 * and the bundled "QMI8658A Datasheet Rev A.pdf". The board-specific Waveshare
 * example 04_LVGL_QMI8658_ui.ino uses this same SensorQMI8658 driver (via
 * qmi.begin()) and polls qmi.getDataReady() -- i.e. it is polled, not
 * interrupt-driven. file:line refs below are to that tree.
 *
 *  - QMI8658Constants.h:35-36  QMI8658_L_SLAVE_ADDRESS (7-bit I2C addr when
 *    SA0/SDO is tied LOW; datasheet 1.6 p.10 documents the alternate address
 *    for HIGH). The selected address now lives in the board profile
 *    (lume_pins.h), which lists QMI8658 on the shared I2C bus.
 *  - QMI8658Constants.h:43  WHOAMI_DEFAULT = 0x05; SensorQMI8658.hpp:2000-2004
 *    initImpl() checks whoAmI() == 0x05; datasheet Table 21 (p.29) "Device
 *    identifier 0x05 - to identify the device is a QST sensor".
 *    *** BRIEF CORRECTION (verified) ***: the brief says "WHO_AM_I 0xFD".
 *    0xFD is the QMI8658C die (the one named in the schematic netlist header);
 *    schematic part U5 is labelled "QMI8658A" and the bundled datasheet /
 *    SensorQMI8658 driver are the A variant (0x05). Waveshare ships the C
 *    variant (0xFD) on several other boards, so both IDs are seen in real
 *    Waveshare code. They share this register map. A single-value guess would
 *    brick the binding on whichever die is actually populated, so init
 *    ACCEPTS 0x05 OR 0xFD and logs which was read. See
 *    docs/KNOWN-SIMPLIFICATIONS.md (r9 section).
 *  - QMI8658Constants.h:49-60  CTRL1=0x02, CTRL2=0x03, CTRL3=0x04,
 *    CTRL5=0x06, CTRL7=0x08, CTRL8=0x09, CTRL9=0x0A. CTRL4 (0x05) and
 *    CTRL6 (0x07) are RESERVED (datasheet Table 19 p.25) -> never written.
 *  - QMI8658Constants.h:133-137 + :45  RESET=0x60, RST_RESULT=0x4D,
 *    RST_RESULT_VAL=0x80, RESET_DEFAULT=0xB0; SensorQMI8658.hpp:295-321
 *    reset() writes 0xB0 to 0x60 and polls 0x4D for 0x80. Datasheet Table 27
 *    (p.39): "Write 0xB0 to this register ... 0x4D will equal 0x80 on a
 *    successful reset". (Datasheet 7.4 p.51 says "0x0B" -- a typo; Table 27
 *    + the driver constant + QMI8658_REG_RESET_DEFAULT all say 0xB0.) We use a
 *    FIXED 20 ms delay instead of the 0x4D poll: datasheet 3.3.1 / 7.4 says
 *    the reset takes <=15 ms and forbids any register writes during that
 *    window, and 7.4 warns 0x4D may already read 0x80 from POR (so a poll
 *    could exit before the soft reset finishes).
 *  - SensorQMI8658.hpp:388-437 configAccelerometer(ACC_RANGE_4G,
 *    ACC_ODR_1000Hz, LPF_MODE_0) and :440-492 configGyroscope(GYR_RANGE_64DPS,
 *    GYR_ODR_896_8Hz, LPF_MODE_3) produce these whole-register values,
 *    cross-checked bit-by-bit against datasheet Table 22 (p.30-32):
 *      CTRL1 = 0x60  ADDR_AI(bit6)=1 | BE(bit5)=1 (power-on default);
 *                     INT1/INT2_EN(bit3/4)=0 (high-Z, polled);
 *                     SensorDisable(bit0)=0. Mirrors reset()'s
 *                     setRegisterBit(CTRL1,6) on top of the 0x20 default
 *                     (datasheet Table 19 p.25: CTRL1 default 0x20).
 *      CTRL2 = 0x13  aFS[6:4]=001 (+/-4g) | aODR[3:0]=0011 (1000Hz).
 *      CTRL3 = 0x23  gFS[6:4]=010 (+/-64dps) | gODR[3:0]=0011 (896.8Hz).
 *      CTRL5 = 0x71  gLPF_MODE[6:5]=11 (13.37% ODR) | gLPF_EN(bit4)=1 |
 *                     aLPF_MODE[2:1]=00 (2.66% ODR) | aLPF_EN(bit0)=1.
 *      CTRL7 = 0x03  gEN(bit1)=1 | aEN(bit0)=1; syncSmpl(bit7)=0 (async);
 *                     DRDY_DIS(bit5)=0 (default; INT2 not wired so DRDY on
 *                     INT2 is harmless in polled mode).
 *    CTRL7 is written LAST: datasheet 9.4/10.4 notes config must be done while
 *    CTRL7.aEN/gEN = 0 (sensors disabled).
 *  - Datasheet 5.6 (p.37) + 8.9 (p.53): with ADDR_AI=1 a burst read from AX_L
 *    yields AX_L,AX_H,AY_L,AY_H,AZ_L,AZ_H,GX_L,GX_H,GY_L,GY_H,GZ_L,GZ_H --
 *    12 contiguous bytes 0x35..0x40, AX_L = lower 8 bits, AX_H = upper.
 *  - SensorQMI8658.hpp:813-883 getAccelRaw()/getGyroRaw()/getAccelerometer():
 *    raw = (H<<8)|L (two's complement); value_g = raw*(range_g/32768),
 *    value_dps = raw*(range_dps/32768). +/-4g -> 4/32768 = 1/8192 g/LSB
 *    (datasheet Table 7 sensitivity 8192 LSB/g); +/-64dps -> 64/32768 =
 *    1/512 dps/LSB (datasheet Table 8 sensitivity 512 LSB/dps). We convert
 *    g -> m/s^2 with the standard 9.80665 in native (brief: physical units
 *    m/s^2 / deg/s, scaling in native, ESP32-S3 FPU -> plain float).
 *  - STATUS0 (0x2E) bit0 aDA / bit1 gDA = "new data since last read"
 *    (datasheet Table 24 p.35). The example's getDataReady() gates on it to
 *    avoid re-reading the same sample in a tight loop. We deliberately DON'T
 *    gate read(): an on-demand JS read should always return the latest sample,
 *    and gating would make two back-to-back read() calls return failure.
 *  - INT / motion: the schematic (ESP32-S3-Touch-AMOLED-2.16-Schematic.pdf)
 *    DOES route two QMI INT lines, BUT lume_pins.h
 *    defines NO IMU INT pin, Mylibrary/pin_config.h defines none either, and
 *    the Waveshare official example for THIS board is pure polled (no
 *    enableINT). The generic InterruptExample.ino uses IMU_IRQ=33, which is
 *    the T-Beam S3 Supreme, not this board. Per the brief's fallback ("若板卡
 *    未引出或定义不明，退化为纯 polled 模式") this round is POLLED-ONLY: no
 *    GPIO ISR, no JS callback dispatch; onMotion() returns
 *    LUME_IMU_ERR_NO_INT. INT wiring + ISR->JS dispatch is deferred to the
 *    main controller's on-board round.
 *
 * Thread discipline: every entry point is called ONLY from the QuickJS engine
 * task (via the lume_engine.c natives). All state here is engine-task-only and,
 * like the natives, survives a hot-reload runtime reset. No lv_*, no new
 * locks, no large buffers. No board / init failed -> read() returns -3.
 */
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "driver/i2c_master.h"
#include "esp_err.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "lume_board.h"
#include "lume_pins.h"
#include "lume_imu_hw.h"

static const char *TAG = "lume-imu-hw";

/* Board profile owns the QMI8658 I2C address; registers below are chip-level. */
#define QMI_I2C_ADDR       LUME_I2C_ADDR_QMI8658
#define QMI_I2C_TIMEOUT_MS 200

/* Registers (QMI8658Constants.h). STATUS0 is documented in the head comment;
 * it is intentionally not read at runtime. */
#define QMI_REG_WHO_AM_I   0x00
#define QMI_REG_CTRL1      0x02
#define QMI_REG_CTRL2      0x03
#define QMI_REG_CTRL3      0x04
#define QMI_REG_CTRL5      0x06
#define QMI_REG_CTRL7      0x08
#define QMI_REG_AX_L       0x35
#define QMI_REG_RESET      0x60

/* Init values -- see the file-top evidence table for each derived byte. */
#define QMI_RESET_CMD      0xB0
#define QMI_RESET_DELAY_MS 20
#define QMI_CTRL1_VAL      0x60
#define QMI_CTRL2_VAL      0x13
#define QMI_CTRL3_VAL      0x23
#define QMI_CTRL5_VAL      0x71
#define QMI_CTRL7_VAL      0x03

/* WHO_AM_I: QMI8658A = 0x05 (bundled datasheet + SensorQMI8658 driver),
 * QMI8658C = 0xFD (brief / Waveshare C-variant boards). Accept both. */
#define QMI_WHOAMI_A       0x05
#define QMI_WHOAMI_C       0xFD

/* Native scale factors (SensorQMI8658.hpp:406-409 / :458-464). */
#define QMI_ACC_RANGE_G    4.0f
#define QMI_GYR_RANGE_DPS  64.0f
#define QMI_G_TO_MPS2      9.80665f
#define QMI_RAW_DIVISOR    32768.0f

static const float s_acc_scale =
    (QMI_ACC_RANGE_G / QMI_RAW_DIVISOR) * QMI_G_TO_MPS2;   /* -> m/s^2 */
static const float s_gyr_scale =
    QMI_GYR_RANGE_DPS / QMI_RAW_DIVISOR;                   /* -> deg/s */

/* NULL until init() fully succeeds. Retry policy (r8-reviewed lume-pmic): a
 * FAILED init does NOT latch and drops the handle, so a transient I2C failure
 * never poisons the IMU bindings until reboot; a SUCCESSFUL init latches for
 * the process lifetime (hot-reload runtime resets re-call init() and return
 * the already-registered handle without add_device() twice). */
static i2c_master_dev_handle_t s_dev = NULL;
static bool s_init_ok = false;

/* One register-address write followed by a `len`-byte read. With CTRL1
 * ADDR_AI=1 this is how AX_L..GZ_H are burst-read in one transaction. */
static int qmi_read(i2c_master_dev_handle_t dev, uint8_t reg,
                    uint8_t *buf, size_t len)
{
    esp_err_t err = i2c_master_transmit_receive(dev, &reg, 1, buf, len,
                                                QMI_I2C_TIMEOUT_MS);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "read reg 0x%02x (%u bytes) failed: %s",
                 (unsigned)reg, (unsigned)len, esp_err_to_name(err));
        return LUME_IMU_ERR_DRIVER;
    }
    return LUME_IMU_OK;
}

static int qmi_read_byte(i2c_master_dev_handle_t dev, uint8_t reg, uint8_t *val)
{
    return qmi_read(dev, reg, val, 1);
}

static int qmi_write_byte(i2c_master_dev_handle_t dev, uint8_t reg, uint8_t val)
{
    uint8_t buf[2] = { reg, val };
    esp_err_t err = i2c_master_transmit(dev, buf, sizeof(buf),
                                        QMI_I2C_TIMEOUT_MS);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "write reg 0x%02x = 0x%02x failed: %s",
                 (unsigned)reg, (unsigned)val, esp_err_to_name(err));
        return LUME_IMU_ERR_DRIVER;
    }
    return LUME_IMU_OK;
}

/* No board / init failed -> every read()/onMotion() path returns an error. */
static int require_dev(void)
{
    if (s_dev == NULL) {
        ESP_LOGW(TAG, "QMI8658 not initialised (no board / init failed)");
        return LUME_IMU_ERR_STATE;
    }
    return LUME_IMU_OK;
}

int lume_imu_hw_init(void)
{
    uint8_t id = 0;
    int r;
    i2c_master_dev_handle_t dev = NULL;
    i2c_master_bus_handle_t bus;
    const i2c_device_config_t dev_cfg = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address  = QMI_I2C_ADDR,
        .scl_speed_hz    = 400000,
    };
    /* CTRL1..CTRL3, CTRL5, CTRL7 in datasheet order. CTRL7 (sensor enable) is
     * deliberately LAST: config must happen with aEN=gEN=0. CTRL4/CTRL6 are
     * reserved and omitted. CTRL8/CTRL9 (CTRL9 handshake + COPY_USID/USID
     * reads) are optional FW-version logging in initImpl() and are skipped --
     * no CTRL9 commands are issued, so those registers have no effect here. */
    static const uint8_t cfg[][2] = {
        { QMI_REG_CTRL1, QMI_CTRL1_VAL },
        { QMI_REG_CTRL2, QMI_CTRL2_VAL },
        { QMI_REG_CTRL3, QMI_CTRL3_VAL },
        { QMI_REG_CTRL5, QMI_CTRL5_VAL },
        { QMI_REG_CTRL7, QMI_CTRL7_VAL },
    };

    if (s_init_ok) {
        return s_dev != NULL ? LUME_IMU_OK : LUME_IMU_ERR_STATE;
    }

    bus = lume_board_get_i2c_bus();
    if (bus == NULL) {
        ESP_LOGW(TAG, "init: shared I2C bus not available (board not up)");
        return LUME_IMU_ERR_STATE;
    }

    esp_err_t err = i2c_master_bus_add_device(bus, &dev_cfg, &dev);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "init: add_device(0x%02x) failed: %s",
                 (unsigned)QMI_I2C_ADDR, esp_err_to_name(err));
        return LUME_IMU_ERR_DRIVER;
    }

    /* Soft reset, then the datasheet-mandated <=15ms quiet window (no register
     * writes during reset). Fixed delay, not the driver's 0x4D poll -- see
     * the head comment for why the poll can exit early. */
    r = qmi_write_byte(dev, QMI_REG_RESET, QMI_RESET_CMD);
    if (r != LUME_IMU_OK) {
        goto fail;
    }
    vTaskDelay(pdMS_TO_TICKS(QMI_RESET_DELAY_MS));

    r = qmi_read_byte(dev, QMI_REG_WHO_AM_I, &id);
    if (r != LUME_IMU_OK) {
        goto fail;
    }
    if (id != QMI_WHOAMI_A && id != QMI_WHOAMI_C) {
        ESP_LOGW(TAG, "init: QMI8658 not detected (WHO_AM_I=0x%02x, expected "
                      "0x05/0xFD); IMU bindings disabled", (unsigned)id);
        r = LUME_IMU_ERR_STATE;
        goto fail;
    }

    for (size_t i = 0; i < sizeof(cfg) / sizeof(cfg[0]); i++) {
        r = qmi_write_byte(dev, cfg[i][0], cfg[i][1]);
        if (r != LUME_IMU_OK) {
            ESP_LOGW(TAG, "init: write CTRL reg 0x%02x failed",
                     (unsigned)cfg[i][0]);
            goto fail;
        }
    }

    s_dev = dev;        /* publish only after full success */
    s_init_ok = true;   /* latch success for the process lifetime */
    ESP_LOGI(TAG, "QMI8658 ready (WHO_AM_I=0x%02x, polled mode, "
                  "accel +/-4g / gyro +/-64dps)", (unsigned)id);
    return LUME_IMU_OK;

fail:
    /* Partial-init failure: drop the handle so the next register_bindings()
     * pass retries from scratch; no handle leaks, add_device() never repeats
     * against a live handle. */
    i2c_master_bus_rm_device(dev);
    return r;
}

int lume_imu_hw_read(lume_imu_sample_t *out)
{
    int r = require_dev();
    if (r != LUME_IMU_OK) {
        return r;
    }

    /* AX_L..GZ_H are contiguous (0x35..0x40) with ADDR_AI=1; low byte first,
     * 16-bit two's complement (datasheet 5.6 / 8.9, SensorQMI8658.hpp:813). */
    uint8_t b[12] = { 0 };
    r = qmi_read(s_dev, QMI_REG_AX_L, b, sizeof(b));
    if (r != LUME_IMU_OK) {
        return r;
    }

    int16_t ax = (int16_t)(((uint16_t)b[1]  << 8) | b[0]);
    int16_t ay = (int16_t)(((uint16_t)b[3]  << 8) | b[2]);
    int16_t az = (int16_t)(((uint16_t)b[5]  << 8) | b[4]);
    int16_t gx = (int16_t)(((uint16_t)b[7]  << 8) | b[6]);
    int16_t gy = (int16_t)(((uint16_t)b[9]  << 8) | b[8]);
    int16_t gz = (int16_t)(((uint16_t)b[11] << 8) | b[10]);

    out->ax = (float)ax * s_acc_scale;   /* m/s^2 */
    out->ay = (float)ay * s_acc_scale;
    out->az = (float)az * s_acc_scale;
    out->gx = (float)gx * s_gyr_scale;   /* deg/s */
    out->gy = (float)gy * s_gyr_scale;
    out->gz = (float)gz * s_gyr_scale;
    return LUME_IMU_OK;
}

int lume_imu_hw_on_motion(void)
{
    ESP_LOGW(TAG, "onMotion unavailable: no QMI8658 INT pin in lume_pins.h "
                  "(polled-only this round; see docs/KNOWN-SIMPLIFICATIONS.md)");
    return LUME_IMU_ERR_NO_INT;
}
