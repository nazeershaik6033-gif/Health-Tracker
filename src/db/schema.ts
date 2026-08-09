import Dexie, { type Table } from 'dexie';
import type {
  ChatMessage,
  Exercise,
  Food,
  Insight,
  Meal,
  Plan,
  Profile,
  Settings,
  SleepEntry,
  Snap,
  StepsEntry,
  WaterEntry,
  WeightEntry,
  WorkoutEntry,
} from '@/types';

export class HealthifyDB extends Dexie {
  profile!: Table<Profile, string>;
  settings!: Table<Settings, string>;
  foods!: Table<Food, string>;
  meals!: Table<Meal, string>;
  snaps!: Table<Snap, string>;
  water!: Table<WaterEntry, string>;
  sleep!: Table<SleepEntry, string>;
  weight!: Table<WeightEntry, string>;
  workouts!: Table<WorkoutEntry, string>;
  steps!: Table<StepsEntry, string>;
  chats!: Table<ChatMessage, string>;
  insights!: Table<Insight, string>;
  plans!: Table<Plan, string>;
  exercises!: Table<Exercise, string>;

  constructor() {
    super('healthify');
    this.version(1).stores({
      profile: 'id',
      settings: 'id',
      // `name` is indexed for prefix search; `useCount` drives Frequently Tracked.
      foods: 'id, name, barcode, source, useCount, lastUsedAt',
      meals: 'id, date, slot, [date+slot], createdAt',
      snaps: 'id, date, status, createdAt',
      // Single-row-per-day trackers are keyed by the day itself.
      water: 'date',
      sleep: 'date',
      weight: 'date',
      steps: 'date',
      workouts: 'id, date, createdAt',
      chats: 'id, createdAt',
      insights: 'id, date, createdAt',
      plans: 'id, kind, createdAt',
    });

    // v2 adds the exercise catalog. Dexie carries every v1 store forward
    // untouched, so only the new one is declared and no upgrade function is
    // needed: the new WorkoutEntry fields (`exercises`, `title`) are not
    // indexed, and IndexedDB does not care about unindexed shape changes.
    this.version(2).stores({
      exercises: 'id, name, kind, equipment, source, useCount, lastUsedAt',
    });
  }
}

export const db = new HealthifyDB();

/** Short, sortable, collision-resistant id. */
export function uid(prefix = ''): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  return `${prefix}${Date.now().toString(36)}${rand}`;
}
