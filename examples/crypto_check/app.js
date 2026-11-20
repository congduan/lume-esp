/** Crypto checksum / digest diagnostic: lume.crypto on one static screen.
 *
 *  Shows, for a switchable built-in payload: SHA-256 digest (hex), HMAC-SHA256
 *  token (hex, echoing the r132 OTA token), CRC-32 (unsigned decimal) and an
 *  AES-CTR encrypt -> decrypt loopback (OK / MISMATCH plus the first 8 bytes
 *  of ciphertext as hex). A single Button cycles 3 payloads (short text /
 *  longer text / empty string) so every primitive sees both data and no data.
 *
 *  RETURN-CODE DISCIPLINE: sha256 / hmacSha256 / aesCtr return 0 on success
 *  and a NEGATIVE code on failure; crc32 returns an UNSIGNED u32 value, or -1
 *  for a bad argument. All failures are tested numerically (v < 0), never by
 *  truthiness. -3 is the host / browser stub's "unsupported" answer and is
 *  rendered as ASCII "UNSUPPORTED" rather than swallowed as an exception;
 *  every other negative code renders as "ERR <code>". A CRC of 0xFFFFFFFF is
 *  reported as 4294967295 (a positive number), NOT as an error -- only a
 *  negative return is an error, which keeps the u32 contract intact.
 *
 *  HEX TRUNCATION: a full SHA-256 / HMAC is 32 bytes = 64 hex characters,
 *  wider than a 480 px row at a readable font size. Each digest is rendered
 *  as its FIRST 16 bytes (32 hex chars) followed by "..." -- enough to eyeball
 *  a change without overflowing. The host harness compares this against the
 *  real node:crypto digest prefix, so truncation cannot hide a wrong value.
 *
 *  NODE BUDGET: the firmware node table is LUME_MAX_NODES = 128 slots. This
 *  app builds ONE static tree of 18 nodes and creates nothing at runtime:
 *    root View (1) + header View + 1 Text (2) + payload View + value Text +
 *    Button (3) + digest View + 2 Texts (2) + token View + 2 Texts (2) +
 *    CRC View + 2 Texts (2) + AES View + 2 Texts (2).
 *  No lists, no dynamic views, so the table stays far under the hard limit.
 *
 *  ASCII-only UI copy (r64). Host harness tests/crypto_check.js runs this app
 *  against REAL node:crypto primitives injected via options.crypto; the
 *  firmware path uses ESP-IDF mbedTLS and is not exercised on the host.
 *  Real-device acceptance (mbedTLS on target, touch feel) stays deferred.
 */
