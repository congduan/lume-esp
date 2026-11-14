#pragma once
/* Public, cross-component API for the lume-board component.
 * Lives in INCLUDE_DIRS "include" so other components (lume-pmic) can see it
 * via `REQUIRES lume-board`. Board-internal helpers stay in the private
 * lume_board_internal.h at the component root. */
#include "driver/i2c_master.h"
#include "esp_err.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

/* Board bring-up entry point (called once from app_main). */
esp_err_t lume_board_init(void);

/* The shared I2C master bus created by lume_board_init() (AXP2101, CST9220,
 * IMU, codec, RTC — addresses in the board profile). Returns NULL before init.
 * The handle is owned by the board component and kept for the app lifetime;
 * callers add their own devices with i2c_master_bus_add_device() and must NOT
 * delete the bus. ESP-IDF v5.5.5 i2c_master operation functions are
 * thread-safe via the bus operation semaphore, so the LVGL task (touch poll)
 * and the engine task (PMIC telemetry) may use the same bus concurrently. */
i2c_master_bus_handle_t lume_board_get_i2c_bus(void);

/* Called from the engine task. The LVGL task acknowledges a stopped frame
 * before the panel receives DCS sleep-in; wake schedules a full redraw. */
esp_err_t lume_display_sleep(void);
esp_err_t lume_display_wake(void);

/* ---- Debug screen capture (r35) ----
 * Arm ONE full-frame RGB565 snapshot of what the panel is showing. The next
 * refresh cycle (a full-screen invalidate issued by the LVGL task) is copied
 * into an internal PSRAM shadow buffer flush-area by flush-area in flush_cb,
 * BEFORE the byte swap the panel needs, so the captured frame is
 * little-endian row-major RGB565, w*h*2 bytes, no stride padding.
 *
 * `done` must be a binary semaphore created by the caller. On completion it
 * is given exactly once (only while the capture is still pending — a caller
 * that timed out and cancelled is never signalled afterwards); then read the
 * frame with lume_display_capture_buf(). If the display is paused (panel
 * asleep) the capture only completes after wake, so callers wait with a
 * timeout and cancel on failure:
 *   uint16_t w, h;
 *   if (lume_display_capture(done, &w, &h) == ESP_OK &&
 *       xSemaphoreTake(done, pdMS_TO_TICKS(5000)) != pdTRUE) {
 *       lume_display_capture_cancel();
 *   }
 * Returns ESP_ERR_INVALID_STATE if a capture is already pending or there is
 * no display yet; ESP_ERR_NO_MEM if the shadow buffer cannot be allocated.
 * The shadow buffer (460800 B for this board) is allocated once and kept for
 * reuse — see docs/KNOWN-SIMPLIFICATIONS.md. */
esp_err_t lume_display_capture(SemaphoreHandle_t done,
                               uint16_t *out_w, uint16_t *out_h);

/* The capture result: w*h*2 bytes of little-endian RGB565, or NULL if no
 * capture has completed since the last lume_display_capture() call. */
const uint8_t *lume_display_capture_buf(uint16_t *out_w, uint16_t *out_h);

/* Give up waiting for an armed capture. Consumed by the LVGL task; safe to
 * call when no capture is pending. After cancel() the caller may free its
 * semaphore: the firmware never signals a cancelled capture. */
void lume_display_capture_cancel(void);
