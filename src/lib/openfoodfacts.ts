import type { Food, MicroId, Micros, Nutrients, Serving } from '@/types';
import { hasMicros } from './micros';
import { gtinCandidates } from './gtin';

/**
 * Open Food Facts lookup — free, keyless, ~3M barcoded products.
 *
 * The data is crowd-sourced, so nearly every field is optional and some
 * products carry only a name. Everything here is written defensively: a
 * partial hit still beats sending the user to manual entry.
 */

const BASE = 'https://world.openfoodfacts.org/api/v2/product';

// Only the fields we use, so the response stays small on mobile data.
const FIELDS = [
  'code',
  'product_name',
  'product_name_en',
  'generic_name',
  'brands',
  'quantity',
  'serving_size',
  'serving_quantity',
  'nutriments',
  'nutriscore_grade',
  'nova_group',
  'categories_tags',
].join(',');

/**
 * Open Food Facts nutriment key → the micronutrient it maps to, with the
 * factor that converts OFF's unit to ours.
 *
 * OFF normalises every `_100g` value to grams regardless of how the label
 * printed it, so milligram nutrients are ×1000 and microgram nutrients ×1e6.
 * Getting this wrong is invisible rather than loud — a thousand-fold error
 * still renders as a plausible-looking bar — hence the explicit table.
 */
const MICRO_FIELDS: { key: string; id: MicroId; factor: number }[] = [
  { key: 'iron_100g', id: 'iron', factor: 1e3 },
  { key: 'calcium_100g', id: 'calcium', factor: 1e3 },
  { key: 'magnesium_100g', id: 'magnesium', factor: 1e3 },
  { key: 'zinc_100g', id: 'zinc', factor: 1e3 },
  { key: 'potassium_100g', id: 'potassium', factor: 1e3 },
  { key: 'sodium_100g', id: 'sodium', factor: 1e3 },
  { key: 'vitamin-a_100g', id: 'vitaminA', factor: 1e6 },
  { key: 'vitamin-c_100g', id: 'vitaminC', factor: 1e3 },
  { key: 'vitamin-d_100g', id: 'vitaminD', factor: 1e6 },
  { key: 'vitamin-e_100g', id: 'vitaminE', factor: 1e3 },
  { key: 'vitamin-b12_100g', id: 'vitaminB12', factor: 1e6 },
  { key: 'vitamin-b9_100g', id: 'folate', factor: 1e6 },
];

/**
 * Pulls whatever micronutrients the product declares.
 *
 * Only keys actually present are copied: a label that lists calcium and
 * nothing else should count its calcium and stay silent on the rest, not
 * report eleven zeroes and drag the day's totals down.
 */
function readMicros(n: Record<string, number | string | undefined>): Micros | undefined {
  const micros: Micros = {};
  for (const { key, id, factor } of MICRO_FIELDS) {
    if (n[key] === undefined || n[key] === '') continue;
    const value = toNum(n[key]) * factor;
    if (Number.isFinite(value)) micros[id] = Math.round(value * 100) / 100;
  }
  return hasMicros(micros) ? micros : undefined;
}

interface OFFResponse {
  status?: number;
  status_verbose?: string;
  product?: {
    code?: string;
    product_name?: string;
    product_name_en?: string;
    generic_name?: string;
    brands?: string;
    quantity?: string;
    serving_size?: string;
    serving_quantity?: number | string;
    nutriscore_grade?: string;
    nova_group?: number;
    categories_tags?: string[];
    nutriments?: Record<string, number | string | undefined>;
  };
}

export interface OFFResult {
  found: boolean;
  food?: Omit<Food, 'id' | 'createdAt' | 'useCount'>;
  nutriscore?: string;
  novaGroup?: number;
  /** Set when the product exists but has no usable nutrition data. */
  partial?: boolean;
}

const toNum = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/**
 * Looks a barcode up, trying each plausible form of the code.
 *
 * The scanner reads whatever symbology is printed on the pack, and Open Food
 * Facts stores whichever form its contributor entered — usually GTIN-13. A
 * UPC-A or UPC-E scanned verbatim therefore misses products that are in the
 * database, which is indistinguishable, from the user's side, from the product
 * being absent. `gtinCandidates` caps the attempts, so the worst case is three
 * requests rather than one.
 *
 * A product that exists but carries no nutrition is remembered rather than
 * discarded: knowing its name is worth far more than a bare "not found", both
 * to show the user and to give the AI fallback something real to work from.
 */
