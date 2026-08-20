import {
  MEAL_SLOTS,
  MEAL_SLOT_LABEL,
  type Favourite,
  type Food,
  type MealItem,
  type MealSlot,
} from '@/types';
import { buildMealItem, buildMealItemFromGrams } from './nutrition';
import { normalise } from './search';

/**
 * Turns a typed line like "breakfast: idly 2, peanut chutney 2 tbsp" into
 * logged food.
 *
 * Deliberately deterministic and offline. A model could read these lines too,
 * but the same sentence has to produce the same calories every time or the
 * trend charts quietly become fiction — and the common case, the breakfast you
 * eat most mornings, is already in the food table and needs no help. Anything
 * this cannot resolve is handed to the AI path by the caller, so novel foods
 * still work; they just aren't the price of entry for the ordinary ones.
 */

/* ------------------------------- detection -------------------------------- */

/**
 * Slot names as people actually type them, longest first so "morning snack"
 * wins over the bare "snack" that follows it.
 */
const SLOT_ALIASES: [MealSlot, string[]][] = [
  ['morning_snack', ['morning snack', 'mid morning snack', 'midmorning snack', 'am snack']],
  ['evening_snack', ['evening snack', 'eve snack', 'tea time', 'teatime', 'pm snack', 'evening']],
  ['breakfast', ['morning breakfast', 'breakfast', 'bfast', 'brekkie', 'morning']],
  ['lunch', ['afternoon lunch', 'lunch', 'afternoon']],
  ['dinner', ['dinner', 'supper', 'night']],
];

/** A bare "snack" has to land somewhere; time of day decides which. */
function snackSlotForNow(hour: number): MealSlot {
  return hour < 12 ? 'morning_snack' : 'evening_snack';
}

/** The slot a message with no heading belongs to, by the clock. */
export function slotForHour(hour: number): MealSlot {
  if (hour < 10) return 'breakfast';
  if (hour < 12) return 'morning_snack';
  if (hour < 15) return 'lunch';
  if (hour < 18) return 'evening_snack';
  return 'dinner';
}

function matchSlot(headingRaw: string, hour: number): MealSlot | undefined {
  const heading = normalise(headingRaw);
  if (!heading) return undefined;
  if (heading === 'snack' || heading === 'snacks') return snackSlotForNow(hour);
  for (const [slot, aliases] of SLOT_ALIASES) {
    if (aliases.some((a) => heading === a || heading.endsWith(` ${a}`) || heading.startsWith(`${a} `)))
      return slot;
  }
  return undefined;
}

/* ------------------------------ quantities -------------------------------- */

const WORD_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  half: 0.5, quarter: 0.25, couple: 2, few: 3, several: 3,
};

/**
 * Portion words the food table's own serving labels are written in, so a typed
 * "2 tbsp" can be matched against a serving that reads "2 tbsp".
 */
const UNIT_WORDS = [
  'g', 'gm', 'gms', 'gram', 'grams', 'kg', 'ml', 'l', 'litre', 'liter',
  'tbsp', 'tbs', 'tablespoon', 'tablespoons', 'tsp', 'teaspoon', 'teaspoons',
  'katori', 'katoris', 'bowl', 'bowls', 'cup', 'cups', 'glass', 'glasses',
  'plate', 'plates', 'piece', 'pieces', 'pc', 'pcs', 'slice', 'slices',
  'spoon', 'spoons', 'scoop', 'scoops', 'packet', 'packets', 'serving', 'servings',
];

/** Units that are a straight weight or volume, logged by grams rather than by serving. */
const MASS_UNITS: Record<string, number> = {
  g: 1, gm: 1, gms: 1, gram: 1, grams: 1, kg: 1000,
  ml: 1, l: 1000, litre: 1000, liter: 1000,
};

