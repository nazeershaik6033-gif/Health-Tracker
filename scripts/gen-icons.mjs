// Generates the PWA icon set as PNGs with no image dependencies.
// The mark is a leaf (the lens formed by two overlapping circles) with a
// centre vein, on the brand green — drawn with signed-distance functions so
// it stays crisp at every size and antialiases cleanly.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/icons');

const BRAND = [0x14, 0xa0, 0x6a];
const BRAND_DEEP = [0x0b, 0x6f, 0x4a];
const WHITE = [0xff, 0xff, 0xff];

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

/** Coverage of a shape at a pixel, from its signed distance (negative inside). */
const cover = (d, aa) => clamp01(0.5 - d / aa);

function roundedRectSDF(x, y, w, h, r) {
  const qx = Math.abs(x - w / 2) - (w / 2 - r);
  const qy = Math.abs(y - h / 2) - (h / 2 - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

const circleSDF = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) - r;

/**
 * `opaque` fills the whole square with no alpha anywhere.
 *
 * Required for two cases that both silently degrade otherwise:
 *  - maskable icons, where the platform crops to its own shape and expects
 *    edge-to-edge coverage;
 *  - Apple touch icons, where iOS does not support transparency at all and
 *    composites whatever alpha it finds onto black, then applies its own
 *    rounding on top.
 */
function renderIcon(size, { maskable = false, opaque = false } = {}) {
  const fill = maskable || opaque;
  const px = Buffer.alloc(size * size * 4);
  // Maskable icons must keep their art inside the safe zone (inner 80%),
  // so the glyph shrinks while the background bleeds to the full canvas.
  const pad = maskable ? size * 0.22 : size * 0.16;
  const radius = maskable ? size / 2 : size * 0.235;
  const aa = 1.5;

  const cx = size / 2;
  const cy = size / 2;
  const leafR = (size - pad * 2) * 0.66;
  // Two circles offset along the diagonal; their lens intersection is the leaf.
  // A larger offset narrows the lens into a leaf rather than a fat almond.
  const off = leafR * 0.66;
  const ax = cx - off * 0.7071;
  const ay = cy + off * 0.7071;
  const bx = cx + off * 0.7071;
  const by = cy - off * 0.7071;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = (y * size + x) * 4;
      const fx = x + 0.5;
      const fy = y + 0.5;

      // A fully-covered pixel, not a rounded-rect edge test. The previous
      // `maskable ? 0 : …` fed a distance of exactly 0 into `cover`, which is
      // the shape's *edge* — so it returned 0.5 and every pixel of the
      // maskable icon came out half transparent.
      const bgA = fill ? 1 : cover(roundedRectSDF(fx, fy, size, size, radius), aa);
      if (bgA <= 0) {
        px[p] = px[p + 1] = px[p + 2] = px[p + 3] = 0;
        continue;
      }

      // Subtle diagonal gradient so the tile doesn't read as flat.
      const t = clamp01((fx / size) * 0.5 + (fy / size) * 0.5);
      let rgb = mix(BRAND, BRAND_DEEP, t * 0.55);

      // Leaf = intersection of the two circles (max of their SDFs).
      const leaf = Math.max(circleSDF(fx, fy, ax, ay, leafR), circleSDF(fx, fy, bx, by, leafR));
      const leafA = cover(leaf, aa);
      if (leafA > 0) rgb = mix(rgb, WHITE, leafA);

      // Centre vein: a thin capsule along the leaf's long axis, punched back
      // to green so the mark still reads at 16px.
      const dx = fx - cx;
      const dy = fy - cy;
      // The lens's long axis is perpendicular to the circle-offset vector,
      // so the vein projects onto (0.7071, 0.7071), not the anti-diagonal.
      const along = dx * 0.7071 + dy * 0.7071;
      const across = Math.abs(dx * 0.7071 - dy * 0.7071);
      const veinHalf = leafR * 0.46;
      const overrun = Math.max(Math.abs(along) - veinHalf, 0);
      const vein = Math.hypot(overrun, across) - size * 0.013;
      const veinA = cover(vein, aa) * leafA;
      if (veinA > 0) rgb = mix(rgb, mix(BRAND, BRAND_DEEP, 0.35), veinA);

      px[p] = rgb[0];
      px[p + 1] = rgb[1];
      px[p + 2] = rgb[2];
      px[p + 3] = Math.round(bgA * 255);
    }
  }
  return px;
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(rgba, size) {
  // Each scanline is prefixed with filter byte 0 (None).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
const targets = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['maskable-512.png', 512, { maskable: true }],
  // Opaque: iOS composites any alpha onto black and rounds the corners itself.
  ['apple-touch-icon.png', 180, { opaque: true }],
];
for (const [name, size, opts] of targets) {
  writeFileSync(resolve(OUT, name), encodePNG(renderIcon(size, opts), size));
  console.log(`wrote ${name} (${size}x${size})`);
}
