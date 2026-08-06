/**
 * FatSecret proxy — a Cloudflare Worker.
 *
 * Why this exists
 * ---------------
 * Healthify is a local-first PWA with no backend, and every other API it uses
 * is called straight from the browser. FatSecret cannot be, for two reasons
 * that no amount of client-side code can work around:
 *
 *   1. `oauth.fatsecret.com/connect/token` returns no `Access-Control-Allow-
 *      Origin` header, so a browser will not let JavaScript read the response.
 *   2. FatSecret pins credentials to whitelisted IP addresses. A phone moving
 *      between wifi and mobile data has no stable IP to whitelist.
 *
 * A worker has a fixed egress IP and can set its own CORS headers, so it
 * solves both. It also keeps your Client Secret off the device — the app never
 * sees it.
 *
 * Deploy
 * ------
 *   npm install -g wrangler
 *   wrangler init fatsecret-proxy      # paste this file into src/index.js
 *   wrangler secret put FATSECRET_CLIENT_ID
 *   wrangler secret put FATSECRET_CLIENT_SECRET
 *   wrangler deploy
 *
 * Then set two plain vars in the Cloudflare dashboard (or wrangler.toml):
 *
 *   ALLOWED_ORIGIN   https://<you>.github.io      (exact origin, no path)
 *   FATSECRET_SCOPE  basic                        (optional; premier keys may
 *                                                  use "basic barcode")
 *
 * Finally, whitelist the worker's egress IP in the FatSecret dashboard under
 * IP Restrictions. Cloudflare does not publish a single stable egress IP per
 * worker, so run the deployed worker's `/whoami` route once and whitelist what
 * it reports — and re-check it if lookups start failing with "Invalid IP
 * address detected". If your plan allows CIDR ranges, whitelisting
 * Cloudflare's published ranges is steadier than a single address.
 *
 * Contract with the app
 * ---------------------
 *   POST /            { "method": "foods.search.v3", "params": { ... } }
 *   → FatSecret's raw JSON response, unmodified.
 *
 *   GET  /whoami      → { "ip": "..." }  (to find the address to whitelist)
 */

const TOKEN_URL = 'https://oauth.fatsecret.com/connect/token';
const REST_URL = 'https://platform.fatsecret.com/rest/server.api';

/** Only the calls the app actually makes — an open relay to your quota is not. */
const ALLOWED_METHODS = new Set([
  'foods.search.v3',
  'food.get.v4',
  'food.find_id_for_barcode',
]);

/** Cached across requests on a warm isolate; tokens last ~24h. */
let cachedToken = null;

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || '';
    const cors = {
      'access-control-allow-origin': origin || '*',
      'access-control-allow-methods': 'POST, GET, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
      vary: 'origin',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/whoami') {
      return json({ ip: request.headers.get('cf-connecting-ip') ?? 'unknown' }, 200, cors);
    }

    if (request.method !== 'POST') {
      return json({ error: 'Use POST.' }, 405, cors);
    }

    // Reject other sites the moment they ask, rather than letting them spend
    // your FatSecret quota. Same-origin and native app requests send no Origin.
    const requestOrigin = request.headers.get('origin');
    if (origin && requestOrigin && requestOrigin !== origin) {
      return json({ error: 'Origin not allowed.' }, 403, cors);
    }

    if (!env.FATSECRET_CLIENT_ID || !env.FATSECRET_CLIENT_SECRET) {
      return json({ error: 'Worker is missing FATSECRET_CLIENT_ID / _SECRET.' }, 500, cors);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Body must be JSON.' }, 400, cors);
    }

    const method = typeof body?.method === 'string' ? body.method : '';
    if (!ALLOWED_METHODS.has(method)) {
      return json({ error: `Method "${method}" is not allowed.` }, 400, cors);
    }

    // Only string params, so nothing odd can be smuggled into the form body.
    const params = new URLSearchParams({ method, format: 'json' });
    for (const [key, value] of Object.entries(body?.params ?? {})) {
      if (typeof value === 'string' || typeof value === 'number') {
        params.set(key, String(value));
      }
    }

    try {
      let token = await getToken(env);
      let res = await callRest(params, token);

      // A cached token can be revoked server-side; mint a fresh one once
      // before giving up, so a stale isolate doesn't strand the user.
      if (res.status === 401) {
        cachedToken = null;
        token = await getToken(env);
        res = await callRest(params, token);
      }

      const text = await res.text();
      return new Response(text, {
        status: res.status,
        headers: { ...cors, 'content-type': 'application/json' },
      });
    } catch (err) {
      return json({ error: err?.message || 'Proxy request failed.' }, 502, cors);
    }
  },
};

async function getToken(env) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${btoa(`${env.FATSECRET_CLIENT_ID}:${env.FATSECRET_CLIENT_SECRET}`)}`,
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: env.FATSECRET_SCOPE || 'basic',
    }),
  });

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    throw new Error(`FatSecret token request failed (${res.status}): ${detail}`);
  }

  const data = await res.json();
  if (!data.access_token) throw new Error('FatSecret returned no access token.');

  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 86400) * 1000,
  };
  return cachedToken.value;
}

function callRest(params, token) {
  return fetch(REST_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });
}

function json(payload, status, cors) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  });
}
