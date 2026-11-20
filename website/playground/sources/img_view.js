/** RGB565 scaling demo: lume.imgscale.scale on one static screen (r136).
 *
 *  A small built-in RGB565 test image is scaled into a caller-owned Uint16Array
 *  at an integer multiple (2x / 4x / 8x) and uploaded to a Canvas sprite slot
 *  with retainImage / drawImage. NEXT cycles the zoom; MODE toggles nearest /
 *  bilinear sampling. The HUD shows the active factor, sampling mode, source
 *  to destination dimensions and the scale() return code.
 *
 *  FIXTURE SOURCE: SRC below is a SYNTHETIC 24x24 RGB565 pattern generated at
 *  authoring time by a throwaway script -- NOT a photograph or a device
 *  capture. It intentionally mixes a horizontal red/blue gradient, a vertical
 *  green gradient, a hard black/white checkerboard (edges) and a solid cyan
 *  block with a red diagonal stripe, so both nearest and bilinear sampling are
 *  easy to eyeball. It is embedded as a plain JS array literal; no decoder or
 *  filesystem access is involved.
 *
 *  RETURN-CODE DISCIPLINE: scale() returns 0 on success and a NEGATIVE code on
 *  failure (-1 bad argument/type/mode, -2 invalid dimensions/too-short view/
 *  overlap, -3 reserved/unreachable). Every failure is discriminated
 *  NUMERICALLY with `rc < 0` and rendered as ASCII "ERR <code>"; zero is
 *  SUCCESS and is never rendered as an error. No truthy-number test.
 *
 *  ZERO-COPY / BUFFER: SRC is the source view and DST is one preallocated
 *  192x192 Uint16Array. Each render scales into `DST.subarray(0, dw*dh)`; the
 *  native binding uses the views directly (no backing-store copy) and honours
 *  subarray offsets. The largest grid (192x192) fits the single DST allocation.
 *
 *  NODE BUDGET: the firmware node table is LUME_MAX_NODES = 128 slots. This
 *  app builds ONE static tree of 10 nodes and creates nothing at runtime:
 *    root View (1) + header View + Text (2) + Canvas (1) +
 *    HUD View + 2 Texts (3) + controls View + 2 Buttons (3).
 *  No lists, no dynamic views; the sprite slot is redefined in place.
 *
 *  ASCII-only UI copy (r64). Plain global var/function script, no imports.
 *  Host harness tests/img_view.js runs this app through the firmware prelude
 *  and checks the scaled pixels against an INDEPENDENT JS reference; the
 *  firmware binding itself is exercised by the native build, not on the host.
 *  Real-device acceptance (panel output, touch feel) stays deferred.
 */
var SW = 24, SH = 24;
var FACTORS = [2, 4, 8];
var MAXD = SW * FACTORS[FACTORS.length - 1];
var SRC = new Uint16Array([
  31,6172,12313,16407,22548,28689,34830,40971,47112,51206,57347,63488,
  0,0,0,0,0,0,0,0,0,0,0,31,
  31,6172,12313,16407,22548,28689,34830,40971,47112,51206,57347,63488,
  192,192,192,192,192,192,192,192,192,192,192,223,
  31,6172,12313,16407,22548,28689,34830,40971,47112,51206,57347,63488,
  352,352,352,352,352,352,352,352,352,352,352,383,
  31,6172,12313,16407,22548,28689,34830,40971,47112,51206,57347,63488,
  544,544,544,544,544,544,544,544,544,544,544,575,
  31,6172,12313,16407,22548,28689,34830,40971,47112,51206,57347,63488,
  736,736,736,736,736,736,736,736,736,736,736,767,
  31,6172,12313,16407,22548,28689,34830,40971,47112,51206,57347,63488,
  928,928,928,928,928,928,928,928,928,928,928,959,
  31,6172,12313,16407,22548,28689,34830,40971,47112,51206,57347,63488,
  1088,1088,1088,1088,1088,1088,1088,1088,1088,1088,1088,1119,
  31,6172,12313,16407,22548,28689,34830,40971,47112,51206,57347,63488,
  1280,1280,1280,1280,1280,1280,1280,1280,1280,1280,1280,1311,
  31,6172,12313,16407,22548,28689,34830,40971,47112,51206,57347,63488,
  1472,1472,1472,1472,1472,1472,1472,1472,1472,1472,1472,1503,
  31,6172,12313,16407,22548,28689,34830,40971,47112,51206,57347,63488,
  1664,1664,1664,1664,1664,1664,1664,1664,1664,1664,1664,1695,
  31,6172,12313,16407,22548,28689,34830,40971,47112,51206,57347,63488,
  1824,1824,1824,1824,1824,1824,1824,1824,1824,1824,1824,1855,
  31,6172,12313,16407,22548,28689,34830,40971,47112,51206,57347,63488,
  2016,2016,2016,2016,2016,2016,2016,2016,2016,2016,2016,2047,
  65535,65535,65535,65535,1,1,1,1,65535,65535,65535,65535,
  63488,2047,2047,2047,2047,2047,2047,2047,2047,2047,2047,2047,
  65535,65535,65535,65535,1,1,1,1,65535,65535,65535,65535,
  2047,63488,2047,2047,2047,2047,2047,2047,2047,2047,2047,2047,
  65535,65535,65535,65535,1,1,1,1,65535,65535,65535,65535,
  2047,2047,63488,2047,2047,2047,2047,2047,2047,2047,2047,2047,
  65535,65535,65535,65535,1,1,1,1,65535,65535,65535,65535,
  2047,2047,2047,63488,2047,2047,2047,2047,2047,2047,2047,2047,
  1,1,1,1,65535,65535,65535,65535,1,1,1,1,
  2047,2047,2047,2047,63488,2047,2047,2047,2047,2047,2047,2047,
  1,1,1,1,65535,65535,65535,65535,1,1,1,1,
  2047,2047,2047,2047,2047,63488,2047,2047,2047,2047,2047,2047,
  1,1,1,1,65535,65535,65535,65535,1,1,1,1,
  2047,2047,2047,2047,2047,2047,63488,2047,2047,2047,2047,2047,
  1,1,1,1,65535,65535,65535,65535,1,1,1,1,
  2047,2047,2047,2047,2047,2047,2047,63488,2047,2047,2047,2047,
  65535,65535,65535,65535,1,1,1,1,65535,65535,65535,65535,
  2047,2047,2047,2047,2047,2047,2047,2047,63488,2047,2047,2047,
  65535,65535,65535,65535,1,1,1,1,65535,65535,65535,65535,
  2047,2047,2047,2047,2047,2047,2047,2047,2047,63488,2047,2047,
  65535,65535,65535,65535,1,1,1,1,65535,65535,65535,65535,
  2047,2047,2047,2047,2047,2047,2047,2047,2047,2047,63488,2047,
  65535,65535,65535,65535,1,1,1,1,65535,65535,65535,65535,
  2047,2047,2047,2047,2047,2047,2047,2047,2047,2047,2047,63488
]);
var DST = new Uint16Array(MAXD * MAXD);
var CW = 200, CH = 200;
var imgscale = lume.imgscale;
var idx = 0;
var mode = 'nearest';

