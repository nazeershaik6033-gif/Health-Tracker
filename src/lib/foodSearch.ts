import type { Food } from '@/types';

/**
 * Local fuzzy search over the bundled + user food tables.
 *
 * Deliberately not a full trigram index: at a few hundred to a few thousand
 * rows a scored linear scan is well under a frame, and it avoids keeping a
 * second index in sync with every AI-generated food.
 */

const normalise = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Common alternate spellings so "chapati" finds "Roti / Chapati" etc. */
const SYNONYMS: Record<string, string[]> = {
  chapati: ['roti'],
  chapathi: ['roti'],
  phulka: ['roti'],
  curd: ['yogurt', 'dahi'],
  dahi: ['curd', 'yogurt'],
  yoghurt: ['yogurt', 'curd'],
  brinjal: ['baingan', 'eggplant'],
  eggplant: ['baingan', 'brinjal'],
  ladyfinger: ['bhindi', 'okra'],
  okra: ['bhindi'],
  capsicum: ['pepper'],
  coriander: ['dhania'],
  chana: ['chickpea', 'gram'],
  chickpea: ['chana'],
  rajma: ['kidney bean'],
  aubergine: ['baingan'],
  prawn: ['shrimp'],
  shrimp: ['prawn'],
  soda: ['cola'],
  chips: ['crisps'],
};

function expand(tokens: string[]): string[] {
  const out = new Set(tokens);
  for (const t of tokens) for (const syn of SYNONYMS[t] ?? []) out.add(syn);
  return [...out];
}

function scoreFood(food: Food, query: string, tokens: string[]): number {
  const name = normalise(food.name);
  const haystack = `${name} ${food.brand ? normalise(food.brand) : ''} ${food.tags.join(' ')}`;

  let score = 0;

  if (name === query) score += 1000;
  else if (name.startsWith(query)) score += 600;
  else if (name.includes(query)) score += 350;

  for (const token of tokens) {
    if (!token) continue;
    if (name.startsWith(token)) score += 120;
    else if (new RegExp(`\\b${token}`).test(name)) score += 90;
    else if (name.includes(token)) score += 45;
    else if (haystack.includes(token)) score += 18;
    else return 0; // every token must land somewhere, or it isn't a match
  }

  // Shorter names win ties: "Rice (cooked)" should beat "Curd Rice" for "rice".
  score += Math.max(0, 40 - name.length);
  // Familiar and verified foods float up.
  score += Math.min(food.useCount, 25) * 6;
  if (food.verified) score += 12;
  if (food.source === 'seed') score += 8;

  return score;
}

export function searchFoods(foods: Food[], rawQuery: string, limit = 40): Food[] {
  const query = normalise(rawQuery);
  if (!query) return [];
  const tokens = expand(query.split(' ').filter(Boolean));

  return foods
    .map((food) => ({ food, score: scoreFood(food, query, tokens) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.food);
}

/**
 * The "Frequently Tracked Foods" list: real usage first, topped up with a
 * curated starter set so the list is never empty on a fresh install.
 */
export function frequentFoods(foods: Food[], starterIds: string[], limit = 30): Food[] {
  const used = foods
    .filter((f) => f.useCount > 0)
    .sort((a, b) => {
      if (b.useCount !== a.useCount) return b.useCount - a.useCount;
      return (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0);
    });

  const seen = new Set(used.map((f) => f.id));
  const byId = new Map(foods.map((f) => [f.id, f]));
  const starters = starterIds
    .filter((id) => !seen.has(id))
    .map((id) => byId.get(id))
    .filter((f): f is Food => Boolean(f));

  return [...used, ...starters].slice(0, limit);
}
