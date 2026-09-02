import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '@/stores/useApp';
import { addDays, relativeDayLabel, today, weekdayShort, fromISODate } from '@/lib/date';
import { IconCalendar, IconChevronDown, IconSearch, IconSettings, IconStreak, IconUser } from './icons';

/**
 * Avatar · streak pill · date selector. The date selector expands into a
 * 14-day rail rather than a native picker, which is faster for the "check
 * yesterday" case that dominates in practice.
 */
export function TopBar({ streakDays }: { streakDays?: number }) {
  const { profile, selectedDate, setSelectedDate } = useApp();
  const [open, setOpen] = useState(false);

  const days = Array.from({ length: 14 }, (_, i) => addDays(today(), i - 13));

  return (
    <header className="sticky top-0 z-20 chrome-canvas px-4 pt-safe pb-2">
      <div className="flex items-center gap-2">
        <Link
          to="/settings"
          aria-label="Profile and settings"
          className="surface-card flex h-9 w-9 items-center justify-center rounded-full text-secondary"
        >
          {profile?.name ? (
            <span className="text-[13px] font-bold text-brand-600">
              {profile.name.trim().charAt(0).toUpperCase()}
            </span>
          ) : (
            <IconUser width={18} height={18} />
          )}
        </Link>

        <div className="flex-1" />

        {streakDays !== undefined && streakDays > 0 && (
          <Link
            to="/streaks"
            className="flex items-center gap-1 rounded-full tint-soft tint-brand px-2.5 py-1.5 text-[12px] font-bold"
          >
            <IconStreak width={14} height={14} />
            {streakDays} day{streakDays === 1 ? '' : 's'}
          </Link>
        )}

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="surface-card flex items-center gap-1 rounded-full px-3 py-1.5 text-[13px] font-semibold"
        >
          {relativeDayLabel(selectedDate)}
          <IconChevronDown
            width={15}
            height={15}
            className={`transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>

        <Link
          to="/find"
          aria-label="Search foods and exercises"
          className="surface-card flex h-9 w-9 items-center justify-center rounded-full text-secondary"
        >
          <IconSearch width={17} height={17} />
        </Link>

        <Link
          to="/calendar"
          aria-label="Calendar"
          className="surface-card flex h-9 w-9 items-center justify-center rounded-full text-secondary"
        >
          <IconCalendar width={17} height={17} />
        </Link>

        <Link
          to="/settings"
          aria-label="Settings"
          className="surface-card flex h-9 w-9 items-center justify-center rounded-full text-secondary"
        >
          <IconSettings width={17} height={17} />
        </Link>
      </div>

      {open && (
        <div className="no-scrollbar animate-fade-in mt-3 flex gap-2 overflow-x-auto pb-1">
          {days.map((d) => {
            const active = d === selectedDate;
            return (
              <button
                key={d}
                type="button"
                onClick={() => {
                  setSelectedDate(d);
                  setOpen(false);
                }}
                className={`flex w-12 shrink-0 flex-col items-center rounded-xl py-2 text-[11px] font-semibold transition-colors ${
                  active ? 'bg-brand-500 text-white' : 'surface-card text-secondary'
                }`}
              >
                <span className="opacity-70">{weekdayShort(d)}</span>
                <span className="text-[15px] font-bold">{fromISODate(d).getDate()}</span>
              </button>
            );
          })}
        </div>
      )}
    </header>
  );
}
