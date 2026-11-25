import { daysBetween } from './date';
import type { WeightEntry } from '@/types';

/**
 * Smoothed body-weight trend.
 *
 * An exponentially weighted moving average with 10% smoothing per day — John
 * Walker's "The Hacker's Diet" method. A day's scale reading moves by a kilo or
 * more with water, salt and gut contents; the trend moves by grams, so it is
 * what the target and the "kg to go" readout should follow.
 *
 * Weigh-ins are rarely daily, so the weight given to a new reading grows with
 * the gap since the last one: after `gap` days the old trend has decayed by
 * 0.9^gap, exactly as if the missing days had repeated the new value. A week
 * off the scale does not leave the trend stuck a week behind.
 */
export const TREND_SMOOTHING = 0.1;

export interface TrendPoint {
  date: string;
  kg: number;
  trend: number;
}

/** Entries must be sorted oldest first, one per date (the table's shape). */
export function weightTrend(entries: WeightEntry[]): TrendPoint[] {
  const out: TrendPoint[] = [];
  let trend: number | undefined;
  let lastDate: string | undefined;
  for (const e of entries) {
    if (!(e.kg > 0)) continue;
    if (trend === undefined || !lastDate) {
      trend = e.kg;
    } else {
      const gap = Math.max(1, daysBetween(lastDate, e.date));
      const keep = (1 - TREND_SMOOTHING) ** gap;
      trend = trend * keep + e.kg * (1 - keep);
    }
    lastDate = e.date;
    out.push({ date: e.date, kg: e.kg, trend });
  }
  return out;
}

/**
 * Rate of change of the trend in kg per week, from a least-squares fit over
 * the trend points in the last `days` days. Undefined with fewer than three
 * points or under a week of span — too little to call a rate.
 */
export function trendRatePerWeek(points: TrendPoint[], days = 28): number | undefined {
  if (points.length < 3) return undefined;
  const end = points[points.length - 1].date;
  const recent = points.filter((p) => daysBetween(p.date, end) <= days);
  if (recent.length < 3) return undefined;
  const xs = recent.map((p) => daysBetween(recent[0].date, p.date));
  if (xs[xs.length - 1] < 7) return undefined;
  const ys = recent.map((p) => p.trend);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den > 0 ? (num / den) * 7 : undefined;
}
