/** LUME HUB -- canvas-first demo, pure JS on the existing API (no firmware
 * change). One 400x360 Canvas renders three pages; the TRACE page overlays a
 * signal-backed shell.Sparkline for the 3-axis strip. Three buttons and a
 * swipe gesture switch between them.
 *
 *   page 0  GAUGE   battery ring + power/temperature readouts
 *   page 1  TRACE   live 3-axis accelerometer strip chart (5 Hz)
 *   page 2  SYSTEM  device inventory + radio/storage state + OTA listener
 *
 * Canvas is the only drawing surface available to apps besides Views (and its
 * text is fixed at 14 px), so the "professional" look comes from layering:
 * recessed dial faces, thin tracks, round-capped arcs and hairline grids.
 *
 * MESSAGE BUDGET: each canvasDraw() is one message on the 128-slot UI queue and
 * the canvas redraws on every publish(), so every page is kept under ~100
 * primitives. polyline() expands to one line per point pair, hence the strict
 * point counts below. */
import '../../runtime/shell.js';
var hubTheme={colors:{bg:'#07111D',primary:'#07111D',surface:'#132435',surfaceAlt:'#1C3449',text:'#F2F7FB',textDim:'#9EB3C6',accent:'#40D8B0',danger:'#FF6B79',success:'#40D8B0'},radius:12,spacing:12,fontScale:1};
lume.theme.set(hubTheme);

var SAFE = 40;
var W = 400;
var H = 360;
var TRACE_POINTS = 24;

var C_TEXT = hubTheme.colors.text;
var C_DIM = hubTheme.colors.textDim;
var C_TRACK = hubTheme.colors.surfaceAlt;
var C_FACE = hubTheme.colors.surface;
var C_RED = hubTheme.colors.danger;
var C_GREEN = hubTheme.colors.success;
var C_BLUE = hubTheme.colors.accent;
var C_AMBER = hubTheme.colors.accent;

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function num(v, digits) {
  if (typeof v !== 'number' || !isFinite(v) || v < 0) return '--';
  return v.toFixed(digits);
}
function polarX(cx, r, deg) { return Math.round(cx + r * Math.cos(deg * Math.PI / 180)); }
function polarY(cy, r, deg) { return Math.round(cy + r * Math.sin(deg * Math.PI / 180)); }

/* polyline() emits one line per adjacent point pair, so `step` is a direct
 * message cost: 5 deg is smooth, 10 deg is fine for a dim background ring.
 * Kept for reference; the GAUGE ring is now a native Arc widget, so the
 * canvas's own static geometry is just the hairline grids/separators below. */
function arc(ctx, cx, cy, r, startDeg, endDeg, color, width, step) {
  var inc = step || 10;
  var pts = [];
  for (var a = startDeg; a <= endDeg; a += inc) {
    pts.push([polarX(cx, r, a), polarY(cy, r, a)]);
  }
  if (pts.length > 1) ctx.polyline(pts, color, width);
}

/* r49 #6: hairline grids/separators are static geometry. Upload each page's
 * lines once as a retained path and replay it from C, instead of queueing
 * ctx.line() calls in JS on every publish(). Retained paths replay the same
 * canvas_line() raster, so the picture is unchanged. */
function gaugeStaticLines() { return [[16, 268, W - 16, 268]]; }
function traceStaticLines() {
  /* r214/r216: the grid backs the shell.Sparkline overlay; keep it aligned and
   * inside the safe square (canvas-local 44..356, 60..240 -> screen 84..396,
   * 100..280), clearing the TRACE header and bottom tab bar at y=352..400. */
  var segs = [], x0 = 44, y0 = 60, width = 312, height = 180;
  for (var g = 0; g <= 4; g++) {
    var gy = Math.round(y0 + height * g / 4);
    segs.push([x0, gy, x0 + width, gy]);
  }
  for (var gx = 0; gx <= 4; gx++) {
    var xx = Math.round(x0 + width * gx / 4);
    segs.push([xx, y0, xx, y0 + height]);
  }
  return segs;
}
function systemStaticLines() {
  /* readSlow() always publishes ten info rows (r132: one more for OTA), so
   * nine separators at fixed y positions. r216: inset to safe-square x=44..W-44
   * (screen 84..396) and 24 px row pitch so row 9 lands at local y=278
   * (screen 318..332), clearing the safe-square tab bar at screen y=352..400. */
  var segs = [];
  for (var i = 0; i < 9; i++) segs.push([44, 81 + i * 24, W - 44, 81 + i * 24]);
  return segs;
}
var STATIC_LINES = [gaugeStaticLines(), traceStaticLines(), systemStaticLines()];

