import type { ImagePart } from '@/ai/types';

/**
 * Image handling for the vision calls.
 *
 * Everything is downscaled before it leaves the device: a modern phone photo
 * is 3-6 MB, which is slow to upload, expensive in image tokens, and no more
 * accurate than a 1024px version for recognising food on a plate.
 */

export const MAX_EDGE = 1024;
export const THUMB_EDGE = 256;

interface Decoded {
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

async function decode(source: Blob): Promise<Decoded> {
  const bitmap = await createImageBitmap(source);
  return { bitmap, width: bitmap.width, height: bitmap.height };
}

function fit(width: number, height: number, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { w: Math.round(width * scale), h: Math.round(height * scale) };
}

function draw(bitmap: ImageBitmap, w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable in this browser');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas;
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode image'))),
      'image/jpeg',
      quality,
    );
  });
}

export interface PreparedImage {
  /** Downscaled JPEG kept in IndexedDB. */
  full: Blob;
  /** Small JPEG for grids and rails, so lists don't decode full images. */
  thumb: Blob;
  width: number;
  height: number;
}

export async function prepareImage(source: Blob): Promise<PreparedImage> {
  const { bitmap, width, height } = await decode(source);
  try {
    const main = fit(width, height, MAX_EDGE);
    const small = fit(width, height, THUMB_EDGE);
    const [full, thumb] = await Promise.all([
      toBlob(draw(bitmap, main.w, main.h), 0.82),
      toBlob(draw(bitmap, small.w, small.h), 0.7),
    ]);
    return { full, thumb, width: main.w, height: main.h };
  } finally {
    bitmap.close();
  }
}

export async function blobToImagePart(blob: Blob): Promise<ImagePart> {
  const base64 = await blobToBase64(blob);
  const type = blob.type;
  const mediaType: ImagePart['mediaType'] =
    type === 'image/png' ? 'image/png' : type === 'image/webp' ? 'image/webp' : 'image/jpeg';
  return { base64, mediaType };
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the image'));
    reader.onload = () => {
      const result = String(reader.result);
      // Strip the "data:<type>;base64," prefix — providers want the payload only.
      const comma = result.indexOf(',');
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.readAsDataURL(blob);
  });
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Converts a rectangle expressed as fractions of the *displayed* video box into
 * pixel coordinates in the video's own frame, undoing `object-cover`.
 *
 * This is the whole barcode bug. Every preview in the app renders the stream
 * with `object-cover`, which scales the frame to fill the element and throws
 * away whatever overflows — on a portrait phone showing a landscape sensor,
 * that is a large slice off both sides. The guide box the user aims with is
 * positioned in element percentages, but the crop fed to the decoder was
 * reading the same percentages straight off the raw frame. The two only agree
 * when the element and the frame happen to share an aspect ratio, which on a
 * phone they never do, so the region being decoded sat somewhere off the region
 * being aimed at. A barcode centred perfectly in the box could be half outside
 * the strip that was actually read, and simply never decoded.
 */
export function displayRectToFrame(video: HTMLVideoElement, roi: Rect): Rect {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  // Before metadata arrives there is no frame to map into.
  if (!vw || !vh) return { x: 0, y: 0, w: 0, h: 0 };

  const ew = video.clientWidth || vw;
  const eh = video.clientHeight || vh;

  // `object-cover`: scale so the frame covers the box, centred, overflow clipped.
  const scale = Math.max(ew / vw, eh / vh);
  const cropX = (vw * scale - ew) / 2;
  const cropY = (vh * scale - eh) / 2;

  const x = (roi.x * ew + cropX) / scale;
  const y = (roi.y * eh + cropY) / scale;
  const w = (roi.w * ew) / scale;
  const h = (roi.h * eh) / scale;

  // Clamp, so a guide box larger than the visible frame still yields a legal
  // source rect rather than a drawImage that silently produces nothing.
  const left = Math.max(0, Math.min(vw, x));
  const top = Math.max(0, Math.min(vh, y));
  return {
    x: Math.round(left),
    y: Math.round(top),
    w: Math.round(Math.max(1, Math.min(w, vw - left))),
    h: Math.round(Math.max(1, Math.min(h, vh - top))),
  };
}

/**
 * Grabs the current video frame, optionally cropping to a region of interest.
 * The ROI crop is what makes barcode decoding reliable: it removes the
 * background clutter around the guide box before the decoder ever sees it.
 *
 * `roi` is given in fractions of the **displayed** element, the same numbers
 * that position the guide box, so what gets decoded is what the user framed.
 */
export function captureFrame(video: HTMLVideoElement, roi?: Rect): HTMLCanvasElement {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const region = roi ? displayRectToFrame(video, roi) : { x: 0, y: 0, w: vw, h: vh };

  const canvas = document.createElement('canvas');
  canvas.width = region.w;
  canvas.height = region.h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas is unavailable in this browser');
  ctx.drawImage(video, region.x, region.y, region.w, region.h, 0, 0, region.w, region.h);
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, quality = 0.85): Promise<Blob> {
  return toBlob(canvas, quality);
}

/** Human-readable size for the export warning. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
