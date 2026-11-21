import type { GlucoseContext, GlucoseEntry } from '@/types';

/** mg/dL per mmol/L for glucose (molar mass 180.16 g/mol). */
export const MGDL_PER_MMOL = 18.016;

export type GlucoseUnit = 'mgdl' | 'mmol';

export function toDisplay(mgdl: number, unit: GlucoseUnit): number {
  return unit === 'mmol' ? Math.round((mgdl / MGDL_PER_MMOL) * 10) / 10 : Math.round(mgdl);
}

export function fromDisplay(value: number, unit: GlucoseUnit): number {
  return unit === 'mmol' ? value * MGDL_PER_MMOL : value;
}

export const unitLabel = (unit: GlucoseUnit) => (unit === 'mmol' ? 'mmol/L' : 'mg/dL');

export function formatGlucose(mgdl: number, unit: GlucoseUnit): string {
  return unit === 'mmol' ? toDisplay(mgdl, unit).toFixed(1) : String(toDisplay(mgdl, unit));
}

export type GlucoseBand = 'low' | 'normal' | 'elevated' | 'high';

export const BAND_LABEL: Record<GlucoseBand, string> = {
  low: 'Low',
  normal: 'In range',
  elevated: 'Above typical',
  high: 'High',
};

/**
 * Reference bands for adults without diabetes (ADA / WHO): fasting under 100
 * is typical, 100–125 is the prediabetes range, 126+ the diabetes threshold;
 * two hours after a meal under 140 is typical and 200+ is high. Anything under
 * 70 is low whatever the context.
 *
 * These are reference ranges for reading a number, not a diagnosis, and
 * someone managing diabetes will have personal targets from their doctor. The
 * screen says both.
 */
export function bandFor(mgdl: number, context: GlucoseContext): GlucoseBand {
  if (mgdl < 70) return 'low';
  const fastingLike = context === 'fasting' || context === 'before_meal';
  const [elevated, high] = fastingLike ? [100, 126] : [140, 200];
  if (mgdl >= high) return 'high';
  if (mgdl >= elevated) return 'elevated';
  return 'normal';
}

export const BAND_TINT: Record<GlucoseBand, string> = {
  low: 'tint-danger',
  normal: 'tint-brand',
  elevated: 'tint-amber',
  high: 'tint-danger',
};

/** Mean reading per day for the given days, 0 where none. */
export function dailyAverage(entries: GlucoseEntry[], days: string[]): number[] {
  return days.map((d) => {
    const on = entries.filter((e) => e.date === d);
    return on.length ? Math.round(on.reduce((s, e) => s + e.mgdl, 0) / on.length) : 0;
  });
}
