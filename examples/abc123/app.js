/**
 * abc123 — toddler alphabet & number cards (A-Z 0-9, 36 cards).
 *
 * WHY CANVAS VECTOR GLYPHS (the r70 key decision, verified before coding):
 * runtime/types/lume.d.ts:54-57 says fontSize is snapped to the bundled
 * Montserrat faces 14/20/32 by the bridge (lume_ui_bridge.c:660-667). The
 * largest rendered Text glyph is therefore 32 px even if you ask for 200,
 * far short of the >=60%-of-480 (~290 px) a full-screen baby card needs.
 * So the big glyph is hand-drawn on Canvas: digits use 7-segment filled
 * rects (same abstraction as examples/calculator, which is also the correct
 * "how it is written" visual for number drills), letters use thick stroked
 * polylines. This needs NO font-outline parsing / font library — just simple
 * hand-authored paths — so the brief's "font parser = stop" clause is not hit.
 *
 * Toddler UX: one full-screen tap = next card (anywhere below the HUD); the
 * top HUD strip is the ONLY other touch target (mode switch). No exit, no
 * back, no nested interactive elements, no small text (all HUD text 20 px).
 * A tap also fires one bounce+flash animation on the glyph.
 *
 * Modes: seq (A..Z,0..9 loop, default) / rand (shuffled bag, no repeat until
 * exhausted) / case (upper+lower on one screen; digits have no case).
 */
var ABC_CARDS = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z',
  '0','1','2','3','4','5','6','7','8','9'];
var ABC_WORDS = {A:'Apple',B:'Ball',C:'Cat',D:'Dog',E:'Egg',F:'Fish',G:'Grape',H:'Hat',I:'Ice',J:'Juice',
  K:'Kite',L:'Lion',M:'Moon',N:'Nest',O:'Orange',P:'Pig',Q:'Queen',R:'Rainbow',S:'Sun',T:'Tree',
  U:'Umbrella',V:'Van',W:'Water',X:'Xylophone',Y:'Yo-yo',Z:'Zebra',
  '0':'Zero','1':'One','2':'Two','3':'Three','4':'Four','5':'Five','6':'Six','7':'Seven','8':'Eight','9':'Nine'};
var ABC_PALETTE = ['#E53935','#8E24AA','#1E88E5','#00897B','#43A047','#F4511E','#3949AB','#D81B60','#00ACC1','#C2185B'];
var ABC_ICON_LETTERS = ['A','B','C','D','E'];
var ABC_MODES = ['seq','rand','case'];
var ABC_MODE_LABEL = {seq:'SEQUENCE',rand:'RANDOM',case:'Aa / CASE'};

function abcIsDigit(ch) { return ch >= '0' && ch <= '9'; }
function abcDotCount(ch) { return abcIsDigit(ch) ? (ch.charCodeAt(0) - 48) : 0; }
function abcWord(ch) { return ABC_WORDS[ch] || ''; }
function abcBgForIndex(i) { return ABC_PALETTE[((i % ABC_PALETTE.length) + ABC_PALETTE.length) % ABC_PALETTE.length]; }
function abcBgForCard(ch) { return abcBgForIndex(ABC_CARDS.indexOf(ch)); }
function abcNextSeq(i) { return (i + 1) % ABC_CARDS.length; }
function abcHasIcon(ch) { return ABC_ICON_LETTERS.indexOf(ch) >= 0; }

