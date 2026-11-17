#include <stdint.h>
#include "quickjs.h"

/* Keep the ArrayBuffer value alive while native code uses its backing store.
 * No JS call is made between obtaining a pointer and completing the loop. */
typedef struct { JSValue buffer; float *data; size_t length; } float_view_t;

static int float_view(JSContext *ctx, JSValueConst value, float_view_t *out)
{
    if (JS_GetTypedArrayType(value) != JS_TYPED_ARRAY_FLOAT32) {
        JS_ThrowTypeError(ctx, "expected Float32Array");
        return -1;
    }
    size_t offset, bytes, element;
    JSValue buffer = JS_GetTypedArrayBuffer(ctx, value, &offset, &bytes, &element);
    if (JS_IsException(buffer)) return -1;
    size_t size;
    uint8_t *base = JS_GetArrayBuffer(ctx, &size, buffer);
    if (!base || element != sizeof(float) || offset > size || bytes > size - offset) {
        JS_FreeValue(ctx, buffer);
        if (base) JS_ThrowTypeError(ctx, "invalid Float32Array view");
        return -1;
    }
    out->buffer = buffer;
    out->data = (float *)(void *)(base + offset);
    out->length = bytes / sizeof(float);
    return 0;
}

static JSValue math_vec_add(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    (void)this_val;
    float_view_t a, b;
    if (argc < 2 || float_view(ctx, argv[0], &a)) return JS_EXCEPTION;
    if (float_view(ctx, argv[1], &b)) { JS_FreeValue(ctx, a.buffer); return JS_EXCEPTION; }
    if (a.length != b.length) {
        JS_FreeValue(ctx, a.buffer); JS_FreeValue(ctx, b.buffer);
        return JS_ThrowRangeError(ctx, "Float32Array lengths differ");
    }
    for (size_t i = 0; i < a.length; i++) a.data[i] += b.data[i];
    JS_FreeValue(ctx, a.buffer); JS_FreeValue(ctx, b.buffer);
    return JS_DupValue(ctx, argv[0]);
}

static JSValue math_vec_scale(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    (void)this_val;
    if (argc < 2) return JS_ThrowTypeError(ctx, "vecScale needs an array and scale");
    double scale;
    if (JS_ToFloat64(ctx, &scale, argv[1])) return JS_EXCEPTION;
    float_view_t a;
    if (float_view(ctx, argv[0], &a)) return JS_EXCEPTION;
    for (size_t i = 0; i < a.length; i++) a.data[i] *= (float)scale;
    JS_FreeValue(ctx, a.buffer);
    return JS_DupValue(ctx, argv[0]);
}

static JSValue math_dot(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    (void)this_val;
    float_view_t a, b;
    if (argc < 2 || float_view(ctx, argv[0], &a)) return JS_EXCEPTION;
    if (float_view(ctx, argv[1], &b)) { JS_FreeValue(ctx, a.buffer); return JS_EXCEPTION; }
    if (a.length != b.length) {
        JS_FreeValue(ctx, a.buffer); JS_FreeValue(ctx, b.buffer);
        return JS_ThrowRangeError(ctx, "Float32Array lengths differ");
    }
    double sum = 0;
    for (size_t i = 0; i < a.length; i++) sum += (double)a.data[i] * b.data[i];
    JS_FreeValue(ctx, a.buffer); JS_FreeValue(ctx, b.buffer);
    return JS_NewFloat64(ctx, sum);
}

/* acc is interleaved [ax0, ay0, ax1, ay1, ...]. Integrate velocities in
 * place; callers own position integration because positions are not inputs. */
static JSValue math_integrate(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    (void)this_val;
    if (argc < 4) return JS_ThrowTypeError(ctx, "integrate needs acc, vx, vy, dt");
    double dt;
    if (JS_ToFloat64(ctx, &dt, argv[3])) return JS_EXCEPTION;
    float_view_t acc, vx, vy;
    if (float_view(ctx, argv[0], &acc)) return JS_EXCEPTION;
    if (float_view(ctx, argv[1], &vx)) { JS_FreeValue(ctx, acc.buffer); return JS_EXCEPTION; }
    if (float_view(ctx, argv[2], &vy)) {
        JS_FreeValue(ctx, acc.buffer); JS_FreeValue(ctx, vx.buffer); return JS_EXCEPTION;
    }
    if (vx.length != vy.length || vx.length > SIZE_MAX / 2 || acc.length != vx.length * 2) {
        JS_FreeValue(ctx, acc.buffer); JS_FreeValue(ctx, vx.buffer); JS_FreeValue(ctx, vy.buffer);
        return JS_ThrowRangeError(ctx, "acc must have twice as many elements as vx and vy");
    }
    float step = (float)dt;
    for (size_t i = 0; i < vx.length; i++) {
        /* JS Float32Array assignments round once after double arithmetic. */
        vx.data[i] = (float)((double)vx.data[i] + (double)acc.data[2 * i] * step);
        vy.data[i] = (float)((double)vy.data[i] + (double)acc.data[2 * i + 1] * step);
    }
    JS_FreeValue(ctx, acc.buffer); JS_FreeValue(ctx, vx.buffer); JS_FreeValue(ctx, vy.buffer);
    return JS_UNDEFINED;
}

void lume_math_register(JSContext *ctx, JSValue lume)
{
    JSValue math = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, math, "vecAdd", JS_NewCFunction(ctx, math_vec_add, "vecAdd", 2));
    JS_SetPropertyStr(ctx, math, "vecScale", JS_NewCFunction(ctx, math_vec_scale, "vecScale", 2));
    JS_SetPropertyStr(ctx, math, "dot", JS_NewCFunction(ctx, math_dot, "dot", 2));
    JS_SetPropertyStr(ctx, math, "integrate", JS_NewCFunction(ctx, math_integrate, "integrate", 4));
    JS_SetPropertyStr(ctx, lume, "math", math);
}
