import type { DayBundle } from '@/db/repo';
import type { Food, MealItem, Micros, Nutrients, PlanDay, Profile, Settings, SnapAnalysis } from '@/types';
import { MEAL_SLOT_LABEL, type MealSlot } from '@/types';
import { formatDuration } from '@/lib/date';
import { mealNutrients, roundNutrients, sumNutrients } from '@/lib/nutrition';
import { MICRO_BY_ID, formatMicro, hasMicros, microRows, dayMicros, targetsForProfile } from '@/lib/micros';
import { getAdapter } from './registry';
import {
  FOOD_GENERATION_SCHEMA,
  INSIGHT_SCHEMA,
  MEAL_ANALYSIS_SCHEMA,
  PLAN_SCHEMA,
  MICRO_KEYS,
  SESSION_SCHEMA,
  WORKOUT_PLAN_SCHEMA,
  clampScore,
  num,
  parseJSON,
} from './schema';
import {
  COACH_SYSTEM,
  INSIGHT_PROMPT,
  LABEL_PROMPT,
  SNAP_PROMPT,
  VOICE_PROMPT,
  foodGenerationPrompt,
  profileContext,
} from './prompts';
import { AIError, type ChatTurn, type ImagePart } from './types';

/* ------------------------------ shared shapes ---------------------------- */

interface RawItem {
  name?: string;
  quantity?: number;
  unit?: string;
  grams?: number;
  kcal?: number;
  protein?: number;
  fat?: number;
  carbs?: number;
  fibre?: number;
  score?: number;
}

interface RawAnalysis {
  title?: string;
  items?: RawItem[];
  healthScore?: number;
  take?: string;
  confidence?: string;
}

function toMealItem(raw: RawItem): MealItem {
  const nutrients: Nutrients = roundNutrients({
    kcal: num(raw.kcal),
    protein: num(raw.protein),
    fat: num(raw.fat),
    carbs: num(raw.carbs),
    fibre: num(raw.fibre),
  });
  const qty = num(raw.quantity, 1) || 1;
  return {
    name: (raw.name ?? 'Food').trim(),
    qty,
    servingLabel: (raw.unit ?? 'serving').trim(),
    grams: num(raw.grams, 100),
    nutrients,
    score: clampScore(raw.score),
  };
}

function toAnalysis(raw: RawAnalysis, fallbackTitle: string): SnapAnalysis {
  const items = (raw.items ?? []).map(toMealItem).filter((i) => i.nutrients.kcal > 0 || i.grams > 0);
  if (!items.length) {
    throw new AIError('No food was recognised in that image', 'bad-response');
  }
  const totals = roundNutrients(sumNutrients(items.map((i) => i.nutrients)));
  const confidence = raw.confidence;
  return {
    title: (raw.title ?? fallbackTitle).trim(),
    items,
    totals,
    healthScore: clampScore(raw.healthScore),
    take: (raw.take ?? '').trim(),
    confidence:
      confidence === 'low' || confidence === 'medium' || confidence === 'high'
        ? confidence
        : undefined,
  };
}

/**
 * One retry with an explicit repair instruction. Models occasionally emit
 * prose alongside the object; asking once for "JSON only" recovers most of
 * those without doubling latency on the happy path.
 */
async function withRepair<T>(
  run: (extra?: string) => Promise<string>,
  map: (raw: string) => T,
): Promise<T> {
  try {
    return map(await run());
  } catch (err) {
    if (err instanceof AIError && (err.kind === 'auth' || err.kind === 'no-key' || err.kind === 'refused')) {
      throw err;
    }
    return map(
      await run('\n\nReturn ONLY the JSON object. No prose, no markdown fences, no explanation.'),
    );
  }
}

/* --------------------------------- snap ---------------------------------- */