export async function lookupBarcode(
  barcode: string,
  signal?: AbortSignal,
  format?: string,
): Promise<OFFResult> {
  let partialHit: OFFResult | undefined;

  for (const candidate of gtinCandidates(barcode, format)) {
    const hit = await lookupExact(candidate, signal);
    if (hit.found && !hit.partial) return hit;
    // Keep the first named-but-empty product; a later candidate may still
    // turn up the same product with a full panel.
    if (hit.found && !partialHit) partialHit = hit;
  }

  return partialHit ?? { found: false };
}

async function lookupExact(barcode: string, signal?: AbortSignal): Promise<OFFResult> {
  const res = await fetch(`${BASE}/${encodeURIComponent(barcode)}.json?fields=${FIELDS}`, {
    signal,
    headers: { accept: 'application/json' },
  });

  // 404 is the normal "unknown barcode" answer, not an error worth throwing on.
  if (res.status === 404) return { found: false };
  if (!res.ok) throw new Error(`Open Food Facts returned ${res.status}`);

  const data = (await res.json()) as OFFResponse;
  if (data.status === 0 || !data.product) return { found: false };

  const p = data.product;
  const n = p.nutriments ?? {};

  const name =
    p.product_name_en?.trim() ||
    p.product_name?.trim() ||
    p.generic_name?.trim() ||
    '';
  if (!name) return { found: false };

  // OFF stores kcal under energy-kcal_100g, but older entries only have
  // kilojoules — convert rather than showing a zero-calorie food.
  const kcal =
    toNum(n['energy-kcal_100g']) ||
    (toNum(n['energy-kj_100g']) ? toNum(n['energy-kj_100g']) / 4.184 : 0) ||
    (toNum(n.energy_100g) ? toNum(n.energy_100g) / 4.184 : 0);

  const per100g: Nutrients = {
    kcal: Math.round(kcal),
    protein: round1(toNum(n.proteins_100g)),
    fat: round1(toNum(n.fat_100g)),
    carbs: round1(toNum(n.carbohydrates_100g)),
    fibre: round1(toNum(n.fiber_100g)),
  };

  const micros = readMicros(n);

  const servings: Serving[] = [];
  const servingGrams = toNum(p.serving_quantity);
  if (servingGrams > 0) {
    servings.push({
      label: p.serving_size?.trim() || `1 serving (${Math.round(servingGrams)} g)`,
      grams: servingGrams,
    });
  }
  servings.push({ label: '100 g', grams: 100 });

  // Whole-pack option, useful for single-serve snacks people finish in one go.
  const packGrams = parseQuantity(p.quantity);
  if (packGrams && packGrams !== servingGrams && packGrams <= 2000) {
    servings.push({ label: `Whole pack (${Math.round(packGrams)} g)`, grams: packGrams });
  }

  return {
    found: true,
    partial: per100g.kcal === 0,
    nutriscore: p.nutriscore_grade?.toUpperCase(),
    novaGroup: p.nova_group,
    food: {
      name,
      brand: p.brands?.split(',')[0]?.trim() || undefined,
      barcode: p.code ?? barcode,
      per100g,
      micros,
      servings,
      source: 'openfoodfacts',
      tags: ['packaged', ...(p.categories_tags ?? []).slice(0, 4).map((t) => t.replace(/^en:/, ''))],
      verified: false,
    },
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** "500 g", "1.5 l", "250ml" → grams (treating ml as g, which is close enough). */
function parseQuantity(raw?: string): number | null {
  if (!raw) return null;
  const match = raw.toLowerCase().match(/([\d.]+)\s*(kg|g|l|ml|cl)/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  switch (match[2]) {
    case 'kg':
      return value * 1000;
    case 'l':
      return value * 1000;
    case 'cl':
      return value * 10;
    default:
      return value;
  }
}
