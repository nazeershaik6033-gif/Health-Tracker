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

/**
 * A set plus the raw text of its two number fields.
 *
 * The drafts are the point. Both inputs used to be bound straight to numbers,
 * so a keystroke round-tripped through `Number()` before it was rendered back:
 * typing "7." produced `Number("7.") === 7`, which re-rendered as "7" and ate
 * the decimal point on the way in. A half-kilo plate was literally unenterable.
 * Clearing the reps field had the same shape of problem, snapping it to "0"
 * instead of leaving it empty to retype.
 */
interface DraftSet extends ExerciseSet {
  repsDraft: string;
  weightDraft: string;
}

const toDraft = (set: ExerciseSet): DraftSet => ({
  ...set,
  repsDraft: String(set.reps),
  weightDraft: set.weightKg === undefined ? '' : String(set.weightKg),
});

/** Keeps at most one decimal point, so "7.5.2" can never be typed. */
function sanitiseDecimal(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  const [head, ...rest] = cleaned.split('.');
  return rest.length ? `${head}.${rest.join('')}` : head;
}

function blankSets(exercise: Exercise): DraftSet[] {
  const count = exercise.defaultSets ?? 3;
  const reps = exercise.defaultReps ?? 10;
  return Array.from({ length: count }, () => toDraft({ reps }));
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

  const [sets, setSets] = useState<DraftSet[]>([]);
  const [minutes, setMinutes] = useState('');
  const [intensity, setIntensity] = useState<WorkoutIntensity>('moderate');
  const [kcalOverride, setKcalOverride] = useState('');
  const [note, setNote] = useState('');
  const [name, setName] = useState('');

  // Reset whenever a different exercise opens the sheet.
  useEffect(() => {
    if (!open || !exercise) return;
    setSets(initial?.sets?.map(toDraft) ?? (exercise.kind === 'strength' ? blankSets(exercise) : []));
    setMinutes(String(initial?.durationMin ?? exercise.defaultDurationMin ?? 20));
    setIntensity(initial?.intensity ?? 'moderate');
    setKcalOverride('');
    setNote(initial?.note ?? '');
    setName(initial?.name ?? exercise.name);
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

  function patchSet(index: number, patch: Partial<DraftSet>) {
    setSets((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function addSet() {
    setSets((prev) => {
      const last = prev[prev.length - 1];
      return [...prev, last ? { ...last } : toDraft({ reps: exercise?.defaultReps ?? 10 })];
    });
  }

  function confirm() {
    if (!exercise) return;
    const usable: ExerciseSet[] = isStrength
      ? sets
          .filter((s) => s.reps > 0)
          .map(({ repsDraft: _r, weightDraft: _w, ...set }) => set)
      : [];
    if (isStrength && usable.length === 0) return;
    if (!isStrength && durationMin <= 0) return;

    haptic(anyPR ? HAPTIC.success : HAPTIC.tap);
    onConfirm({
      exerciseId: exercise.id,
      // The logged name is already a snapshot rather than a lookup, so editing
      // it here renames this entry alone — the catalog keeps its name, and
      // every other log that used it keeps the name it was logged under.
      name: name.trim() || exercise.name,
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
      title={name.trim() || exercise.name}
      maxHeight="88%"
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

        {/* Renaming matters most for variations the catalog does not carry:
            "Bench Press" logged on an incline, a machine whose name differs at
            your gym. It is per-entry, so the catalog stays clean. */}
        <Field
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={exercise.name}
          hint={
            name.trim() && name.trim() !== exercise.name
              ? `Saved as "${name.trim()}" on this entry only — the catalog still says "${exercise.name}".`
              : undefined
          }
        />

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
                  value={set.repsDraft}
                  onChange={(e) => {
                    const repsDraft = e.target.value.replace(/\D/g, '');
                    patchSet(i, { repsDraft, reps: Number(repsDraft) || 0 });
                  }}
                  inputMode="numeric"
                  aria-label={`Set ${i + 1} ${repLabel.toLowerCase()}`}
                  className="hairline tabular w-full flex-1 rounded-xl border bg-transparent px-3 py-2 text-[15px] outline-none focus:border-brand-500"
                />
                <input
                  value={set.weightDraft}
                  onChange={(e) => {
                    const weightDraft = sanitiseDecimal(e.target.value);
                    // "7." parses to 7 and stays on screen as "7.", so the next
                    // keystroke can make it 7.5.
                    const parsed = Number(weightDraft);
                    patchSet(i, {
                      weightDraft,
                      weightKg:
                        weightDraft === '' || !Number.isFinite(parsed) ? undefined : parsed,
                    });
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
