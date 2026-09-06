import type { Nutrients, Serving } from '@/types';

/**
 * Offline nutrition-label reader.
 *
 * The AI vision path is much better at this and is used whenever a key is
 * configured. This exists so label scanning still does something useful with
 * no key and no network — Tesseract runs entirely in the browser.
 */

export interface LabelReading {
  name: string;
  per100g: Nutrients;
  servings: Serving[];
  /** Raw OCR text, shown so the user can see what was actually read. */
  raw: string;
  /** How many of the five values were found rather than defaulted. */
  matched: number;
}

let workerPromise: Promise<import('tesseract.js').Worker> | null = null;

/**
 * Where the Tesseract runtime is served from.
 *
 * Left to itself, tesseract.js downloads its worker script, its wasm core and
 * the English model from jsDelivr on first use — three requests to a third
 * party, at the exact moment this reader is supposed to be proving it needs
 * nothing but the phone. On a plane, behind a filter, or in an installed PWA
 * with no connection, it hung and then failed. The files are vendored into
 * `public/tesseract/` instead; see the README there.
 *
 * `BASE_URL` because the app is served from `/` locally and `/<repo>/` on
 * GitHub Pages, and these are absolute paths, not relative ones.
 */
const RUNTIME = `${import.meta.env.BASE_URL}tesseract`;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, OEM } = await import('tesseract.js');
      // `corePath` and `langPath` are directories on purpose: tesseract.js
      // feature-detects wasm SIMD and appends the core filename itself, and
      // appends `eng.traineddata.gz` to the language path. Naming one core
      // explicitly would hand the SIMD decision to us and get it wrong on
      // some device we cannot test.
      return createWorker('eng', OEM.LSTM_ONLY, {
        workerPath: `${RUNTIME}/worker.min.js`,
        corePath: RUNTIME,
        langPath: RUNTIME,
        // The vendored model is the gzipped one, matching what the CDN
        // default would have served for an LSTM-only worker.
        gzip: true,
      });
    })();
  }
  return workerPromise;
}

/**
 * Loads the worker, the core and the model without recognising anything.
 *
 * ~7 MB has to arrive before the first read can start, and the natural moment
 * to spend it is while the user is still lining the pack up in the frame
 * rather than after they press the shutter. It also means an install that has
 * opened this screen once has the whole runtime in the service worker's cache,
 * which is what makes the offline reader genuinely work offline instead of
 * only working on a network.
 *
 * Failure is deliberately silent: this is an optimisation, and the read that
 * follows will surface any real problem itself.
 */
export async function warmOCR(): Promise<void> {
  try {
    await getWorker();
  } catch {
    workerPromise = null;
  }
}

export async function terminateOCR(): Promise<void> {
  if (!workerPromise) return;
  // Cleared first: this is also how a cancelled read stops an in-flight
  // recognise, so a caller that immediately starts another must get a fresh
  // worker rather than await the one being torn down.
  const pending = workerPromise;
  workerPromise = null;
  try {
    const worker = await pending;
    await worker.terminate();
  } catch {
    // A worker that never finished starting has nothing to terminate, and
    // failing to clean up is not worth surfacing over whatever went wrong
    // first.
  }
}

/**
 * Nutrition panels are a small, predictable vocabulary, which makes regex
 * extraction viable where general OCR parsing would not be. Each pattern
 * tolerates the usual OCR damage: `0` read as `O`, missing decimal points,
 * and the label word split from its value across a column gap.
 */
const PATTERNS: { key: keyof Nutrients; re: RegExp; scale?: number }[] = [
  { key: 'kcal', re: /energy[^\d\n]{0,40}?([\d.,]+)\s*k?cal/i },
  { key: 'kcal', re: /calories[^\d\n]{0,30}?([\d.,]+)/i },
  { key: 'kcal', re: /([\d.,]+)\s*kcal/i },
  { key: 'protein', re: /protein[^\d\n]{0,30}?([\d.,]+)/i },
  { key: 'fat', re: /(?:total\s+)?fat[^\d\n]{0,30}?([\d.,]+)/i },
  { key: 'carbs', re: /carbohydrate[s]?[^\d\n]{0,30}?([\d.,]+)/i },
  { key: 'carbs', re: /carbs[^\d\n]{0,30}?([\d.,]+)/i },
  { key: 'fibre', re: /(?:dietary\s+)?fib(?:re|er)[^\d\n]{0,30}?([\d.,]+)/i },
];

function toNumber(raw: string): number | null {
  // OCR frequently returns "1,5" for "1.5" and "O" for "0".
  const cleaned = raw.replace(/[Oo]/g, '0').replace(/,/g, '.').replace(/[^\d.]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 && n < 10000 ? n : null;
}

export function parseLabelText(text: string): Omit<LabelReading, 'raw'> {
  const per100g: Nutrients = { kcal: 0, protein: 0, fat: 0, carbs: 0, fibre: 0 };
  const seen = new Set<keyof Nutrients>();

  for (const { key, re } of PATTERNS) {
    if (seen.has(key)) continue;
    const match = text.match(re);
    if (!match) continue;
    const value = toNumber(match[1]);
    if (value === null) continue;
    per100g[key] = value;
    seen.add(key);
  }

  // Panels sometimes list only kilojoules.
  if (!seen.has('kcal')) {
    const kj = text.match(/([\d.,]+)\s*kj/i);
    const value = kj ? toNumber(kj[1]) : null;
    if (value) {
      per100g.kcal = Math.round(value / 4.184);
      seen.add('kcal');
    }
  }

  // If the panel is per-serving only, scale to 100 g so the row is comparable.
  const servings: Serving[] = [];
  const servingMatch = text.match(/serving\s+size[^\d\n]{0,20}?([\d.,]+)\s*(g|ml)/i);
  const servingGrams = servingMatch ? toNumber(servingMatch[1]) : null;
  const per100Declared = /per\s*100\s*(g|ml)/i.test(text);

  if (servingGrams && servingGrams > 0) {
    servings.push({ label: `1 serving (${Math.round(servingGrams)} g)`, grams: servingGrams });
    if (!per100Declared && seen.size > 0) {
      const factor = 100 / servingGrams;
      for (const key of seen) per100g[key] = Math.round(per100g[key] * factor * 10) / 10;
    }
  }
  servings.push({ label: '100 g', grams: 100 });

  // The product name is usually the longest all-caps or title-case line near
  // the top; that heuristic beats taking line 1, which is often a logo artefact.
  const name =
    text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 3 && l.length < 40 && /[a-z]/i.test(l) && !/\d{2,}/.test(l))
      .sort((a, b) => b.length - a.length)[0] ?? 'Scanned product';

  return { name, per100g, servings, matched: seen.size };
}

export async function readLabelOffline(
  canvas: HTMLCanvasElement,
  onProgress?: (pct: number) => void,
): Promise<LabelReading> {
  const worker = await getWorker();
  onProgress?.(0.35);
  const { data } = await worker.recognize(canvas);
  onProgress?.(0.95);
  const parsed = parseLabelText(data.text ?? '');
  return { ...parsed, raw: data.text ?? '' };
}
