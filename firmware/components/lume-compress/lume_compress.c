/* lume.compress - native DEFLATE decompression via vendored miniz tinfl (r92).
 *
 * Contract (mirrors lume.fft / lume.imgscale / lume.crypto):
 *   - typed arrays are borrowed zero-copy via JS_GetTypedArrayBuffer; the
 *     ArrayBuffer value is held alive until decompression finishes, and no
 *     JS call happens while a backing-store pointer is in use;
 *   - subarray()/byteOffset views are honoured on src and out;
 *   - inflate(src, out, format?) writes the decompressed bytes into the
 *     caller-owned `out` view and returns the number of bytes written
 *     (0 is a valid result for an empty stream). Errors are negative:
 *       -1 bad argument type / bad format string,
 *       -2 malformed, truncated or checksum-mismatched input stream,
 *       -3 output buffer too small for the decompressed data.
 *
 * The inflate algorithm is the vendored public-domain miniz 3.1.0 tinfl
 * coroutine (`miniz_tinfl.c`, included below). We do not implement inflate
 * ourselves and add no build dependency. zlib mode uses tinfl's built-in
 * header validation (CMF/FLG, FDICT rejection) and Adler-32 verification, so
 * no separate adler32 primitive is exposed.
 */

#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include "quickjs.h"

/* Single-file vendored inflate (types, flags, struct + verbatim coroutine). */
#include "miniz_tinfl.c"

#define LUME_COMPRESS_ERR_TYPE (-1)
#define LUME_COMPRESS_ERR_DATA (-2)
#define LUME_COMPRESS_ERR_LEN  (-3)

/* A borrowed typed-array view. `buffer` owns the backing store; `data` is
 * base + view offset and is valid only while `buffer` is alive. */
typedef struct {
    JSValue buffer;
    uint8_t *data;
    size_t length;
} bytes_view_t;

/* Borrow any typed array as raw bytes (element size irrelevant: subarrays and
 * multi-byte views are all exposed as their underlying byte range). */
static int bytes_view(JSContext *ctx, JSValueConst value, bytes_view_t *out)
{
    if (JS_GetTypedArrayType(value) < 0) return LUME_COMPRESS_ERR_TYPE;
    size_t offset, bytes, element;
    JSValue buffer = JS_GetTypedArrayBuffer(ctx, value, &offset, &bytes, &element);
    if (JS_IsException(buffer)) return LUME_COMPRESS_ERR_TYPE;
    size_t size;
    uint8_t *base = JS_GetArrayBuffer(ctx, &size, buffer);
    if (!base || offset > size || bytes > size - offset) {
        JS_FreeValue(ctx, buffer);
        return LUME_COMPRESS_ERR_TYPE;
    }
    out->buffer = buffer;
    out->data = base + offset;
    out->length = bytes;
    return 0;
}

/* Borrow a Uint8Array output view. */
static int uint8_view(JSContext *ctx, JSValueConst value, bytes_view_t *out)
{
    if (JS_GetTypedArrayType(value) != JS_TYPED_ARRAY_UINT8) return LUME_COMPRESS_ERR_TYPE;
    return bytes_view(ctx, value, out);
}

/* inflate(src, out, format?): decompress DEFLATE into out.
 * format is "raw" (default) or "zlib". Returns bytes written (>= 0) or a
 * negative error code. Never throws a JS exception. */
static JSValue compress_inflate(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    (void)this_val;
    bytes_view_t src, out;
    int err = 0;

    if (argc < 2) return JS_NewInt32(ctx, LUME_COMPRESS_ERR_TYPE);
    if (bytes_view(ctx, argv[0], &src)) return JS_NewInt32(ctx, LUME_COMPRESS_ERR_TYPE);
    err = uint8_view(ctx, argv[1], &out);
    if (err) {
        JS_FreeValue(ctx, src.buffer);
        return JS_NewInt32(ctx, err);
    }

    uint32_t flags = (uint32_t)TINFL_FLAG_USING_NON_WRAPPING_OUTPUT_BUF;
    if (argc >= 3 && !JS_IsUndefined(argv[2]) && !JS_IsNull(argv[2])) {
        if (!JS_IsString(argv[2])) {
            err = LUME_COMPRESS_ERR_TYPE;
            goto done;
        }
        const char *format = JS_ToCString(ctx, argv[2]);
        if (!format) {
            err = LUME_COMPRESS_ERR_TYPE;
            goto done;
        }
        if (!strcmp(format, "zlib"))
            flags |= (uint32_t)TINFL_FLAG_PARSE_ZLIB_HEADER;
        else if (strcmp(format, "raw")) {
            JS_FreeCString(ctx, format);
            err = LUME_COMPRESS_ERR_TYPE;
            goto done;
        }
        JS_FreeCString(ctx, format);
    }

    {
        tinfl_decompressor decomp;
        size_t in_left = src.length;
        size_t out_left = out.length;
        /* A valid non-NULL pointer even for a zero-length out view, so tinfl
         * returns DONE for an empty stream and HAS_MORE_OUTPUT otherwise. */
        uint8_t empty_sink;
        uint8_t *out_ptr = out.length ? out.data : &empty_sink;
        tinfl_init(&decomp);
        tinfl_status status = tinfl_decompress(&decomp,
            (const mz_uint8 *)src.data, &in_left,
            (mz_uint8 *)out_ptr, (mz_uint8 *)out_ptr, &out_left, flags);
        if (status != TINFL_STATUS_DONE) {
            err = (status == TINFL_STATUS_HAS_MORE_OUTPUT)
                ? LUME_COMPRESS_ERR_LEN : LUME_COMPRESS_ERR_DATA;
            goto done;
        }
        JS_FreeValue(ctx, out.buffer);
        JS_FreeValue(ctx, src.buffer);
        /* tinfl sets *out_left to the number of bytes written. */
        return JS_NewInt32(ctx, (int32_t)out_left);
    }

done:
    JS_FreeValue(ctx, out.buffer);
    JS_FreeValue(ctx, src.buffer);
    return JS_NewInt32(ctx, err);
}

void lume_compress_register(JSContext *ctx, JSValue lume)
{
    JSValue compress = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, compress, "inflate",
                      JS_NewCFunction(ctx, compress_inflate, "inflate", 3));
    JS_SetPropertyStr(ctx, lume, "compress", compress);
}
