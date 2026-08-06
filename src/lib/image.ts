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

/**
 * Grabs the current video frame, optionally cropping to a region of interest.
 * The ROI crop is what makes barcode decoding reliable: it removes the
 * background clutter around the guide box before the decoder ever sees it.
 */
export function captureFrame(
  video: HTMLVideoElement,
  roi?: { x: number; y: number; w: number; h: number },
): HTMLCanvasElement {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const region = roi
    ? {
        x: Math.round(roi.x * vw),
        y: Math.round(roi.y * vh),
        w: Math.round(roi.w * vw),
        h: Math.round(roi.h * vh),
      }
    : { x: 0, y: 0, w: vw, h: vh };

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
