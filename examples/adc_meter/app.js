/** ADC voltage meter: lume.adc ADC1 readout on a canvas bar + numeric labels.
 *
 *  Samples GPIO 1..10 (ADC1) once every 250 ms through lume.adc.config /
 *  readRaw / readMv. Buttons cycle the sampled pin (1..10) and the input
 *  attenuation (0..3 = DB_0 / DB_2_5 / DB_6 / DB_12). Every native return is a
 *  NUMBER: 0 means success, a NEGATIVE value is an error code (-1 bad arg,
 *  -2 driver / calibration failure, -3 pin not configured or calibration
 *  unavailable). Negative values are tested numerically (v < 0), never by
 *  truthiness, and rendered as ASCII "err <code>"; -3 from readMv means the
 *  chip has no eFuse calibration curve, so raw still works but mV does not.
 *
 *  NODE BUDGET: the firmware node table is LUME_MAX_NODES = 128 slots. This
 *  app builds ONE static tree of ~17 nodes and never creates a node at runtime:
 *    root View (1) + header View + 2 Texts (3) + panel View + 6 children (7,
 *    including the single Canvas) + controls View + 5 children (6).
 *  No lists, no dynamic views, so the table stays far under the hard limit.
 *
 *  ASCII-only UI copy (r64). Host harness tests/adc_meter.js runs this app
 *  against STUBBED adc values; real sampling, attenuation voltage ranges and
 *  eFuse curve fitting are deferred to board bring-up (no real ADC on host).
 *
 *  LIFECYCLE: no lume.adc.free() call. lume.app exposes only onStart/onPause/
 *  onResume/onBack -- there is NO app close/unload hook to free from -- and a
 *  hot-reload runtime reset keeps ADC slot state on the engine task. config()
 *  is last-wins and rebuilds the channel for a new atten, so the slot is
 *  reclaimed by reconfiguration just as a gpio PWM channel survives until an
 *  explicit pwmFree. Calling free() here would have no correct place to run.
 */
var ADC_PIN_MIN = 1, ADC_PIN_MAX = 10, ADC_ATTEN_MAX = 3;
var RAW_MAX = 4095;       /* 12-bit contract ceiling: 0..4095 is valid */
var FULL_SCALE_MV = 3300; /* bar display scale only, NOT a calibrated range */
var adc = lume.adc;
var pin = 3, atten = 0;
var mvNum = 0;

var theme = { colors: {
  bg:'#07111D', primary:'#07111D', surface:'#132435', surfaceAlt:'#1C3449',
  text:'#F2F7FB', textDim:'#9EB3C6', accent:'#40D8B0', danger:'#FF6B79', success:'#40D8B0'
}, radius:12, spacing:12, fontScale:1 };
lume.theme.set(theme);

var rawDisplay = signal('0'), mvDisplay = signal('0'), mvValue = signal(0);
var pinDisplay = signal(pin), attenDisplay = signal(atten), cfgDisplay = signal('');

function clampInt(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function errText(code) { return 'err ' + code; }

/* Numeric bar ratio: reads the signal so the Canvas redraws on every sample. */
function barRatio() {
  var v = mvValue();
  if (v <= 0) return 0;
  var r = v / FULL_SCALE_MV;
  return r > 1 ? 1 : r;
}

/* (Re)configure the active pin/atten with bounds defence. config() returns
 * 0 on success or a negative error code; surface it as ASCII either way. */
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

/* One poll: readRaw/readMv both return NON-NEGATIVE measurements on success
 * and NEGATIVE error codes on failure. Render errors numerically, not as
 * truthy strings, so a legitimate 0 sample is never mistaken for a failure. */
function refresh() {
  var r = adc.readRaw(pin);
  var m = adc.readMv(pin);
  /* r is 0..4095 on success; anything larger is a contract violation, not a
   * voltage, so refuse to render it as a measurement. */
  rawDisplay.set(r < 0 ? errText(r) : (r > RAW_MAX ? 'RAW OOR' : String(r)));
  mvDisplay.set(m < 0 ? errText(m) : String(m));
  mvValue.set(m < 0 ? 0 : m);
  return { raw: r, mv: m };
}

var meter = Canvas({ width:320, height:48, onDraw:function (c) {
  c.clear();
  c.fillColor('#132435'); c.fillRect(0, 0, 320, 48);
  c.fillColor('#40D8B0');
  var w = Math.round(316 * barRatio());
  if (w > 0) c.fillRect(2, 18, w, 12);
} });

View({style:{width:'100%',height:'100%',background:'bg',scroll:'none',
  display:'flex',flexDirection:'column',justifyContent:'space-between',padding:24,gap:16}},[
  View({style:{width:'100%',height:64,display:'flex',flexDirection:'column',padding:0,gap:4}},[
    Text({text:'ADC Voltmeter',style:{fontSize:24,color:'text'}}),
    Text({text:'ADC1 oneshot, attenuated',style:{fontSize:13,color:'textDim'}})
  ]),
  View({style:{width:'100%',height:264,background:'surface',borderRadius:20,
    display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:16,gap:8}},[
    Text({text:'RAW 0..4095',style:{fontSize:13,color:'textDim'}}),
    Text({text:rawDisplay,style:{fontSize:40,color:'text'}}),
    meter,
    Text({text:'CALIBRATED mV',style:{fontSize:13,color:'textDim'}}),
    Text({text:mvDisplay,style:{fontSize:40,color:'accent'}}),
    Text({text:cfgDisplay,style:{fontSize:13,color:'textDim'}})
  ]),
  View({style:{width:'100%',height:96,display:'flex',flexDirection:'column',padding:0,gap:8}},[
    View({style:{width:'100%',height:56,display:'flex',flexDirection:'row',justifyContent:'space-between',gap:8,padding:0}},[
      Button({title:'PIN',style:{width:150,height:56,borderRadius:999,background:'surface'},onPress:cyclePin}),
      Button({title:'ATTEN',style:{width:150,height:56,borderRadius:999,background:'surface'},onPress:cycleAtten})
    ]),
    Text({text:function(){ return pinDisplay() + '   ' + attenDisplay(); },
      style:{width:'100%',fontSize:13,color:'textDim',textAlign:'center'}})
  ])
]);

applyConfig();
refresh();
lume.system.setInterval(refresh, 250);
