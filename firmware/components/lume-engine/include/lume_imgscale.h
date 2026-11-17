#pragma once
#include <stdint.h>

/* Shared RGB565 scaling limits / core, used by lume.imgscale.scale and by the
 * optional maxW/maxH path of lume.image.decode. */
#define LUME_IMGSCALE_MAX_DIM 16384

typedef enum {
    LUME_IMGSCALE_NEAREST = 0,
    LUME_IMGSCALE_BILINEAR = 1
} lume_imgscale_mode_t;

/* Pure per-pixel scaling over raw RGB565 grids. The caller owns both grids and
 * must ensure they do not partially overlap (the JS binding enforces the r84
 * view-overlap rule; freshly allocated decode buffers cannot overlap).
 * Returns 0 on success, -2 for an invalid dimension or a grid that does not
 * fit. No JS callback runs and no buffer is copied here. */
int lume_imgscale_pixels(const uint16_t *src, int sw, int sh,
                         uint16_t *dst, int dw, int dh,
                         lume_imgscale_mode_t mode);
