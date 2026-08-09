import { expand, frequentByUse, normalise, scoreEntity } from './search';
import { MUSCLE_LABEL, type Equipment, type Exercise, type MuscleGroup } from '@/types';

/**
 * Local fuzzy search over the exercise catalog. Same scoring core as food
 * search; what differs is the haystack (muscles and equipment are searchable
 * here) and the tie-breakers — exercises have no `verified` or `barcode`.
 */

/** Gym vocabulary, so what people actually type finds the right movement. */
const SYNONYMS: Record<string, string[]> = {
  db: ['dumbbell'],
  bb: ['barbell'],
  kb: ['kettlebell'],
  bw: ['bodyweight'],
  ohp: ['overhead', 'press'],
  dl: ['deadlift'],
  rdl: ['romanian', 'deadlift'],
  sldl: ['stiff', 'deadlift'],
  bor: ['bent', 'row'],
  cgbp: ['close', 'grip', 'bench'],
  pushup: ['push', 'up'],
  pullup: ['pull', 'up'],
  chinup: ['chin', 'up'],
  situp: ['sit', 'up'],
  abs: ['core', 'crunch'],
  delt: ['shoulder'],
  delts: ['shoulders'],
  lats: ['back'],
  pecs: ['chest'],
  quads: ['quad'],
  hams: ['hamstrings'],
  glute: ['glutes'],
  traps: ['shrug'],
  cardio: ['run', 'bike', 'row'],
  jog: ['run'],
  bike: ['cycling'],
  cycle: ['cycling'],
  spin: ['cycling'],
  skipping: ['jump', 'rope'],
  yoga: ['flexibility', 'stretch'],
  stretch: ['flexibility'],
  hiit: ['interval'],
};

function scoreExercise(exercise: Exercise, query: string, groups: string[][]): number {
  const name = normalise(exercise.name);
  const extra = normalise(
    [
      ...exercise.tags,
      ...exercise.muscles,
      ...exercise.muscles.map((m) => MUSCLE_LABEL[m]),
      exercise.equipment,
      exercise.kind,
    ].join(' '),
  );

  const base = scoreEntity({ name, extra }, query, groups);
  if (base === 0) return 0;

  // What this person actually trains floats up; the shipped catalog outranks
  // a half-finished custom entry at equal usage.
  let score = base + Math.min(exercise.useCount, 25) * 6;
  if (exercise.source === 'seed') score += 8;
  return score;
}

export interface ExerciseFilter {
  muscle?: MuscleGroup;
  equipment?: Equipment;
  kind?: Exercise['kind'];
}

export function filterExercises(exercises: Exercise[], filter: ExerciseFilter): Exercise[] {
  return exercises.filter((e) => {
    if (filter.muscle && !e.muscles.includes(filter.muscle)) return false;
    if (filter.equipment && e.equipment !== filter.equipment) return false;
    if (filter.kind && e.kind !== filter.kind) return false;
    return true;
  });
}

export function searchExercises(
  exercises: Exercise[],
  rawQuery: string,
  filter: ExerciseFilter = {},
  limit = 60,
): Exercise[] {
  const pool = filterExercises(exercises, filter);
  const query = normalise(rawQuery);

  // An empty query with a filter applied is a browse, not a search — show the
  // filtered catalog rather than nothing.
  if (!query) {
    return [...pool]
      .sort((a, b) => b.useCount - a.useCount || a.name.localeCompare(b.name))
      .slice(0, limit);
  }

  const groups = expand(query.split(' ').filter(Boolean), SYNONYMS);
  return pool
    .map((exercise) => ({ exercise, score: scoreExercise(exercise, query, groups) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.exercise);
}

/** Recently and often trained, topped up with a curated starter set. */
export function frequentExercises(
  exercises: Exercise[],
  starterIds: string[],
  limit = 24,
): Exercise[] {
  return frequentByUse(exercises, starterIds, limit);
}
