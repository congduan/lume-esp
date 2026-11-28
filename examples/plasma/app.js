/* Lume r98 plasma screensaver. RGB565 solid inks, 20 Hz, one full canvas.
 * IMU acceleration is m/s^2; a missing sensor leaves a gentle downward bias.
 * All motion and palette selection above GAME UI run in a bare VM. */
var PL_W = 480, PL_H = 480, PL_DT = 50, PL_IDLE = 1200;
var PL_BLOBS = [
  { x: 222, y: 178, rx: 125, ry: 108, ax: 27, ay: 23, fx: 0.013, fy: 0.009, phase: 0.2, color: 0 },
  { x: 308, y: 251, rx: 105, ry: 125, ax: 27, ay: 25, fx: 0.011, fy: 0.015, phase: 1.7, color: 3 },
  { x: 155, y: 302, rx: 102, ry: 98, ax: 26, ay: 24, fx: 0.015, fy: 0.010, phase: 3.1, color: 6 },
  { x: 295, y: 348, rx: 93, ry: 86, ax: 24, ay: 23, fx: 0.009, fy: 0.014, phase: 4.5, color: 9 },
  { x: 211, y: 163, rx: 74, ry: 82, ax: 27, ay: 24, fx: 0.016, fy: 0.011, phase: 4.7, color: 11 }
];
/* The 12 positions are hand-picked RGB565-friendly stops, not runtime HSV.
 * Each blob reads a different offset in the same ring. Mix inks are pre-set. */
var PL_THEMES = [
  { name: 'LAVA', bg: '#100719', haze: '#261027', haze2: '#1D0B24',
    body: ['#8D2444','#A42943','#BC3040','#CC3B3A','#D44A32','#DB5730','#D96332','#CC623A','#BE4D44','#AC3C4C','#9B3051','#91294C'],
    core: ['#DC4967','#E85860','#F16C55','#FA7D47','#FF9540','#FFAE49','#FFC361','#FFAE56','#FA8C51','#F3735D','#E86168','#DD506D'],
    mix: ['#FFBA68','#FFE080','#FF947A','#FFCA75'], ink: '#F8D9C6' },
  { name: 'AURORA', bg: '#061526', haze: '#0B3140', haze2: '#172942',
    body: ['#195B88','#176E8B','#147D83','#168B78','#219475','#309B79','#3D9A92','#488EAA','#527FBC','#5970AE','#51649E','#355D95'],
    core: ['#36A8CE','#3DBFCA','#4ED9BE','#61E8AE','#89F0B6','#A3EDCD','#A2E2E9','#94C9F3','#A7B5F2','#B9A5E5','#A4AAE0','#76AEDB'],
    mix: ['#B7F4DC','#B8DDF9','#9DEBEE','#C7C9F3'], ink: '#D2F5EE' },
  { name: 'SUNSET', bg: '#180B30', haze: '#3A1745', haze2: '#271238',
    body: ['#9F4377','#B44979','#C85872','#D96569','#E27862','#E98A5C','#E69265','#DC7B76','#CE6985','#BB5B8E','#AA4E89','#A0447C'],
    core: ['#EE8EAB','#F5A5AC','#FFC09A','#FFD389','#FFE29A','#FFE5A4','#FFD4A8','#FFC1B4','#F7B2C6','#EFA2CB','#EB95C4','#E98DB6'],
    mix: ['#FFE5B3','#FFD4C2','#FFB8CE','#FFF0BD'], ink: '#FFE8E2' }
];
/* Four inks per theme: core, body, middle (78% body), edge (56% body).
 * Expand the 12-stop rings to 48 RGB stops once; frames only look up inks. */
