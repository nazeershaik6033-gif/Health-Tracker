import Dexie from 'dexie';
import { db, uid } from './schema';
import { seedFoods } from '@/data/foods.seed';
import { seedExercises } from '@/data/exercises.seed';
import { today } from '@/lib/date';
import { computeTargets } from '@/lib/nutrition';
import { DEFAULT_FATSECRET } from '@/types';
import type {
  ChatMessage,
  Exercise,
  Favourite,
  Food,
  Insight,
  Meal,
  MealItem,
  MealSlot,
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

export const DEFAULT_SETTINGS: Settings = {
  id: 'app',
  provider: 'anthropic',
  apiKeys: {},
  models: {},
  fatsecret: DEFAULT_FATSECRET,
  autoTrack: false,
  theme: 'system',
  onboardingDone: false,
  backupRemindDays: 14,
  countStepKcal: true,
};

/**
 * Fills in fields added after a row was written. Settings rows persist across
 * upgrades, so a stored row from before FatSecret existed has no `fatsecret`
 * key at all — reading `settings.fatsecret.enabled` off it would throw on
 * every screen that checks whether the food database is configured.
 */
function withDefaults(stored: Settings): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    apiKeys: stored.apiKeys ?? {},
    models: stored.models ?? {},
    fatsecret: { ...DEFAULT_FATSECRET, ...(stored.fatsecret ?? {}) },
  };
}

/**
 * Seeds the food table on first run and back-fills on upgrade. Existing rows
 * are left alone so a user's edits and useCounts survive; only genuinely new
 * seed rows are added.
 *
 * Writes use `put`, not `add`, because this can legitimately run twice
 * concurrently — React StrictMode double-invokes the init effect in dev, and
 * two tabs can open at once. With `add`, both callers compute the same
 * "missing" list and the loser throws a BulkError, which previously left the
 * app stuck on its loading skeleton. `put` is idempotent, so the race is
 * harmless; the rows involved are freshly generated seeds either way, so
 * there is no user data to clobber.
 */
export async function ensureSeeded(): Promise<void> {
  const seeds = seedFoods();
  const ids = seeds.map((s) => s.id);
  const existing = await db.foods.bulkGet(ids);
  const missing = seeds.filter((_, i) => !existing[i]);
  if (missing.length) await db.foods.bulkPut(missing);

  // Same shape for exercises. Only the rows that aren't already there are
  // written, so a user's `useCount` on a seeded exercise survives every
  // subsequent launch and every catalog addition.
  const exSeeds = seedExercises();
  const exExisting = await db.exercises.bulkGet(exSeeds.map((e) => e.id));
  const exMissing = exSeeds.filter((_, i) => !exExisting[i]);
  if (exMissing.length) await db.exercises.bulkPut(exMissing);

  if (!(await db.settings.get('app'))) {
    await db.settings.put(DEFAULT_SETTINGS);
  }
}

/* -------------------------------- settings ------------------------------- */

export async function getSettings(): Promise<Settings> {
  const stored = await db.settings.get('app');
  return stored ? withDefaults(stored) : DEFAULT_SETTINGS;
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const current = await getSettings();
  await db.settings.put({ ...current, ...patch, id: 'app' });
}

/* -------------------------------- profile -------------------------------- */

export async function getProfile(): Promise<Profile | undefined> {
  return db.profile.get('me');
}

export async function saveProfile(patch: Partial<Profile>): Promise<Profile> {
  const current = await getProfile();
  const next: Profile = {
    id: 'me',
    name: '',
    sex: 'other',
    birthYear: new Date().getFullYear() - 30,
    heightCm: 170,
    startWeightKg: 70,
    goal: 'maintain',
    activity: 'light',
    targets: { kcal: 2000, protein: 100, fat: 67, carbs: 250, fibre: 28 },
    targetsManual: false,
    units: 'metric',
    waterGoalGlasses: 9,
    sleepGoalMin: 480,
    stepGoal: 8000,
    workoutKcalGoal: 300,
    createdAt: Date.now(),
    ...current,
    ...patch,
  };

  // Recompute targets whenever an input changes, unless the user pinned them.
  if (!next.targetsManual) {
    const latest = await getLatestWeight();
    next.targets = computeTargets({
      sex: next.sex,
      birthYear: next.birthYear,
      heightCm: next.heightCm,
      weightKg: latest?.kg ?? next.startWeightKg,
      goal: next.goal,
      activity: next.activity,
    });
  }

  await db.profile.put(next);
  return next;
}

