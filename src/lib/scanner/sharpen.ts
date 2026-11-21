/**
 * Unsharp mask on luminance, for barcode frames.
 *
 * A phone held close to a pack produces frames that are slightly out of
 * focus, and the decoder's tolerance for that is narrow: zxing reads an
 * EAN-13 only while the blur stays under about half a bar width, whatever
 * binarizer or denoise option it is given. Sharpening first pushes that to
 * about three quarters of a bar width — but the right radius depends on how
 * wide the bars are, which depends on how far away the pack is held. Radius 2
 * suits ~3 px bars and radius 4 suits ~5 px bars; neither alone covered both
 * in testing, the two together did. Hence `SHARPEN_PASSES`, tried in turn.
 *
 * It does not rescue a genuinely defocused frame — that is what the
 * take-a-photo fallback is for.
 *
 * Returns a new greyscale image; the source is left intact so the next pass
 * starts from the original. Separable running-sum box blur, so the cost is
 * linear in pixels and independent of radius — about 27 ms for 1280x720 on a
 * desktop CPU, which is why it runs in the decode worker and only after a
 * plain read has missed.
 */
export const SHARPEN_PASSES: readonly (readonly [radius: number, amount: number])[] = [
  [2, 2],
  [4, 4],
];

export function sharpenLuma(source: ImageData, radius: number, amount: number): ImageData {
  const { width: w, height: h, data: src } = source;
  const out = new ImageData(w, h);
  const data = out.data;
  const n = w * h;
  if (!n) return out;
  const luma = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    luma[i] = 0.299 * src[p] + 0.587 * src[p + 1] + 0.114 * src[p + 2];
  }

  const tmp = new Float32Array(n);
  const blur = new Float32Array(n);
  const win = 2 * radius + 1;
  const clampX = (x: number) => (x < 0 ? 0 : x >= w ? w - 1 : x);
  const clampY = (y: number) => (y < 0 ? 0 : y >= h ? h - 1 : y);

  for (let row = 0; row < h; row++) {
    const o = row * w;
    let acc = 0;
    for (let x = -radius; x <= radius; x++) acc += luma[o + clampX(x)];
    for (let x = 0; x < w; x++) {
      tmp[o + x] = acc / win;
      acc += luma[o + clampX(x + radius + 1)] - luma[o + clampX(x - radius)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let r = -radius; r <= radius; r++) acc += tmp[clampY(r) * w + x];
    for (let row = 0; row < h; row++) {
      blur[row * w + x] = acc / win;
      acc += tmp[clampY(row + radius + 1) * w + x] - tmp[clampY(row - radius) * w + x];
    }
  }

  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const v = luma[i] + amount * (luma[i] - blur[i]);
    const c = v < 0 ? 0 : v > 255 ? 255 : v;
    data[p] = c;
    data[p + 1] = c;
    data[p + 2] = c;
    data[p + 3] = 255;
  }
  return out;
}