export async function analyseMealPhoto(
  settings: Settings,
  image: ImagePart,
  signal?: AbortSignal,
): Promise<SnapAnalysis> {
  const adapter = getAdapter(settings);
  return withRepair(
    (extra = '') =>
      adapter.vision([image], SNAP_PROMPT + extra, {
        schema: MEAL_ANALYSIS_SCHEMA,
        schemaName: 'meal_analysis',
        maxTokens: 2000,
        signal,
      }),
    (raw) => toAnalysis(parseJSON<RawAnalysis>(raw), 'Meal'),
  );
}

/* ------------------------------- label OCR ------------------------------- */

interface RawFood {
  name?: string;
  brand?: string;
  per100g?: Partial<Nutrients>;
  micros?: Record<string, unknown>;
  servings?: { label?: string; grams?: number }[];
}

/**
 * Reads the model's micronutrient block.
 *
 * An all-zero object comes back undefined: a model that skipped the question
 * and filled in zeroes would otherwise be recorded as a confident "this food
 * contains no vitamins at all" and drag the day's totals down, where saying
 * nothing correctly leaves the food out of the coverage figure.
 */
function toMicros(raw: Record<string, unknown> | undefined): Micros | undefined {
  if (!raw) return undefined;
  const micros: Micros = {};
  for (const key of MICRO_KEYS) {
    if (!(key in MICRO_BY_ID)) continue;
    const value = raw[key];
    if (value === undefined || value === null) continue;
    micros[key as keyof Micros] = num(value);
  }
  if (!hasMicros(micros)) return undefined;
  return Object.values(micros).some((v) => v > 0) ? micros : undefined;
}

function toFoodDraft(raw: RawFood, fallbackName: string) {
  const per100g = roundNutrients({
    kcal: num(raw.per100g?.kcal),
    protein: num(raw.per100g?.protein),
    fat: num(raw.per100g?.fat),
    carbs: num(raw.per100g?.carbs),
    fibre: num(raw.per100g?.fibre),
  });
  const servings = (raw.servings ?? [])
    .map((s) => ({ label: (s.label ?? '').trim(), grams: num(s.grams) }))
    .filter((s) => s.label && s.grams > 0);
  return {
    name: (raw.name ?? fallbackName).trim() || fallbackName,
    brand: raw.brand?.trim() || undefined,
    per100g,
    micros: toMicros(raw.micros),
    // Always leave a 100 g option so the user can enter a raw weight.
    servings: servings.length ? servings : [{ label: '100 g', grams: 100 }],
  };
}

export async function readNutritionLabel(
  settings: Settings,
  image: ImagePart,
  signal?: AbortSignal,
) {
  const adapter = getAdapter(settings);
  return withRepair(
    (extra = '') =>
      adapter.vision([image], LABEL_PROMPT + extra, {
        schema: FOOD_GENERATION_SCHEMA,
        schemaName: 'food',
        maxTokens: 1200,
        signal,
      }),
    (raw) => toFoodDraft(parseJSON<RawFood>(raw), 'Scanned product'),
  );
}

/* ---------------------------- food generation ---------------------------- */

export async function generateFood(settings: Settings, query: string, signal?: AbortSignal) {
  const adapter = getAdapter(settings);
  return withRepair(
    (extra = '') =>
      adapter.extract(foodGenerationPrompt(query) + extra, {
        schema: FOOD_GENERATION_SCHEMA,
        schemaName: 'food',
        maxTokens: 900,
        light: true,
        signal,
      }),
    (raw) => toFoodDraft(parseJSON<RawFood>(raw), query),
  );
}

/* --------------------------------- voice --------------------------------- */

export async function parseSpokenMeal(
  settings: Settings,
  transcript: string,
  signal?: AbortSignal,
): Promise<SnapAnalysis> {
  const adapter = getAdapter(settings);
  return withRepair(
    (extra = '') =>
      adapter.extract(`${VOICE_PROMPT}\n\nWhat they said:\n"${transcript}"${extra}`, {
        schema: MEAL_ANALYSIS_SCHEMA,
        schemaName: 'meal_analysis',
        maxTokens: 1500,
        signal,
      }),
    (raw) => toAnalysis(parseJSON<RawAnalysis>(raw), 'Voice log'),
  );
}

