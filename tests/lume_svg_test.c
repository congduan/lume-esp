#include "lume_svg.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#define SVG(x) (const uint8_t *)(x), strlen(x)
static uint8_t alpha(const uint8_t *p, int w, int x, int y) {
  return p[4 * ((size_t)y * w + x) + 3];
}
static void test(const char *name, const char *src, int w, int h, int x,
                 int y) {
  uint8_t *p = NULL;
  uint16_t rw = 0, rh = 0;
  assert(lume_svg_render(SVG(src), w, h, &p, &rw, &rh) == 0);
  assert(rw == w && rh == h && alpha(p, w, x, y) > 0);
  free(p);
  printf("PASS %s\n", name);
}
int main(void) {
  uint16_t w = 0, h = 0;
  uint8_t *p = NULL;
  const char *rect = "<svg width='20' height='20'><rect x='2' y='2' width='16' "
                     "height='16' fill='#f00'/></svg>";
  assert(lume_svg_size(SVG(rect), &w, &h) == 0 && w == 20 && h == 20);
  test("rect and hex fill", rect, 20, 20, 10, 10);
  test("circle and color name",
       "<svg width='20' height='20'><circle cx='10' cy='10' r='8' "
       "fill='blue'/></svg>",
       20, 20, 10, 10);
  test("ellipse and rgb",
       "<svg width='20' height='20'><ellipse cx='10' cy='10' rx='7' ry='4' "
       "fill='rgb(0,255,0)'/></svg>",
       20, 20, 10, 10);
  test("polygon even odd",
       "<svg width='20' height='20'><polygon points='1,1 19,1 19,19 1,19' "
       "fill='orange'/></svg>",
       20, 20, 10, 10);
  test("path cubic quadratic arc",
       "<svg width='40' height='40'><path d='M 2 2 C 15 2 25 2 38 2 Q 38 15 38 "
       "20 A 18 18 0 0 1 2 20 Z' fill='#0f0'/></svg>",
       40, 40, 20, 10);
  test("smooth curves and relative arc",
       "<svg width='40' height='40'><path d='M 2 2 C 10 2 15 2 20 2 S 30 2 38 "
       "2 Q 38 10 38 20 T 2 20 a 18 18 0 0 1 0 -18 Z' fill='pink'/></svg>",
       40, 40, 20, 10);
  test("relative path and stroke",
       "<svg width='20' height='20'><path d='m 2 2 h 16 v 16 h -16 z' "
       "fill='none' stroke='red' stroke-width='2'/></svg>",
       20, 20, 2, 10);
  test("opacity and AA",
       "<svg width='20' height='20'><rect x='1.25' y='1.25' width='10' "
       "height='10' opacity='.5'/></svg>",
       20, 20, 5, 5);
  const char *vb =
      "<svg viewBox='0 0 32 16'><rect width='32' height='16'/></svg>";
  assert(lume_svg_size(SVG(vb), &w, &h) == 0 && w == 32 && h == 16);
  puts("PASS viewBox intrinsic size");
  assert(
      lume_svg_size(SVG("<svg width='50%' height='10pt' viewBox='0 0 32 16'/>"),
                    &w, &h) == 0 &&
      w == 32 && h == 16);
  puts("PASS unsupported units fall back to viewBox");
  const char *big = "<svg width='1024' height='512' viewBox='0 0 1024 "
                    "512'><rect width='1024' height='512'/></svg>";
  assert(lume_svg_size(SVG(big), &w, &h) == 0 && w == 1024 && h == 512);
  assert(lume_svg_render(SVG(big), 0, 0, &p, &w, &h) == 0 && w == 480 &&
         h == 240);
  free(p);
  assert(lume_svg_render(SVG(big), 200, 200, &p, &w, &h) == 0 && w == 200 &&
         h == 200);
  free(p);
  puts("PASS oversized intrinsic and explicit target");
  assert(lume_svg_render(SVG(vb), 40, 40, &p, &w, &h) == 0 && w == 40 &&
         h == 40);
  assert(alpha(p, 40, 20, 0) == 0 && alpha(p, 40, 20, 20) > 0 &&
         alpha(p, 40, 20, 39) == 0);
  free(p);
  puts("PASS viewBox meet centered letterbox");
  assert(lume_svg_render(SVG(vb), 481, 40, &p, &w, &h) == -2);
  puts("PASS raster bound");
  assert(lume_svg_size(SVG("<svg><rect width='2' height='2'/></svg>"), &w,
                       &h) == -2);
  puts("PASS missing intrinsic rejected");
  assert(lume_svg_size(SVG("\xef\xbb\xbf  <svg width='25px' height='5px'/>"),
                       &w, &h) == 0 &&
         w == 25 && h == 5);
  puts("PASS BOM whitespace px");
  return 0;
}
