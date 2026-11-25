/* QuickJS-NG host runner for tests/crypto.js; links the exact firmware
 * lume_crypto.c source against mbedTLS (sha256/md/aes minimal closure).
 *
 * r191 provenance (derived from tests/crypto.js): CI supplies the pinned
 * mbedTLS v3.6.2 tarball via LUME_MBEDTLS_ROOT (see tests.yml Provision step)
 * plus tests/lib/r91_crypto_mbedtls_config.h. Build uses the same vendored
 * QuickJS closure as record_buffer plus the five mbedTLS library sources;
 * argv[1] is tests/lib/crypto_cases.js.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "quickjs.h"

extern void lume_crypto_register(JSContext *, JSValue);
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
    lume_crypto_register(ctx, lume);
    JS_SetPropertyStr(ctx, global, "lume", lume);
    JS_SetPropertyStr(ctx, global, "print", JS_NewCFunction(ctx, host_print, "print", 1));
    JS_FreeValue(ctx, global);
    JSValue result = JS_Eval(ctx, source, (size_t)length, "crypto.js", JS_EVAL_TYPE_GLOBAL);
    if (JS_IsException(result)) {
        JSValue exception = JS_GetException(ctx);
        const char *message = JS_ToCString(ctx, exception);
        fprintf(stderr, "CRYPTO harness error: %s\n", message ? message : "unknown");
        JSValue stack = JS_GetPropertyStr(ctx, exception, "stack");
        const char *trace = JS_ToCString(ctx, stack);
        if (trace) fprintf(stderr, "%s\n", trace);
        return 1;
    }
    JS_FreeValue(ctx, result);
    JS_FreeContext(ctx); JS_FreeRuntime(rt); free(source);
    return 0;
}
