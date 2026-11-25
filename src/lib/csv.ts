import { db } from '@/db/schema';
import { MICROS } from './micros';
import { formatPortion } from './nutrition';
import { toISODate } from './date';
import { MEAL_SLOTS, MEAL_SLOT_LABEL } from '@/types';

/**
 * CSV export, for spreadsheets.
 *
 * The JSON backup is for restoring the app; this is for looking at the data
 * somewhere else — a pivot table, a chart for a dietitian. Two files:
 *
 * - `food-log`: one row per logged item, with macros and every micronutrient
 *   column. A blank micronutrient cell means "not known", never zero, the same
 *   distinction the app keeps everywhere.
 * - `daily`: one row per day with anything recorded — intake, burn, water,
 *   sleep, steps, weight.
 *
 * Energy is always in kcal here regardless of the display unit, and says so in
 * the header, so a file is never ambiguous about what its numbers mean.
 * Read-only: there is no CSV import; restoring uses the JSON backup.
 */

/** RFC 4180 quoting, plus a guard against spreadsheet formula injection. */
function cell(value: unknown): string {
  if (value === undefined || value === null) return '';
  let s = typeof value === 'number' ? String(Math.round(value * 100) / 100) : String(value);
  // A food named "=HYPERLINK(...)" must stay text when the file is opened.
  if (/^[=+\-@\t\r]/.test(s) && typeof value !== 'number') s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(header: string[], rows: unknown[][]): string {
  // The BOM makes Excel read the file as UTF-8 — "Ragi dosa · 2 katori" and
  // every non-ASCII food name survive the round trip.
  return '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

export async function buildFoodLogCsv(): Promise<string> {
  const meals = await db.meals.orderBy('date').toArray();
  const slotOrder = new Map(MEAL_SLOTS.map((s, i) => [s, i]));
  meals.sort((a, b) =>
    a.date === b.date ? (slotOrder.get(a.slot) ?? 0) - (slotOrder.get(b.slot) ?? 0) : a.date < b.date ? -1 : 1,
  );

  const header = [
    'date',
    'meal',
    'food',
    'portion',
    'grams',
    'energy_kcal',
    'protein_g',
    'carbs_g',
    'fat_g',
    'fibre_g',
    ...MICROS.map((m) => `${m.id}_${m.unit.replace('µ', 'u')}`),
  ];
  const rows: unknown[][] = [];
  for (const meal of meals) {
    for (const item of meal.items) {
      rows.push([
        meal.date,
        MEAL_SLOT_LABEL[meal.slot],
        item.name,
        formatPortion(item.qty, item.servingLabel),
        item.grams,
        item.nutrients.kcal,
        item.nutrients.protein,
        item.nutrients.carbs,
        item.nutrients.fat,
        item.nutrients.fibre,
        ...MICROS.map((m) => item.micros?.[m.id]),
      ]);
    }
  }
  return toCsv(header, rows);
}

export async function buildDailyCsv(): Promise<string> {
  const [meals, workouts, water, sleep, steps, weight] = await Promise.all([
    db.meals.toArray(),
    db.workouts.toArray(),
    db.water.toArray(),
    db.sleep.toArray(),
    db.steps.toArray(),
    db.weight.toArray(),
  ]);

  interface Day {
    kcal: number;
    protein: number;
    carbs: number;
    fat: number;
    fibre: number;
    items: number;
    burned: number;
    workoutMin: number;
    steps?: number;
    glasses?: number;
    waterMl?: number;
    sleepMin?: number;
    weightKg?: number;
  }
  const days = new Map<string, Day>();
  const at = (date: string) => {
    let d = days.get(date);
    if (!d) {
      d = { kcal: 0, protein: 0, carbs: 0, fat: 0, fibre: 0, items: 0, burned: 0, workoutMin: 0 };
      days.set(date, d);
    }
    return d;
  };

  for (const m of meals) {
    const d = at(m.date);
    for (const i of m.items) {
      d.kcal += i.nutrients.kcal;
      d.protein += i.nutrients.protein;
      d.carbs += i.nutrients.carbs;
      d.fat += i.nutrients.fat;
      d.fibre += i.nutrients.fibre;
      d.items += 1;
    }
  }
  for (const w of workouts) {
    const d = at(w.date);
    d.burned += w.kcal;
    d.workoutMin += w.durationMin;
  }
  for (const w of water) {
    if (w.glasses <= 0) continue;
    const d = at(w.date);
    d.glasses = w.glasses;
    d.waterMl = w.glasses * w.glassMl;
  }
  for (const s of sleep) if (s.durationMin > 0) at(s.date).sleepMin = s.durationMin;
  for (const s of steps) if (s.count > 0) at(s.date).steps = s.count;
  for (const w of weight) at(w.date).weightKg = w.kg;

  const header = [
    'date',
    'energy_kcal',
    'protein_g',
    'carbs_g',
    'fat_g',
    'fibre_g',
    'items_logged',
    'workout_kcal',
    'workout_min',
    'steps',
    'water_glasses',
    'water_ml',
    'sleep_min',
    'weight_kg',
  ];
  const rows = [...days.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, d]) => [
      date,
      d.items ? d.kcal : undefined,
      d.items ? d.protein : undefined,
      d.items ? d.carbs : undefined,
      d.items ? d.fat : undefined,
      d.items ? d.fibre : undefined,
      d.items,
      d.burned || undefined,
      d.workoutMin || undefined,
      d.steps,
      d.glasses,
      d.waterMl,
      d.sleepMin,
      d.weightKg,
    ]);
  return toCsv(header, rows);
}

function download(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Builds both files and hands them to the share sheet together, or downloads
 * them one after the other where there is no share sheet.
 */
export async function exportCsv(): Promise<{ rows: number; shared: boolean }> {
  const [food, daily] = await Promise.all([buildFoodLogCsv(), buildDailyCsv()]);
  const stamp = toISODate();
  const files = [
    new File([food], `healthify-food-log-${stamp}.csv`, { type: 'text/csv' }),
    new File([daily], `healthify-daily-${stamp}.csv`, { type: 'text/csv' }),
  ];
  const rows = food.split('\r\n').length - 2;

  if (navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files, title: 'Healthify data (CSV)' });
      return { rows, shared: true };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return { rows, shared: false };
    }
  }
  download(files[0]);
  // Browsers drop a second download fired in the same tick.
  setTimeout(() => download(files[1]), 400);
  return { rows, shared: false };
}