var CHARGE_STATES = ['trickle', 'pre-charge', 'CC', 'CV', 'done', 'idle'];
var NET_STATES = ['idle', 'joining', 'linked', 'got ip'];
var BLE_STATES = ['idle', 'adv', 'linked'];

/* Single view model: every publish() replaces it, which redraws the canvas and
 * repaints the tab highlight in one shot. */
var view = signal({
  page: 0,
  pct: 0, volts: '--', vbus: '--', charge: '--', temp: '--', uptime: '0s',
  ax: 0, ay: 0, az: 0,
  trace: [],
  info: []
});

var currentPage = 0;
var buf = [];
var lastAx = 0, lastAy = 0, lastAz = 0;
var startedMs = lume._nowMs();
var timer = null;
var tick = 0;

/* Hardware page key: the board's BOOT button sits on GPIO0 and reads low while
 * pressed. Polled from the same 200 ms loop (that is the debounce), and only
 * the 1->0 edge advances the page, so holding it down does not spin through
 * pages. */
var BTN_PIN = 0;
var btnLast = 1;
var btnReady = lume.gpio.setPin(BTN_PIN, 0, 1) === 0;
var bleProbed = false;
var bleReady = false;
var radioText = 'off';
var storageText = '--';
var otaText = 'ota off';   /* r132: SYSTEM-page OTA listener status */

/* --- canvas ------------------------------------------------------------- */

/* Full-bleed backdrop: the panel is 480x480 and the canvas only covers the
 * 400x360 content area, so without this the inset showed the screen's own
 * black. Created first so it stays the bottom-most node. */
var backdrop = View({ style: { x: 0, y: 0, width: 480, height: 480, background: hubTheme.colors.bg,
  borderWidth: 0, borderRadius: 0, scroll: 'none' } });

var canvas = Canvas({ width: W, height: H, style: { x: SAFE, y: SAFE, borderRadius: 0 },
  onDraw: function (ctx) {
    var v = view();
    ctx.clear();
    ctx.fillColor(hubTheme.colors.bg);
    ctx.fillRect(0, 0, W, H);
    /* r49 #6: the page's static hairline geometry is uploaded once and
     * replayed from C; drawGauge/drawTrace/drawSystem now draw only the
     * dynamic text, traces and bars. */
    if (!ctx.pagePaths) ctx.pagePaths = [0, 0, 0];
    var p = v.page;
    if (!ctx.pagePaths[p]) ctx.pagePaths[p] = ctx.retainSegments(STATIC_LINES[p], hubTheme.colors.surfaceAlt, 1);
    ctx.drawPath(ctx.pagePaths[p]);
    if (v.page === 1) drawTrace(ctx, v);
    else if (v.page === 2) drawSystem(ctx, v);
    else drawGauge(ctx, v);
  } });

/* Native ring gauge. Sized so its stroke centre lines up with the canvas
 * readout at (112,132) local -> (152,172) on screen. */
var battArc = Arc({
  style: { x: 78, y: 98, width: 148, height: 148, borderRadius: 0,
    background: function () {
      var p = view().pct;
      return p >= 60 ? C_GREEN : p >= 25 ? C_AMBER : C_RED;
    } },
  value: function () { return view().pct; },
  start: 135, end: 45, thickness: 10, track: C_TRACK
});

/* Native metric cards make the landing page readable at arm's length.
 * The existing canvas still renders TRACE and SYSTEM without changing navigation.
 * r214/r216: cards, title and status line all sit in the round safe square
 * [75,405] above the safe-square tab bar (y=352..400). Two 150px columns with
 * a 12px gutter clear the 8px gap minimum; 84..396 leaves a 9px inset inside
 * the safe square on both edges. */
