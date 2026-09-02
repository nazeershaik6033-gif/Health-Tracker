import type {
  ActivityLevel,
  DayPeriod,
  Food,
  Goal,
  Meal,
  MealItem,
  MealSlot,
  Nutrients,
  Profile,
  Sex,
  WorkoutIntensity,
} from '@/types';
import { DAY_PERIOD_SHARE, DAY_PERIOD_SLOTS, MEAL_SLOT_SHARE, ZERO_NUTRIENTS } from '@/types';

export const ACTIVITY_FACTOR: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

export const ACTIVITY_LABEL: Record<ActivityLevel, string> = {
  sedentary: 'Sedentary — desk job, little exercise',
  light: 'Lightly active — 1–3 days a week',
  moderate: 'Moderately active — 3–5 days a week',
  active: 'Very active — 6–7 days a week',
  very_active: 'Extra active — physical job or twice daily',
};

export const GOAL_LABEL: Record<Goal, string> = {
  lose: 'Lose weight',
  maintain: 'Maintain weight',
  gain: 'Gain weight',
};

/** Mifflin-St Jeor. The most reliable of the common BMR estimators. */
export function bmr(sex: Sex, weightKg: number, heightCm: number, age: number): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  // "Other" sits between the two sex constants rather than defaulting to one.
  if (sex === 'male') return base + 5;
  if (sex === 'female') return base - 161;
  return base - 78;
}

export function tdee(bmrValue: number, activity: ActivityLevel): number {
  return bmrValue * ACTIVITY_FACTOR[activity];
}

/**
 * A 20% deficit / 15% surplus, floored at a safe minimum. The floors matter:
 * an aggressive deficit on a small, sedentary person can otherwise compute a
 * target below what's reasonable to eat.
 */
export function calorieTarget(tdeeValue: number, goal: Goal, sex: Sex): number {
  const floor = sex === 'female' ? 1200 : 1500;
  if (goal === 'lose') return Math.max(floor, Math.round(tdeeValue * 0.8));
  if (goal === 'gain') return Math.round(tdeeValue * 1.15);
  return Math.round(tdeeValue);
}

/**
 * Macro split by goal. Protein is set per kg of bodyweight (the number that
 * actually matters for satiety and lean mass), fat as a share of calories,
 * and carbs take the remainder.
 */
export function macroTargets(kcal: number, weightKg: number, goal: Goal): Nutrients {
  const proteinPerKg = goal === 'lose' ? 1.8 : goal === 'gain' ? 1.6 : 1.4;
  const protein = Math.round(weightKg * proteinPerKg);
  const fat = Math.round((kcal * (goal === 'lose' ? 0.28 : 0.3)) / 9);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  // 14 g fibre per 1000 kcal is the standard dietary reference.
  const fibre = Math.round((kcal / 1000) * 14);
  return { kcal, protein, fat, carbs, fibre };
}

export function computeTargets(p: {
  sex: Sex;
  birthYear: number;
  heightCm: number;
  weightKg: number;
  goal: Goal;
  activity: ActivityLevel;
}): Nutrients {
  const age = Math.max(13, new Date().getFullYear() - p.birthYear);
  const kcal = calorieTarget(tdee(bmr(p.sex, p.weightKg, p.heightCm, age), p.activity), p.goal, p.sex);
  return macroTargets(kcal, p.weightKg, p.goal);
}

export function slotTarget(profile: Profile | undefined, slot: MealSlot): number {
  if (!profile) return 0;
  return Math.round(profile.targets.kcal * MEAL_SLOT_SHARE[slot]);
}

/**
 * Fraction of the day a period is allotted. The profile's own split wins when
 * it is set; a share that is missing or not a usable number falls back to the
 * default rather than silently zeroing the period's targets.
 */
export function periodShare(profile: Profile | undefined, period: DayPeriod): number {
  const override = profile?.periodShares?.[period];
  return typeof override === 'number' && Number.isFinite(override) && override >= 0
    ? override
    : DAY_PERIOD_SHARE[period];
}

/** The day's macro targets scaled down to one period. */
export function periodTargets(profile: Profile | undefined, period: DayPeriod): Nutrients {
  if (!profile) return ZERO_NUTRIENTS;
  return roundNutrients(scaleNutrients(profile.targets, periodShare(profile, period)));
}

/** What has actually been eaten in a period, across all of its slots. */
export function periodNutrients(meals: Meal[], period: DayPeriod): Nutrients {
  const slots = DAY_PERIOD_SLOTS[period];
  const inPeriod = meals.filter((m) => slots.includes(m.slot));
  return inPeriod.length ? totalNutrients(inPeriod) : ZERO_NUTRIENTS;
}

/* --------------------------------- maths -------------------------------- */

export function addNutrients(a: Nutrients, b: Nutrients): Nutrients {
  return {
    kcal: a.kcal + b.kcal,
    protein: a.protein + b.protein,
    fat: a.fat + b.fat,
    carbs: a.carbs + b.carbs,
    fibre: a.fibre + b.fibre,
  };
}

