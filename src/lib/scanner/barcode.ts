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

export type BarcodeFormat =
  | 'ean_13'
  | 'ean_8'
  | 'upc_a'
  | 'upc_e'
  | 'code_128'
  | 'code_39'
  | 'itf'
  | 'codabar';

export const FORMATS: BarcodeFormat[] = [
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'code_128',
  'code_39',
  'itf',
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

export interface Decoder {
  kind: DecoderKind;
  decode(canvas: HTMLCanvasElement): Promise<DecodeResult | null>;
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
      async decode(canvas) {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return null;
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const results = await zxing.readBarcodes(data, {
          tryHarder: true,
          formats: ['EAN-13', 'EAN-8', 'UPC-A', 'UPC-E', 'Code128', 'Code39', 'ITF'],
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

export async function createDecoder(): Promise<Decoder> {
  const native = await createNative();
  if (native) return native;
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
