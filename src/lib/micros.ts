import type { Meal, MealItem, MicroId, Micros, Profile, Sex } from '@/types';

/**
 * Micronutrient reference data and maths.
 *
 * Macros answer "how much did I eat"; micros answer "did I eat enough of the
 * things that are easy to miss". The two need different treatment:
 *
 *  - **Units differ per nutrient.** Iron is milligrams, B12 micrograms. Every
 *    number in this module carries its nutrient's own unit, and `MICROS` is
 *    the single place that says which.
 *  - **Missing is not zero.** Most foods in the world have no published
 *    micronutrient panel. A day built from foods with no micro data is not a
 *    day with no micronutrients, so the totals travel with a `coverage`
 *    figure and the UI says what fraction of the day it actually saw.
 *  - **Some are ceilings.** Sodium is the one to stay under, not to reach.
 */

export type MicroUnit = 'mg' | 'µg';

export type MicroGroup = 'mineral' | 'vitamin';

/** Where a nutrient sits against its target. Drives colour and copy. */
export type MicroStatus = 'low' | 'short' | 'good' | 'over';

export interface MicroDef {
  id: MicroId;
  label: string;
  /** Compact name for tight rows, e.g. "B12". */
  short: string;
  unit: MicroUnit;
  group: MicroGroup;
  /**
   * A ceiling rather than a goal — going under is the win. Only sodium, but
   * expressed as a flag so nothing has to special-case the id.
   */
  limit?: boolean;
  /**
   * Tolerable upper intake level per day, from the US Institute of Medicine.
   * Absent where no UL is established (potassium, B12), which is not the same
   * as "unlimited" — it means no adverse level was identified from food.
   */
  ul?: number;
  /** One line on why the day's number matters. */
  why: string;
}

/**
 * The tracked set, in display order within each group.
 *
 * Vitamin A is retinol activity equivalents (µg RAE) and folate is dietary
 * folate equivalents (µg DFE) — the same bases the composition tables use, so
 * a plant source's lower bioavailability is already accounted for.
 */
export const MICROS: MicroDef[] = [
  {
    id: 'iron',
    label: 'Iron',
    short: 'Iron',
    unit: 'mg',
    group: 'mineral',
    ul: 45,
    why: 'Carries oxygen in the blood. The most common shortfall worldwide, and the one that shows up as tiredness first.',
  },
  {
    id: 'calcium',
    label: 'Calcium',
    short: 'Calcium',
    unit: 'mg',
    group: 'mineral',
    ul: 2500,
    why: 'Bone density is built and defended daily; the body takes it from the skeleton when the diet is short.',
  },
  {
    id: 'magnesium',
    label: 'Magnesium',
    short: 'Magnesium',
    unit: 'mg',
    group: 'mineral',
    why: 'Involved in muscle contraction, nerve signalling and energy release. Whole grains, nuts and dals carry it; refined grains do not.',
  },
  {
    id: 'zinc',
    label: 'Zinc',
    short: 'Zinc',
    unit: 'mg',
    group: 'mineral',
    ul: 40,
    why: 'Immune function, wound healing and taste. Poorly absorbed from high-phytate vegetarian diets, so the target is worth hitting fully.',
  },
  {
    id: 'potassium',
    label: 'Potassium',
    short: 'Potassium',
    unit: 'mg',
    group: 'mineral',
    why: 'Balances sodium and helps keep blood pressure down. Most people get well under half of what they need.',
  },
  {
    id: 'sodium',
    label: 'Sodium',
    short: 'Sodium',
    unit: 'mg',
    group: 'mineral',
    limit: true,
    why: 'A ceiling, not a goal. Almost all of it arrives from salt added in cooking, pickles, papad and packaged food.',
  },
  {
    id: 'vitaminA',
    label: 'Vitamin A',
    short: 'Vit A',
    unit: 'µg',
    group: 'vitamin',
    ul: 3000,
    why: 'Vision in low light, skin and immune tissue. Orange and dark-green vegetables cover it cheaply.',
  },
  {
    id: 'vitaminC',
    label: 'Vitamin C',
    short: 'Vit C',
    unit: 'mg',
    group: 'vitamin',
    ul: 2000,
    why: 'Collagen and immune function, and it sharply increases how much iron you absorb from a plant-based meal eaten alongside it.',
  },
  {
    id: 'vitaminD',
    label: 'Vitamin D',
    short: 'Vit D',
    unit: 'µg',
    group: 'vitamin',
    ul: 100,
    why: 'Very little comes from food — sunlight does most of the work, which is why the food figure here is usually low even in a good diet.',
  },
  {
    id: 'vitaminE',
    label: 'Vitamin E',
    short: 'Vit E',
    unit: 'mg',
    group: 'vitamin',
    ul: 1000,
    why: 'An antioxidant that protects cell membranes. Nuts, seeds and cooking oils are effectively the only sources.',
  },
  {
    id: 'vitaminB12',
    label: 'Vitamin B12',
    short: 'B12',
    unit: 'µg',
    group: 'vitamin',
    why: 'Nerve function and red blood cells. Found only in animal foods and fortified products, so a vegetarian day rarely reaches the target from food alone.',
  },
  {
    id: 'folate',
    label: 'Folate',
    short: 'Folate',
    unit: 'µg',
    group: 'vitamin',
    ul: 1000,
    why: 'Cell division and red blood cell formation, and critical before and during early pregnancy. Dals, greens and citrus are the main sources.',
  },
];

