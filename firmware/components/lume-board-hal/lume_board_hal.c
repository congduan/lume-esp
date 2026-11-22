/*
 * lume-board-hal -- default runtime board singleton.
 *
 * Pure stub: no consumer, no board profile include, no ESP-IDF dependency.
 * The compile-time profile stays the source of truth (see lume_board_hal.h).
 */
#include "lume_board_hal.h"

/* One canonical not-supported implementation. The four typed ops below are
 * its call-shape-specific faces; they all delegate here. Keeping a single
 * body avoids casting between incompatible function-pointer types. */
static int lume_board_not_supported(void)
{
    return LUME_BOARD_ERR_NOT_SUPPORTED;
}

static int lume_board_not_supported_panel_init(void **out_panel)
{
    (void)out_panel;
    return lume_board_not_supported();
}

static int lume_board_not_supported_touch_init(void *bus, void *panel)
{
    (void)bus;
    (void)panel;
    return lume_board_not_supported();
}

static int lume_board_not_supported_touch_read(int *out_x, int *out_y,
                                               int *out_pressed)
{
    (void)out_x;
    (void)out_y;
    (void)out_pressed;
    return lume_board_not_supported();
}

static int lume_board_not_supported_power_init(void *bus)
{
    (void)bus;
    return lume_board_not_supported();
}

static const lume_board_t s_lume_board_generic = {
    .panel_init = lume_board_not_supported_panel_init,
    .touch_init = lume_board_not_supported_touch_init,
    .touch_read = lume_board_not_supported_touch_read,
    .power_init = lume_board_not_supported_power_init,
    .board_id   = "generic",
};

const lume_board_t *lume_board_get(void)
{
    return &s_lume_board_generic;
}
