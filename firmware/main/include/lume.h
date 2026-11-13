#pragma once
#include "esp_err.h"

/* board */
esp_err_t lume_board_init(void);

/* engine */
void lume_engine_start(void);

/* hot reload over USB CDC */
void lume_hotreload_start(void);
