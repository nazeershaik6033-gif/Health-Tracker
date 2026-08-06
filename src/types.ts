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

/** One selectable portion of a food, e.g. "1 katori" or "2 roti/chapati". */
export interface Serving {
  label: string;
  grams: number;
  /** Default number of this serving shown when the food is picked. */
  defaultQty?: number;
}

export type FoodSource = 'seed' | 'openfoodfacts' | 'ai' | 'custom' | 'snap';

export interface Food {
  id: string;
  name: string;
  brand?: string;
  barcode?: string;
  /** Nutrients per 100 g — the canonical basis for all maths. */
  per100g: Nutrients;
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

export interface WorkoutEntry {
  id: string;
  date: string;
  type: string;
  durationMin: number;
  kcal: number;
  intensity: WorkoutIntensity;
  note?: string;
  createdAt: number;
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

export type ProviderId = 'anthropic' | 'gemini' | 'openrouter';

export interface Settings {
  id: 'app';
  provider: ProviderId;
  apiKeys: Partial<Record<ProviderId, string>>;
  models: Partial<Record<ProviderId, string>>;
  autoTrack: boolean;
  theme: 'system' | 'light' | 'dark';
  onboardingDone: boolean;
  lastInsightDate?: string;
}