/* -------------------------------- context -------------------------------- */

/** Renders a day into the compact text block every AI call gets as context. */
export function dayContext(bundle: DayBundle, profile: Profile | undefined): string {
  const totals = bundle.meals.length
    ? roundNutrients(sumNutrients(bundle.meals.map(mealNutrients)))
    : { kcal: 0, protein: 0, fat: 0, carbs: 0, fibre: 0 };

  const lines: string[] = [
    profileContext(profile),
    '',
    `Date: ${bundle.date}`,
    `Eaten: ${totals.kcal} kcal — ${totals.protein} g protein, ${totals.fat} g fat, ${totals.carbs} g carbs, ${totals.fibre} g fibre`,
  ];

  // Coverage is stated rather than hidden: without it the model would read a
  // half-covered day as a genuine deficiency and tell the user to fix one.
  const micros = dayMicros(bundle.meals);
  if (bundle.meals.length) {
    const short = microRows(micros.totals, targetsForProfile(profile))
      .filter((r) => !r.def.limit && r.status !== 'good')
      .sort((a, b) => a.pct - b.pct)
      .slice(0, 4)
      .map((r) => `${r.def.label} ${formatMicro(r.def.id, r.value)} of ${formatMicro(r.def.id, r.target)} (${r.pct}%)`);
    if (short.length) {
      lines.push(
        `Micronutrients running short: ${short.join('; ')} — computed from ${Math.round(micros.coverage * 100)}% of today's calories, so these are floors, not final figures.`,
      );
    }
  }

  if (bundle.meals.length) {
    lines.push('Meals:');
    for (const meal of bundle.meals) {
      const items = meal.items
        .map((i) => `${i.qty} ${i.servingLabel} ${i.name} (${Math.round(i.nutrients.kcal)} kcal)`)
        .join(', ');
      lines.push(
        `  ${MEAL_SLOT_LABEL[meal.slot]}: ${items || 'nothing'} — ${Math.round(mealNutrients(meal).kcal)} kcal`,
      );
    }
  } else {
    lines.push('Meals: nothing logged yet today.');
  }

  const burned = bundle.workouts.reduce((s, w) => s + w.kcal, 0);
  // Sets, reps and load when the session has them, so answers can reference
  // what was actually trained rather than just "Strength session, 45 min".
  const describeWorkout = (w: (typeof bundle.workouts)[number]) => {
    if (!w.exercises?.length) return `${w.type} ${w.durationMin} min`;
    const detail = w.exercises
      .map((e) => {
        const sets = e.sets ?? [];
        // Sets first: strength entries also carry a derived duration, so
        // checking duration would describe a bench press as "4 min".
        if (!sets.length) {
          return e.durationMin ? `${e.name} ${Math.round(e.durationMin)} min` : e.name;
        }
        const load = sets.some((s) => s.weightKg)
          ? ` @ ${Math.max(...sets.map((s) => s.weightKg ?? 0))} kg`
          : '';
        return `${e.name} ${sets.length}×${sets.map((s) => s.reps).join('/')}${load}`;
      })
      .join('; ');
    return `${w.title ?? w.type} (${detail})`;
  };
  lines.push(
    `Workouts: ${
      bundle.workouts.length
        ? `${bundle.workouts.map(describeWorkout).join(', ')} — ${burned} kcal burned`
        : 'none logged'
    }`,
  );
  lines.push(`Water: ${bundle.water.glasses} of ${bundle.water.goalGlasses} glasses`);
  lines.push(
    `Sleep: ${bundle.sleep ? formatDuration(bundle.sleep.durationMin) : 'not logged'}`,
  );
  lines.push(`Steps: ${bundle.steps.count} of ${bundle.steps.goal}`);
  if (bundle.weight) lines.push(`Weight today: ${bundle.weight.kg.toFixed(1)} kg`);

  return lines.join('\n');
}

/* --------------------------------- coach --------------------------------- */

