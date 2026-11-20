/** Compressed archive viewer: lume.compress.inflate on one static screen (r135).
 *
 *  Three built-in DEFLATE payloads are embedded as byte literals and inflated
 *  into a single caller-owned Uint8Array. A Button cycles them; each entry
 *  shows the decompressed ASCII text, source/destination byte counts, the
 *  compression ratio (compressed bytes as an integer percent of the original)
 *  and a format label (ZLIB / RAW).
 *
 *  PAYLOAD SOURCE: all three samples are self-made ASCII text compressed with
 *  node:zlib at authoring time -- a synthetic boot log (zlib), a synthetic
 *  sensor record (raw), and a deliberately TRUNCATED copy of the boot-log
 *  stream. They are fixtures, not real device captures. The truncated entry
 *  exercises the real -2 (damaged/truncated stream) branch; the native host
 *  probe (compiled from the firmware lume_compress.c) returns exactly -2 for
 *  it, while a bad format string returns -1 and a tiny out returns -3.
 *
 *  RETURN-CODE DISCIPLINE: inflate returns the number of bytes written (>= 0,
 *  including 0 for an empty stream) or a NEGATIVE code: -1 bad arg/format,
 *  -2 damaged stream, -3 out too small. Every negative code is tested
 *  numerically (n < 0) and rendered as ASCII "ERR <code>"; zero is a SUCCESS
 *  with zero bytes and is NEVER rendered as "ERR 0". No truthy-number test.
 *
 *  OUT BUFFER: one 2 KiB Uint8Array is reused for every payload. The samples
 *  decompress to ~180 B, far below 2 KiB; an oversized stream would surface
 *  as ERR -3 rather than writing outside the view (defensive branch covered
 *  by the host harness via an injected -3).
 *
 *  TRUNCATION: decompressed text is sliced to its first 120 characters and
 *  suffixed with "..." when longer, so a full record cannot overflow a 480 px
 *  Text row. The host harness compares this exact prefix against node:zlib,
 *  so truncation cannot hide a wrong decompression.
 *
 *  NODE BUDGET: the firmware node table is LUME_MAX_NODES = 128 slots. This
 *  app builds ONE static tree of 14 nodes and creates nothing at runtime:
 *    root View (1) + header View + Text (2) + pager View + Text + Button (3) +
 *    content View + Text (2) + bytes View + 2 Texts (3) + status View +
 *    2 Texts (3). No lists, no dynamic views.
 *
 *  ASCII-only UI copy (r64). Plain global var/function script, no imports.
 *  Host harness tests/archive_view.js runs this app with REAL node:zlib
 *  inflate injected through options.compress; the firmware path uses vendored
 *  miniz tinfl and is not exercised on the host. Real-device acceptance stays
 *  deferred.
 */
var PAYLOADS = [
  { name: 'BOOTLOG', format: 'zlib', bytes: new Uint8Array([120,156,77,140,177,10,194,48,0,5,247,126,197,27,117,75,211,20,170,163,142,10,14,186,137,67,108,159,38,152,38,33,77,171,253,123,113,40,8,183,221,113,215,227,216,243,134,123,8,25,46,60,49,232,62,58,98,53,204,62,27,102,219,174,11,33,182,63,74,68,237,233,176,63,213,149,16,80,141,248,168,70,32,188,150,64,34,135,177,53,216,159,47,27,41,5,18,117,55,47,178,130,161,142,120,36,18,170,108,36,14,118,183,56,133,152,232,198,142,224,164,221,223,177,134,78,173,177,19,49,89,190,153,16,188,179,158,197,23,240,84,53,19]) },
  { name: 'SENSOR', format: 'raw', bytes: new Uint8Array([117,142,59,10,192,48,12,67,247,156,66,23,136,145,157,37,25,114,152,146,161,99,33,100,233,237,139,211,31,29,58,88,32,120,122,120,84,2,88,90,3,133,234,97,40,146,21,88,247,190,121,7,69,17,41,26,70,85,242,102,237,28,20,201,124,216,185,135,71,24,213,94,214,29,76,206,218,199,107,206,186,55,93,108,252,121,66,231,77,241,1]) },
  { name: 'DAMAGED', format: 'zlib', bytes: new Uint8Array([120,156,77,140,177,10,194,48,0,5,247,126,197,27,117,75,211,20,170,163,142,10,14,186,137,67,108,159,38,152,38,33,77,171,253,123,113,40,8,183,221,113,215,227,216,243,134,123,8,25,46,60,49,232,62,58,98,53,204,62,27,102,219,174,11,33,182,63,74,68,237]) }
];
var OUT = new Uint8Array(2048);
var MAX_CHARS = 120;
var compress = lume.compress;
var idx = 0;

