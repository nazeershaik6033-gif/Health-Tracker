import { toGtin13 } from './gtin';
import type { FatSecretConfig, Food, Nutrients, Serving } from '@/types';

/**
 * FatSecret Platform API client.
 *
 * ── Why this is not as simple as the AI providers ──────────────────────────
 * The AI adapters call their provider straight from the browser because those
 * providers opt into it (Anthropic needs an explicit header, but they do allow
 * it). FatSecret does not:
 *
 *   1. `oauth.fatsecret.com/connect/token` returns no `Access-Control-Allow-
 *      Origin` header, so the browser refuses to read the response. Sending a
 *      `Authorization` header to the REST host also forces a preflight that
 *      goes unanswered.
 *   2. Credentials are pinned to whitelisted IP addresses (15 of them, or CIDR
 *      ranges on Premier). A phone moving between wifi and mobile data has no
 *      stable IP, so whitelisting cannot work from a client device even if CORS
 *      were solved.
 *
 * FatSecret's own guidance is to request tokens through a proxy. So `proxyUrl`
 * is the supported path: a tiny worker holds the client secret, whitelists its
 * own fixed IP, and exposes one CORS-enabled endpoint. `proxy/fatsecret-worker.js`
 * in this repo is that worker.
 *
 * The direct path is still attempted when no proxy is configured. It will
 * almost certainly be blocked, but a specific "your browser cannot call
 * FatSecret directly, here is what to do" beats a generic network error — and
 * if a key ever is usable directly, it simply works.
 */

const TOKEN_URL = 'https://oauth.fatsecret.com/connect/token';
const REST_URL = 'https://platform.fatsecret.com/rest/server.api';

/** Requests are abandoned after this so a dead proxy can't hang a barcode scan. */
const TIMEOUT_MS = 9000;

export type FatSecretErrorKind =
  | 'disabled'
  | 'no-credentials'
  | 'blocked'
  | 'auth'
  | 'ip'
  | 'scope'
  | 'rate-limit'
  | 'network'
  | 'bad-response'
  | 'unknown';

export class FatSecretError extends Error {
  constructor(
    message: string,
    readonly kind: FatSecretErrorKind = 'unknown',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'FatSecretError';
  }
}

export function describeFatSecretError(err: unknown): string {
  if (err instanceof FatSecretError) return err.message;
  if (err instanceof DOMException && err.name === 'AbortError') return 'FatSecret timed out.';
  return err instanceof Error ? err.message : 'FatSecret lookup failed.';
}

/** Usable means: switched on, and either a proxy or a full credential pair. */
export function fatSecretReady(cfg?: FatSecretConfig): boolean {
  if (!cfg?.enabled) return false;
  if (cfg.proxyUrl.trim()) return true;
  return Boolean(cfg.clientId.trim() && cfg.clientSecret.trim());
}

/* ----------------------------- access tokens ------------------------------ */

interface CachedToken {
  value: string;
  expiresAt: number;
  fingerprint: string;
}

let cachedToken: CachedToken | null = null;

/** Changing credentials must invalidate a token minted with the old ones. */
const fingerprintOf = (cfg: FatSecretConfig) => `${cfg.clientId}:${cfg.scope}`;

export function clearFatSecretToken(): void {
  cachedToken = null;
}

