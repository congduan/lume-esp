/* RGB565 nearest / bilinear scaling primitive, registered as lume.imgscale.
 *
 * The ArrayBuffer views are held (not copied) for the duration of the call;
 * no JS callback runs while a backing-store pointer is live. The host harness
 * (tests/imgscale.js -> tests/imgscale_host.c) links this exact source file,
 * so host bit patterns and firmware behaviour share one implementation.
 *
 * Deliberate scope: scaling is pure per-pixel sampling. RGB565 0x0000
 * transparency and any colour-key semantics belong to the retainImage /
 * drawImage layer, not to this primitive (recorded in KNOWN-SIMPLIFICATIONS).
 */
#include <stdint.h>
#include <string.h>
#include "quickjs.h"
#include "lume_imgscale.h"

#define IMGSCALE_MAX_DIM LUME_IMGSCALE_MAX_DIM
#define IMGSCALE_FP 256

typedef struct {
    JSValue buffer;   /* owned reference keeping the backing store alive */
    uint16_t *data;   /* typed-array element pointer at the view offset */
    size_t length;    /* element count of the view */
} u16_view_t;

static int u16_view(JSContext *ctx, JSValueConst value, u16_view_t *out)
{
    if (JS_GetTypedArrayType(value) != JS_TYPED_ARRAY_UINT16) return -1;
    size_t offset, bytes, element, size;
    JSValue buffer = JS_GetTypedArrayBuffer(ctx, value, &offset, &bytes, &element);
    if (JS_IsException(buffer)) return -1;
    uint8_t *base = JS_GetArrayBuffer(ctx, &size, buffer);
    if (!base || element != sizeof(uint16_t) || offset > size || bytes > size - offset) {
        JS_FreeValue(ctx, buffer);
        return -1;
    }
    out->buffer = buffer;
    out->data = (uint16_t *)(void *)(base + offset);
    out->length = bytes / sizeof(uint16_t);
    return 0;
}

typedef lume_imgscale_mode_t scale_mode_t;
#define MODE_NEAREST LUME_IMGSCALE_NEAREST
#define MODE_BILINEAR LUME_IMGSCALE_BILINEAR

static int parse_mode(JSContext *ctx, int argc, JSValueConst *argv, scale_mode_t *mode)
{
    *mode = MODE_NEAREST;
    if (argc < 7 || JS_IsUndefined(argv[6])) return 0;
    const char *text = JS_ToCString(ctx, argv[6]);
    if (!text) {
        JS_FreeValue(ctx, JS_GetException(ctx)); /* e.g. Symbol mode */
        return -1;
    }
    int rc = 0;
    if (!strcmp(text, "nearest")) *mode = MODE_NEAREST;
    else if (!strcmp(text, "bilinear")) *mode = MODE_BILINEAR;
    else rc = -1;
    JS_FreeCString(ctx, text);
    return rc;
}

static int read_dim(JSContext *ctx, JSValueConst value, int32_t *out)
{
    double d;
    if (JS_ToFloat64(ctx, &d, value)) {
        JS_FreeValue(ctx, JS_GetException(ctx)); /* clear coercion TypeError */
        return -1;
    }
    /* Reject fractional / non-finite dimensions instead of silently truncating. */
    if (!(d >= 1 && d <= IMGSCALE_MAX_DIM) || d != (double)(int32_t)d) return -2;
    *out = (int32_t)d;
    return 0;
}

/* Nearest source index for dest pixel d, using dest/source pixel centres. */
static int axis_nearest(int d, int dsize, int ssize)
{
    int64_t pos = (int64_t)(2 * d + 1) * ssize / (2 * (int64_t)dsize);
    if (pos < 0) pos = 0;
    if (pos >= ssize) pos = ssize - 1;
    return (int)pos;
}

/* Bilinear source coordinate for dest pixel d, in 1/256 units, clamped to
 * [0, (ssize-1)*256] so edge pixels never sample outside the row. */
static int axis_bilinear(int d, int dsize, int ssize)
{
    int64_t pos = (int64_t)(2 * d + 1) * ssize * IMGSCALE_FP / (2 * (int64_t)dsize)
                  - IMGSCALE_FP / 2;
    int64_t hi = (int64_t)(ssize - 1) * IMGSCALE_FP;
    if (pos < 0) pos = 0;
    if (pos > hi) pos = hi;
    return (int)pos;
}

/* Interpolate R5/G6/B5 independently, then repack RGB565. Never interpolate
 * the packed 16-bit word as an integer (that would bleed channels). */
static uint16_t bilinear_pixel(uint16_t p00, uint16_t p10,
                               uint16_t p01, uint16_t p11, int fx, int fy)
{
    int gx = IMGSCALE_FP - fx, gy = IMGSCALE_FP - fy;
    int w00 = gx * gy, w10 = fx * gy, w01 = gx * fy, w11 = fx * fy; /* sum 65536 */
    int r = ((int)(p00 >> 11) * w00 + (int)(p10 >> 11) * w10 +
             (int)(p01 >> 11) * w01 + (int)(p11 >> 11) * w11 + 32768) >> 16;
    int g = ((int)((p00 >> 5) & 63) * w00 + (int)((p10 >> 5) & 63) * w10 +
             (int)((p01 >> 5) & 63) * w01 + (int)((p11 >> 5) & 63) * w11 + 32768) >> 16;
    int b = ((int)(p00 & 31) * w00 + (int)(p10 & 31) * w10 +
             (int)(p01 & 31) * w01 + (int)(p11 & 31) * w11 + 32768) >> 16;
    if (r < 0) r = 0; else if (r > 31) r = 31;
    if (g < 0) g = 0; else if (g > 63) g = 63;
    if (b < 0) b = 0; else if (b > 31) b = 31;
    return (uint16_t)((r << 11) | (g << 5) | b);
}

