import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/schema';
import { useApp } from '@/stores/useApp';
import { useDay, useHistory } from '@/stores/useDay';
import { addWorkout, deleteWorkout, saveProfile } from '@/db/repo';
import { WORKOUT_METS, estimateWorkoutKcal } from '@/lib/nutrition';
import { RingProgress } from '@/components/RingProgress';
import { TrendChart } from '@/components/TrendChart';
import { Button, Card, Field, PageHeader, SectionTitle } from '@/components/ui';
import { IconFlame, IconTrash } from '@/components/icons';
import type { WorkoutIntensity } from '@/types';

const INTENSITIES: [WorkoutIntensity, string][] = [
  ['light', 'Light'],
  ['moderate', 'Moderate'],
  ['vigorous', 'Vigorous'],
];

export default function Workout() {
  const { profile, selectedDate, refreshProfile } = useApp();
  const day = useDay();
  const history = useHistory(14);

  const goal = profile?.workoutKcalGoal ?? 300;
  const [type, setType] = useState('Walking');
  const [minutes, setMinutes] = useState('30');
  const [intensity, setIntensity] = useState<WorkoutIntensity>('moderate');
  const [kcalOverride, setKcalOverride] = useState('');
  const [goalInput, setGoalInput] = useState(String(goal));
  const [editingGoal, setEditingGoal] = useState(false);

  const latestWeight = useLiveQuery(async () => db.weight.orderBy('date').reverse().first(), []);
  const weightKg = latestWeight?.kg ?? profile?.startWeightKg ?? 70;

  const estimated = useMemo(
    () => estimateWorkoutKcal(type, Number(minutes) || 0, weightKg, intensity),
    [type, minutes, weightKg, intensity],
  );
  const kcal = kcalOverride ? Number(kcalOverride) || 0 : estimated;

  async function log() {
    const mins = Number(minutes) || 0;
    if (mins <= 0) return;
    await addWorkout({ date: selectedDate, type, durationMin: mins, kcal, intensity });
    setKcalOverride('');
  }

  async function saveGoal() {
    await saveProfile({ workoutKcalGoal: Math.max(50, Number(goalInput) || goal) });
    await refreshProfile();
    setEditingGoal(false);
  }

  return (
    <div className="pb-6">
      <PageHeader title="Workout" subtitle={`Goal: ${goal} cal burned`} />

      <div className="space-y-3 px-4 pt-3">
        <Card className="flex flex-col items-center gap-3 py-6">
          <RingProgress
            value={day.workoutKcal / (goal || 1)}
            size={148}
            stroke={11}
            color="var(--color-ring-workout)"
            label={`${day.workoutKcal} of ${goal} calories burned`}
          >
            <div className="text-center">
              <p className="tabular text-3xl font-extrabold">{day.workoutKcal}</p>
              <p className="text-[11px] text-muted">of {goal} cal</p>
            </div>
          </RingProgress>
          <p className="text-[12.5px] text-secondary">
            {day.workouts.length
              ? `${day.workouts.length} workout${day.workouts.length === 1 ? '' : 's'} logged`
              : 'Nothing logged for this day yet.'}
          </p>
        </Card>

        {day.workouts.length > 0 && (
          <Card className="py-2">
            <ul>
              {day.workouts.map((w) => (
                <li
                  key={w.id}
                  className="flex items-center gap-3 border-b border-[var(--surface-border)] py-2.5 last:border-0"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-ring-workout)]/12 text-[var(--color-ring-workout)]">
                    <IconFlame width={17} height={17} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold">{w.type}</p>
                    <p className="text-[12px] text-secondary">
                      {w.durationMin} min · {w.intensity}
                    </p>
                  </div>
                  <span className="tabular text-[13px] font-bold">{w.kcal} cal</span>
                  <button
                    type="button"
                    onClick={() => deleteWorkout(w.id)}
                    aria-label={`Delete ${w.type}`}
                    className="rounded-lg p-1.5 text-muted hover:text-red-600"
                  >
                    <IconTrash width={15} height={15} />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card className="space-y-3">
          <SectionTitle>Log a workout</SectionTitle>

          <div>
            <span className="mb-1.5 block text-[13px] font-medium text-secondary">Activity</span>
            <div className="flex flex-wrap gap-1.5">
              {Object.keys(WORKOUT_METS).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`hairline rounded-full border px-3 py-1.5 text-[12.5px] font-medium ${
                    t === type
                      ? 'border-[var(--color-ring-workout)] bg-[var(--color-ring-workout)]/10 text-[var(--color-ring-workout)]'
                      : ''
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <Field
            label="Duration"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
            suffix="min"
          />

          <div>
            <span className="mb-1.5 block text-[13px] font-medium text-secondary">Intensity</span>
            <div className="flex gap-1.5">
              {INTENSITIES.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setIntensity(value)}
                  className={`hairline flex-1 rounded-lg border py-2 text-[12.5px] font-semibold ${
                    intensity === value
                      ? 'border-[var(--color-ring-workout)] bg-[var(--color-ring-workout)]/10 text-[var(--color-ring-workout)]'
                      : ''
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <Field
            label="Calories burned"
            value={kcalOverride}
            onChange={(e) => setKcalOverride(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
            placeholder={String(estimated)}
            suffix="cal"
            hint={`Estimated from MET values at ${weightKg.toFixed(0)} kg — override if your tracker says otherwise.`}
          />

          <Button full size="lg" onClick={log} disabled={!Number(minutes)}>
            Log {kcal} cal
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
            Daily burn goal
          </SectionTitle>
          {editingGoal ? (
            <div className="flex items-end gap-2">
              <Field
                value={goalInput}
                onChange={(e) => setGoalInput(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
                suffix="cal"
                className="flex-1"
              />
              <Button onClick={saveGoal}>Save</Button>
            </div>
          ) : (
            <p className="text-[13px] text-secondary">
              {goal} calories a day from deliberate exercise. This is separate from what you burn
              just existing, which is already in your calorie target.
            </p>
          )}
        </Card>

        <Card>
          <SectionTitle>Last 14 days</SectionTitle>
          {history ? (
            <TrendChart
              data={history.map((h) => ({ date: h.date, value: h.burned }))}
              color="var(--color-ring-workout)"
              goal={goal}
              unit=" cal"
            />
          ) : (
            <div className="h-[180px]" />
          )}
        </Card>
      </div>
    </div>
  );
}