async function getToken(cfg: FatSecretConfig, signal?: AbortSignal): Promise<string> {
  const fingerprint = fingerprintOf(cfg);
  // 60s of slack so a token can't expire mid-flight.
  if (cachedToken && cachedToken.fingerprint === fingerprint && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }

  const clientId = cfg.clientId.trim();
  const clientSecret = cfg.clientSecret.trim();
  if (!clientId || !clientSecret) {
    throw new FatSecretError(
      'Add your FatSecret Client ID and Secret in Settings.',
      'no-credentials',
    );
  }

  let basic: string;
  try {
    basic = btoa(`${clientId}:${clientSecret}`);
  } catch {
    // btoa throws on anything outside Latin-1 — almost always a paste mishap.
    throw new FatSecretError(
      'Those credentials contain characters FatSecret keys never have. Re-copy them.',
      'no-credentials',
    );
  }

  const res = await request(TOKEN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: cfg.scope.trim() || 'basic',
    }),
    signal,
  });

  if (!res.ok) {
    const detail = await readError(res);
    if (res.status === 400 || res.status === 401) {
      throw new FatSecretError(
        `FatSecret rejected those credentials${detail ? ` — ${detail}` : '.'}`,
        'auth',
        res.status,
      );
    }
    throw new FatSecretError(
      `FatSecret returned ${res.status}${detail ? ` — ${detail}` : ''}`,
      'unknown',
      res.status,
    );
  }

  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new FatSecretError('FatSecret returned no access token.', 'bad-response');
  }

  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 86400) * 1000,
    fingerprint,
  };
  return cachedToken.value;
}

/* -------------------------------- transport ------------------------------- */

/** fetch with a timeout, translating the browser's opaque failures. */
async function request(url: string, init: RequestInit & { signal?: AbortSignal }): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const outer = init.signal;
  const onAbort = () => controller.abort();
  outer?.addEventListener('abort', onAbort);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onAbort);
  }
}

async function readError(res: Response): Promise<string> {
  try {
    const text = (await res.text()).trim();
    if (!text) return '';
    try {
      const json = JSON.parse(text) as {
        error?: string | { message?: string };
        error_description?: string;
      };
      if (typeof json.error === 'string') return json.error_description || json.error;
      if (json.error?.message) return json.error.message;
    } catch {
      /* not JSON — fall through to the raw text */
    }
    return text.slice(0, 160);
  } catch {
    return '';
  }
}

/**
 * One FatSecret REST call, via the proxy when configured and directly
 * otherwise. Returns the parsed JSON body; FatSecret's own `error` object is
 * translated into a typed throw.
 */
async function call(
  cfg: FatSecretConfig,
  method: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const proxyUrl = cfg.proxyUrl.trim();
  let res: Response;

  try {
    if (proxyUrl) {
      res = await request(proxyUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method, params }),
        signal,
      });
    } else {
      const token = await getToken(cfg, signal);
      res = await request(REST_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ ...params, method, format: 'json' }),
        signal,
      });
    }
  } catch (err) {
    if (err instanceof FatSecretError) throw err;
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new FatSecretError(
        proxyUrl ? 'Your FatSecret proxy did not respond in time.' : 'FatSecret did not respond in time.',
        'network',
      );
    }
    // A TypeError from fetch is the browser refusing to expose the response:
    // CORS, a blocked mixed-content request, or no connectivity at all.
    throw new FatSecretError(
      proxyUrl
        ? 'Could not reach your FatSecret proxy. Check the URL is https and that it allows this origin.'
        : 'Your browser cannot call FatSecret directly — FatSecret sends no CORS headers and pins keys to whitelisted IPs. Set a Proxy URL in Settings.',
      proxyUrl ? 'network' : 'blocked',
    );
  }

  if (res.status === 429) {
    throw new FatSecretError('FatSecret is rate-limiting requests. Try again shortly.', 'rate-limit', 429);
  }
  if (!res.ok) {
    const detail = await readError(res);
    throw new FatSecretError(
      `FatSecret returned ${res.status}${detail ? ` — ${detail}` : ''}`,
      res.status === 401 || res.status === 403 ? 'auth' : 'unknown',
      res.status,
    );
  }

  let data: Record<string, unknown>;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new FatSecretError('FatSecret sent a reply that could not be read.', 'bad-response');
  }

  const error = data.error as { code?: number; message?: string } | undefined;
  if (error) throw translateApiError(error);

  return data;
}

/**
 * FatSecret reports failures as HTTP 200 with an `error` body, so these have
 * to be classified from the message. The message itself is the most useful
 * thing they give us, so it is always passed through.
 */
