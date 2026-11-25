/**
 * Day handling is deliberately local-time, not UTC: a meal logged at 11pm
 * belongs to that evening, not to tomorrow in UTC. Every `date` in the schema
 * is a local ISO day string.
 */

export function toISODate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/**
 * Hour the diary day starts at (0–5). Set from Settings at startup and on
 * change, and read by `today()` — so every screen, query and new log agrees on
 * which day it is without each of them having to know about the setting.
 */
let dayStartHour = 0;

export function setDayStartHour(hour: number | undefined): void {
  const h = Math.round(Number(hour) || 0);
  dayStartHour = Math.min(5, Math.max(0, h));
}

export function getDayStartHour(): number {
  return dayStartHour;
}

/**
 * The diary day it is right now. With a day start of 3, 1:30 am still reads as
 * yesterday — the late snack belongs to the evening it was eaten in.
 */
export const today = (): string =>
  toISODate(dayStartHour ? new Date(Date.now() - dayStartHour * 3_600_000) : new Date());

export function addDays(iso: string, delta: number): string {
  const d = fromISODate(iso);
  d.setDate(d.getDate() + delta);
  return toISODate(d);
}

export function daysBetween(a: string, b: string): number {
  const ms = fromISODate(b).getTime() - fromISODate(a).getTime();
  return Math.round(ms / 86_400_000);
}

/** Inclusive range of ISO days, oldest first. */
export function rangeDays(endISO: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(endISO, -(count - 1 - i)));
}

export function isToday(iso: string): boolean {
  return iso === today();
}

export function relativeDayLabel(iso: string): string {
  const delta = daysBetween(today(), iso);
  if (delta === 0) return 'Today';
  if (delta === -1) return 'Yesterday';
  if (delta === 1) return 'Tomorrow';
  const d = fromISODate(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function weekdayShort(iso: string): string {
  return fromISODate(iso).toLocaleDateString(undefined, { weekday: 'short' });
}

/** "7h 20m" from a minute count. */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Minutes between two HH:MM clock times, wrapping past midnight. */
export function minutesBetweenClock(from: string, to: string): number {
  const [fh, fm] = from.split(':').map(Number);
  const [th, tm] = to.split(':').map(Number);
  let mins = th * 60 + tm - (fh * 60 + fm);
  if (mins <= 0) mins += 24 * 60;
  return mins;
}

export function formatClock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