/**
 * Alternation is first-match, not longest-match, so every list below is sorted
 * longest-first and the word forms carry a trailing boundary. Without that, "a
 * glass of milk" matched the unit `g` inside "glass" and logged a gram of
 * "lass of milk", and "1/2 katori" matched the bare `1` before the fraction.
 * The digit forms cannot take a boundary — "2tbsp" has none between 2 and t.
 */
const byLengthDesc = (a: string, b: string) => b.length - a.length;

const UNIT_RE = `(?:${[...UNIT_WORDS].sort(byLengthDesc).join('|')})\\b`;
const NUM_RE = [
  String.raw`\d+\s*\/\s*\d+`,
  String.raw`\d+(?:\.\d+)?`,
  `(?:${Object.keys(WORD_NUMBERS).sort(byLengthDesc).join('|')})\\b`,
].join('|');

function toNumber(raw: string): number {
  const text = raw.trim().toLowerCase();
  if (text in WORD_NUMBERS) return WORD_NUMBERS[text];
  const fraction = text.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fraction) {
    const denominator = Number(fraction[2]);
    return denominator ? Number(fraction[1]) / denominator : 1;
  }
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export interface ParsedItem {
  /** What the user typed for this item, kept for the preview and for the AI. */
  raw: string;
  name: string;
  qty: number;
  unit?: string;
}

/**
 * Pulls a quantity off one item, from either end.
 *
 * Both orders are natural and people mix them in the same line — "idly 2" and
 * "2 tbsp peanut chutney" are the same sentence to a human.
 */
export function parseItem(rawInput: string): ParsedItem | null {
  const raw = rawInput.trim().replace(/^(?:and|with|plus)\s+/i, '').trim();
  if (!raw) return null;

  const text = raw.toLowerCase().replace(/\s+/g, ' ');
  const lead = new RegExp(`^(${NUM_RE})\\s*(${UNIT_RE})?\\s*(?:of\\s+)?(.+)$`, 'i');
  const trail = new RegExp(`^(.+?)\\s*[-–]?\\s*(${NUM_RE})\\s*(${UNIT_RE})?$`, 'i');

  let qty = 1;
  let unit: string | undefined;
  let name = text;

  const leading = text.match(lead);
  const trailing = text.match(trail);

  if (leading) {
    qty = toNumber(leading[1]);
    unit = leading[2]?.toLowerCase();
    name = leading[3];
  } else if (trailing) {
    name = trailing[1];
    qty = toNumber(trailing[2]);
    unit = trailing[3]?.toLowerCase();
  }

  // "2 idli" leaves "idli" as the name and nothing as the unit; "2 katori dal"
  // leaves "dal". A unit that swallowed the whole name means there was no name.
  name = name.replace(/^of\s+/, '').trim();
  if (!name) {
    name = unit ?? '';
    unit = undefined;
  }
  if (!name) return null;

  return { raw, name, qty, unit };
}

/* -------------------------------- parsing --------------------------------- */

export interface ParsedGroup {
  slot: MealSlot;
  /** True when the slot came from the clock rather than from the text. */
  inferredSlot: boolean;
  items: ParsedItem[];
}

/**
 * Splits a message into per-slot groups, or returns null if it does not read
 * as a log at all.
 *
 * The trigger is a slot word followed by a colon, which is what the request
 * itself was written in and which practically never appears in a question. A
 * leading "log " works too, for a line with no heading. Everything else falls
 * through to the coach untouched — deciding this in code rather than asking a
 * model keeps "2 idlis, is that enough protein?" a question.
 */
export function parseMealText(input: string, now = new Date()): ParsedGroup[] | null {
  const text = input.trim();
  if (!text) return null;

  const hour = now.getHours();
  const groups: ParsedGroup[] = [];

  // A bare "log ..." with no heading: one group, slot from the clock.
  const bare = text.match(/^log[:\s]+(.+)$/is);
  if (bare && !/:/.test(bare[1])) {
    const items = splitItems(bare[1]);
    return items.length ? [{ slot: slotForHour(hour), inferredSlot: true, items }] : null;
  }

  for (const line of text.split(/\n+/)) {
    // Each line may itself carry several headings: "lunch: rice; dinner: roti".
    for (const segment of line.split(/;/)) {
      const colon = segment.indexOf(':');
      if (colon === -1) continue;
      const slot = matchSlot(segment.slice(0, colon), hour);
      if (!slot) continue;
      const items = splitItems(segment.slice(colon + 1));
      if (items.length) groups.push({ slot, inferredSlot: false, items });
    }
  }

  return groups.length ? groups : null;
}

