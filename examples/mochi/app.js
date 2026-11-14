/**
 * mochi — programmatic mascot expressions, ported from
 * https://github.com/prabhavalabs/mochi (web/mochi.js reference
 * implementation, MIT license) to the Lume JS app API.
 *
 * The original renders with Canvas 2D paths (bezier body, ellipses, alpha).
 * Lume's Canvas exposes only fillRect / line / circle / text, so this port
 * re-implements the renderer in JS:
 *   - every shape is sampled into a local-space polygon, transformed by the
 *     pose matrix (scale -> tilt -> squash) and scanline-rasterized into
 *     merged horizontal fillRect bands;
 *   - strokes are sampled polylines;
 *   - globalAlpha is emulated by pre-blending the fill colour against the
 *     body colour (every translucent feature sits on the body).
 * The pose math (samplePose + exponential smoothing) is a faithful port.
 *
 * Interaction: tap the face to blink, swipe left/right to change state,
 * or use the buttons. Timer-driven redraws go through a signal so the
 * Canvas effect re-runs on the engine task.
 */
var COLORS = {
  body: '#f8f3e6', face: '#121610', blush: '#f4ba9f', crease: '#c6b79e',
  bg: '#101418', bar: '#1A2028', btn: '#2A3440'
};

var STATES = [
  { id: 'idle', name: 'Idle', detail: 'Just happy to be here.' },
  { id: 'blink', name: 'Blinking', detail: 'A tiny blink. A little hello.' },
  { id: 'happy', name: 'Happy', detail: 'You made my day.' },
  { id: 'listening', name: 'Listening', detail: 'You have my full attention.' },
  { id: 'thinking', name: 'Thinking', detail: 'Let me think for a moment...' },
  { id: 'speaking', name: 'Speaking', detail: 'So many little things to tell you.' },
  { id: 'sleeping', name: 'Sleeping', detail: 'Dreaming of something lovely.' },
  { id: 'surprised', name: 'Surprised', detail: 'Oh! I wasn\'t expecting that.' },
  { id: 'sad', name: 'Sad', detail: 'Could use a little company.' },
  { id: 'wave', name: 'Waving', detail: 'There you are. Hello, friend!' }
];

/* ================= pose math (ported from web/mochi.js) ================= */

var TAU = Math.PI * 2;
function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
function blinkAt(t, at) { return clamp((0.14 - Math.abs(t - at)) / 0.075, 0, 1); }