export function scaleNutrients(n: Nutrients, factor: number): Nutrients {
  return {
    kcal: n.kcal * factor,
    protein: n.protein * factor,
    fat: n.fat * factor,
    carbs: n.carbs * factor,
    fibre: n.fibre * factor,
  };
}

export function roundNutrients(n: Nutrients): Nutrients {
  return {
    kcal: Math.round(n.kcal),
    protein: Math.round(n.protein * 10) / 10,
    fat: Math.round(n.fat * 10) / 10,
    carbs: Math.round(n.carbs * 10) / 10,
    fibre: Math.round(n.fibre * 10) / 10,
  };
}

export function sumNutrients(list: Nutrients[]): Nutrients {
  return list.reduce(addNutrients, ZERO_NUTRIENTS);
}

export function mealNutrients(meal: Meal): Nutrients {
  return sumNutrients(meal.items.map((i) => i.nutrients));
}

export function totalNutrients(meals: Meal[]): Nutrients {
  return roundNutrients(sumNutrients(meals.map(mealNutrients)));
}

/** Build a meal item from a food and a chosen serving + quantity. */
export function buildMealItem(food: Food, servingLabel: string, qty: number): MealItem {
  const serving =
    food.servings.find((s) => s.label === servingLabel) ??
    food.servings[0] ?? { label: '100 g', grams: 100 };
  const grams = serving.grams * qty;
  return {
    foodId: food.id,
    name: food.name,
    qty,
    servingLabel: serving.label,
    grams,
    nutrients: roundNutrients(scaleNutrients(food.per100g, grams / 100)),
  };
}

/* ------------------------------- workouts -------------------------------- */

/**
 * MET values for the workout types we offer. Calories are estimated as
 * MET × 3.5 × kg / 200 per minute, the standard ACSM formula.
 */
export const WORKOUT_METS: Record<string, number> = {
  Walking: 3.5,
  Running: 9.8,
  Cycling: 7.5,
  Swimming: 8.0,
  Yoga: 3.0,
  'Strength training': 5.0,
  HIIT: 8.5,
  Dancing: 5.5,
  Cricket: 5.0,
  Football: 7.0,
  Badminton: 5.5,
  'Elliptical / Cardio': 6.5,
  Other: 4.5,
};

const INTENSITY_FACTOR: Record<WorkoutIntensity, number> = {
  light: 0.8,
  moderate: 1,
  vigorous: 1.25,
};

export function estimateWorkoutKcal(
  type: string,
  minutes: number,
  weightKg: number,
  intensity: WorkoutIntensity,
): number {
  const met = (WORKOUT_METS[type] ?? WORKOUT_METS.Other) * INTENSITY_FACTOR[intensity];
  return Math.round(((met * 3.5 * weightKg) / 200) * minutes);
}

/** The ACSM formula with a MET supplied directly, for catalog exercises. */
export function kcalFromMet(
  met: number,
  minutes: number,
  weightKg: number,
  intensity: WorkoutIntensity,
): number {
  return Math.round(((met * INTENSITY_FACTOR[intensity] * 3.5 * weightKg) / 200) * minutes);
}

/* --------------------------------- steps ---------------------------------- */

/**
 * Steps per minute that counts as moderate walking. The usual cadence
 * threshold, and what turns a bare step count into the minutes the ACSM
 * formula needs.
 */
const WALKING_CADENCE = 100;

/** MET for walking at that cadence, matching `WORKOUT_METS.Walking`. */
const WALKING_MET = 3.5;

/**
 * Calories burned walking, from a step count.
 *
 * Returns **net** energy — the cost above simply existing — which is why the
 * MET has 1 subtracted from it. That correction is the whole reason this is
 * safe to subtract from the day. A calorie target here is already built on
 * BMR × an activity factor of 1.2 to 1.9, and that factor is precisely an
 * allowance for everyday moving about. Counting the gross figure would charge
 * the day twice for the same walking and quietly hand back a few hundred
 * calories that were never earned.
 *
 * Still an estimate: cadence and stride vary, and a phone in a bag misses
 * steps a wrist catches. Treat it as the right order of magnitude, not a
 * measurement — which is what the UI says where it shows up.
 */
export function stepKcal(steps: number, weightKg: number): number {
  if (steps <= 0 || weightKg <= 0) return 0;
  const minutes = steps / WALKING_CADENCE;
  return Math.round((((WALKING_MET - 1) * 3.5 * weightKg) / 200) * minutes);
}

/** Seconds per rep — one concentric plus one eccentric at a standard tempo. */
const SECONDS_PER_REP = 3;
/** Default rest between sets, in seconds. */
export const DEFAULT_REST_SEC = 60;

/**
 * Sets and reps carry no duration, but the ACSM formula needs minutes. This
 * derives them from time-under-tension plus rest.
 *
 * Treat the result as an estimate and say so in the UI: resistance-training
 * expenditure varies far more between people than steady-state cardio, and no
 * formula built on sets and reps alone can close that gap.
 */
