// firmware/components/lume-hotreload/lume_frame.h: same 12-byte header and
// CRC-32 for both frame kinds; only the magic selects the payload meaning.
export const MAX_PAYLOAD = 256 * 1024;
export const CONTROL = Object.freeze({ back: Buffer.from('BACK'), pause: Buffer.from('PAUS'), resume: Buffer.from('RESM') });
export const MAGIC_DATA = 'LUME';   // payload = JS app source (eval)
export const MAGIC_CMD = 'LUMC';    // payload = text command (see lume_cmd.h)

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

/** Command frame: payload is UTF-8 text parsed by lume_cmd.c. */
export function cmdFrame(text) {
  return build(MAGIC_CMD, text, 'command');
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

/** Single-line commands (`LAUNCH`/`REMOVE`/`META` carry an id). */
export function simpleCommand(verb, id) {
  const upper = verb.toUpperCase();
  return id ? `${upper}\t${id}` : upper;
}
