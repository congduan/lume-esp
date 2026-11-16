#pragma once
#include <stddef.h>
#include <stdint.h>

/* Return 0, or -1 invalid arguments/oversize bitmap, -2 corrupt/unsupported data.
 * SVG intrinsic dimensions may exceed 480; raster limits apply in decode_ex. */
int lume_image_size_of(const uint8_t *bytes, size_t len, uint16_t *w, uint16_t *h);
/* Output is PSRAM-owned RGB565 or RGB565A8 (color plane then alpha plane).
 * Caller frees *pixels with heap_caps_free(). -3 means allocation failure. */
int lume_image_decode(const uint8_t *bytes, size_t len, uint8_t **pixels,
                      uint16_t *w, uint16_t *h, uint8_t *has_alpha);
int lume_image_decode_ex(const uint8_t *bytes, size_t len, uint16_t tw, uint16_t th,
                         uint8_t **pixels, uint16_t *w, uint16_t *h, uint8_t *has_alpha);
/* Pure conversion; output has RGB565 plane then A8 plane. */
uint8_t lume_image_rgba_to_rgb565a8(const uint8_t *rgba, size_t count, uint8_t *out);