function samplePose(state, t, blink) {
  var p = { x: 0, y: 0, sx: 1, sy: 1, tilt: 0, gazeX: 0, gazeY: 0,
    eyeL: 1, eyeR: 1, happyEyes: 0, smile: 1, open: 0, round: 0, mouthX: 0,
    browL: 0, browR: 0, browSad: 0, leftX: -153, leftY: 35, leftAngle: -0.2,
    rightX: 153, rightY: 35, rightAngle: 0.2, cheeks: 1 };
  var breath = Math.sin(t * 1.7);
  p.sy += breath * 0.012; p.sx -= breath * 0.006; p.y -= breath * 1.1;
  switch (state) {
    case 'blink': {
      var phase = t % 2.8;
      blink = Math.max(blink, blinkAt(phase, 0.6), blinkAt(phase, 0.98));
      p.tilt = Math.sin(t * 0.8) * 0.025;
      break;
    }
    case 'happy': {
      var bounce = Math.max(0, Math.sin(t * 4.5));
      p.y -= bounce * 13; p.sx += 0.026 * Math.cos(t * 4.5); p.sy -= 0.025 * Math.cos(t * 4.5);
      p.happyEyes = 1; p.open = 0.65; p.smile = 1.2;
      p.leftY = -22 - 5 * bounce; p.rightY = -22 - 5 * bounce;
      p.leftX = -151; p.rightX = 151; p.leftAngle = -0.7; p.rightAngle = 0.7;
      p.tilt = Math.sin(t * 2.25) * 0.04;
      break;
    }
    case 'listening':
      p.tilt = -0.075 + Math.sin(t * 1.3) * 0.014;
      p.rightX = 140; p.rightY = -42; p.rightAngle = -0.35;
      p.gazeX = -5; p.eyeL = 1.08; p.eyeR = 1.08; p.smile = 0.65;
      p.y += Math.sin(t * 2.4) * 1.7;
      break;
    case 'thinking':
      p.tilt = 0.045 + Math.sin(t) * 0.018;
      p.gazeX = 7 + Math.sin(t * 0.65) * 3; p.gazeY = -8;
      p.browR = 1; p.eyeR = 0.85; p.mouthX = 5; p.smile = 0.08;
      p.rightX = 29; p.rightY = 43; p.rightAngle = -0.6 + Math.sin(t * 2) * 0.025;
      break;
    case 'speaking': {
      var speech = (Math.sin(t * 13) * 0.5 + 0.5) * (0.7 + 0.3 * Math.sin(t * 6.7));
      var phrase = t % 4.3 < 3.5 ? 1 : 0;
      p.open = (0.12 + speech * 0.85) * phrase; p.round = 0.18;
      p.tilt = Math.sin(t * 1.8) * 0.025; p.y += Math.sin(t * 3) * 1.7;
      p.leftY = 9 + Math.sin(t * 3.2) * 12; p.leftX = -161; p.leftAngle = -0.8;
      break;
    }
    case 'sleeping':
      p.eyeL = p.eyeR = 0.025; p.smile = 0.65; p.sy = 0.9 + Math.sin(t * 1.2) * 0.025;
      p.sx = 1.04 - Math.sin(t * 1.2) * 0.01; p.y = 15 - Math.sin(t * 1.2) * 2;
      p.leftY = p.rightY = 54; p.tilt = -0.025; break;
    case 'surprised': {
      var pop = Math.exp(-(t % 3.7) * 3);
      p.sy = 1.045 + 0.04 * pop; p.sx = 0.955; p.y = -5 - 7 * pop;
      p.eyeL = p.eyeR = 1.16; p.open = 0.88; p.round = 1; p.smile = 0;
      p.leftX = -71; p.rightX = 71; p.leftY = p.rightY = 44;
      p.leftAngle = -0.55; p.rightAngle = 0.55; break;
    }
    case 'sad':
      p.smile = -0.75; p.eyeL = p.eyeR = 0.8; p.gazeY = 5;
      p.browL = p.browR = p.browSad = 1; p.sy = 0.945; p.sx = 1.025;
      p.y = 9 + Math.sin(t * 1.4) * 2; p.leftY = p.rightY = 54;
      p.cheeks = 0.65; p.tilt = -0.035; break;
    case 'wave':
      p.leftX = -151; p.leftY = -32; p.leftAngle = -0.6 + Math.sin(t * 7) * 0.42;
      p.tilt = 0.065 + Math.sin(t * 3.5) * 0.015; p.smile = 1.15;
      p.y -= Math.sin(t * 2) * 2.5; break;
    default:
      p.gazeX = Math.sin(t * 0.55) * 3.2; p.tilt = Math.sin(t * 0.8) * 0.013;
  }
  if (state !== 'sleeping') {
    var natural = t % 5.7;
    blink = Math.max(blink, blinkAt(natural, 4.4));
    p.eyeL *= 1 - 0.97 * blink; p.eyeR *= 1 - 0.97 * blink;
  }
  return p;
}

var POSE_KEYS = ['x', 'y', 'sx', 'sy', 'tilt', 'gazeX', 'gazeY',
  'eyeL', 'eyeR', 'happyEyes', 'smile', 'open', 'round', 'mouthX',
  'browL', 'browR', 'browSad', 'leftX', 'leftY', 'leftAngle',
  'rightX', 'rightY', 'rightAngle', 'cheeks'];

/* ================= software rasterizer ================= */

function mixColor(cA, cB, w) {
  var a = parseInt(cA.substr(1, 2), 16) * w + parseInt(cB.substr(1, 2), 16) * (1 - w);
  var b = parseInt(cA.substr(3, 2), 16) * w + parseInt(cB.substr(3, 2), 16) * (1 - w);
  var c = parseInt(cA.substr(5, 2), 16) * w + parseInt(cB.substr(5, 2), 16) * (1 - w);
  var h = '0123456789abcdef';
  function hx(v) { v = Math.round(clamp(v, 0, 255)); return h[(v >> 4) & 15] + h[v & 15]; }
  return '#' + hx(a) + hx(b) + hx(c);
}

/* Sample a cubic bezier (local units) into n+1 points. */
function cubicPts(x0, y0, x1, y1, x2, y2, x3, y3, n) {
  var pts = [], i;
  for (i = 0; i <= n; i++) {
    var u = i / n, v = 1 - u;
    pts.push([
      v * v * v * x0 + 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u * x3,
      v * v * v * y0 + 3 * v * v * u * y1 + 3 * v * u * u * y2 + u * u * u * y3
    ]);
  }
  return pts;
}

