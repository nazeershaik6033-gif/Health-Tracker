import type {
  ActivityLevel,
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
import { MEAL_SLOT_SHARE, ZERO_NUTRIENTS } from '@/types';

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
