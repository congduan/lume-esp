/*
 * lume_raster.h — anti-aliased stroke rasteriser for canvas draw ops (r47).
 *
 * Rendering backlog item 1 (docs/roadmap.md): canvas_line() stamped an
 * axis-aligned square brush along an integer Bresenham centreline and
 * canvas_disc() wrote pure colour, so every stroke edge was a hard 1 px
 * staircase — a 4-5 px stroke turned into 4-5 px steps, which is what made
 * gauge arcs look blocky. Sampling density was never the problem (at r=158 a
 * 2 deg step is a 5.5 px chord with a 0.024 px sagitta), so the fix is
 * per-pixel coverage, not finer polylines.
 *
 * Coverage model (all integer, no float, no per-pixel sqrt):
 *   distance d from the pixel to the stroke centreline (exact point-to-
 *   segment distance, endpoint-clamped — the cap is the round end of the
 *   segment), coverage full for d <= hw, zero for d >= hw+1, linear in
 *   between (1 px feather). hw = (width-1)/2 keeps the previous envelope:
 *   the painted band is width-1 hard pixels plus a 1 px feather on each
 *   side, i.e. total width+1.
 * Rings replace the old eight-stamp circle (which double-covered the four
 * diagonal stamp sites, leaving visible seam bumps): coverage from the band
 * distance |d - R| against the same hw/feather rule, so a ring is one
 * continuous annulus with a smooth inner and outer edge.
 *
 * Blending is RGB565 (the canvas buffer format): channels are extracted,
 * mixed at alpha/256 precision with a rounding shift, and repacked. A fully
 * covered pixel short-circuits to an opaque store, so opaque interiors are
 * bit-identical to the old rasteriser — the needle-erase contract in
 * examples/speedometer (opaque fillRect under a repaint) is untouched.
 *
 * Feeding the algorithm with both segment endpoints again on shared joints
 * (polylines arrive as separate two-point ops) can double-blend the joint
 * pixel when both sides are partial: blend(blend(bg,a1),a2) instead of a
 * clamped union. Opaque cores are unaffected; partial-over-partial differs
 * by at most one feather pixel at joints — far less visible than the dark
 * seam it replaces. Recorded in docs/KNOWN-SIMPLIFICATIONS.md (r47).
 *
 * Header-only and freestanding on purpose: tests/canvas_aa.c compiles it
 * directly on the host (gcc -I firmware/components/lume-ui-bridge/include)
 * and exercises coverage, blending, seams and stride handling without the
 * bridge or LVGL. Only <stdint.h> is required.
 */
#ifndef LUME_RASTER_H
#define LUME_RASTER_H

#include <stdint.h>
#include <stddef.h>   /* size_t: freestanding host compiles need it explicit */

/* Max stroke width accepted by the prelude is 16 (canvasInt clamp), so the
 * feathered envelope per row/column is hw+1 <= 9 pixels on either side of
 * the centreline. Kept as a named bound for the host assertions. */
#define LUME_RASTER_MAX_HW 8

typedef struct {
    uint16_t *px;      /* RGB565 pixels, row-major                         */
    int32_t w, h;      /* visible size in pixels                           */
    uint32_t stride;   /* pixels per row (>= w; padding must stay intact)  */
    uint16_t color;    /* stroke colour, RGB565                            */
    uint16_t sr5, sg6, sb5; /* colour channels premultiplied by 256        */
} lume_raster_surf_t;

/* floor(sqrt(v)) for 0 <= v < 2^62, classic restoring square root in 64
 * bits. Callers pass d2 << 16 to get the distance in 8.8 fixed point
 * (isqrt(d2*65536) == 256*d), which preserves sub-pixel resolution for the
 * 1 px feather — a plain integer isqrt(d2) quantises every feather pixel to
 * the same value and erases the feather entirely. */
