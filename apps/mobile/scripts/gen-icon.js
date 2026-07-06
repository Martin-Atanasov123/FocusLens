/**
 * Generates the real FocusLens app icon set into apps/mobile/assets/ using a
 * pure-Node PNG encoder (no image deps). Draws the brand "lens orb": a glowing
 * mint sphere with a specular highlight on the dark Opal-style background.
 *
 * Run from apps/mobile/:  node scripts/gen-icon.js
 * Outputs (all 1024×1024):
 *   icon.png          — orb + glow composited over the dark bg (no alpha)
 *   adaptive-icon.png — orb only, transparent bg, sized for Android's safe zone
 *   splash-icon.png   — orb only, transparent bg (shown on the dark splash)
 */
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const SIZE = 1024;
const BG = [7, 10, 8]; // #070A08
const MINT = [169, 238, 200]; // #A9EEC8
const MINT_LIGHT = [232, 255, 243];
const MINT_DEEP = [64, 168, 118];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t) => {
  t = clamp01(t);
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [
  lerp(c1[0], c2[0], t),
  lerp(c1[1], c2[1], t),
  lerp(c1[2], c2[2], t),
];

/** Source-over composite of [r,g,b,a0..1] onto [r,g,b] base (returns rgb). */
function over(base, src, a) {
  return [
    lerp(base[0], src[0], a),
    lerp(base[1], src[1], a),
    lerp(base[2], src[2], a),
  ];
}

/**
 * Renders the orb into an RGBA buffer.
 * @param orbR   orb radius in px
 * @param glowR  outer glow radius in px
 * @param onBg   true → composite over BG (opaque icon); false → transparent
 */
function renderOrb(orbR, glowR, onBg) {
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  // Specular highlight centre (up-left) and rim light (down-right).
  const hx = -orbR * 0.32;
  const hy = -orbR * 0.36;
  const rimx = orbR * 0.55;
  const rimy = orbR * 0.6;

  const data = Buffer.alloc(SIZE * SIZE * 4);

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      let rgb = onBg ? [...BG] : [0, 0, 0];
      let alpha = onBg ? 1 : 0;

      // Outer glow halo (mint bleeding into the surround).
      if (dist > orbR && dist < glowR) {
        const g = smooth(1 - (dist - orbR) / (glowR - orbR)) * 0.6;
        if (onBg) {
          rgb = over(rgb, MINT, g);
        } else {
          rgb = over(rgb, MINT, g); // premultiply-ish; alpha carries the falloff
          alpha = Math.max(alpha, g);
        }
      }

      // The orb itself.
      if (dist <= orbR + 1) {
        const rt = clamp01(dist / orbR);
        // Base sphere: mint at the core deepening to a darker mint at the rim.
        let col = mix(MINT, MINT_DEEP, smooth(rt * rt));

        // Off-centre specular highlight → reads as a glossy 3D sphere.
        const hd = Math.hypot(dx - hx, dy - hy);
        col = mix(col, MINT_LIGHT, smooth(1 - hd / (orbR * 0.62)) * 0.9);
        // Bright rim light on the opposite (down-right) edge.
        const rd = Math.hypot(dx - rimx, dy - rimy);
        col = mix(col, MINT_LIGHT, smooth(1 - rd / (orbR * 0.42)) * 0.22);

        const edge = smooth((orbR - dist) / 2 + 0.5); // ~2px antialias
        rgb = over(rgb, col, edge);
        alpha = Math.max(alpha, edge);
      }

      const o = (y * SIZE + x) * 4;
      data[o] = Math.round(clamp01(rgb[0] / 255) * 255);
      data[o + 1] = Math.round(clamp01(rgb[1] / 255) * 255);
      data[o + 2] = Math.round(clamp01(rgb[2] / 255) * 255);
      data[o + 3] = Math.round(clamp01(alpha) * 255);
    }
  }
  return data;
}

// ---- PNG encoding ----------------------------------------------------------

const crcTable = Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let crc = 0xffffffff;
  for (const b of buf) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const typeBuf = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
};

/** Encode RGBA buffer → PNG. If `opaque`, writes RGB (colorType 2). */
function encodePNG(rgba, opaque) {
  const channels = opaque ? 3 : 4;
  const rowBytes = 1 + SIZE * channels;
  const raw = Buffer.alloc(rowBytes * SIZE);
  for (let y = 0; y < SIZE; y++) {
    const ro = y * rowBytes;
    raw[ro] = 0; // filter: None
    for (let x = 0; x < SIZE; x++) {
      const si = (y * SIZE + x) * 4;
      const di = ro + 1 + x * channels;
      raw[di] = rgba[si];
      raw[di + 1] = rgba[si + 1];
      raw[di + 2] = rgba[si + 2];
      if (!opaque) raw[di + 3] = rgba[si + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;
  ihdr[9] = opaque ? 2 : 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- Write assets ----------------------------------------------------------

const out = path.join(__dirname, "..", "assets");
fs.mkdirSync(out, { recursive: true });

// Full-bleed icon: big orb + glow on dark, opaque (Play Store needs no alpha).
fs.writeFileSync(path.join(out, "icon.png"), encodePNG(renderOrb(310, 480, true), true));

// Adaptive foreground: orb kept inside Android's ~66% safe zone (radius < 337).
const adaptive = renderOrb(300, 430, false);
fs.writeFileSync(path.join(out, "adaptive-icon.png"), encodePNG(adaptive, false));

// Splash: same transparent orb, a touch smaller so it floats on the dark bg.
fs.writeFileSync(path.join(out, "splash-icon.png"), encodePNG(renderOrb(260, 400, false), false));

console.log("✓  assets/icon.png          (1024² mint lens orb, opaque)");
console.log("✓  assets/adaptive-icon.png (1024² orb, transparent, safe-zone)");
console.log("✓  assets/splash-icon.png   (1024² orb, transparent)");
