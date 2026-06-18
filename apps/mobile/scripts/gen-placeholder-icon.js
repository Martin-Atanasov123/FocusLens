/**
 * Generates placeholder icon.png and adaptive-icon.png in apps/mobile/assets/
 * Run from: apps/mobile/  →  node scripts/gen-placeholder-icon.js
 *
 * Replace the output files with your real icon before the Play Store build.
 * Required dimensions: 1024×1024 px, PNG, no transparency on icon.png.
 */
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

function solidPNG(width, height, r, g, b, a = 255) {
  const colorType = a < 255 ? 6 : 2; // RGBA vs RGB
  const channels = colorType === 6 ? 4 : 3;

  // Build raw scanlines: 1 filter byte + pixel data
  const row = Buffer.alloc(1 + width * channels);
  row[0] = 0; // filter: None
  for (let x = 0; x < width; x++) {
    const o = 1 + x * channels;
    row[o] = r; row[o + 1] = g; row[o + 2] = b;
    if (channels === 4) row[o + 3] = a;
  }
  const raw = Buffer.concat(Array(height).fill(row));
  const compressed = zlib.deflateSync(raw);

  // CRC-32
  const crcTable = Array.from({ length: 256 }, (_, i) => {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf) => {
    let crc = 0xffffffff;
    for (const b of buf) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };

  const chunk = (type, data) => {
    const typeBuf = Buffer.from(type);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;          // bit depth
  ihdr[9] = colorType;
  // bytes 10-12 default to 0 (compression/filter/interlace)

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG sig
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const out = path.join(__dirname, "..", "assets");
fs.mkdirSync(out, { recursive: true });

// icon.png — dark background, no transparency (Play Store requirement)
fs.writeFileSync(path.join(out, "icon.png"),          solidPNG(1024, 1024, 0x1a, 0x14, 0x10));
// adaptive-icon.png — transparent bg, just the foreground shape
fs.writeFileSync(path.join(out, "adaptive-icon.png"), solidPNG(1024, 1024, 0x1a, 0x14, 0x10, 0));

console.log("✓  assets/icon.png          (1024×1024 dark placeholder)");
console.log("✓  assets/adaptive-icon.png (1024×1024 transparent placeholder)");
console.log("");
console.log("Replace these files with your real icon, then run: npm run android");