/* --------------------------------- foods --------------------------------- */

export async function getFood(id: string): Promise<Food | undefined> {
  return db.foods.get(id);
}

export async function findFoodByBarcode(barcode: string): Promise<Food | undefined> {
  return db.foods.where('barcode').equals(barcode).first();
}

export async function upsertFood(food: Omit<Food, 'createdAt' | 'useCount'> & Partial<Food>): Promise<Food> {
  const existing = await db.foods.get(food.id);
  const next: Food = {
    useCount: 0,
    createdAt: Date.now(),
    ...existing,
    ...food,
  } as Food;
  await db.foods.put(next);
  return next;
}

export async function createFood(input: Omit<Food, 'id' | 'createdAt' | 'useCount'>): Promise<Food> {
  const food: Food = { ...input, id: uid('food_'), useCount: 0, createdAt: Date.now() };
  await db.foods.add(food);
  return food;
}

/** Bumps recency/frequency so the Frequently Tracked list reflects real use. */
export async function markFoodsUsed(ids: string[]): Promise<void> {
  const now = Date.now();
  await db.transaction('rw', db.foods, async () => {
    for (const id of ids) {
      const f = await db.foods.get(id);
      if (f) await db.foods.put({ ...f, useCount: f.useCount + 1, lastUsedAt: now });
    }
  });
}

export async function allFoods(): Promise<Food[]> {
  return db.foods.toArray();
}

/* --------------------------------- meals --------------------------------- */

export async function mealsForDate(date: string): Promise<Meal[]> {
  return db.meals.where('date').equals(date).toArray();
}

export async function mealsForRange(from: string, to: string): Promise<Meal[]> {
  return db.meals.where('date').between(from, to, true, true).toArray();
}

export async function addMealItems(
  date: string,
  slot: MealSlot,
  items: MealItem[],
  extra: Partial<Meal> = {},
): Promise<Meal> {
  // One meal row per (date, slot); repeated logs append to it rather than
  // creating duplicates, which keeps the Diet screen grouped the way the
  // reference app groups it.
  const existing = await db.meals.where('[date+slot]').equals([date, slot]).first();
  const meal: Meal = existing
    ? { ...existing, ...extra, items: [...existing.items, ...items] }
    : {
        id: uid('meal_'),
        date,
        slot,
        items,
        createdAt: Date.now(),
        ...extra,
      };
  await db.meals.put(meal);
  await markFoodsUsed(items.map((i) => i.foodId).filter((x): x is string => Boolean(x)));
  return meal;
}

export async function updateMeal(id: string, patch: Partial<Meal>): Promise<void> {
  const meal = await db.meals.get(id);
  if (!meal) return;
  const next = { ...meal, ...patch };
  // An emptied meal is deleted rather than left as a stray heading — and its
  // snap has to be released with it, or the gallery keeps a "Logged" badge
  // pointing at a meal that is gone.
  if (next.items.length === 0) {
    await db.meals.delete(id);
    await detachSnap(meal);
  } else {
    await db.meals.put(next);
  }
}

export async function removeMealItem(mealId: string, index: number): Promise<void> {
  const meal = await db.meals.get(mealId);
  if (!meal) return;
  const items = meal.items.filter((_, i) => i !== index);
  await updateMeal(mealId, { items });
}

/**
 * Replaces one logged item in place — the "I ate two rotis, not one" fix.
 * Editing rather than delete-and-re-add keeps the item's position in the meal
 * and any AI score attached to it.
 */
