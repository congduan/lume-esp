/* Relative heading and bubble level on the QMI8658 six-axis IMU.
 * There is no magnetometer. Check Z sign, board orientation and drift on-device.
 * r205 round-AMOLED redesign (from artifacts/r205/design/dashboard.html):
 *  - Full 360-degree compass dial with all 4 cardinals (N/E/S/W) and 72 ticks
 *    (retained via retainSegments to stay well within <= 240 draw calls/frame).
 *  - SIM / REL badge moved cleanly off the tick ring into an inner corner pill.
 *  - Tabular monospace heading readout rendered per-character on Canvas.
 *  - Dedicated circular spirit level with outer & inner tolerance rings,
 *    zero overlap with compass bezel or S cardinal. */
var DR_BG = '#000000', DR_DIAL = '#0A1320', DR_RING = '#2D465E', DR_INK = '#F2F7FB';
var DR_DIM = '#9EB3C6', DR_MINT = '#40D8B0', DR_AMBER = '#FFD78E', DR_NORTH = '#FF6B79';
function roundWrap(d) { d = d % 360; return d < 0 ? d + 360 : d; }
function roundIntegrate(h, gz, ms) { return roundWrap(h + gz * ms / 1000); }
function roundNeedle(deg, radius) {
  var a = deg * Math.PI / 180;
  return [Math.round(200 + radius * Math.sin(a)), Math.round(200 - radius * Math.cos(a))];
}
function roundBubble(ax, ay) {
  var x = Math.max(-1, Math.min(1, ax / 9.81));
  var y = Math.max(-1, Math.min(1, ay / 9.81));
  return [Math.round(x * 65), Math.round(y * 43)];
}
function roundSample(s) {
  return s && isFinite(s.ax) && isFinite(s.ay) && isFinite(s.gz) ? s : null;
}
function roundSector(deg) {
  var names = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return names[Math.round(roundWrap(deg) / 22.5) % 16];
}

/* GAME UI */
var roundData = signal({ heading: 28, ax: 1.8, ay: -1.4, sim: true });
var roundTicks = 0;

function roundTick() {
  var s = null;
  try { if (lume.imu && lume.imu.read) s = roundSample(lume.imu.read()); } catch (e) { s = null; }
  var old = roundData();
  if (s) roundData.set({ heading: roundIntegrate(old.heading, s.gz, 100), ax: s.ax, ay: s.ay, sim: false });
  else {
    roundTicks++;
    roundData.set({ heading: roundWrap(28 + roundTicks * 1.8),
      ax: Math.sin(roundTicks * 0.04) * 2.5, ay: Math.cos(roundTicks * 0.035) * 2,
      sim: true });
  }
}

function drPolar(cx, cy, r, deg) {
  var a = deg * Math.PI / 180;
  return [Math.round(cx + r * Math.sin(a)), Math.round(cy - r * Math.cos(a))];
}

function drBuildTickSegs() {
  var minor = [], mid = [], major = [];
  for (var deg = 0; deg < 360; deg += 5) {
    if (deg === 0) continue; /* North drawn in coral red separately */
    var isCard = deg % 90 === 0;
    var isMaj = deg % 30 === 0;
    var isMid = deg % 15 === 0;
    var rIn = isCard ? 190 : (isMaj ? 193 : (isMid ? 197 : 201));
    var p = drPolar(240, 240, rIn, deg);
    var q = drPolar(240, 240, 208, deg);
    if (isMaj) major.push([p[0], p[1], q[0], q[1]]);
    else if (isMid) mid.push([p[0], p[1], q[0], q[1]]);
    else minor.push([p[0], p[1], q[0], q[1]]);
  }
  return { minor: minor, mid: mid, major: major };
}

function drBuildStaticLines() {
  var segs = [
    /* Level crosshairs centered at (240, 282) */
    [186, 282, 294, 282],
    [240, 228, 240, 336]
  ];
  /* Dashed outer tolerance ring at r=38 (16 short dashes around level) */
  for (var i = 0; i < 16; i++) {
    var a1 = i * 22.5, a2 = a1 + 11;
    var p1 = drPolar(240, 282, 38, a1);
    var p2 = drPolar(240, 282, 38, a2);
    segs.push([p1[0], p1[1], p2[0], p2[1]]);
  }
  return segs;
}

var DR_SEGS = drBuildTickSegs();
var DR_LEVEL_SEGS = drBuildStaticLines();

