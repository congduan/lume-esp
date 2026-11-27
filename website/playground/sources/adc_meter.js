/** ADC voltage meter: lume.adc ADC1 readout with sparkline trend & scale bar.
 *
 *  Samples GPIO 1..10 (ADC1) once every 250 ms (4 Hz) through lume.adc.config /
 *  readRaw / readMv. Buttons cycle the sampled pin (1..10) and attenuation
 *  (0..3 = DB_0 / DB_2_5 / DB_6 / DB_12). Every native return is a NUMBER:
 *  0 means success, a NEGATIVE value is an error code (-1 bad arg, -2 driver /
 *  calibration failure, -3 pin not configured or calibration unavailable).
 *  Negative values are tested numerically (v < 0), never by truthiness.
 *
 *  NODE BUDGET: the firmware node table is LUME_MAX_NODES = 128 slots. This
 *  app builds ONE static tree of 20 nodes inside the [76, 404] round AMOLED
 *  safe square and never creates a node at runtime. The sparkline Canvas uses
 *  <= 40 draw calls per refresh (budget <= 240).
 *
 *  ASCII-only UI copy (r64). Real ADC sampling & eFuse calibration stay
 *  deferred to board bring-up.
 *
 *  LIFECYCLE: no lume.adc.free() call (no app unload hook; config is last-wins).
 */
var ADC_PIN_MIN = 1, ADC_PIN_MAX = 10, ADC_ATTEN_MAX = 3;
var RAW_MAX = 4095;
var FULL_SCALE_MV = 3300;
var HISTORY_LEN = 16;
var adc = lume.adc;
var pin = 3, atten = 0;
var history = [];

var theme = { colors: {
  bg: '#000000', primary: '#09101A', surface: '#16202E', surfaceAlt: '#1F2C3D',
  text: '#F2F7FB', textDim: '#9EB3C6', accent: '#40D8B0', danger: '#FF6B79', success: '#40D8B0'
}, radius: 12, spacing: 12, fontScale: 1 };
lume.theme.set(theme);

var rawDisplay = signal('0'), mvDisplay = signal('0'), mvValue = signal(0);
var pinDisplay = signal('GPIO ' + pin), attenDisplay = signal('ATT ' + atten), cfgDisplay = signal('');
var sampleSeq = signal(0);

