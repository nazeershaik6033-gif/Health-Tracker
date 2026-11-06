import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useApp } from '@/stores/useApp';
import { summariseRange } from '@/db/repo';
import { addDays, fromISODate, isToday, today } from '@/lib/date';
import { HAPTIC, haptic } from '@/lib/motion';
import { RingProgress } from './RingProgress';
import { IconCalendar, IconChevronLeft, IconChevronRight, IconSearch, IconStreak } from './icons';

/** Monday of the week containing `iso`. */
function weekStart(iso: string): string {
  const day = fromISODate(iso).getDay(); // 0 = Sunday
  return addDays(iso, -((day + 6) % 7));
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * Greeting · quick actions · a Mon–Sun week strip. Each day in the strip is
 * its own tiny calorie ring, so the week's shape is visible before tapping
 * anything — and tapping a day is the fastest way to look back.
 */
export function TopBar({ streakDays }: { streakDays?: number }) {
  const { profile, selectedDate, setSelectedDate } = useApp();
  const start = weekStart(selectedDate);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const end = days[6];
  const summary = useLiveQuery(() => summariseRange(start, end), [start, end]);
  const target = profile?.targets.kcal || 1;
  const thisWeek = start === weekStart(today());

  const pick = (d: string) => {
    haptic(HAPTIC.tap);
    setSelectedDate(d);
  };

  const first = profile?.name?.trim().split(/\s+/)[0];
  const dateLine = fromISODate(selectedDate).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

  return (
    <header className="px-4 pt-safe">
      <div className="flex items-center gap-3 pt-2">
        <Link
          to="/settings"
          aria-label="Profile and settings"
          className="pressable brand-gradient flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[16px] font-bold shadow-[0_8px_20px_-8px_rgb(14_154_104/0.7)]"
        >
          {first ? first.charAt(0).toUpperCase() : '·'}
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-medium text-secondary">
            {greeting()} · {dateLine}
          </p>
          <h1 className="truncate text-[22px] leading-tight font-bold tracking-tight">
            {first ?? 'Welcome'}
          </h1>
        </div>
        <Link
          to="/find"
          aria-label="Search foods and exercises"
          className="pressable surface-card flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-secondary"
        >
          <IconSearch width={18} height={18} />
        </Link>
        <Link
          to="/calendar"
          aria-label="Calendar"
          className="pressable surface-card flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-secondary"
        >
          <IconCalendar width={18} height={18} />
        </Link>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => pick(addDays(start, -7))}
            aria-label="Previous week"
            className="pressable flex h-7 w-7 items-center justify-center rounded-full text-secondary hover:bg-[var(--surface-sunken)]"
          >
            <IconChevronLeft width={16} height={16} />
          </button>
          <span className="text-[13px] font-semibold">
            {thisWeek
              ? 'This week'
              : `${fromISODate(start).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${fromISODate(end).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`}
          </span>
          <button
            type="button"
            onClick={() => pick(thisWeek ? today() : addDays(start, 7))}
            disabled={thisWeek}
            aria-label="Next week"
            className="pressable flex h-7 w-7 items-center justify-center rounded-full text-secondary hover:bg-[var(--surface-sunken)] disabled:opacity-30"
          >
            <IconChevronRight width={16} height={16} />
          </button>
        </div>
        {streakDays !== undefined && streakDays > 0 && (
          <Link
            to="/streaks"
            className="pressable tint-soft tint-warm flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-bold"
          >
            <IconStreak width={13} height={13} />
            {streakDays}-day streak
          </Link>
        )}
      </div>

      <div className="mt-2.5 grid grid-cols-7 gap-1.5">
        {days.map((d) => {
          const active = d === selectedDate;
          const future = d > today();
          const kcal = summary?.get(d)?.kcal ?? 0;
          return (
            <button
              key={d}
              type="button"
              disabled={future}
              onClick={() => pick(d)}
              aria-pressed={active}
              aria-label={fromISODate(d).toDateString()}
              className={`pressable relative flex flex-col items-center gap-1 rounded-2xl pt-1.5 pb-2 transition-[background-color,box-shadow,color] duration-300 disabled:opacity-35 ${
                active ? 'surface-card' : ''
              }`}
            >
              <span
                className={`text-[10.5px] font-semibold uppercase ${active ? 'text-brand-600' : 'text-muted'}`}
              >
                {fromISODate(d).toLocaleDateString(undefined, { weekday: 'narrow' })}
              </span>
              <RingProgress
                value={kcal / target}
                size={34}
                stroke={3}
                color="var(--color-ring-calorie)"
                trackColor="var(--surface-sunken)"
              >
                <span
                  className={`tabular text-[12.5px] font-bold ${isToday(d) && !active ? 'text-brand-600' : ''}`}
                >
                  {fromISODate(d).getDate()}
                </span>
              </RingProgress>
            </button>
          );
        })}
      </div>
    </header>
  );
}
