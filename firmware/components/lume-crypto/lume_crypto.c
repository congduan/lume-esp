/* lume.crypto - native crypto primitives backed by ESP-IDF mbedTLS.
 *
 * Contract (mirrors lume.fft / lume.imgscale):
 *   - typed arrays are borrowed zero-copy via JS_GetTypedArrayBuffer; the
 *     ArrayBuffer value is held alive until the computation finishes, and no
 *     JS call happens while a backing-store pointer is in use;
 *   - subarray()/byteOffset views are honoured;
 *   - every function returns 0 on success and a negative code on failure:
 *       -1 bad argument type, -2 invalid key/iv/length, -3 internal failure.
 *
 * CRC-32 is table-free (8 shifts/byte) and implemented here: mbedTLS 3.x
 * dropped mbedtls_crc32 and ESP-IDF's esp_crc32_le is a ROM wrapper that
 * cannot run in the host harness. It is not a cryptographic primitive.
 */

#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include "quickjs.h"
#include "mbedtls/sha256.h"
#include "mbedtls/md.h"
#include "mbedtls/aes.h"

#define LUME_CRYPTO_SHA256_SIZE 32
#define LUME_CRYPTO_AES_BLOCK 16
#define LUME_CRYPTO_OK 0
#define LUME_CRYPTO_ERR_TYPE (-1)
#define LUME_CRYPTO_ERR_LEN (-2)
#define LUME_CRYPTO_ERR_INTERNAL (-3)

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
    if (JS_GetTypedArrayType(value) < 0) return LUME_CRYPTO_ERR_TYPE;
    size_t offset, bytes, element;
    JSValue buffer = JS_GetTypedArrayBuffer(ctx, value, &offset, &bytes, &element);
    if (JS_IsException(buffer)) return LUME_CRYPTO_ERR_TYPE;
    size_t size;
    uint8_t *base = JS_GetArrayBuffer(ctx, &size, buffer);
    if (!base || offset > size || bytes > size - offset) {
        JS_FreeValue(ctx, buffer);
        return LUME_CRYPTO_ERR_TYPE;
    }
    out->buffer = buffer;
    out->data = base + offset;
    out->length = bytes;
    return LUME_CRYPTO_OK;
}

/* Borrow a Uint8Array output view; callers check the minimum byte length. */
static int uint8_view(JSContext *ctx, JSValueConst value, bytes_view_t *out)
{
    if (JS_GetTypedArrayType(value) != JS_TYPED_ARRAY_UINT8) return LUME_CRYPTO_ERR_TYPE;
    return bytes_view(ctx, value, out);
}

static int ranges_overlap(const bytes_view_t *a, const bytes_view_t *b)
{
    uintptr_t ab = (uintptr_t)a->data, ae = ab + a->length;
    uintptr_t bb = (uintptr_t)b->data, be = bb + b->length;
    return ab < be && bb < ae;
}

/* sha256(data, out): write a 32-byte digest into out. Returns 0/-1/-2. */
static JSValue crypto_sha256(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    (void)this_val;
    bytes_view_t data, out;
    if (argc < 2) return JS_NewInt32(ctx, LUME_CRYPTO_ERR_TYPE);
    if (bytes_view(ctx, argv[0], &data)) return JS_NewInt32(ctx, LUME_CRYPTO_ERR_TYPE);
    int err = uint8_view(ctx, argv[1], &out);
    if (err) {
        JS_FreeValue(ctx, data.buffer);
        return JS_NewInt32(ctx, err);
    }
    if (out.length < LUME_CRYPTO_SHA256_SIZE) {
        JS_FreeValue(ctx, out.buffer);
        JS_FreeValue(ctx, data.buffer);
        return JS_NewInt32(ctx, LUME_CRYPTO_ERR_LEN);
    }
    uint8_t digest[LUME_CRYPTO_SHA256_SIZE];
    mbedtls_sha256(data.data, data.length, digest, 0);
    memcpy(out.data, digest, LUME_CRYPTO_SHA256_SIZE);
    JS_FreeValue(ctx, out.buffer);
    JS_FreeValue(ctx, data.buffer);
    return JS_NewInt32(ctx, LUME_CRYPTO_OK);
}