export async function replaceMealItem(
  mealId: string,
  index: number,
  item: MealItem,
): Promise<void> {
  const meal = await db.meals.get(mealId);
  if (!meal || !meal.items[index]) return;
  const items = meal.items.map((existing, i) =>
    i === index ? { ...item, score: existing.score, note: existing.note } : existing,
  );
  await updateMeal(mealId, { items });
}

/** Where moved items ended up, so the move can be undone exactly. */
export interface MoveResult {
  /** The meal the items now live in. */
  mealId: string;
  /** Their positions in that meal. */
  indices: number[];
  /** The slot they came from. */
  from: MealSlot;
}

/**
 * Moves logged items from one meal slot to another on the same day.
 *
 * Putting food under the wrong heading is the easiest logging mistake to make —
 * a late dinner entered as an evening snack, a whole breakfast logged while the
 * screen still said Lunch. Until now the only repair was to delete each row and
 * re-enter it, portion and all.
 *
 * Items are appended to whatever is already in the target slot, because the app
 * keeps one meal row per (date, slot) and the Diet screen groups on that.
 */
export async function moveMealItems(
  mealId: string,
  indices: number[],
  targetSlot: MealSlot,
): Promise<MoveResult | undefined> {
  return db.transaction('rw', db.meals, db.snaps, async () => {
    const meal = await db.meals.get(mealId);
    if (!meal || meal.slot === targetSlot) return undefined;

    const picked = [...new Set(indices)].sort((a, b) => a - b).filter((i) => meal.items[i]);
    if (picked.length === 0) return undefined;

    const taken = new Set(picked);
    const moving = picked.map((i) => meal.items[i]);
    const remaining = meal.items.filter((_, i) => !taken.has(i));
    const target = await db.meals.where('[date+slot]').equals([meal.date, targetSlot]).first();

    // Everything moved and there is nothing to merge with: the meal row itself
    // changes slot. Its photo and AI score survive, because they still describe
    // exactly these items — only the heading was wrong.
    if (remaining.length === 0 && !target) {
      await db.meals.put({ ...meal, slot: targetSlot });
      return { mealId: meal.id, indices: meal.items.map((_, i) => i), from: meal.slot };
    }

    // Any other shape changes what a meal contains, so a score written for the
    // old contents no longer describes either side and is dropped rather than
    // left over-claiming.
    const landedAt = target ? target.items.length : 0;
    const next: Meal = target
      ? { ...target, items: [...target.items, ...moving], healthScore: undefined, aiNote: undefined }
      : {
          id: uid('meal_'),
          date: meal.date,
          slot: targetSlot,
          items: moving,
          createdAt: Date.now(),
        };
    await db.meals.put(next);

    if (remaining.length > 0) {
      await db.meals.put({ ...meal, items: remaining, healthScore: undefined, aiNote: undefined });
    } else {
      await db.meals.delete(meal.id);
      await detachSnap(meal);
    }

    return { mealId: next.id, indices: moving.map((_, i) => landedAt + i), from: meal.slot };
  });
}

/* ------------------------------ favourites ------------------------------- */

/**
 * The pinned list for one slot, in the user's own order.
 *
 * Reads the `[slot+order]` index directly, so this stays one bounded scan
 * rather than a whole-table read plus a sort — the pinned list renders on
 * every visit to the food search.
 */
export async function favouritesForSlot(slot: MealSlot): Promise<Favourite[]> {
  return db.favourites
    .where('[slot+order]')
    .between([slot, Dexie.minKey], [slot, Dexie.maxKey])
    .toArray();
}

export async function allFavourites(): Promise<Favourite[]> {
  return db.favourites.toArray();
}

/**
 * Pins a portion to a slot. New entries go to the end of the list rather than
 * the top: the order is the user's to arrange, so nothing already placed moves
 * because something new was added.
 */