function plBlendColor(a, b, t) {
  var out = '#';
  for (var i = 1; i < 7; i += 2) {
    var av = parseInt(a.slice(i, i + 2), 16), bv = parseInt(b.slice(i, i + 2), 16);
    var h = Math.round(av + (bv - av) * t).toString(16).toUpperCase();
    out += h.length === 1 ? '0' + h : h;
  }
  return out;
}
var PL_RINGS = [];
for (var plThemeIndex = 0; plThemeIndex < PL_THEMES.length; plThemeIndex++) {
  var plR = { body: [], core: [], middle: [], edge: [], haze: [] }, plTheme = PL_THEMES[plThemeIndex];
  for (var plKindIndex = 0; plKindIndex < 2; plKindIndex++) {
    var plKind = plKindIndex ? 'core' : 'body', plStops = plTheme[plKind];
    for (var plAnchor = 0; plAnchor < plStops.length; plAnchor++)
      for (var plSub = 0; plSub < 4; plSub++)
        plR[plKind].push(plBlendColor(plStops[plAnchor], plStops[(plAnchor + 1) % plStops.length], plSub / 4));
  }
  for (var plColorIndex = 0; plColorIndex < plR.body.length; plColorIndex++) {
    plR.middle.push(plBlendColor(plTheme.bg, plR.body[plColorIndex], 0.78));
    plR.edge.push(plBlendColor(plTheme.bg, plR.body[plColorIndex], 0.56));
  }
  plR.haze = [0.16, 0.34, 0.55].map(function (t) { return plBlendColor(plTheme.bg, plTheme.haze, t); });
  PL_RINGS.push(plR);
}
function plClamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function plGravity(sample) {
  if (!sample || !isFinite(sample.ax) || !isFinite(sample.ay) ||
      typeof sample.ax !== 'number' || typeof sample.ay !== 'number') return [0, 6];
  return [plClamp(sample.ax * 2.4, -24, 24), plClamp(6 + sample.ay * 2.4, -18, 30)];
}
function plState() {
  var s = { phase: 0, colorPhase: 0, tick: 0, idle: 0, slow: false, theme: 0,
    gx: 0, gy: 6, lastAx: null, lastAy: null, ripple: null, blobs: [] };
  for (var i = 0; i < PL_BLOBS.length; i++) {
    var b = PL_BLOBS[i]; s.blobs.push({ x: b.x, y: b.y, rx: b.rx, ry: b.ry });
  }
  return s;
}
function plColor(theme, blob, colorPhase, kind) {
  var ring = PL_RINGS[theme][kind];
  return ring[(PL_BLOBS[blob].color * 4 + Math.floor(colorPhase / 5)) % ring.length];
}
function plWake(s) { s.idle = 0; s.slow = false; }
function plTouch(s, x, y) {
  plWake(s); s.theme = (s.theme + 1) % PL_THEMES.length;
  s.ripple = { x: plClamp(x, 0, PL_W - 1), y: plClamp(y, 0, PL_H - 1), age: 0 };
}
/* Lissajous target plus an eased lateral-gravity offset. Speed is capped after
 * target calculation, so a sudden board tilt cannot jump a large blob. */
function plStep(s, sample) {
  if (sample && typeof sample.ax === 'number' && typeof sample.ay === 'number' &&
      isFinite(sample.ax) && isFinite(sample.ay)) {
    if (s.lastAx !== null && Math.hypot(sample.ax - s.lastAx, sample.ay - s.lastAy) > 2.8) plWake(s);
    s.lastAx = sample.ax; s.lastAy = sample.ay;
  }
  s.idle++;
  if (s.idle >= PL_IDLE) s.slow = true;
  var rate = s.slow ? 0.3 : 1;
  s.phase += rate; s.colorPhase += s.slow ? 0.5 : 1;
  var g = plGravity(sample), ease = s.slow ? 0.014 : 0.045;
  s.gx += (g[0] - s.gx) * ease; s.gy += (g[1] - s.gy) * ease;
  var cap = s.slow ? 0.55 : 1.8;
  for (var i = 0; i < PL_BLOBS.length; i++) {
    var b = PL_BLOBS[i], p = s.blobs[i], t = s.phase;
    var x = b.x + b.ax * Math.sin(t * b.fx + b.phase) + 9 * Math.sin(t * b.fy * 0.49 + b.phase * 2) + s.gx;
    var y = b.y + b.ay * Math.sin(t * b.fy + b.phase * 1.4) + 8 * Math.sin(t * b.fx * 0.43 + b.phase) + s.gy;
    /* 1.26 encloses the 0.64-offset, 0.62-radius silhouette lobe. */
    var mx = Math.ceil(b.rx * 1.26), my = Math.ceil(b.ry * 1.23);
    p.x = plClamp(p.x + plClamp(x - p.x, -cap, cap), mx, PL_W - mx);
    p.y = plClamp(p.y + plClamp(y - p.y, -cap, cap), my, PL_H - my);
  }
  if (s.ripple && ++s.ripple.age >= 3) s.ripple = null;
  s.tick++;
  return s;
}

