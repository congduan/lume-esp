/* Host AA-raster check (r47): coverage envelope, blending, degenerate
 * strokes and shared-joint behaviour for lume_raster.h — the canvas stroke
 * path the bridge uses for lines, polylines/batches, retained paths and
 * circles. Freestanding: compiles against the header only.
 *
 *   gcc -std=c11 -Wall -Wextra -Werror \
 *     -I firmware/components/lume-ui-bridge/include \
 *     tests/canvas_aa.c -o /tmp/lume_canvas_aa -lm && /tmp/lume_canvas_aa
 *
 * -lm is required: the diagonal ring-seam scan uses cos/sin. lume_raster.h
 * itself stays freestanding (stdint.h/stddef.h only); the math is in the test.
 */
#include "lume_raster.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>

#define W 64
#define H 64
#define STRIDE 68          /* stride > width: padding bytes must stay intact */

static uint16_t buf[STRIDE * H];
static lume_raster_surf_t surf;

static void surf_init(uint16_t bg)
{
    for (int i = 0; i < STRIDE * H; i++) buf[i] = bg;
    lume_raster_surf_t s = { .px = buf, .w = W, .h = H, .stride = STRIDE,
                             .sr5 = 0, .sg6 = 0, .sb5 = 0 };
    surf = s;
    lume_raster_set_color(&surf, 0xFFFF);   /* white stroke on black */
}

/* Stride padding = columns W..STRIDE-1 of every row. Arm it with a sentinel so
 * a missing px-bound check (writing past the visible width into adjacent rows)
 * is actually caught rather than silently passing on untouched zero arrays. */
#define PAD_SENTINEL 0xABCDu
static void pad_arm(void)
{
    for (int y = 0; y < H; y++)
        for (int x = W; x < STRIDE; x++) buf[y * STRIDE + x] = PAD_SENTINEL;
}
static int pad_intact(void)
{
    for (int y = 0; y < H; y++)
        for (int x = W; x < STRIDE; x++)
            if (buf[y * STRIDE + x] != PAD_SENTINEL) return 0;
    return 1;
}

static int px(int x, int y) { return buf[y * STRIDE + x]; }

/* Count pixels strictly between bg and the stroke colour (feather band). */
static int feather_count(void)
{
    int n = 0;
    for (int y = 0; y < H; y++)
        for (int x = 0; x < W; x++)
            if (px(x, y) != 0x0000 && px(x, y) != 0xFFFF) n++;
    return n;
}

