// Minimal RGB8 PNG decoder for esp32sim `--tft-png` captures. No image
// dependency: esp32sim writes colour-type 2, 8-bit, non-interlaced PNGs with a
// zlib stream of stored deflate blocks and a filter byte per row (png.rs in the
// esp32sim source). All five PNG filter types are reconstructed so the decoder
// also works on captures from other tools.
import { inflateSync } from 'node:zlib';

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Decode an RGB/RGBA 8-bit non-interlaced PNG into a flat RGB buffer.
 * Returns { width, height, rgb } where rgb is width*height*3 bytes (top-down,
 * row-major, 8-bit R/G/B per pixel).
 */
export function decodeRgb(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) {
    throw new Error('not a PNG file');
  }
  let width = 0, height = 0, depth = 0, color = 0, interlace = 0;
  const idat = [];
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8]; color = data[9]; interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;                       // length + type + data + CRC
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) {
    throw new Error(`unsupported PNG: depth=${depth} color=${color} interlace=${interlace}`);
  }
  if (!width || !height) throw new Error('PNG has no IHDR');
  const channels = color === 2 ? 3 : 4;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length < height * (stride + 1)) {
    throw new Error(`PNG data truncated: ${raw.length} < ${height * (stride + 1)}`);
  }
  const rgb = Buffer.allocUnsafe(width * height * 3);
  const prev = Buffer.alloc(stride, 0);
  const cur = Buffer.allocUnsafe(stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    for (let x = 0; x < stride; x++) {
      const v = raw[pos + x];
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let out;
      switch (filter) {
        case 0: out = v; break;
        case 1: out = v + a; break;
        case 2: out = v + b; break;
        case 3: out = v + ((a + b) >> 1); break;
        case 4: out = v + paeth(a, b, c); break;
        default: throw new Error(`bad PNG filter ${filter} on row ${y}`);
      }
      cur[x] = out & 0xff;
    }
    pos += stride;
    for (let x = 0; x < width; x++) {
      const s = x * channels, d = (y * width + x) * 3;
      rgb[d] = cur[s]; rgb[d + 1] = cur[s + 1]; rgb[d + 2] = cur[s + 2];
    }
    prev.set(cur);
  }
  return { width, height, rgb };
}
