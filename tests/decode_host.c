/* QuickJS-NG host runner for tests/decode.js.
 *
 * Links the firmware lume_imgscale.c, lume_image_decode.c and
 * lume_image_pixels.c verbatim. Only the codec is shimmed: a compact PNG
 * decoder (zlib inflate + PNG unfilter) feeds the real RGB565A8 converter,
 * because lodepng/tjpgd/LVGL are not available on the host. The shim honours
 * the same decode_ex signature and error codes as firmware/lume_image.c.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <zlib.h>
#include "quickjs.h"
#include "lume_image.h"

extern void lume_imgscale_register(JSContext *, JSValue);
extern void lume_image_decode_register(JSContext *, JSValue);

void heap_caps_free(void *ptr) { free(ptr); }

static uint32_t be32(const uint8_t *p)
{
    return (uint32_t)p[0] << 24 | (uint32_t)p[1] << 16 |
           (uint32_t)p[2] << 8 | p[3];
}

static int paeth(int a, int b, int c)
{
    int p = a + b - c, pa = abs(p - a), pb = abs(p - b), pc = abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    return pb <= pc ? b : c;
}

/* Decode a minimal non-interlaced 8-bit RGBA/RGB PNG fixture into RGB565A8.
 * Filters are reconstructed before the shared converter runs, so the colour
 * plane bits are the genuine result of decoding the hand-built PNG bytes. */
int lume_image_decode_ex(const uint8_t *b, size_t n, uint16_t tw, uint16_t th,
                         uint8_t **pixels, uint16_t *w, uint16_t *h, uint8_t *has_alpha)
{
    (void)tw; (void)th;
    if (!b || !pixels || !w || !h || !has_alpha) return -1;
    *pixels = NULL; *has_alpha = 0;
    if (n < 24 || memcmp(b, "\x89PNG\r\n\x1a\n", 8)) return -2;

    uint32_t width = 0, height = 0;
    int depth = 0, colour = 0;
    uint8_t *idat = malloc(n);
    if (!idat) return -3;
    size_t idat_len = 0, pos = 8;
    while (pos + 12 <= n) {
        uint32_t len = be32(b + pos);
        if ((size_t)len > n - pos - 12) { free(idat); return -2; }
        const uint8_t *data = b + pos + 8;
        if (len == 13 && !memcmp(b + pos + 4, "IHDR", 4)) {
            width = be32(data); height = be32(data + 4);
            depth = data[8]; colour = data[9];
            if (data[12] != 0) { free(idat); return -2; } /* interlaced */
        } else if (!memcmp(b + pos + 4, "IDAT", 4)) {
            memcpy(idat + idat_len, data, len);
            idat_len += len;
        } else if (!memcmp(b + pos + 4, "IEND", 4)) {
            break;
        }
        pos += (size_t)len + 12;
    }
    int bpp = colour == 6 ? 4 : colour == 2 ? 3 : 0;
    if (!width || !height || width > 480 || height > 480 || !idat_len ||
        depth != 8 || !bpp) { free(idat); return -2; }

    size_t stride = (size_t)width * bpp;
    size_t rawsize = (stride + 1) * height;
    uint8_t *raw = malloc(rawsize);
    if (!raw) { free(idat); return -3; }
    uLongf inflated = (uLongf)rawsize;
    if (uncompress(raw, &inflated, idat, (uLong)idat_len) != Z_OK ||
        inflated != (uLongf)rawsize) {
        free(raw); free(idat); return -2;
    }
    free(idat);

    uint8_t *rgba = malloc((size_t)width * height * 4);
    uint8_t *out = malloc((size_t)width * height * 3); /* RGB565A8 */
    if (!rgba || !out) { free(raw); free(rgba); free(out); return -3; }
    for (uint32_t y = 0; y < height; y++) {
        uint8_t *row = raw + y * (stride + 1);
        int filter = row[0];
        for (size_t x = 0; x < stride; x++) {
            int left = x >= (size_t)bpp ? row[x - bpp + 1] : 0;
            int up = y ? raw[(y - 1) * (stride + 1) + x + 1] : 0;
            int ul = (y && x >= (size_t)bpp) ? raw[(y - 1) * (stride + 1) + x - bpp + 1] : 0;
            int v = row[x + 1];
            if (filter == 1) v += left;
            else if (filter == 2) v += up;
            else if (filter == 3) v += (left + up) / 2;
            else if (filter == 4) v += paeth(left, up, ul);
            else if (filter != 0) { free(raw); free(rgba); free(out); return -2; }
            row[x + 1] = (uint8_t)v;
        }
        for (uint32_t x = 0; x < width; x++) {
            uint8_t *dst = rgba + ((size_t)y * width + x) * 4;
            const uint8_t *src = row + 1 + (size_t)x * bpp;
            dst[0] = src[0]; dst[1] = src[1]; dst[2] = src[2];
            dst[3] = bpp == 4 ? src[3] : 255;
        }
    }
    free(raw);
    *has_alpha = lume_image_rgba_to_rgb565a8(rgba, (size_t)width * height, out);
    free(rgba);
    *pixels = out; *w = (uint16_t)width; *h = (uint16_t)height;
    return 0;
}

static JSValue host_print(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    (void)this_val;
    for (int i = 0; i < argc; i++) {
        const char *value = JS_ToCString(ctx, argv[i]);
        if (value) { fputs(value, stdout); JS_FreeCString(ctx, value); }
        if (i + 1 < argc) putchar(' ');
    }
    putchar('\n');
    return JS_UNDEFINED;
}

int main(int argc, char **argv)
{
    if (argc != 2) return 2;
    FILE *file = fopen(argv[1], "rb");
    if (!file) { perror(argv[1]); return 2; }
    fseek(file, 0, SEEK_END);
    long length = ftell(file);
    rewind(file);
    char *source = malloc((size_t)length + 1);
    if (!source || fread(source, 1, (size_t)length, file) != (size_t)length) return 2;
    fclose(file);
    source[length] = 0;
    JSRuntime *rt = JS_NewRuntime();
    JSContext *ctx = JS_NewContext(rt);
    JSValue global = JS_GetGlobalObject(ctx), lume = JS_NewObject(ctx);
    lume_imgscale_register(ctx, lume);
    JSValue image = JS_NewObject(ctx);
    lume_image_decode_register(ctx, image);
    JS_SetPropertyStr(ctx, lume, "image", image);
    JS_SetPropertyStr(ctx, global, "lume", lume);
    JS_SetPropertyStr(ctx, global, "print", JS_NewCFunction(ctx, host_print, "print", 1));
    JS_FreeValue(ctx, global);
    JSValue result = JS_Eval(ctx, source, (size_t)length, "decode_cases.js", JS_EVAL_TYPE_GLOBAL);
    if (JS_IsException(result)) {
        JSValue exception = JS_GetException(ctx);
        const char *message = JS_ToCString(ctx, exception);
        fprintf(stderr, "DECODE harness error: %s\n", message ? message : "unknown");
        JS_FreeCString(ctx, message);
        JSValue stack = JS_GetPropertyStr(ctx, exception, "stack");
        const char *trace = JS_ToCString(ctx, stack);
        if (trace) { fprintf(stderr, "%s\n", trace); JS_FreeCString(ctx, trace); }
        return 1;
    }
    JS_FreeValue(ctx, result);
    JS_FreeContext(ctx); JS_FreeRuntime(rt); free(source);
    return 0;
}