export async function addFavourite(
  input: Omit<Favourite, 'id' | 'order' | 'useCount' | 'createdAt'>,
): Promise<Favourite> {
  const siblings = await favouritesForSlot(input.slot);
  const order = siblings.reduce((max, f) => Math.max(max, f.order), -1) + 1;
  const favourite: Favourite = {
    ...input,
    id: uid('fav_'),
    order,
    useCount: 0,
    createdAt: Date.now(),
  };
  await db.favourites.add(favourite);
  return favourite;
}

export async function updateFavourite(id: string, patch: Partial<Favourite>): Promise<void> {
  const existing = await db.favourites.get(id);
  if (!existing) return;
  const next = { ...existing, ...patch };
  // A favourite with nothing in it has no meaning; drop it rather than leaving
  // an empty row that logs nothing when tapped.
  if (next.items.length === 0) await db.favourites.delete(id);
  else await db.favourites.put(next);
}

export async function removeFavourite(id: string): Promise<void> {
  await db.favourites.delete(id);
}

/**
 * Writes a new manual order for one slot. `orderedIds` is the full list as the
 * user arranged it; positions are rewritten from scratch so repeated drags
 * can't drift into ties.
 */
export async function reorderFavourites(orderedIds: string[]): Promise<void> {
  await db.transaction('rw', db.favourites, async () => {
    for (const [index, id] of orderedIds.entries()) {
      const existing = await db.favourites.get(id);
      if (existing) await db.favourites.put({ ...existing, order: index });
    }
  });
}

/**
 * Logs a favourite into a day at its saved quantity, and counts the use.
 *
 * The stored items are copied, not referenced: editing the favourite later
 * must not rewrite meals already logged from it.
 */
export async function logFavourite(
  date: string,
  favourite: Favourite,
  slotOverride?: MealSlot,
): Promise<Meal> {
  const meal = await addMealItems(
    date,
    slotOverride ?? favourite.slot,
    favourite.items.map((item) => ({ ...item, nutrients: { ...item.nutrients } })),
  );
  await db.favourites.put({
    ...favourite,
    useCount: favourite.useCount + 1,
    lastUsedAt: Date.now(),
  });
  return meal;
}

/** Display name: the explicit label, or the single item's name. */
export function favouriteLabel(favourite: Favourite): string {
  if (favourite.label?.trim()) return favourite.label.trim();
  if (favourite.items.length === 1) return favourite.items[0].name;
  return `${favourite.items.length} items`;
}

/**
 * Which days in a range have anything logged, and how many calories each.
 * One pass per table rather than a query per day: a month view would otherwise
 * fire ~180 reads on every month change.
 */
export interface DaySummary {
  date: string;
  kcal: number;
  /**
   * Macros for the day, summed the same way `kcal` is.
   *
   * Carried here so the month view can describe a day by more than its calorie
   * count — 1900 kcal that hit its protein and 1900 kcal that did not are the
   * same number and not the same day.
   */
  protein: number;
  fat: number;
  carbs: number;
  fibre: number;
  meals: number;
  water: boolean;
  sleep: boolean;
  weight: boolean;
  workouts: boolean;
  steps: boolean;
}

