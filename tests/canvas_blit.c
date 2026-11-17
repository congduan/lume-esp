/* Host sprite-blit check (r81): colour-key transparency, clipping, flip and
 * stride-padding behaviour of lume_raster_blit() in lume_raster.h — the
 * retained-sprite path the bridge uses for ctx.drawImage(). Freestanding:
 * compiles against the header only.
 *
 *   gcc -std=c11 -Wall -Wextra -Werror \
 *     -I firmware/components/lume-ui-bridge/include \
 *     tests/canvas_blit.c -o /tmp/lume_canvas_blit && /tmp/lume_canvas_blit
 */
#include "lume_raster.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>

#define W 16
#define H 16
#define STRIDE 20          /* stride > width: padding bytes must stay intact */

static uint16_t buf[STRIDE * H];
static uint16_t sprite[4 * 4];  /* 4x4 sprite, row-major */

static void reset(void)
{
    memset(buf, 0xA5, sizeof(buf));      /* sentinel incl. padding */
    memset(sprite, 0, sizeof(sprite));
}

static uint16_t px(int x, int y) { return buf[y * STRIDE + x]; }

int main(void)
{
    /* this test covers the blit; reference the stroke rasterisers so the
     * header-only statics never trip -Wunused-function under -Werror. */
    (void)lume_raster_line; (void)lume_raster_ring; (void)lume_raster_arc;
    /* 1. opaque copy: no key pixels, whole sprite lands */
    reset();
    for (int i = 0; i < 16; i++) sprite[i] = 0x1234;
    lume_raster_surf_t s = { .px = buf, .w = W, .h = H, .stride = STRIDE };
    lume_raster_blit(&s, sprite, 4, 4, 2, 3, 0);
    for (int y = 0; y < 4; y++)
        for (int x = 0; x < 4; x++)
            assert(px(2 + x, 3 + y) == 0x1234);
    assert(px(1, 3) == 0xA5A5 && px(6, 3) == 0xA5A5);   /* untouched around */
    for (int x = 0; x < W; x++) assert(px(x, H - 1) == 0xA5A5); /* padding intact */
    puts("PASS opaque 4x4 blit lands exactly at (2,3)");

    /* 2. colour key: 0x0000 pixels are skipped, background shows through */
    reset();
    for (int i = 0; i < 16; i++) sprite[i] = (i % 3 == 0) ? 0x0000 : 0x5678;
    lume_raster_blit(&s, sprite, 4, 4, 0, 0, 0);
    for (int y = 0; y < 4; y++)
        for (int x = 0; x < 4; x++) {
            uint16_t want = ((y * 4 + x) % 3 == 0) ? 0xA5A5 : 0x5678;
            assert(px(x, y) == want);
        }
    puts("PASS 0x0000 colour key is transparent");

    /* 3. clip: negative and overflowing destination stays inside the surface */
    reset();
    for (int i = 0; i < 16; i++) sprite[i] = 0x0F0F;
    lume_raster_blit(&s, sprite, 4, 4, -2, -2, 0);   /* top-left overflow */
    assert(px(0, 0) == 0x0F0F && px(1, 1) == 0x0F0F); /* last 2x2 lands */
    assert(px(2, 2) == 0xA5A5);                       /* beyond the sprite: no */
    lume_raster_blit(&s, sprite, 4, 4, W - 2, H - 2, 0); /* bottom-right overflow */
    assert(px(W - 2, H - 2) == 0x0F0F && px(W - 1, H - 1) == 0x0F0F);
    assert(px(W - 2, H - 4) == 0xA5A5);
    /* stride padding columns (x >= W) are never a destination, even for a
     * sprite whose right edge runs past the visible width. */
    for (int y = 0; y < H; y++)
        for (int x = W; x < STRIDE; x++) assert(px(x, y) == 0xA5A5);
    puts("PASS blit clips at all four surface edges");

    /* 4. flip: horizontal mirror reads the source row right-to-left */
    reset();
    for (int x = 0; x < 4; x++) sprite[x] = (uint16_t)(0x1111 + x); /* top row */
    lume_raster_blit(&s, sprite, 4, 4, 0, 0, 1);
    assert(px(0, 0) == 0x1114 && px(1, 0) == 0x1113);
    assert(px(2, 0) == 0x1112 && px(3, 0) == 0x1111);
    puts("PASS flip mirrors the sprite horizontally");

    /* 5. degenerate inputs are no-ops */
    reset();
    lume_raster_blit(&s, NULL, 4, 4, 0, 0, 0);
    lume_raster_blit(&s, sprite, 0, 4, 0, 0, 0);
    lume_raster_blit(&s, sprite, 4, 0, 0, 0, 0);
    for (int i = 0; i < STRIDE * H; i++) assert(buf[i] == 0xA5A5);
    puts("PASS NULL/zero-size blit is a no-op");

    /* 6. a sprite entirely off-surface is a pure no-op (all rows/cols clipped) */
    reset();
    for (int i = 0; i < 16; i++) sprite[i] = 0x0F0F;
    lume_raster_blit(&s, sprite, 4, 4, W + 5, H + 5, 0);   /* bottom-right past edge */
    lume_raster_blit(&s, sprite, 4, 4, -5, -5, 0);         /* top-left past edge */
    for (int i = 0; i < STRIDE * H; i++) assert(buf[i] == 0xA5A5);
    puts("PASS fully off-surface blit is a no-op");

    puts("canvas_blit: all cases PASS");
    return 0;
}
