import { MEAL_TEMPLATES, type MealTemplate } from '@/data/mealTemplates';
import { buildMealItem, formatPortion, roundNutrients, sumNutrients } from './nutrition';
import {
  DIET_FOCUS_LABEL,
  DIET_TYPE_LABEL,
  MEAL_SLOTS,
  MEAL_SLOT_SHARE,
  type DietPrefs,
  type DietType,
  type Food,
  type MealItem,
  type MealSlot,
  type Nutrients,
  type PlanDay,
  type PlanMeal,
} from '@/types';

/**
 * The offline diet planner.
 *
 * Builds a plan from curated meal templates (`data/mealTemplates.ts`) over the
 * bundled food catalog, so it needs no key and no network, and every number in
 * it comes from the same composition tables the diary uses — a planned meal
 * logged as-is shows exactly the calories the plan promised.
 *
 * Per slot it scales each eligible template's staple to the slot's calorie
 * share, then scores it: calories closest to the slot budget first, then the
 * plan's focus (protein density, or carbohydrate share), then variety across
 * the plan, and a small pull toward foods the user already logs. A final pass
 * per day nudges the staples so the day lands near the target rather than
 * accumulating each slot's rounding.
 */

const DIET_RANK: Record<DietType, number> = { vegan: 0, veg: 1, egg: 2, nonveg: 3 };

/** A diet allows a meal if the meal needs no more than the diet permits. */
export function dietAllows(diet: DietType, meal: DietType): boolean {
  return DIET_RANK[meal] <= DIET_RANK[diet];
}

/** Deterministic PRNG, so a seed reproduces a plan and a new seed varies it. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Rounds a scaled quantity to something a person would actually serve.
 * Measured servings (a katori, a glass, 100 g) go in halves; counted ones (an
 * egg, an idli, a slice, a roti) go in whole numbers — "4.5 eggs" is a
 * rounding artefact, not a portion.
 */
const MEASURED = /katori|cup|glass|tbsp|tsp|bowl|plate|scoop|\bg\b|grams/i;
function roundServing(qty: number, label: string): number {
  return MEASURED.test(label) ? Math.max(0.5, Math.round(qty * 2) / 2) : Math.max(1, Math.round(qty));
}

/**
 * How far a staple may be scaled. Past this a meal stops looking like the dish
 * it is named for — five slices of toast is no longer "toast for breakfast" —
 * and a different meal should win the slot instead.
 */
const MIN_FACTOR = 0.5;
const MAX_FACTOR = 1.8;

export interface PlannerContext {
  targets: Nutrients;
  prefs: DietPrefs;
  /** The catalog, by name. Templates referencing a missing food are skipped. */
  foodsByName: Map<string, Food>;
}

export function plannerContext(targets: Nutrients, prefs: DietPrefs, foods: Food[]): PlannerContext {
  return { targets, prefs, foodsByName: new Map(foods.map((f) => [f.name, f])) };
}

function avoided(template: MealTemplate, avoid: string[]): boolean {
  if (!avoid.length) return false;
  const text = [template.name, ...template.parts.map((p) => p.food)].join(' ').toLowerCase();
  return avoid.some((word) => word && text.includes(word));
}

export function eligibleTemplates(ctx: PlannerContext, slot: MealSlot): MealTemplate[] {
  return MEAL_TEMPLATES.filter(
    (t) =>
      t.slots.includes(slot) &&
      dietAllows(ctx.prefs.diet, t.diet) &&
      !avoided(t, ctx.prefs.avoid) &&
      t.parts.every((p) => ctx.foodsByName.get(p.food)?.servings.some((s) => s.label === p.serving)),
  );
}

/** The template's items with the scalable parts multiplied by `factor`. */
function itemsAt(ctx: PlannerContext, template: MealTemplate, factor: number): MealItem[] {
  const anyScalable = template.parts.some((p) => p.scalable);
  return template.parts.map((p) => {
    const food = ctx.foodsByName.get(p.food)!;
    const qty = p.scalable || !anyScalable ? roundServing(p.qty * factor, p.serving) : p.qty;
    return buildMealItem(food, p.serving, qty);
  });
}

