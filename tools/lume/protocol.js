// firmware/components/lume-hotreload/lume_hotreload.c:32-37, 121-125, 197-202, 239
export const MAX_PAYLOAD = 256 * 1024;
export const CONTROL = Object.freeze({ back: Buffer.from('BACK'), pause: Buffer.from('PAUS'), resume: Buffer.from('RESM') });

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

export function frame(source) {
  const payload = Buffer.isBuffer(source) ? source : Buffer.from(source, 'utf8');
  if (!payload.length || payload.length > MAX_PAYLOAD) {
    throw new Error(`bundle must be 1..${MAX_PAYLOAD} bytes (got ${payload.length})`);
  }
  const out = Buffer.allocUnsafe(12 + payload.length);
  out.write('LUME', 0, 'ascii');
  out.writeUInt32LE(payload.length, 4);
  out.writeUInt32LE(crc32(payload), 8);
  payload.copy(out, 12);
  return out;
}
