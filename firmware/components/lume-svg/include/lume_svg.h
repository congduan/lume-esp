#pragma once
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#ifndef LUME_SVG_MALLOC
#define LUME_SVG_MALLOC malloc
#define LUME_SVG_FREE free
#endif
/* SVG detection tolerates UTF-8 BOM and leading ASCII whitespace. */
int lume_svg_detect(const uint8_t *bytes, size_t len);
/* Returns 0 or -2. Intrinsic dimensions use px width/height then viewBox. */
int lume_svg_size(const uint8_t *bytes, size_t len, uint16_t *w, uint16_t *h);
/* Caller owns RGBA output via LUME_SVG_FREE. Error -2 syntax/size, -3 OOM. */
int lume_svg_render(const uint8_t *bytes, size_t len, uint16_t tw, uint16_t th,
                    uint8_t **rgba, uint16_t *w, uint16_t *h);