function translateApiError(error: { code?: number; message?: string }): FatSecretError {
  const message = error.message?.trim() || 'FatSecret rejected the request.';
  const lower = message.toLowerCase();

  if (lower.includes('ip address')) {
    return new FatSecretError(
      `${message} — whitelist your proxy's IP in the FatSecret dashboard.`,
      'ip',
    );
  }
  if (lower.includes('scope')) {
    return new FatSecretError(
      `${message} — your FatSecret plan may not include this call.`,
      'scope',
    );
  }
  if (lower.includes('token') || lower.includes('authenticat') || lower.includes('authoris') || lower.includes('authoriz')) {
    return new FatSecretError(message, 'auth');
  }
  return new FatSecretError(message, 'unknown');
}

/* --------------------------------- mapping -------------------------------- */

interface FSServing {
  serving_description?: string;
  metric_serving_amount?: string;
  metric_serving_unit?: string;
  measurement_description?: string;
  number_of_units?: string;
  is_default?: string;
  calories?: string;
  protein?: string;
  fat?: string;
  carbohydrate?: string;
  fiber?: string;
}

interface FSFood {
  food_id?: string;
  food_name?: string;
  brand_name?: string;
  food_type?: string;
  food_description?: string;
  servings?: { serving?: FSServing | FSServing[] };
}

/** FatSecret collapses single-element arrays into bare objects. */
function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

const toNum = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

export type FoodDraft = Omit<Food, 'id' | 'createdAt' | 'useCount'>;

/**
 * Turns a FatSecret food into ours. Returns null when there is no way to reach
 * a per-100g basis, which is the unit every calculation in the app runs on —
 * a food we can't scale is worse than no result, because it would silently log
 * wrong numbers.
 */
export function mapFood(fs: FSFood, barcode?: string): FoodDraft | null {
  const name = fs.food_name?.trim();
  if (!name) return null;

  const servings = asArray(fs.servings?.serving);
  const metric = servings
    .map((s) => {
      const amount = toNum(s.metric_serving_amount);
      const unit = (s.metric_serving_unit ?? '').toLowerCase();
      // ml is treated as g, as elsewhere in the app — close enough for food,
      // and the alternative is discarding every drink.
      if (!amount || (unit !== 'g' && unit !== 'ml')) return null;
      return { serving: s, grams: amount };
    })
    .filter((s): s is { serving: FSServing; grams: number } => s !== null);

  let per100g: Nutrients | null = null;
  const out: Serving[] = [];

  if (metric.length) {
    // Prefer whichever serving is closest to 100 g: the least rounding error
    // when scaling, and often literally the "100 g" row.
    const basis = [...metric].sort(
      (a, b) => Math.abs(a.grams - 100) - Math.abs(b.grams - 100),
    )[0];
    const factor = 100 / basis.grams;
    per100g = {
      kcal: Math.round(toNum(basis.serving.calories) * factor),
      protein: round1(toNum(basis.serving.protein) * factor),
      fat: round1(toNum(basis.serving.fat) * factor),
      carbs: round1(toNum(basis.serving.carbohydrate) * factor),
      fibre: round1(toNum(basis.serving.fiber) * factor),
    };

    const seen = new Set<string>();
    for (const { serving, grams } of metric) {
      const label = (serving.serving_description ?? serving.measurement_description ?? '').trim();
      if (!label || seen.has(label.toLowerCase())) continue;
      seen.add(label.toLowerCase());
      out.push({ label, grams });
    }
  } else {
    // No structured servings — `foods.search` sometimes only carries the
    // "Per 100g - Calories: 52kcal | Fat: 0.17g | ..." summary line.
    per100g = parseDescription(fs.food_description);
    if (!per100g) return null;
  }

  if (!per100g || per100g.kcal <= 0) return null;

  if (!out.some((s) => s.grams === 100)) out.push({ label: '100 g', grams: 100 });

  return {
    name,
    brand: fs.brand_name?.trim() || undefined,
    barcode,
    per100g,
    servings: out,
    source: 'fatsecret',
    tags: ['fatsecret', ...(fs.food_type ? [fs.food_type.toLowerCase()] : [])],
    verified: fs.food_type?.toLowerCase() === 'brand',
  };
}