function quadPts(x0, y0, cx, cy, x1, y1, n) {
  var pts = [], i;
  for (i = 0; i <= n; i++) {
    var u = i / n, v = 1 - u;
    pts.push([
      v * v * x0 + 2 * v * u * cx + u * u * x1,
      v * v * y0 + 2 * v * u * cy + u * u * y1
    ]);
  }
  return pts;
}

/* Radial ellipse polygon; rot in radians (hands). */
function ellipsePoly(rx, ry, rot, n) {
  var pts = [], c = Math.cos(rot || 0), s = Math.sin(rot || 0), i;
  for (i = 0; i < n; i++) {
    var a = i / n * TAU, x = rx * Math.cos(a), y = ry * Math.sin(a);
    pts.push([x * c - y * s, x * s + y * c]);
  }
  return pts;
}

/* Vertical stadium (rounded pill) for the open eyes, local units. */
function stadiumPoly(h) {
  var r = 8.5, pts = [], i, a;
  if (h <= 17) return ellipsePoly(r, h / 2, 0, 14);
  var half = (h - 17) / 2;
  for (i = 0; i <= 4; i++) {           /* top cap, right quarter: -90deg..0 */
    a = -Math.PI / 2 + Math.PI * i / 8;
    pts.push([r * Math.cos(a), -half + r * Math.sin(a)]);
  }
  pts.push([r, half]);                 /* straight right side */
  for (i = 0; i <= 4; i++) {           /* bottom cap, right quarter: 0..90deg */
    a = Math.PI * i / 8;
    pts.push([r * Math.cos(a), half + r * Math.sin(a)]);
  }
  for (i = 0; i <= 4; i++) {           /* bottom cap, left quarter: 90..180deg */
    a = Math.PI / 2 + Math.PI * i / 8;
    pts.push([r * Math.cos(a), half + r * Math.sin(a)]);
  }
  pts.push([-r, -half]);               /* straight left side */
  for (i = 0; i <= 4; i++) {           /* top cap, left quarter: 180..270deg */
    a = Math.PI / 2 + Math.PI * i / 8;
    pts.push([r * Math.cos(a), -half + r * Math.sin(a)]);
  }
  return pts;
}

function translatePts(pts, dx, dy) {
  var out = [], i;
  for (i = 0; i < pts.length; i++) out.push([pts[i][0] + dx, pts[i][1] + dy]);
  return out;
}

/* The body outline: the original path's six bezier segments, closed. */
var BODY_POLY = (function () {
  var segs = [
    [0, -128, 79, -130, 123, -69, 145, -3],
    [145, -3, 161, 42, 171, 80, 146, 101],
    [146, 101, 124, 122, 59, 124, 0, 124],
    [0, 124, -62, 124, -127, 121, -148, 103],
    [-148, 103, -174, 83, -162, 42, -145, -5],
    [-145, -5, -122, -75, -72, -129, 0, -128]
  ], pts = [], i, j;
  for (i = 0; i < segs.length; i++) {
    var s = segs[i], sub = cubicPts(s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], 7);
    for (j = i === 0 ? 0 : 1; j < sub.length; j++) pts.push(sub[j]);
  }
  return pts;
})();

/* Scanline-fill a transformed polygon as merged fillRect bands (convex shapes). */
function fillShape(ctx, xf, local, color, step, W, H) {
  if (step === undefined) step = 2;
  var pts = [], i, minY = 1e9, maxY = -1e9;
  for (i = 0; i < local.length; i++) {
    var q = xf(local[i][0], local[i][1]);
    pts.push(q);
    if (q[1] < minY) minY = q[1];
    if (q[1] > maxY) maxY = q[1];
  }
  ctx.fillColor(color);
  var y = Math.floor(minY / step) * step;
  var px0 = 0, px1 = 0, py0 = 0, yEnd = 0, open = false;
  for (; y < maxY; y += step) {
    var yc = y + step * 0.5, x0 = 1e9, x1 = -1e9;
    for (i = 0; i < pts.length; i++) {
      var p = pts[i], r = pts[(i + 1) % pts.length];
      if ((p[1] <= yc && r[1] > yc) || (r[1] <= yc && p[1] > yc)) {
        var xi = p[0] + (yc - p[1]) / (r[1] - p[1]) * (r[0] - p[0]);
        if (xi < x0) x0 = xi;
        if (xi > x1) x1 = xi;
      }
    }
    if (x1 < x0) continue;
    x0 = clamp(Math.round(x0), 0, W); x1 = clamp(Math.round(x1), 0, W);
    if (x1 <= x0) continue;
    if (open && Math.abs(x0 - px0) <= 1 && Math.abs(x1 - px1) <= 1) {
      yEnd = y + step;
    } else {
      if (open) ctx.fillRect(px0, py0, Math.max(px1 - px0, 1), yEnd - py0);
      px0 = x0; px1 = x1; py0 = y; yEnd = y + step; open = true;
    }
  }
  if (open) ctx.fillRect(px0, py0, Math.max(px1 - px0, 1), yEnd - py0);
}

