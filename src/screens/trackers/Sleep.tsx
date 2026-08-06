import { useState } from 'react';
import { useApp } from '@/stores/useApp';
import { useDay, useHistory } from '@/stores/useDay';
import { saveProfile, setSleep } from '@/db/repo';
import { formatClock, formatDuration, minutesBetweenClock } from '@/lib/date';
import { RingProgress } from '@/components/RingProgress';
import { TrendChart } from '@/components/TrendChart';
import { Button, Card, Field, PageHeader, SectionTitle } from '@/components/ui';
import { IconMoon } from '@/components/icons';

const QUALITY = [
  [1, 'Terrible'],
  [2, 'Poor'],
  [3, 'OK'],
  [4, 'Good'],
  [5, 'Great'],
] as const;

export default function Sleep() {
  const { profile, selectedDate, refreshProfile } = useApp();
  const day = useDay();
  const history = useHistory(14);

  const goalMin = profile?.sleepGoalMin ?? 480;
  const [bedtime, setBedtime] = useState(day.sleep?.bedtime ?? '23:00');
  const [wake, setWake] = useState(day.sleep?.wake ?? '07:00');
  const [quality, setQuality] = useState<number>(day.sleep?.quality ?? 3);
  const [goalHours, setGoalHours] = useState(String(Math.round((goalMin / 60) * 10) / 10));
  const [editingGoal, setEditingGoal] = useState(false);

  const duration = minutesBetweenClock(bedtime, wake);

  async function save() {
    await setSleep({
      date: selectedDate,
      bedtime,
      wake,
      durationMin: duration,
      quality: quality as 1 | 2 | 3 | 4 | 5,
    });
  }

  async function saveGoal() {
    const hours = Math.max(3, Math.min(14, Number(goalHours) || 8));
    await saveProfile({ sleepGoalMin: Math.round(hours * 60) });
    await refreshProfile();
    setEditingGoal(false);
  }

  return (
    <div className="pb-6">
      <PageHeader title="Sleep" subtitle={`Goal: ${formatDuration(goalMin)}`} />

      <div className="space-y-3 px-4 pt-3">
        <Card className="flex flex-col items-center gap-4 py-6">
          <RingProgress
            value={(day.sleep?.durationMin ?? 0) / goalMin}
            size={148}
            stroke={11}
            color="var(--color-ring-sleep)"
            label={`${formatDuration(day.sleep?.durationMin ?? 0)} slept`}
          >
            <div className="text-center">
              <p className="tabular text-2xl font-extrabold">
                {formatDuration(day.sleep?.durationMin ?? 0)}
              </p>
              <p className="text-[11px] text-muted">of {formatDuration(goalMin)}</p>
            </div>
          </RingProgress>
          {day.sleep ? (
            <p className="text-[12.5px] text-secondary">
              {formatClock(day.sleep.bedtime)} → {formatClock(day.sleep.wake)}
              {day.sleep.quality ? ` · ${QUALITY[day.sleep.quality - 1][1]}` : ''}
            </p>
          ) : (
            <p className="text-[12.5px] text-muted">Nothing logged for this night yet.</p>
          )}
        </Card>

        <Card className="space-y-3">
          <SectionTitle>Log this night</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Went to bed"
              type="time"
              value={bedtime}
              onChange={(e) => setBedtime(e.target.value)}
            />
            <Field
              label="Woke up"
              type="time"
              value={wake}
              onChange={(e) => setWake(e.target.value)}
            />
          </div>
          <p className="tabular text-center text-[13px] font-semibold text-secondary">
            {formatDuration(duration)} in bed
          </p>

          <div>
            <span className="mb-1.5 block text-[13px] font-medium text-secondary">
              How did you sleep?
            </span>
            <div className="flex gap-1.5">
              {QUALITY.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setQuality(value)}
                  className={`hairline flex-1 rounded-lg border py-2 text-[11.5px] font-semibold transition-colors ${
                    quality === value
                      ? 'border-[var(--color-ring-sleep)] bg-[var(--color-ring-sleep)]/10 text-[var(--color-ring-sleep)]'
                      : ''
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <Button full size="lg" onClick={save}>
            Save sleep
          </Button>
        </Card>

        <Card>
          <SectionTitle
            action={
              <button
                type="button"
                onClick={() => setEditingGoal((v) => !v)}
                className="text-[12.5px] font-semibold text-brand-600"
              >
                {editingGoal ? 'Cancel' : 'Edit goal'}
              </button>
            }
          >
            Sleep goal
          </SectionTitle>
          {editingGoal ? (
            <div className="flex items-end gap-2">
              <Field
                value={goalHours}
                onChange={(e) => setGoalHours(e.target.value)}
                inputMode="decimal"
                suffix="hours"
                className="flex-1"
              />
              <Button onClick={saveGoal}>Save</Button>
            </div>
          ) : (
            <p className="text-[13px] text-secondary">
              {formatDuration(goalMin)} a night. Most adults need seven to nine hours; short sleep
              reliably pushes appetite up the next day.
            </p>
          )}
        </Card>

        <Card>
          <SectionTitle>Last 14 nights</SectionTitle>
          {history ? (
            <TrendChart
              data={history.map((h) => ({
                date: h.date,
                value: Math.round((h.sleepMin / 60) * 10) / 10,
              }))}
              color="var(--color-ring-sleep)"
              goal={Math.round((goalMin / 60) * 10) / 10}
              unit=" h"
            />
          ) : (
            <div className="h-[180px]" />
          )}
        </Card>

        <div className="flex items-start gap-2 px-1 text-[12px] text-muted">
          <IconMoon width={14} height={14} className="mt-0.5 shrink-0" />
          <p>Sleep is logged against the date you woke up on.</p>
        </div>
      </div>
    </div>
  );
}