/** "Per 100g - Calories: 52kcal | Fat: 0.17g | Carbs: 13.81g | Protein: 0.26g" */
function parseDescription(description?: string): Nutrients | null {
  if (!description) return null;

  // The basis can be "100g", "1 cup" and so on; only a metric basis is usable.
  const basis = description.match(/per\s+([\d.]+)\s*(g|ml)\b/i);
  if (!basis) return null;
  const grams = Number(basis[1]);
  if (!Number.isFinite(grams) || grams <= 0) return null;

  const pick = (label: string): number => {
    const m = description.match(new RegExp(`${label}:\\s*([\\d.]+)`, 'i'));
    return m ? toNum(m[1]) : 0;
  };

  const kcal = pick('calories');
  if (!kcal) return null;

  const factor = 100 / grams;
  return {
    kcal: Math.round(kcal * factor),
    protein: round1(pick('protein') * factor),
    fat: round1(pick('fat') * factor),
    carbs: round1(pick('carbs') * factor),
    fibre: round1(pick('fib(?:re|er)') * factor),
  };
}

/* --------------------------------- calls ---------------------------------- */

export async function searchFatSecret(
  cfg: FatSecretConfig,
  query: string,
  signal?: AbortSignal,
  limit = 20,
): Promise<FoodDraft[]> {
  const term = query.trim();
  if (!term) return [];

  const data = await call(
    cfg,
    'foods.search.v3',
    {
      search_expression: term,
      max_results: String(Math.min(limit, 50)),
      ...(cfg.region.trim() ? { region: cfg.region.trim() } : {}),
    },
    signal,
  );

  const results = (data.foods_search as { results?: { food?: FSFood | FSFood[] } } | undefined)
    ?.results?.food;

  return asArray(results)
    .map((f) => mapFood(f))
    .filter((f): f is FoodDraft => f !== null);
}

export async function getFatSecretFood(
  cfg: FatSecretConfig,
  foodId: string,
  barcode?: string,
  signal?: AbortSignal,
): Promise<FoodDraft | null> {
  const data = await call(
    cfg,
    'food.get.v4',
    {
      food_id: foodId,
      ...(cfg.region.trim() ? { region: cfg.region.trim() } : {}),
    },
    signal,
  );
  const food = data.food as FSFood | undefined;
  return food ? mapFood(food, barcode) : null;
}

export async function lookupFatSecretBarcode(
  cfg: FatSecretConfig,
  barcode: string,
  signal?: AbortSignal,
): Promise<FoodDraft | null> {
  const data = await call(
    cfg,
    'food.find_id_for_barcode',
    {
      barcode: toGtin13(barcode),
      ...(cfg.region.trim() ? { region: cfg.region.trim() } : {}),
    },
    signal,
  );

  const foodId = (data.food_id as { value?: string | number } | undefined)?.value;
  // "0" is FatSecret's documented "no product with that barcode".
  if (!foodId || String(foodId) === '0') return null;

  return getFatSecretFood(cfg, String(foodId), barcode, signal);
}

/** Cheap round-trip for the Settings "Test connection" button. */
export async function testFatSecret(
  cfg: FatSecretConfig,
): Promise<{ ok: boolean; detail: string }> {
  if (!fatSecretReady(cfg)) {
    return {
      ok: false,
      detail: cfg.proxyUrl.trim()
        ? 'Turn FatSecret on to test it.'
        : 'Add a Client ID and Secret, or a proxy URL.',
    };
  }
  try {
    clearFatSecretToken();
    const results = await searchFatSecret(cfg, 'apple', undefined, 3);
    const via = cfg.proxyUrl.trim() ? 'your proxy' : 'a direct call';
    return results.length
      ? { ok: true, detail: `Connected via ${via} — ${results.length} results for "apple".` }
      : { ok: true, detail: `Connected via ${via}, but the search came back empty.` };
  } catch (err) {
    return { ok: false, detail: describeFatSecretError(err) };
  }
}