var gaugeCards=[View({style:{x:0,y:0,width:480,height:348,background:'bg',scroll:'none'}})];
function metricCard(x,y,label,value,unit){
  var id=View({style:{x:x,y:y,width:150,height:98,background:'surface',borderRadius:12,padding:12,
    display:'flex',flexDirection:'column',justifyContent:'space-between',gap:4,scroll:'none'}},[
    Text({text:label,style:{fontSize:14,color:'textDim'}}),
    Text({text:value,style:{fontSize:24,color:'text'}}),
    Text({text:unit,style:{fontSize:14,color:'textDim'}})
  ]);gaugeCards.push(id);
}
metricCard(84,112,'BATTERY',function(){return Math.round(view().pct)+'%';},'Charge level');
metricCard(246,112,'TEMPERATURE',function(){return view().temp;},'Board sensor');
metricCard(84,222,'USB POWER',function(){return view().vbus;},'VBUS input');
metricCard(246,222,'UPTIME',function(){return view().uptime;},'Since start');
gaugeCards.push(Text({text:'LUME HUB',style:{x:84,y:78,width:312,height:28,fontSize:24,color:'text'}}));
gaugeCards.push(Text({text:function(){return view().charge+'  /  accelerometer live';},style:{x:84,y:326,width:312,height:20,fontSize:14,color:'textDim'}}));
lume.setAttr(battArc,5,0);

function drawGauge(ctx, v) {
  var cx = 112, cy = 132, r = 64;
  ctx.text(16, 8, 'BATTERY', C_DIM, 14);

  /* The ring itself is a native Arc node layered above this canvas: LVGL draws
   * it with coverage, so it stays smooth instead of stair-stepping like the
   * Canvas rasteriser. Only the centred readout is painted here. */
  var pct = clamp(v.pct, 0, 100);
  ctx.text(cx - 20, cy - 18, Math.round(pct) + '%', C_TEXT, 14);
  ctx.text(cx - 24, cy + 4, v.volts, hubTheme.colors.textDim, 14);

  /* readout column */
  ctx.text(248, 44, 'TEMP', C_DIM, 14);
  ctx.text(248, 62, v.temp, C_TEXT, 14);
  ctx.text(248, 96, 'VBUS', C_DIM, 14);
  ctx.text(248, 114, v.vbus, C_TEXT, 14);
  ctx.text(248, 148, 'CHARGER', C_DIM, 14);
  ctx.text(248, 166, v.charge, C_TEXT, 14);
  ctx.text(248, 200, 'UPTIME', C_DIM, 14);
  ctx.text(248, 218, v.uptime, C_TEXT, 14);

  /* 3-axis strip (the hairline separator is now a retained path, r49 #6) */
  ctx.text(16, 282, 'ACCEL', C_DIM, 14);
  ctx.text(16, 316, 'X ' + v.ax.toFixed(2), C_RED, 14);
  ctx.text(136, 316, 'Y ' + v.ay.toFixed(2), C_GREEN, 14);
  ctx.text(256, 316, 'Z ' + v.az.toFixed(2), C_BLUE, 14);

  /* miniature bar for each axis, centred on zero */
  var baseY = 300, pick = [v.ax, v.ay, v.az], cols = [C_RED, C_GREEN, C_BLUE];
  for (var i = 0; i < 3; i++) {
    var h = clamp(Math.round(pick[i] * 3), -26, 26);
    ctx.fillColor(cols[i]);
    ctx.fillRect(20 + i * 120, h >= 0 ? baseY - h : baseY, 100, Math.abs(h) || 1);
  }
}

function drawTrace(ctx, v) {
  var data = v.trace;
  ctx.text(44, 40, 'ACCEL TRACE', C_DIM, 14);
  ctx.text(260, 40, '5 Hz / +-10', hubTheme.colors.surfaceAlt, 14);

  /* r194: the 5+5 hairline grid stays a retained path on this canvas; the
   * live polylines moved to a shell.Sparkline overlay whose series getters
   * read view().trace inside its own onDraw. Only the legend and the sample
   * count remain dynamic on this canvas. */

  /* legend with live values (r216: inset to safe square above y=352 tabs) */
  ctx.text(44, 248, 'X ' + v.ax.toFixed(2), C_RED, 14);
  ctx.text(148, 248, 'Y ' + v.ay.toFixed(2), C_GREEN, 14);
  ctx.text(252, 248, 'Z ' + v.az.toFixed(2), C_BLUE, 14);
  ctx.text(44, 270, 'samples ' + data.length + ' / ' + TRACE_POINTS, C_DIM, 14);
  ctx.text(44, 290, 'swipe left / right to change page', hubTheme.colors.surfaceAlt, 14);
}