function clampInt(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function errText(code) { return 'err ' + code; }

function barRatio() {
  var v = mvValue();
  if (v <= 0) return 0;
  var r = v / FULL_SCALE_MV;
  return r > 1 ? 1 : r;
}

function applyConfig() {
  pin = clampInt(pin, ADC_PIN_MIN, ADC_PIN_MAX);
  atten = clampInt(atten, 0, ADC_ATTEN_MAX);
  var st = adc.config(pin, atten);
  cfgDisplay.set(st === 0 ? 'CFG OK' : errText(st));
  pinDisplay.set('GPIO ' + pin);
  attenDisplay.set('ATT ' + atten);
  return st;
}

function cyclePin() {
  pin = pin >= ADC_PIN_MAX ? ADC_PIN_MIN : pin + 1;
  return applyConfig();
}

function cycleAtten() {
  atten = atten >= ADC_ATTEN_MAX ? 0 : atten + 1;
  return applyConfig();
}

function refresh() {
  var r = adc.readRaw(pin);
  var m = adc.readMv(pin);
  rawDisplay.set(r < 0 ? errText(r) : (r > RAW_MAX ? 'RAW OOR' : String(r)));
  mvDisplay.set(m < 0 ? errText(m) : String(m));
  var clamped = m < 0 ? 0 : m;
  mvValue.set(clamped);
  history.push(clamped > FULL_SCALE_MV ? FULL_SCALE_MV : clamped);
  if (history.length > HISTORY_LEN) history.shift();
  sampleSeq.set(sampleSeq() + 1);
  return { raw: r, mv: m };
}

var meter = Canvas({ width: 320, height: 94, style: { position: 'absolute', x: 4, y: 150, scroll: 'none' },
  onDraw: function (c) {
    sampleSeq();
    var ratio = barRatio();
    c.fillColor('#09101A'); c.fillRect(0, 0, 320, 94);
    c.fillColor('#233245'); c.fillRect(0, 0, 320, 94);
    c.fillColor('#0F1926'); c.fillRect(1, 1, 318, 92);
    c.text(10, 6, 'TREND ADC1', '#5C7794');
    c.text(254, 6, Math.round(ratio * 100) + '% FS', '#5C7794');
    /* 3 subtle horizontal gridlines */
    c.line(10, 30, 310, 30, '#1B2838', 1);
    c.line(10, 48, 310, 48, '#1B2838', 1);
    c.line(10, 66, 310, 66, '#1B2838', 1);
    /* Sparkline polyline (<= 15 segments) */
    var n = history.length;
    if (n === 1) {
      var y0 = 68 - Math.round((history[0] / FULL_SCALE_MV) * 40);
      c.line(10, y0, 306, y0, '#40D8B0', 2);
      c.fillCircle(306, y0, 4, '#40D8B0');
    } else if (n > 1) {
      var step = 296 / (HISTORY_LEN - 1);
      var startX = 306 - (n - 1) * step;
      var px = Math.round(startX);
      var py = 68 - Math.round((history[0] / FULL_SCALE_MV) * 40);
      for (var i = 1; i < n; i++) {
        var nx = Math.round(startX + i * step);
        var ny = 68 - Math.round((history[i] / FULL_SCALE_MV) * 40);
        c.line(px, py, nx, ny, '#40D8B0', 2);
        px = nx; py = ny;
      }
      c.fillCircle(px, py, 5, '#195449');
      c.fillCircle(px, py, 3, '#40D8B0');
    }
    /* Bottom linear scale bar */
    c.fillColor('#1F2C3D'); c.fillRect(10, 78, 300, 6);
    var w = Math.round(300 * ratio);
    if (w > 0) {
      c.fillColor('#40D8B0'); c.fillRect(10, 78, w, 6);
    }
  } });

View({ style: { width: '100%', height: '100%', background: '#000000', scroll: 'none' } }, [
  View({ style: {
    position: 'absolute', x: 14, y: 14, width: 452, height: 452,
    borderRadius: 226, background: '#09101A', borderWidth: 1, borderColor: '#1E2D3F',
    scroll: 'none'
  } }),
  View({ style: {
    position: 'absolute', x: 76, y: 76, width: 328, height: 328,
    background: '#09101A', scroll: 'none'
  } }, [
    /* Top header + sampling rate + config badge */
    Text({ text: 'ADC Voltmeter', style: {
      position: 'absolute', x: 4, y: 2, width: 174, height: 26,
      fontSize: 19, color: '#F2F7FB'
    } }),
    View({ style: {
      position: 'absolute', x: 184, y: 3, width: 52, height: 22,
      background: '#16202E', borderColor: '#233245', borderWidth: 1, borderRadius: 11,
      display: 'flex', alignItems: 'center', justifyContent: 'center', scroll: 'none'
    } }, [
      Text({ text: '4 Hz', style: { fontSize: 11, color: '#9EB3C6', textAlign: 'center' } })
    ]),
    View({ style: {
      position: 'absolute', x: 242, y: 3, width: 82, height: 22,
      background: function () { return cfgDisplay() === 'CFG OK' ? '#122A2B' : '#2A1720'; },
      borderColor: function () { return cfgDisplay() === 'CFG OK' ? '#2E7D6B' : '#7A3240'; },
      borderWidth: 1, borderRadius: 11,
      display: 'flex', alignItems: 'center', justifyContent: 'center', scroll: 'none'
    } }, [
      Text({ text: cfgDisplay, style: {
        fontSize: 11, textAlign: 'center',
        color: function () { return cfgDisplay() === 'CFG OK' ? '#40D8B0' : '#FF6B79'; }
      } })
    ]),

    /* Hero readout card */
    View({ style: {
      position: 'absolute', x: 4, y: 34, width: 320, height: 108,
      background: '#142030', borderColor: '#233245', borderWidth: 1, borderRadius: 12,
      scroll: 'none'
    } }, [
      Text({ text: mvDisplay, style: {
        position: 'absolute', x: 14, y: 10, width: 196, height: 50,
        fontSize: 44, color: '#40D8B0'
      } }),
      Text({ text: 'mV', style: {
        position: 'absolute', x: 216, y: 18, width: 90, height: 22,
        fontSize: 17, color: '#F2F7FB', textAlign: 'right'
      } }),
      Text({ text: '0-3300 mV', style: {
        position: 'absolute', x: 216, y: 42, width: 90, height: 16,
        fontSize: 11, color: '#9EB3C6', textAlign: 'right'
      } }),
      Text({ text: 'RAW 0..4095', style: {
        position: 'absolute', x: 14, y: 76, width: 130, height: 20,
        fontSize: 12, color: '#9EB3C6'
      } }),
      Text({ text: rawDisplay, style: {
        position: 'absolute', x: 150, y: 74, width: 156, height: 22,
        fontSize: 16, color: '#F2F7FB', textAlign: 'right'
      } })
    ]),

    /* Sparkline + bar canvas */
    meter,

    /* Pin / Atten controls */
    Button({ title: 'PIN', onPress: cyclePin, style: {
      position: 'absolute', x: 4, y: 252, width: 156, height: 48,
      borderRadius: 12, background: '#16202E', borderColor: '#233245', borderWidth: 1,
      color: '#F2F7FB', fontSize: 14
    } }),
    Button({ title: 'ATTEN', onPress: cycleAtten, style: {
      position: 'absolute', x: 168, y: 252, width: 156, height: 48,
      borderRadius: 12, background: '#16202E', borderColor: '#233245', borderWidth: 1,
      color: '#F2F7FB', fontSize: 14
    } }),
    Text({
      text: function () { return pinDisplay() + '   ' + attenDisplay(); },
      style: {
        position: 'absolute', x: 4, y: 306, width: 320, height: 20,
        fontSize: 13, color: '#9EB3C6', textAlign: 'center'
      }
    })
  ])
]);

applyConfig();
refresh();
lume.system.setInterval(refresh, 250);
