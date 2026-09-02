import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_REST_SEC, kcalFromMet, setVolumeKg, strengthDurationMin } from '@/lib/nutrition';
import { checkPR, hasPR, type ExerciseRecord } from '@/lib/exerciseStats';
import { HAPTIC, haptic } from '@/lib/motion';
import { BottomSheet } from './BottomSheet';
import { Button, Field } from './ui';
import { IconClose, IconPlus, IconTrash } from './icons';
import {
  EQUIPMENT_LABEL,
  MUSCLE_LABEL,
  type Exercise,
  type ExerciseSet,
  type LoggedExercise,
  type WorkoutIntensity,
} from '@/types';

const INTENSITIES: [WorkoutIntensity, string][] = [
  ['light', 'Light'],
  ['moderate', 'Moderate'],
  ['vigorous', 'Vigorous'],
];

interface Props {
  open: boolean;
  exercise: Exercise | null;
  /** Editing an already-logged entry rather than adding a new one. */
  initial?: LoggedExercise | null;
  bodyWeightKg: number;
  record?: ExerciseRecord;
  onClose: () => void;
  onConfirm: (logged: LoggedExercise) => void;
}

function blankSets(exercise: Exercise): ExerciseSet[] {
  const count = exercise.defaultSets ?? 3;
  const reps = exercise.defaultReps ?? 10;
  return Array.from({ length: count }, () => ({ reps }));
}

/**
 * Sets, reps and load for one exercise — the strength analogue of
 * `PortionSheet`. Strength logs sets; everything else logs minutes.
 */
