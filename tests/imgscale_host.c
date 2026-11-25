/* QuickJS-NG host runner for tests/imgscale.js; links the firmware source.
 *
 * r191 provenance (derived from tests/imgscale.js): record_buffer vendored
 * QuickJS closure plus lume_imgscale.c and lume-engine/include; argv[1] is
 * tests/lib/imgscale_cases.js.
 */
#include <stdio.h>
#include <stdlib.h>
#include "quickjs.h"

extern void lume_imgscale_register(JSContext *, JSValue);
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
    JS_SetPropertyStr(ctx, global, "lume", lume);
    JS_SetPropertyStr(ctx, global, "print", JS_NewCFunction(ctx, host_print, "print", 1));
    JS_FreeValue(ctx, global);
    JSValue result = JS_Eval(ctx, source, (size_t)length, "imgscale.js", JS_EVAL_TYPE_GLOBAL);
    if (JS_IsException(result)) {
        JSValue exception = JS_GetException(ctx);
        const char *message = JS_ToCString(ctx, exception);
        fprintf(stderr, "IMGSCALE harness error: %s\n", message ? message : "unknown");
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
