/** Shared domain types. `date` fields are always local ISO days: YYYY-MM-DD. */

export type MealSlot = 'breakfast' | 'morning_snack' | 'lunch' | 'evening_snack' | 'dinner';

export const MEAL_SLOTS: MealSlot[] = [
  'breakfast',
  'morning_snack',
  'lunch',
  'evening_snack',
  'dinner',
];

export const MEAL_SLOT_LABEL: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  morning_snack: 'Morning Snack',
  lunch: 'Lunch',
  evening_snack: 'Evening Snack',
  dinner: 'Dinner',
};

/** Share of daily calories per slot — matches the reference app's split. */
export const MEAL_SLOT_SHARE: Record<MealSlot, number> = {
  breakfast: 0.25,
  morning_snack: 0.125,
  lunch: 0.25,
  evening_snack: 0.125,
  dinner: 0.25,
};

export interface Nutrients {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  fibre: number;
}

export const ZERO_NUTRIENTS: Nutrients = { kcal: 0, protein: 0, fat: 0, carbs: 0, fibre: 0 };

/**
 * The micronutrients tracked per day.
 *
 * Twelve rather than the full forty: these are the ones that are (a) commonly
 * short in real diets, (b) present in the food-composition tables the app
 * draws on, and (c) meaningful over a single day. Chromium and molybdenum are
 * neither commonly short nor reliably tabulated, so tracking them would be
 * inventing precision.
 */
export type MicroId =
  | 'iron'
  | 'calcium'
  | 'magnesium'
  | 'zinc'
  | 'potassium'
  | 'sodium'
  | 'vitaminA'
  | 'vitaminC'
  | 'vitaminD'
  | 'vitaminE'
  | 'vitaminB12'
  | 'folate';

/**
 * Micronutrient amounts, in each nutrient's own unit (see `MICROS`).
 *
 * Partial on purpose: a missing key means "not known for this food", which is
 * a different thing from zero, and the day view reports that gap as coverage
 * rather than quietly counting it as nothing.
 */
export type Micros = Partial<Record<MicroId, number>>;

/** One selectable portion of a food, e.g. "1 katori" or "2 roti/chapati". */
export interface Serving {
  label: string;
  grams: number;
  /** Default number of this serving shown when the food is picked. */
  defaultQty?: number;
}

export type FoodSource = 'seed' | 'openfoodfacts' | 'fatsecret' | 'ai' | 'custom' | 'snap';

export interface Food {
  id: string;
  name: string;
  brand?: string;
  barcode?: string;
  /** Nutrients per 100 g — the canonical basis for all maths. */
  per100g: Nutrients;
  /** Micronutrients per 100 g. Absent where the source carries none. */
  micros?: Micros;
  servings: Serving[];
  source: FoodSource;
  tags: string[];
  /** Bumped on every log, drives the "Frequently Tracked Foods" list. */
  useCount: number;
  lastUsedAt?: number;
  createdAt: number;
  verified?: boolean;
}

export interface MealItem {
  foodId?: string;
  name: string;
  qty: number;
  servingLabel: string;
  grams: number;
  nutrients: Nutrients;
  /** Micronutrients for this portion. Absent when the food carries none. */
  micros?: Micros;
  /** 0–10 ingredient score from the AI meal analysis. */
  score?: number;
  note?: string;
}

export interface Meal {
  id: string;
  date: string;
  slot: MealSlot;
  items: MealItem[];
  snapId?: string;
  healthScore?: number;
  aiNote?: string;
  createdAt: number;
}

export type SnapStatus = 'pending' | 'analysing' | 'ready' | 'logged' | 'failed';

export interface Snap {
  id: string;
  date: string;
  blob: Blob;
  thumb: Blob;
  width: number;
  height: number;
  status: SnapStatus;
  mealId?: string;
  autoTracked: boolean;
  /** AI result held here until the user confirms and it becomes a Meal. */
  analysis?: SnapAnalysis;
  error?: string;
  createdAt: number;
}