/* GAME UI */
/* r227 adaptive: app authored on a 480 logical canvas; map to real screen.
 * At 480 this block is an exact no-op (all wrappers forward unchanged args). */
var SW = (typeof __lumeScreen !== 'undefined' && __lumeScreen && __lumeScreen.w > 0) ? __lumeScreen.w : 480;
var SH = (typeof __lumeScreen !== 'undefined' && __lumeScreen && __lumeScreen.h > 0) ? __lumeScreen.h : 480;
var __A_ADAPT = SW !== 480 || SH !== 480;
var __A_KX = SW / 480, __A_KY = SH / 480;
function __A_SX(v) { return Math.round(v * __A_KX); }
function __A_SY(v) { return Math.round(v * __A_KY); }
var __A_XK = ',width,x,borderRadius,borderWidth,gap,margin,marginLeft,marginRight,padding,paddingLeft,paddingRight,minWidth,maxWidth,letterSpacing,translateX,';
var __A_YK = ',height,y,borderRadius,borderWidth,gap,margin,marginTop,marginBottom,padding,paddingTop,paddingBottom,minHeight,maxHeight,lineHeight,translateY,';
function __A_style(s) {
  if (!__A_ADAPT || !s || typeof s !== 'object') return s;
  var o = {}, k;
  for (k in s) {
    var v = s[k];
    if (typeof v === 'number' && __A_XK.indexOf(',' + k + ',') >= 0) o[k] = __A_SX(v);
    else if (typeof v === 'number' && __A_YK.indexOf(',' + k + ',') >= 0) o[k] = __A_SY(v);
    else o[k] = v;
  }
  return o;
}
function __A_ctx(c) {
  if (c.__r227Ctx) return c.__r227Ctx;
  var w = { nodeId: c.nodeId };
  function pt(p) { return [__A_SX(p[0]), __A_SY(p[1])]; }
  function sg(s) { return [__A_SX(s[0]), __A_SY(s[1]), __A_SX(s[2]), __A_SY(s[3])]; }
  w.clear = function () { return c.clear(); };
  w.fillColor = function (x) { return c.fillColor(x); };
  w.fillRect = function (x, y, ww, hh) { return c.fillRect(__A_SX(x), __A_SY(y), __A_SX(ww), __A_SY(hh)); };
  w.line = function (a, b, d, e, col, wd) { return c.line(__A_SX(a), __A_SY(b), __A_SX(d), __A_SY(e), col, wd); };
  w.polyline = function (p, col, wd) { return c.polyline(p.map(pt), col, wd); };
  w.retainPath = function (p, col, wd) { return c.retainPath(p.map(pt), col, wd); };
  w.retainSegments = function (p, col, wd) { return c.retainSegments(p.map(sg), col, wd); };
  w.drawPath = function (id, dx, dy) { return c.drawPath(id, dx === undefined ? 0 : __A_SX(dx), dy === undefined ? 0 : __A_SY(dy)); };
  w.retainImage = function (id, ww, hh, px) {
    var rw = Math.min(SW, __A_SX(ww)), rh = Math.min(SH, __A_SY(hh));
    if (rw === ww && rh === hh) return c.retainImage(id, ww, hh, px);
    var out = new Uint16Array(rw * rh);
    for (var y = 0; y < rh; y++) {
      var sy = Math.min(hh - 1, Math.round(y * hh / rh));
      for (var x = 0; x < rw; x++) {
        var sx = Math.min(ww - 1, Math.round(x * ww / rw));
        out[y * rw + x] = px[sy * ww + sx];
      }
    }
    return c.retainImage(id, rw, rh, out);
  };
  w.drawImage = function (id, dx, dy, flip) { return c.drawImage(id, dx === undefined ? 0 : __A_SX(dx), dy === undefined ? 0 : __A_SY(dy), flip); };
  w.circle = function (x, y, r, col) { return c.circle(__A_SX(x), __A_SY(y), __A_SX(r), col); };
  w.fillCircle = function (x, y, r, col) { return c.fillCircle(__A_SX(x), __A_SY(y), __A_SX(r), col); };
  w.fillEllipse = function (x, y, rx, ry, col) { return c.fillEllipse(__A_SX(x), __A_SY(y), __A_SX(rx), __A_SY(ry), col); };
  w.ellipse = function (x, y, rx, ry, col, wd) { return c.ellipse(__A_SX(x), __A_SY(y), __A_SX(rx), __A_SY(ry), col, wd); };
  w.arc = function (x, y, r, fr, to, wd, col) { return c.arc(__A_SX(x), __A_SY(y), __A_SX(r), fr, to, wd, col); };
  w.text = function (x, y, str, col, sz) { return c.text(__A_SX(x), __A_SY(y), str, col, sz); };
  c.__r227Ctx = w;
  return w;
}
function __A_Canvas(p) {
  if (!__A_ADAPT || !p) return Canvas(p);
  var o = {}, k;
  for (k in p) o[k] = p[k];
  var cw = Math.min(SW, __A_SX(Number(p.width) || 0)), ch = Math.min(SH, __A_SY(Number(p.height) || 0));
  o.width = cw; o.height = ch; o.style = __A_style(p.style);
  var fn = p.onDraw;
  o.onDraw = function (c) {
    var d = fn(__A_ctx(c));
    if (!d || typeof d !== 'object') return d;
    function rect(r) {
      var x = __A_SX(r.x), y = __A_SY(r.y);
      return { x: x, y: y, w: Math.min(cw - x, __A_SX(r.w)), h: Math.min(ch - y, __A_SY(r.h)) };
    }
    return Array.isArray(d) ? d.map(rect) : rect(d);
  };
  return Canvas(o);
}
function __A_View(p, kids) { return View(__A_style(p), kids); }
function __A_Text(p, kids) { return Text(__A_style(p), kids); }
function __A_Button(p, kids) { return Button(__A_style(p), kids); }
function __A_Image(p, kids) { return Image(__A_style(p), kids); }