/* Draw a transformed polyline as segments (local units, stroke width local). */
function strokeShape(ctx, xf, local, color, width, scale) {
  var w = clamp(Math.round(width * scale), 1, 16);
  var prev = xf(local[0][0], local[0][1]), i;
  for (i = 1; i < local.length; i++) {
    var cur = xf(local[i][0], local[i][1]);
    ctx.line(Math.round(prev[0]), Math.round(prev[1]),
             Math.round(cur[0]), Math.round(cur[1]), color, w);
    prev = cur;
  }
}

/* ================= app state ================= */

var W = 480, H = 400;               /* canvas size; bottom 80px = info bar */
var stateIdx = signal(0);
var frame = signal(0);
var pose = samplePose('idle', 0, 0);
var time = 0, blinkStart = -100, paused = false;
var DT = 0.05;                       /* matches the 50ms tick */

function setState(i) {
  stateIdx.set(((i % STATES.length) + STATES.length) % STATES.length);
  time = 0; blinkStart = -100;
}
function step(d) { setState(stateIdx() + d); }
function doBlink() { blinkStart = time; }

function tick() {
  if (paused) return;
  time += DT;
  var blink = blinkAt(time - blinkStart, 0.14);
  var target = samplePose(STATES[stateIdx()].id, time, blink);
  var mix = 1 - Math.exp(-DT * 13), eyeMix = 1 - Math.exp(-DT * 45), k;
  for (var i = 0; i < POSE_KEYS.length; i++) {
    k = POSE_KEYS[i];
    pose[k] += (target[k] - pose[k]) * (k === 'eyeL' || k === 'eyeR' ? eyeMix : mix);
  }
  frame.set(frame() + 1);
}

/* ================= renderer (adapted from Mochi.draw) ================= */