export interface SnapAnalysis {
  title: string;
  items: MealItem[];
  totals: Nutrients;
  healthScore: number;
  take: string;
  confidence?: 'low' | 'medium' | 'high';
}

export interface WaterEntry {
  date: string;
  glasses: number;
  goalGlasses: number;
  /** ml per glass, so the UI can show both glasses and volume. */
  glassMl: number;
  updatedAt: number;
}

export interface SleepEntry {
  date: string;
  bedtime: string;
  wake: string;
  durationMin: number;
  quality?: 1 | 2 | 3 | 4 | 5;
  note?: string;
  updatedAt: number;
}

export interface WeightEntry {
  date: string;
  kg: number;
  note?: string;
  updatedAt: number;
}

export type WorkoutIntensity = 'light' | 'moderate' | 'vigorous';

export type ExerciseKind = 'strength' | 'cardio' | 'flexibility' | 'sport';

export type Equipment =
  | 'barbell'
  | 'dumbbell'
  | 'machine'
  | 'cable'
  | 'kettlebell'
  | 'bodyweight'
  | 'band'
  | 'other';

export type MuscleGroup =
  | 'chest'
  | 'back'
  | 'shoulders'
  | 'biceps'
  | 'triceps'
  | 'quads'
  | 'hamstrings'
  | 'glutes'
  | 'calves'
  | 'core'
  | 'fullbody';

export const EQUIPMENT_LABEL: Record<Equipment, string> = {
  barbell: 'Barbell',
  dumbbell: 'Dumbbell',
  machine: 'Machine',
  cable: 'Cable',
  kettlebell: 'Kettlebell',
  bodyweight: 'Bodyweight',
  band: 'Band',
  other: 'Other',
};

export const MUSCLE_LABEL: Record<MuscleGroup, string> = {
  chest: 'Chest',
  back: 'Back',
  shoulders: 'Shoulders',
  biceps: 'Biceps',
  triceps: 'Triceps',
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  glutes: 'Glutes',
  calves: 'Calves',
  core: 'Core',
  fullbody: 'Full body',
};

/** A catalog entry. Mirrors `Food`: seeded, searchable, usage-ranked. */
export interface Exercise {
  id: string;
  name: string;
  kind: ExerciseKind;
  /** Metabolic equivalent, from the Compendium of Physical Activities. */
  met: number;
  /** Primary muscle first. */
  muscles: MuscleGroup[];
  equipment: Equipment;
  tags: string[];
  defaultSets?: number;
  defaultReps?: number;
  defaultDurationMin?: number;
  /** Planks and hangs are counted in seconds, not reps. */
  repUnit?: 'reps' | 'sec';
  source: 'seed' | 'custom' | 'ai';
  useCount: number;
  lastUsedAt?: number;
}

export interface ExerciseSet {
  /** Repetitions, or seconds when the exercise's `repUnit` is 'sec'. */
  reps: number;
  weightKg?: number;
  done?: boolean;
}

/**
 * One exercise inside a session.
 *
 * `name`, `kind` and `met` are denormalised snapshots rather than lookups, so
 * renaming or deleting a catalog entry never rewrites what you did last month.
 */
export interface LoggedExercise {
  exerciseId: string;
  name: string;
  kind: ExerciseKind;
  met: number;
  /** Strength work. Absent for cardio, flexibility and sport. */
  sets?: ExerciseSet[];
  /**
   * Minutes this took. Entered directly for cardio; derived from time under
   * tension plus rest for strength, so a session's duration and its calorie
   * estimate are always computed from the same number.
   */
  durationMin?: number;
  intensity: WorkoutIntensity;
  kcal: number;
  note?: string;
}

/**
 * A workout session.
 *
 * `type`, `durationMin` and `kcal` are roll-ups kept populated for the ten
 * places that read a workout as a single figure (day totals, streak, calendar
 * dots, AI context, export). `exercises` is absent on rows logged before
 * sessions existed, and those still render and still count.
 */
