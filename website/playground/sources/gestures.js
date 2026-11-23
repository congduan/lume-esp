/**
 * r21 gesture demo — 2x2 cards (flex rows), one gesture each, plus a status
 * bar. Pan is shown as a live bar (width signal) instead of a draggable
 * square: x/y are ignored inside a flex container.
 *
 * Every gesture target is a NON-scrollable View (scroll:'none'). Inside a
 * scrollable container a drag belongs to LVGL scrolling, so gestures yield.
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
var panX = signal(0), panY = signal(0);

function echo(e) {
  var s = e.type + ' (' + e.x + ',' + e.y + ')';
  if (e.dir) s += ' ' + e.dir;
  status.set(s);
}
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

function card(children) {
  return View({ style: {
    flexGrow: 1, height: '100%',
    background: 'card', borderColor: 'line', borderWidth: 1,
    display: 'flex', flexDirection: 'column',
    alignItems: 'start', justifyContent: 'start',
    padding: 14, gap: 12, scroll: 'none'   /* gestures win over scrolling */
  } }, children);
}
function title(t) { return Text({ text: t, style: {} }); }

/* ---- tap: count ---- */
var tapCard = card([
  title('TAP'),
  Text({ text: function () { return 'count ' + taps(); }, style: {} })
]);
lume.gesture.on(tapCard, 'tap', function (e) { taps.set(taps() + 1); echo(e); });

/* ---- swipe: change page by direction ---- */
var swipeCard = card([
  title('SWIPE'),
  Text({ text: function () { return 'page ' + page() + '/4'; }, style: {} })
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
var longCard = card([
  title('LONGPRESS'),
  Text({ text: function () { return hot() ? 'HOT' : 'hold me'; }, style: {} })
]);
lume.gesture.on(longCard, 'longpress', function (e) { hot.set(!hot()); echo(e); });

/* ---- pan: live displacement bars (width tracks the finger delta) ---- */
var panCard = card([
  title('PAN'),
  Text({ text: function () { return 'dx ' + panX() + '  dy ' + panY(); }, style: {} }),
  View({ style: { width: '100%', height: 12, background: '#16283A', scroll: 'none' } }, [
    View({ style: { width: function () { return clamp(Math.abs(panX()) * 3, 2, 100); },
      height: 12, background: '#F0A030' }, scroll: 'none' })
  ]),
  View({ style: { width: '100%', height: 12, background: '#16283A', scroll: 'none' } }, [
    View({ style: { width: function () { return clamp(Math.abs(panY()) * 3, 2, 100); },
      height: 12, background: '#38BDF8' }, scroll: 'none' })
  ])
]);
var lastDx = 0, lastDy = 0;
lume.gesture.on(panCard, 'panstart', function (e) { lastDx = e.dx; lastDy = e.dy; echo(e); });
lume.gesture.on(panCard, 'pan', function (e) {
  panX.set(clamp(panX() + (e.dx - lastDx), -40, 40));
  panY.set(clamp(panY() + (e.dy - lastDy), -40, 40));
  lastDx = e.dx; lastDy = e.dy;
  echo(e);
});
lume.gesture.on(panCard, 'panend', function (e) { echo(e); });

/* ---- root: title + 2x2 grid + status bar, all flex ---- */
var gridRow = function (a, b) {
  return View({ style: {
    width: '100%', flexGrow: 1,
    display: 'flex', flexDirection: 'row', gap: 12
  } }, [a, b]);
};

View({ style: {
  width: '100%', height: '100%', background: 'bg', scroll: 'none',
  display: 'flex', flexDirection: 'column', padding: 40, gap: 12
} }, [
  Text({ text: 'Gesture lab r21', style: {} }),
  gridRow(tapCard, swipeCard),
  gridRow(longCard, panCard),
  View({ style: { width: '100%', height: 44,
    background: 'card', borderColor: 'line', borderWidth: 1,
    display: 'flex', flexDirection: 'row', alignItems: 'center',
    paddingLeft: 12, scroll: 'none' } }, [
    Text({ text: function () { return 'last: ' + status(); }, style: {} })
  ])
]);