export async function* coachReply(
  settings: Settings,
  history: ChatTurn[],
  context: string,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const adapter = getAdapter(settings);
  // Context goes last so the stable persona stays cacheable across turns.
  const system = `${COACH_SYSTEM}\n\n--- The user's data right now ---\n${context}`;
  yield* adapter.chat(history, { system, maxTokens: 1200, signal });
}

/* -------------------------------- insight -------------------------------- */

export async function generateInsight(
  settings: Settings,
  context: string,
  signal?: AbortSignal,
): Promise<{ title: string; body: string; chips: string[] }> {
  const adapter = getAdapter(settings);
  return withRepair(
    (extra = '') =>
      adapter.extract(`${INSIGHT_PROMPT}\n\n--- Their day ---\n${context}${extra}`, {
        system: COACH_SYSTEM,
        schema: INSIGHT_SCHEMA,
        schemaName: 'insight',
        maxTokens: 600,
        light: true,
        signal,
      }),
    (raw) => {
      const parsed = parseJSON<{ title?: string; body?: string; chips?: string[] }>(raw);
      return {
        title: (parsed.title ?? 'Your day so far').trim(),
        body: (parsed.body ?? '').trim(),
        chips: (parsed.chips ?? []).map((c) => String(c).trim()).filter(Boolean).slice(0, 2),
      };
    },
  );
}

/* --------------------------------- plans --------------------------------- */

export async function generateDietPlan(
  settings: Settings,
  context: string,
  days: number,
  signal?: AbortSignal,
): Promise<{ title: string; summary: string; days: PlanDay[] }> {
  const adapter = getAdapter(settings);
  const prompt = `Build a ${days}-day diet plan for this user.

Each day must hit their calorie and protein targets within about 10%. Use foods they already log where you can see them in the data — a plan full of things they never eat will not be followed. Keep it realistic for home cooking, and respect Indian meal structure if their log is Indian.

Give every meal slot a concrete suggestion with a portion, and its calories.

--- Their data ---
${context}`;

  return withRepair(
    (extra = '') =>
      adapter.extract(prompt + extra, {
        system: COACH_SYSTEM,
        schema: PLAN_SCHEMA,
        schemaName: 'diet_plan',
        maxTokens: 3000,
        signal,
      }),
    (raw) => {
      const parsed = parseJSON<{
        title?: string;
        summary?: string;
        days?: { label?: string; meals?: { slot?: string; suggestion?: string; kcal?: number }[] }[];
      }>(raw);
      return {
        title: (parsed.title ?? 'Your diet plan').trim(),
        summary: (parsed.summary ?? '').trim(),
        days: (parsed.days ?? []).map((d, i) => ({
          label: (d.label ?? `Day ${i + 1}`).trim(),
          meals: (d.meals ?? [])
            .filter((m): m is { slot: MealSlot; suggestion: string; kcal: number } =>
              Boolean(m.slot && m.slot in MEAL_SLOT_LABEL),
            )
            .map((m) => ({
              slot: m.slot,
              suggestion: String(m.suggestion ?? '').trim(),
              kcal: num(m.kcal),
            })),
        })),
      };
    },
  );
}

export async function generateWorkoutPlan(
  settings: Settings,
  context: string,
  signal?: AbortSignal,
): Promise<{ title: string; summary: string; workouts: { day: string; focus: string; detail: string; minutes: number }[] }> {
  const adapter = getAdapter(settings);
  const prompt = `Build a one-week workout plan for this user.

Match it to their goal and current activity level — do not prescribe six days of training to someone logging nothing. Include at least one rest or active-recovery day. Assume basic equipment only unless their log suggests a gym.

--- Their data ---
${context}`;

  return withRepair(
    (extra = '') =>
      adapter.extract(prompt + extra, {
        system: COACH_SYSTEM,
        schema: WORKOUT_PLAN_SCHEMA,
        schemaName: 'workout_plan',
        maxTokens: 2000,
        signal,
      }),
    (raw) => {
      const parsed = parseJSON<{
        title?: string;
        summary?: string;
        workouts?: { day?: string; focus?: string; detail?: string; minutes?: number }[];
      }>(raw);
      return {
        title: (parsed.title ?? 'Your workout plan').trim(),
        summary: (parsed.summary ?? '').trim(),
        workouts: (parsed.workouts ?? []).map((w, i) => ({
          day: (w.day ?? `Day ${i + 1}`).trim(),
          focus: (w.focus ?? '').trim(),
          detail: (w.detail ?? '').trim(),
          minutes: num(w.minutes, 30),
        })),
      };
    },
  );
}

