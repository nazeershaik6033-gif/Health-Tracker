/**
 * Barcode decoding with a native-first, wasm-fallback strategy.
 *
 * `BarcodeDetector` is hardware-accelerated where it exists (Chrome, Edge,
 * Chromium-based browsers generally) but WebKit has never implemented it —
 * so on iOS Safari, native detection always misses and every scan runs on
 * the wasm decoder below. It is not the rare fallback path the split
 * suggests; on iPhone it is the only path. The decoder choice matters far
 * less than the two things around it: cropping to the guide box before
 * decoding, and requiring the same value on several consecutive frames
 * before accepting it. Those are what stop a misread under glare or motion
 * blur.
 */
import zxingWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import type { DecodeRequest, DecodeResponse } from './decode.worker';

export type BarcodeFormat =
  | 'ean_13'
  | 'ean_8'
  | 'upc_a'
  | 'upc_e'
  | 'code_128'
  | 'code_39'
  | 'itf'
  | 'codabar'
  | 'qr_code'
  | 'data_matrix';

/**
 * `qr_code` and `data_matrix` are here because packaging is moving to them:
 * a GS1 Digital Link QR carries the same GTIN a printed barcode does, plus a
 * batch and an expiry, and on many products it is now the only symbol on the
 * pack. Both decoders read them at no extra cost — the wasm build already
 * contains the QR reader whether or not it is asked for.
 */
export const FORMATS: BarcodeFormat[] = [
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'code_128',
  'code_39',
  'itf',
  'qr_code',
  'data_matrix',
];

export interface DecodeResult {
  value: string;
  format: string;
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string; format: string }[]>;
}

declare global {
  interface Window {
    BarcodeDetector?: {
      new (options?: { formats?: string[] }): BarcodeDetectorLike;
      getSupportedFormats?: () => Promise<string[]>;
    };
  }
}

export type DecoderKind = 'native' | 'wasm' | 'none';

export interface DecodeOptions {
  /**
   * Spend more time per frame looking for a symbol. Worth it on the cropped
   * guide-box pass, where the barcode almost certainly is; the occasional
   * full-frame sweep runs without it to stay cheap.
   */
  thorough?: boolean;
}

export interface Decoder {
  kind: DecoderKind;
  /** True when decoding happens off the main thread. */
  offThread?: boolean;
  decode(canvas: HTMLCanvasElement, opts?: DecodeOptions): Promise<DecodeResult | null>;
  /** Releases a worker, if there is one. */
  dispose?(): void;
}

async function createNative(): Promise<Decoder | null> {
  const Ctor = window.BarcodeDetector;
  if (!Ctor) return null;
  try {
    // Chrome ships the constructor but can still lack formats on some Linux
    // builds; asking up front avoids a detector that never returns anything.
    const supported = (await Ctor.getSupportedFormats?.()) ?? FORMATS;
    const formats = FORMATS.filter((f) => supported.includes(f));
    if (!formats.length) return null;

    const detector = new Ctor({ formats });
    return {
      kind: 'native',
      async decode(canvas) {
        const hits = await detector.detect(canvas);
        const hit = hits.find((h) => h.rawValue?.trim());
        return hit ? { value: hit.rawValue.trim(), format: hit.format } : null;
      },
    };
  } catch {
    return null;
  }
}

async function createWasm(): Promise<Decoder | null> {
  try {
    // Loaded on demand — the wasm binary is ~640 KB and most sessions never
    // open the scanner.
    const zxing = await import('zxing-wasm/reader');
    // zxing-wasm's *default* locateFile fetches the binary from jsDelivr's
    // CDN on every session, not from anything this app ships. That is a
    // silent violation of "nothing leaves your device but the AI requests you
    // configure", and a single point of failure: a content blocker, a
    // corporate filter, or the CDN having a bad day all present as "Scan
    // doesn't work", with no local fallback to catch it. Worse, WebKit does
    // not implement the Barcode Detection API at all — native detection
    // never succeeds on iOS Safari, so every scan there depended on this CDN
    // fetch. Pointing locateFile at the copy Vite bundles removes the
    // dependency entirely; decoding then works fully offline.
    await zxing.prepareZXingModule?.({
      overrides: { locateFile: () => zxingWasmUrl },
      fireImmediately: true,
    });

    return {
      kind: 'wasm',
      async decode(canvas, opts) {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return null;
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const results = await zxing.readBarcodes(data, {
          tryHarder: opts?.thorough ?? true,
          formats: [
            'EAN-13',
            'EAN-8',
            'UPC-A',
            'UPC-E',
            'Code128',
            'Code39',
            'ITF',
            'QRCode',
            'DataMatrix',
          ],
          maxNumberOfSymbols: 1,
        });
        const hit = results.find((r) => r.isValid && r.text.trim());
        return hit ? { value: hit.text.trim(), format: hit.format } : null;
      },
    };
  } catch {
    return null;
  }
}

