#include <ctype.h>
#include <float.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifdef ESP_PLATFORM
#include "esp_heap_caps.h"
#ifndef LUME_SVG_MALLOC
#define LUME_SVG_MALLOC(n) heap_caps_malloc((n), MALLOC_CAP_SPIRAM)
#define LUME_SVG_FREE(p) heap_caps_free(p)
#endif
#endif
#include "lume_svg.h"

typedef struct {
  double x, y;
} pt;
typedef struct {
  pt a, b;
} edge;
typedef struct {
  edge *v;
  size_t n, cap;
  pt start, last;
  int closed, oom;
} path;
typedef struct {
  uint8_t r, g, b, a;
  int none;
} color;
typedef struct {
  color fill, stroke;
  double sw, opacity;
} style;
typedef struct {
  const char *s;
  size_t n, p;
} scan;
typedef struct {
  char name[32], val[128];
  const char *raw;
  size_t raw_len;
} attr;
typedef struct {
  attr a[16];
  int n, closing, self;
  char tag[32];
} token;
typedef struct {
  double x, y, w, h;
  int valid;
} box;
static int ws(char c) {
  return c == ' ' || c == '\t' || c == '\r' || c == '\n' || c == ',';
}
static void skip(scan *s) {
  while (s->p < s->n && ws(s->s[s->p]))
    s->p++;
}
static int number(scan *s, double *v) {
  skip(s);
  if (s->p >= s->n)
    return 0;
  size_t start = s->p, p = start;
  if (s->s[p] == '+' || s->s[p] == '-')
    p++;
  size_t digits = 0;
  while (p < s->n && isdigit((unsigned char)s->s[p])) {
    p++;
    digits++;
  }
  if (p < s->n && s->s[p] == '.') {
    p++;
    while (p < s->n && isdigit((unsigned char)s->s[p])) {
      p++;
      digits++;
    }
  }
  if (!digits)
    return 0;
  if (p < s->n && (s->s[p] == 'e' || s->s[p] == 'E')) {
    size_t exp = p++;
    if (p < s->n && (s->s[p] == '+' || s->s[p] == '-'))
      p++;
    size_t first = p;
    while (p < s->n && isdigit((unsigned char)s->s[p]))
      p++;
    if (p == first)
      p = exp;
  }
  if (p - start >= 64)
    return 0;
  char buf[64];
  memcpy(buf, s->s + start, p - start);
  buf[p - start] = 0;
  char *end;
  double d = strtod(buf, &end);
  if (end == buf || !isfinite(d) || fabs(d) > 1000000.0)
    return 0;
  s->p = p;
  *v = d;
  return 1;
}
static void copy(char *dst, size_t cap, const char *src, size_t n) {
  if (n >= cap)
    n = cap - 1;
  memcpy(dst, src, n);
  dst[n] = 0;
}
static int next(scan *s, token *t) {
  memset(t, 0, sizeof(*t));
  for (;;) {
    while (s->p < s->n && s->s[s->p] != '<')
      s->p++;
    if (s->p >= s->n)
      return 0;
    s->p++;
    if (s->p >= s->n || (s->s[s->p] != '!' && s->s[s->p] != '?'))
      break;
    while (s->p < s->n && s->s[s->p] != '>')
      s->p++;
    if (s->p < s->n)
      s->p++;
  }
  if (s->p < s->n && s->s[s->p] == '/') {
    t->closing = 1;
    s->p++;
  }
  skip(s);
  size_t a = s->p;
  while (s->p < s->n && (isalnum((unsigned char)s->s[s->p]) ||
                         s->s[s->p] == '-' || s->s[s->p] == ':'))
    s->p++;
  if (s->p == a)
    return -2;
  copy(t->tag, sizeof(t->tag), s->s + a, s->p - a);
  while (s->p < s->n) {
    skip(s);
    if (s->p >= s->n)
      return -2;
    if (s->s[s->p] == '>' || s->s[s->p] == '/') {
      if (s->s[s->p] == '/') {
        t->self = 1;
        s->p++;
      }
      if (s->p < s->n && s->s[s->p] == '>')
        s->p++;
      return 1;
    }
    a = s->p;
    while (s->p < s->n && !ws(s->s[s->p]) && s->s[s->p] != '=' &&
           s->s[s->p] != '>')
      s->p++;
    if (s->p == a)
      return -2;
    if (t->n >= 16)
      return -2;
    attr *at = &t->a[t->n++];
    copy(at->name, sizeof(at->name), s->s + a, s->p - a);
    skip(s);
    if (s->p >= s->n || s->s[s->p] != '=')
      return -2;
    s->p++;
    skip(s);
    if (s->p >= s->n)
      return -2;
    char quote = s->s[s->p];
    if (quote != '\'' && quote != '"')
      return -2;
    s->p++;
    a = s->p;
    while (s->p < s->n && s->s[s->p] != quote)
      s->p++;
    if (s->p >= s->n)
      return -2;
    at->raw = s->s + a;
    at->raw_len = s->p - a;
    copy(at->val, sizeof(at->val), at->raw, at->raw_len);
    s->p++;
  }
  return -2;
}
static const char *get(token *t, const char *key) {
  for (int i = 0; i < t->n; i++)
    if (!strcmp(t->a[i].name, key))
      return t->a[i].val;
  return NULL;
}
static attr *find_attr(token *t, const char *key) {
  for (int i = 0; i < t->n; i++)
    if (!strcmp(t->a[i].name, key))
      return &t->a[i];
  return NULL;
}
static int dim(const char *v, double *out) {
  if (!v)
    return 0;
  scan s = {v, strlen(v), 0};
  double d;
  if (!number(&s, &d) || d <= 0)
    return 0;
  if (s.p < s.n && !strncmp(s.s + s.p, "px", 2))
    s.p += 2;
  skip(&s);
  if (s.p != s.n)
    return 0;
  *out = d;
  return 1;
}
static box viewbox(const char *v) {
  box b = {0};
  if (!v)
    return b;
  scan s = {v, strlen(v), 0};
  if (number(&s, &b.x) && number(&s, &b.y) && number(&s, &b.w) &&
      number(&s, &b.h) && b.w > 0 && b.h > 0) {
    skip(&s);
    b.valid = s.p == s.n;
  }
  return b;
}
int lume_svg_detect(const uint8_t *bytes, size_t len) {
  if (!bytes)
    return 0;
  size_t p = 0;
  if (len >= 3 && bytes[0] == 0xef && bytes[1] == 0xbb && bytes[2] == 0xbf)
    p = 3;
  while (p < len && ws((char)bytes[p]))
    p++;
  return p < len && bytes[p] == '<';
}
static int root(const uint8_t *b, size_t n, token *t) {
  if (!lume_svg_detect(b, n))
    return -2;
  scan s = {(const char *)b, n, 0};
  int r;
  do {
    r = next(&s, t);
  } while (r == 1 && strcmp(t->tag, "svg"));
  return r == 1 && !t->closing ? 0 : -2;
}
int lume_svg_size(const uint8_t *b, size_t n, uint16_t *w, uint16_t *h) {
  if (!w || !h)
    return -1;
  token t;
  if (root(b, n, &t))
    return -2;
  box vb = viewbox(get(&t, "viewBox"));
  double x = 0, y = 0;
  if (!dim(get(&t, "width"), &x) && vb.valid)
    x = vb.w;
  if (!dim(get(&t, "height"), &y) && vb.valid)
    y = vb.h;
  if (x < 1 || y < 1 || x > 65535 || y > 65535)
    return -2;
  *w = (uint16_t)lround(x);
  *h = (uint16_t)lround(y);
  return *w && *h ? 0 : -2;
}
static color rgb(uint8_t r, uint8_t g, uint8_t b, uint8_t a) {
  color c = {r, g, b, a, 0};
  return c;
}
static color parsecolor(const char *v, color old) {
  if (!v)
    return old;
  if (!strcmp(v, "none")) {
    old.none = 1;
    return old;
  }
  if (v[0] == '#') {
    unsigned r, g, b;
    if (strlen(v) == 4 && sscanf(v + 1, "%1x%1x%1x", &r, &g, &b) == 3)
      return rgb(r * 17, g * 17, b * 17, 255);
    if (strlen(v) == 7 && sscanf(v + 1, "%2x%2x%2x", &r, &g, &b) == 3)
      return rgb(r, g, b, 255);
    return old;
  }
  if (!strncmp(v, "rgb(", 4)) {
    int r, g, b;
    if (sscanf(v + 4, "%d , %d , %d", &r, &g, &b) == 3 && r >= 0 && r <= 255 &&
        g >= 0 && g <= 255 && b >= 0 && b <= 255)
      return rgb(r, g, b, 255);
  }
  static const struct {
    const char *n;
    uint32_t v;
  } names[] = {
      {"black", 0},         {"white", 0xffffff},   {"red", 0xff0000},
      {"green", 0x008000},  {"blue", 0x0000ff},    {"yellow", 0xffff00},
      {"cyan", 0x00ffff},   {"magenta", 0xff00ff}, {"gray", 0x808080},
      {"orange", 0xffa500}, {"purple", 0x800080},  {"brown", 0xa52a2a},
      {"pink", 0xffc0cb},   {"transparent", 0}};
  for (size_t i = 0; i < sizeof(names) / sizeof(names[0]); i++)
    if (!strcmp(v, names[i].n)) {
      uint32_t n = names[i].v;
      return rgb(n >> 16, n >> 8, n, !strcmp(v, "transparent") ? 0 : 255);
    }
  return old;
}
static double attrnum(token *t, const char *name, double fallback) {
  const char *v = get(t, name);
  if (!v)
    return fallback;
  scan s = {v, strlen(v), 0};
  double d;
  return number(&s, &d) ? d : fallback;
}
static style styling(token *t, style parent) {
  const char *v = get(t, "fill");
  parent.fill = parsecolor(v, parent.fill);
  v = get(t, "stroke");
  parent.stroke = parsecolor(v, parent.stroke);
  parent.sw = attrnum(t, "stroke-width", parent.sw);
  parent.opacity *= attrnum(t, "opacity", 1);
  double fo = attrnum(t, "fill-opacity", 1),
         so = attrnum(t, "stroke-opacity", 1);
  parent.fill.a = (uint8_t)fmax(0, fmin(255, parent.fill.a * fo));
  parent.stroke.a = (uint8_t)fmax(0, fmin(255, parent.stroke.a * so));
  return parent;
}
static void line(path *p, pt b) {
  if (p->n == p->cap) {
    size_t cap = p->cap ? p->cap * 2 : 64;
    if (cap > 8192) {
      p->oom = 1;
      return;
    }
    edge *q = LUME_SVG_MALLOC(cap * sizeof(edge));
    if (!q) {
      p->oom = 1;
      return;
    }
    if (p->v) {
      memcpy(q, p->v, p->n * sizeof(edge));
      LUME_SVG_FREE(p->v);
    }
    p->v = q;
    p->cap = cap;
  }
  p->v[p->n++] = (edge){p->last, b};
  p->last = b;
}
static void move(path *p, pt b) { p->last = p->start = b; }
static void closepath(path *p) {
  if (p->last.x != p->start.x || p->last.y != p->start.y)
    line(p, p->start);
  p->closed = 1;
}
static pt P(double x, double y) {
  pt p = {x, y};
  return p;
}
static void cubic(path *p, pt a, pt b, pt c) {
  pt o = p->last;
  for (int i = 1; i <= 20; i++) {
    double t = i / 20.0, u = 1 - t;
    line(p, P(u * u * u * o.x + 3 * u * u * t * a.x + 3 * u * t * t * b.x +
                  t * t * t * c.x,
              u * u * u * o.y + 3 * u * u * t * a.y + 3 * u * t * t * b.y +
                  t * t * t * c.y));
  }
}
static void quad(path *p, pt a, pt b) {
  pt o = p->last;
  for (int i = 1; i <= 16; i++) {
    double t = i / 16.0, u = 1 - t;
    line(p, P(u * u * o.x + 2 * u * t * a.x + t * t * b.x,
              u * u * o.y + 2 * u * t * a.y + t * t * b.y));
  }
}
static int pair(scan *s, double *x, double *y) {
  return number(s, x) && number(s, y);
}
static int arc_flag(scan *s, double *v) {
  skip(s);
  if (s->p >= s->n || (s->s[s->p] != '0' && s->s[s->p] != '1'))
    return 0;
  *v = s->s[s->p++] - '0';
  return 1;
}
static int pathdata(path *p, const attr *d) {
  if (!d)
    return -2;
  scan s = {d->raw, d->raw_len, 0};
  char cmd = 0, prev = 0;
  pt ctrl = P(0, 0);
  int steps = 0;
  while (1) {
    skip(&s);
    if (s.p >= s.n)
      break;
    if (++steps > 8192)
      return -2;
    if (isalpha((unsigned char)s.s[s.p]))
      cmd = s.s[s.p++];
    else if (!cmd)
      return -2;
    int rel = islower((unsigned char)cmd);
    char op = (char)toupper((unsigned char)cmd);
    double x = 0, y = 0, z = 0, q = 0;
    pt end;
    if (op == 'Z') {
      closepath(p);
      prev = cmd;
      cmd = 0;
      continue;
    }
    if (op == 'M' || op == 'L' || op == 'T') {
      if (!pair(&s, &x, &y))
        return -2;
      end = P(x + (rel ? p->last.x : 0), y + (rel ? p->last.y : 0));
      if (op == 'M') {
        move(p, end);
        cmd = rel ? 'l' : 'L';
      } else if (op == 'T') {
        pt c = (toupper((unsigned char)prev) == 'Q' ||
                toupper((unsigned char)prev) == 'T')
                   ? P(2 * p->last.x - ctrl.x, 2 * p->last.y - ctrl.y)
                   : p->last;
        quad(p, c, end);
        ctrl = c;
      } else
        line(p, end);
    } else if (op == 'H' || op == 'V') {
      if (!number(&s, &x))
        return -2;
      end = op == 'H' ? P(x + (rel ? p->last.x : 0), p->last.y)
                      : P(p->last.x, x + (rel ? p->last.y : 0));
      line(p, end);
    } else if (op == 'C' || op == 'S' || op == 'Q') {
      pt a, b;
      if (op == 'S') {
        a = (toupper((unsigned char)prev) == 'C' ||
             toupper((unsigned char)prev) == 'S')
                ? P(2 * p->last.x - ctrl.x, 2 * p->last.y - ctrl.y)
                : p->last;
      } else {
        if (!pair(&s, &x, &y))
          return -2;
        a = P(x + (rel ? p->last.x : 0), y + (rel ? p->last.y : 0));
      }
      if (!pair(&s, &z, &q))
        return -2;
      b = P(z + (rel ? p->last.x : 0), q + (rel ? p->last.y : 0));
      if (op == 'Q') {
        quad(p, a, b);
        ctrl = a;
      } else {
        if (!pair(&s, &x, &y))
          return -2;
        end = P(x + (rel ? p->last.x : 0), y + (rel ? p->last.y : 0));
        cubic(p, a, b, end);
        ctrl = b;
      }
    } else if (op == 'A') {
      /* Endpoint arc: elliptical radii, rotation and flags. */
      double rx, ry, rot, large, sweep;
      if (!number(&s, &rx) || !number(&s, &ry) || !number(&s, &rot) ||
          !arc_flag(&s, &large) || !arc_flag(&s, &sweep) || !pair(&s, &x, &y))
        return -2;
      end = P(x + (rel ? p->last.x : 0), y + (rel ? p->last.y : 0));
      rx = fabs(rx);
      ry = fabs(ry);
      if (rx < 1e-8 || ry < 1e-8) {
        line(p, end);
      } else {
        double phi = rot * 3.141592653589793 / 180, co = cos(phi),
               si = sin(phi);
        double dx = (p->last.x - end.x) / 2, dy = (p->last.y - end.y) / 2;
        double xp = co * dx + si * dy, yp = -si * dx + co * dy;
        double lam = xp * xp / (rx * rx) + yp * yp / (ry * ry);
        if (lam > 1) {
          double f = sqrt(lam);
          rx *= f;
          ry *= f;
        }
        double num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp,
               den = rx * rx * yp * yp + ry * ry * xp * xp;
        double f = den > 0 ? sqrt(fmax(0, num / den)) : 0;
        if ((large != 0) == (sweep != 0))
          f = -f;
        double cxp = f * rx * yp / ry, cyp = -f * ry * xp / rx;
        double cx = co * cxp - si * cyp + (p->last.x + end.x) / 2,
               cy = si * cxp + co * cyp + (p->last.y + end.y) / 2;
        double a0 = atan2((yp - cyp) / ry, (xp - cxp) / rx),
               a1 = atan2((-yp - cyp) / ry, (-xp - cxp) / rx), da = a1 - a0;
        if (sweep != 0 && da < 0)
          da += 2 * 3.141592653589793;
        if (sweep == 0 && da > 0)
          da -= 2 * 3.141592653589793;
        int count = (int)ceil(fabs(da) * 12);
        if (count < 1)
          count = 1;
        for (int i = 1; i <= count; i++) {
          double a = a0 + da * i / count;
          line(p, i == count ? end
                             : P(cx + co * rx * cos(a) - si * ry * sin(a),
                                 cy + si * rx * cos(a) + co * ry * sin(a)));
        }
      }
    } else
      return -2;
    prev = op;
    if (p->oom)
      return -3;
  }
  return p->n ? 0 : -2;
}
static int shape(path *p, token *t) {
  double x = attrnum(t, "x", 0), y = attrnum(t, "y", 0),
         w = attrnum(t, "width", 0), h = attrnum(t, "height", 0),
         cx = attrnum(t, "cx", 0), cy = attrnum(t, "cy", 0),
         rx = attrnum(t, "rx", 0), ry = attrnum(t, "ry", 0);
  if (!strcmp(t->tag, "path"))
    return pathdata(p, find_attr(t, "d"));
  if (!strcmp(t->tag, "rect")) {
    if (w <= 0 || h <= 0)
      return -2;
    move(p, P(x, y));
    line(p, P(x + w, y));
    line(p, P(x + w, y + h));
    line(p, P(x, y + h));
    closepath(p);
    return 0;
  }
  if (!strcmp(t->tag, "line")) {
    move(p, P(attrnum(t, "x1", 0), attrnum(t, "y1", 0)));
    line(p, P(attrnum(t, "x2", 0), attrnum(t, "y2", 0)));
    return 0;
  }
  if (!strcmp(t->tag, "circle")) {
    rx = ry = attrnum(t, "r", 0);
  }
  if (!strcmp(t->tag, "ellipse") || !strcmp(t->tag, "circle")) {
    if (rx <= 0 || ry <= 0)
      return -2;
    move(p, P(cx + rx, cy));
    for (int i = 1; i <= 64; i++) {
      double a = 2 * 3.141592653589793 * i / 64;
      line(p, P(cx + rx * cos(a), cy + ry * sin(a)));
    }
    closepath(p);
    return 0;
  }
  if (!strcmp(t->tag, "polyline") || !strcmp(t->tag, "polygon")) {
    const attr *v = find_attr(t, "points");
    if (!v)
      return -2;
    scan s = {v->raw, v->raw_len, 0};
    double a, b;
    if (!pair(&s, &a, &b))
      return -2;
    move(p, P(a, b));
    while (pair(&s, &a, &b))
      line(p, P(a, b));
    if (!strcmp(t->tag, "polygon"))
      closepath(p);
    return 0;
  }
  return 1;
}
static double dist2(pt p, edge e) {
  double dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, den = dx * dx + dy * dy,
         t = den ? ((p.x - e.a.x) * dx + (p.y - e.a.y) * dy) / den : 0;
  t = fmax(0, fmin(1, t));
  dx = p.x - e.a.x - t * dx;
  dy = p.y - e.a.y - t * dy;
  return dx * dx + dy * dy;
}
static int inside(path *p, pt q) {
  int hit = 0;
  for (size_t i = 0; i < p->n; i++) {
    edge e = p->v[i];
    if ((e.a.y > q.y) != (e.b.y > q.y)) {
      double xx = e.a.x + (q.y - e.a.y) * (e.b.x - e.a.x) / (e.b.y - e.a.y);
      if (xx > q.x)
        hit ^= 1;
    }
  }
  return hit;
}
static int cmp_x(const void *a, const void *b) {
  double x = *(const double *)a, y = *(const double *)b;
  return (x > y) - (x < y);
}
static void blend(uint8_t *dst, color c, double coverage);
/* Even-odd fill with the same 2x2 sampling as the generic painter. The old
 * painter tested every edge for every sub-sample (O(pixels * edges)), which
 * makes a 320x320 glyph take tens of seconds on the soft-float MCU. Here each
 * sub-row computes its edge crossings once, then fills spans by parity. */
