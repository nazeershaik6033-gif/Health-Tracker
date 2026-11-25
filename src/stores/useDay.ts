import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/schema';
import { useApp } from './useApp';
import { addDays, rangeDays, today } from '@/lib/date';
import { estimateWorkoutKcal, stepKcal, totalNutrients } from '@/lib/nutrition';
import { MICRO_IDS, dayMicros, targetsForProfile } from '@/lib/micros';
import {
  MEAL_SLOTS,
  ZERO_NUTRIENTS,
  type Meal,
  type MealSlot,
  type MicroId,
  type WorkoutEntry,
} from '@/types';

// Stable identities for the empty case, so the memos below don't invalidate on
// every render while the day's query is still in flight.
const EMPTY_MEALS: Meal[] = [];
const EMPTY_WORKOUTS: WorkoutEntry[] = [];
const NO_HIDDEN: MicroId[] = [];

/**
 * Live view of one day. Everything that renders the day's numbers reads this,
 * so a log from any screen updates the whole app without manual invalidation.
 */
export function useDay(dateOverride?: string) {
  const selectedDate = useApp((s) => s.selectedDate);
  const profile = useApp((s) => s.profile);
  const countStepKcal = useApp((s) => s.settings.countStepKcal !== false);
  const eatBack = useApp((s) => eatBackFraction(s.settings.eatBackPct));
  const hiddenMicros = useApp((s) => s.settings.hiddenMicros ?? NO_HIDDEN);
  const date = dateOverride ?? selectedDate;

  const data = useLiveQuery(async () => {
    const [meals, water, sleep, weight, steps, workouts, lastWeight] = await Promise.all([
      db.meals.where('date').equals(date).toArray(),
      db.water.get(date),
      db.sleep.get(date),
      db.weight.get(date),
      db.steps.get(date),
      db.workouts.where('date').equals(date).toArray(),
      // The most recent weigh-in on or before this day — what the step and
      // workout burn estimates are scaled by. A day with no weigh-in of its own
      // should still use a real figure rather than the starting weight.
      db.weight.where('date').belowOrEqual(date).last(),
    ]);
    return { meals, water, sleep, weight, steps, workouts, lastWeight };
  }, [date]);

  const meals = data?.meals ?? EMPTY_MEALS;
  const workouts = data?.workouts ?? EMPTY_WORKOUTS;

  // Derived from the query result, not from render: ten components call this
  // hook, and several of them re-render on unrelated state (sheets opening,
  // inputs typing). Recomputing a day's totals on each of those was pure waste.
  const { totals, bySlot } = useMemo(() => {
    const byslot = MEAL_SLOTS.reduce<Record<MealSlot, Meal | undefined>>(
      (acc, slot) => {
        acc[slot] = meals.find((m) => m.slot === slot);
        return acc;
      },
      {} as Record<MealSlot, Meal | undefined>,
    );
    return {
      totals: meals.length ? totalNutrients(meals) : ZERO_NUTRIENTS,
      bySlot: byslot,
    };
  }, [meals]);

  const workoutKcal = useMemo(
    () => workouts.reduce((sum, w) => sum + w.kcal, 0),
    [workouts],
  );

  // Same reasoning as `totals`: this walks every item in the day, and the
  // Home and Diet cards both read it on renders that have nothing to do with
  // food. `targetsForProfile` reads the clock, so it is memoised too rather
  // than handing every consumer a fresh object identity on each render.
  const micros = useMemo(() => dayMicros(meals), [meals]);
  const microTargets = useMemo(
    () => targetsForProfile(profile),
    [profile],
  );

  const bodyWeightKg =
    data?.lastWeight?.kg ?? profile?.startWeightKg ?? 70;
  const stepCount = data?.steps?.count ?? 0;
  // Walking was tracked but never counted: only workouts reached the day's
  // burn, so ten thousand steps moved the ring by nothing at all. Switchable,
  // because a logged walking workout and the steps it produced are the same
  // walk and the app has no way to tell.
  const stepsKcal = countStepKcal ? stepKcal(stepCount, bodyWeightKg) : 0;

  return {
    date,
    loading: data === undefined,
    meals,
    bySlot,
    totals,
    workouts,
    workoutKcal,
    stepsKcal,
    /** Everything burned today: deliberate exercise plus walking. */
    burnedKcal: workoutKcal + stepsKcal,
    /**
     * The part of `burnedKcal` added back to the day's budget — all of it by
     * default, less when Settings → Eat back exercise calories says so.
     */
    creditedKcal: Math.round((workoutKcal + stepsKcal) * eatBack),
    bodyWeightKg,
    water: data?.water,
    sleep: data?.sleep,
    weight: data?.weight,
    steps: data?.steps,
    targets: profile?.targets ?? ZERO_NUTRIENTS,
    /** Day totals, plus how much of the day those totals actually saw. */
    micros: micros.totals,
    microCoverage: micros.coverage,
    microUnknown: micros.unknown,
    microTargets,
    /** Nutrients the user switched off; pass to `microRows`. */
    hiddenMicros,
    /** How many nutrients are being tracked, after hiding. */
    microCount: MICRO_IDS.length - hiddenMicros.filter((id) => MICRO_IDS.includes(id)).length,
    waterGoal: data?.water?.goalGlasses ?? profile?.waterGoalGlasses ?? 9,
    glasses: data?.water?.glasses ?? 0,
    stepGoal: data?.steps?.goal ?? profile?.stepGoal ?? 8000,
    stepCount,
  };
}

