/* Host-side unit test for the r183 SVG raster cache.
 *
 * Compiles the REAL firmware component (firmware/components/lume-engine/
 * lume_svg_cache.c) with heap_caps stubs, so hit/miss/eviction/key behaviour is
 * verified against the same implementation the device runs. No board needed.
 *
 * r191 provenance (derived from tests/svg_cache.js):
 *   gcc -std=c11 -O2 -Wall -Wextra -Werror \
 *     -I firmware/components/lume-engine/include \
 *     tests/svg_cache_test.c firmware/components/lume-engine/lume_svg_cache.c \
 *     -o /tmp/lume_svg_cache_test && /tmp/lume_svg_cache_test
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include "lume_svg_cache.h"

#define SPIRAM_CAPS (1u << 10)
#define HDR_MAGIC 0x183u

typedef struct { size_t size; uint32_t magic; } hdr_t;
static size_t s_live, s_allocs, s_frees;

void *heap_caps_malloc(size_t size, uint32_t caps)
{
    if (caps != SPIRAM_CAPS) {
        fprintf(stderr, "FAIL: heap_caps_malloc got caps=%u, expected SPIRAM\n", caps);
        exit(2);
    }
    hdr_t *h = malloc(sizeof(hdr_t) + size);
    if (!h) return NULL;
    h->size = size; h->magic = HDR_MAGIC;
    s_live += size; s_allocs++;
    return (uint8_t *)h + sizeof(hdr_t);
}

void heap_caps_free(void *ptr)
{
    if (!ptr) return;
    hdr_t *h = (hdr_t *)((uint8_t *)ptr - sizeof(hdr_t));
    if (h->magic != HDR_MAGIC) {
        fprintf(stderr, "FAIL: heap_caps_free on invalid/double-freed pointer\n");
        exit(2);
    }
    h->magic = 0;
    s_live -= h->size; s_frees++;
    free(h);
}

static int g_fail;
#define CHECK(cond, ...) do { \
    if (!(cond)) { fprintf(stderr, "FAIL: " __VA_ARGS__); fprintf(stderr, " (line %d)\n", __LINE__); g_fail++; } \
    else { printf("PASS: "); printf(__VA_ARGS__); printf("\n"); } \
} while (0)

static void fill(uint8_t *p, size_t n, uint8_t seed)
{
    for (size_t i = 0; i < n; i++) p[i] = (uint8_t)(seed + i % 17);
}
static int matches(const uint8_t *p, size_t n, uint8_t seed)
{
    for (size_t i = 0; i < n; i++)
        if (p[i] != (uint8_t)(seed + i % 17)) return 0;
    return 1;
}
static int put_src(const char *src, size_t src_len, uint16_t tw, uint16_t th,
                   uint8_t seed, uint16_t w, uint16_t h, uint8_t a)
{
    size_t n = (size_t)w * h * (a ? 3u : 2u);
    uint8_t *px = (uint8_t *)malloc(n);
    fill(px, n, seed);
    int rc = lume_svg_cache_put((const uint8_t *)src, src_len, tw, th, px, w, h, a);
    free(px);
    return rc;
}
static int get_src(const char *src, size_t src_len, uint16_t tw, uint16_t th,
                   uint8_t seed, uint16_t *w, uint16_t *h, uint8_t *a)
{
    uint8_t *px = NULL;
    int hit = lume_svg_cache_get((const uint8_t *)src, src_len, tw, th,
                                 &px, w, h, a);
    if (hit) {
        CHECK(matches(px, (size_t)*w * *h * (*a ? 3u : 2u), seed),
              "hit returns the exact raster bytes");
        heap_caps_free(px); /* simulate the bridge owning and freeing the copy */
    }
    return hit;
}