/* Uppercase strokes: each letter is a list of polylines in a 100 x 140 box. */
var ABC_UPPER = {
  A:[[[0,140],[50,0],[100,140]],[[18,92],[82,92]]],
  B:[[[0,0],[0,140]],[[0,0],[68,0],[100,22],[100,52],[68,70],[0,70]],[[0,70],[72,70],[100,92],[100,118],[72,140],[0,140]]],
  C:[[[100,22],[70,0],[25,0],[0,28],[0,112],[25,140],[70,140],[100,118]]],
  D:[[[0,0],[0,140]],[[0,0],[52,0],[100,34],[100,106],[52,140],[0,140]]],
  E:[[[0,0],[0,140]],[[0,0],[96,0]],[[0,70],[76,70]],[[0,140],[96,140]]],
  F:[[[0,0],[0,140]],[[0,0],[96,0]],[[0,70],[76,70]]],
  G:[[[100,22],[70,0],[25,0],[0,28],[0,112],[25,140],[70,140],[100,140],[100,82],[58,82]]],
  H:[[[0,0],[0,140]],[[100,0],[100,140]],[[0,70],[100,70]]],
  I:[[[14,0],[86,0]],[[50,0],[50,140]],[[14,140],[86,140]]],
  J:[[[74,0],[74,112],[54,140],[20,140],[0,118]]],
  K:[[[0,0],[0,140]],[[100,0],[4,82]],[[34,56],[100,140]]],
  L:[[[0,0],[0,140],[100,140]]],
  M:[[[0,140],[0,0],[50,72],[100,0],[100,140]]],
  N:[[[0,140],[0,0],[100,140],[100,0]]],
  O:[[[24,0],[76,0],[100,30],[100,110],[76,140],[24,140],[0,110],[0,30],[24,0]]],
  P:[[[0,140],[0,0],[68,0],[100,24],[100,56],[68,76],[0,76]]],
  Q:[[[24,0],[76,0],[100,30],[100,110],[76,140],[24,140],[0,110],[0,30],[24,0]],[[56,104],[106,146]]],
  R:[[[0,140],[0,0],[68,0],[100,24],[100,56],[68,76],[0,76]],[[52,76],[100,140]]],
  S:[[[100,18],[70,0],[25,0],[0,26],[0,62],[100,78],[100,114],[72,140],[25,140],[0,122]]],
  T:[[[0,0],[100,0]],[[50,0],[50,140]]],
  U:[[[0,0],[0,110],[24,140],[76,140],[100,110],[100,0]]],
  V:[[[0,0],[50,140],[100,0]]],
  W:[[[0,0],[18,140],[50,58],[82,140],[100,0]]],
  X:[[[0,0],[100,140]],[[100,0],[0,140]]],
  Y:[[[0,0],[50,70],[100,0]],[[50,70],[50,140]]],
  Z:[[[0,0],[100,0],[0,140],[100,140]]]
};

/* Lowercase strokes in a 100 x 170 box (baseline 140, descenders to 166).
 * Deliberately simple child-friendly forms, NOT an outline font. */
