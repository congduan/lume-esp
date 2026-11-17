#include <math.h>
#include <stddef.h>
#include "lume_raycast.h"

static const uint16_t wall[4][4] = {
    {0x18c4,0x3168,0x630d,0x9d14},
    {0x20a4,0x3948,0x6acd,0xa4b4},
    {0x1964,0x3a28,0x6bcd,0xadb4},
    {0x18a6,0x3150,0x5b18,0x8dff}
};

void lume_raycast_render(const lume_raycast_frame_t *f)
{
    if (!f || !f->map || !f->pixels || f->width <= 0 || f->height <= 0 ||
        f->stride < f->width || f->map_w <= 0 || f->map_h <= 0) return;
    const float dx = cosf(f->angle), dy = sinf(f->angle);
    const float plane_x = -dy * 0.66f, plane_y = dx * 0.66f;
    if (f->width > 480) return;
    /* One LVGL reader. Static scratch avoids a large LVGL-task stack frame;
     * row-major writes keep PSRAM cache lines hot. */
    static int16_t tops[480], bottoms[480];
    static uint16_t colors[480];
    const int horizon = f->height / 2;
    for (int x = 0; x < f->width; x++) {
        float camera = 2.0f * (float)x / (float)f->width - 1.0f;
        float rx = dx + plane_x * camera, ry = dy + plane_y * camera;
        int mx = (int)floorf(f->px), my = (int)floorf(f->py);
        float delta_x = rx == 0.0f ? 1e30f : fabsf(1.0f / rx);
        float delta_y = ry == 0.0f ? 1e30f : fabsf(1.0f / ry);
        int step_x = rx < 0 ? -1 : 1, step_y = ry < 0 ? -1 : 1;
        float side_x = (rx < 0 ? f->px - mx : mx + 1.0f - f->px) * delta_x;
        float side_y = (ry < 0 ? f->py - my : my + 1.0f - f->py) * delta_y;
        int side = 0, tile = 0;
        for (int n = 0; n < f->map_w + f->map_h + 1; n++) {
            if (side_x < side_y) { side_x += delta_x; mx += step_x; side = 0; }
            else { side_y += delta_y; my += step_y; side = 1; }
            if (mx < 0 || my < 0 || mx >= f->map_w || my >= f->map_h) { tile = 1; break; }
            tile = f->map[my * f->map_w + mx];
            if (tile) break;
        }
        float dist = side ? side_y - delta_y : side_x - delta_x;
        if (dist < 0.05f) dist = 0.05f;
        int wall_h = (int)((float)f->height / dist);
        int top = horizon - wall_h / 2, bottom = horizon + wall_h / 2;
        if (top < 0) top = 0;
        if (bottom > f->height) bottom = f->height;
        int shade = dist < 2.0f ? 3 : dist < 4.0f ? 2 : dist < 7.0f ? 1 : 0;
        if (side && shade) shade--;
        tops[x] = top; bottoms[x] = bottom;
        colors[x] = wall[(tile - 1) & 3][shade];
    }
    for (int y = 0; y < f->height; y++) {
        uint16_t sky = y < horizon / 2 ? 0x08a6 : 0x10e8;
        uint16_t floor = y < horizon + horizon / 2 ? 0x2106 : 0x18c3;
        uint16_t *row = f->pixels + (size_t)y * f->stride;
        for (int x = 0; x < f->width; x++)
            row[x] = y < tops[x] ? sky : y < bottoms[x] ? colors[x] : floor;
    }
}