/* Shared core: the JS binding validates views/overlap, then calls this. The
 * decode binding reuses it with freshly allocated (non-overlapping) grids. */
int lume_imgscale_pixels(const uint16_t *src, int sw, int sh,
                         uint16_t *dst, int dw, int dh,
                         lume_imgscale_mode_t mode)
{
    if (sw < 1 || sw > LUME_IMGSCALE_MAX_DIM || sh < 1 || sh > LUME_IMGSCALE_MAX_DIM ||
        dw < 1 || dw > LUME_IMGSCALE_MAX_DIM || dh < 1 || dh > LUME_IMGSCALE_MAX_DIM)
        return -2;
    for (int y = 0; y < dh; y++) {
        uint16_t *out = dst + (size_t)y * dw;
        if (mode == LUME_IMGSCALE_NEAREST) {
            int sy = axis_nearest(y, dh, sh);
            const uint16_t *row = src + (size_t)sy * sw;
            for (int x = 0; x < dw; x++) out[x] = row[axis_nearest(x, dw, sw)];
        } else {
            int sy = axis_bilinear(y, dh, sh);
            int y0 = sy >> 8, fy = sy & (IMGSCALE_FP - 1);
            int y1 = y0 + 1; if (y1 >= sh) y1 = sh - 1;
            const uint16_t *row0 = src + (size_t)y0 * sw;
            const uint16_t *row1 = src + (size_t)y1 * sw;
            for (int x = 0; x < dw; x++) {
                int sx = axis_bilinear(x, dw, sw);
                int x0 = sx >> 8, fx = sx & (IMGSCALE_FP - 1);
                int x1 = x0 + 1; if (x1 >= sw) x1 = sw - 1;
                out[x] = bilinear_pixel(row0[x0], row0[x1],
                                        row1[x0], row1[x1], fx, fy);
            }
        }
    }
    return 0;
}

static JSValue imgscale_scale(JSContext *ctx, JSValueConst this_val,
                              int argc, JSValueConst *argv)
{
    (void)this_val;
    if (argc < 6) return JS_NewInt32(ctx, -1);
    /* Coercion (valueOf/toString) can re-enter JS; finish it before pinning
     * any backing store so no JS callback runs while a pointer is live. */
    int32_t sw32, sh32, dw32, dh32;
    scale_mode_t mode;
    int rc = read_dim(ctx, argv[1], &sw32);
    if (!rc) rc = read_dim(ctx, argv[2], &sh32);
    if (!rc) rc = read_dim(ctx, argv[4], &dw32);
    if (!rc) rc = read_dim(ctx, argv[5], &dh32);
    if (!rc) rc = parse_mode(ctx, argc, argv, &mode);
    if (rc) return JS_NewInt32(ctx, rc);
    u16_view_t src, dst;
    if (u16_view(ctx, argv[0], &src)) return JS_NewInt32(ctx, -1);
    if (u16_view(ctx, argv[3], &dst)) {
        JS_FreeValue(ctx, src.buffer);
        return JS_NewInt32(ctx, -1);
    }
    {
        size_t sw = (size_t)sw32, sh = (size_t)sh32;
        size_t dw = (size_t)dw32, dh = (size_t)dh32;
        rc = -2;
        if (sw <= src.length && sh <= src.length / sw &&
            dw <= dst.length && dh <= dst.length / dw) {
            uintptr_t sbegin = (uintptr_t)src.data, dend0;
            uintptr_t send = sbegin + sw * sh * sizeof(uint16_t);
            uintptr_t dbegin = (uintptr_t)dst.data;
            dend0 = dbegin + dw * dh * sizeof(uint16_t);
            int overlap = (sbegin < dend0) && (dbegin < send);
            /* Identical view + identical geometry is a safe in-place copy:
             * every output pixel samples only its own input pixel. Any other
             * overlap is rejected because a write could clobber a source. */
            int in_place = (sbegin == dbegin) && (send == dend0) &&
                           (sw32 == dw32) && (sh32 == dh32);
            if (!overlap || in_place) {
                rc = lume_imgscale_pixels(src.data, sw32, sh32,
                                          dst.data, dw32, dh32, mode);
            }
        }
    }
    JS_FreeValue(ctx, dst.buffer);
    JS_FreeValue(ctx, src.buffer);
    return JS_NewInt32(ctx, rc);
}

void lume_imgscale_register(JSContext *ctx, JSValue lume)
{
    JSValue ns = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, ns, "scale",
                      JS_NewCFunction(ctx, imgscale_scale, "scale", 7));
    JS_SetPropertyStr(ctx, lume, "imgscale", ns);
}
