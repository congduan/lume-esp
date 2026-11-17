#pragma once
#include <stdint.h>

typedef struct {
    const uint8_t *map;
    int map_w, map_h;
    float px, py, angle;
    uint16_t *pixels;
    int width, height, stride;
} lume_raycast_frame_t;

/* Pure C core: RGB565 output, one DDA ray per column, no LVGL or IRAM data. */
void lume_raycast_render(const lume_raycast_frame_t *frame);