export const MICRO_BY_ID: Record<MicroId, MicroDef> = Object.fromEntries(
  MICROS.map((m) => [m.id, m]),
) as Record<MicroId, MicroDef>;

export const MICRO_IDS: MicroId[] = MICROS.map((m) => m.id);

/* --------------------------------- targets -------------------------------- */

/**
 * Daily targets, primarily ICMR-NIN 2020 Recommended Dietary Allowances for
 * Indians — the right reference for this app's food catalog, and notably
 * higher than the US DRI for iron and zinc because Indian diets are
 * high-phytate and absorb less of both.
 *
 * Filled from WHO guidance where ICMR sets no figure: potassium (≥3510 mg/day)
 * and the sodium ceiling (<2000 mg/day).
 */
const BASE_TARGETS: Record<MicroId, { male: number; female: number }> = {
  iron: { male: 19, female: 29 },
  calcium: { male: 1000, female: 1000 },
  magnesium: { male: 440, female: 370 },
  zinc: { male: 17, female: 13.2 },
  potassium: { male: 3500, female: 3500 },
  sodium: { male: 2000, female: 2000 },
  vitaminA: { male: 1000, female: 840 },
  vitaminC: { male: 80, female: 65 },
  vitaminD: { male: 15, female: 15 },
  vitaminE: { male: 10, female: 8 },
  vitaminB12: { male: 2.2, female: 2.2 },
  folate: { male: 300, female: 300 },
};

/**
 * Age and sex adjustments applied on top of the adult figures.
 *
 * Two matter enough to model: iron falls after menopause because monthly
 * losses stop, and calcium rises in adolescence (peak bone mass is laid down
 * then) and again past 50 as absorption declines.
 */
function adjust(id: MicroId, base: number, sex: Sex, age: number): number {
  if (id === 'iron') {
    if (age < 19) return sex === 'female' ? 32 : 22;
    if (sex === 'female' && age >= 50) return 19;
  }
  if (id === 'calcium') {
    if (age < 19) return 1050;
    if (age >= 50) return 1200;
  }
  return base;
}

/**
 * `sex: 'other'` takes the midpoint rather than defaulting to either, matching
 * how `bmr()` handles the same case.
 */
export function microTargets(sex: Sex, age: number): Record<MicroId, number> {
  const out = {} as Record<MicroId, number>;
  for (const def of MICROS) {
    const { male, female } = BASE_TARGETS[def.id];
    const base = sex === 'male' ? male : sex === 'female' ? female : (male + female) / 2;
    const value = adjust(def.id, base, sex, age);
    // Round to something a person would read: whole numbers except for the
    // handful measured in single-digit units.
    out[def.id] = value >= 20 ? Math.round(value) : Math.round(value * 10) / 10;
  }
  return out;
}