function splitItems(body: string): ParsedItem[] {
  return body
    .split(/,|\band\b|\+|·/i)
    .map((chunk) => parseItem(chunk))
    .filter((x): x is ParsedItem => x !== null);
}

/* ------------------------------- resolution ------------------------------- */

/** Spellings the food table does not carry but people type constantly. */
const NAME_ALIASES: Record<string, string> = {
  idly: 'idli',
  idlis: 'idli',
  idlies: 'idli',
  dosai: 'dosa',
  chapathi: 'roti',
  chapati: 'roti',
  rotis: 'roti',
  phulkas: 'phulka',
  curd: 'curd',
  dahi: 'curd',
  chai: 'tea',
};

/** One insertion, deletion or substitution apart — "idly" against "idli". */
function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let slack = 1;
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) {
      i++;
      j++;
      continue;
    }
    if (!slack--) return false;
    if (short.length === long.length) i++;
    j++;
  }
  return true;
}

/**
 * Normalises a typed name for lookup: lower-cased, de-pluralised, and run
 * through the alias table. "Idlys" and "Idli" have to reach the same row.
 */
export function canonicalName(raw: string): string {
  const base = normalise(raw);
  if (NAME_ALIASES[base]) return NAME_ALIASES[base];
  const singular = base.replace(/(?:es|s)$/, '');
  return NAME_ALIASES[singular] ?? (singular.length >= 3 ? singular : base);
}

/**
 * Finds the food a typed name means.
 *
 * Not `searchFoods`: that requires every typed word to land somewhere, which is
 * right for a search box the user is watching but wrong here, where "peanut
 * chutney" should still reach a chutney rather than nothing at all. The tiers
 * run exact, then prefix, then all-words, then a one-edit slip, and stop at the
 * first that hits.
 */
export function findFood(foods: Food[], typed: string): Food | undefined {
  const name = canonicalName(typed);
  if (!name) return undefined;

  const scored = foods.map((food) => ({ food, key: normalise(food.name) }));
  const bySpecificity = (a: { key: string }, b: { key: string }) => a.key.length - b.key.length;

  const exact = scored.filter((f) => f.key === name || canonicalName(f.key) === name);
  if (exact.length) return exact.sort(bySpecificity)[0].food;

  const prefix = scored.filter((f) => f.key.startsWith(name));
  if (prefix.length) return prefix.sort(bySpecificity)[0].food;

  const words = name.split(' ').filter(Boolean);
  const allWords = scored.filter((f) => words.every((w) => f.key.includes(w)));
  if (allWords.length) return allWords.sort(bySpecificity)[0].food;

  const fuzzy = scored.filter((f) =>
    f.key.split(' ').some((word) => word.length >= 4 && withinOneEdit(word, name)),
  );
  if (fuzzy.length) return fuzzy.sort(bySpecificity)[0].food;

  return undefined;
}

export interface ResolvedItem {
  parsed: ParsedItem;
  /** Absent when nothing in the food table matched. */
  item?: MealItem;
  food?: Food;
  /** Set when the row came from a pinned portion rather than the food table. */
  favourite?: Favourite;
}

/**
 * Matches a typed name against the portions pinned to this slot.
 *
 * Checked before the food table, and it is the one lookup that can answer with
 * more than one item: a favourite is a saved *portion* — "2 roti + dal + curd"
 * — so "breakfast: usual" expands to everything that usual contains, at the
 * amounts that were pinned. "usual" and "same" are treated as naming the
 * slot's only pinned portion, which is what people reach for when they have
 * just one.
 */