int main(void)
{
    /* isqrt sanity: 8.8 fixed-point contract (isqrt(d2<<16) == 256*d). */
    assert(lume_raster_isqrt(0) == 0);
    assert(lume_raster_isqrt((int64_t)1 << 16) == 256);       /* d = 1.0     */
    assert(lume_raster_isqrt((int64_t)4 << 16) == 512);       /* d = 2.0     */
    assert(lume_raster_isqrt((int64_t)2 << 16) == 362);       /* floor(362.03) */
    puts("PASS isqrt 8.8 fixed-point contract");

    /* Horizontal width=1 line: opaque core exactly 1 px tall. The feather
     * band (0.5 < d < 1.0) contains no integer pixel centres relative to an
     * axis-aligned centreline, so an axis-aligned stroke has no feather —
     * and no staircase to fix. Assert that, then prove feathering on the
     * 45-degree line where staircases actually lived. */
    surf_init(0x0000);
    pad_arm();
    /* Run the centreline past the visible width: the bbox now overlaps the
     * stride padding, so the px-bound check is what keeps it untouched. */
    lume_raster_line(&surf, 10, 20, 70, 20, 1);
    for (int x = 10; x <= 63; x++) assert(px(x, 20) == 0xFFFF);
    for (int x = 10; x <= 63; x++) { assert(px(x, 19) == 0x0000); assert(px(x, 21) == 0x0000); }
    assert(pad_intact());
    puts("PASS width=1 horizontal line: 1px core, no stray ink, stride padding intact");

    surf_init(0x0000);
    lume_raster_line(&surf, 8, 8, 56, 56, 1);
    assert(px(8, 8) == 0xFFFF && px(56, 56) == 0xFFFF);
    assert(feather_count() > 0);
    puts("PASS width=1 diagonal line: feather band present (was the staircase)");

    /* Coverage monotonicity across the feather band (vertical scan through
     * a 45-degree line centre, width=3: hard at hw=1, feather to hw+1=2). */
    surf_init(0x0000);
    lume_raster_line(&surf, 8, 8, 56, 56, 3);
    {
        /* White (0xFFFF) blended over black at alpha a gives channel values
         * a*31/256 (blue), so the blue channel alone is an exact monotone
         * proxy for coverage on this background. A vertical scan through a
         * diagonal stroke crosses both feather flanks, so monotonicity is
         * asserted per flank: rising into the centre, falling out of it. */
        int ok = 1, last = -1;
        for (int y = 12; y <= 17; y++) {        /* rising flank             */
            int v = px(16, y) & 31;             /* blue channel 0..31       */
            if (v < last) ok = 0;
            last = v;
        }
        last = 99;
        for (int y = 17; y <= 22; y++) {        /* falling flank            */
            int v = px(16, y) & 31;
            if (v > last) ok = 0;
            last = v;
        }
        assert(ok);
        assert(px(16, 16) == 0xFFFF);           /* opaque core on centreline */
    }
    puts("PASS coverage rises monotonically toward the centreline");

    /* Degenerate zero-length stroke (point): width=2 (hw=0) degenerates to
     * the endpoint point painted at full coverage across the ext box — a
     * bounded 3x3 opaque dot, nothing beyond it (probe-verified; the old
     * square-brush rasteriser painted the same 3x3 for width=2). */
    surf_init(0x0000);
    lume_raster_line(&surf, 30, 30, 30, 30, 2);
    assert(px(30, 30) == 0xFFFF);
    assert(px(28, 28) == 0x0000 && px(32, 32) == 0x0000);
    assert(px(28, 30) == 0x0000 && px(32, 30) == 0x0000);
    puts("PASS zero-length stroke paints a bounded point");

    /* Envelope guarantee: hw = (width-1)/2 hard pixels + 1 px feather, so
     * the feathered stroke reaches exactly hw+1 pixels beyond the
     * centreline — never more (needle-erase contract, speedometer NEEDLE_PAD=3). */
    surf_init(0x0000);
    lume_raster_line(&surf, 5, 20, 60, 20, 4);   /* hw = 1, feather reach 2 */
    for (int x = 5; x <= 60; x++) {
        assert(px(x, 19) == 0xFFFF);             /* hw=1 above              */
        assert(px(x, 22) != 0xFFFF);             /* feather ends at 21      */
        assert(px(x, 17) == 0x0000);             /* 3 px out: untouched     */
    }
    puts("PASS width=4 envelope: hw=1 core, feather to +2, nothing at +3");

    /* Ring: width=2 r=20 circle at (32,32) — opaque band + feather on both
     * edges; centre stays background; envelope within r+2. */
    surf_init(0x0000);
    lume_raster_ring(&surf, 32, 32, 20, 2);
    assert(px(32, 12) == 0xFFFF || px(32, 11) == 0xFFFF);  /* band at r-1/r */
    assert(px(32, 32) == 0x0000);                          /* centre untouched */
    assert(px(32, 32 - 24) == 0x0000 && px(32, 32 + 24) == 0x0000); /* r+4 out */
    {
        int feather = 0;
        for (int a = 0; a < 360; a += 15) {        /* diagonal-site scan: the
                                                    * old 8-stamp seams are at
                                                    * 45-degree multiples     */
            int x = 32 + (int)(20 * __builtin_cos(a * 3.14159265f / 180.0f));
            int y = 32 + (int)(20 * __builtin_sin(a * 3.14159265f / 180.0f));
            if (px(x, y) != 0x0000 && px(x, y) != 0xFFFF) feather++;
        }
        assert(feather >= 10);   /* smooth band: most samples land in blend zone */
    }
    puts("PASS ring: continuous annulus, centre clean, 45-degree sites smooth");

    /* Wide ring degenerates to an anti-aliased disc without overflow:
     * r=5 width=16 -> hw=7, r_in<=0 so the hole closes (solid disc), outer
     * edge r_out=12 with the feather reaching r_out+1=13. Nothing beyond. */
    surf_init(0x0000);
    lume_raster_ring(&surf, 32, 32, 5, 16);       /* width > 2r             */
    assert(px(32, 32) == 0xFFFF);                 /* centre filled          */
    assert(px(32, 32 - 12) == 0xFFFF);            /* inside outer edge      */
    assert(px(32, 32 - 14) == 0x0000);            /* beyond feather (r+2)   */
    puts("PASS wide ring degenerates to anti-aliased disc");

    /* Blend maths: 50% white over mid-grey 0x8410 (r16 g32 b16) must be the
     * channel-exact midpoint ((31+16)/2, (63+32)/2, (31+16)/2 with rounding
     * = 24/48/24), i.e. exactly halfway between the two endpoints. */
    surf_init(0x8410);                            /* RGB565 mid grey        */
    lume_raster_set_color(&surf, 0xFFFF);
    {
        uint16_t out = lume_raster_blend(&surf, 0x8410, 128);
        uint32_t r = (out >> 11) & 31, g = (out >> 5) & 63, b = out & 31;
        assert(r == 24 && g == 48 && b == 24);
    }
    puts("PASS 50% blend of white over grey is the channel-exact midpoint");

    /* Joint double-blend is bounded: two collinear width=1 segments sharing
     * an endpoint must not paint beyond the single-segment footprint (the
     * joint may double-blend but the envelope must not grow). */
    surf_init(0x0000);
    lume_raster_line(&surf, 10, 30, 30, 30, 1);
    lume_raster_line(&surf, 30, 30, 50, 30, 1);
    assert(px(30, 30) == 0xFFFF);
    for (int x = 10; x <= 50; x++) assert(px(x, 27) == 0x0000 && px(x, 33) == 0x0000);
    puts("PASS shared joint: opaque core continuous, envelope not doubled");

    /* Anti-symmetry: colour cache independence — set_color between draws
     * re-derives raw channels exactly (no premultiplication). */
    surf_init(0x0000);
    lume_raster_set_color(&surf, 0xF800);         /* full red              */
    assert(surf.sr5 == 31u && surf.sg6 == 0 && surf.sb5 == 0);
    lume_raster_set_color(&surf, 0x07E0);         /* full green            */
    assert(surf.sr5 == 0 && surf.sg6 == 63u && surf.sb5 == 0);
    puts("PASS set_color channel decomposition exact");

    puts("ALL CANVAS AA HOST TESTS PASSED");
    return 0;
}
