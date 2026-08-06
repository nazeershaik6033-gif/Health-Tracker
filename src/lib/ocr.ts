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

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      return createWorker('eng');
    })();
  }
  return workerPromise;
}

export async function terminateOCR(): Promise<void> {
  if (!workerPromise) return;
  const worker = await workerPromise;
  await worker.terminate();
  workerPromise = null;
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
