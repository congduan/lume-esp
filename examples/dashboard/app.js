/** LUME HUB — canvas-first demo, pure JS on the existing API (no firmware
 * change). One 400x360 Canvas renders three pages; three buttons and a swipe
 * gesture switch between them.
 *
 *   page 0  GAUGE   battery ring + power/temperature readouts
 *   page 1  TRACE   live 3-axis accelerometer strip chart (5 Hz)
 *   page 2  SYSTEM  device inventory + radio/storage state
 *
 * Canvas is the only drawing surface available to apps besides Views (and its
 * text is fixed at 14 px), so the "professional" look comes from layering:
 * recessed dial faces, thin tracks, round-capped arcs and hairline grids.
 *
 * MESSAGE BUDGET: each canvasDraw() is one message on the 128-slot UI queue and
 * the canvas redraws on every publish(), so every page is kept under ~100
 * primitives. polyline() expands to one line per point pair, hence the strict
 * point counts below. */
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
  var segs = [], x0 = 44, y0 = 44, width = 340, height = 200;
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
  /* readSlow() always publishes nine info rows, so eight separators at fixed
   * y positions. */
  var segs = [];
  for (var i = 0; i < 8; i++) segs.push([16, 82 + i * 30, W - 16, 82 + i * 30]);
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
 * The existing canvas still renders TRACE and SYSTEM without changing navigation. */
var gaugeCards=[View({style:{x:0,y:0,width:480,height:396,background:'bg',scroll:'none'}})];
function metricCard(x,y,label,value,unit){
  var id=View({style:{x:x,y:y,width:204,height:129,background:'surface',borderRadius:12,padding:16,
    display:'flex',flexDirection:'column',justifyContent:'space-between',gap:8,scroll:'none'}},[
    Text({text:label,style:{fontSize:13,color:'textDim'}}),
    Text({text:value,style:{fontSize:24,color:'text'}}),
    Text({text:unit,style:{fontSize:11,color:'textDim'}})
  ]);gaugeCards.push(id);
}
metricCard(24,80,'BATTERY',function(){return Math.round(view().pct)+'%';},'Charge level');
metricCard(252,80,'TEMPERATURE',function(){return view().temp;},'Board sensor');
metricCard(24,220,'USB POWER',function(){return view().vbus;},'VBUS input');
metricCard(252,220,'UPTIME',function(){return view().uptime;},'Since start');
gaugeCards.push(Text({text:'LUME HUB',style:{x:24,y:24,width:300,height:32,fontSize:24,color:'text'}}));
gaugeCards.push(Text({text:function(){return view().charge+'  /  accelerometer live';},style:{x:24,y:364,width:432,height:20,fontSize:13,color:'textDim'}}));
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
  var x0 = 44, y0 = 44, width = 340, height = 200;
  var mid = y0 + height / 2;
  ctx.text(16, 8, 'ACCEL TRACE', C_DIM, 14);
  ctx.text(300, 8, '5 Hz / +-10', hubTheme.colors.surfaceAlt, 14);

  /* The 5+5 hairline grid is a retained path now (r49 #6); only the live
   * trace polylines and the legend below are dynamic. */
  var data = v.trace;
  if (data.length > 1) {
    var series = [
      { key: 0, color: C_RED },
      { key: 1, color: C_GREEN },
      { key: 2, color: C_BLUE }
    ];
    for (var s = 0; s < series.length; s++) {
      var pts = [];
      for (var i = 0; i < data.length; i++) {
        pts.push([
          Math.round(x0 + width * i / (TRACE_POINTS - 1)),
          Math.round(mid - clamp(data[i][series[s].key] * 9, -100, 100))
        ]);
      }
      if (pts.length > 1) ctx.polyline(pts, series[s].color, 2);
      var last = pts[pts.length - 1];
      ctx.circle(last[0], last[1], 3, series[s].color);
    }
  }

  /* legend with live values */
  ctx.text(16, 268, 'X ' + v.ax.toFixed(2), C_RED, 14);
  ctx.text(120, 268, 'Y ' + v.ay.toFixed(2), C_GREEN, 14);
  ctx.text(224, 268, 'Z ' + v.az.toFixed(2), C_BLUE, 14);
  ctx.text(16, 300, 'samples ' + data.length + ' / ' + TRACE_POINTS, C_DIM, 14);
  ctx.text(16, 330, 'swipe left / right to change page', hubTheme.colors.surfaceAlt, 14);
}

function drawSystem(ctx, v) {
  ctx.text(16, 8, 'SYSTEM', C_DIM, 14);
  ctx.text(16, 26, 'runtime inventory', hubTheme.colors.surfaceAlt, 14);
  var rows = v.info;
  for (var i = 0; i < rows.length; i++) {
    var y = 62 + i * 30;
    ctx.text(16, y, rows[i][0], C_DIM, 14);
    ctx.text(200, y, rows[i][1], C_TEXT, 14);
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
    ['UPTIME', Math.floor((lume._nowMs() - startedMs) / 1000) + 's']
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

function tab(x, index, label) {
  return Button({ title: label, style: {
    x: x, y: 400, width: 136, height: 56,
    background: function () { return view().page === index ? 'accent' : 'surface'; },
    borderColor: hubTheme.colors.surfaceAlt, borderWidth: 1, borderRadius: 10
  }, onPress: function () { go(index); } });
}

tab(24, 0, 'GAUGE');
tab(172, 1, 'TRACE');
tab(320, 2, 'SYSTEM');

/* Bottom indicator pill: a quiet hint that an upward swipe leaves the app. */
View({ style: { width: 64, height: 3, background: hubTheme.colors.surfaceAlt, borderRadius: 2 },
  align: 'bottom-mid', alignOffset: { y: -10 } });