/** Settings' eat-back percentage as a 0–1 fraction. Absent means all of it. */
export function eatBackFraction(pct: number | undefined): number {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return 1;
  return Math.min(100, Math.max(0, pct)) / 100;
}

/** Live weight history for the trend chart and the "kg lost" readout. */
export function useWeightHistory(days = 90) {
  const from = addDays(today(), -days);
  return useLiveQuery(
    async () => db.weight.where('date').between(from, today(), true, true).sortBy('date'),
    [from],
  );
}

/**
 * Consecutive days ending today on which the user logged anything at all.
 * A day counts if it has a meal, a workout, water, sleep or a weigh-in —
 * tracking any dimension keeps the streak alive.
 *
 * Every query here is bounded to the streak window by its `date` index. It used
 * to read all five tables in full, on the Home screen, re-running on any write
 * to any of them: adding a single glass of water scanned every meal ever
 * logged, and the cost grew for the life of the install. A streak longer than
 * the window is not worth a full-table scan to discover.
 */
const STREAK_WINDOW_DAYS = 400;

export function useStreak() {
  const from = addDays(today(), -(STREAK_WINDOW_DAYS - 1));

  return useLiveQuery(async () => {
    const window = rangeDays(today(), STREAK_WINDOW_DAYS).reverse(); // newest first
    const to = today();
    // Only *which days* have a row matters here, so the meal, workout, sleep
    // and weight tables are read as distinct index keys — no record is ever
    // deserialised. Reading full rows meant materialising a year of meals and
    // every item in them on each Home render and after every write, which was
    // most of what a tab switch to Streaks cost. An emptied meal is deleted
    // (see `updateMeal`), so a meal row on a day is itself the signal.
    // Water is the exception: its row exists from the first visit to the
    // tracker, at zero glasses, so it is read in full — it is tiny.
    const [mealDays, workoutDays, water, sleepDays, weightDays] = await Promise.all([
      db.meals.where('date').between(from, to, true, true).uniqueKeys(),
      db.workouts.where('date').between(from, to, true, true).uniqueKeys(),
      db.water.where('date').between(from, to, true, true).toArray(),
      db.sleep.where('date').between(from, to, true, true).primaryKeys(),
      db.weight.where('date').between(from, to, true, true).primaryKeys(),
    ]);

    const active = new Set<string>();
    for (const d of [...mealDays, ...workoutDays, ...sleepDays, ...weightDays]) active.add(String(d));
    for (const w of water) if (w.glasses > 0) active.add(w.date);

    let streak = 0;
    for (const day of window) {
      if (active.has(day)) streak++;
      // Today not yet logged shouldn't break a streak that's still alive —
      // only a missed *past* day ends it.
      else if (day === today()) continue;
      else break;
    }
    return { streak, activeDays: active };
  }, [from]);
}

/**
 * Rolling per-day history for charts and AI context, ending on `end`
 * (today by default) so a past day on Home shows the week leading up to it.
 */
export function useHistory(days = 14, end?: string) {
  const to = end ?? today();
  const from = addDays(to, -(days - 1));
  return useLiveQuery(async () => {
    const [meals, workouts, water, steps, sleep] = await Promise.all([
      db.meals.where('date').between(from, to, true, true).toArray(),
      db.workouts.where('date').between(from, to, true, true).toArray(),
      db.water.where('date').between(from, to, true, true).toArray(),
      db.steps.where('date').between(from, to, true, true).toArray(),
      db.sleep.where('date').between(from, to, true, true).toArray(),
    ]);

    return rangeDays(to, days).map((date) => {
      const dayMeals = meals.filter((m) => m.date === date);
      const totals = dayMeals.length ? totalNutrients(dayMeals) : undefined;
      return {
        date,
        kcal: totals?.kcal ?? 0,
        protein: totals?.protein ?? 0,
        logged: dayMeals.some((m) => m.items.length > 0),
        burned: workouts.filter((w) => w.date === date).reduce((s, w) => s + w.kcal, 0),
        glasses: water.find((w) => w.date === date)?.glasses ?? 0,
        steps: steps.find((s) => s.date === date)?.count ?? 0,
        sleepMin: sleep.find((s) => s.date === date)?.durationMin ?? 0,
      };
    });
  }, [from, to, days]);
}

export { estimateWorkoutKcal };
