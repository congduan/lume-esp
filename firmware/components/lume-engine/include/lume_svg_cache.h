#pragma once
#include <stddef.h>
#include <stdint.h>

/* r183: firmware-side raster-result cache for the SVG branch of
 * lume_image_decode_ex(). PNG/JPEG decode is already millisecond-scale and is
 * never cached. All calls run on the engine task (the only place QuickJS is
 * touched), so no locking is needed.
 *
 * Key: 32-bit FNV-1a over the source bytes, plus the exact source length and
 * target tw/th. On a hash match the stored source bytes are compared byte for
 * byte, so a hash collision can never display a different glyph.
 *
 * Pixel ownership: the cache owns its own SPIRAM raster copy. A hit hands the
 * caller a FRESH SPIRAM copy, because lume_ui_bridge takes exclusive ownership
 * of image_pixels and frees it (apply_image_source / release_dead_images).
 *
 * Lifecycle: dropped on every QuickJS runtime teardown, since the cache is
 * derived from app-owned JS source bytes. */
int lume_svg_cache_get(const uint8_t *bytes, size_t len, uint16_t tw, uint16_t th,
                       uint8_t **pixels, uint16_t *w, uint16_t *h, uint8_t *alpha);
/* Returns 0 on success, negative on invalid input or OOM. The caller keeps
 * ownership of `pixels` (both buffers are copied into the cache). */
int lume_svg_cache_put(const uint8_t *bytes, size_t len, uint16_t tw, uint16_t th,
                       const uint8_t *pixels, uint16_t w, uint16_t h, uint8_t alpha);
void lume_svg_cache_reset(void);

/* Diagnostics, used by the host harness; harmless in firmware. */
size_t lume_svg_cache_bytes(void);
int lume_svg_cache_count(void);