/** Scales a template's staple so the meal lands as close to `kcal` as halves allow. */
function fitTemplate(ctx: PlannerContext, template: MealTemplate, kcal: number): MealItem[] {
  const base = itemsAt(ctx, template, 1);
  const anyScalable = template.parts.some((p) => p.scalable);
  let fixed = 0;
  let scalable = 0;
  template.parts.forEach((p, i) => {
    if (p.scalable || !anyScalable) scalable += base[i].nutrients.kcal;
    else fixed += base[i].nutrients.kcal;
  });
  const factor = scalable > 0 ? Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, (kcal - fixed) / scalable)) : 1;
  return itemsAt(ctx, template, factor);
}

export function describeItems(items: MealItem[]): string {
  return items.map((i) => `${formatPortion(i.qty, i.servingLabel)} ${i.name}`).join(' · ');
}

export function toPlanMeal(slot: MealSlot, name: string, items: MealItem[], templateId?: string): PlanMeal {
  const n = roundNutrients(sumNutrients(items.map((i) => i.nutrients)));
  return {
    slot,
    name,
    suggestion: `${name}: ${describeItems(items)}`,
    kcal: n.kcal,
    protein: n.protein,
    carbs: n.carbs,
    fat: n.fat,
    items,
    templateId,
  };
}

interface Usage {
  count: Map<string, number>;
  lastDay: Map<string, number>;
}

function score(
  ctx: PlannerContext,
  items: MealItem[],
  slot: MealSlot,
  template: MealTemplate,
  dayIndex: number,
  usage: Usage,
  jitter: number,
): number {
  const budget = ctx.targets.kcal * MEAL_SLOT_SHARE[slot];
  const proteinBudget = ctx.targets.protein * MEAL_SLOT_SHARE[slot];
  const n = sumNutrients(items.map((i) => i.nutrients));
  let s = (Math.abs(n.kcal - budget) / Math.max(1, budget)) * 10;

  const proteinShare = (n.protein * 4) / Math.max(1, n.kcal);
  const carbShare = (n.carbs * 4) / Math.max(1, n.kcal);
  if (ctx.prefs.focus === 'high_protein') {
    s -= proteinShare * 12;
  } else {
    s += Math.max(0, (proteinBudget - n.protein) / Math.max(1, proteinBudget)) * 4;
  }
  if (ctx.prefs.focus === 'low_carb') s += Math.max(0, carbShare - 0.3) * 25;

  // Variety: a meal already in the plan costs more each time, and repeating
  // yesterday's is the worst case — that's the plan people abandon first.
  s += (usage.count.get(template.id) ?? 0) * 2.5;
  if (usage.lastDay.get(template.id) === dayIndex - 1) s += 3;

  // A pull toward food they already eat: a plan made of strangers isn't followed.
  const familiar = items.filter((i) => (ctx.foodsByName.get(i.name)?.useCount ?? 0) > 0).length;
  s -= Math.min(1.5, familiar * 0.5);

  return s + jitter;
}

function pick(
  ctx: PlannerContext,
  slot: MealSlot,
  dayIndex: number,
  usage: Usage,
  random: () => number,
  exclude: Set<string>,
): PlanMeal | undefined {
  const budget = ctx.targets.kcal * MEAL_SLOT_SHARE[slot];
  let best: { meal: PlanMeal; score: number } | undefined;
  for (const t of eligibleTemplates(ctx, slot)) {
    if (exclude.has(t.id)) continue;
    const items = fitTemplate(ctx, t, budget);
    const sc = score(ctx, items, slot, t, dayIndex, usage, random() * 1.2);
    if (!best || sc < best.score) best = { meal: toPlanMeal(slot, t.name, items, t.id), score: sc };
  }
  return best?.meal;
}

/** Re-fits a day's staples so it lands near the calorie target as a whole. */
function balanceDay(ctx: PlannerContext, meals: PlanMeal[]): PlanMeal[] {
  const total = meals.reduce((s, m) => s + m.kcal, 0);
  if (!total || Math.abs(total - ctx.targets.kcal) / ctx.targets.kcal < 0.05) return meals;
  const factor = ctx.targets.kcal / total;
  return meals.map((m) => {
    const t = MEAL_TEMPLATES.find((x) => x.id === m.templateId);
    if (!t) return m;
    const items = fitTemplate(ctx, t, m.kcal * factor);
    return toPlanMeal(m.slot, t.name, items, t.id);
  });
}

export interface BuiltPlan {
  title: string;
  summary: string;
  days: PlanDay[];
}