export function targetsForProfile(profile: Profile | undefined): Record<MicroId, number> {
  if (!profile) return microTargets('other', 30);
  const age = Math.max(13, new Date().getFullYear() - profile.birthYear);
  return microTargets(profile.sex, age);
}

/* ---------------------------------- maths --------------------------------- */

export function addMicros(a: Micros, b: Micros): Micros {
  const out: Micros = { ...a };
  for (const id of MICRO_IDS) {
    const value = b[id];
    if (value === undefined) continue;
    out[id] = (out[id] ?? 0) + value;
  }
  return out;
}

export function scaleMicros(m: Micros, factor: number): Micros {
  const out: Micros = {};
  for (const id of MICRO_IDS) {
    const value = m[id];
    if (value !== undefined) out[id] = value * factor;
  }
  return out;
}

export function roundMicros(m: Micros): Micros {
  const out: Micros = {};
  for (const id of MICRO_IDS) {
    const value = m[id];
    if (value === undefined) continue;
    // Sub-milligram amounts of B12 and vitamin D are the whole story for those
    // nutrients, so small values keep two decimals rather than rounding to nil.
    out[id] = value >= 10 ? Math.round(value) : Math.round(value * 100) / 100;
  }
  return out;
}

export function sumMicros(list: Micros[]): Micros {
  return list.reduce(addMicros, {});
}

/** True when the food carries at least one usable micronutrient figure. */
export function hasMicros(m: Micros | undefined): m is Micros {
  return Boolean(m) && MICRO_IDS.some((id) => m![id] !== undefined);
}

export interface DayMicros {
  totals: Micros;
  /**
   * Share of the day's calories that came from items carrying micro data,
   * 0–1. The honest denominator: a 40%-covered day showing "30% of your iron"
   * is really saying "at least 30%", and the UI has to be able to say so.
   */
  coverage: number;
  /** Items with no micro data at all, so the gap can be named and fixed. */
  unknown: MealItem[];
}

export function dayMicros(meals: Meal[]): DayMicros {
  const totals: Micros[] = [];
  const unknown: MealItem[] = [];
  let known = 0;
  let all = 0;

  for (const meal of meals) {
    for (const item of meal.items) {
      // Weight coverage by calories rather than item count: one plate of
      // biryani with no data matters more than a missing cup of black coffee.
      const kcal = Math.max(0, item.nutrients.kcal);
      all += kcal;
      if (hasMicros(item.micros)) {
        totals.push(item.micros);
        known += kcal;
      } else {
        unknown.push(item);
      }
    }
  }

  return {
    totals: roundMicros(sumMicros(totals)),
    // A day of nothing but zero-calorie items still counts as covered if the
    // data is there, so fall back to item presence when there are no calories.
    coverage: all > 0 ? known / all : totals.length ? 1 : 0,
    unknown,
  };
}

/* -------------------------------- reporting ------------------------------- */

export function microPct(value: number, target: number): number {
  if (!target) return 0;
  return Math.max(0, Math.min(999, Math.round((value / target) * 100)));
}

export function microStatus(id: MicroId, value: number, target: number): MicroStatus {
  const def = MICRO_BY_ID[id];
  if (def.limit) return value > target ? 'over' : 'good';
  if (def.ul !== undefined && value > def.ul) return 'over';
  const pct = microPct(value, target);
  if (pct >= 90) return 'good';
  if (pct >= 60) return 'short';
  return 'low';
}

export const MICRO_STATUS_LABEL: Record<MicroStatus, string> = {
  low: 'Low',
  short: 'Short',
  good: 'On track',
  over: 'Over',
};

export const MICRO_STATUS_COLOR: Record<MicroStatus, string> = {
  low: '#dc2626',
  short: '#e5a50a',
  good: 'var(--color-brand-500)',
  over: '#dc2626',
};

