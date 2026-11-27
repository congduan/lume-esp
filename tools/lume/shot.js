// Screenshot reply decoding (SHOT command, see firmware lume_hotreload.c
// handle_shot) and RGB565 -> BMP encoding for `lume screenshot`.
//
// Device reply grammar, one line per write:
//   SHOT <w> <h> <bytes> <crc32-8hex>\n   header (always first)
//   S64<base64, 320 chars per 240 raw bytes>\n   data lines
//   SHOT OK\n                             footer
// or a single "CMD ERR <reason>\n". The payload is little-endian row-major
// RGB565 (pre-swap flush copy), w*h*2 bytes, no stride padding. The "S64"
// sentinel keeps interleaved device log lines out of the payload; the CRC
// catches anything that slips through anyway.
import { crc32 } from './protocol.js';

const SHOT_HEADER = /^SHOT (\d+) (\d+) (\d+) ([0-9a-f]{8})\r?$/;
const SHOT_DATA = /^S64([A-Za-z0-9+/=]+)\r?$/;
const SHOT_CMD_ERR = /^CMD ERR (\S+)\r?$/;

/**
 * Format a device-side "CMD ERR <reason>" screenshot rejection with an
 * actionable error message. `shot-tx` means the firmware aborted streaming
 * after bounded TX retries instead of emitting a false "SHOT OK".
 */
export function formatShotError(reason) {
  const clean = String(reason ?? '').trim() || 'unknown';
  let msg = `device rejected screenshot: ${clean}`;
  if (clean === 'shot-tx') {
    msg = 'device rejected screenshot: shot-tx (device TX timed out while streaming frame; no partial image returned)';
  }
  const err = new Error(msg);
  err.shotReason = clean;
  return err;
}

/**
 * Decode the collected reply lines of one SHOT exchange. Log lines outside
 * the header->footer window (and any line between them that is not an S64
 * data line) are ignored. Returns { width, height, data: Buffer }.
 */
export function decodeShot(lines) {
  const errLine = lines.map(l => SHOT_CMD_ERR.exec(l)).find(Boolean);
  if (errLine) throw formatShotError(errLine[1]);
  const header = lines.map(l => SHOT_HEADER.exec(l)).find(Boolean);
  if (!header) throw new Error('device sent no SHOT header (firmware too old?)');
  const width = Number(header[1]);
  const height = Number(header[2]);
  const bytes = Number(header[3]);
  const crc = parseInt(header[4], 16);
  const b64 = lines.map(l => SHOT_DATA.exec(l)).filter(Boolean).map(m => m[1]).join('');
  const data = Buffer.from(b64, 'base64');
  if (data.length !== bytes) {
    throw new Error(`screenshot payload truncated: ${data.length} != ${bytes} bytes`);
  }
  if (crc32(data) !== crc) {
    throw new Error('screenshot CRC mismatch - retry (device log noise corrupted the stream)');
  }
  return { width, height, data };
}

/**
 * Decode a little-endian RGB565 frame into a top-down RGB8 buffer matching
 * decodeRgb() from png.js, so device screenshots share analyzeFrames().
 */
export function rgbFromRgb565(data, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`invalid frame size: ${width}x${height}`);
  }
  if (data.length !== width * height * 2) {
    throw new Error(`frame size mismatch: ${data.length} bytes for ${width}x${height} RGB565`);
  }
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0, dst = 0; i < data.length; i += 2) {
    const px = data.readUInt16LE(i);
    rgb[dst++] = (px >> 11) << 3;
    rgb[dst++] = ((px >> 5) & 0x3f) << 2;
    rgb[dst++] = (px & 0x1f) << 3;
  }
  return { width, height, rgb };
}

/**
 * Encode a little-endian RGB565 frame as a 24-bit bottom-up BMP (BGR rows,
 * 4-byte row padding). Pure Node, no image dependencies.
 */
export function bmpFromRgb565(data, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`invalid frame size: ${width}x${height}`);
  }
  if (data.length !== width * height * 2) {
    throw new Error(`frame size mismatch: ${data.length} bytes for ${width}x${height} RGB565`);
  }
  const rowBytes = width * 3;
  const pad = (4 - (rowBytes % 4)) % 4;
  const stride = rowBytes + pad;
  const pixel = stride * height;
  const out = Buffer.alloc(54 + pixel);
  out.write('BM', 0, 'ascii');
  out.writeUInt32LE(out.length, 2);
  out.writeUInt32LE(54, 10);              // pixel data offset
  out.writeUInt32LE(40, 14);              // BITMAPINFOHEADER
  out.writeInt32LE(width, 18);
  out.writeInt32LE(height, 22);
  out.writeUInt16LE(1, 26);               // planes
  out.writeUInt16LE(24, 28);              // bits per pixel
  out.writeUInt32LE(0, 30);               // BI_RGB (no compression)
  out.writeUInt32LE(pixel, 34);
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width * 2;   // BMP rows are bottom-up
    let dst = 54 + y * stride;
    for (let x = 0; x < width; x++) {
      const px = data.readUInt16LE(src + x * 2);
      out[dst++] = (px & 0x1f) << 3;          // B (5 bits)
      out[dst++] = ((px >> 5) & 0x3f) << 2;   // G (6 bits)
      out[dst++] = (px >> 11) << 3;           // R (5 bits)
    }
  }
  return out;
}
