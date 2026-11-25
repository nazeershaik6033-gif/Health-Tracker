import { db } from '@/db/schema';
import { addDays, daysBetween, today } from './date';
import { bmr, stepKcal, tdee } from './nutrition';
import { weightTrend } from './weightTrend';
import type { Profile, Settings } from '@/types';

/**
 * Adaptive maintenance calories: what this person's body actually burns,
 * measured from their own log instead of predicted from a formula.
 *
 * Energy balance over a stretch of weeks: average net intake, corrected by the
 * energy the weight trend says was stored or drawn down.
 *
 *     maintenance = average net intake − (Δ trend kg × 7,700 kcal) / days
 *
 * Eat 2,000 a day for four weeks while the trend falls 1 kg and maintenance is
 * about 2,000 + 7,700 / 28 ≈ 2,275. 7,700 kcal per kg is the classic figure for
 * adipose tissue (Wishnofsky, 1958). Real tissue change is a mix of fat, lean
 * and water and the true figure varies (Hall, 2008), which is one reason the
 * result is shown as a measurement to accept or not, never applied silently on
 * thin data.
 *
 * "Net" intake subtracts the exercise calories the app credits back to the
 * budget (Settings → eat back). Measuring on net keeps the two consistent: the
 * credit is added on top of the measured maintenance, so measuring on gross
 * intake would count every logged workout twice.
 */

/** kcal per kg of body-weight change. */
export const KCAL_PER_KG = 7700;
/** The measurement window, ending yesterday — today is still being logged. */
export const WINDOW_DAYS = 28;
/** Logged days needed in the window. */
export const MIN_LOGGED_DAYS = 14;
/** Weigh-ins needed in the window. */
export const MIN_WEIGH_INS = 4;
/** Days between the first and last weigh-in in the window. */
export const MIN_SPAN_DAYS = 14;
/**
 * Below this a day reads as partly logged — a forgotten dinner — and would drag
 * the average down, so it is left out rather than counted as eaten.
 */
export const MIN_DAY_KCAL = 800;

export type AdaptiveResult =
  | {
      ok: true;
      /** Measured maintenance, rounded to 10 kcal. */
      tdee: number;
      /** The formula's estimate at the current weight, for comparison. */
      formulaTdee: number;
      /** Far enough from the formula to deserve a second look before applying. */
      unusual: boolean;
      avgNetIntake: number;
      deltaKg: number;
      spanDays: number;
      loggedDays: number;
      weighIns: number;
    }
  | {
      ok: false;
      /** What is still missing, in words. */
      reason: string;
      loggedDays: number;
      weighIns: number;
      spanDays: number;
    };

export async function measureMaintenance(
  profile: Profile,
  settings: Settings,
): Promise<AdaptiveResult> {
  const to = addDays(today(), -1);
  const from = addDays(to, -(WINDOW_DAYS - 1));
  // Weights from further back seed the trend, so its first point in the window
  // is already smoothed rather than one raw reading.
  const seedFrom = addDays(from, -30);

  const [meals, workouts, steps, weights] = await Promise.all([
    db.meals.where('date').between(from, to, true, true).toArray(),
    db.workouts.where('date').between(from, to, true, true).toArray(),
    db.steps.where('date').between(from, to, true, true).toArray(),
    db.weight.where('date').between(seedFrom, to, true, true).sortBy('date'),
  ]);

  const eatBack =
    typeof settings.eatBackPct === 'number' ? Math.min(100, Math.max(0, settings.eatBackPct)) / 100 : 1;
  const countSteps = settings.countStepKcal !== false;

  const eaten = new Map<string, number>();
  for (const meal of meals) {
    eaten.set(meal.date, (eaten.get(meal.date) ?? 0) + meal.items.reduce((s, i) => s + i.nutrients.kcal, 0));
  }

  const trend = weightTrend(weights);
  const kgOn = (date: string) => {
    let kg = profile.startWeightKg;
    for (const p of trend) if (p.date <= date) kg = p.kg;
    return kg;
  };

  let netTotal = 0;
  let loggedDays = 0;
  for (const [date, kcal] of eaten) {
    if (kcal < MIN_DAY_KCAL) continue;
    const burned =
      workouts.filter((w) => w.date === date).reduce((s, w) => s + w.kcal, 0) +
      (countSteps ? stepKcal(steps.find((s) => s.date === date)?.count ?? 0, kgOn(date)) : 0);
    netTotal += kcal - burned * eatBack;
    loggedDays += 1;
  }

  const inWindow = trend.filter((p) => p.date >= from);
  const weighIns = inWindow.length;
  const spanDays = weighIns > 1 ? daysBetween(inWindow[0].date, inWindow[weighIns - 1].date) : 0;

  const missing: string[] = [];
  if (loggedDays < MIN_LOGGED_DAYS) missing.push(`${MIN_LOGGED_DAYS - loggedDays} more fully logged days`);
  if (weighIns < MIN_WEIGH_INS) missing.push(`${MIN_WEIGH_INS - weighIns} more weigh-ins`);
  else if (spanDays < MIN_SPAN_DAYS) missing.push(`weigh-ins spread over at least ${MIN_SPAN_DAYS} days`);
  if (missing.length) {
    return { ok: false, reason: `Needs ${missing.join(' and ')} in the last 4 weeks.`, loggedDays, weighIns, spanDays };
  }

  const avgNetIntake = netTotal / loggedDays;
  const deltaKg = inWindow[weighIns - 1].trend - inWindow[0].trend;
  const measured = avgNetIntake - (deltaKg * KCAL_PER_KG) / spanDays;

  const age = Math.max(13, new Date().getFullYear() - profile.birthYear);
  const currentKg = inWindow[weighIns - 1].kg;
  const formulaTdee = Math.round(tdee(bmr(profile.sex, currentKg, profile.heightCm, age), profile.activity));

  if (!(measured > 1000 && measured < 5500)) {
    return {
      ok: false,
      reason:
        'The log and the weight trend do not add up to a believable figure yet — usually days logged only in part. Keep going.',
      loggedDays,
      weighIns,
      spanDays,
    };
  }

  return {
    ok: true,
    tdee: Math.round(measured / 10) * 10,
    formulaTdee,
    unusual: Math.abs(measured - formulaTdee) > formulaTdee * 0.3,
    avgNetIntake: Math.round(avgNetIntake),
    deltaKg: Math.round(deltaKg * 100) / 100,
    spanDays,
    loggedDays,
    weighIns,
  };
}

/** True when the weekly automatic re-measure is due. */
export function adaptiveDue(profile: Profile | undefined, settings: Settings): boolean {
  if (!profile || !settings.adaptiveAuto || profile.targetsManual) return false;
  return !profile.adaptiveAt || Date.now() - profile.adaptiveAt >= 7 * 86_400_000;
}