export interface WorkoutEntry {
  id: string;
  date: string;
  type: string;
  durationMin: number;
  kcal: number;
  intensity: WorkoutIntensity;
  note?: string;
  createdAt: number;
  exercises?: LoggedExercise[];
  title?: string;
}

export interface StepsEntry {
  date: string;
  count: number;
  goal: number;
  source: 'manual' | 'sensor';
  updatedAt: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  /** Set while a streaming reply is still being written. */
  streaming?: boolean;
  error?: boolean;
}

export interface Insight {
  id: string;
  date: string;
  title: string;
  body: string;
  chips: string[];
  read: boolean;
  createdAt: number;
}

export interface PlanDay {
  label: string;
  meals: { slot: MealSlot; suggestion: string; kcal: number }[];
}

export interface Plan {
  id: string;
  kind: 'diet' | 'workout';
  title: string;
  summary: string;
  days: PlanDay[];
  workouts?: { day: string; focus: string; detail: string; minutes: number }[];
  createdAt: number;
}

export type Goal = 'lose' | 'maintain' | 'gain';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type Sex = 'male' | 'female' | 'other';
export type UnitSystem = 'metric' | 'imperial';

export interface Profile {
  id: 'me';
  name: string;
  sex: Sex;
  birthYear: number;
  heightCm: number;
  startWeightKg: number;
  targetWeightKg?: number;
  goal: Goal;
  activity: ActivityLevel;
  targets: Nutrients;
  /** Set when the user overrides the computed calorie target. */
  targetsManual: boolean;
  units: UnitSystem;
  waterGoalGlasses: number;
  sleepGoalMin: number;
  stepGoal: number;
  workoutKcalGoal: number;
  createdAt: number;
}

/**
 * `system` follows the OS and resolves to light or dark; the other four are
 * explicit. Sepia is a warm light theme for reading, black is true #000 for
 * OLED screens — on those it genuinely saves power, which "dark" does not.
 */
export type ThemeId = 'system' | 'light' | 'sepia' | 'dark' | 'black';

/** Resolved themes — what actually gets painted, so never `system`. */
export type ResolvedTheme = Exclude<ThemeId, 'system'>;

export const THEMES: { id: ThemeId; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'sepia', label: 'Sepia' },
  { id: 'dark', label: 'Dark' },
  { id: 'black', label: 'Black' },
];

export type ProviderId = 'anthropic' | 'gemini' | 'openrouter';

/**
 * FatSecret Platform API credentials.
 *
 * Unlike the AI providers, FatSecret cannot be called straight from a browser:
 * their token endpoint sends no CORS headers, and credentials are pinned to
 * whitelisted IP addresses. `proxyUrl` points at a small worker that holds the
 * secret and does the token exchange — see `proxy/fatsecret-worker.js`. The
 * direct path is still attempted when no proxy is set, because a diagnosis
 * beats a silent missing feature.
 */
export interface FatSecretConfig {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  /** When set, every call goes here instead of to FatSecret directly. */
  proxyUrl: string;
  /** OAuth scopes. `basic` is all a free key gets; Premier adds `barcode`. */
  scope: string;
  /** ISO country code biasing results to local brands, e.g. "IN". */
  region: string;
}

export const DEFAULT_FATSECRET: FatSecretConfig = {
  enabled: false,
  clientId: '',
  clientSecret: '',
  proxyUrl: '',
  scope: 'basic',
  region: 'IN',
};

export interface Settings {
  id: 'app';
  provider: ProviderId;
  apiKeys: Partial<Record<ProviderId, string>>;
  models: Partial<Record<ProviderId, string>>;
  fatsecret: FatSecretConfig;
  autoTrack: boolean;
  theme: ThemeId;
  onboardingDone: boolean;
  lastInsightDate?: string;
  /** Set on every successful export, so the app can say how stale a backup is. */
  lastBackupAt?: number;
  /** Days before the overdue nudge appears. 0 disables it. */
  backupRemindDays?: number;
}
