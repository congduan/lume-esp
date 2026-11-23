#pragma once
/*
 * lume-board-hal -- runtime board interface stub (r147, M5 board abstraction).
 *
 * DIVISION OF LABOUR (read before changing anything here):
 *   The compile-time board profile (firmware/boards/<board>/lume_board_profile.h,
 *   selected by Kconfig `choice LUME_BOARD`) REMAINS the single source of
 *   truth for pins, geometry, panel init tables and touch mapping. This
 *   component is ONLY a runtime board registry: a stable vtable-shaped
 *   singleton that lume-board populates at boot via lume_board_hal_register().
 *   It does NOT replace the profiles. Existing call paths still invoke the
 *   drivers directly -- there is no dispatch consumer yet; the registry is
 *   an observation point for a future second board / runtime detection.
 *
 * WHY A SEPARATE COMPONENT:
 *   `firmware/components/lume-board/` owns the working board drivers
 *   (lume_board.c/.h, lume_display.c, lume_touch.c, lume_pmic.c). The HAL
 *   holds only the vtable and the registry, so the three driver sources
 *   (lume_display.c / lume_touch.c / lume_pmic.c) stay untouched and the
 *   dependency points one way (lume-board REQUIRES
 *   lume-board-hal, never the reverse).
 *
 * The four ops mirror the call shapes of the existing drivers:
 *   panel_init  <- lume_display_init(lv_display_t **out_disp)
 *   touch_init  <- lume_touch_init(i2c_master_bus_handle_t bus, lv_display_t *disp)
 *   touch_read  <- a point read (x, y, pressed); NO standalone driver API
 *                  exists today (lume_touch.c reads in its static LVGL indev
 *                  callback), so the board registered by lume-board uses a
 *                  non-NULL NOT_SUPPORTED face for this op.
 *   power_init  <- lume_pmic_display_power_on(i2c_master_bus_handle_t bus)
 * ESP-IDF / LVGL types are erased to `void *` so this header stays freestanding
 * and can be compiled by the host C ABI harness (tests/board_abi.c).
 *
 * Error convention matches the firmware `lume.*` hardware API: 0 = success,
 * negative = failure (the stub returns LUME_BOARD_ERR_NOT_SUPPORTED).
 */
#include <stdint.h>

#define LUME_BOARD_ERR_NOT_SUPPORTED (-1)
#define LUME_BOARD_ERR_INVALID_ARG   (-2)

typedef int (*lume_board_panel_init_t)(void **out_panel);
typedef int (*lume_board_touch_init_t)(void *bus, void *panel);
typedef int (*lume_board_touch_read_t)(int *out_x, int *out_y, int *out_pressed);
typedef int (*lume_board_power_init_t)(void *bus);

typedef struct lume_board {
    lume_board_panel_init_t panel_init;
    lume_board_touch_init_t touch_init;
    lume_board_touch_read_t touch_read;
    lume_board_power_init_t power_init;
    const char *board_id;
} lume_board_t;

/* Process-wide current board. Never NULL. Before registration it is the
 * "generic" stub (all four ops return LUME_BOARD_ERR_NOT_SUPPORTED and
 * board_id == "generic"); after a successful lume_board_hal_register() it is
 * a stable pointer to the registered board. */
const lume_board_t *lume_board_get(void);

/* Publish the runtime board vtable. The struct is COPIED into a static slot,
 * so a caller may pass stack storage. Returns 0 on success;
 * LUME_BOARD_ERR_INVALID_ARG if board is NULL, any op is NULL, or board_id is
 * NULL/empty. Intended to be called once from lume_board_init(); no existing
 * call path dispatches through the HAL yet (zero behaviour change). */
int lume_board_hal_register(const lume_board_t *board);