function drawSystem(ctx, v) {
  ctx.text(44, 38, 'SYSTEM', C_DIM, 14);
  ctx.text(156, 38, 'runtime inventory', hubTheme.colors.surfaceAlt, 14);
  var rows = v.info;
  for (var i = 0; i < rows.length; i++) {
    var y = 62 + i * 24;
    ctx.text(44, y, rows[i][0], C_DIM, 14);
    ctx.text(168, y, rows[i][1], C_TEXT, 14);
    /* Row separators are a retained path (r49 #6). */
  }
}

/* --- data --------------------------------------------------------------- */

function readSlow() {
  var mv = lume.pmic.battVoltageMv();
  var pct = lume.pmic.battPercent();
  var vbus = lume.pmic.vbusVoltageMv();
  var usb = lume.pmic.usbConnected();
  var charge = lume.pmic.chargingStatus();
  var raw = lume.pmic.dieTempRaw();

  var net = lume.net.status();
  var netText = 'off';
  var ipText = '--';
  if (typeof net === 'object' && net !== null) {
    netText = NET_STATES[net.state] || ('state ' + net.state);
    if (net.ip !== null && net.ip !== undefined) ipText = String(net.ip);
  }

  if (!bleProbed) {
    bleProbed = true;
    var probe = lume.ble.status();
    bleReady = typeof probe === 'object' && probe !== null;
    radioText = bleReady ? (BLE_STATES[probe.state] || 'state') : 'off';
  } else if (bleReady) {
    var ble = lume.ble.status();
    if (typeof ble === 'object' && ble !== null) radioText = BLE_STATES[ble.state] || 'state';
  }

  var mounted = lume.storage.Fs.mounted();
  var keys = lume.storage.kv.keys();
  storageText = (mounted === true ? 'fs ok' : 'fs --') +
    (typeof keys === 'object' && keys !== null ? ' ' + keys.length + ' kv' : '');

  /* ---- r132: OTA status line BEGIN ---- */
  /* Local snapshot only: a number return is an error code, not a status bag.
   * The token field is never read -- it stays on the serial log. */
  var ota = lume.ota.status();
  if (typeof ota === 'object' && ota !== null) {
    otaText = !ota.running ? 'ota off' :
      (!ota.wifiReady ? 'ota wifi down' :
       (!ota.tokenReady ? 'ota no token' : 'ota :' + ota.port + (ota.hmac ? ' hmac' : '')));
  } else {
    otaText = 'ota err ' + ota;
  }
  /* ---- r132: OTA status line END ---- */

  var shownPct = pct < 0 ? 0 : (pct > 100 ? 100 : pct);
  var voltsText = num(mv, 0) === '--' ? '--' : (mv / 1000).toFixed(2) + ' V';
  var vbusText = usb === 1 ? (vbus < 0 ? '--' : (vbus / 1000).toFixed(2) + ' V') : 'none';
  var chargeText = charge < 0 ? '--' : (CHARGE_STATES[charge] || ('st ' + charge));
  var tempText = raw < 0 ? '--' : (22 + (7274 - raw) / 20).toFixed(1) + ' C';

  slow.pct = shownPct;
  slow.volts = voltsText;
  slow.vbus = vbusText;
  slow.charge = chargeText;
  slow.temp = tempText;
  slow.info = [
    ['SOC', 'ESP32-S3'],
    ['FLASH', '16 MB'],
    ['PSRAM', '8 MB'],
    ['WIFI', netText],
    ['IP', ipText],
    ['BLE', radioText],
    ['STORAGE', storageText],
    ['TEMP', tempText],
    ['UPTIME', Math.floor((lume._nowMs() - startedMs) / 1000) + 's'],
    ['OTA', otaText]   /* r132: 10th row, same canvas line layout */
  ];
}
var slow = { pct: 0, volts: '--', vbus: '--', charge: '--', temp: '--', info: [] };

