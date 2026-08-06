import { db, uid } from './schema';
import { seedFoods } from '@/data/foods.seed';
import { today } from '@/lib/date';
import { computeTargets } from '@/lib/nutrition';
import type {
  ChatMessage,
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
  autoTrack: false,
  theme: 'system',
  onboardingDone: false,
};

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

  if (!(await db.settings.get('app'))) {
    await db.settings.put(DEFAULT_SETTINGS);
  }
}

/* -------------------------------- settings ------------------------------- */

export async function getSettings(): Promise<Settings> {
  return (await db.settings.get('app')) ?? DEFAULT_SETTINGS;
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
  // An emptied meal is deleted rather than left as a stray heading.
  if (next.items.length === 0) await db.meals.delete(id);
  else await db.meals.put(next);
}

export async function removeMealItem(mealId: string, index: number): Promise<void> {
  const meal = await db.meals.get(mealId);
  if (!meal) return;
  const items = meal.items.filter((_, i) => i !== index);
  await updateMeal(mealId, { items });
}

export async function deleteMeal(id: string): Promise<void> {
  await db.meals.delete(id);
}

/* --------------------------------- snaps --------------------------------- */

export async function addSnap(snap: Omit<Snap, 'id' | 'createdAt'>): Promise<Snap> {
  const next: Snap = { ...snap, id: uid('snap_'), createdAt: Date.now() };
  await db.snaps.add(next);
  return next;
}

export async function updateSnap(id: string, patch: Partial<Snap>): Promise<void> {
  const snap = await db.snaps.get(id);
  if (snap) await db.snaps.put({ ...snap, ...patch });
}

export async function getSnap(id: string): Promise<Snap | undefined> {
  return db.snaps.get(id);
}

export async function deleteSnap(id: string): Promise<void> {
  await db.snaps.delete(id);
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
    [db.profile, db.meals, db.snaps, db.water, db.sleep, db.weight, db.steps, db.workouts, db.chats, db.insights, db.plans, db.foods],
    async () => {
      await Promise.all([
        db.profile.clear(),
        db.meals.clear(),
        db.snaps.clear(),
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
      ]);
    },
  );
  await saveSettings({ onboardingDone: false });
  await ensureSeeded();
}

export { today };