static inline int32_t lume_raster_isqrt(int64_t v)
{
    int64_t root = 0, bit = (int64_t)1 << 62;
    while (bit > v) bit >>= 2;
    while (bit) {
        if (v >= root + bit) { v -= root + bit; root = (root >> 1) + bit; }
        else root >>= 1;
        bit >>= 2;
    }
    return (int32_t)root;
}

static inline void lume_raster_set_color(lume_raster_surf_t *s, uint16_t c)
{
    s->color = c;
    s->sr5 = (uint16_t)((c >> 11) & 31u);
    s->sg6 = (uint16_t)((c >> 5) & 63u);
    s->sb5 = (uint16_t)(c & 31u);
}

/* dst over-blended with the stroke colour at alpha a (0..256). Channels are
 * raw 5/6/5 values: (src*a + dst*(256-a)) >> 8, with a rounding half. */
static inline uint16_t lume_raster_blend(const lume_raster_surf_t *s,
                                         uint16_t dst, int32_t a)
{
    uint32_t dr = (dst >> 11) & 31u, dg = (dst >> 5) & 63u, db = dst & 31u;
    uint32_t r = ((uint32_t)s->sr5 * (uint32_t)a + dr * (256u - (uint32_t)a) + 128u) >> 8;
    uint32_t g = ((uint32_t)s->sg6 * (uint32_t)a + dg * (256u - (uint32_t)a) + 128u) >> 8;
    uint32_t b = ((uint32_t)s->sb5 * (uint32_t)a + db * (256u - (uint32_t)a) + 128u) >> 8;
    return (uint16_t)((r << 11) | (g << 5) | b);
}

/* Write one pixel of the stroke at coverage a (0..256). Pixels outside the
 * surface are dropped; the caller's bbox already keeps them rare. */
static inline void lume_raster_put(const lume_raster_surf_t *s,
                                   int32_t px, int32_t py, int32_t a)
{
    if (a <= 0 || px < 0 || py < 0 || px >= s->w || py >= s->h) return;
    uint16_t *p = s->px + (size_t)py * s->stride + px;
    *p = (a >= 256) ? s->color : lume_raster_blend(s, *p, a);
}

/* Anti-aliased stroked segment from (x0,y0) to (x1,y1), width >= 1.
 * Coverage per pixel from the exact point-to-segment distance with a 1 px
 * feather; fully covered pixels store the stroke colour opaquely.
 *
 * Distances are carried in 8.8 fixed point: rounding the closest centreline
 * point to an integer pixel would make every squared distance an integer,
 * and for hw = 0 (width 1-2) the feather band 0 < d < 1 would then contain
 * no pixel centre at all — the stroke would rasterise hard-edged again.
 * Sub-pixel q keeps the feather alive at every width. */
static void lume_raster_line(const lume_raster_surf_t *s,
                             int32_t x0, int32_t y0, int32_t x1, int32_t y1,
                             int32_t width)
{
    if (width < 1) return;
    int32_t hw = (width - 1) >> 1;
    int32_t ext = hw + 1;                       /* feather reaches hw+1 out  */
    int32_t vx = x1 - x0, vy = y1 - y0;
    int32_t len2 = vx * vx + vy * vy;
    int32_t rx0 = (x0 < x1 ? x0 : x1) - ext, rx1 = (x0 < x1 ? x1 : x0) + ext;
    int32_t ry0 = (y0 < y1 ? y0 : y1) - ext, ry1 = (y0 < y1 ? y1 : y0) + ext;
    int64_t opaque2 = (int64_t)(hw << 8) * (hw << 8);   /* d <= hw: full     */
    int64_t zero2 = (int64_t)((hw + 1) << 8) * ((hw + 1) << 8); /* d >= hw+1 */
    int32_t hw8 = hw << 8;
    for (int32_t py = ry0; py <= ry1; py++) {
        if (py < 0 || py >= s->h) continue;
        uint16_t *row = s->px + (size_t)py * s->stride;
        for (int32_t px = rx0; px <= rx1; px++) {
            if (px < 0 || px >= s->w) continue;
            int32_t dx8, dy8;                   /* pixel minus closest point, 8.8 */
            if (len2 == 0) { dx8 = 0; dy8 = 0; }
            else {
                int32_t t = (px - x0) * vx + (py - y0) * vy;
                if (t <= 0) { dx8 = (px - x0) << 8; dy8 = (py - y0) << 8; }
                else if (t >= len2) { dx8 = (px - x1) << 8; dy8 = (py - y1) << 8; }
                else {
                    /* q = p0 + v * t/len2 in 8.8 (64-bit intermediate)     */
                    int32_t qx8 = (x0 << 8) + (int32_t)(((int64_t)vx * t << 8) / len2);
                    int32_t qy8 = (y0 << 8) + (int32_t)(((int64_t)vy * t << 8) / len2);
                    dx8 = (px << 8) - qx8;
                    dy8 = (py << 8) - qy8;
                }
            }
            int64_t d2 = (int64_t)dx8 * dx8 + (int64_t)dy8 * dy8;
            if (d2 >= zero2) continue;
            int32_t a;
            if (d2 <= opaque2) a = 256;
            else a = 256 - ((int32_t)lume_raster_isqrt(d2) - hw8);
            uint16_t *p = row + px;
            *p = (a >= 256) ? s->color : lume_raster_blend(s, *p, a);
        }
    }
}

