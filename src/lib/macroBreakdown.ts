import { MEAL_SLOTS, type Meal, type MealItem, type MealSlot, type Nutrients } from '@/types';

/**
 * Turning the day's summary numbers back into the rows that produced them.
 *
 * The summary card can say "87 g of protein" but not where it came from, which
 * is the question people actually have when a number looks wrong. Everything
 * here is derived from the meals already in memory — no extra reads, so the
 * breakdown stays live with the rest of the day.
 */

/** The five figures on the day summary, each drillable. */
export type MacroKey = keyof Nutrients;

export const MACRO_KEYS: MacroKey[] = ['kcal', 'protein', 'carbs', 'fat', 'fibre'];

export const MACRO_META: Record<MacroKey, { label: string; unit: string; color: string }> = {
  kcal: { label: 'Calories', unit: 'Cal', color: 'var(--color-ring-calorie)' },
  protein: { label: 'Protein', unit: 'g', color: 'var(--color-macro-protein)' },
  fat: { label: 'Fats', unit: 'g', color: 'var(--color-macro-fat)' },
  carbs: { label: 'Carbs', unit: 'g', color: 'var(--color-macro-carb)' },
  fibre: { label: 'Fibre', unit: 'g', color: 'var(--color-macro-fibre)' },
};

export function isMacroKey(value: string | undefined): value is MacroKey {
  return Boolean(value && value in MACRO_META);
}

/** One logged item, carrying enough identity to edit or delete it from here. */
export interface BreakdownRow {
  mealId: string;
  slot: MealSlot;
  /** Position within the meal — what `replaceMealItem`/`removeMealItem` take. */
  index: number;
  item: MealItem;
  /** How much of the chosen macro this item contributed. */
  value: number;
  /** Share of the day's total for that macro, 0–1. */
  share: number;
}

export type SortField = 'amount' | 'name' | 'meal';
export type SortDir = 'asc' | 'desc';

export const SORT_LABEL: Record<SortField, string> = {
  amount: 'Amount',
  name: 'Name',
  meal: 'Meal',
};

/**
 * Every item logged that day and what it contributed.
 *
 * Items contributing zero are kept: "which of these has no fibre at all" is a
 * real question, and silently dropping rows makes the list disagree with the
 * Diet screen it was opened from.
 */
export function buildBreakdown(meals: Meal[], key: MacroKey): BreakdownRow[] {
  const rows: BreakdownRow[] = [];
  let total = 0;

  for (const meal of meals) {
    meal.items.forEach((item, index) => {
      const value = item.nutrients[key] ?? 0;
      total += value;
      rows.push({ mealId: meal.id, slot: meal.slot, index, item, value, share: 0 });
    });
  }

  if (total > 0) for (const row of rows) row.share = row.value / total;
  return rows;
}

/** Total of the chosen macro across a set of rows. */
export function sumRows(rows: BreakdownRow[]): number {
  return rows.reduce((sum, row) => sum + row.value, 0);
}

const slotOrder = (slot: MealSlot) => MEAL_SLOTS.indexOf(slot);

/**
 * Sorts a copy, never in place — the caller keeps the unsorted list so
 * switching direction doesn't compound.
 *
 * Ties break on the day's own order (meal slot, then position within it), so a
 * list of zeros stays in the order it was logged rather than shuffling.
 */
export function sortBreakdown(
  rows: BreakdownRow[],
  field: SortField,
  dir: SortDir,
): BreakdownRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  const logOrder = (a: BreakdownRow, b: BreakdownRow) =>
    slotOrder(a.slot) - slotOrder(b.slot) || a.index - b.index;

  return [...rows].sort((a, b) => {
    switch (field) {
      case 'amount':
        return sign * (a.value - b.value) || logOrder(a, b);
      case 'name':
        return sign * a.item.name.localeCompare(b.item.name) || logOrder(a, b);
      case 'meal':
        return sign * logOrder(a, b);
    }
  });
}

/** Per-slot totals, for the filter chips and the grouped subtotals. */
export function slotTotals(rows: BreakdownRow[]): Map<MealSlot, number> {
  const map = new Map<MealSlot, number>();
  for (const row of rows) map.set(row.slot, (map.get(row.slot) ?? 0) + row.value);
  return map;
}

/** Rounds for display: calories to whole numbers, grams to one decimal. */
export function formatMacro(value: number, key: MacroKey): string {
  if (key === 'kcal') return String(Math.round(value));
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Which macro of an item is largest relative to the day — used for the AI gap. */
export function macroGap(totals: Nutrients, targets: Nutrients): Record<MacroKey, number> {
  return {
    kcal: targets.kcal - totals.kcal,
    protein: targets.protein - totals.protein,
    fat: targets.fat - totals.fat,
    carbs: targets.carbs - totals.carbs,
    fibre: targets.fibre - totals.fibre,
  };
}
