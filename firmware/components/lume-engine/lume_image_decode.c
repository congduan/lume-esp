/* lume.image.decode(bytes, maxW?, maxH?) JS binding.
 *
 * Reuses the firmware lume_image_decode_ex() path. The returned Uint16Array is
 * the RGB565 colour plane copied into a fresh QuickJS ArrayBuffer (JS heap);
 * the PSRAM decode buffer is released before returning. PNG's A8 plane is
 * discarded — the public contract is RGB565 only (see KNOWN-SIMPLIFICATIONS).
 *
 * The host harness (tests/decode.js -> tests/decode_host.c) links this exact
 * source with a small PNG codec shim, so argument handling, marshalling and
 * the imgscale chain share one implementation with the firmware.
 */
#include <stdint.h>
#include <string.h>
#include "quickjs.h"
#include "lume_image.h"
#include "lume_imgscale.h"

/* Declared here rather than via esp_heap_caps.h so the host harness can shim
 * it with free(); identical to the ESP-IDF declaration (esp_heap_caps.h:113). */
void heap_caps_free(void *ptr);

/* Same dimension discipline as r84 lume_imgscale.c: integer 1..16384,
 * fractional / out-of-range values are rejected (-2), coercion errors -1. */
static int read_dim(JSContext *ctx, JSValueConst value, int32_t *out)
{
    double d;
    if (JS_ToFloat64(ctx, &d, value)) {
        JS_FreeValue(ctx, JS_GetException(ctx));
        return -1;
    }
    if (!(d >= 1 && d <= LUME_IMGSCALE_MAX_DIM) || d != (double)(int32_t)d) return -2;
    *out = (int32_t)d;
    return 0;
}

static JSValue js_image_decode(JSContext *ctx, JSValueConst this_val,
                               int argc, JSValueConst *argv)
{
    (void)this_val;
    if (argc < 1) return JS_NewInt32(ctx, -1);
    size_t len = 0;
    uint8_t *bytes = JS_GetArrayBuffer(ctx, &len, argv[0]);
    if (!bytes) return JS_NewInt32(ctx, -1); /* ArrayBuffer only, as sizeOf */

    /* Optional target size: both dimensions required, undefined/null = omit. */
    int ndim = 0;
    if (argc > 1 && !JS_IsUndefined(argv[1]) && !JS_IsNull(argv[1])) ndim++;
    if (argc > 2 && !JS_IsUndefined(argv[2]) && !JS_IsNull(argv[2])) ndim++;
    if (ndim == 1) return JS_NewInt32(ctx, -1);
    int32_t dw = 0, dh = 0;
    if (ndim == 2) {
        int rc = read_dim(ctx, argv[1], &dw);
        if (!rc) rc = read_dim(ctx, argv[2], &dh);
        if (rc) return JS_NewInt32(ctx, rc);
    }

    uint8_t *pixels = NULL, has_alpha = 0;
    uint16_t w = 0, h = 0;
    int rc = lume_image_decode_ex(bytes, len, 0, 0, &pixels, &w, &h, &has_alpha);
    if (rc) return JS_NewInt32(ctx, rc); /* propagate -1/-2/-3 verbatim */
    if (!pixels || !w || !h) {
        if (pixels) heap_caps_free(pixels);
        return JS_NewInt32(ctx, -2);
    }
    size_t count = (size_t)w * h;
    size_t out_count = ndim ? (size_t)dw * dh : count;
    JSValue out_ab = JS_NewArrayBufferCopy(ctx, NULL, out_count * sizeof(uint16_t));
    if (JS_IsException(out_ab)) {
        heap_caps_free(pixels);
        return out_ab;
    }
    size_t out_len = 0;
    uint8_t *out_data = JS_GetArrayBuffer(ctx, &out_len, out_ab);
    if (!out_data || out_len < out_count * sizeof(uint16_t)) {
        JS_FreeValue(ctx, out_ab);
        heap_caps_free(pixels);
        return JS_NewInt32(ctx, -2);
    }
    /* ESP32-S3 (and the host harness) are little-endian: the colour plane
     * written as v&255, v>>8 per pixel reads back as the packed RGB565 word. */
    if (ndim)
        rc = lume_imgscale_pixels((const uint16_t *)(void *)pixels, w, h,
                                  (uint16_t *)(void *)out_data, dw, dh,
                                  LUME_IMGSCALE_NEAREST);
    else
        memcpy(out_data, pixels, count * sizeof(uint16_t));
    heap_caps_free(pixels);
    if (rc) {
        JS_FreeValue(ctx, out_ab);
        return JS_NewInt32(ctx, rc);
    }

    JSValue view = JS_NewTypedArray(ctx, 1, &out_ab, JS_TYPED_ARRAY_UINT16);
    JS_FreeValue(ctx, out_ab);
    if (JS_IsException(view)) return view;
    JSValue result = JS_NewObject(ctx);
    if (JS_IsException(result)) {
        JS_FreeValue(ctx, view);
        return result;
    }
    JS_SetPropertyStr(ctx, result, "width", JS_NewInt32(ctx, ndim ? dw : w));
    JS_SetPropertyStr(ctx, result, "height", JS_NewInt32(ctx, ndim ? dh : h));
    JS_SetPropertyStr(ctx, result, "pixels", view); /* consumes view */
    return result;
}

void lume_image_decode_register(JSContext *ctx, JSValue image)
{
    JS_SetPropertyStr(ctx, image, "decode",
                      JS_NewCFunction(ctx, js_image_decode, "decode", 3));
}