/* Tabular monospace vector digits (fixed cell width = zero horizontal jitter) */
var DR_SEG_MAP = [63, 6, 91, 79, 102, 109, 125, 7, 127, 111];
function drawMonoDigit(c, d, x, y, w, h, t, col) {
  var r = Math.floor(t / 2), half = Math.floor(h / 2);
  c.fillColor(col);
  if (d === 1) {
    var cx1 = x + Math.floor(w * 0.56);
    c.fillRect(cx1 - r, y + r, t, h - t);
    c.fillCircle(cx1, y + r, r, col);
    c.fillCircle(cx1, y + h - r, r, col);
    return;
  }
  var m = DR_SEG_MAP[d] || 63;
  if (m & 1)  c.fillRect(x + r, y, w - t, t);
  if (m & 2)  c.fillRect(x + w - t, y + r, t, half - r);
  if (m & 4)  c.fillRect(x + w - t, y + half, t, h - half - r);
  if (m & 8)  c.fillRect(x + r, y + h - t, w - t, t);
  if (m & 16) c.fillRect(x, y + half, t, h - half - r);
  if (m & 32) c.fillRect(x, y + r, t, half - r);
  if (m & 64) c.fillRect(x + r, y + half - r, w - t, t);
  if ((m & 1) || (m & 32)) c.fillCircle(x + r, y + r, r, col);
  if ((m & 1) || (m & 2))  c.fillCircle(x + w - r, y + r, r, col);
  if ((m & 8) || (m & 16)) c.fillCircle(x + r, y + h - r, r, col);
  if ((m & 8) || (m & 4))  c.fillCircle(x + w - r, y + h - r, r, col);
  if (m & 64) {
    c.fillCircle(x + r, y + half, r, col);
    c.fillCircle(x + w - r, y + half, r, col);
  }
}

function drawMonoHeading(c, heading) {
  var s = ('00' + Math.floor(roundWrap(heading))).slice(-3);
  var dw = 24, dh = 40, gap = 8, t = 5;
  var total = dw * 3 + gap * 2 + 12;
  var sx = Math.round(240 - total / 2);
  var sy = 144;
  for (var i = 0; i < 3; i++) {
    drawMonoDigit(c, s.charCodeAt(i) - 48, sx + i * (dw + gap), sy, dw, dh, t, DR_INK);
  }
  /* Degree ring symbol cleanly at upper-right of the 3rd digit */
  c.arc(sx + dw * 3 + gap * 2 + 7, sy + 7, 4, 0, 360, 2, DR_INK);
}

function drawPill(c, x, y, w, h, fill, border) {
  var r = Math.floor(h / 2);
  c.fillCircle(x + r, y + r, r, border);
  c.fillCircle(x + w - r, y + r, r, border);
  c.fillColor(border); c.fillRect(x + r, y, w - 2 * r, h);
  var ir = r - 1;
  c.fillCircle(x + r, y + r, ir, fill);
  c.fillCircle(x + w - r, y + r, ir, fill);
  c.fillColor(fill); c.fillRect(x + r, y + 1, w - 2 * r, h - 2);
}

/* Crisp vector cardinal letters N / E / S / W */
function drawCardinal(c, ch, cx, cy, col) {
  if (ch === 'N') {
    c.line(cx - 5, cy + 7, cx - 5, cy - 7, col, 2);
    c.line(cx - 5, cy - 7, cx + 5, cy + 7, col, 2);
    c.line(cx + 5, cy + 7, cx + 5, cy - 7, col, 2);
  } else if (ch === 'E') {
    c.line(cx - 4, cy - 6, cx - 4, cy + 6, col, 2);
    c.line(cx - 4, cy - 6, cx + 5, cy - 6, col, 2);
    c.line(cx - 4, cy, cx + 3, cy, col, 2);
    c.line(cx - 4, cy + 6, cx + 5, cy + 6, col, 2);
  } else if (ch === 'S') {
    c.line(cx + 4, cy - 6, cx - 3, cy - 6, col, 2);
    c.line(cx - 4, cy - 5, cx - 4, cy - 1, col, 2);
    c.line(cx - 3, cy, cx + 3, cy, col, 2);
    c.line(cx + 4, cy + 1, cx + 4, cy + 5, col, 2);
    c.line(cx + 3, cy + 6, cx - 4, cy + 6, col, 2);
  } else if (ch === 'W') {
    c.line(cx - 6, cy - 6, cx - 4, cy + 6, col, 2);
    c.line(cx - 4, cy + 6, cx, cy, col, 2);
    c.line(cx, cy, cx + 4, cy + 6, col, 2);
    c.line(cx + 4, cy + 6, cx + 6, cy - 6, col, 2);
  }
}

