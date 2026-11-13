/**
 * lume-imu: QMI8658 accelerometer + gyroscope hardware layer behind the
 * lume.imu JS bindings (M2 / r9). POLLED-ONLY this round.
 *
 * Pure C, no QuickJS dependency: the lume_engine.c natives marshal the sample
 * into a JS object. Every entry point runs on the QuickJS engine task only,
 * same thread as the other lume.* bindings. The shared I2C bus is ALSO used by
 * the LVGL task (touch polling) and lume-pmic; ESP-IDF v5.5.5 i2c_master
 * operation functions are thread-safe via the bus operation semaphore (see the
 * evidence block in lume_pmic_hw.c), so this layer takes no lock of its own.
 *
 * Status contract (returned by init / read / on_motion):
 *   0   LUME_IMU_OK           success
 *  -1   LUME_IMU_ERR_ARG      reserved for contract symmetry; no-arg API
 *  -2   LUME_IMU_ERR_DRIVER   ESP-IDF i2c_master call failed
 *  -3   LUME_IMU_ERR_STATE    IMU not detected / not initialised
 *  -4   LUME_IMU_ERR_NO_INT   onMotion unavailable (no board-level INT pin)
 *
 * lume_imu_hw_init() runs from register_bindings() on every fresh runtime. A
 * SUCCESSFUL init is latched for the process lifetime (idempotent across
 * hot-reload runtime resets); a FAILED init does NOT latch and releases the
 * device handle, so the next pass retries from scratch (the r8-reviewed
 * lume-pmic policy). A no-board / undetected IMU makes read() return -3, which
 * the engine maps to JS `null` (semantic failures never abort or throw).
 *
 * POLLED-ONLY: lume_pins.h defines no QMI8658 INT pin, the Waveshare official
 * example for THIS board (04_LVGL_QMI8658_ui) is polled, and INT validation is
 * deferred to the main controller's on-board round. See the file-top evidence
 * table in lume_imu_hw.c and docs/KNOWN-SIMPLIFICATIONS.md (r9 section).
 */
#pragma once

#define LUME_IMU_OK          0
#define LUME_IMU_ERR_ARG     (-1)
#define LUME_IMU_ERR_DRIVER  (-2)
#define LUME_IMU_ERR_STATE   (-3)
#define LUME_IMU_ERR_NO_INT  (-4)

/* One 6-axis sample in PHYSICAL units. Conversion from the raw 16-bit
 * two's-complement output registers happens here (native C), not in JS:
 *   ax/ay/az  m/s^2   (g -> m/s^2 via the standard 9.80665)
 *   gx/gy/gz  deg/s   (the sensor's native angular-rate unit, dps)
 * The brief requires physical units with scaling done in native; ESP32-S3 has
 * an FPU so plain float is used (no soft-float optimisation assumptions). */
typedef struct {
    float ax, ay, az;
    float gx, gy, gz;
} lume_imu_sample_t;

/* One-time QMI8658 setup on the shared bus: add device 0x6B @ 400 kHz, soft
 * reset, WHO_AM_I check (0x05 QMI8658A / 0xFD QMI8658C), then configure
 * CTRL1..CTRL7 (accel +/-4g / 1000Hz, gyro +/-64dps / 896.8Hz, LPFs on) and
 * enable both sensors. CTRL4/CTRL6 are reserved and never written. A
 * SUCCESSFUL init is latched for the process lifetime; ANY FAILURE (including
 * partial failures after add_device) drops the device handle and does NOT
 * latch, so the next call retries from scratch and add_device() is never
 * called twice with a live handle. Non-fatal on failure: WARN + negative
 * status, no abort. */
int lume_imu_hw_init(void);

/* Burst-read AX_L..GZ_H (12 contiguous bytes, 0x35..0x40) and return the
 * scaled sample. Returns LUME_IMU_OK and fills `out` on success, a negative
 * status on error (no board / I2C failure). Deliberately NOT gated on STATUS0
 * (aDA/gDA): those bits mean "new data since last read" and would make
 * consecutive read() calls fail; the output registers always hold the most
 * recent converted sample. */
int lume_imu_hw_read(lume_imu_sample_t *out);

/* Motion / data-ready interrupt callback registration. NOT IMPLEMENTED this
 * round: lume_pins.h has no QMI8658 INT pin and the INT path cannot be
 * validated without a board. Always returns LUME_IMU_ERR_NO_INT (-4) and logs
 * a WARN; the JS binding exposes it so the API shape stays discoverable. */
int lume_imu_hw_on_motion(void);
