#include "../firmware/components/quickjs-ng/quickjs.h"
#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static int releases;
static void *release_record(JSRuntime *rt, void *opaque, void *ptr, size_t size) {
    (void)rt; (void)opaque;
    assert(size==0);
    releases++; free(ptr); return NULL;
}
int main(void) {
    JSRuntime *rt=JS_NewRuntime(); assert(rt);
    JSContext *ctx=JS_NewContext(rt); assert(ctx);
    uint8_t *pcm=malloc(640000); assert(pcm);
    for (size_t i=0;i<640000;i++) pcm[i]=(uint8_t)(i*7);
    JSValue ab=JS_NewArrayBuffer(ctx,pcm,640000,0,release_record,NULL,false);
    assert(!JS_IsException(ab));
    size_t size=0; uint8_t *got=JS_GetArrayBuffer(ctx,&size,ab);
    assert(got==pcm && size==640000);
    for (size_t i=0;i<size;i++) assert(got[i]==(uint8_t)(i*7));
    JS_FreeValue(ctx,ab); assert(releases==1);
    pcm=malloc(64); assert(pcm); memset(pcm,0x5a,64);
    ab=JS_NewArrayBuffer(ctx,pcm,64,0,release_record,NULL,false);
    assert(!JS_IsException(ab));
    JS_DetachArrayBuffer(ctx,ab); assert(releases==2);
    JS_FreeValue(ctx,ab); assert(releases==2);
    JS_FreeContext(ctx); JS_FreeRuntime(rt);
    puts("Record backing: 640000 bytes intact, finalizer and detach release once PASS");
}
