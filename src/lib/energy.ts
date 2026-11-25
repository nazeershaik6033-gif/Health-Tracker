import { useApp } from '@/stores/useApp';
import type { EnergyUnit } from '@/types';

/**
 * Energy display.
 *
 * Every figure is stored in kcal — foods, meals, targets, workouts — and only
 * converted at the edge, so switching unit is a display preference that can
 * never corrupt a number. 4.184 is the thermochemical calorie, the factor food
 * labels use when they print both.
 */
export const KJ_PER_KCAL = 4.184;

export function toDisplayEnergy(kcal: number, unit: EnergyUnit): number {
  return unit === 'kj' ? kcal * KJ_PER_KCAL : kcal;
}

export function fromDisplayEnergy(value: number, unit: EnergyUnit): number {
  return unit === 'kj' ? value / KJ_PER_KCAL : value;
}

export const energyLabel = (unit: EnergyUnit) => (unit === 'kj' ? 'kJ' : 'kcal');

/** "1,840" in kcal or "7,699" in kJ — the number only, rounded. */
export function formatEnergyValue(kcal: number, unit: EnergyUnit): string {
  return Math.round(toDisplayEnergy(kcal, unit)).toLocaleString();
}

/** "1,840 kcal" / "7,699 kJ". */
export function formatEnergy(kcal: number, unit: EnergyUnit): string {
  return `${formatEnergyValue(kcal, unit)} ${energyLabel(unit)}`;
}

/** The current unit plus formatters bound to it. */
export function useEnergy() {
  const unit = useApp((s) => s.settings.energyUnit ?? 'kcal');
  return {
    unit,
    label: energyLabel(unit),
    /** Display number, unrounded — for CountUp and maths. */
    value: (kcal: number) => toDisplayEnergy(kcal, unit),
    /** Rounded number, no unit. */
    num: (kcal: number) => formatEnergyValue(kcal, unit),
    /** Rounded number with its unit. */
    fmt: (kcal: number) => formatEnergy(kcal, unit),
    toKcal: (value: number) => fromDisplayEnergy(value, unit),
  };
}