function findFavourite(
  favourites: Favourite[],
  slot: MealSlot,
  typed: string,
): Favourite | undefined {
  const forSlot = favourites.filter((f) => f.slot === slot);
  if (!forSlot.length) return undefined;

  const name = canonicalName(typed);
  if (!name) return undefined;

  if ((name === 'usual' || name === 'same' || name === 'my usual') && forSlot.length === 1) {
    return forSlot[0];
  }

  const labelled = forSlot.map((f) => ({
    favourite: f,
    key: canonicalName(f.label?.trim() || f.items.map((i) => i.name).join(' ')),
  }));

  return (
    labelled.find((f) => f.key === name)?.favourite ??
    labelled.find((f) => f.key.startsWith(name))?.favourite ??
    labelled.find((f) => f.key.includes(name))?.favourite
  );
}

/**
 * Picks the serving a typed unit refers to.
 *
 * The seed data is already written in these words — Idli carries "2 idli
 * (regular)", Coconut Chutney carries "2 tbsp" — so matching the unit against
 * serving labels is usually enough, and falls back to the food's default.
 */
function servingForUnit(food: Food, unit: string | undefined) {
  if (!unit) return food.servings[0];
  const want = normalise(unit).replace(/(?:es|s)$/, '');
  return (
    food.servings.find((s) => normalise(s.label).split(' ').some((w) => w.replace(/(?:es|s)$/, '') === want)) ??
    food.servings.find((s) => normalise(s.label).includes(want)) ??
    food.servings[0]
  );
}

/** Turns one parsed item into something loggable, where the food table can. */
export function resolveItem(foods: Food[], parsed: ParsedItem): ResolvedItem {
  const food = findFood(foods, parsed.name);
  if (!food) return { parsed };

  const massUnit = parsed.unit ? MASS_UNITS[parsed.unit] : undefined;
  if (massUnit) {
    return { parsed, food, item: buildMealItemFromGrams(food, parsed.qty * massUnit) };
  }

  const serving = servingForUnit(food, parsed.unit);
  // A serving label that already states a count — "2 idli" — means "2 idli"
  // typed by the user is one of it, not two.
  const perServing = Number(serving?.label.match(/^\s*([\d.]+)/)?.[1] ?? 1) || 1;
  const qty = parsed.unit && perServing > 1 ? parsed.qty / perServing : parsed.qty;

  return {
    parsed,
    food,
    item: buildMealItem(food, serving?.label ?? food.servings[0]?.label ?? '100 g', qty),
  };
}

export interface ResolvedGroup {
  slot: MealSlot;
  inferredSlot: boolean;
  items: ResolvedItem[];
}

/**
 * Resolves every parsed item, pinned portions first.
 *
 * Favourites lead because they are the most specific thing the app knows: a
 * portion the user pinned themselves, at a quantity they chose, beats anything
 * inferred from a catalog row. A favourite holding several foods expands into
 * a row each, so the preview still shows what is about to be logged rather
 * than one opaque line.
 */
export function resolveGroups(
  foods: Food[],
  groups: ParsedGroup[],
  favourites: Favourite[] = [],
): ResolvedGroup[] {
  return groups.map((group) => ({
    slot: group.slot,
    inferredSlot: group.inferredSlot,
    items: group.items.flatMap((parsed) => {
      const favourite = findFavourite(favourites, group.slot, parsed.name);
      if (!favourite) return [resolveItem(foods, parsed)];
      return favourite.items.map((item) => ({
        parsed,
        favourite,
        item: { ...item, nutrients: { ...item.nutrients } },
      }));
    }),
  }));
}

/** "Breakfast and Lunch", for the confirmation line. */
export function describeSlots(groups: { slot: MealSlot }[]): string {
  const seen = MEAL_SLOTS.filter((slot) => groups.some((g) => g.slot === slot));
  const labels = seen.map((s) => MEAL_SLOT_LABEL[s]);
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}
