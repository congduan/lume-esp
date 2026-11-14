/**
 * r21 gesture demo — 2x2 cards, one gesture each, plus a bottom status bar.
 *
 *   tap       -> increments a counter
 *   swipe     -> switches a "page" number by direction
 *   longpress -> toggles the card color (and never also fires tap/onPress)
 *   pan       -> drags a small square with incremental displacement
 *
 * Every gesture target is a NON-scrollable View (scroll:'none'). Inside a
 * scrollable container a drag belongs to LVGL List scrolling, so gestures
 * yield to it. Status-bar coordinates are absolute screen pixels.
 */
lume.theme.set({
  colors: {
    bg: '#0B1E3F', card: '#1B3A5C', line: '#5B82B0',
    accent: '#F0A030', hot: '#E05A3A'
  },
  radius: 14
});

var status = signal('ready');
var taps = signal(0);
var page = signal(1);
var hot = signal(false);
var sqx = signal(24), sqy = signal(24);

function echo(e) {
  var s = e.type + ' (' + e.x + ',' + e.y + ')';
  if (e.dir) s += ' ' + e.dir;
  status.set(s);
}
function card(x, y, w, h, bg) {
  return View({ style: {
    x: x, y: y, width: w, height: h,
    background: bg === undefined ? 'card' : bg,
    borderColor: 'line', borderWidth: 1,
    scroll: 'none'   /* gestures win; a List would scroll instead */
  } });
}
function title(t, x, y) {
  return Text({ text: t, style: { x: x, y: y, width: 180, height: 24 } });
}

/* ---- tap: count ---- */
var tapCard = View({ style: {
  x: 16, y: 44, width: 216, height: 186,
  background: 'card', borderColor: 'line', borderWidth: 1, scroll: 'none'
} }, [
  title('TAP', 16, 12),
  Text({ text: function () { return 'count ' + taps(); },
         style: { x: 16, y: 44, width: 180, height: 28 } })
]);
lume.gesture.on(tapCard, 'tap', function (e) { taps.set(taps() + 1); echo(e); });

/* ---- swipe: change page by direction ---- */
var swipeCard = View({ style: {
  x: 248, y: 44, width: 216, height: 186,
  background: 'card', borderColor: 'line', borderWidth: 1, scroll: 'none'
} }, [
  title('SWIPE', 16, 12),
  Text({ text: function () { return 'page ' + page() + '/4'; },
         style: { x: 16, y: 44, width: 180, height: 28 } })
]);
lume.gesture.on(swipeCard, 'swipe', function (e) {
  var p = page();
  p += (e.dir === 'left' || e.dir === 'up') ? 1 : -1;
  if (p < 1) p = 4;
  if (p > 4) p = 1;
  page.set(p);
  echo(e);
});

/* ---- longpress: toggle color. No double-trigger with tap/onPress. ---- */
var longCard = View({ style: {
  x: 16, y: 244, width: 216, height: 176,
  background: function () { return hot() ? 'hot' : 'card'; },
  borderColor: 'line', borderWidth: 1, scroll: 'none'
} }, [
  title('LONGPRESS', 16, 12),
  Text({ text: function () { return hot() ? 'HOT' : 'hold me'; },
         style: { x: 16, y: 44, width: 180, height: 28 } })
]);
lume.gesture.on(longCard, 'longpress', function (e) { hot.set(!hot()); echo(e); });

/* ---- pan: drag a small square (a non-clickable label, so it can't steal
 * the press from the card). Movement is the delta between consecutive pan
 * events, so the square tracks the finger relative to its current spot. ---- */
var panCard = View({ style: {
  x: 248, y: 244, width: 216, height: 176,
  background: 'card', borderColor: 'line', borderWidth: 1, scroll: 'none'
} }, [title('PAN', 16, 12)]);
var lastDx = 0, lastDy = 0;
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
lume.gesture.on(panCard, 'panstart', function (e) { lastDx = e.dx; lastDy = e.dy; echo(e); });
lume.gesture.on(panCard, 'pan', function (e) {
  sqx.set(clamp(sqx() + (e.dx - lastDx), 4, 168));
  sqy.set(clamp(sqy() + (e.dy - lastDy), 4, 128));
  lastDx = e.dx; lastDy = e.dy;
  echo(e);
});
lume.gesture.on(panCard, 'panend', function (e) { echo(e); });
/* Empty-text label with a fixed size + background = a draggable square. */
Text({ text: '', parent: panCard,
       style: { x: sqx, y: sqy, width: 40, height: 40, background: 'accent' } });

/* ---- full-screen root + status bar ---- */
View({ style: { width: '100%', height: '100%', background: 'bg', scroll: 'none' } }, [
  Text({ text: 'Gesture lab r21', style: { x: 16, y: 12, width: 300, height: 26 } }),
  tapCard, swipeCard, longCard, panCard,
  Text({ text: function () { return 'last: ' + status(); },
         style: { x: 16, y: 432, width: 448, height: 36,
                  background: 'card', borderColor: 'line', borderWidth: 1 } })
]);
