#pragma once
#include <stdint.h>

typedef struct {
    const uint8_t *map;
    const uint8_t *textures; /* three 16x16 palette-index textures */
    int map_w, map_h;
    float px, py, angle;
    int hp;
    int quality; /* 1: full columns; 2/4: replicate sampled columns */
    int sprite_count;
    struct { float x, y; int type; } sprites[8];
    uint16_t *pixels;
    int width, height, stride;
} lume_raycast_frame_t;

/* Pure C core: RGB565 output, one DDA ray per column, no LVGL or IRAM data. */
void lume_raycast_render(const lume_raycast_frame_t *frame);
