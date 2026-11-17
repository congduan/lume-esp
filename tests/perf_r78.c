/* Host QuickJS-NG harness: compile with vendored sources and lume_math.c.
 * argv[1] is a ~3 MB classic script; argv[2] is qjsc -b -C output. */
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <time.h>
#include "quickjs.h"

extern void lume_math_register(JSContext *, JSValue);

static double now_ms(void) {
    struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t);
    return t.tv_sec * 1000.0 + t.tv_nsec / 1e6;
}
static uint8_t *read_all(const char *path, size_t *len) {
    FILE *f = fopen(path, "rb"); if (!f) { perror(path); exit(1); }
    fseek(f, 0, SEEK_END); *len = (size_t)ftell(f); rewind(f);
    uint8_t *p = malloc(*len + 1); if (!p || fread(p, 1, *len, f) != *len) exit(1);
    p[*len] = 0; fclose(f); return p;
}
static void check(JSContext *ctx, JSValue v) {
    if (!JS_IsException(v)) { JS_FreeValue(ctx, v); return; }
    JSValue ex = JS_GetException(ctx); const char *s = JS_ToCString(ctx, ex);
    fprintf(stderr, "JS error: %s\n", s ? s : "unknown"); exit(1);
}
static void run_code(JSContext *ctx, const char *code) {
    check(ctx, JS_Eval(ctx, code, strlen(code), "test.js", JS_EVAL_TYPE_GLOBAL));
}
int main(int argc, char **argv) {
    if (argc != 3) return 2;
    size_t src_len, bc_len;
    uint8_t *src = read_all(argv[1], &src_len), *bc = read_all(argv[2], &bc_len);
    JSRuntime *rt = JS_NewRuntime(); JSContext *ctx = JS_NewContext(rt);
    if (!ctx) return 2;
    double t0 = now_ms();
    JSValue compiled = JS_Eval(ctx, (char *)src, src_len, "app.js",
                               JS_EVAL_TYPE_GLOBAL | JS_EVAL_FLAG_COMPILE_ONLY);
    double parse_ms = now_ms() - t0;
    if (JS_IsException(compiled)) check(ctx, compiled);
    check(ctx, JS_EvalFunction(ctx, compiled));
    run_code(ctx, "if (globalThis.r78Result !== 42) throw Error('source result');");
    JS_FreeContext(ctx); ctx = JS_NewContext(rt);
    t0 = now_ms();
    JSValue obj = JS_ReadObject(ctx, bc, bc_len, JS_READ_OBJ_BYTECODE);
    double read_ms = now_ms() - t0;
    if (JS_IsException(obj)) check(ctx, obj);
    check(ctx, JS_EvalFunction(ctx, obj));
    run_code(ctx, "if (globalThis.r78Result !== 42) throw Error('bytecode result');");
    JSValue lume = JS_NewObject(ctx); lume_math_register(ctx, lume);
    JSValue global = JS_GetGlobalObject(ctx);
    JS_SetPropertyStr(ctx, global, "lume", lume); JS_FreeValue(ctx, global);
    run_code(ctx,
      "const bits=x=>new Uint32Array(x.buffer,x.byteOffset,x.length);"
      "const eq=(a,b)=>{for(let i=0;i<a.length;i++)if(bits(a)[i]!==bits(b)[i])throw Error('bit mismatch '+i)};"
      "let a=new Float32Array([1,2,3]),b=new Float32Array([4,5,6]);"
      "let e=new Float32Array(a);for(let i=0;i<3;i++)e[i]+=b[i];"
      "if(lume.math.vecAdd(a,b)!==a)throw Error('vecAdd return');eq(a,e);"
      "for(let i=0;i<3;i++)e[i]*=0.5;eq(lume.math.vecScale(a,0.5),e);"
      "let d=0;for(let i=0;i<3;i++)d+=a[i]*b[i];if(lume.math.dot(a,b)!==d)throw Error('dot');"
      "let off=new Float32Array(new ArrayBuffer(24),4,3);off.set([1,2,3]);"
      "lume.math.vecScale(off,2);eq(off,new Float32Array([2,4,6]));"
      "try{lume.math.vecAdd(new Float32Array(1),new Float32Array(2));throw Error('length accepted')}catch(e){if(!(e instanceof RangeError))throw e}"
      "try{lume.math.dot([],new Float32Array(0));throw Error('type accepted')}catch(e){if(!(e instanceof TypeError))throw e}"
      "let acc=new Float32Array(2000),vx=new Float32Array(1000),vy=new Float32Array(1000);"
      "for(let i=0;i<1000;i++){acc[2*i]=Math.fround(i/1000);acc[2*i+1]=Math.fround(-i/2000);vx[i]=1;vy[i]=-1;}"
      "let ex=new Float32Array(vx),ey=new Float32Array(vy);"
      "for(let s=0;s<100;s++)for(let i=0;i<1000;i++){ex[i]+=acc[2*i]*Math.fround(0.016);ey[i]+=acc[2*i+1]*Math.fround(0.016)}"
      "for(let s=0;s<100;s++)lume.math.integrate(acc,vx,vy,0.016);eq(vx,ex);eq(vy,ey);"
      "globalThis.r78Acc=acc;globalThis.r78Vx=vx;globalThis.r78Vy=vy;"
    );
    const char *js_loop = "for(let s=0;s<100;s++)for(let i=0;i<1000;i++){r78Vx[i]+=r78Acc[2*i]*Math.fround(0.016);r78Vy[i]+=r78Acc[2*i+1]*Math.fround(0.016)}";
    const char *native_loop = "for(let s=0;s<100;s++)lume.math.integrate(r78Acc,r78Vx,r78Vy,0.016)";
    t0 = now_ms(); run_code(ctx, js_loop); double js_ms = now_ms()-t0;
    t0 = now_ms(); run_code(ctx, native_loop); double native_ms = now_ms()-t0;
    printf("source_bytes=%zu bytecode_bytes=%zu parse_ms=%.3f read_object_ms=%.3f js_integrate_ms=%.3f native_integrate_ms=%.3f\n",
           src_len, bc_len, parse_ms, read_ms, js_ms, native_ms);
    JS_FreeContext(ctx); JS_FreeRuntime(rt); free(src); free(bc);
    return 0;
}