/* hmacSha256(key, data, out): write a 32-byte MAC into out. Returns 0/-1/-2. */
static JSValue crypto_hmac_sha256(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    (void)this_val;
    bytes_view_t key, data, out;
    if (argc < 3) return JS_NewInt32(ctx, LUME_CRYPTO_ERR_TYPE);
    if (bytes_view(ctx, argv[0], &key)) return JS_NewInt32(ctx, LUME_CRYPTO_ERR_TYPE);
    if (bytes_view(ctx, argv[1], &data)) {
        JS_FreeValue(ctx, key.buffer);
        return JS_NewInt32(ctx, LUME_CRYPTO_ERR_TYPE);
    }
    int err = uint8_view(ctx, argv[2], &out);
    if (err) {
        JS_FreeValue(ctx, data.buffer);
        JS_FreeValue(ctx, key.buffer);
        return JS_NewInt32(ctx, err);
    }
    if (out.length < LUME_CRYPTO_SHA256_SIZE) {
        JS_FreeValue(ctx, out.buffer);
        JS_FreeValue(ctx, data.buffer);
        JS_FreeValue(ctx, key.buffer);
        return JS_NewInt32(ctx, LUME_CRYPTO_ERR_LEN);
    }
    uint8_t digest[LUME_CRYPTO_SHA256_SIZE];
    const mbedtls_md_info_t *info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
    if (!info || mbedtls_md_hmac(info, key.data, key.length, data.data, data.length, digest) != 0) {
        JS_FreeValue(ctx, out.buffer);
        JS_FreeValue(ctx, data.buffer);
        JS_FreeValue(ctx, key.buffer);
        return JS_NewInt32(ctx, LUME_CRYPTO_ERR_INTERNAL);
    }
    memcpy(out.data, digest, LUME_CRYPTO_SHA256_SIZE);
    JS_FreeValue(ctx, out.buffer);
    JS_FreeValue(ctx, data.buffer);
    JS_FreeValue(ctx, key.buffer);
    return JS_NewInt32(ctx, LUME_CRYPTO_OK);
}

/* Reflected CRC-32 (poly 0xEDB88320), zlib-compatible seed semantics:
 * seed is the previous zlib.crc32() return value (0 for a fresh stream). */
static uint32_t crc32_update(uint32_t seed, const uint8_t *data, size_t len)
{
    uint32_t crc = seed ^ 0xFFFFFFFFu;
    for (size_t i = 0; i < len; i++) {
        crc ^= data[i];
        for (int k = 0; k < 8; k++)
            crc = (crc >> 1) ^ (0xEDB88320u & (uint32_t)-(int32_t)(crc & 1u));
    }
    return crc ^ 0xFFFFFFFFu;
}

/* crc32(data, seed?): returns the unsigned CRC-32 value, or -1 on a bad
 * argument. A valid CRC of 0xFFFFFFFF is returned as 4294967295 in JS. */
static JSValue crypto_crc32(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    (void)this_val;
    bytes_view_t data;
    if (argc < 1 || bytes_view(ctx, argv[0], &data)) return JS_NewInt32(ctx, LUME_CRYPTO_ERR_TYPE);
    uint32_t seed = 0;
    if (argc >= 2 && !JS_IsUndefined(argv[1])) {
        /* JS_ToUint32 coerces strings to NaN->0, so reject non-numbers first. */
        if (!JS_IsNumber(argv[1]) || JS_ToUint32(ctx, &seed, argv[1])) {
            JS_FreeValue(ctx, data.buffer);
            return JS_NewInt32(ctx, LUME_CRYPTO_ERR_TYPE);
        }
    }
    uint32_t crc = crc32_update(seed, data.data, data.length);
    JS_FreeValue(ctx, data.buffer);
    return JS_NewUint32(ctx, crc);
}