function drawMochi(ctx) {
  var p = pose;
  ctx.fillColor(COLORS.bg);
  ctx.fillRect(0, 0, W, H);

  var scale = Math.min(W * 0.76 / 350, H * 0.53 / 270);
  var centerY = Math.min(H * 0.445, H * 0.5 - 40);
  var ox = W / 2 + p.x * scale, oy = centerY + p.y * scale;
  var cosT = Math.cos(p.tilt), sinT = Math.sin(p.tilt);
  /* screen = [ox,oy] + S(scale) . R(tilt) . S(sx,sy) . local */
  function xf(wx, wy) {
    return [ox + scale * (cosT * wx * p.sx - sinT * wy * p.sy),
            oy + scale * (sinT * wx * p.sx + cosT * wy * p.sy)];
  }
  function xfg(wx, wy) { return xf(wx + p.gazeX, wy + p.gazeY); }

  fillShape(ctx, xf, BODY_POLY, COLORS.body, 2, W, H);

  /* hands: body-coloured ellipses + a crease arc, like the original */
  fillShape(ctx, xf, translatePts(ellipsePoly(20, 28, p.leftAngle, 14), p.leftX, p.leftY),
    COLORS.body, 2, W, H);
  fillShape(ctx, xf, translatePts(ellipsePoly(20, 28, p.rightAngle, 14), p.rightX, p.rightY),
    COLORS.body, 2, W, H);
  var creaseL = [], creaseR = [], i;
  for (i = 0; i <= 7; i++) {
    var al = 0.1 + (1.75 - 0.1) * i / 7, ar = 1.4 + (3.05 - 1.4) * i / 7;
    creaseL.push([p.leftX + 17 * Math.cos(al), p.leftY + 25 * Math.sin(al)]);
    creaseR.push([p.rightX + 17 * Math.cos(ar), p.rightY + 25 * Math.sin(ar)]);
  }
  strokeShape(ctx, xf, creaseL, COLORS.crease, 2, scale);
  strokeShape(ctx, xf, creaseR, COLORS.crease, 2, scale);

  /* features live in gaze space (blush, eyes, brows, mouth) */
  fillShape(ctx, xfg, translatePts(ellipsePoly(13, 8.5, 0.07, 10), -68, 17),
    mixColor(COLORS.blush, COLORS.body, p.cheeks), 1, W, H);
  fillShape(ctx, xfg, translatePts(ellipsePoly(13, 8.5, 0.07, 10), 68, 17),
    mixColor(COLORS.blush, COLORS.body, p.cheeks), 1, W, H);

  var eyeArgs = [[-48, p.eyeL], [48, p.eyeR]];
  for (i = 0; i < 2; i++) {
    var ex = eyeArgs[i][0], openness = eyeArgs[i][1];
    if (p.happyEyes > 0.65) {
      strokeShape(ctx, xfg, quadPts(ex - 10, -15, ex, -15 - 15 * Math.min(1, openness + 0.2),
        ex + 10, -15, 6), COLORS.face, 5.5, scale);
    } else if (openness < 0.12) {
      strokeShape(ctx, xfg, quadPts(ex - 9, -13, ex, -6, ex + 9, -13, 6),
        COLORS.face, 4.5, scale);
    } else {
      fillShape(ctx, xfg, translatePts(stadiumPoly(34 * openness), ex, -15),
        COLORS.face, 1, W, H);
    }
  }

  var brows = [[-48, p.browL, -1], [48, p.browR, 1]];
  for (i = 0; i < 2; i++) {
    var bx = brows[i][0], amount = brows[i][1], side = brows[i][2];
    if (amount < 0.01) continue;
    strokeShape(ctx, xfg, quadPts(bx - 9, -47 + side * 4 * p.browSad, bx,
      -53, bx + 9, -47 - side * 4 * p.browSad, 4),
      mixColor(COLORS.face, COLORS.body, amount), 4.5, scale);
  }

  var mouthOpen = clamp(p.open, 0, 1);
  var mx = p.mouthX;
  if (mouthOpen > 0.06) {
    var mw = 14 - p.round * 5, mh = 3 + mouthOpen * 11;
    fillShape(ctx, xfg, translatePts(ellipsePoly(mw, mh, 0, 12), mx, 3 + mh / 2),
      COLORS.face, 1, W, H);
  } else {
    strokeShape(ctx, xfg, cubicPts(mx - 12, 0, mx - 6, p.smile * 12, mx + 6,
      p.smile * 12, mx + 12, -1, 8), COLORS.face, 5, scale);
  }
}

/* ================= UI ================= */

var mochiCanvas = Canvas({ width: W, height: H, onDraw: function (ctx) {
  frame();
  drawMochi(ctx);
} });

lume.gesture.on(mochiCanvas, 'tap', function () { doBlink(); });
lume.gesture.on(mochiCanvas, 'swipe', function (e) {
  if (e.dir === 'left') step(1);
  else if (e.dir === 'right') step(-1);
});

View({ style: { width: '100%', height: '100%', background: COLORS.bg, scroll: 'none' } }, [
  mochiCanvas,
  Text({ text: function () {
    var i = stateIdx() + 1;
    return (i < 10 ? '0' : '') + i + ' / ' + STATES.length;
  }, style: { x: 384, y: 8, width: 84, height: 20, textAlign: 'right' } }),
  Text({ text: function () { return STATES[stateIdx()].name; },
    style: { x: 16, y: 408, width: 280, height: 24 } }),
  Text({ text: function () { return STATES[stateIdx()].detail; },
    style: { x: 16, y: 436, width: 348, height: 36 } }),
  Button({ title: '<', onPress: function () { step(-1); },
    style: { x: 376, y: 410, width: 46, height: 58, background: COLORS.btn, borderRadius: 10 } }),
  Button({ title: '>', onPress: function () { step(1); },
    style: { x: 430, y: 410, width: 46, height: 58, background: COLORS.btn, borderRadius: 10 } })
]);

lume.system.setInterval(tick, 50);
lume.app.onPause(function () { paused = true; });
lume.app.onResume(function () { paused = false; });
