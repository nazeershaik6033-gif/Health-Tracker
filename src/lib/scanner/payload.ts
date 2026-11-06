import type { Nutrients, Serving } from '@/types';

/**
 * Works out what a scanned symbol actually contains.
 *
 * A 1D barcode is always a product number, so the scanner could treat every
 * read as one. A QR code cannot: the same square might hold a GS1 Digital Link
 * (a product number dressed as a URL), a plain number, a nutrition table, a
 * restaurant menu link, or arbitrary text. Deciding here — rather than in the
 * screen — keeps that judgement in one testable place and stops the scanner
 * firing a product lookup for a Wi-Fi password.
 */

export type ScanPayload =
  /** A product number, ready for the barcode lookup. */
  | { kind: 'gtin'; gtin: string; source: 'plain' | 'digital-link' | 'element-string' }
  /** Nutrition encoded in the symbol itself — no network lookup needed. */
  | { kind: 'nutrition'; name: string; brand?: string; per100g: Nutrients; servings: Serving[] }
  | { kind: 'url'; url: string }
  | { kind: 'text'; text: string };

/* ------------------------------ GS1 handling ----------------------------- */

/**
 * GS1 GTINs are carried as 14 digits, zero-padded on the left. The food
 * databases this app queries are keyed by the EAN-13 / UPC-A printed on the
 * pack, so the padding has to come back off or every Digital Link scan misses.
 */
function normaliseGtin(digits: string): string {
  const trimmed = digits.replace(/^0+/, '');
  if (trimmed.length <= 8) return trimmed.padStart(8, '0'); // EAN-8
  if (trimmed.length <= 12) return trimmed.padStart(12, '0'); // UPC-A
  return trimmed.padStart(13, '0'); // EAN-13
}

/**
 * GS1 Digital Link: the GTIN is the path segment after `/01/`.
 *
 * Real examples this has to survive:
 *   https://id.gs1.org/01/09506000134352
 *   https://example.com/01/09506000134352/10/LOT/21/SER
 *   https://brand.in/gtin/8901234567890?exp=261231
 */
function gtinFromUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  const segments = url.pathname.split('/').filter(Boolean);
  for (let i = 0; i < segments.length - 1; i++) {
    const key = segments[i].toLowerCase();
    if (key !== '01' && key !== 'gtin') continue;
    const value = segments[i + 1];
    if (/^\d{8,14}$/.test(value)) return normaliseGtin(value);
  }

  // Some issuers put it in the query string instead of the path.
  const query = url.searchParams.get('01') ?? url.searchParams.get('gtin');
  if (query && /^\d{8,14}$/.test(query)) return normaliseGtin(query);
  return null;
}

/**
 * GS1 element strings, as printed in DataMatrix and QR on packaged goods.
 * AI 01 is a fixed 14 digits, so the GTIN can be read without parsing the
 * separators that follow it.
 */
function gtinFromElementString(raw: string): string | null {
  const cleaned = raw.replace(/^\][A-Za-z]\d/, ''); // strip an AIM symbology id
  const parenthesised = cleaned.match(/\(01\)(\d{14})/);
  if (parenthesised) return normaliseGtin(parenthesised[1]);
  const bare = cleaned.match(/^01(\d{14})/);
  if (bare) return normaliseGtin(bare[1]);
  return null;
}

/* ---------------------------- nutrition payloads -------------------------- */

/**
 * Nutrient key aliases.
 *
 * Deliberately generous: these payloads are written by whoever printed the
 * pack, and "kcal", "energy", "cal" and "energy_kcal" all mean the same thing.
 */
const NUTRIENT_KEYS: Record<keyof Nutrients, string[]> = {
  kcal: ['kcal', 'cal', 'calories', 'energy', 'energykcal', 'energy_kcal'],
  protein: ['protein', 'p', 'prot'],
  fat: ['fat', 'f', 'totalfat', 'fats'],
  carbs: ['carbs', 'c', 'carb', 'carbohydrate', 'carbohydrates'],
  fibre: ['fibre', 'fiber', 'fib', 'dietaryfibre', 'dietaryfiber'],
};

const normaliseKey = (key: string) => key.toLowerCase().replace(/[\s_-]/g, '');

