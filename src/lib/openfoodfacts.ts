import type { Food, Nutrients, Serving } from '@/types';

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

export async function lookupBarcode(
  barcode: string,
  signal?: AbortSignal,
): Promise<OFFResult> {
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