var ABC_LOWER = {
  a:[[[82,68],[30,68],[8,100],[30,138],[78,138],[94,100],[78,70]],[[82,60],[82,138]]],
  b:[[[8,4],[8,140]],[[8,96],[34,68],[76,68],[96,92],[96,118],[76,140],[34,140],[8,112]]],
  c:[[[96,82],[68,66],[28,66],[8,94],[8,112],[28,140],[68,140],[96,124]]],
  d:[[[92,4],[92,140]],[[92,96],[66,68],[24,68],[4,92],[4,116],[24,140],[66,140],[92,112]]],
  e:[[[6,106],[94,106],[94,120],[68,140],[30,140],[6,122],[6,94],[94,94]]],
  f:[[[62,4],[38,4],[30,40],[30,140]],[[8,70],[58,70]]],
  g:[[[92,66],[24,66],[4,96],[24,140],[70,140],[92,112]],[[92,62],[92,140],[74,166],[36,166],[14,148]]],
  h:[[[8,4],[8,140]],[[8,88],[34,68],[72,68],[94,92],[94,140]]],
  i:[[[50,52],[50,140]],[[50,24],[50,34]]],
  j:[[[72,52],[72,140],[54,162],[24,162],[6,142]],[[72,24],[72,34]]],
  k:[[[8,4],[8,140]],[[94,66],[8,116]],[[34,90],[94,140]]],
  l:[[[40,4],[40,140]]],
  m:[[[6,70],[6,140]],[[6,92],[32,68],[58,92],[58,140]],[[58,92],[84,68],[96,80],[96,140]]],
  n:[[[8,70],[8,140]],[[8,92],[36,68],[76,68],[94,90],[94,140]]],
  o:[[[24,66],[76,66],[96,94],[96,112],[76,140],[24,140],[4,112],[4,94],[24,66]]],
  p:[[[8,84],[8,166]],[[8,86],[34,66],[76,66],[96,90],[96,114],[76,136],[34,136],[8,114]]],
  q:[[[92,84],[92,166]],[[92,86],[66,66],[24,66],[4,90],[4,114],[24,136],[66,136],[92,114]]],
  r:[[[8,70],[8,140]],[[8,98],[32,68],[70,66],[94,78]]],
  s:[[[94,80],[70,66],[26,66],[6,88],[6,98],[94,112],[94,124],[70,140],[26,140],[6,126]]],
  t:[[[50,4],[50,126],[70,140],[94,126]],[[14,70],[86,70]]],
  u:[[[8,66],[8,116],[28,140],[72,140],[92,116],[92,66]]],
  v:[[[6,66],[50,140],[94,66]]],
  w:[[[4,66],[22,140],[50,90],[78,140],[96,66]]],
  x:[[[8,66],[92,140]],[[92,66],[8,140]]],
  y:[[[8,66],[50,112],[92,66]],[[50,112],[50,166],[28,166],[8,148]]],
  z:[[[8,66],[92,66],[8,140],[92,140]]]
};

/* 7-segment digit geometry (100%-fill rects, no stroke width cap). */
var ABC_SEG_RECTS = {a:[2,0,14,4],b:[14,2,4,11],c:[14,17,4,11],d:[2,28,14,4],
  e:[0,17,4,11],f:[0,2,4,11],g:[2,14,14,4]};
var ABC_SEG_MAP = {'0':'abcdef','1':'bc','2':'abged','3':'abgcd','4':'fgbc',
  '5':'afgcd','6':'acdefg','7':'abc','8':'abcdefg','9':'abcdfg'};

/* Pure render-plan descriptor: what the canvas will draw for a card+mode. */
function abcRenderSpec(ch, mode) {
  if (abcIsDigit(ch)) return {type:'digit', ch:ch, dots:abcDotCount(ch), segs:ABC_SEG_MAP[ch]};
  if (mode === 'case') return {type:'case', ch:ch, upper:ABC_UPPER[ch] || [], lower:ABC_LOWER[ch.toLowerCase()] || []};
  return {type:'letter', ch:ch, strokes:ABC_UPPER[ch] || []};
}

