#include "lume_image.h"

uint8_t lume_image_rgba_to_rgb565a8(const uint8_t *rgba, size_t count, uint8_t *out)
{
    uint8_t has_alpha = 0;
    for (size_t i = 0; i < count; i++) {
        const uint8_t *p = rgba + 4 * i;
        uint16_t v = (uint16_t)((p[0] & 0xf8) << 8 | (p[1] & 0xfc) << 3 | p[2] >> 3);
        out[2*i] = v & 255; out[2*i+1] = v >> 8;
        out[2*count+i] = p[3];
        if (p[3] != 255) has_alpha = 1;
    }
    return has_alpha;
}