/* Anti-aliased ring (annulus stroke) of radius r and stroke width.
 * Band distance |d - r| against the same hw/1px-feather rule as lines, so
 * line joints and circle strokes feather identically. A width wider than
 * the diameter degenerates to an anti-aliased disc. Replaces the r46-and-
 * earlier eight-stamp circle, whose diagonal stamps double-covered. */
static void lume_raster_ring(const lume_raster_surf_t *s,
                             int32_t cx, int32_t cy, int32_t r, int32_t width)
{
    if (r < 0 || width < 1) return;
    int32_t hw = (width - 1) >> 1;
    int32_t r_in = r - hw;                      /* inner edge (may be <= 0)  */
    int32_t r_out = r + hw;                     /* outer edge                */
    int32_t ext = r_out + 1;                    /* outer feather reach       */
    /* 8.8 fixed point, same sub-pixel reasoning as lume_raster_line: an
     * integer d2 would quantise the feather to nothing at hw = 0. */
    int64_t out2 = (int64_t)(r_out << 8) * (r_out << 8);
    int64_t outzero2 = (int64_t)((r_out + 1) << 8) * ((r_out + 1) << 8);
    int64_t in2 = r_in > 0 ? (int64_t)(r_in << 8) * (r_in << 8) : 0;
    int64_t hole2 = r_in > 1 ? (int64_t)((r_in - 1) << 8) * ((r_in - 1) << 8) : 0;
    int32_t rout8 = r_out << 8, rinm8 = (r_in - 1) << 8;
    for (int32_t py = cy - ext; py <= cy + ext; py++) {
        if (py < 0 || py >= s->h) continue;
        int32_t dy8 = (py - cy) << 8;
        uint16_t *row = s->px + (size_t)py * s->stride;
        for (int32_t px = cx - ext; px <= cx + ext; px++) {
            if (px < 0 || px >= s->w) continue;
            int32_t dx8 = (px - cx) << 8;
            int64_t d2 = (int64_t)dx8 * dx8 + (int64_t)dy8 * dy8;
            int32_t a;
            if (d2 >= outzero2) continue;
            if (d2 > out2)                       /* outer feather            */
                a = 256 - ((int32_t)lume_raster_isqrt(d2) - rout8);
            else if (r_in > 0 && d2 < hole2) continue;   /* inner hole      */
            else if (r_in > 1 && d2 < in2)       /* inner feather            */
                a = (int32_t)lume_raster_isqrt(d2) - rinm8;
            else a = 256;                        /* full band                */
            uint16_t *p = row + px;
            *p = (a >= 256) ? s->color : lume_raster_blend(s, *p, a);
        }
    }
}

#endif /* LUME_RASTER_H */
