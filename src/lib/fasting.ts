import type { FastEntry } from '@/types';
import { toISODate } from './date';

const HOUR = 3_600_000;

/** The windows people actually use, as fasting hours. Eating window = 24 − fast. */
export const FAST_PROTOCOLS: { hours: number; label: string; hint: string }[] = [
  { hours: 12, label: '12:12', hint: 'Gentle start — most of it is overnight' },
  { hours: 14, label: '14:10', hint: 'A late breakfast or an early dinner' },
  { hours: 16, label: '16:8', hint: 'The most common window' },
  { hours: 18, label: '18:6', hint: 'Two meals in a six-hour window' },
  { hours: 20, label: '20:4', hint: 'One large meal and a snack' },
];

export const DEFAULT_FAST_HOURS = 16;

/**
 * Rough stages of a fast, by elapsed hours.
 *
 * These are approximate, population-level timings and vary a lot with what
 * the last meal was and how active someone is. The copy says "around" and
 * "begins to" on purpose; the app must not suggest a precise metabolic state
 * it cannot measure.
 */
export const FAST_STAGES: { fromHours: number; title: string; body: string }[] = [
  {
    fromHours: 0,
    title: 'Digesting',
    body: 'Your last meal is still being absorbed and blood sugar is settling.',
  },
  {
    fromHours: 4,
    title: 'Blood sugar settling',
    body: 'Insulin falls back toward baseline as digestion finishes.',
  },
  {
    fromHours: 12,
    title: 'Fat burning picks up',
    body: 'With stored glycogen running lower, the body leans more on fat for fuel.',
  },
  {
    fromHours: 18,
    title: 'Ketone production rises',
    body: 'Ketone levels begin to climb for most people around here.',
  },
  {
    fromHours: 24,
    title: 'Extended fast',
    body: 'Past a day without food. Stay hydrated and break it gently.',
  },
];

export function stageFor(hours: number) {
  let stage = FAST_STAGES[0];
  for (const s of FAST_STAGES) if (hours >= s.fromHours) stage = s;
  return stage;
}

export function elapsedHours(fast: FastEntry, now = Date.now()): number {
  return Math.max(0, ((fast.endAt ?? now) - fast.startAt) / HOUR);
}

export function completed(fast: FastEntry): boolean {
  return fast.endAt !== undefined && elapsedHours(fast) >= fast.targetHours;
}

/** "15 h 42 m" — hours and minutes, the precision a fasting clock is read at. */
export function formatFastDuration(hours: number): string {
  const totalMin = Math.max(0, Math.floor(hours * 60));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h ? `${h} h ${String(m).padStart(2, '0')} m` : `${m} m`;
}

/** "HH:MM:SS" for the live clock. */
export function formatClockElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

export interface FastStats {
  count: number;
  completedCount: number;
  averageHours: number;
  longestHours: number;
  /** Consecutive most-recent finished fasts that reached their goal. */
  streak: number;
}

export function fastStats(fasts: FastEntry[]): FastStats {
  const done = fasts.filter((f) => f.endAt !== undefined).sort((a, b) => b.startAt - a.startAt);
  const hours = done.map((f) => elapsedHours(f));
  let streak = 0;
  for (const f of done) {
    if (!completed(f)) break;
    streak += 1;
  }
  return {
    count: done.length,
    completedCount: done.filter(completed).length,
    averageHours: hours.length ? hours.reduce((a, b) => a + b, 0) / hours.length : 0,
    longestHours: hours.length ? Math.max(...hours) : 0,
    streak,
  };
}

/**
 * Hours fasted credited to each of the given days, by the day each fast
 * *ended* (or today, for the one still running). A fast is reported on the
 * morning it finished — that is when people think of it as "today's fast".
 */
export function fastHoursByDay(fasts: FastEntry[], days: string[], now = Date.now()): number[] {
  const byDay = new Map<string, number>();
  for (const f of fasts) {
    const day = toISODate(new Date(f.endAt ?? now));
    byDay.set(day, Math.max(byDay.get(day) ?? 0, elapsedHours(f, now)));
  }
  return days.map((d) => Math.round((byDay.get(d) ?? 0) * 10) / 10);
}

/** Value for a `datetime-local` input, in local time. */
export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string): number | undefined {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : undefined;
}