var PAYLOADS = [
  'Lume',
  'The quick brown fox jumps over the lazy dog - Lume crypto diagnostic r134.',
  ''
];
var HMAC_KEY = new Uint8Array([76, 117, 109, 101, 45, 114, 49, 51, 52, 45, 107, 101, 121]);
var AES_KEY = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
var AES_IV = new Uint8Array([15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
var HEX = '0123456789abcdef';
var crypto = lume.crypto;
var idx = 0;

var theme = { colors: {
  bg:'#07111D', primary:'#07111D', surface:'#132435', surfaceAlt:'#1C3449',
  text:'#F2F7FB', textDim:'#9EB3C6', accent:'#40D8B0', danger:'#FF6B79', success:'#40D8B0'
}, radius:12, spacing:12, fontScale:1 };
lume.theme.set(theme);

var payloadDisplay = signal(''), shaDisplay = signal(''), tokenDisplay = signal('');
var crcDisplay = signal(''), aesDisplay = signal('');

/* ASCII bytes from a short built-in string (all payloads are ASCII). */
function bytesOf(str) {
  var out = new Uint8Array(str.length);
  for (var i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}

/* Lower-case hex of at most n leading bytes. */
function hexOf(view, n) {
  var s = '';
  for (var i = 0; i < n && i < view.length; i++) {
    var b = view[i];
    s += HEX.charAt((b >>> 4) & 15) + HEX.charAt(b & 15);
  }
  return s;
}

/* Numeric error discrimination: -3 is the host stub's UNSUPPORTED, any other
 * negative code is a concrete ERR <code>. 0 and positives are not errors. */
function errText(code) { return code === -3 ? 'UNSUPPORTED' : 'ERR ' + code; }

/* First 16 bytes of a 32-byte digest as hex + "..." (see truncation note). */
function digestText(data) {
  var out = new Uint8Array(32);
  var rc = crypto.sha256(data, out);
  if (rc !== 0) return errText(rc);
  return hexOf(out, 16) + '...';
}

function tokenText(data) {
  var out = new Uint8Array(32);
  var rc = crypto.hmacSha256(HMAC_KEY, data, out);
  if (rc !== 0) return errText(rc);
  return hexOf(out, 16) + '...';
}

/* CRC-32 is a u32: chain the two halves to exercise the seed argument. Only
 * a NEGATIVE return is an error; 4294967295 is a perfectly valid value. */
function crcText(data) {
  var half = data.length >> 1;
  var c1 = crypto.crc32(data.subarray(0, half));
  if (c1 < 0) return errText(c1);
  var c2 = crypto.crc32(data.subarray(half), c1);
  if (c2 < 0) return errText(c2);
  return String(c2 >>> 0);
}

/* CTR is symmetric: encrypt then decrypt the same view and compare bytes. */
function aesText(data) {
  var enc = new Uint8Array(data.length);
  var rc = crypto.aesCtr(AES_KEY, AES_IV, data, enc);
  if (rc !== 0) return errText(rc);
  var dec = new Uint8Array(data.length);
  rc = crypto.aesCtr(AES_KEY, AES_IV, enc, dec);
  if (rc !== 0) return errText(rc);
  var ok = true;
  for (var i = 0; i < data.length; i++) {
    if (dec[i] !== data[i]) { ok = false; break; }
  }
  var cipherHex = hexOf(enc, 8);
  return (ok ? 'OK' : 'MISMATCH') + (cipherHex ? ' ' + cipherHex : '');
}

/* Recompute all four readouts for the active payload and publish them. The
 * returned state object is handy for the host harness. */
function measure() {
  var data = bytesOf(PAYLOADS[idx]);
  var state = {
    idx: idx,
    payload: PAYLOADS[idx],
    len: data.length,
    sha: digestText(data),
    token: tokenText(data),
    crc: crcText(data),
    aes: aesText(data)
  };
  payloadDisplay.set('PAYLOAD ' + (idx + 1) + '/' + PAYLOADS.length + '  ' + data.length + 'B');
  shaDisplay.set(state.sha);
  tokenDisplay.set(state.token);
  crcDisplay.set(state.crc);
  aesDisplay.set(state.aes);
  return state;
}

function cyclePayload() {
  idx = idx + 1 >= PAYLOADS.length ? 0 : idx + 1;
  return measure();
}

View({style:{width:'100%',height:'100%',background:'bg',scroll:'none',
  display:'flex',flexDirection:'column',justifyContent:'space-between',padding:20,gap:12}},[
  View({style:{width:'100%',height:44,display:'flex',flexDirection:'column',padding:0,gap:4}},[
    Text({text:'Crypto Check',style:{fontSize:24,color:'text'}})
  ]),
  View({style:{width:'100%',height:60,display:'flex',flexDirection:'row',
    alignItems:'center',justifyContent:'space-between',padding:0,gap:12}},[
    Text({text:payloadDisplay,style:{fontSize:16,color:'text'}}),
    Button({title:'NEXT',style:{width:110,height:48,borderRadius:999,background:'surface'},onPress:cyclePayload})
  ]),
  View({style:{width:'100%',height:64,display:'flex',flexDirection:'column',padding:0,gap:4}},[
    Text({text:'SHA256',style:{fontSize:13,color:'textDim'}}),
    Text({text:shaDisplay,style:{fontSize:14,color:'text'}})
  ]),
  View({style:{width:'100%',height:64,display:'flex',flexDirection:'column',padding:0,gap:4}},[
    Text({text:'HMAC-SHA256',style:{fontSize:13,color:'textDim'}}),
    Text({text:tokenDisplay,style:{fontSize:14,color:'text'}})
  ]),
  View({style:{width:'100%',height:64,display:'flex',flexDirection:'column',padding:0,gap:4}},[
    Text({text:'CRC32 (u32)',style:{fontSize:13,color:'textDim'}}),
    Text({text:crcDisplay,style:{fontSize:16,color:'accent'}})
  ]),
  View({style:{width:'100%',height:76,display:'flex',flexDirection:'column',padding:0,gap:4}},[
    Text({text:'AES-CTR LOOPBACK',style:{fontSize:13,color:'textDim'}}),
    Text({text:aesDisplay,style:{fontSize:14,color:'success'}})
  ])
]);

measure();