var scaleIndex = signal(0);
var modeSignal = signal('nearest');
var hudDisplay = signal(''), statusDisplay = signal('');

var theme = { colors: {
  bg:'#07111D', primary:'#07111D', surface:'#132435', surfaceAlt:'#1C3449',
  text:'#F2F7FB', textDim:'#9EB3C6', accent:'#40D8B0', danger:'#FF6B79', success:'#40D8B0'
}, radius:12, spacing:12, fontScale:1 };
lume.theme.set(theme);

var last = { rc: 0, mode: mode, factor: FACTORS[0], sw: SW, sh: SH, dw: 0, dh: 0, dst: DST };

/* One scale() call: view the source at the active factor/mode, scale straight
 * into the matching slice of DST (no copy), and remember the result. */
function compute() {
  var f = FACTORS[idx], m = mode;
  var dw = SW * f, dh = SH * f;
  var dst = DST.subarray(0, dw * dh);
  var rc = imgscale.scale(SRC, SW, SH, dst, dw, dh, m);
  last = { rc: rc, mode: m, factor: f, sw: SW, sh: SH, dw: dw, dh: dh, dst: dst };
  return last;
}

/* Numeric return-code rendering: only a NEGATIVE rc is an error. */
function statusText(rc) { return rc < 0 ? 'ERR ' + rc : 'OK'; }

/* Recompute and publish the HUD. Exposed for the host harness. */
function apply() {
  var r = compute();
  hudDisplay.set('X' + r.factor + ' ' + r.mode + ' ' + r.sw + 'x' + r.sh + ' -> ' + r.dw + 'x' + r.dh);
  statusDisplay.set(statusText(r.rc));
  return r;
}

function nextScale() {
  idx = idx + 1 >= FACTORS.length ? 0 : idx + 1;
  scaleIndex.set(idx);
  return apply();
}

function toggleMode() {
  mode = mode === 'nearest' ? 'bilinear' : 'nearest';
  modeSignal.set(mode);
  return apply();
}

/* Snapshot of the last scale for host assertions (dst copied to a plain array). */
function state() {
  return { rc: last.rc, mode: last.mode, factor: last.factor, sw: last.sw, sh: last.sh,
    dw: last.dw, dh: last.dh, pixels: Array.prototype.slice.call(last.dst) };
}

var root = View({style:{width:'100%',height:'100%',background:'bg',scroll:'none',
  display:'flex',flexDirection:'column',justifyContent:'space-between',padding:20,gap:10}},[
  View({style:{width:'100%',height:44,display:'flex',flexDirection:'column',padding:0,gap:4}},[
    Text({text:'Image Scale',style:{fontSize:24,color:'text'}})
  ]),
  View({style:{width:'100%',height:64,display:'flex',flexDirection:'column',padding:0,gap:4}},[
    Text({text:hudDisplay,style:{fontSize:16,color:'text'}}),
    Text({text:statusDisplay,style:{fontSize:14,color:'accent'}})
  ]),
  View({style:{width:'100%',height:60,display:'flex',flexDirection:'row',
    alignItems:'center',justifyContent:'space-between',padding:0,gap:12}},[
    Button({title:'NEXT',style:{width:120,height:48,borderRadius:999,background:'surface'},onPress:nextScale}),
    Button({title:'MODE',style:{width:120,height:48,borderRadius:999,background:'surface'},onPress:toggleMode})
  ])
]);

Canvas({ parent: root, width: CW, height: CH,
  style:{position:'absolute',x:140,y:80}, onDraw: function (ctx) {
  scaleIndex(); modeSignal();                 /* subscribe to both switches */
  var r = compute();                          /* scale() runs on every redraw */
  ctx.fillColor('#07111D');
  ctx.fillRect(0, 0, CW, CH);
  if (r.rc < 0) {
    ctx.fillColor('#FF6B79');
    ctx.fillRect(0, 0, CW, 8);
  } else {
    ctx.retainImage(1, r.dw, r.dh, r.dst);
    ctx.drawImage(1, Math.floor((CW - r.dw) / 2), Math.floor((CH - r.dh) / 2));
  }
} });

apply();