export function SetsSheet({
  open,
  exercise,
  initial,
  bodyWeightKg,
  record,
  onClose,
  onConfirm,
}: Props) {
  const isStrength = exercise?.kind === 'strength';
  const heldInSeconds = exercise?.repUnit === 'sec';

  const [sets, setSets] = useState<ExerciseSet[]>([]);
  const [minutes, setMinutes] = useState('');
  const [intensity, setIntensity] = useState<WorkoutIntensity>('moderate');
  const [kcalOverride, setKcalOverride] = useState('');
  const [note, setNote] = useState('');

  // Reset whenever a different exercise opens the sheet.
  useEffect(() => {
    if (!open || !exercise) return;
    setSets(initial?.sets ?? (exercise.kind === 'strength' ? blankSets(exercise) : []));
    setMinutes(String(initial?.durationMin ?? exercise.defaultDurationMin ?? 20));
    setIntensity(initial?.intensity ?? 'moderate');
    setKcalOverride('');
    setNote(initial?.note ?? '');
  }, [open, exercise, initial]);

  const durationMin = useMemo(() => {
    if (!exercise) return 0;
    if (!isStrength) return Number(minutes) || 0;
    // Seconds-held work already carries its own duration; rep work is derived
    // from time-under-tension plus rest.
    return heldInSeconds
      ? sets.reduce((total, s) => total + s.reps, 0) / 60 +
          (Math.max(0, sets.length - 1) * DEFAULT_REST_SEC) / 60
      : strengthDurationMin(sets);
  }, [exercise, isStrength, heldInSeconds, minutes, sets]);

  const estimated = exercise ? kcalFromMet(exercise.met, durationMin, bodyWeightKg, intensity) : 0;
  const kcal = kcalOverride ? Number(kcalOverride) || 0 : estimated;
  const volume = setVolumeKg(sets);

  const prSets = useMemo(
    () => sets.map((s) => (isStrength ? checkPR(record, s) : { weight: false, oneRM: false, reps: false })),
    [sets, record, isStrength],
  );
  const anyPR = prSets.some(hasPR);

  if (!exercise) return null;

  function patchSet(index: number, patch: Partial<ExerciseSet>) {
    setSets((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function addSet() {
    setSets((prev) => {
      const last = prev[prev.length - 1];
      return [...prev, last ? { ...last } : { reps: exercise?.defaultReps ?? 10 }];
    });
  }

  function confirm() {
    if (!exercise) return;
    const usable = isStrength ? sets.filter((s) => s.reps > 0) : [];
    if (isStrength && usable.length === 0) return;
    if (!isStrength && durationMin <= 0) return;

    haptic(anyPR ? HAPTIC.success : HAPTIC.tap);
    onConfirm({
      exerciseId: exercise.id,
      name: exercise.name,
      kind: exercise.kind,
      met: exercise.met,
      sets: isStrength ? usable : undefined,
      // Recorded for strength too, not just cardio. The calorie estimate is
      // already derived from these minutes, so leaving them off made the
      // session's total duration disagree with its own calorie figure.
      durationMin,
      intensity,
      kcal,
      note: note.trim() || undefined,
    });
  }

  const canConfirm = isStrength ? sets.some((s) => s.reps > 0) : durationMin > 0;
  const repLabel = heldInSeconds ? 'Secs' : 'Reps';

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={exercise.name}
      maxHeight="88dvh"
      footer={
        <Button full size="lg" onClick={confirm} disabled={!canConfirm}>
          {initial ? 'Save' : 'Add'} · ~{kcal} cal
        </Button>
      }
    >
      <div className="space-y-4 pb-2">
        <p className="text-[13px] text-secondary">
          {exercise.muscles.map((m) => MUSCLE_LABEL[m]).join(', ')} ·{' '}
          {EQUIPMENT_LABEL[exercise.equipment]}
        </p>

        {isStrength ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 px-1 text-[11px] font-semibold tracking-wide text-muted uppercase">
              <span className="w-8">Set</span>
              <span className="flex-1">{repLabel}</span>
              <span className="flex-1">Weight (kg)</span>
              <span className="w-8" />
            </div>

            {sets.map((set, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="tabular w-8 text-[13px] font-semibold text-secondary">{i + 1}</span>
                <input
                  value={String(set.reps)}
                  onChange={(e) => patchSet(i, { reps: Number(e.target.value.replace(/\D/g, '')) || 0 })}
                  inputMode="numeric"
                  aria-label={`Set ${i + 1} ${repLabel.toLowerCase()}`}
                  className="hairline tabular w-full flex-1 rounded-xl border bg-transparent px-3 py-2 text-[15px] outline-none focus:border-brand-500"
                />
                <input
                  value={set.weightKg === undefined ? '' : String(set.weightKg)}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^0-9.]/g, '');
                    patchSet(i, { weightKg: raw === '' ? undefined : Number(raw) });
                  }}
                  inputMode="decimal"
                  placeholder="—"
                  aria-label={`Set ${i + 1} weight in kilograms`}
                  className="hairline tabular w-full flex-1 rounded-xl border bg-transparent px-3 py-2 text-[15px] outline-none placeholder:text-[var(--text-muted)] focus:border-brand-500"
                />
                <button
                  type="button"
                  onClick={() => setSets((prev) => prev.filter((_, j) => j !== i))}
                  disabled={sets.length === 1}
                  aria-label={`Remove set ${i + 1}`}
                  className="w-8 shrink-0 rounded-lg p-1.5 text-muted transition-transform active:scale-90 disabled:opacity-30"
                >
                  <IconClose width={15} height={15} />
                </button>
              </div>
            ))}

            <button
              type="button"
              onClick={addSet}
              className="hairline flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed py-2.5 text-[13px] font-semibold text-brand-600 transition-transform active:scale-[0.99]"
            >
              <IconPlus width={15} height={15} />
              Add set
            </button>

            {volume > 0 && (
              <p className="tabular pt-1 text-[12px] text-secondary">
                Volume: {volume.toLocaleString()} kg moved
                {anyPR && <span className="accent-rule-fg ml-2 font-bold">· New PR</span>}
              </p>
            )}
          </div>
        ) : (
          <Field
            label="Duration"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
            suffix="min"
          />
        )}

        <div>
          <span className="mb-1.5 block text-[13px] font-medium text-secondary">Intensity</span>
          <div className="flex gap-1.5">
            {INTENSITIES.map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setIntensity(value)}
                className={`hairline flex-1 rounded-lg border py-2 text-[12.5px] font-semibold transition-transform active:scale-95 ${
                  intensity === value ? 'border-brand-500 tint-soft tint-brand' : ''
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
          hint={
            isStrength
              ? `Estimated from ${Math.round(durationMin)} min under tension at ${bodyWeightKg.toFixed(0)} kg. Resistance work varies a lot between people — override it if you have better data.`
              : `Estimated at ${bodyWeightKg.toFixed(0)} kg — override if your tracker says otherwise.`
          }
        />

        <Field
          label="Note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional"
        />

        {record && record.sessions > 0 && (
          <div className="surface-sunken rounded-xl p-3">
            <p className="mb-1 text-[12px] font-semibold">Your best so far</p>
            <p className="tabular text-[12px] text-secondary">
              {record.bestWeightKg > 0
                ? `${record.bestWeightKg} kg × ${record.bestWeightReps} · est. 1RM ${record.best1RM} kg`
                : `${record.bestReps} reps in a set`}{' '}
              · {record.sessions} session{record.sessions === 1 ? '' : 's'}
            </p>
          </div>
        )}

        {initial && (
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 text-[12.5px] font-semibold text-muted"
          >
            <IconTrash width={14} height={14} />
            Close without saving
          </button>
        )}
      </div>
    </BottomSheet>
  );
}
