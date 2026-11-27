/** Compressed archive viewer: lume.compress.inflate on one static screen (r135).
 *
 *  Three built-in DEFLATE payloads are embedded as byte literals and inflated
 *  into a single caller-owned Uint8Array. A Button cycles them; each entry
 *  shows the decompressed ASCII text, source/destination byte counts, the
 *  compression ratio and a format label (ZLIB / RAW).
 *
 *  RETURN-CODE DISCIPLINE: inflate returns bytes written (>= 0) or a NEGATIVE
 *  code (-1 bad arg/format, -2 damaged stream, -3 out too small). Every
 *  negative code is tested numerically (n < 0) and rendered as ASCII "ERR <code>";
 *  zero is SUCCESS and NEVER rendered as "ERR 0".
 *
 *  TRUNCATION: decompressed text is sliced to MAX_CHARS (120) + "...".
 *
 *  NODE BUDGET: the firmware node table is LUME_MAX_NODES = 128 slots. This
 *  app builds ONE static tree of 17 nodes inside the [76, 404] round AMOLED
 *  safe square and creates nothing at runtime.
 *
 *  ASCII-only UI copy (r64). Plain global var/function script.
 *  Real-device acceptance stays deferred.
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
  bg: '#000000', primary: '#09101A', surface: '#16202E', surfaceAlt: '#1F2C3D',
  text: '#F2F7FB', textDim: '#9EB3C6', accent: '#40D8B0', danger: '#FF6B79', success: '#40D8B0'
}, radius: 12, spacing: 12, fontScale: 1 };
lume.theme.set(theme);

var pagerDisplay = signal(''), contentDisplay = signal(''), bytesDisplay = signal('');
var ratioDisplay = signal(''), formatDisplay = signal(''), statusDisplay = signal('');

function asciiOf(view, n) {
  var s = '';
  for (var i = 0; i < n; i++) s += String.fromCharCode(view[i] & 0x7f);
  if (s.length > MAX_CHARS) s = s.slice(0, MAX_CHARS) + '...';
  return s;
}

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
    Text({ text: 'Archive Viewer', style: {
      position: 'absolute', x: 4, y: 10, width: 210, height: 28,
      fontSize: 20, color: '#F2F7FB'
    } }),
    Button({ title: 'NEXT', onPress: cyclePayload, style: {
      position: 'absolute', x: 224, y: 0, width: 100, height: 48,
      borderRadius: 12, background: '#116354', borderColor: '#40D8B0', borderWidth: 1,
      color: '#F2F7FB', fontSize: 13
    } }),
    View({ style: {
      position: 'absolute', x: 4, y: 54, width: 320, height: 30,
      background: '#12262B', borderColor: '#2E7D6B', borderWidth: 1, borderRadius: 10,
      paddingLeft: 12, paddingRight: 12, display: 'flex', alignItems: 'center', scroll: 'none'
    } }, [
      Text({ text: pagerDisplay, style: { fontSize: 13, color: '#40D8B0' } })
    ]),
    View({ style: {
      position: 'absolute', x: 4, y: 90, width: 320, height: 126,
      background: '#101A28', borderColor: '#233245', borderWidth: 1, borderRadius: 12,
      padding: 10, scroll: 'none'
    } }, [
      Text({ text: contentDisplay, style: { width: 300, height: 106, fontSize: 13, color: '#F2F7FB' } })
    ]),
    View({ style: {
      position: 'absolute', x: 4, y: 222, width: 320, height: 48,
      display: 'flex', flexDirection: 'row', gap: 8, scroll: 'none'
    } }, [
      View({ style: {
        flexGrow: 1, height: 48, background: '#16202E', borderColor: '#233245',
        borderWidth: 1, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
        scroll: 'none'
      } }, [
        Text({ text: bytesDisplay, style: { fontSize: 15, color: '#40D8B0', textAlign: 'center' } })
      ]),
      View({ style: {
        width: 96, height: 48, background: '#16202E', borderColor: '#233245',
        borderWidth: 1, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
        scroll: 'none'
      } }, [
        Text({ text: ratioDisplay, style: { fontSize: 15, color: '#FFD78E', textAlign: 'center' } })
      ])
    ]),
    View({ style: {
      position: 'absolute', x: 4, y: 276, width: 320, height: 48,
      background: '#16202E', borderColor: '#233245', borderWidth: 1, borderRadius: 12,
      paddingLeft: 14, paddingRight: 14,
      display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      scroll: 'none'
    } }, [
      Text({ text: formatDisplay, style: { fontSize: 13, color: '#9EB3C6' } }),
      Text({ text: statusDisplay, style: {
        fontSize: 15,
        color: function () { return statusDisplay() === 'OK' ? '#40D8B0' : '#FF6B79'; }
      } })
    ])
  ])
]);

render();
