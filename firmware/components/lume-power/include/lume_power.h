#pragma once

/* Engine-task-only light sleep. 0 success, negative status otherwise. */
#define LUME_POWER_OK 0
#define LUME_POWER_ERR_WIFI (-1)
#define LUME_POWER_ERR_BUSY (-2)
#define LUME_POWER_ERR_DRIVER (-3)

int lume_power_sleep_now(void);
int lume_power_wake(void);