static int fill_scanline(path *p, style st, uint8_t *out, int w,
                         int x0, int y0, int x1, int y1) {
  size_t cap = p->n ? p->n : 1;
  double *xs = LUME_SVG_MALLOC(2 * cap * sizeof(double));
  if (!xs)
    return -1;
  for (int y = y0; y < y1; y++) {
    size_t m[2];
    for (int sy = 0; sy < 2; sy++) {
      double qy = y + (sy + .5) / 2;
      m[sy] = 0;
      for (size_t i = 0; i < p->n; i++) {
        edge e = p->v[i];
        if ((e.a.y > qy) != (e.b.y > qy))
          xs[sy * cap + m[sy]++] =
              e.a.x + (qy - e.a.y) * (e.b.x - e.a.x) / (e.b.y - e.a.y);
      }
      if (m[sy])
        qsort(xs + sy * cap, m[sy], sizeof(double), cmp_x);
    }
    size_t k[2] = {0, 0};
    int parity[2] = {(int)(m[0] & 1), (int)(m[1] & 1)};
    for (int x = x0; x < x1; x++) {
      int fc = 0;
      for (int sy = 0; sy < 2; sy++) {
        for (int sx = 0; sx < 2; sx++) {
          double qx = x + (sx + .5) / 2;
          while (k[sy] < m[sy] && xs[sy * cap + k[sy]] <= qx) {
            parity[sy] ^= 1;
            k[sy]++;
          }
          fc += parity[sy];
        }
      }
      if (fc)
        blend(out + 4 * ((size_t)y * w + x), st.fill, fc * st.opacity / 4);
    }
  }
  LUME_SVG_FREE(xs);
  return 0;
}
static void blend(uint8_t *dst, color c, double coverage) {
  int a = (int)lround(c.a * coverage);
  if (a <= 0)
    return;
  int old = dst[3], out = a + old * (255 - a) / 255;
  if (!out)
    return;
  dst[0] = (uint8_t)((c.r * a + dst[0] * old * (255 - a) / 255) / out);
  dst[1] = (uint8_t)((c.g * a + dst[1] * old * (255 - a) / 255) / out);
  dst[2] = (uint8_t)((c.b * a + dst[2] * old * (255 - a) / 255) / out);
  dst[3] = (uint8_t)out;
}
static void paint(path *p, style st, uint8_t *out, int w, int h, double scale,
                  double ox, double oy) {
  for (size_t i = 0; i < p->n; i++) {
    p->v[i].a.x = p->v[i].a.x * scale + ox;
    p->v[i].a.y = p->v[i].a.y * scale + oy;
    p->v[i].b.x = p->v[i].b.x * scale + ox;
    p->v[i].b.y = p->v[i].b.y * scale + oy;
  }
  double minx = DBL_MAX, miny = DBL_MAX, maxx = -DBL_MAX, maxy = -DBL_MAX;
  for (size_t i = 0; i < p->n; i++) {
    edge e = p->v[i];
    pt q[] = {e.a, e.b};
    for (int k = 0; k < 2; k++) {
      minx = fmin(minx, q[k].x);
      maxx = fmax(maxx, q[k].x);
      miny = fmin(miny, q[k].y);
      maxy = fmax(maxy, q[k].y);
    }
  }
  double pad = st.sw * scale / 2 + 1;
  int x0 = (int)fmax(0, floor(minx - pad)), x1 = (int)fmin(w, ceil(maxx + pad)),
      y0 = (int)fmax(0, floor(miny - pad)), y1 = (int)fmin(h, ceil(maxy + pad));
  /* OOM falls back to the generic painter so a glyph is never silently blank. */
  if (x0 < x1 && y0 < y1 && !st.fill.none && p->closed &&
      (st.stroke.none || st.sw <= 0) &&
      fill_scanline(p, st, out, w, x0, y0, x1, y1) == 0)
    return;
  for (int y = y0; y < y1; y++)
    for (int x = x0; x < x1; x++) {
      int fc = 0, sc = 0;
      for (int sy = 0; sy < 2; sy++)
        for (int sx = 0; sx < 2; sx++) {
          pt q = P(x + (sx + .5) / 2, y + (sy + .5) / 2);
          if (!st.fill.none && p->closed && inside(p, q))
            fc++;
          if (!st.stroke.none && st.sw > 0) {
            double limit = st.sw * scale / 2;
            for (size_t i = 0; i < p->n; i++)
              if (dist2(q, p->v[i]) <= limit * limit) {
                sc++;
                break;
              }
          }
        }
      uint8_t *pixel = out + 4 * ((size_t)y * w + x);
      if (fc)
        blend(pixel, st.fill, fc * st.opacity / 4);
      if (sc)
        blend(pixel, st.stroke, sc * st.opacity / 4);
    }
}
int lume_svg_render(const uint8_t *b, size_t n, uint16_t tw, uint16_t th,
                    uint8_t **rgba, uint16_t *w, uint16_t *h) {
  if (!rgba || !w || !h)
    return -1;
  *rgba = NULL;
  uint16_t iw, ih;
  int rc = lume_svg_size(b, n, &iw, &ih);
  if (rc)
    return rc;
  if (tw && th) {
    *w = tw;
    *h = th;
  } else {
    double s = fmin(1., fmin(480. / iw, 480. / ih));
    *w = (uint16_t)fmax(1, lround(iw * s));
    *h = (uint16_t)fmax(1, lround(ih * s));
  }
  if (!*w || !*h || *w > 480 || *h > 480)
    return -2;
  token root_t;
  if (root(b, n, &root_t))
    return -2;
  box vb = viewbox(get(&root_t, "viewBox"));
  if (!vb.valid)
    vb = (box){0, 0, iw, ih, 1};
  double scale = fmin(*w / vb.w, *h / vb.h),
         ox = (*w - vb.w * scale) / 2 - vb.x * scale,
         oy = (*h - vb.h * scale) / 2 - vb.y * scale;
  size_t bytes = (size_t)*w * *h * 4;
  uint8_t *out = LUME_SVG_MALLOC(bytes);
  if (!out)
    return -3;
  memset(out, 0, bytes);
  scan s = {(const char *)b, n, 0};
  style initial = {rgb(0, 0, 0, 255), rgb(0, 0, 0, 255), 1, 1};
  initial.stroke.none = 1;
  style stack[16];
  char tags[16][32];
  int depth = 0;
  while ((rc = next(&s, &root_t)) > 0) {
    token *t = &root_t;
    if (t->closing) {
      if (!strcmp(t->tag, "svg") || !strcmp(t->tag, "g")) {
        if (!depth || strcmp(tags[depth - 1], t->tag)) {
          rc = -2;
          break;
        }
        depth--;
      }
      continue;
    }
    style st = styling(t, depth ? stack[depth - 1] : initial);
    if (!strcmp(t->tag, "svg") || !strcmp(t->tag, "g")) {
      if (!t->self) {
        if (depth >= 16) {
          rc = -2;
          break;
        }
        strcpy(tags[depth], t->tag);
        stack[depth++] = st;
      }
      continue;
    }
    path p = {0};
    int r = shape(&p, t);
    if (r == 0)
      paint(&p, st, out, *w, *h, scale, ox, oy);
    if (p.v)
      LUME_SVG_FREE(p.v);
    if (r < 0) {
      rc = r;
      break;
    }
  }
  if (rc < 0 || depth) {
    LUME_SVG_FREE(out);
    return rc < 0 ? rc : -2;
  }
  *rgba = out;
  return 0;
}