function publish() {
  view.set({
    page: currentPage,
    pct: slow.pct, volts: slow.volts, vbus: slow.vbus,
    charge: slow.charge, temp: slow.temp,
    uptime: Math.floor((lume._nowMs() - startedMs) / 1000) + 's',
    ax: lastAx, ay: lastAy, az: lastAz,
    trace: buf.slice(),
    info: slow.info
  });
}

function loop() {
  tick++;
  var sample = lume.imu.read();
  if (sample) {
    lastAx = sample.ax; lastAy = sample.ay; lastAz = sample.az;
    if (currentPage === 1) {
      buf.push([sample.ax, sample.ay, sample.az]);
      if (buf.length > TRACE_POINTS) buf.shift();
    }
  }
  if (btnReady) {
    var level = lume.gpio.read(BTN_PIN);
    if (level === 0 && btnLast === 1) go((currentPage + 1) % 3);
    if (level === 0 || level === 1) btnLast = level;
  }
  if (tick % 2 === 0) readSlow();          /* PMIC / radio / storage at 2 Hz */
  if (currentPage === 1 || tick % 3 === 0) publish();
}

function go(page) {
  currentPage = page;
  /* The arc is a native node layered over the canvas, so it does not get
   * erased by a canvas repaint: hide it explicitly off page 0. */
  if (typeof battArc === 'number') lume.setAttr(battArc, 5, 0);
  for(var c=0;c<gaugeCards.length;c++)lume.setAttr(gaugeCards[c],5,page===0?1:0);
  lume.setAttr(traceSpark, 5, page===1?1:0);
  if (page === 1) {
    buf = [];
    for (var i = 0; i < 6; i++) buf.push([0, 0, 0]);
  }
  publish();
}

function start() {
  if (timer !== null) return;
  readSlow();
  publish();
  timer = lume.system.setInterval(loop, 200);
}

function stop() {
  if (timer === null) return;
  lume.system.clearInterval(timer);
  timer = null;
}

lume.app.onStart(start);
lume.app.onPause(stop);
lume.app.onResume(start);

/* Swipe anywhere to change page. Bound to the backdrop, not the canvas: a
 * canvas is an lv_image and does not accept input, so pointer events fall
 * through to the clickable View underneath it. */
lume.gesture.on(backdrop, 'swipe', function (e) {
  if (e.dir === 'left') go((currentPage + 1) % 3);
  else if (e.dir === 'right') go((currentPage + 2) % 3);
});

/* --- tab bar ------------------------------------------------------------ */

/* r216: three 98x48 tabs with 9px gaps inside safe square [84..396, 352..400]. */
function tab(x, index, label) {
  return Button({ title: label, style: {
    x: x, y: 352, width: 98, height: 48,
    background: function () { return view().page === index ? 'accent' : 'surface'; },
    borderColor: hubTheme.colors.surfaceAlt, borderWidth: 1, borderRadius: 10
  }, onPress: function () { go(index); } });
}

tab(84, 0, 'GAUGE');
tab(191, 1, 'TRACE');
tab(298, 2, 'SYSTEM');

/* r194: the TRACE strip is now a shell.Sparkline overlay. The signal stays
 * with the caller -- each series getter reads view().trace inside the
 * component's onDraw, so publish() repaints it. r214/r216 places the overlay
 * in SCREEN coords (84,100) 312x180 so it lands inside the safe square above
 * the tab bar and lines up with the retained grid. The explicit domain and
 * showLast keep that scale and the per-axis end markers. Created last so it
 * layers above the canvas grid; go() hides it off page 1. */
var traceSpark = lume.ui.shell.Sparkline({ x: 84, y: 100, width: 312, height: 180,
  min: -100, max: 100, strokeWidth: 2, showLast: true,
  series: [
    { data: function () { return view().trace.map(function (t) { return t[0] * 9; }); }, color: C_RED },
    { data: function () { return view().trace.map(function (t) { return t[1] * 9; }); }, color: C_GREEN },
    { data: function () { return view().trace.map(function (t) { return t[2] * 9; }); }, color: C_BLUE }
  ] });
lume.setAttr(traceSpark, 5, 0);

/* Bottom indicator pill: a quiet hint that an upward swipe leaves the app. */
View({ style: { width: 64, height: 3, background: hubTheme.colors.surfaceAlt, borderRadius: 2 },
  align: 'bottom-mid', alignOffset: { y: -10 } });
