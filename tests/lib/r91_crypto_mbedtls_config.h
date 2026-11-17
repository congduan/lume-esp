/* Minimal mbedTLS config for the r91 host harness (approach a).
 *
 * Uniquely named on purpose: a file called mbedtls_config.h would be found
 * relative to build_info.h's own directory before this -I path is searched,
 * silently pulling in the full IDF config (every hash + PSA) and forcing a
 * much larger link closure. Only SHA-256, the md wrapper, AES and CTR mode
 * are enabled - exactly the primitives lume_crypto.c calls.
 */
#ifndef R91_CRYPTO_MBEDTLS_CONFIG_H
#define R91_CRYPTO_MBEDTLS_CONFIG_H
#define MBEDTLS_HAVE_ASM
#define MBEDTLS_SHA256_C
#define MBEDTLS_MD_C
#define MBEDTLS_AES_C
#define MBEDTLS_CIPHER_MODE_CTR
#define MBEDTLS_PLATFORM_C
#define MBEDTLS_ERROR_C
#endif