export function strengthDurationMin(
  sets: { reps: number }[],
  restSec = DEFAULT_REST_SEC,
  secondsPerRep = SECONDS_PER_REP,
): number {
  if (!sets.length) return 0;
  const work = sets.reduce((total, s) => total + Math.max(0, s.reps) * secondsPerRep, 0);
  // Rest happens between sets, not after the last one.
  const rest = Math.max(0, sets.length - 1) * restSec;
  return (work + rest) / 60;
}

/** Total load moved — the honest strength signal, unlike the calorie estimate. */
export function setVolumeKg(sets: { reps: number; weightKg?: number }[]): number {
  return sets.reduce((total, s) => total + s.reps * (s.weightKg ?? 0), 0);
}

/** Epley one-rep-max estimate. Meaningless above ~12 reps, so it's capped. */
export function estimate1RM(weightKg: number, reps: number): number {
  if (weightKg <= 0 || reps <= 0) return 0;
  if (reps === 1) return weightKg;
  if (reps > 12) return 0;
  return Math.round(weightKg * (1 + reps / 30) * 10) / 10;
}

/* ------------------------------- formatting ------------------------------ */

export const KG_PER_LB = 0.45359237;
export const CM_PER_IN = 2.54;

export function kgToDisplay(kg: number, units: 'metric' | 'imperial'): number {
  return units === 'imperial' ? kg / KG_PER_LB : kg;
}
export function displayToKg(value: number, units: 'metric' | 'imperial'): number {
  return units === 'imperial' ? value * KG_PER_LB : value;
}
export const weightUnit = (units: 'metric' | 'imperial') => (units === 'imperial' ? 'lb' : 'kg');

export function formatKcal(n: number): string {
  return Math.round(n).toLocaleString();
}

/**
 * Renders a portion for display.
 *
 * Serving labels already carry their own count ("1 roti", "2 roti/chapati",
 * "100 g"), so naively printing `qty` in front of the label produces
 * "1 1 roti". This folds the quantity into the label's own number instead, so
 * 2 × "1 roti" reads "2 roti" and 2 × "100 g" reads "200 g".
 */
export function formatPortion(qty: number, servingLabel: string): string {
  const match = servingLabel.match(/^\s*([\d.]+)\s*(.*)$/);
  if (match) {
    const total = Number(match[1]) * qty;
    if (Number.isFinite(total)) {
      // Trim a trailing ".0" so "2.0 roti" reads "2 roti".
      const shown = Math.round(total * 100) / 100;
      const rest = match[2].trim();
      return rest ? `${shown} ${rest}` : String(shown);
    }
  }
  // Label has no leading count (rare) — fall back to an explicit multiplier.
  return qty === 1 ? servingLabel : `${qty} × ${servingLabel}`;
}

export function formatGrams(n: number): string {
  return n >= 10 ? String(Math.round(n)) : String(Math.round(n * 10) / 10);
}

/** Percentage of a target, clamped so a wild over-log doesn't break layout. */
export function pctOf(value: number, target: number): number {
  if (!target) return 0;
  return Math.max(0, Math.min(999, Math.round((value / target) * 100)));
}

/* ---------------------------- editing logged items ------------------------ */

/**
 * Recovers a per-100g basis from an already-logged item.
 *
 * Needed when the source food row is gone — deleted, or it never existed
 * because the item came from a photo analysis or voice parse. Without this the
 * edit sheet would have no basis to preview against.
 */
export function per100gFromItem(item: MealItem): Nutrients {
  const factor = 100 / (item.grams || 100);
  return {
    kcal: item.nutrients.kcal * factor,
    protein: item.nutrients.protein * factor,
    fat: item.nutrients.fat * factor,
    carbs: item.nutrients.carbs * factor,
    fibre: item.nutrients.fibre * factor,
  };
}

/**
 * Rescales a logged item to a new quantity when there is no food row to
 * rebuild from. Scales on grams so switching serving keeps the numbers honest.
 */
export function rescaleMealItem(item: MealItem, qty: number, servingLabel: string): MealItem {
  const perServing = item.grams / (item.qty || 1);
  const grams = perServing * qty;
  const factor = item.grams ? grams / item.grams : qty / (item.qty || 1);
  return {
    ...item,
    qty,
    servingLabel,
    grams,
    nutrients: roundNutrients(scaleNutrients(item.nutrients, factor)),
  };
}

/**
 * Builds a logged item from an exact weight rather than a serving multiple.
 *
 * Stored as qty 1 with the weight in the serving label ("170 g") so that
 * `formatPortion` renders it correctly and a later edit can recover the
 * grams — a label of "g" with qty 170 would read as "170 × g".
 */
export function buildMealItemFromGrams(food: Food, grams: number): MealItem {
  const safe = Math.max(0, grams);
  return {
    foodId: food.id,
    name: food.name,
    qty: 1,
    servingLabel: `${Math.round(safe * 10) / 10} g`,
    grams: safe,
    nutrients: roundNutrients(scaleNutrients(food.per100g, safe / 100)),
  };
}
