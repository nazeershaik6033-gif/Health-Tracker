import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/schema';
import { useApp } from '@/stores/useApp';
import { useDay, useHistory } from '@/stores/useDay';
import {
  addWorkout,
  deleteWorkout,
  markExercisesUsed,
  saveProfile,
  updateWorkout,
  workoutsForRange,
} from '@/db/repo';
import { setVolumeKg } from '@/lib/nutrition';
import { recordsByExercise, summariseSession } from '@/lib/exerciseStats';
import { addDays, today } from '@/lib/date';
import { ExercisePicker } from '@/components/ExercisePicker';
import { SetsSheet } from '@/components/SetsSheet';
import { RingProgress } from '@/components/RingProgress';
import { TrendChart } from '@/components/TrendChart';
import { Button, Card, Field, PageHeader, SectionTitle } from '@/components/ui';
import { IconChevronRight, IconDumbbell, IconPlus, IconTrash } from '@/components/icons';
import type { Exercise, LoggedExercise, WorkoutEntry } from '@/types';

/**
 * The workout tracker.
 *
 * A day holds one *session* row per logged group of exercises. The session's
 * `type`, `durationMin` and `kcal` are roll-ups, so the Home tile, the streak,
 * the calendar dots and the AI day context all keep reading a workout the way
 * they always did. Rows logged before sessions existed have no `exercises`
 * array and still render, via the fallback in `SessionCard`.
 */
export default function Workout() {
  const { profile, selectedDate, refreshProfile } = useApp();
  const day = useDay();
  const history = useHistory(14);

  const goal = profile?.workoutKcalGoal ?? 300;
  const [goalInput, setGoalInput] = useState(String(goal));
  const [editingGoal, setEditingGoal] = useState(false);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, setPending] = useState<Exercise | null>(null);
  const [editing, setEditing] = useState<{
    workoutId: string;
    index: number;
    logged: LoggedExercise;
  } | null>(null);

  const latestWeight = useLiveQuery(async () => db.weight.orderBy('date').reverse().first(), []);
  const bodyWeightKg = latestWeight?.kg ?? profile?.startWeightKg ?? 70;

  // Records span the last year, which is enough for a PR to mean something
  // without reading the whole table on every render.
  const pastYear = useLiveQuery(
    () => workoutsForRange(addDays(today(), -365), today()),
    [],
    [] as WorkoutEntry[],
  );
  const records = useMemo(() => recordsByExercise(pastYear ?? []), [pastYear]);

  const sessions = day.workouts;
  const exerciseCount = sessions.reduce((n, w) => n + (w.exercises?.length ?? 1), 0);

  /** The day's session, or a new one — everything logs into a single row. */
  async function addExercise(logged: LoggedExercise) {
    const existing = sessions.find((w) => w.exercises);
    const next = [...(existing?.exercises ?? []), logged];
    const roll = summariseSession(next);

    if (existing) {
      await updateWorkout(existing.id, { ...roll, exercises: next });
    } else {
      await addWorkout({
        date: selectedDate,
        ...roll,
        intensity: logged.intensity,
        exercises: next,
      });
    }
    await markExercisesUsed([logged.exerciseId]);
    setPending(null);
  }

  async function replaceExercise(workoutId: string, index: number, logged: LoggedExercise) {
    const workout = sessions.find((w) => w.id === workoutId);
    if (!workout?.exercises) return;
    const next = workout.exercises.map((e, i) => (i === index ? logged : e));
    await updateWorkout(workoutId, { ...summariseSession(next), exercises: next });
    setEditing(null);
  }

  async function removeExercise(workoutId: string, index: number) {
    const workout = sessions.find((w) => w.id === workoutId);
    if (!workout?.exercises) return;
    const next = workout.exercises.filter((_, i) => i !== index);
    // An emptied session is deleted rather than left as a stray heading.
    if (next.length === 0) await deleteWorkout(workoutId);
    else await updateWorkout(workoutId, { ...summariseSession(next), exercises: next });
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
            {exerciseCount
              ? `${exerciseCount} exercise${exerciseCount === 1 ? '' : 's'} logged`
              : 'Nothing logged for this day yet.'}
          </p>
        </Card>

        {sessions.map((workout) => (
          <SessionCard
            key={workout.id}
            workout={workout}
            onEdit={(index, logged) => setEditing({ workoutId: workout.id, index, logged })}
            onRemove={(index) => removeExercise(workout.id, index)}
            onDeleteLegacy={() => deleteWorkout(workout.id)}
          />
        ))}

        <Button full size="lg" onClick={() => setPickerOpen(true)}>
          <IconPlus width={17} height={17} />
          Add exercise
        </Button>

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

        <p className="px-1 text-[11.5px] leading-relaxed text-muted">
          Calories for resistance work are estimated from sets, reps and time under tension. They
          vary far more between people than steady-state cardio does — treat them as a guide, and
          override any figure you can measure better.
        </p>
      </div>

      <ExercisePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(exercise) => {
          setPickerOpen(false);
          setPending(exercise);
        }}
      />

      <SetsSheet
        open={Boolean(pending)}
        exercise={pending}
        bodyWeightKg={bodyWeightKg}
        record={pending ? records.get(pending.id) : undefined}
        onClose={() => setPending(null)}
        onConfirm={addExercise}
      />

      <EditSheet
        editing={editing}
        bodyWeightKg={bodyWeightKg}
        records={records}
        onClose={() => setEditing(null)}
        onConfirm={replaceExercise}
      />
    </div>
  );
}

