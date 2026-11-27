/**
 * r193: sparkline_demo -- shell.Sparkline mini line charts (pure JS app).
 *
 * One screen with three Canvas sparklines wired to app signals:
 *   - static multi-series (series wins when data is also present)
 *   - live single-series: a 300 ms timer pushes a new sample into a signal
 *   - filled single-series with explicit min/max, fillArea and showLast
 * The data lives in signals; the component reads them inside Canvas.onDraw so
 * a publish repaints. shell.js is bundled by the CLI; no firmware change.
 * All visible copy is ASCII (r64). Touch feel / pixel fidelity deferred to
 * board bring-up.
 */
import '../../runtime/shell.js';

lume.theme.set({ colors: { bg: '#07111D', primary: '#07111D', surface: '#132435',
  surfaceAlt: '#1C3449', text: '#F2F7FB', textDim: '#9EB3C6', accent: '#40D8B0',
  danger: '#FF6B79', success: '#40D8B0' }, radius: 12, spacing: 12 });

var liveData = signal([42, 48, 46, 55, 52, 61, 58, 67]);
var paused = signal(false);
var tick = 0;

var root = View({ style: { x: 0, y: 0, width: 480, height: 480,
  background: 'primary', scroll: 'none' } });

Text({ parent: root, text: 'SPARKLINE DEMO',
  style: { x: 84, y: 88, width: 312, height: 24, fontSize: 20,
    color: '#F2F7FB', scroll: 'none' } });
Text({ parent: root, text: 'shell.Sparkline / Canvas mini charts',
  style: { x: 84, y: 112, width: 312, height: 16, fontSize: 11,
    color: '#9EB3C6', scroll: 'none' } });

/* Static: three series with independent colours; series takes precedence. */
Text({ parent: root, text: 'STATIC / 3 SERIES',
  style: { x: 84, y: 134, width: 312, height: 16, fontSize: 11,
    color: '#9EB3C6', scroll: 'none' } });
var staticSpark = lume.ui.shell.Sparkline({ parent: root, x: 84, y: 152,
  width: 312, height: 44, showDots: false, strokeWidth: 2,
  series: [
    { data: [12, 18, 15, 24, 20, 28], color: '#40D8B0' },
    { data: [30, 22, 26, 14, 19, 11], color: '#5AA9E6' },
    { data: [8, 11, 14, 12, 17, 21], color: '#FFC857', strokeWidth: 1 }
  ] });

/* Live: a getter is passed as `data`; the owned onDraw effect repaints on
 * every set(). The timer keeps a fixed-width window. */
Text({ parent: root, text: 'LIVE / TIMER PUSH 300MS',
  style: { x: 84, y: 200, width: 200, height: 16, fontSize: 11,
    color: '#9EB3C6', scroll: 'none' } });
Text({ parent: root, text: function () { return 'N=' + liveData().length; },
  style: { x: 296, y: 200, width: 100, height: 16, fontSize: 11,
    color: '#40D8B0', textAlign: 'right', scroll: 'none' } });
var liveSpark = lume.ui.shell.Sparkline({ parent: root, x: 84, y: 218,
  width: 312, height: 44, data: liveData, strokeWidth: 3, showLast: true });

/* Filled: explicit domain plus fillArea uses theme surfaceAlt (no alpha in
 * RGB565); showLast marks the newest sample. */
Text({ parent: root, text: 'FILLED / MIN 0 MAX 100',
  style: { x: 84, y: 266, width: 312, height: 16, fontSize: 11,
    color: '#9EB3C6', scroll: 'none' } });
var filledSpark = lume.ui.shell.Sparkline({ parent: root, x: 84, y: 284,
  width: 312, height: 40, data: [20, 45, 30, 70, 55, 80, 65],
  min: 0, max: 100, fillArea: true, showLast: true,
  color: '#FF6B79', strokeWidth: 2 });

var timer = lume.system.setInterval(function () {
  if (paused()) return;
  tick++;
  var next = liveData().slice(1);
  next.push(35 + Math.round(30 * Math.sin(tick / 3)) + (tick % 5));
  liveData.set(next);
}, 300);
lume.app.onPause(function () { lume.system.clearInterval(timer); });

Button({ parent: root, title: function () { return paused() ? 'RESUME' : 'PAUSE'; },
  style: { x: 84, y: 340, width: 96, height: 48, borderRadius: 8,
    background: '#1C3449' },
  onPress: function () { paused.set(!paused()); } });
Text({ parent: root, text: 'Lume shell.Sparkline / pure JS',
  style: { x: 192, y: 348, width: 204, height: 32, fontSize: 11,
    color: '#9EB3C6', scroll: 'none' } });

globalThis.sparklineDemo = {
  staticSpark: staticSpark, liveSpark: liveSpark, filledSpark: filledSpark,
  liveData: liveData, paused: paused, timer: timer, root: root
};
lume.log('SPARKLINE DEMO READY');
