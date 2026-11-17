#include "lume_raster.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>

#define W 64
#define H 64
#define S 68
static uint16_t pixels[S * H];
static lume_raster_surf_t surf = {.px=pixels, .w=W, .h=H, .stride=S};
static uint16_t at(int x, int y) { return pixels[y*S+x]; }
static void reset(void) { memset(pixels, 0, sizeof(pixels)); lume_raster_set_color(&surf, 0xffff); }
static void padding(void) { for (int y=0;y<H;y++) for (int x=W;x<S;x++) assert(at(x,y)==0); }

int main(void) {
    (void)lume_raster_line; (void)lume_raster_ring; (void)lume_raster_arc; (void)lume_raster_blit;
    reset(); lume_raster_fill_circle(&surf, 25,25,10);
    assert(at(25,25)==0xffff && at(0,0)==0);
    int aa=0; for (int y=10;y<40;y++) for (int x=10;x<40;x++) aa += at(x,y)>0 && at(x,y)<0xffff;
    assert(aa>0); puts("PASS filled circle center, exterior and AA edge");
    reset(); lume_raster_fill_ellipse(&surf,25,25,18,6);
    assert(at(40,25)==0xffff && at(25,35)==0 && at(25,25)==0xffff);
    aa=0; for (int y=0;y<H;y++) for (int x=0;x<W;x++) aa += at(x,y)>0 && at(x,y)<0xffff;
    assert(aa>0);
    puts("PASS non-square filled ellipse");
    reset(); lume_raster_ellipse_ring(&surf,25,25,18,8,3);
    assert(at(25,25)==0 && at(43,25)!=0 && at(25,33)!=0);
    assert(at(25,29)==0); /* width 3 does not fill four pixels inside */
    puts("PASS ellipse stroke and hollow center");
    reset(); lume_raster_ellipse_ring(&surf,25,25,18,8,1);
    assert(at(43,25)==0xffff && at(42,25)==0 && at(44,25)==0);
    puts("PASS width 1 is centred on the ellipse radius");
    reset(); lume_raster_fill_circle(&surf,-2,5,12);
    lume_raster_fill_ellipse(&surf,62,62,15,9);
    lume_raster_ellipse_ring(&surf,62,3,9,8,4);
    padding(); puts("PASS clipped primitives preserve stride padding");
    puts("canvas_prims: all cases PASS");
}
