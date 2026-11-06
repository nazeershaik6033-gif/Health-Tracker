import type { Nutrients, Profile } from '@/types';

/**
 * A 0–100 read on one day, built from the five things the app tracks. Each
 * pillar scores 0–1 on its own terms, then they're weighted — food twice as
 * heavily as the rest, because it's what the app is mostly about and the
 * pillar people can move most within a day.
 *
 * Pillars with nothing logged score zero rather than being dropped: the score
 * is meant to nudge toward logging, and a day with only a glass of water
 * logged shouldn't read as "perfect hydration day, 100".
 */

export interface DayInputs {
  totals: Nutrients;
  targets: Nutrients;
  glasses: number;
  waterGoal: number;
  sleepMin?: number;
  sleepGoalMin: number;
  steps: number;
  stepGoal: number;
  workoutKcal: number;
  workoutGoal: number;
}

export interface Pillar {
  key: 'nutrition' | 'protein' | 'hydration' | 'sleep' | 'movement';
  label: string;
  /** 0–1 */
  score: number;
  weight: number;
  detail: string;
  color: string;
}

export interface DayScore {
  score: number;
  band: 'Excellent' | 'Good' | 'Fair' | 'Building';
  pillars: Pillar[];
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

/**
 * Calories score full marks within ±10% of target and fall off linearly to
 * zero at ±50%. Going over costs a little more than under, which matches how
 * most goals (and most regret) work.
 */
export function calorieAdherence(eaten: number, target: number): number {
  if (target <= 0 || eaten <= 0) return 0;
  const ratio = eaten / target;
  const dev = ratio - 1;
  const tol = 0.1;
  if (Math.abs(dev) <= tol) return 1;
  const span = dev > 0 ? 0.35 : 0.4;
  return clamp01(1 - (Math.abs(dev) - tol) / span);
}

export function scoreDay(d: DayInputs): DayScore {
  const nutrition = calorieAdherence(d.totals.kcal, d.targets.kcal);
  const protein = d.targets.protein > 0 ? clamp01(d.totals.protein / d.targets.protein) : 0;
  const hydration = d.waterGoal > 0 ? clamp01(d.glasses / d.waterGoal) : 0;
  // Sleep: full marks from the goal up to +90 min, then a gentle penalty for
  // oversleeping, which correlates with poor recovery as much as short sleep.
  const sleepRatio = d.sleepMin && d.sleepGoalMin > 0 ? d.sleepMin / d.sleepGoalMin : 0;
  const sleep =
    !d.sleepMin
      ? 0
      : sleepRatio <= 1
        ? clamp01(sleepRatio)
        : clamp01(1 - Math.max(0, d.sleepMin - d.sleepGoalMin - 90) / 240);
  const movement = Math.max(
    d.stepGoal > 0 ? clamp01(d.steps / d.stepGoal) : 0,
    d.workoutGoal > 0 ? clamp01(d.workoutKcal / d.workoutGoal) : 0,
  );

  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const pillars: Pillar[] = [
    {
      key: 'nutrition',
      label: 'Calories',
      score: nutrition,
      weight: 2,
      detail:
        d.totals.kcal <= 0
          ? 'Nothing logged'
          : `${Math.round(d.totals.kcal).toLocaleString()} of ${d.targets.kcal.toLocaleString()} kcal`,
      color: 'var(--color-ring-calorie)',
    },
    {
      key: 'protein',
      label: 'Protein',
      score: protein,
      weight: 1,
      detail: `${Math.round(d.totals.protein)} of ${d.targets.protein} g`,
      color: 'var(--color-macro-protein)',
    },
    {
      key: 'hydration',
      label: 'Hydration',
      score: hydration,
      weight: 1,
      detail: `${d.glasses} of ${d.waterGoal} glasses`,
      color: 'var(--color-ring-water)',
    },
    {
      key: 'sleep',
      label: 'Sleep',
      score: sleep,
      weight: 1,
      detail: d.sleepMin ? `${pct(sleepRatio)} of goal` : 'Not logged',
      color: 'var(--color-ring-sleep)',
    },
    {
      key: 'movement',
      label: 'Movement',
      score: movement,
      weight: 1,
      detail:
        d.workoutKcal > 0
          ? `${d.steps.toLocaleString()} steps · ${d.workoutKcal} kcal`
          : `${d.steps.toLocaleString()} steps`,
      color: 'var(--color-ring-walk)',
    },
  ];

  const totalWeight = pillars.reduce((s, p) => s + p.weight, 0);
  const score = Math.round((pillars.reduce((s, p) => s + p.score * p.weight, 0) / totalWeight) * 100);
  const band = score >= 85 ? 'Excellent' : score >= 70 ? 'Good' : score >= 45 ? 'Fair' : 'Building';
  return { score, band, pillars };
}

/* ------------------------------------------------------------------ body */

export function age(profile: Profile): number {
  return Math.max(13, new Date().getFullYear() - profile.birthYear);
}

export function bmi(weightKg: number, heightCm: number): number {
  const m = heightCm / 100;
  return m > 0 ? weightKg / (m * m) : 0;
}

/** WHO adult bands. */
export function bmiBand(value: number): { label: string; color: string } {
  if (value <= 0) return { label: '—', color: 'var(--text-muted)' };
  if (value < 18.5) return { label: 'Underweight', color: '#3b82f6' };
  if (value < 25) return { label: 'Healthy', color: '#10b981' };
  if (value < 30) return { label: 'Overweight', color: '#f5a524' };
  return { label: 'Obese', color: '#ef4444' };
}

/** Position of a BMI value on a 15–35 scale, as 0–1, for the marker on the gauge. */
export function bmiGaugePosition(value: number): number {
  return clamp01((value - 15) / 20);
}

/**
 * Least-squares slope of weight over time, in kg per week. Needs at least
 * two weigh-ins at least three days apart to say anything; returns undefined
 * otherwise so the UI shows nothing rather than a confident nonsense trend.
 */
export function weeklyWeightTrend(points: { date: string; kg: number }[]): number | undefined {
  if (points.length < 2) return undefined;
  const t0 = new Date(points[0].date).getTime();
  const xs = points.map((p) => (new Date(p.date).getTime() - t0) / 86_400_000);
  if (xs[xs.length - 1] - xs[0] < 3) return undefined;
  const ys = points.map((p) => p.kg);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den ? (num / den) * 7 : undefined;
}

/**
 * Weeks until target at the current trend, or undefined when the trend is
 * flat or heading the wrong way — no "goal in 4,000 weeks" readouts.
 */
export function weeksToGoal(currentKg: number, targetKg: number, kgPerWeek: number | undefined) {
  if (kgPerWeek === undefined || Math.abs(kgPerWeek) < 0.05) return undefined;
  const remaining = targetKg - currentKg;
  if (Math.sign(remaining) !== Math.sign(kgPerWeek)) return undefined;
  const weeks = remaining / kgPerWeek;
  return weeks > 0 && weeks < 260 ? weeks : undefined;
}