export async function summariseRange(from: string, to: string): Promise<Map<string, DaySummary>> {
  const [meals, water, sleep, weight, steps, workouts] = await Promise.all([
    db.meals.where('date').between(from, to, true, true).toArray(),
    db.water.where('date').between(from, to, true, true).toArray(),
    db.sleep.where('date').between(from, to, true, true).toArray(),
    db.weight.where('date').between(from, to, true, true).toArray(),
    db.steps.where('date').between(from, to, true, true).toArray(),
    db.workouts.where('date').between(from, to, true, true).toArray(),
  ]);

  const map = new Map<string, DaySummary>();
  const at = (date: string): DaySummary => {
    let row = map.get(date);
    if (!row) {
      row = {
        date,
        kcal: 0,
        protein: 0,
        fat: 0,
        carbs: 0,
        fibre: 0,
        meals: 0,
        water: false,
        sleep: false,
        weight: false,
        workouts: false,
        steps: false,
      };
      map.set(date, row);
    }
    return row;
  };

  for (const meal of meals) {
    const row = at(meal.date);
    row.meals += 1;
    for (const item of meal.items) {
      row.kcal += item.nutrients.kcal;
      row.protein += item.nutrients.protein;
      row.fat += item.nutrients.fat;
      row.carbs += item.nutrients.carbs;
      row.fibre += item.nutrients.fibre;
    }
  }
  // A zero-glass row is a goal that was set, not water that was drunk.
  for (const w of water) if (w.glasses > 0) at(w.date).water = true;
  for (const s of sleep) if (s.durationMin > 0) at(s.date).sleep = true;
  for (const w of weight) at(w.date).weight = true;
  for (const s of steps) if (s.count > 0) at(s.date).steps = true;
  for (const w of workouts) at(w.date).workouts = true;

  for (const row of map.values()) {
    row.kcal = Math.round(row.kcal);
    row.protein = Math.round(row.protein);
    row.fat = Math.round(row.fat);
    row.carbs = Math.round(row.carbs);
    row.fibre = Math.round(row.fibre);
  }
  return map;
}

/**
 * Deletes a meal and repairs the snap that produced it, if any.
 *
 * The photo is kept: it is a record of what was eaten and the user may want to
 * re-log it. But the snap must stop claiming it is logged, or the gallery
 * shows a "Logged" badge pointing at a meal that no longer exists.
 */
export async function deleteMeal(id: string): Promise<void> {
  const meal = await db.meals.get(id);
  await db.meals.delete(id);
  await detachSnap(meal);
}

/**
 * Releases the snap a meal was logged from, once that meal no longer exists.
 * Shared by every path that removes one, so a photo can never be left pointing
 * at a missing meal.
 */
async function detachSnap(meal: Meal | undefined): Promise<void> {
  if (!meal?.snapId) return;
  const snap = await db.snaps.get(meal.snapId);
  if (snap?.mealId === meal.id) {
    await db.snaps.put({ ...snap, mealId: undefined, status: 'ready', autoTracked: false });
  }
}

/* --------------------------------- snaps --------------------------------- */

/**
 * Writes the metadata row and the full image together.
 *
 * Both halves land in one transaction, so a snap can never exist as a row
 * pointing at an image that was never stored.
 */
export async function addSnap(
  snap: Omit<Snap, 'id' | 'createdAt'>,
  blob: Blob,
): Promise<Snap> {
  const next: Snap = { ...snap, id: uid('snap_'), createdAt: Date.now() };
  await db.transaction('rw', db.snaps, db.snapImages, async () => {
    await db.snaps.add(next);
    await db.snapImages.put({ id: next.id, blob });
  });
  return next;
}

export async function updateSnap(id: string, patch: Partial<Snap>): Promise<void> {
  const snap = await db.snaps.get(id);
  if (snap) await db.snaps.put({ ...snap, ...patch });
}

export async function getSnap(id: string): Promise<Snap | undefined> {
  return db.snaps.get(id);
}

/**
 * The full-resolution capture. Fetched only by the two callers that genuinely
 * need it — the detail preview and the vision request — never by a listing.
 */
export async function getSnapImage(id: string): Promise<Blob | undefined> {
  return (await db.snapImages.get(id))?.blob;
}

/**
 * Deletes a snap, and by default the meal it was logged as.
 *
 * Deleting the photo used to leave the calories behind, so a meal you thought
 * you had removed still counted against the day with nothing left on screen
 * pointing at it. The photo and the log entry are one act to the user, so they
 * are removed together unless the caller says otherwise.
 */
export async function deleteSnap(id: string, keepMeal = false): Promise<void> {
  const snap = await db.snaps.get(id);
  await db.transaction('rw', db.snaps, db.snapImages, async () => {
    await db.snaps.delete(id);
    await db.snapImages.delete(id);
  });
  if (keepMeal || !snap?.mealId) return;
  // Delete directly: deleteMeal would try to repair a snap that is now gone.
  await db.meals.delete(snap.mealId);
}