export function buildDietPlan(ctx: PlannerContext, seed = Date.now()): BuiltPlan {
  const random = rng(seed);
  const usage: Usage = { count: new Map(), lastDay: new Map() };
  const days: PlanDay[] = [];

  for (let d = 0; d < ctx.prefs.days; d++) {
    const used = new Set<string>();
    let meals: PlanMeal[] = [];
    for (const slot of MEAL_SLOTS) {
      const meal = pick(ctx, slot, d, usage, random, used);
      if (!meal) continue;
      used.add(meal.templateId!);
      usage.count.set(meal.templateId!, (usage.count.get(meal.templateId!) ?? 0) + 1);
      usage.lastDay.set(meal.templateId!, d);
      meals.push(meal);
    }
    meals = balanceDay(ctx, meals);
    days.push({ label: `Day ${d + 1}`, meals });
  }

  const avgKcal = Math.round(days.reduce((s, d) => s + d.meals.reduce((a, m) => a + m.kcal, 0), 0) / Math.max(1, days.length));
  const avgProtein = Math.round(
    days.reduce((s, d) => s + d.meals.reduce((a, m) => a + (m.protein ?? 0), 0), 0) / Math.max(1, days.length),
  );
  const { diet, focus } = ctx.prefs;
  return {
    title: `${ctx.prefs.days}-day ${DIET_TYPE_LABEL[diet].toLowerCase()} plan`,
    summary: `${DIET_FOCUS_LABEL[focus]}: about ${avgKcal.toLocaleString()} kcal and ${avgProtein} g protein a day against your ${ctx.targets.kcal.toLocaleString()} kcal and ${ctx.targets.protein} g targets. Built from everyday home dishes in the food database; every meal can be logged in one tap.`,
    days,
  };
}

/**
 * A replacement for one planned meal: the best-scoring meal for that slot that
 * isn't already on that day. Works on AI plans too, since it only needs the
 * slot and what else the day holds.
 */
export function swapMeal(ctx: PlannerContext, day: PlanDay, index: number, seed = Date.now()): PlanMeal | undefined {
  const current = day.meals[index];
  const exclude = new Set(day.meals.map((m) => m.templateId).filter((x): x is string => Boolean(x)));
  const usage: Usage = { count: new Map(), lastDay: new Map() };
  // Seeded per call so repeated swaps walk through different options rather
  // than landing on the same runner-up every time.
  const meal = pick(ctx, current.slot, 0, usage, rng(seed), exclude);
  return meal;
}

export interface ShoppingLine {
  key: string;
  name: string;
  portion: string;
  grams: number;
}

/**
 * Everything a plan uses, summed per food and serving. Amounts are as eaten —
 * cooked rice, not raw — which is how the catalog stores them; the screen
 * says so.
 */
export function shoppingList(days: PlanDay[]): ShoppingLine[] {
  const lines = new Map<string, { name: string; grams: number; byLabel: Map<string, number> }>();
  for (const day of days) {
    for (const meal of day.meals) {
      for (const item of meal.items ?? []) {
        const key = item.foodId ?? item.name;
        const line = lines.get(key) ?? { name: item.name, grams: 0, byLabel: new Map<string, number>() };
        line.grams += item.grams;
        line.byLabel.set(item.servingLabel, (line.byLabel.get(item.servingLabel) ?? 0) + item.qty);
        lines.set(key, line);
      }
    }
  }
  return [...lines.entries()]
    .map(([key, line]) => {
      // One serving size across the plan reads naturally ("6 roti"); a food
      // planned in two different servings is summed by weight instead.
      const [label, qty] = line.byLabel.size === 1 ? [...line.byLabel.entries()][0] : [undefined, 0];
      return {
        key,
        name: line.name,
        grams: Math.round(line.grams),
        portion: label ? formatPortion(Math.round(qty * 100) / 100, label) : `${Math.round(line.grams)} g`,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Dev-time check that every template still resolves against the catalog. */
export function unresolvedTemplateParts(foods: Food[]): string[] {
  const byName = new Map(foods.map((f) => [f.name, f]));
  return MEAL_TEMPLATES.flatMap((t) =>
    t.parts
      .filter((p) => !byName.get(p.food)?.servings.some((s) => s.label === p.serving))
      .map((p) => `${t.id}: ${p.food} / ${p.serving}`),
  );
}
