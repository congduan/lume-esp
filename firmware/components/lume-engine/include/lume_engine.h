#pragma once
#include <stddef.h>
#include <stdint.h>

void lume_engine_start(void);

/* Run pending JS work from a driver task (called by board event sources).
 * All JS execution happens on the engine task via this queue. */
void lume_engine_post_event(const uint8_t *data, size_t len);