export async function recentSnaps(limit = 60): Promise<Snap[]> {
  return db.snaps.orderBy('createdAt').reverse().limit(limit).toArray();
}

/* -------------------------------- trackers ------------------------------- */

export async function getWater(date: string, goalGlasses: number): Promise<WaterEntry> {
  return (
    (await db.water.get(date)) ?? {
      date,
      glasses: 0,
      goalGlasses,
      glassMl: 250,
      updatedAt: Date.now(),
    }
  );
}

export async function setWater(date: string, patch: Partial<WaterEntry>, goalGlasses: number): Promise<void> {
  const current = await getWater(date, goalGlasses);
  await db.water.put({ ...current, ...patch, date, updatedAt: Date.now() });
}

export async function getSleep(date: string): Promise<SleepEntry | undefined> {
  return db.sleep.get(date);
}

export async function setSleep(entry: Omit<SleepEntry, 'updatedAt'>): Promise<void> {
  await db.sleep.put({ ...entry, updatedAt: Date.now() });
}

export async function getWeight(date: string): Promise<WeightEntry | undefined> {
  return db.weight.get(date);
}

export async function setWeight(date: string, kg: number, note?: string): Promise<void> {
  await db.weight.put({ date, kg, note, updatedAt: Date.now() });
  // Targets are weight-derived, so a new weigh-in refreshes them.
  const profile = await getProfile();
  if (profile && !profile.targetsManual) await saveProfile({});
}

export async function getLatestWeight(): Promise<WeightEntry | undefined> {
  return db.weight.orderBy('date').reverse().first();
}

export async function weightSeries(from: string, to: string): Promise<WeightEntry[]> {
  return db.weight.where('date').between(from, to, true, true).sortBy('date');
}

export async function getSteps(date: string, goal: number): Promise<StepsEntry> {
  return (
    (await db.steps.get(date)) ?? { date, count: 0, goal, source: 'manual', updatedAt: Date.now() }
  );
}

export async function setSteps(date: string, count: number, goal: number): Promise<void> {
  await db.steps.put({ date, count, goal, source: 'manual', updatedAt: Date.now() });
}

export async function workoutsForDate(date: string): Promise<WorkoutEntry[]> {
  return db.workouts.where('date').equals(date).toArray();
}

export async function workoutsForRange(from: string, to: string): Promise<WorkoutEntry[]> {
  return db.workouts.where('date').between(from, to, true, true).toArray();
}

export async function addWorkout(entry: Omit<WorkoutEntry, 'id' | 'createdAt'>): Promise<WorkoutEntry> {
  const next: WorkoutEntry = { ...entry, id: uid('wk_'), createdAt: Date.now() };
  await db.workouts.add(next);
  return next;
}

export async function deleteWorkout(id: string): Promise<void> {
  await db.workouts.delete(id);
}

/** Editing a session in place — adding, changing or removing an exercise. */
export async function updateWorkout(
  id: string,
  patch: Partial<Omit<WorkoutEntry, 'id' | 'createdAt'>>,
): Promise<void> {
  await db.workouts.update(id, patch);
}

/* ------------------------------- exercises ------------------------------- */

export async function allExercises(): Promise<Exercise[]> {
  return db.exercises.toArray();
}

export async function getExercise(id: string): Promise<Exercise | undefined> {
  return db.exercises.get(id);
}

export async function createExercise(
  draft: Omit<Exercise, 'id' | 'useCount'> & { id?: string },
): Promise<Exercise> {
  const next: Exercise = { useCount: 0, ...draft, id: draft.id ?? uid('ex_') };
  await db.exercises.put(next);
  return next;
}

export async function updateExercise(id: string, patch: Partial<Exercise>): Promise<void> {
  await db.exercises.update(id, patch);
}

export async function deleteExercise(id: string): Promise<void> {
  await db.exercises.delete(id);
}

/**
 * Bumps usage so the picker can lead with what this person actually trains.
 * Mirrors `markFoodsUsed`.
 */