/** "12.4 mg", "820 µg" — the value with the nutrient's own unit. */
export function formatMicro(id: MicroId, value: number): string {
  const { unit } = MICRO_BY_ID[id];
  const shown =
    value >= 100
      ? Math.round(value)
      : value >= 10
        ? Math.round(value * 10) / 10
        : Math.round(value * 100) / 100;
  return `${shown.toLocaleString()} ${unit}`;
}

export interface MicroRow {
  def: MicroDef;
  value: number;
  target: number;
  pct: number;
  status: MicroStatus;
}

export function microRows(totals: Micros, targets: Record<MicroId, number>): MicroRow[] {
  return MICROS.map((def) => {
    const value = totals[def.id] ?? 0;
    const target = targets[def.id];
    return { def, value, target, pct: microPct(value, target), status: microStatus(def.id, value, target) };
  });
}

/** The day's biggest shortfalls, worst first. Ceilings are excluded — being under sodium is not a gap. */
export function biggestGaps(rows: MicroRow[], limit = 3): MicroRow[] {
  return rows
    .filter((r) => !r.def.limit && r.status !== 'good')
    .sort((a, b) => a.pct - b.pct)
    .slice(0, limit);
}

export interface Contributor {
  name: string;
  amount: number;
  /** Share of the day's total for this nutrient, 0–1. */
  share: number;
}

/** What actually supplied a nutrient today, largest first. */
export function contributors(meals: Meal[], id: MicroId, limit = 4): Contributor[] {
  const byName = new Map<string, number>();
  let total = 0;
  for (const meal of meals) {
    for (const item of meal.items) {
      const amount = item.micros?.[id];
      if (amount === undefined || amount <= 0) continue;
      byName.set(item.name, (byName.get(item.name) ?? 0) + amount);
      total += amount;
    }
  }
  return [...byName.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, amount]) => ({ name, amount, share: total > 0 ? amount / total : 0 }));
}

/**
 * Foods from the catalog that would meaningfully close a gap, richest per
 * realistic serving first.
 *
 * Ranked per serving rather than per 100 g on purpose: per 100 g, chia seeds
 * top almost every mineral, but nobody eats 100 g of chia. The serving the
 * food already ships with is the portion the user would actually log.
 *
 * Foods the user has logged before come first. That is not a nicety: the
 * richest sources of B12 are all animal foods, and telling a vegetarian to eat
 * mutton curry is advice they will never take. Ordering by what they actually
 * eat keeps the list usable without asking anyone to declare a diet, and
 * without the app guessing one from their log.
 */
export interface MicroSuggestion {
  foodId: string;
  name: string;
  servingLabel: string;
  amount: number;
  /** Share of the daily target one serving covers, 0–1. */
  share: number;
  /** The user has logged this food before. */
  familiar: boolean;
}

export function suggestFoods(
  foods: {
    id: string;
    name: string;
    micros?: Micros;
    useCount?: number;
    servings: { label: string; grams: number }[];
  }[],
  id: MicroId,
  target: number,
  limit = 4,
): MicroSuggestion[] {
  if (MICRO_BY_ID[id].limit || !target) return [];
  const scored: MicroSuggestion[] = [];
  for (const food of foods) {
    const per100 = food.micros?.[id];
    if (!per100) continue;
    const serving = food.servings[0];
    if (!serving?.grams) continue;
    const amount = (per100 * serving.grams) / 100;
    // Below a tenth of the day's need it is not a suggestion, it is a rounding
    // error dressed up as advice.
    if (amount / target < 0.1) continue;
    scored.push({
      foodId: food.id,
      name: food.name,
      servingLabel: serving.label,
      amount,
      share: amount / target,
      familiar: (food.useCount ?? 0) > 0,
    });
  }
  scored.sort((a, b) => Number(b.familiar) - Number(a.familiar) || b.share - a.share);
  return scored.slice(0, limit);
}