/**
 * The same wasm decoder, in a dedicated worker.
 *
 * On iOS this is the path every scan takes, and the reason it exists: a
 * main-thread decode blocks the viewfinder and every button for as long as it
 * runs. The worker is warmed with a 1x1 frame before it is handed out, so a
 * worker that cannot load its wasm (old WebKit, a blocked fetch) is caught
 * here and the main-thread decoder is used instead, rather than the scanner
 * silently reading nothing.
 */
async function createWorkerDecoder(): Promise<Decoder | null> {
  if (typeof Worker === 'undefined' || typeof ImageData === 'undefined') return null;

  let worker: Worker;
  try {
    worker = new Worker(new URL('./decode.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }

  type Pending = { resolve: (r: DecodeResponse) => void; reject: (e: unknown) => void };
  const pending = new Map<number, Pending>();
  let seq = 0;
  let dead = false;

  worker.onmessage = (e: MessageEvent<DecodeResponse>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    p.resolve(e.data);
  };
  worker.onerror = (e) => {
    dead = true;
    for (const p of pending.values()) p.reject(e);
    pending.clear();
  };

  function send(image: ImageData, tryHarder: boolean): Promise<DecodeResponse> {
    if (dead) return Promise.reject(new Error('Decoder worker stopped'));
    const id = ++seq;
    return new Promise<DecodeResponse>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      // Transferred, not copied: a 1280px frame is several MB of pixels.
      worker.postMessage({ id, image, tryHarder } satisfies DecodeRequest, [image.data.buffer]);
    });
  }

  try {
    // Loading the ~640 KB wasm happens on this first message.
    const warm = await Promise.race([
      send(new ImageData(1, 1), false),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Decoder worker timed out')), 15000),
      ),
    ]);
    if (warm.error) throw new Error(warm.error);
  } catch {
    worker.terminate();
    return null;
  }

  return {
    kind: 'wasm',
    offThread: true,
    async decode(canvas, opts) {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const res = await send(image, opts?.thorough ?? true);
      return res.hit;
    },
    dispose() {
      dead = true;
      worker.terminate();
      pending.clear();
    },
  };
}

export async function createDecoder(): Promise<Decoder> {
  const native = await createNative();
  if (native) return native;
  const offThread = await createWorkerDecoder();
  if (offThread) return offThread;
  const wasm = await createWasm();
  if (wasm) return wasm;
  return {
    kind: 'none',
    async decode() {
      return null;
    },
  };
}

/**
 * Accepts a barcode only once the same value has been read on
 * `threshold` frames within a short window.
 *
 * A single frame is genuinely unreliable: partial reads under glare produce
 * plausible-looking but wrong digits, and the user has no way to tell. Two
 * agreeing reads eliminate almost all of it at the cost of ~100 ms.
 */
export class ConsensusBuffer {
  private hits = new Map<string, { count: number; first: number }>();

  constructor(
    private readonly threshold = 2,
    private readonly windowMs = 2500,
  ) {}

  /** Returns the value once it clears the threshold, otherwise null. */
  push(value: string): string | null {
    const now = Date.now();
    for (const [key, entry] of this.hits) {
      if (now - entry.first > this.windowMs) this.hits.delete(key);
    }

    const entry = this.hits.get(value) ?? { count: 0, first: now };
    entry.count += 1;
    this.hits.set(value, entry);

    if (entry.count >= this.threshold) {
      this.hits.clear();
      return value;
    }
    return null;
  }

  reset() {
    this.hits.clear();
  }
}

/**
 * Check-digit validation for EAN/UPC. A barcode that fails this is a misread,
 * not a real product, so rejecting it early saves a pointless network lookup.
 */
export function isValidEAN(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return true; // not an EAN/UPC; nothing to check
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  const sum = digits
    .reverse()
    .reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}