/* aesCtr(key, iv, data, out): CTR is symmetric, so this both encrypts and
 * decrypts. key is 16/24/32 bytes, iv is 16 bytes; out must hold data.length
 * bytes and may be the same view as data. Returns 0/-1/-2/-3. */
static JSValue crypto_aes_ctr(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    (void)this_val;
    bytes_view_t key, iv, data, out;
    if (argc < 4) return JS_NewInt32(ctx, LUME_CRYPTO_ERR_TYPE);
    if (bytes_view(ctx, argv[0], &key)) return JS_NewInt32(ctx, LUME_CRYPTO_ERR_TYPE);
    if (bytes_view(ctx, argv[1], &iv)) {
        JS_FreeValue(ctx, key.buffer);
        return JS_NewInt32(ctx, LUME_CRYPTO_ERR_TYPE);
    }
    if (bytes_view(ctx, argv[2], &data)) {
        JS_FreeValue(ctx, iv.buffer);
        JS_FreeValue(ctx, key.buffer);
        return JS_NewInt32(ctx, LUME_CRYPTO_ERR_TYPE);
    }
    int err = uint8_view(ctx, argv[3], &out);
    if (err) {
        JS_FreeValue(ctx, data.buffer);
        JS_FreeValue(ctx, iv.buffer);
        JS_FreeValue(ctx, key.buffer);
        return JS_NewInt32(ctx, err);
    }
    if ((key.length != 16 && key.length != 24 && key.length != 32) ||
        iv.length != LUME_CRYPTO_AES_BLOCK || out.length < data.length ||
        (out.data != data.data && ranges_overlap(&out, &data))) {
        JS_FreeValue(ctx, out.buffer);
        JS_FreeValue(ctx, data.buffer);
        JS_FreeValue(ctx, iv.buffer);
        JS_FreeValue(ctx, key.buffer);
        return JS_NewInt32(ctx, LUME_CRYPTO_ERR_LEN);
    }
    mbedtls_aes_context aes;
    mbedtls_aes_init(&aes);
    int ret = mbedtls_aes_setkey_enc(&aes, key.data, (unsigned int)(key.length * 8));
    if (ret == 0 && data.length) {
        uint8_t iv_copy[LUME_CRYPTO_AES_BLOCK], stream[LUME_CRYPTO_AES_BLOCK];
        size_t nc_off = 0;
        memcpy(iv_copy, iv.data, LUME_CRYPTO_AES_BLOCK);
        ret = mbedtls_aes_crypt_ctr(&aes, data.length, &nc_off, iv_copy, stream,
                                    data.data, out.data);
    }
    mbedtls_aes_free(&aes);
    JS_FreeValue(ctx, out.buffer);
    JS_FreeValue(ctx, data.buffer);
    JS_FreeValue(ctx, iv.buffer);
    JS_FreeValue(ctx, key.buffer);
    return JS_NewInt32(ctx, ret == 0 ? LUME_CRYPTO_OK : LUME_CRYPTO_ERR_INTERNAL);
}

void lume_crypto_register(JSContext *ctx, JSValue lume)
{
    JSValue crypto = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, crypto, "sha256", JS_NewCFunction(ctx, crypto_sha256, "sha256", 2));
    JS_SetPropertyStr(ctx, crypto, "hmacSha256", JS_NewCFunction(ctx, crypto_hmac_sha256, "hmacSha256", 3));
    JS_SetPropertyStr(ctx, crypto, "crc32", JS_NewCFunction(ctx, crypto_crc32, "crc32", 2));
    JS_SetPropertyStr(ctx, crypto, "aesCtr", JS_NewCFunction(ctx, crypto_aes_ctr, "aesCtr", 4));
    JS_SetPropertyStr(ctx, lume, "crypto", crypto);
}
