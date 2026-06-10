// Generates the Tauri icon set (32x32.png, 128x128.png, icon.ico) without any
// image dependencies: a minimal PNG encoder (zlib is built into Node) plus a
// classic BMP-format ICO. Design: indigo disc with a lens ring.
import zlib from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "icons");
const ICONS_DIR = process.argv[2] ? join(process.cwd(), process.argv[2]) : DEFAULT_DIR;

// ---- pixel art -------------------------------------------------------------

function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4); // RGBA
  const c = (size - 1) / 2;
  const rOuter = size * 0.47;
  const rRing = size * 0.34;
  const rRingInner = size * 0.26;
  const rDot = size * 0.1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      let rgba = [0, 0, 0, 0];
      if (d <= rOuter) rgba = [49, 46, 129, 255]; // indigo-900 disc
      if (d <= rRing && d > rRingInner) rgba = [165, 180, 252, 255]; // indigo-300 ring
      if (d <= rDot) rgba = [224, 231, 255, 255]; // indigo-100 pupil
      px.set(rgba, (y * size + x) * 4);
    }
  }
  return px;
}

// ---- PNG encoder -----------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 4)] = 0; // filter: none
    rgba.copy(raw, y * (1 + size * 4) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- ICO (BMP format, 32x32x32bpp) ------------------------------------------

function encodeIco(size, rgba) {
  const xorBytes = size * size * 4;
  const andStride = Math.ceil(size / 32) * 4;
  const andBytes = andStride * size;
  const bmpBytes = 40 + xorBytes + andBytes;
  const buf = Buffer.alloc(6 + 16 + bmpBytes);
  // ICONDIR
  buf.writeUInt16LE(0, 0); // reserved
  buf.writeUInt16LE(1, 2); // type: icon
  buf.writeUInt16LE(1, 4); // count
  // ICONDIRENTRY
  buf[6] = size === 256 ? 0 : size;
  buf[7] = size === 256 ? 0 : size;
  buf.writeUInt16LE(1, 10); // planes
  buf.writeUInt16LE(32, 12); // bpp
  buf.writeUInt32LE(bmpBytes, 14);
  buf.writeUInt32LE(22, 18); // offset
  // BITMAPINFOHEADER (height doubled for XOR+AND)
  const h = 22;
  buf.writeUInt32LE(40, h);
  buf.writeInt32LE(size, h + 4);
  buf.writeInt32LE(size * 2, h + 8);
  buf.writeUInt16LE(1, h + 12);
  buf.writeUInt16LE(32, h + 14);
  // XOR data: bottom-up BGRA
  let off = h + 40;
  for (let y = size - 1; y >= 0; y--) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      buf[off++] = rgba[i + 2]; // B
      buf[off++] = rgba[i + 1]; // G
      buf[off++] = rgba[i]; // R
      buf[off++] = rgba[i + 3]; // A
    }
  }
  // AND mask: all zero (alpha channel rules)
  return buf;
}

// ---- write -----------------------------------------------------------------

mkdirSync(ICONS_DIR, { recursive: true });
writeFileSync(join(ICONS_DIR, "32x32.png"), encodePng(32, drawIcon(32)));
writeFileSync(join(ICONS_DIR, "128x128.png"), encodePng(128, drawIcon(128)));
writeFileSync(join(ICONS_DIR, "icon.ico"), encodeIco(32, drawIcon(32)));
console.log(`icons written to ${ICONS_DIR}`);
