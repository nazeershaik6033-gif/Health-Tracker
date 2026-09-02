import Dexie, { type Table } from 'dexie';
import type {
  ChatMessage,
  Exercise,
  Favourite,
  Food,
  Insight,
  Meal,
  Plan,
  Profile,
  Settings,
  SleepEntry,
  Snap,
  SnapImage,
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
  snapImages!: Table<SnapImage, string>;
  favourites!: Table<Favourite, string>;
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

    // v3 adds favourites, and moves full-resolution snap images off the `snaps`
    // row into their own table.
    //
    // The split is the point of the upgrade: IndexedDB returns whole records,
    // so every `db.snaps` listing was deserialising each full-size JPEG to draw
    // a thumbnail. Keyed by the snap's own id, so the two halves need no
    // bookkeeping to stay in step.
    this.version(3)
      .stores({
        // `[slot+order]` is what the pinned list reads: one index scan, already
        // in the user's chosen order, no sort on the main thread.
        favourites: 'id, slot, order, [slot+order], createdAt',
        snapImages: 'id',
      })
      .upgrade(async (tx) => {
        const snaps = tx.table<Snap & { blob?: Blob }, string>('snaps');
        const images = tx.table<SnapImage, string>('snapImages');

        // Read-then-write rather than an async `modify`: Dexie's modify
        // callback is synchronous, and the blobs have to land in the new table
        // before they are stripped from the old rows or they are simply lost.
        const rows = await snaps.toArray();
        const moved = rows
          .filter((row): row is Snap & { blob: Blob } => row.blob instanceof Blob)
          .map((row) => ({ id: row.id, blob: row.blob }));

        if (moved.length) await images.bulkPut(moved);
        await snaps.toCollection().modify((row) => {
          delete (row as { blob?: Blob }).blob;
        });
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
