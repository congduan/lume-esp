#include "lume_image.h"
#include <stdlib.h>
#include <string.h>
#include "esp_heap_caps.h"
#include "lvgl.h"
#include "src/libs/lodepng/lodepng.h"
#include "src/libs/tjpgd/tjpgd.h"

typedef struct { const uint8_t *b; size_t n, pos; uint8_t *out; uint16_t w; } jpeg_ctx_t;
static size_t jpeg_input(JDEC *jd, uint8_t *dst, size_t count)
{
    jpeg_ctx_t *c = jd->device;
    size_t available = c->n - c->pos;
    if (count > available) count = available;
    if (dst) memcpy(dst, c->b + c->pos, count);
    c->pos += count;
    return count;
}
static int jpeg_output(JDEC *jd, void *bitmap, JRECT *rect)
{
    jpeg_ctx_t *c = jd->device;
    const uint8_t *src = bitmap;
    for (uint16_t y = rect->top; y <= rect->bottom; y++) {
        for (uint16_t x = rect->left; x <= rect->right; x++) {
            /* Vendored tjpgd JD_FORMAT=0 writes B,G,R (tjpgd.c:880-886). */
            uint16_t v = (uint16_t)((src[2] & 0xf8) << 8 | (src[1] & 0xfc) << 3 | src[0] >> 3);
            size_t off = ((size_t)y * c->w + x) * 2;
            c->out[off] = v & 255; c->out[off + 1] = v >> 8;
            src += 3;
        }
    }
    return 1;
}

int lume_image_decode(const uint8_t *b, size_t n, uint8_t **pixels,
                      uint16_t *w, uint16_t *h, uint8_t *has_alpha)
{
    if (!pixels || !has_alpha) return -1;
    *pixels = NULL; *has_alpha = 0;
    int rc = lume_image_size_of(b, n, w, h);
    if (rc) return rc;
    size_t count = (size_t)*w * *h;
    bool png = b[0] == 0x89;
    uint8_t *out = heap_caps_malloc(count * (png ? 3 : 2), MALLOC_CAP_SPIRAM);
    if (!out) return -3;
    if (png) {
        unsigned char *rgba = NULL;
        unsigned dw = 0, dh = 0;
        unsigned err = lodepng_decode32(&rgba, &dw, &dh, b, n);
        if (err || dw != *w || dh != *h || !rgba) {
            lv_free(rgba); heap_caps_free(out); return err == 83 ? -3 : -2;
        }
        bool alpha = false;
        for (size_t i = 0; i < count; i++) {
            uint8_t *p = rgba + 4 * i;
            uint16_t v = (uint16_t)((p[0] & 0xf8) << 8 | (p[1] & 0xfc) << 3 | p[2] >> 3);
            out[2*i] = v & 255; out[2*i+1] = v >> 8;
            out[2*count+i] = p[3];
            if (p[3] != 255) alpha = true;
        }
        lv_free(rgba);
        *has_alpha = alpha;
    } else {
        uint8_t work[4096];
        jpeg_ctx_t c = {.b=b, .n=n, .out=out, .w=*w};
        JDEC jd;
        JRESULT jr = jd_prepare(&jd, jpeg_input, work, sizeof(work), &c);
        if (jr == JDR_OK && jd.width == *w && jd.height == *h)
            jr = jd_decomp(&jd, jpeg_output, 0);
        else if (jr == JDR_OK) jr = JDR_FMT1;
        if (jr != JDR_OK) {
            heap_caps_free(out);
            return jr == JDR_MEM1 || jr == JDR_MEM2 ? -3 : -2;
        }
    }
    *pixels = out;
    return 0;
}