var theme = { colors: {
  bg:'#07111D', primary:'#07111D', surface:'#132435', surfaceAlt:'#1C3449',
  text:'#F2F7FB', textDim:'#9EB3C6', accent:'#40D8B0', danger:'#FF6B79', success:'#40D8B0'
}, radius:12, spacing:12, fontScale:1 };
lume.theme.set(theme);

var pagerDisplay = signal(''), contentDisplay = signal(''), bytesDisplay = signal('');
var ratioDisplay = signal(''), formatDisplay = signal(''), statusDisplay = signal('');

/* ASCII text of the first n decompressed bytes, truncated for the screen. */
function asciiOf(view, n) {
  var s = '';
  for (var i = 0; i < n; i++) s += String.fromCharCode(view[i] & 0x7f);
  if (s.length > MAX_CHARS) s = s.slice(0, MAX_CHARS) + '...';
  return s;
}

/* Recompute the active row. A NEGATIVE return is the only failure mode; 0 is
 * a valid empty stream and is reported as OK with a 0% ratio. */
function render() {
  var p = PAYLOADS[idx];
  var n = compress.inflate(p.bytes, OUT, p.format);
  var state = {
    idx: idx, name: p.name, format: p.format, srcLen: p.bytes.length, rc: n,
    text: '', bytes: '', ratio: '', formatLabel: 'FORMAT ' + p.format.toUpperCase(), status: ''
  };
  if (n < 0) {
    state.status = 'ERR ' + n;
    state.ratio = '-';
    state.bytes = p.bytes.length + ' -> ERR';
  } else {
    state.status = 'OK';
    state.text = asciiOf(OUT, n);
    state.bytes = p.bytes.length + ' -> ' + n + 'B';
    state.ratio = n === 0 ? '0%' : String(Math.round(p.bytes.length * 100 / n)) + '%';
  }
  pagerDisplay.set('PAYLOAD ' + (idx + 1) + '/' + PAYLOADS.length + ' ' + p.name);
  contentDisplay.set(state.text);
  bytesDisplay.set(state.bytes);
  ratioDisplay.set(state.ratio);
  formatDisplay.set(state.formatLabel);
  statusDisplay.set(state.status);
  return state;
}

function cyclePayload() {
  idx = idx + 1 >= PAYLOADS.length ? 0 : idx + 1;
  return render();
}

View({style:{width:'100%',height:'100%',background:'bg',scroll:'none',
  display:'flex',flexDirection:'column',justifyContent:'space-between',padding:20,gap:12}},[
  View({style:{width:'100%',height:44,display:'flex',flexDirection:'column',padding:0,gap:4}},[
    Text({text:'Archive Viewer',style:{fontSize:24,color:'text'}})
  ]),
  View({style:{width:'100%',height:60,display:'flex',flexDirection:'row',
    alignItems:'center',justifyContent:'space-between',padding:0,gap:12}},[
    Text({text:pagerDisplay,style:{fontSize:16,color:'text'}}),
    Button({title:'NEXT',style:{width:110,height:48,borderRadius:999,background:'surface'},onPress:cyclePayload})
  ]),
  View({style:{width:'100%',height:150,display:'flex',flexDirection:'column',padding:0,gap:4}},[
    Text({text:contentDisplay,style:{fontSize:13,color:'text'}})
  ]),
  View({style:{width:'100%',height:70,display:'flex',flexDirection:'column',padding:0,gap:4}},[
    Text({text:bytesDisplay,style:{fontSize:16,color:'accent'}}),
    Text({text:ratioDisplay,style:{fontSize:16,color:'accent'}})
  ]),
  View({style:{width:'100%',height:70,display:'flex',flexDirection:'column',padding:0,gap:4}},[
    Text({text:formatDisplay,style:{fontSize:13,color:'textDim'}}),
    Text({text:statusDisplay,style:{fontSize:16,color:'success'}})
  ])
]);

render();
