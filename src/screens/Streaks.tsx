import { useMemo } from 'react';
import { useHistory, useStreak } from '@/stores/useDay';
import { useApp } from '@/stores/useApp';
import { addDays, fromISODate, rangeDays, today, weekdayShort } from '@/lib/date';
import { TrendChart } from '@/components/TrendChart';
import { Card, EmptyState, SectionTitle } from '@/components/ui';
import { IconFlame, IconStreak } from '@/components/icons';

const BADGES: { days: number; label: string; note: string }[] = [
  { days: 3, label: 'Getting going', note: 'Three days in a row' },
  { days: 7, label: 'One week', note: 'A full week logged' },
  { days: 14, label: 'Fortnight', note: 'Two weeks without a gap' },
  { days: 30, label: 'One month', note: 'Thirty days straight' },
  { days: 100, label: 'Century', note: 'A hundred days' },
];

export default function Streaks() {
  const profile = useApp((s) => s.profile);
  const streak = useStreak();
  const history = useHistory(30);

  // Memoised so the empty-set fallback isn't a new object on every render,
  // which would invalidate the `best` calculation below each time.
  const activeDays = useMemo(
    () => streak?.activeDays ?? new Set<string>(),
    [streak?.activeDays],
  );
  const current = streak?.streak ?? 0;

  // Twelve weeks of squares, oldest week first, Monday at the top.
  const weeks = useMemo(() => {
    const days = rangeDays(today(), 84);
    const out: string[][] = [];
    for (let i = 0; i < days.length; i += 7) out.push(days.slice(i, i + 7));
    return out;
  }, []);

  const loggedInWindow = rangeDays(today(), 30).filter((d) => activeDays.has(d)).length;
  const best = useMemo(() => {
    // Longest run anywhere in the last year of activity.
    let run = 0;
    let max = 0;
    for (const day of rangeDays(today(), 365)) {
      if (activeDays.has(day)) {
        run++;
        max = Math.max(max, run);
      } else {
        run = 0;
      }
    }
    return max;
  }, [activeDays]);

  const earned = BADGES.filter((b) => best >= b.days);
  const next = BADGES.find((b) => best < b.days);

  return (
    <div className="px-4 pt-safe pb-6">
      <h1 className="py-3 text-[22px] font-extrabold tracking-tight">Streaks</h1>

      <Card className="flex flex-col items-center gap-1 py-7">
        <IconStreak
          width={38}
          height={38}
          className={current > 0 ? 'text-accent-500' : 'text-[var(--text-muted)]'}
        />
        <p className="tabular mt-1 text-4xl font-extrabold">{current}</p>
        <p className="text-[13px] font-semibold text-secondary">
          day{current === 1 ? '' : 's'} in a row
        </p>
        <p className="mt-1 max-w-xs text-center text-[12px] text-muted">
          {current === 0
            ? 'Log anything today — a meal, a glass of water, a weigh-in — to start a streak.'
            : `Best run: ${best} day${best === 1 ? '' : 's'}. Logging anything at all keeps it alive.`}
        </p>
      </Card>

      {/* Activity grid */}
      <Card className="mt-3">
        <SectionTitle>Last 12 weeks</SectionTitle>
        <div className="flex gap-1 overflow-x-auto pb-1">
          <div className="flex flex-col justify-around pr-1 text-[9px] text-muted">
            {['M', 'W', 'F'].map((d) => (
              <span key={d} className="h-3">
                {d}
              </span>
            ))}
          </div>
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-1">
              {week.map((day) => {
                const active = activeDays.has(day);
                const future = day > today();
                return (
                  <div
                    key={day}
                    title={`${fromISODate(day).toLocaleDateString()} — ${
                      future ? 'upcoming' : active ? 'logged' : 'nothing logged'
                    }`}
                    className={`h-3 w-3 rounded-[3px] ${
                      future
                        ? 'opacity-25 surface-sunken'
                        : active
                          ? 'bg-brand-500'
                          : 'surface-sunken'
                    }`}
                  />
                );
              })}
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11.5px] text-muted">
          {loggedInWindow} of the last 30 days logged.
        </p>
      </Card>

      {/* Badges */}
      <Card className="mt-3">
        <SectionTitle>Milestones</SectionTitle>
        {earned.length === 0 ? (
          <p className="text-[13px] text-secondary">
            {next
              ? `${next.days - best} more day${next.days - best === 1 ? '' : 's'} to earn "${next.label}".`
              : 'Keep logging to earn your first milestone.'}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {BADGES.map((badge) => {
              const has = best >= badge.days;
              return (
                <div
                  key={badge.days}
                  className={`flex min-w-[104px] flex-1 flex-col items-center gap-0.5 rounded-xl px-3 py-3 text-center ${
                    has ? 'tint-soft tint-brand' : 'surface-sunken text-[var(--text-muted)]'
                  }`}
                >
                  <IconFlame width={18} height={18} className={has ? 'text-accent-500' : ''} />
                  <p className="text-[12px] font-bold">{badge.label}</p>
                  <p className="text-[10px] opacity-75">{badge.note}</p>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Calorie consistency */}
      <Card className="mt-3">
        <SectionTitle>Calories, last 30 days</SectionTitle>
        {history && history.some((h) => h.kcal > 0) ? (
          <TrendChart
            data={history.map((h) => ({ date: h.date, value: Math.round(h.kcal) }))}
            color="var(--color-ring-calorie)"
            goal={profile?.targets.kcal}
            unit=" cal"
            height={190}
          />
        ) : (
          <EmptyState title="Nothing logged yet" body="Your calorie history will show up here." />
        )}
      </Card>

      <p className="mt-4 px-1 text-center text-[11px] text-muted">
        Yesterday counts up until midnight — a missed day only breaks the streak once it&apos;s
        properly past.
      </p>
      <div className="h-2" />
      <p className="text-center text-[11px] text-muted">
        Week starts {weekdayShort(addDays(today(), -6))}.
      </p>
    </div>
  );
}