export async function markExercisesUsed(ids: string[]): Promise<void> {
  const now = Date.now();
  await Promise.all(
    [...new Set(ids)].map(async (id) => {
      const row = await db.exercises.get(id);
      if (!row) return;
      await db.exercises.update(id, { useCount: row.useCount + 1, lastUsedAt: now });
    }),
  );
}

/* ---------------------------------- chat --------------------------------- */

export async function chatHistory(limit = 100): Promise<ChatMessage[]> {
  const rows = await db.chats.orderBy('createdAt').reverse().limit(limit).toArray();
  return rows.reverse();
}

export async function addChat(msg: Omit<ChatMessage, 'id'>): Promise<ChatMessage> {
  const next: ChatMessage = { ...msg, id: uid('msg_') };
  await db.chats.add(next);
  return next;
}

export async function updateChat(id: string, patch: Partial<ChatMessage>): Promise<void> {
  const msg = await db.chats.get(id);
  if (msg) await db.chats.put({ ...msg, ...patch });
}

export async function clearChat(): Promise<void> {
  await db.chats.clear();
}

/* -------------------------------- insights ------------------------------- */

export async function insightForDate(date: string): Promise<Insight | undefined> {
  return db.insights.where('date').equals(date).first();
}

export async function saveInsight(insight: Omit<Insight, 'id'> & { id?: string }): Promise<Insight> {
  const next: Insight = { ...insight, id: insight.id ?? uid('ins_') };
  await db.insights.put(next);
  return next;
}

/* --------------------------------- plans --------------------------------- */

export async function latestPlan(kind: 'diet' | 'workout'): Promise<Plan | undefined> {
  const rows = await db.plans.where('kind').equals(kind).reverse().sortBy('createdAt');
  return rows[0];
}

export async function savePlan(plan: Omit<Plan, 'id' | 'createdAt'>): Promise<Plan> {
  const next: Plan = { ...plan, id: uid('plan_'), createdAt: Date.now() };
  await db.plans.add(next);
  return next;
}

/* ------------------------------- aggregate ------------------------------- */

/** Everything the Home screen and the AI context builder need for one day. */
export async function dayBundle(date: string, profile: Profile | undefined) {
  const [meals, water, sleep, weight, steps, workouts] = await Promise.all([
    mealsForDate(date),
    getWater(date, profile?.waterGoalGlasses ?? 9),
    getSleep(date),
    getWeight(date),
    getSteps(date, profile?.stepGoal ?? 8000),
    workoutsForDate(date),
  ]);
  return { date, meals, water, sleep, weight, steps, workouts };
}

export type DayBundle = Awaited<ReturnType<typeof dayBundle>>;

/** Resets user data but keeps provider settings — used by Settings → Reset. */
export async function clearAllData(): Promise<void> {
  await db.transaction(
    'rw',
    [db.profile, db.meals, db.snaps, db.snapImages, db.favourites, db.water, db.sleep, db.weight, db.steps, db.workouts, db.chats, db.insights, db.plans, db.foods, db.exercises],
    async () => {
      await Promise.all([
        db.profile.clear(),
        db.meals.clear(),
        db.snaps.clear(),
        db.snapImages.clear(),
        db.favourites.clear(),
        db.water.clear(),
        db.sleep.clear(),
        db.weight.clear(),
        db.steps.clear(),
        db.workouts.clear(),
        db.chats.clear(),
        db.insights.clear(),
        db.plans.clear(),
        // Only user-created foods go; the seed list is re-added below.
        db.foods.where('source').notEqual('seed').delete(),
        // Same for exercises: custom ones are the user's, the shipped catalog
        // is the app's and `ensureSeeded()` restores it below.
        db.exercises.where('source').notEqual('seed').delete(),
      ]);
    },
  );
  await saveSettings({ onboardingDone: false });
  await ensureSeeded();
}

export { today };

/* ------------------------------------------------------------------------ */
/* Apple Health import                                                       */
/* ------------------------------------------------------------------------ */

