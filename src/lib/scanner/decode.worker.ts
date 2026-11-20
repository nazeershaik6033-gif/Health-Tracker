/**
 * zxing-wasm, run off the main thread.
 *
 * On iPhone this decoder is the *only* barcode path (WebKit has no
 * `BarcodeDetector`), and a `tryHarder` pass over a camera frame takes tens to
 * hundreds of milliseconds there. Run on the main thread, every one of those
 * passes froze the viewfinder, the torch button and the back gesture — the
 * scanner felt broken even when it was working — and the frame rate had to be
 * capped low to leave the UI any room at all, which is what made reads slow
 * to land. In a worker the decoder can run back-to-back and the UI never
 * notices.
 */
import { prepareZXingModule, readBarcodes, type ReaderOptions } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

export interface DecodeRequest {
  id: number;
  image: ImageData;
  tryHarder: boolean;
}

export interface DecodeResponse {
  id: number;
  hit: { value: string; format: string } | null;
  error?: string;
}

const FORMATS: ReaderOptions['formats'] = [
  'EAN-13',
  'EAN-8',
  'UPC-A',
  'UPC-E',
  'Code128',
  'Code39',
  'ITF',
  'QRCode',
  'DataMatrix',
];

// The bundled copy, never the CDN default — see createWasm in ./barcode.
const ready = prepareZXingModule({
  overrides: { locateFile: () => wasmUrl },
  fireImmediately: true,
});

// Minimal typing: the app's tsconfig uses the DOM lib, not WebWorker.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<DecodeRequest>) => void) | null;
  postMessage(message: DecodeResponse): void;
};

scope.onmessage = async (e) => {
  const { id, image, tryHarder } = e.data;
  try {
    await ready;
    const results = await readBarcodes(image, {
      tryHarder,
      formats: FORMATS,
      maxNumberOfSymbols: 1,
    });
    const hit = results.find((r) => r.isValid && r.text.trim());
    scope.postMessage({
      id,
      hit: hit ? { value: hit.text.trim(), format: hit.format } : null,
    });
  } catch (err) {
    scope.postMessage({ id, hit: null, error: err instanceof Error ? err.message : String(err) });
  }
};
