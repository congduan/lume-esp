/* r183: raster-result cache for the SVG decode branch.
 *
 * Why only SVG: lume_image_decode_ex() renders SVG with lume_svg_render() on
 * every call (r180 measured 228/268 ms per 320x320 glyph under esp32sim), while
 * PNG/JPEG decode is already millisecond-scale. Caching the latter would only
 * burn scarce SPIRAM, so callers gate both functions with lume_svg_detect().
 *
 * Ownership proof (read before changing): lume_ui_bridge.c apply_image_source()
 * stores image_pixels in s_image_pixels[id], installs it as LVGL image data and
 * heap_caps_free()s the previous buffer; release_dead_images() frees it when the
 * node dies. The bridge is therefore the sole owner of a posted buffer. The
 * cache never hands out its own buffer: a hit allocates and returns a fresh
 * SPIRAM copy. This is the memcpy-on-hit option rather than refcounting, which
 * would require changing the bridge ABI/implementation for a ~300 KB copy that
 * is microseconds against the ~hundreds of milliseconds of SVG rasterisation.
 *
 * Heap prototypes are declared locally (identical to esp_heap_caps.h) so this
 * exact source also compiles under plain gcc for tests/svg_cache.js. The value
 * of MALLOC_CAP_SPIRAM is 1<<10 per esp-idf/components/heap/include/esp_heap_caps.h.
 */
#include "lume_svg_cache.h"
#include <string.h>

#ifndef MALLOC_CAP_SPIRAM
#define MALLOC_CAP_SPIRAM (1u << 10)
#endif
void *heap_caps_malloc(size_t size, uint32_t caps);
void heap_caps_free(void *ptr);

#define LUME_SVG_CACHE_MAX_ENTRIES 4
#define LUME_SVG_CACHE_MAX_BYTES   ((size_t)1 << 20) /* 1 MiB raster budget */

typedef struct {
    uint32_t hash;
    size_t len;              /* source length, part of the key */
    uint16_t tw, th;         /* target size, part of the key */
    uint8_t *src;            /* SPIRAM copy of source bytes, collision guard */
    uint8_t *pixels;         /* SPIRAM raster (RGB565 plane + optional A8) */
    size_t bytes;            /* allocated size of pixels */
    uint16_t w, h;
    uint8_t alpha;
    uint32_t last;           /* LRU tick */
    uint8_t used;
} svg_cache_entry_t;

static svg_cache_entry_t s_entries[LUME_SVG_CACHE_MAX_ENTRIES];
static uint32_t s_tick;
static size_t s_bytes;

static uint32_t fnv1a(const uint8_t *b, size_t n)
{
    uint32_t h = 2166136261u;
    for (size_t i = 0; i < n; i++) { h ^= b[i]; h *= 16777619u; }
    return h;
}

static void drop_entry(svg_cache_entry_t *e)
{
    if (e->pixels) heap_caps_free(e->pixels);
    if (e->src) heap_caps_free(e->src);
    s_bytes -= e->bytes;
    memset(e, 0, sizeof(*e));
}

static int evict_lru(void)
{
    svg_cache_entry_t *victim = NULL;
    for (int i = 0; i < LUME_SVG_CACHE_MAX_ENTRIES; i++) {
        svg_cache_entry_t *e = &s_entries[i];
        if (e->used && (!victim || e->last < victim->last)) victim = e;
    }
    if (!victim) return 0;
    drop_entry(victim);
    return 1;
}

static svg_cache_entry_t *find_entry(uint32_t hash, const uint8_t *bytes, size_t len,
                                     uint16_t tw, uint16_t th)
{
    for (int i = 0; i < LUME_SVG_CACHE_MAX_ENTRIES; i++) {
        svg_cache_entry_t *e = &s_entries[i];
        if (!e->used || e->hash != hash || e->len != len ||
            e->tw != tw || e->th != th) continue;
        if (memcmp(e->src, bytes, len) != 0) continue;
        return e;
    }
    return NULL;
}

int lume_svg_cache_get(const uint8_t *bytes, size_t len, uint16_t tw, uint16_t th,
                       uint8_t **pixels, uint16_t *w, uint16_t *h, uint8_t *alpha)
{
    if (!pixels || !w || !h || !alpha || !bytes || !len) return 0;
    svg_cache_entry_t *e = find_entry(fnv1a(bytes, len), bytes, len, tw, th);
    if (!e) return 0;
    uint8_t *copy = heap_caps_malloc(e->bytes, MALLOC_CAP_SPIRAM);
    if (!copy) return 0; /* copy failed: report a miss, caller decodes fully */
    memcpy(copy, e->pixels, e->bytes);
    *pixels = copy; *w = e->w; *h = e->h; *alpha = e->alpha;
    e->last = ++s_tick;
    return 1;
}

int lume_svg_cache_put(const uint8_t *bytes, size_t len, uint16_t tw, uint16_t th,
                       const uint8_t *pixels, uint16_t w, uint16_t h, uint8_t alpha)
{
    if (!bytes || !len || !pixels || !w || !h) return -1;
    size_t need = (size_t)w * h * (alpha ? 3u : 2u);
    if (need == 0 || need > LUME_SVG_CACHE_MAX_BYTES) return -2;

    uint32_t hash = fnv1a(bytes, len);
    svg_cache_entry_t *same = find_entry(hash, bytes, len, tw, th);
    if (same) { same->last = ++s_tick; return 0; } /* identical key: keep raster */

    svg_cache_entry_t *slot = NULL;
    for (int i = 0; i < LUME_SVG_CACHE_MAX_ENTRIES; i++)
        if (!s_entries[i].used) { slot = &s_entries[i]; break; }
    while (!slot || s_bytes + need > LUME_SVG_CACHE_MAX_BYTES) {
        if (!evict_lru()) return -3;
        if (!slot)
            for (int i = 0; i < LUME_SVG_CACHE_MAX_ENTRIES; i++)
                if (!s_entries[i].used) { slot = &s_entries[i]; break; }
    }

    uint8_t *px = heap_caps_malloc(need, MALLOC_CAP_SPIRAM);
    if (!px) return -3;
    uint8_t *src = heap_caps_malloc(len, MALLOC_CAP_SPIRAM);
    if (!src) { heap_caps_free(px); return -3; }
    memcpy(px, pixels, need);
    memcpy(src, bytes, len);

    slot->hash = hash; slot->len = len; slot->tw = tw; slot->th = th;
    slot->src = src; slot->pixels = px; slot->bytes = need;
    slot->w = w; slot->h = h; slot->alpha = alpha;
    slot->last = ++s_tick; slot->used = 1;
    s_bytes += need;
    return 0;
}

void lume_svg_cache_reset(void)
{
    for (int i = 0; i < LUME_SVG_CACHE_MAX_ENTRIES; i++)
        if (s_entries[i].used) drop_entry(&s_entries[i]);
    s_tick = 0;
}

size_t lume_svg_cache_bytes(void) { return s_bytes; }
int lume_svg_cache_count(void)
{
    int n = 0;
    for (int i = 0; i < LUME_SVG_CACHE_MAX_ENTRIES; i++) if (s_entries[i].used) n++;
    return n;
}
