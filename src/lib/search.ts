/**
 * The domain-neutral half of local fuzzy search, shared by the food and
 * exercise catalogs.
 *
 * Deliberately not a trigram index: at a few hundred to a few thousand rows a
 * scored linear scan is well under a frame, and it avoids keeping a second
 * index in sync with every row the app generates at runtime.
 *
 * Callers supply the haystacks and their own tie-breakers; everything about
 * *how* a match scores lives here so both catalogs rank consistently.
 */

export const normalise = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Each typed word becomes a group: the word itself plus anything it can also
 * be called. A group matches if ANY member matches.
 *
 * Groups rather than a flat list, because flattening inverts the intent — it
 * would require a row to match a word *and* all of that word's synonyms, so a
 * row actually named "Rajma" would score zero unless it also said "kidney
 * bean".
 */
export function expand(tokens: string[], synonyms: Record<string, string[]>): string[][] {
  return tokens.map((t) => [t, ...(synonyms[t] ?? [])]);
}

export interface ScoreInput {
  /** The row's display name, already normalised. */
  name: string;
  /** Everything else worth matching (tags, brand, muscles), normalised. */
  extra: string;
}

/**
 * Tiered relevance for one row.
 *
 * Returns 0 when any typed word fails to land anywhere — that all-groups-must
 * -hit rule is what makes multi-word queries like "incline dumbbell" behave
 * instead of returning everything containing either word.
 */
export function scoreEntity({ name, extra }: ScoreInput, query: string, groups: string[][]): number {
  const haystack = `${name} ${extra}`;
  let score = 0;

  if (name === query) score += 1000;
  else if (name.startsWith(query)) score += 600;
  else if (name.includes(query)) score += 350;

  for (const group of groups) {
    // Best hit within the group; the word the user typed is first, so an exact
    // term always outranks a synonym of it.
    let best = 0;
    for (const token of group) {
      if (!token) continue;
      if (name.startsWith(token)) best = Math.max(best, 120);
      else if (new RegExp(`\\b${token}`).test(name)) best = Math.max(best, 90);
      else if (name.includes(token)) best = Math.max(best, 45);
      else if (haystack.includes(token)) best = Math.max(best, 18);
    }
    if (best === 0) return 0;
    score += best;
  }

  // Shorter names win ties: "Rice (cooked)" should beat "Curd Rice" for "rice".
  score += Math.max(0, 40 - name.length);
  return score;
}

/**
 * Real usage first, topped up with a curated starter set so a "frequently
 * used" list is never empty on a fresh install.
 */
export function frequentByUse<T extends { id: string; useCount: number; lastUsedAt?: number }>(
  rows: T[],
  starterIds: string[],
  limit: number,
): T[] {
  const used = rows
    .filter((r) => r.useCount > 0)
    .sort((a, b) => {
      if (b.useCount !== a.useCount) return b.useCount - a.useCount;
      return (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0);
    });

  const seen = new Set(used.map((r) => r.id));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const starters = starterIds
    .filter((id) => !seen.has(id))
    .map((id) => byId.get(id))
    .filter((r): r is T => Boolean(r));

  return [...used, ...starters].slice(0, limit);
}
