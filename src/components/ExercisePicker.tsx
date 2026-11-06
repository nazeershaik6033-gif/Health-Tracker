import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/schema';
import { STARTER_FREQUENT } from '@/data/exercises.seed';
import { frequentExercises, searchExercises, type ExerciseFilter } from '@/lib/exerciseSearch';
import { BottomSheet } from './BottomSheet';
import { Chip } from './ui';
import { IconDumbbell, IconSearch } from './icons';
import {
  EQUIPMENT_LABEL,
  MUSCLE_LABEL,
  type Equipment,
  type Exercise,
  type MuscleGroup,
} from '@/types';

const MUSCLES = Object.keys(MUSCLE_LABEL) as MuscleGroup[];
const EQUIPMENT = Object.keys(EQUIPMENT_LABEL) as Equipment[];

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (exercise: Exercise) => void;
  onCreateCustom?: () => void;
}

/**
 * Search and browse the exercise catalog.
 *
 * Mirrors the food Search screen: query first, filters for browsing, and a
 * frequent-first list so the common case is one tap rather than typing.
 */
export function ExercisePicker({ open, onClose, onPick, onCreateCustom }: Props) {
  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState<MuscleGroup | undefined>();
  const [equipment, setEquipment] = useState<Equipment | undefined>();

  const exercises = useLiveQuery(() => db.exercises.toArray(), [], [] as Exercise[]);

  const filter: ExerciseFilter = useMemo(() => ({ muscle, equipment }), [muscle, equipment]);
  const filtering = Boolean(muscle || equipment);

  const results = useMemo(() => {
    if (!exercises?.length) return [];
    // No query and no filter is a cold open — lead with what they actually
    // train rather than an alphabetical wall.
    if (!query.trim() && !filtering) {
      return frequentExercises(exercises, STARTER_FREQUENT, 24);
    }
    return searchExercises(exercises, query, filter, 60);
  }, [exercises, query, filter, filtering]);

  function pick(exercise: Exercise) {
    onPick(exercise);
    setQuery('');
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Add an exercise" maxHeight="88%">
      <div className="space-y-3 pb-2">
        <div className="relative">
          <IconSearch
            width={17}
            height={17}
            className="absolute top-1/2 left-3.5 -translate-y-1/2 text-muted"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search bench press, squat, run…"
            aria-label="Search exercises"
            autoComplete="off"
            className="hairline w-full rounded-xl border bg-transparent py-2.5 pr-3.5 pl-10 text-[15px] outline-none placeholder:text-[var(--text-muted)] focus:border-brand-500"
          />
        </div>

        <div className="scroll-x no-scrollbar -mx-5 flex gap-1.5 px-5">
          <Chip active={!muscle} onClick={() => setMuscle(undefined)}>
            All muscles
          </Chip>
          {MUSCLES.map((m) => (
            <Chip key={m} active={muscle === m} onClick={() => setMuscle(muscle === m ? undefined : m)}>
              {MUSCLE_LABEL[m]}
            </Chip>
          ))}
        </div>

        <div className="scroll-x no-scrollbar -mx-5 flex gap-1.5 px-5">
          <Chip active={!equipment} onClick={() => setEquipment(undefined)}>
            Any kit
          </Chip>
          {EQUIPMENT.map((e) => (
            <Chip
              key={e}
              active={equipment === e}
              onClick={() => setEquipment(equipment === e ? undefined : e)}
            >
              {EQUIPMENT_LABEL[e]}
            </Chip>
          ))}
        </div>

        {!query.trim() && !filtering && (
          <p className="text-[12px] font-semibold text-muted">Frequently trained</p>
        )}

        {results.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-[13.5px] text-secondary">No exercise matches that.</p>
            {onCreateCustom && (
              <button
                type="button"
                onClick={onCreateCustom}
                className="mt-3 text-[13px] font-semibold text-brand-600"
              >
                Create it yourself
              </button>
            )}
          </div>
        ) : (
          <ul className="stagger list-fast">
            {results.map((exercise, i) => (
              <li key={exercise.id} style={{ '--i': i } as React.CSSProperties}>
                <button
                  type="button"
                  onClick={() => pick(exercise)}
                  className="hairline flex w-full items-center gap-3 border-b py-2.5 text-left transition-transform last:border-0 active:scale-[0.99]"
                >
                  <span className="tint-soft tint-brand flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
                    <IconDumbbell width={16} height={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold">{exercise.name}</span>
                    <span className="block truncate text-[12px] text-secondary">
                      {exercise.muscles.map((m) => MUSCLE_LABEL[m]).join(', ')} ·{' '}
                      {EQUIPMENT_LABEL[exercise.equipment]}
                    </span>
                  </span>
                  {exercise.useCount > 0 && (
                    <span className="shrink-0 text-[11px] text-muted">×{exercise.useCount}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </BottomSheet>
  );
}