function readNutrients(source: Record<string, unknown>): Nutrients | null {
  const flat: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) flat[normaliseKey(key)] = value;

  const out: Nutrients = { kcal: 0, protein: 0, fat: 0, carbs: 0, fibre: 0 };
  let found = 0;

  for (const [field, aliases] of Object.entries(NUTRIENT_KEYS) as [keyof Nutrients, string[]][]) {
    for (const alias of aliases) {
      const value = flat[alias];
      if (value === undefined || value === null || value === '') continue;
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) continue;
      out[field] = n;
      found++;
      break;
    }
  }

  // Energy alone is not a nutrition panel, and a stray "c=1" in some unrelated
  // payload should not be read as one gram of carbohydrate.
  return found >= 2 ? out : null;
}

function stringField(source: Record<string, unknown>, ...names: string[]): string | undefined {
  for (const [key, value] of Object.entries(source)) {
    if (names.includes(normaliseKey(key)) && typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

/** `key=value` pairs separated by `|`, `;` or `,` — the compact pack format. */
function parsePairs(raw: string): Record<string, unknown> | null {
  if (!/[=:]/.test(raw)) return null;
  const out: Record<string, unknown> = {};
  for (const chunk of raw.split(/[|;,\n]/)) {
    const match = chunk.match(/^\s*([A-Za-z_][\w\s-]*)\s*[=:]\s*(.*)$/);
    if (match) out[match[1]] = match[2].trim();
  }
  return Object.keys(out).length ? out : null;
}

function toServings(source: Record<string, unknown>): Serving[] {
  const grams = Number(
    stringField(source, 'serving', 'servinggrams', 'servingsize', 'portion') ?? NaN,
  );
  const servings: Serving[] = [{ label: '100 g', grams: 100 }];
  if (Number.isFinite(grams) && grams > 0 && grams !== 100) {
    servings.unshift({ label: '1 serving', grams });
  }
  return servings;
}

function asNutritionPayload(source: Record<string, unknown>): ScanPayload | null {
  const per100g = readNutrients(source);
  if (!per100g) return null;
  return {
    kind: 'nutrition',
    name: stringField(source, 'name', 'n', 'product', 'productname', 'food') ?? 'Scanned product',
    brand: stringField(source, 'brand', 'b', 'manufacturer'),
    per100g,
    servings: toServings(source),
  };
}

/* -------------------------------- dispatch -------------------------------- */

export function interpretScan(raw: string): ScanPayload {
  const value = raw.trim();

  // 1. A bare product number — what every 1D barcode on a pack decodes to.
  if (/^\d{8}$|^\d{12,14}$/.test(value)) {
    return { kind: 'gtin', gtin: normaliseGtin(value), source: 'plain' };
  }

  // 2. GS1 element strings, before URL parsing: "(01)..." is not a URL.
  const element = gtinFromElementString(value);
  if (element) return { kind: 'gtin', gtin: element, source: 'element-string' };

  // 3. Structured nutrition, in either encoding.
  if (value.startsWith('{')) {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      // Nutrients may sit at the top level or under a per-100g key.
      const nested = parsed.per100g ?? parsed.per_100g ?? parsed.nutrition;
      const nutrition = asNutritionPayload(
        nested && typeof nested === 'object'
          ? { ...parsed, ...(nested as Record<string, unknown>) }
          : parsed,
      );
      if (nutrition) return nutrition;
    } catch {
      /* not JSON after all; fall through */
    }
  }

  // 4. A Digital Link is a URL *and* a product number. Check the product
  //    reading first, so a scan that can be looked up always is.
  const fromUrl = gtinFromUrl(value);
  if (fromUrl) return { kind: 'gtin', gtin: fromUrl, source: 'digital-link' };

  if (/^https?:\/\//i.test(value)) return { kind: 'url', url: value };

  const pairs = parsePairs(value);
  if (pairs) {
    const nutrition = asNutritionPayload(pairs);
    if (nutrition) return nutrition;
  }

  // 5. Last resort: any run of digits long enough to be a product code. This is
  //    the deliberately broad net — it catches non-standard packs at the cost
  //    of occasionally looking up a number that was never a barcode, which
  //    fails harmlessly with "not in the database".
  const digits = value.match(/\b(\d{8}|\d{12,14})\b/);
  if (digits) return { kind: 'gtin', gtin: normaliseGtin(digits[1]), source: 'plain' };

  return { kind: 'text', text: value };
}