function roundDraw(c) {
  var d = roundData();
  var bRaw = roundBubble(d.ax, d.ay);
  /* Map linear bubble coordinates cleanly inside circular level radius (r <= 42) */
  var bx = bRaw[0] * 0.62, by = bRaw[1] * 0.93;
  var dist = Math.sqrt(bx * bx + by * by);
  if (dist > 42) { bx = bx * 42 / dist; by = by * 42 / dist; }
  bx = Math.round(bx); by = Math.round(by);
  var inTol = dist <= 16;

  c.clear();
  c.fillColor(DR_BG); c.fillRect(0, 0, 480, 480);
  c.fillCircle(240, 240, 224, DR_DIAL);
  c.arc(240, 240, 215, 0, 360, 2, DR_RING);
  c.arc(240, 240, 184, 0, 360, 1, '#1C2E40');

  /* Retained 360-degree ticks + level tolerance geometry (4 pathDraw calls/frame) */
  if (!c.drPaths) {
    c.drPaths = [
      c.retainSegments(DR_SEGS.minor, '#354E66', 1),
      c.retainSegments(DR_SEGS.mid, '#7C9BB5', 1),
      c.retainSegments(DR_SEGS.major, '#E2EEF8', 2),
      c.retainSegments(DR_LEVEL_SEGS, '#294056', 1)
    ];
  }
  /* Active heading arc from North (0 deg -> heading) on r=199 */
  var sweep = Math.round(roundWrap(d.heading));
  if (sweep >= 2) {
    c.arc(240, 240, 199, -90, -90 + Math.min(359, sweep), 10, '#164541');
  }
  c.drawPath(c.drPaths[0]);
  c.drawPath(c.drPaths[1]);
  c.drawPath(c.drPaths[2]);
  /* North 0-deg highlight tick */
  c.line(240, 32, 240, 50, DR_NORTH, 3);

  /* All 4 Cardinal letters cleanly at r=164 */
  drawCardinal(c, 'N', 240, 76, DR_NORTH);
  drawCardinal(c, 'E', 404, 240, DR_INK);
  drawCardinal(c, 'S', 240, 404, DR_INK);
  drawCardinal(c, 'W', 76, 240, DR_INK);

  /* Heading pointer chevron riding full 360-degree outer track (solid filled arrow) */
  var tip = drPolar(240, 240, 214, d.heading);
  var baseL = drPolar(240, 240, 198, d.heading - 3.2);
  var baseR = drPolar(240, 240, 198, d.heading + 3.2);
  var midL = drPolar(240, 240, 203, d.heading - 1.6);
  var midR = drPolar(240, 240, 203, d.heading + 1.6);
  var stem = drPolar(240, 240, 186, d.heading);
  c.line(tip[0], tip[1], baseL[0], baseL[1], DR_MINT, 4);
  c.line(tip[0], tip[1], baseR[0], baseR[1], DR_MINT, 4);
  c.line(midL[0], midL[1], midR[0], midR[1], DR_MINT, 5);
  c.line(baseL[0], baseL[1], baseR[0], baseR[1], DR_MINT, 3);
  c.line(tip[0], tip[1], stem[0], stem[1], DR_MINT, 3);

  /* Top-left SIM/REL corner pill (strictly inside cockpit, OFF compass ring) */
  if (d.sim) {
    drawPill(c, 146, 110, 58, 22, '#2B2315', '#8C7444');
    c.fillCircle(157, 121, 3, DR_AMBER);
    c.text(165, 114, 'SIM', DR_AMBER, 14);
  } else {
    drawPill(c, 146, 110, 58, 22, '#132E2B', '#2E8A74');
    c.fillCircle(157, 121, 3, DR_MINT);
    c.text(165, 114, 'REL', DR_MINT, 14);
  }

  /* Top-right sector badge */
  var sec = roundSector(d.heading);
  drawPill(c, 276, 110, 58, 22, '#12292A', '#266C60');
  c.text(289 + (3 - sec.length) * 4, 114, sec, DR_MINT, 14);

  /* Monospace tabular heading digits + DEG REL caption */
  drawMonoHeading(c, d.heading);
  c.text(207, 192, 'DEG REL', DR_DIM, 14);

  /* Circular Spirit Bubble Level at (240, 282), r=58 (zero overlap with S at 404) */
  c.fillCircle(240, 282, 58, '#0F1B29');
  c.arc(240, 282, 58, 0, 360, 2, '#2E4A63');
  c.drawPath(c.drPaths[3]);
  c.arc(240, 282, 17, 0, 360, 2, inTol ? DR_MINT : '#2B6E63');

  /* Spirit bubble with layered shadow & specular highlight */
  var bCol = inTol ? DR_MINT : DR_AMBER;
  var bHi = inTol ? '#A6F5E0' : '#FFF0C2';
  c.fillCircle(240 + bx, 284 + by, 13, '#070E16');
  c.fillCircle(240 + bx, 282 + by, 12, bCol);
  c.fillCircle(238 + bx, 280 + by, 6, bHi);
  c.fillCircle(236 + bx, 278 + by, 2, '#FFFFFF');

  c.text(215, 352, 'LEVEL', DR_DIM, 14);
}

var roundRoot = View({ style: { width: 480, height: 480, background: DR_BG, scroll: 'none' } });
Canvas({ parent: roundRoot, width: 480, height: 480, onDraw: roundDraw,
  style: { position: 'absolute', x: 0, y: 0 } });
roundTick();
lume.system.setInterval(roundTick, 100);
