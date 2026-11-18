// firmware/components/lume-hotreload/lume_frame.h: same 12-byte header and
// CRC-32 for all frame kinds; only the magic selects the payload meaning.
export const MAX_PAYLOAD = 256 * 1024;
export const CONTROL = Object.freeze({ back: Buffer.from('BACK'), pause: Buffer.from('PAUS'), resume: Buffer.from('RESM') });
export const MAGIC_DATA = 'LUME';       // payload = JS app source (eval)
export const MAGIC_CMD = 'LUMC';        // payload = text command (see lume_cmd.h)
export const MAGIC_BYTECODE = 'LUMB';   // r43b: payload = LQBC header + qjsc blob

// r106: single-line LUMC verbs that take no id (see lume_cmd.h). FWTAG asks
// the device for the API tag the CLI stamps into each app's meta.json "fw".
export const FWTAG_CMD = 'FWTAG';       // answered "CMD OK fwt <TAG>"

// firmware/components/lume-engine/include/lume_bytecode.h: 16-byte payload
// header prepended to the raw `qjsc -b -C` blob. Byte offsets, not a struct.
export const BC_MAGIC = 'LQBC';
export const BC_MAGIC_LEN = 4;
export const BC_HDR_LEN = 16;
export const BC_OFF_MAJOR = 4;
export const BC_OFF_MINOR = 5;
export const BC_OFF_PATCH = 6;
export const BC_OFF_BCVER = 7;
export const BC_OFF_BODYLEN = 12;

const table = Uint32Array.from({ length: 256 }, (_, n) => {
  let crc = n;
  for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function build(magic, source, what) {
  const payload = Buffer.isBuffer(source) ? source : Buffer.from(source, 'utf8');
  if (!payload.length || payload.length > MAX_PAYLOAD) {
    throw new Error(`${what} must be 1..${MAX_PAYLOAD} bytes (got ${payload.length})`);
  }
  const out = Buffer.allocUnsafe(12 + payload.length);
  out.write(magic, 0, 'ascii');
  out.writeUInt32LE(payload.length, 4);
  out.writeUInt32LE(crc32(payload), 8);
  payload.copy(out, 12);
  return out;
}

export function frame(source) {
  return build(MAGIC_DATA, source, 'bundle');
}

/** r43b bytecode frame: payload is a bytecodePayload() buffer (not JS source). */
export function bytecodeFrame(payload) {
  return build(MAGIC_BYTECODE, payload, 'bytecode');
}

/** Command frame: payload is UTF-8 text parsed by lume_cmd.c. */
export function cmdFrame(text) {
  return build(MAGIC_CMD, text, 'command');
}

/**
 * r43b: wrap a raw qjsc blob in the 16-byte "LQBC" header.
 * version = { major, minor, patch, bcVersion } from the vendored QuickJS-NG
 * sources (see bytecode.js qjsVersion()). bcVersion must equal blob[0].
 */
export function bytecodePayload(body, version) {
  const blob = Buffer.isBuffer(body) ? body : Buffer.from(body);
  if (!blob.length) throw new Error('bytecode body is empty');
  for (const k of ['major', 'minor', 'patch', 'bcVersion']) {
    const n = version[k];
    if (!Number.isInteger(n) || n < 0 || n > 255) {
      throw new Error(`bytecode version.${k} must be 0..255 (got ${n})`);
    }
  }
  const out = Buffer.alloc(BC_HDR_LEN + blob.length);
  out.write(BC_MAGIC, 0, 'ascii');
  out[BC_OFF_MAJOR] = version.major;
  out[BC_OFF_MINOR] = version.minor;
  out[BC_OFF_PATCH] = version.patch;
  out[BC_OFF_BCVER] = version.bcVersion;
  // bytes 8..11 reserved, left zero
  out.writeUInt32LE(blob.length, BC_OFF_BODYLEN);
  blob.copy(out, BC_HDR_LEN);
  return out;
}

/** Parse a bytecode frame payload; returns null when the header is invalid. */
export function parseBytecodePayload(payload) {
  if (!Buffer.isBuffer(payload) || payload.length < BC_HDR_LEN ||
      payload.toString('ascii', 0, BC_MAGIC_LEN) !== BC_MAGIC) {
    return null;
  }
  const bodyLen = payload.readUInt32LE(BC_OFF_BODYLEN);
  if (bodyLen === 0 || bodyLen !== payload.length - BC_HDR_LEN) return null;
  return {
    major: payload[BC_OFF_MAJOR], minor: payload[BC_OFF_MINOR],
    patch: payload[BC_OFF_PATCH], bcVersion: payload[BC_OFF_BCVER],
    reserved: payload.readUInt32LE(8), bodyLen,
    body: payload.subarray(BC_HDR_LEN),
  };
}

/**
 * STORE payload: `STORE\t<id>\n<meta.json>\n<source>`.
 * meta must be a single line (JSON.stringify output is); the firmware never
 * parses it, the JS side does (lume.apps.entries()).
 */
export function storeCommand(id, meta, source) {
  const json = meta && Object.keys(meta).length ? JSON.stringify(meta) : '';
  if (/[\r\n]/.test(json)) throw new Error('store meta must be a single line');
  return `STORE\t${id}\n${json}\n${source}`;
}

/** Binary-safe STORE: the app payload may be bytecode, not UTF-8 source.
 * Returns a Buffer so cmdFrame() passes the bytes through untouched. */
export function storeCommandBuffer(id, meta, payload) {
  const json = meta && Object.keys(meta).length ? JSON.stringify(meta) : '';
  if (/[\r\n]/.test(json)) throw new Error('store meta must be a single line');
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
  return Buffer.concat([Buffer.from(`STORE\t${id}\n${json}\n`, 'utf8'), body]);
}

/** Single-line commands (`LAUNCH`/`REMOVE`/`META` carry an id). */
export function simpleCommand(verb, id) {
  const upper = verb.toUpperCase();
  return id ? `${upper}\t${id}` : upper;
}