var pl = plState(), plFrame = signal(0), plTimer = null;
var plRoot = __A_View({ style: { width: PL_W, height: PL_H, background: PL_THEMES[0].bg, scroll: 'none' } });
function plSoftEllipse(ctx, x, y, rx, ry, edge, middle, body) {
  ctx.fillEllipse(x, y, rx, ry, edge);
  ctx.fillEllipse(x, y, Math.round(rx * 0.90), Math.round(ry * 0.90), middle);
  ctx.fillEllipse(x, y, Math.round(rx * 0.79), Math.round(ry * 0.79), body);
}
var plCanvas = __A_Canvas({ parent: plRoot, width: PL_W, height: PL_H,
  style: { position: 'absolute', x: 0, y: 0 }, onDraw: function (ctx) {
    plFrame();
    var theme = PL_THEMES[pl.theme], i, j, p, q, b, n = 0;
    ctx.fillColor(theme.bg); ctx.fillRect(0, 0, PL_W, PL_H);
    /* Four low-contrast concentric inks dissolve the old hard haze disc. */
    ctx.fillEllipse(244, 238, 234, 213, PL_RINGS[pl.theme].haze[0]);
    ctx.fillEllipse(244, 238, 215, 195, PL_RINGS[pl.theme].haze[1]);
    ctx.fillEllipse(244, 238, 192, 174, PL_RINGS[pl.theme].haze[2]);
    ctx.fillEllipse(244, 238, 165, 148, theme.haze2);
    for (i = 0; i < PL_BLOBS.length; i++) {
      p = pl.blobs[i]; b = PL_BLOBS[i];
      var body = plColor(pl.theme, i, pl.colorPhase, 'body');
      var middle = plColor(pl.theme, i, pl.colorPhase, 'middle');
      var edge = plColor(pl.theme, i, pl.colorPhase, 'edge');
      /* Offset lobe breaks the coin silhouette while staying close to the
       * parent ellipse. Paint it first so its dark fringe cannot cross the
       * brighter main body. Its beat differs from the centre beat. */
      plSoftEllipse(ctx, Math.round(p.x + b.rx * 0.64 * Math.sin(pl.phase * 0.007 + i * 1.9)),
        Math.round(p.y + b.ry * 0.61 * Math.cos(pl.phase * 0.009 + i * 1.3)),
        Math.round(b.rx * 0.62), Math.round(b.ry * 0.62), edge, middle, body);
      plSoftEllipse(ctx, Math.round(p.x), Math.round(p.y), b.rx, b.ry, edge, middle, body);
      ctx.fillEllipse(Math.round(p.x - b.rx * 0.15), Math.round(p.y - b.ry * 0.18),
        Math.round(b.rx * 0.61), Math.round(b.ry * 0.60), plColor(pl.theme, i, pl.colorPhase, 'core'));
    }
    /* Budget: background 1 + haze 4 + 5 blobs x (3 body + 3 lobe + 1 core)
     * + 4 bridges + ripple 1 + labels 2 = 47 calls/frame, below 60. */
    /* A small warm bridge at actual overlaps suggests additive fusion. */
    for (i = 0; i < PL_BLOBS.length && n < 4; i++) for (j = i + 1; j < PL_BLOBS.length && n < 4; j++) {
      p = pl.blobs[i]; q = pl.blobs[j];
      var dx = p.x - q.x, dy = p.y - q.y;
      var reach = Math.min(p.rx + q.rx, p.ry + q.ry) * 0.72;
      if (dx * dx + dy * dy > reach * reach) continue;
      var across = Math.abs(dx) >= Math.abs(dy);
      ctx.fillEllipse(Math.round((p.x + q.x) / 2), Math.round((p.y + q.y) / 2),
        Math.round(Math.min(p.rx, q.rx) * (across ? 0.46 : 0.28)),
        Math.round(Math.min(p.ry, q.ry) * (across ? 0.27 : 0.43)),
        theme.mix[(i + j) % theme.mix.length]);
      n++;
    }
    if (pl.ripple) ctx.arc(Math.round(pl.ripple.x), Math.round(pl.ripple.y),
      12 + pl.ripple.age * 20, 0, 360, 3, theme.ink);
    ctx.text(202, 12, 'PLASMA', theme.ink);
    ctx.text(240 - theme.name.length * 4, 29, theme.name, theme.ink);
  } });
function plReadImu() {
  try { if (lume.imu && typeof lume.imu.read === 'function') return lume.imu.read(); }
  catch (e) { /* absent or not initialized */ }
  return null;
}
function plTick() { plStep(pl, plReadImu()); plFrame.set(plFrame() + 1); }
function plStart() { if (plTimer === null) plTimer = lume.system.setInterval(plTick, PL_DT); }
function plStop() { if (plTimer !== null) lume.system.clearInterval(plTimer); plTimer = null; }
lume.gesture.on(plRoot, 'tap', function (e) { plTouch(pl, e.x, e.y); plFrame.set(plFrame() + 1); });
lume.app.onStart(plStart);
lume.app.onPause(plStop);
lume.app.onResume(plStart);
plStart();