/** Reopens `SetsSheet` against an already-logged entry. */
function EditSheet({
  editing,
  bodyWeightKg,
  records,
  onClose,
  onConfirm,
}: {
  editing: { workoutId: string; index: number; logged: LoggedExercise } | null;
  bodyWeightKg: number;
  records: ReturnType<typeof recordsByExercise>;
  onClose: () => void;
  onConfirm: (workoutId: string, index: number, logged: LoggedExercise) => void;
}) {
  const exercise = useLiveQuery(
    () => (editing ? db.exercises.get(editing.logged.exerciseId) : undefined),
    [editing?.logged.exerciseId],
  );

  if (!editing) return null;

  // The catalog entry can be gone if the user deleted a custom exercise. Fall
  // back to the snapshot on the log so the entry stays editable regardless.
  const target: Exercise = exercise ?? {
    id: editing.logged.exerciseId,
    name: editing.logged.name,
    kind: editing.logged.kind,
    met: editing.logged.met,
    muscles: [],
    equipment: 'other',
    tags: [],
    source: 'custom',
    useCount: 0,
  };

  return (
    <SetsSheet
      open
      exercise={target}
      initial={editing.logged}
      bodyWeightKg={bodyWeightKg}
      record={records.get(editing.logged.exerciseId)}
      onClose={onClose}
      onConfirm={(logged) => onConfirm(editing.workoutId, editing.index, logged)}
    />
  );
}

function describeSets(logged: LoggedExercise): string {
  const sets = logged.sets ?? [];
  // Strength is described by its sets; everything else by its duration. Both
  // now carry `durationMin`, so the presence of sets is what distinguishes them.
  if (!sets.length) {
    return logged.durationMin
      ? `${Math.round(logged.durationMin)} min · ${logged.intensity}`
      : logged.intensity;
  }

  const volume = setVolumeKg(sets);
  const reps = sets.map((s) => s.reps);
  const uniform = reps.every((r) => r === reps[0]);
  const shape = uniform ? `${sets.length} × ${reps[0]}` : reps.join(', ');
  return volume > 0 ? `${shape} · ${volume.toLocaleString()} kg` : shape;
}

function SessionCard({
  workout,
  onEdit,
  onRemove,
  onDeleteLegacy,
}: {
  workout: WorkoutEntry;
  onEdit: (index: number, logged: LoggedExercise) => void;
  onRemove: (index: number) => void;
  onDeleteLegacy: () => void;
}) {
  // Pre-session rows have no exercise breakdown. They stay exactly as they
  // were logged rather than being migrated into a shape they never had.
  if (!workout.exercises?.length) {
    return (
      <Card className="flex items-center gap-3 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-ring-workout)]/12 text-[var(--color-ring-workout)]">
          <IconDumbbell width={17} height={17} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold">{workout.type}</p>
          <p className="text-[12px] text-secondary">
            {workout.durationMin} min · {workout.intensity}
          </p>
        </div>
        <span className="tabular text-[13px] font-bold">{workout.kcal} cal</span>
        <button
          type="button"
          onClick={onDeleteLegacy}
          aria-label={`Delete ${workout.type}`}
          className="rounded-lg p-1.5 text-muted transition-transform active:scale-90"
        >
          <IconTrash width={15} height={15} />
        </button>
      </Card>
    );
  }

  return (
    <Card className="space-y-1 py-3">
      <div className="flex items-baseline justify-between gap-2 pb-1">
        <p className="text-[14px] font-bold tracking-tight">{workout.title ?? workout.type}</p>
        <p className="tabular text-[12px] text-secondary">
          {workout.durationMin} min · {workout.kcal} cal
        </p>
      </div>

      <ul className="stagger">
        {workout.exercises.map((logged, i) => (
          <li
            key={`${logged.exerciseId}-${i}`}
            style={{ '--i': i } as React.CSSProperties}
            className="hairline flex items-center gap-2 border-t py-2"
          >
            <button
              type="button"
              onClick={() => onEdit(i, logged)}
              className="min-w-0 flex-1 text-left transition-transform active:scale-[0.99]"
            >
              <span className="block truncate text-[13.5px] font-semibold">{logged.name}</span>
              <span className="tabular block truncate text-[12px] text-secondary">
                {describeSets(logged)}
              </span>
            </button>
            <Link
              to={`/exercise/${encodeURIComponent(logged.exerciseId)}`}
              aria-label={`${logged.name} history`}
              className="rounded-lg p-1 text-muted transition-transform active:scale-90"
            >
              <IconChevronRight width={16} height={16} />
            </Link>
            <span className="tabular shrink-0 text-[12.5px] font-bold">{logged.kcal}</span>
            <button
              type="button"
              onClick={() => onRemove(i)}
              aria-label={`Remove ${logged.name}`}
              className="shrink-0 rounded-lg p-1.5 text-muted transition-transform active:scale-90"
            >
              <IconTrash width={14} height={14} />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
