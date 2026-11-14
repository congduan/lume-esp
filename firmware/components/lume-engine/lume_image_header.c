#include "lume_image.h"
#include "lume_pins.h"       /* r27: display geometry from the board profile */
#include <string.h>

static uint32_t be32(const uint8_t *p)
{ return (uint32_t)p[0] << 24 | (uint32_t)p[1] << 16 | (uint32_t)p[2] << 8 | p[3]; }

/* Bounds-checked PNG IHDR and JPEG SOF scan. No allocation or decompression. */
int lume_image_size_of(const uint8_t *b, size_t n, uint16_t *w, uint16_t *h)
{
    if (!b || !w || !h) return -1;
    uint32_t width = 0, height = 0;
    if (n >= 24 && memcmp(b, "\x89PNG\r\n\x1a\n", 8) == 0) {
        if (be32(b + 8) != 13 || memcmp(b + 12, "IHDR", 4) != 0) return -2;
        width = be32(b + 16); height = be32(b + 20);
    } else if (n >= 4 && b[0] == 0xff && b[1] == 0xd8) {
        size_t pos = 2;
        while (pos + 4 <= n) {
            if (b[pos++] != 0xff) return -2;
            while (pos < n && b[pos] == 0xff) pos++;
            if (pos >= n) return -2;
            uint8_t marker = b[pos++];
            if (marker == 0xd9 || marker == 0xda || marker == 0x00) return -2;
            if (marker >= 0xd0 && marker <= 0xd7) continue;
            if (pos + 2 > n) return -2;
            size_t seg = ((size_t)b[pos] << 8) | b[pos + 1];
            if (seg < 2 || seg > n - pos) return -2;
            if ((marker >= 0xc0 && marker <= 0xcf && marker != 0xc4 &&
                 marker != 0xc8 && marker != 0xcc)) {
                if (seg < 7) return -2;
                height = ((uint32_t)b[pos + 3] << 8) | b[pos + 4];
                width = ((uint32_t)b[pos + 5] << 8) | b[pos + 6];
                break;
            }
            pos += seg;
        }
    } else return -2;
    if (!width || !height) return -2;
    if (width > LUME_LCD_H_RES || height > LUME_LCD_V_RES) return -1;
    *w = width; *h = height;
    return 0;
}