int main(void)
{
    char A[] = "<svg>A</svg>", B[] = "<svg>B-longer</svg>", C[] = "<svg>C</svg>";
    char D[] = "<svg>D</svg>", E[] = "<svg>E</svg>";
    uint16_t w, h; uint8_t a; uint8_t *px = NULL;

    /* 1. miss, put, hit; hit buffer is a fresh copy (free it, hit again). */
    lume_svg_cache_reset();
    CHECK(!lume_svg_cache_get((uint8_t *)A, strlen(A), 320, 320, &px, &w, &h, &a),
          "cold entry is a miss");
    CHECK(put_src(A, strlen(A), 320, 320, 11, 320, 320, 1) == 0, "put A 320x320 ok");
    CHECK(lume_svg_cache_count() == 1, "one entry after put");
    CHECK(lume_svg_cache_bytes() == (size_t)320 * 320 * 3, "byte budget tracks RGB565A8 raster");
    CHECK(get_src(A, strlen(A), 320, 320, 11, &w, &h, &a) == 1 && w == 320 && h == 320 && a == 1,
          "hit returns correct dimensions/alpha");
    CHECK(get_src(A, strlen(A), 320, 320, 11, &w, &h, &a) == 1,
          "second hit after freeing first copy (copy-on-hit, no shared buffer)");

    /* 2. content change: new bytes are a miss until inserted; old bytes survive. */
    lume_svg_cache_reset();
    CHECK(put_src(A, strlen(A), 64, 64, 21, 64, 64, 0) == 0, "put A 64x64");
    CHECK(!get_src(B, strlen(B), 64, 64, 21, &w, &h, &a), "different source bytes = miss");
    CHECK(put_src(B, strlen(B), 64, 64, 22, 64, 64, 0) == 0, "put B 64x64");
    CHECK(get_src(B, strlen(B), 64, 64, 22, &w, &h, &a) == 1, "B hits after put");
    CHECK(get_src(A, strlen(A), 64, 64, 21, &w, &h, &a) == 1, "A still hits (distinct key)");

    /* 3. target size is part of the key. */
    lume_svg_cache_reset();
    CHECK(put_src(A, strlen(A), 320, 320, 31, 320, 320, 1) == 0, "put A at 320x320");
    CHECK(!get_src(A, strlen(A), 160, 160, 31, &w, &h, &a), "same source, different tw/th = miss");
    CHECK(put_src(A, strlen(A), 160, 160, 32, 160, 160, 1) == 0, "put A at 160x160");
    CHECK(lume_svg_cache_count() == 2, "two size variants coexist");

    /* 4. LRU eviction at the entry cap (4). */
    lume_svg_cache_reset();
    CHECK(put_src(A, strlen(A), 16, 16, 41, 16, 16, 0) == 0, "put small A");
    CHECK(put_src(B, strlen(B), 16, 16, 42, 16, 16, 0) == 0, "put small B");
    CHECK(put_src(C, strlen(C), 16, 16, 43, 16, 16, 0) == 0, "put small C");
    CHECK(put_src(D, strlen(D), 16, 16, 44, 16, 16, 0) == 0, "put small D");
    CHECK(get_src(A, strlen(A), 16, 16, 41, &w, &h, &a) == 1, "touch A (now most recent)");
    CHECK(put_src(E, strlen(E), 16, 16, 45, 16, 16, 0) == 0, "put small E");
    CHECK(lume_svg_cache_count() == 4, "entry cap holds at 4");
    CHECK(!get_src(B, strlen(B), 16, 16, 42, &w, &h, &a), "LRU (B) evicted");
    CHECK(get_src(A, strlen(A), 16, 16, 41, &w, &h, &a) == 1, "touched A survives");
    CHECK(get_src(E, strlen(E), 16, 16, 45, &w, &h, &a) == 1, "newest E present");

    /* 5. byte-budget cap: 4 full 320x320 A8 rasters exceed 1 MiB, so only 3 fit. */
    lume_svg_cache_reset();
    CHECK(put_src(A, strlen(A), 320, 320, 51, 320, 320, 1) == 0, "full A");
    CHECK(put_src(B, strlen(B), 320, 320, 52, 320, 320, 1) == 0, "full B");
    CHECK(put_src(C, strlen(C), 320, 320, 53, 320, 320, 1) == 0, "full C");
    CHECK(put_src(D, strlen(D), 320, 320, 54, 320, 320, 1) == 0, "full D triggers eviction");
    CHECK(lume_svg_cache_count() == 3, "byte budget caps at 3 full-size rasters");
    CHECK(lume_svg_cache_bytes() == (size_t)3 * 320 * 320 * 3, "resident bytes <= 1 MiB");
    CHECK(!get_src(A, strlen(A), 320, 320, 51, &w, &h, &a), "oldest full raster evicted");
    CHECK(get_src(D, strlen(D), 320, 320, 54, &w, &h, &a) == 1, "newest full raster present");

    /* 6. reset drops everything, no leaks, no double-free (stub guards). */
    lume_svg_cache_reset();
    CHECK(lume_svg_cache_count() == 0 && lume_svg_cache_bytes() == 0, "reset empties the cache");
    CHECK(!get_src(A, strlen(A), 320, 320, 51, &w, &h, &a), "post-reset lookup is a miss");
    CHECK(s_live == 0, "no SPIRAM bytes leaked after reset (allocs=%zu frees=%zu)",
          s_allocs, s_frees);

    /* 7. degenerate inputs never crash. */
    CHECK(!lume_svg_cache_get((uint8_t *)"", 0, 0, 0, &px, &w, &h, &a),
          "zero-length source is a miss");
    CHECK(lume_svg_cache_put((uint8_t *)A, strlen(A), 0, 0, (const uint8_t *)"x", 0, 0, 0) < 0,
          "zero-size raster is rejected");

    printf("svg_cache_test: %s (allocs=%zu frees=%zu live=%zu)\n",
           g_fail ? "FAIL" : "ALL CHECKS PASSED", s_allocs, s_frees, s_live);
    return g_fail ? 1 : 0;
}
