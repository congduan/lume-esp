#pragma once
#include "esp_err.h"

/* r27: every board-specific compile-time constant lives in the selected
 * board profile under firmware/boards/<CONFIG_LUME_BOARD_DIR>/. That directory
 * is added to this component's public INCLUDE_DIRS by lume-board/CMakeLists.txt,
 * so including this shim re-exports the whole profile to every firmware
 * component that already includes "lume_pins.h".
 *
 * See firmware/boards/README.md and docs/r27-board-param-audit.md. */
#include "lume_board_profile.h"

esp_err_t lume_board_init(void);