/* ------------------------------- exercises ------------------------------- */

export interface SuggestedExercise {
  exerciseId: string;
  sets: number;
  reps: number;
  durationMin: number;
}

/**
 * Builds one session the user can log immediately.
 *
 * `catalog` is the id/name shortlist the model must choose from — without it
 * the reply is prose that has to be re-entered by hand. Ids that come back
 * outside the list are dropped by the caller rather than trusted.
 */
export async function generateSession(
  settings: Settings,
  context: string,
  catalog: { id: string; name: string }[],
  signal?: AbortSignal,
): Promise<{ title: string; summary: string; exercises: SuggestedExercise[] }> {
  const adapter = getAdapter(settings);
  const list = catalog.map((c) => `${c.id} = ${c.name}`).join('\n');
  const prompt = `Build ONE workout session for this user, to do today.

Pick 4–7 exercises. Use ONLY these exercise ids — any id not on this list will be discarded:
${list}

For strength exercises set sets and reps and leave durationMin 0. For cardio, flexibility and sport set durationMin and leave sets and reps 0. Match the volume to what their log shows they actually do; do not prescribe an advanced session to someone training rarely.

--- Their data ---
${context}`;

  const allowed = new Set(catalog.map((c) => c.id));

  return withRepair(
    (extra = '') =>
      adapter.extract(prompt + extra, {
        system: COACH_SYSTEM,
        schema: SESSION_SCHEMA,
        schemaName: 'session',
        maxTokens: 1200,
        signal,
      }),
    (raw) => {
      const parsed = parseJSON<{
        title?: string;
        summary?: string;
        exercises?: { exerciseId?: string; sets?: number; reps?: number; durationMin?: number }[];
      }>(raw);
      return {
        title: (parsed.title ?? "Today's session").trim(),
        summary: (parsed.summary ?? '').trim(),
        exercises: (parsed.exercises ?? [])
          .filter((e) => e.exerciseId && allowed.has(e.exerciseId))
          .map((e) => ({
            exerciseId: e.exerciseId as string,
            sets: num(e.sets, 0),
            reps: num(e.reps, 0),
            durationMin: num(e.durationMin, 0),
          })),
      };
    },
  );
}

/** Plain-text form guidance for one movement. */
export async function explainExercise(
  settings: Settings,
  name: string,
  signal?: AbortSignal,
): Promise<string> {
  const adapter = getAdapter(settings);
  const prompt = `Explain how to perform "${name}" safely and well.

Cover the setup, the movement itself, the two or three faults people most often make, and how to scale it easier or harder. Keep it under 180 words, plain sentences, no markdown headings. You are not a clinician — if this movement carries a common injury risk, say so plainly in one line.`;

  let out = '';
  for await (const chunk of adapter.chat([{ role: 'user', content: prompt }], {
    system: COACH_SYSTEM,
    maxTokens: 600,
    signal,
  })) {
    out += chunk;
  }
  return out.trim();
}

/** Converts an AI food draft into a storable Food row. */
export function draftToFood(
  draft: Awaited<ReturnType<typeof generateFood>>,
  source: Food['source'],
  barcode?: string,
): Omit<Food, 'id' | 'createdAt' | 'useCount'> {
  return {
    name: draft.name,
    brand: draft.brand,
    barcode,
    per100g: draft.per100g,
    micros: draft.micros,
    servings: draft.servings,
    source,
    tags: ['ai'],
    verified: false,
  };
}
