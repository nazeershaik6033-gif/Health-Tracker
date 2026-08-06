import { AIError } from './types';

/* -------------------------------------------------------------------------
   JSON Schemas for the structured calls.
   Kept strict (`additionalProperties: false`, everything required) because
   both Anthropic strict mode and OpenRouter's json_schema mode demand it;
   the Gemini adapter strips the keywords it doesn't accept.
------------------------------------------------------------------------- */

const NUTRIENT_PROPS = {
  kcal: { type: 'number', description: 'Calories for the stated quantity' },
  protein: { type: 'number', description: 'Grams of protein' },
  fat: { type: 'number', description: 'Grams of fat' },
  carbs: { type: 'number', description: 'Grams of carbohydrate' },
  fibre: { type: 'number', description: 'Grams of dietary fibre' },
} as const;

const ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'quantity', 'unit', 'grams', 'kcal', 'protein', 'fat', 'carbs', 'fibre', 'score'],
  properties: {
    name: { type: 'string', description: 'Food name, e.g. "Roti" or "Dal Tadka"' },
    quantity: { type: 'number', description: 'How many units, e.g. 2' },
    unit: {
      type: 'string',
      description: 'Portion unit, e.g. "roti", "katori", "glass", "g", "piece"',
    },
    grams: { type: 'number', description: 'Best estimate of the total weight in grams' },
    ...NUTRIENT_PROPS,
    score: {
      type: 'integer',
      description: 'How healthy this item is in context, 0 (poor) to 10 (excellent)',
    },
  },
} as const;

export const MEAL_ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'items', 'healthScore', 'take', 'confidence'],
  properties: {
    title: { type: 'string', description: 'Short name for the whole meal' },
    items: { type: 'array', items: ITEM_SCHEMA },
    healthScore: { type: 'integer', description: 'Overall meal score 0-10' },
    take: {
      type: 'string',
      description: 'Two or three sentences on the meal and one concrete improvement',
    },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
  },
} as const;

export const FOOD_GENERATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'per100g', 'servings'],
  properties: {
    name: { type: 'string' },
    brand: { type: 'string' },
    per100g: {
      type: 'object',
      additionalProperties: false,
      required: ['kcal', 'protein', 'fat', 'carbs', 'fibre'],
      properties: NUTRIENT_PROPS,
    },
    servings: {
      type: 'array',
      description: 'Realistic portions, most common first',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'grams'],
        properties: {
          label: { type: 'string', description: 'e.g. "1 katori", "1 medium", "100 g"' },
          grams: { type: 'number' },
        },
      },
    },
  },
} as const;

export const INSIGHT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'body', 'chips'],
  properties: {
    title: { type: 'string', description: 'Four to six words, sentence case' },
    body: {
      type: 'string',
      description: 'Two or three sentences citing the actual numbers from the day',
    },
    chips: {
      type: 'array',
      description: 'Two very short actionable suggestions, three or four words each',
      items: { type: 'string' },
    },
  },
} as const;

export const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'summary', 'days'],
  properties: {
    title: { type: 'string' },
    summary: { type: 'string', description: 'Two sentences on the approach' },
    days: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'meals'],
        properties: {
          label: { type: 'string', description: 'e.g. "Day 1"' },
          meals: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['slot', 'suggestion', 'kcal'],
              properties: {
                slot: {
                  type: 'string',
                  enum: ['breakfast', 'morning_snack', 'lunch', 'evening_snack', 'dinner'],
                },
                suggestion: { type: 'string' },
                kcal: { type: 'number' },
              },
            },
          },
        },
      },
    },
  },
} as const;

export const WORKOUT_PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'summary', 'workouts'],
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    workouts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['day', 'focus', 'detail', 'minutes'],
        properties: {
          day: { type: 'string' },
          focus: { type: 'string' },
          detail: { type: 'string' },
          minutes: { type: 'number' },
        },
      },
    },
  },
} as const;

/**
 * Pulls JSON out of a model reply.
 *
 * Even in strict-schema mode a model occasionally wraps the object in a code
 * fence or a sentence, so this strips fences first and falls back to the
 * outermost brace pair before giving up.
 */
export function parseJSON<T>(raw: string): T {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    /* fall through to brace extraction */
  }

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1)) as T;
    } catch {
      /* fall through */
    }
  }
  throw new AIError('Could not read the model reply as JSON', 'bad-response');
}

/** Coerces a possibly-missing number into a sane, non-negative value. */
export const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export const clampScore = (v: unknown): number =>
  Math.max(0, Math.min(10, Math.round(num(v, 5))));
