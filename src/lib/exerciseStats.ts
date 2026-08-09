import { estimate1RM, setVolumeKg } from './nutrition';
import type { LoggedExercise, WorkoutEntry } from '@/types';

/**
 * Personal records and per-exercise history, derived from the workout log
 * rather than stored.
 *
 * Deriving costs one pass over a few hundred rows and removes a whole class of
 * bug: a stored PR would drift the moment a set was edited or a session
 * deleted, and would need back-filling for anyone upgrading.
 */

export interface ExerciseRecord {
  exerciseId: string;
  name: string;
  /** Heaviest single set, whatever the reps. */
  bestWeightKg: number;
  /** Reps achieved at that heaviest weight. */
  bestWeightReps: number;
  /** Best Epley-estimated one-rep max across all sets. */
  best1RM: number;
  /** Most reps in a single set, for bodyweight work. */
  bestReps: number;
  /** Highest sets×reps×weight in one session. */
  bestSessionVolumeKg: number;
  /** Longest single bout, for cardio. */
  bestDurationMin: number;
  sessions: number;
  lastDate?: string;
}

/** Every logged instance of one exercise, newest first. */
export interface ExerciseHistoryPoint {
  date: string;
  volumeKg: number;
  topWeightKg: number;
  reps: number;
  durationMin: number;
  kcal: number;
  sets: number;
}

function* loggedExercises(
  workouts: WorkoutEntry[],
): Generator<{ workout: WorkoutEntry; exercise: LoggedExercise }> {
  for (const workout of workouts) {
    for (const exercise of workout.exercises ?? []) {
      yield { workout, exercise };
    }
  }
}

export function recordsByExercise(workouts: WorkoutEntry[]): Map<string, ExerciseRecord> {
  const out = new Map<string, ExerciseRecord>();

  for (const { workout, exercise } of loggedExercises(workouts)) {
    const rec: ExerciseRecord = out.get(exercise.exerciseId) ?? {
      exerciseId: exercise.exerciseId,
      name: exercise.name,
      bestWeightKg: 0,
      bestWeightReps: 0,
      best1RM: 0,
      bestReps: 0,
      bestSessionVolumeKg: 0,
      bestDurationMin: 0,
      sessions: 0,
      lastDate: undefined,
    };

    rec.sessions += 1;
    if (!rec.lastDate || workout.date > rec.lastDate) rec.lastDate = workout.date;

    const sets = exercise.sets ?? [];
    for (const set of sets) {
      const weight = set.weightKg ?? 0;
      if (weight > rec.bestWeightKg) {
        rec.bestWeightKg = weight;
        rec.bestWeightReps = set.reps;
      } else if (weight === rec.bestWeightKg && set.reps > rec.bestWeightReps) {
        rec.bestWeightReps = set.reps;
      }
      rec.best1RM = Math.max(rec.best1RM, estimate1RM(weight, set.reps));
      rec.bestReps = Math.max(rec.bestReps, set.reps);
    }

    rec.bestSessionVolumeKg = Math.max(rec.bestSessionVolumeKg, setVolumeKg(sets));
    // Only a timed exercise has a meaningful "longest bout". Strength entries
    // carry a derived duration too, and surfacing that as a record would be
    // reporting an estimate as an achievement.
    if (!sets.length) {
      rec.bestDurationMin = Math.max(rec.bestDurationMin, exercise.durationMin ?? 0);
    }

    out.set(exercise.exerciseId, rec);
  }

  return out;
}

export function historyFor(workouts: WorkoutEntry[], exerciseId: string): ExerciseHistoryPoint[] {
  const points: ExerciseHistoryPoint[] = [];

  for (const { workout, exercise } of loggedExercises(workouts)) {
    if (exercise.exerciseId !== exerciseId) continue;
    const sets = exercise.sets ?? [];
    points.push({
      date: workout.date,
      volumeKg: setVolumeKg(sets),
      topWeightKg: sets.reduce((m, s) => Math.max(m, s.weightKg ?? 0), 0),
      reps: sets.reduce((total, s) => total + s.reps, 0),
      durationMin: exercise.durationMin ?? 0,
      kcal: exercise.kcal,
      sets: sets.length,
    });
  }

  return points.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Which records a set would beat, checked *before* it is saved so the UI can
 * say so at the moment it happens.
 */
export interface PRHit {
  weight: boolean;
  oneRM: boolean;
  reps: boolean;
}

export function checkPR(
  record: ExerciseRecord | undefined,
  set: { reps: number; weightKg?: number },
): PRHit {
  const weight = set.weightKg ?? 0;
  if (!record) {
    // Nothing to beat yet. A first logged set with real load is worth marking;
    // a first bodyweight set is not, or every exercise would fire on day one.
    return { weight: weight > 0, oneRM: false, reps: false };
  }
  return {
    weight: weight > 0 && weight > record.bestWeightKg,
    oneRM: weight > 0 && estimate1RM(weight, set.reps) > record.best1RM,
    reps: weight === 0 && set.reps > record.bestReps,
  };
}

export function hasPR(hit: PRHit): boolean {
  return hit.weight || hit.oneRM || hit.reps;
}

/** Session roll-ups kept on `WorkoutEntry` so every existing consumer works. */
export function summariseSession(exercises: LoggedExercise[]): {
  type: string;
  durationMin: number;
  kcal: number;
} {
  const kcal = exercises.reduce((total, e) => total + e.kcal, 0);
  const durationMin = exercises.reduce((total, e) => total + (e.durationMin ?? 0), 0);

  let type = 'Workout';
  if (exercises.length === 1) type = exercises[0].name;
  else if (exercises.length > 1) {
    const kinds = new Set(exercises.map((e) => e.kind));
    if (kinds.size === 1) {
      const only = exercises[0].kind;
      type =
        only === 'strength'
          ? 'Strength session'
          : only === 'cardio'
            ? 'Cardio session'
            : only === 'flexibility'
              ? 'Mobility session'
              : 'Sport session';
    } else {
      type = 'Mixed session';
    }
  }

  return { type, durationMin: Math.round(durationMin), kcal: Math.round(kcal) };
}
