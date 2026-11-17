#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "quickjs.h"

#define FFT_MAX 4096
#define FFT_PI 3.14159265358979323846

/* A held ArrayBuffer keeps the backing store alive until the transform ends.
 * No JS call is made while any backing-store pointer is in use. */
typedef struct { JSValue buffer; float *data; size_t length; } float_view_t;

static int float_view(JSContext *ctx, JSValueConst value, float_view_t *out)
{
    if (JS_GetTypedArrayType(value) != JS_TYPED_ARRAY_FLOAT32) return -1;
    size_t offset, bytes, element, size;
    JSValue buffer = JS_GetTypedArrayBuffer(ctx, value, &offset, &bytes, &element);
    if (JS_IsException(buffer)) return -1;
    uint8_t *base = JS_GetArrayBuffer(ctx, &size, buffer);
    if (!base || element != sizeof(float) || offset > size || bytes > size - offset) {
        JS_FreeValue(ctx, buffer);
        return -1;
    }
    out->buffer = buffer;
    out->data = (float *)(void *)(base + offset);
    out->length = bytes / sizeof(float);
    return 0;
}

static int valid_length(size_t n)
{
    return n >= 2 && n <= FFT_MAX && (n & (n - 1)) == 0;
}

/* Forward, unnormalised radix-2 DIT FFT. Imaginary scratch stays on the heap,
 * so a 4096-point call does not consume 16 KiB of the engine task stack. */
static void complex_fft(float *re, float *im, size_t n)
{
    size_t j = 0;
    for (size_t i = 1; i < n; i++) {
        size_t bit = n >> 1;
        while (j & bit) { j ^= bit; bit >>= 1; }
        j ^= bit;
        if (i < j) {
            float tmp = re[i]; re[i] = re[j]; re[j] = tmp;
        }
    }
    for (size_t width = 2; width <= n; width <<= 1) {
        double angle = -2.0 * FFT_PI / (double)width;
        double step_re = cos(angle), step_im = sin(angle);
        for (size_t start = 0; start < n; start += width) {
            double tw_re = 1.0, tw_im = 0.0;
            for (size_t k = 0; k < width / 2; k++) {
                size_t a = start + k, b = a + width / 2;
                double vr = tw_re * re[b] - tw_im * im[b];
                double vi = tw_re * im[b] + tw_im * re[b];
                double ur = re[a], ui = im[a];
                re[a] = (float)(ur + vr); im[a] = (float)(ui + vi);
                re[b] = (float)(ur - vr); im[b] = (float)(ui - vi);
                double next_re = tw_re * step_re - tw_im * step_im;
                tw_im = tw_re * step_im + tw_im * step_re;
                tw_re = next_re;
            }
        }
    }
}

/* Packed output: [DC, Nyquist, Re(1), Im(1), ..., Re(N/2-1), Im(N/2-1)]. */
static JSValue fft_realfft(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    (void)this_val;
    float_view_t input, output;
    if (argc < 1 || float_view(ctx, argv[0], &input)) return JS_NewInt32(ctx, -1);
    int separate = argc >= 2 && !JS_IsUndefined(argv[1]);
    if (separate && float_view(ctx, argv[1], &output)) {
        JS_FreeValue(ctx, input.buffer);
        return JS_NewInt32(ctx, -1);
    }
    if (!separate) output = input;
    size_t n = input.length;
    if (!valid_length(n) || output.length != n) {
        if (separate) JS_FreeValue(ctx, output.buffer);
        JS_FreeValue(ctx, input.buffer);
        return JS_NewInt32(ctx, -2);
    }
    float *im = calloc(n, sizeof(float));
    if (!im) {
        if (separate) JS_FreeValue(ctx, output.buffer);
        JS_FreeValue(ctx, input.buffer);
        return JS_NewInt32(ctx, -3);
    }
    if (separate) memmove(output.data, input.data, n * sizeof(float));
    complex_fft(output.data, im, n);
    float nyquist = output.data[n / 2];
    /* Reverse order prevents overwriting the real bins still needed. */
    for (size_t k = n / 2 - 1; k > 0; k--) {
        output.data[2 * k] = output.data[k];
        output.data[2 * k + 1] = im[k];
    }
    output.data[1] = nyquist;
    free(im);
    if (separate) JS_FreeValue(ctx, output.buffer);
    JS_FreeValue(ctx, input.buffer);
    return JS_NewInt32(ctx, 0);
}

static JSValue fft_magnitude(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    (void)this_val;
    float_view_t out, re, im;
    if (argc < 2 || float_view(ctx, argv[0], &out)) return JS_NewInt32(ctx, -1);
    if (float_view(ctx, argv[1], &re)) {
        JS_FreeValue(ctx, out.buffer); return JS_NewInt32(ctx, -1);
    }
    int split = argc >= 3 && !JS_IsUndefined(argv[2]);
    if (split && float_view(ctx, argv[2], &im)) {
        JS_FreeValue(ctx, re.buffer); JS_FreeValue(ctx, out.buffer);
        return JS_NewInt32(ctx, -1);
    }
    size_t n = split ? re.length * 2 : re.length;
    int valid = valid_length(n) && out.length == n / 2 && (!split || im.length == re.length);
    if (valid) {
        /* Magnitudes are independent; reject overlapping output views so a
         * write cannot corrupt a bin that has not yet been read. */
        uintptr_t begin = (uintptr_t)out.data, end = begin + out.length * sizeof(float);
        uintptr_t rbegin = (uintptr_t)re.data, rend = rbegin + re.length * sizeof(float);
        if (begin < rend && rbegin < end) valid = 0;
        if (split) {
            uintptr_t ibegin = (uintptr_t)im.data, iend = ibegin + im.length * sizeof(float);
            if (begin < iend && ibegin < end) valid = 0;
        }
    }
    if (valid) {
        out.data[0] = fabsf(re.data[0]);
        for (size_t k = 1; k < n / 2; k++) {
            float real = split ? re.data[k] : re.data[2 * k];
            float imag = split ? im.data[k] : re.data[2 * k + 1];
            out.data[k] = hypotf(real, imag);
        }
    }
    if (split) JS_FreeValue(ctx, im.buffer);
    JS_FreeValue(ctx, re.buffer); JS_FreeValue(ctx, out.buffer);
    return JS_NewInt32(ctx, valid ? 0 : -2);
}

void lume_fft_register(JSContext *ctx, JSValue lume)
{
    JSValue fft = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, fft, "realfft", JS_NewCFunction(ctx, fft_realfft, "realfft", 2));
    JS_SetPropertyStr(ctx, fft, "magnitude", JS_NewCFunction(ctx, fft_magnitude, "magnitude", 3));
    JS_SetPropertyStr(ctx, lume, "fft", fft);
}
