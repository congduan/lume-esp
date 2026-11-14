#pragma once
/* Public, cross-component API for the lume-board component.
 * Lives in INCLUDE_DIRS "include" so other components (lume-pmic) can see it
 * via `REQUIRES lume-board`. Board-internal helpers stay in the private
 * lume_board_internal.h at the component root. */
#include "driver/i2c_master.h"
#include "esp_err.h"

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