/* Shuffle copy (Fisher-Yates). */
function abcShuffle(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/* ABC UI */
var card = signal('A');
var mode = signal('seq');
var idx = 0;             /* sequential / case pointer into ABC_CARDS */
var bag = [], bagPtr = 0; /* random deck */
var GW = 360, GH = 302;  /* glyph canvas (x=60,y=74) */
var AW = 320, AH = 60;   /* aux canvas: number dots / A-E icons (x=80,y=414) */
var GLYPH_X = 60, GLYPH_Y = 74;
var INK = '#FFFFFF', LEAF = '#66BB6A', EYE = '#263238';

function abcLogCard(ch, m) {
  try { lume.system.log('ABC CARD ' + ch + ' mode=' + m); } catch (e) {}
}
function abcResetBag() { bag = abcShuffle(ABC_CARDS); bagPtr = 0; }
function abcFirstCard(m) {
  idx = 0; abcResetBag();
  return m === 'rand' ? bag[bagPtr++] : ABC_CARDS[0];
}
function abcNextCard() {
  var m = mode(), ch;
  if (m === 'rand') {
    if (bagPtr >= bag.length) abcResetBag();
    ch = bag[bagPtr++];
  } else {
    idx = abcNextSeq(idx);
    ch = ABC_CARDS[idx];
  }
  card.set(ch); abcLogCard(ch, m); abcBounce();
}
function abcSwitchMode() {
  var m = ABC_MODES[(ABC_MODES.indexOf(mode()) + 1) % ABC_MODES.length];
  mode.set(m);
  var ch = abcFirstCard(m);
  card.set(ch);
  try { lume.system.log('ABC MODE ' + m); } catch (e) {}
  abcLogCard(ch, m); abcBounce();
}
var glyphNode = 0;
function abcBounce() {
  try {
    lume.anim.cancel(glyphNode, 'y');
    lume.anim.to(glyphNode, {attr:'y', from:GLYPH_Y - 26, to:GLYPH_Y, durationMs:260, easing:'ease-out'});
    lume.anim.cancel(glyphNode, 'opacity');
    lume.anim.to(glyphNode, {attr:'opacity', from:0.45, to:1, durationMs:220, easing:'ease-out'});
  } catch (e) {}
}

function abcDrawStrokes(ctx, strokes, bx, by, bw, bh, normH, color, thick) {
  var sx = bw / 100, sy = bh / normH;
  for (var i = 0; i < strokes.length; i++) {
    var line = strokes[i], pts = [];
    for (var j = 0; j < line.length; j++) {
      pts.push([Math.round(bx + line[j][0] * sx), Math.round(by + line[j][1] * sy)]);
    }
    ctx.polyline(pts, color, thick);
  }
}
function abcDrawDigit(ctx, ch, cx, top, w, h, color) {
  var sx = w / 20, sy = h / 32, segs = ABC_SEG_MAP[ch] || '';
  ctx.fillColor(color);
  for (var i = 0; i < segs.length; i++) {
    var r = ABC_SEG_RECTS[segs[i]];
    ctx.fillRect(Math.round(cx + r[0] * sx), Math.round(top + r[1] * sy),
      Math.max(1, Math.round(r[2] * sx)), Math.max(1, Math.round(r[3] * sy)));
  }
}
function abcDrawDots(ctx, n, w, h, color) {
  if (n <= 0) return;
  var gap = Math.min(34, Math.floor((w - 20) / n)), r = 9;
  var total = (n - 1) * gap, x0 = Math.round((w - total) / 2), y = Math.round(h / 2);
  /* ctx.circle is a 1px RING since r47 (lume_raster_ring). A full-sweep arc
   * with width > 2r closes the hole (r48 degeneracy) -> a real filled DOT. */
  for (var i = 0; i < n; i++) ctx.arc(x0 + i * gap, y, r, 0, 360, r + 2, color);
}
function abcDrawIcon(ctx, ch, w, h, color) {
  var cx = Math.round(w / 2), cy = Math.round(h / 2), r = Math.round(h * 0.34);
  ctx.fillColor(color);
  if (ch === 'A') {            /* apple */
    ctx.circle(cx, cy + 4, r, color);
    ctx.line(cx, cy - r + 2, cx + 3, cy - r - 12, color, 4);
    ctx.fillColor(LEAF); ctx.fillRect(cx + 3, cy - r - 12, 16, 7);
  } else if (ch === 'B') {     /* ball */
    ctx.circle(cx, cy, r, color);
    ctx.fillColor('#0E1A2B'); ctx.line(cx - r, cy, cx + r, cy, '#0E1A2B', 3);
    ctx.line(cx, cy - r, cx, cy + r, '#0E1A2B', 3);
  } else if (ch === 'C') {     /* cat */
    ctx.circle(cx, cy + 2, r, color);
    ctx.polyline([[cx - r + 2, cy - r + 6],[cx - r + 4, cy - r - 12],[cx - 6, cy - r + 4]], color, 4);
    ctx.polyline([[cx + r - 2, cy - r + 6],[cx + r - 4, cy - r - 12],[cx + 6, cy - r + 4]], color, 4);
    ctx.fillColor(EYE); ctx.circle(cx - 7, cy - 2, 3, EYE); ctx.circle(cx + 7, cy - 2, 3, EYE);
  } else if (ch === 'D') {     /* dog */
    ctx.circle(cx, cy + 2, r, color);
    ctx.fillRect(cx - r - 6, cy - 4, 12, 22); ctx.fillRect(cx + r - 6, cy - 4, 12, 22);
    ctx.fillColor(EYE); ctx.circle(cx - 7, cy - 2, 3, EYE); ctx.circle(cx + 7, cy - 2, 3, EYE);
    ctx.circle(cx, cy + 7, 3, EYE);
  } else if (ch === 'E') {     /* egg */
    ctx.circle(cx, cy, r, color);
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.fillRect(cx - r + 5, cy - r - 4, r * 2 - 10, r * 2 + 8);
  }
}

var bgColor = function () { return abcBgForCard(card()); };
var modeText = function () { return 'MODE: ' + ABC_MODE_LABEL[mode()] + '  -  TAP TOP TO CHANGE'; };
var hintText = function () {
  var ch = card();
  if (abcIsDigit(ch)) return ch + ' is ' + abcWord(ch) + '  (' + abcDotCount(ch) + ' dots)';
  return ch + ' is for ' + abcWord(ch);
};

function drawGlyph(ctx) {
  var ch = card(), m = mode(), bg = bgColor();
  ctx.fillColor(bg); ctx.fillRect(0, 0, GW, GH);
  if (abcIsDigit(ch)) {
    abcDrawDigit(ctx, ch, Math.round((GW - 200) / 2), Math.round((GH - 290) / 2), 200, 290, INK);
  } else if (m === 'case') {
    var gh = 250, gw = 150, y = Math.round((GH - gh) / 2);
    abcDrawStrokes(ctx, ABC_UPPER[ch] || [], 14, y, gw, gh, 140, INK, 12);
    abcDrawStrokes(ctx, ABC_LOWER[ch.toLowerCase()] || [], GW - 14 - gw, y, gw, gh, 170, INK, 12);
  } else {
    var h = 290, w = Math.round(h * 100 / 140);
    abcDrawStrokes(ctx, ABC_UPPER[ch] || [], Math.round((GW - w) / 2), Math.round((GH - h) / 2), w, h, 140, INK, 16);
  }
}
function drawAux(ctx) {
  var ch = card(), bg = bgColor();
  ctx.fillColor(bg); ctx.fillRect(0, 0, AW, AH);
  if (abcIsDigit(ch)) abcDrawDots(ctx, abcDotCount(ch), AW, AH, INK);
  else if (abcHasIcon(ch)) abcDrawIcon(ctx, ch, AW, AH, INK);
}

var root = View({ style: { width:'100%', height:'100%', background:bgColor, scroll:'none',
  display:'flex', flexDirection:'column', alignItems:'center' } });
glyphNode = Canvas({ parent:root, width:GW, height:GH,
  style:{ position:'absolute', x:GLYPH_X, y:GLYPH_Y }, onDraw:drawGlyph });
var auxNode = Canvas({ parent:root, width:AW, height:AH,
  style:{ position:'absolute', x:80, y:414 }, onDraw:drawAux });
Text({ parent:root, text:modeText, style:{ position:'absolute', x:0, y:18, width:480,
  fontSize:20, color:'#FFFFFF', textAlign:'center' } });
Text({ parent:root, text:hintText, style:{ position:'absolute', x:0, y:380, width:480,
  fontSize:20, color:'#FFFFFF', textAlign:'center' } });

lume.gesture.on(root, 'tap', function (e) {
  /* The whole lower screen is one big "next card" target; only the 74 px
   * top HUD strip switches mode. There is no exit / back path at all. */
  if (e.y < 74) abcSwitchMode(); else abcNextCard();
});
abcLogCard(card(), mode());