export type HealthMergeMode = 'fill' | 'overwrite';

export interface HealthApplyResult {
  written: number;
  skipped: number;
}

/**
 * Writes parsed Apple Health aggregates into the trackers.
 *
 * `fill` only touches days that have nothing recorded, so an import can never
 * overwrite something typed by hand — the safe default, and the one that makes
 * re-running an import idempotent. `overwrite` replaces the day outright, for
 * when the export is the better record.
 *
 * Workouts are matched on date, type and duration rather than a day key: a day
 * legitimately holds several, so "does this day have workouts" is the wrong
 * question and would drop all but the first.
 */
export async function applyHealthImport(
  data: {
    steps: Map<string, number>;
    weight: Map<string, number>;
    water: Map<string, number>;
    sleep: Map<string, { bedtime: string; wake: string; durationMin: number }>;
    workouts: { date: string; type: string; durationMin: number; kcal: number }[];
  },
  metrics: Set<'steps' | 'weight' | 'sleep' | 'water' | 'workouts'>,
  mode: HealthMergeMode,
): Promise<HealthApplyResult> {
  const profile = await getProfile();
  const stepGoal = profile?.stepGoal ?? 8000;
  const waterGoal = profile?.waterGoalGlasses ?? 8;
  let written = 0;
  let skipped = 0;

  if (metrics.has('steps')) {
    for (const [date, count] of data.steps) {
      const existing = await db.steps.get(date);
      if (existing && existing.count > 0 && mode === 'fill') {
        skipped++;
        continue;
      }
      await db.steps.put({
        date,
        count: Math.round(count),
        goal: existing?.goal ?? stepGoal,
        source: 'sensor',
        updatedAt: Date.now(),
      });
      written++;
    }
  }

  if (metrics.has('weight')) {
    for (const [date, kg] of data.weight) {
      const existing = await db.weight.get(date);
      if (existing && mode === 'fill') {
        skipped++;
        continue;
      }
      await db.weight.put({ date, kg, note: 'Apple Health', updatedAt: Date.now() });
      written++;
    }
  }

  if (metrics.has('sleep')) {
    for (const [date, s] of data.sleep) {
      const existing = await db.sleep.get(date);
      if (existing && mode === 'fill') {
        skipped++;
        continue;
      }
      await db.sleep.put({ date, ...s, updatedAt: Date.now() });
      written++;
    }
  }

  if (metrics.has('water')) {
    for (const [date, ml] of data.water) {
      const existing = await db.water.get(date);
      if (existing && existing.glasses > 0 && mode === 'fill') {
        skipped++;
        continue;
      }
      const glassMl = existing?.glassMl ?? 250;
      await db.water.put({
        date,
        glasses: Math.round(ml / glassMl),
        goalGlasses: existing?.goalGlasses ?? waterGoal,
        glassMl,
        updatedAt: Date.now(),
      });
      written++;
    }
  }

  if (metrics.has('workouts')) {
    for (const w of data.workouts) {
      const sameDay = await db.workouts.where('date').equals(w.date).toArray();
      const duplicate = sameDay.some(
        (e) => e.type === w.type && Math.abs(e.durationMin - w.durationMin) <= 1,
      );
      if (duplicate) {
        skipped++;
        continue;
      }
      await db.workouts.add({
        id: uid('wk_'),
        date: w.date,
        type: w.type,
        durationMin: w.durationMin,
        kcal: w.kcal,
        intensity: w.kcal / Math.max(w.durationMin, 1) > 9 ? 'vigorous' : w.kcal / Math.max(w.durationMin, 1) > 5 ? 'moderate' : 'light',
        note: 'Imported from Apple Health',
        createdAt: Date.now(),
      });
      written++;
    }
  }

  // Targets are weight-derived; a bulk weight import should refresh them.
  if (metrics.has('weight') && data.weight.size && profile && !profile.targetsManual) {
    await saveProfile({});
  }

  return { written, skipped };
}
