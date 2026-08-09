import { expand, frequentByUse, normalise, scoreEntity } from './search';
import type { Food } from '@/types';

/**
 * Local fuzzy search over the bundled + user food tables.
 *
 * The match scoring itself lives in `./search`, shared with the exercise
 * catalog. What stays here is food-specific: the synonym table, which fields
 * form the haystack, and the tie-breakers.
 */

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

function scoreFood(food: Food, query: string, groups: string[][]): number {
  const name = normalise(food.name);
  const extra = `${food.brand ? normalise(food.brand) : ''} ${food.tags.join(' ')}`;

  const base = scoreEntity({ name, extra }, query, groups);
  if (base === 0) return 0;

  // Familiar and verified foods float up.
  let score = base + Math.min(food.useCount, 25) * 6;
  if (food.verified) score += 12;
  if (food.source === 'seed') score += 8;
  return score;
}

export function searchFoods(foods: Food[], rawQuery: string, limit = 40): Food[] {
  const query = normalise(rawQuery);
  if (!query) return [];
  const groups = expand(query.split(' ').filter(Boolean), SYNONYMS);

  return foods
    .map((food) => ({ food, score: scoreFood(food, query, groups) }))
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
  return frequentByUse(foods, starterIds, limit);
}
