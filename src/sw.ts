/// <reference lib="webworker" />
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope;

const SHARE_CACHE = 'healthify-shared-v1';

/**
 * The app is served from `/` locally but from `/<repo>/` on a GitHub Pages
 * project site. The worker's own URL tells us which, so every path below is
 * built from this rather than hardcoded to the root.
 */
const BASE = new URL(self.registration.scope).pathname;
const path = (p: string) => `${BASE}${p}`;

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener('install', () => {
  void self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | undefined)?.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});

/* ---------------------------------------------------------------------------
   Share target
   The manifest posts shared photos to /share-target. A service worker is the
   only place that POST can be read, so we stash each file in the Cache API
   under a stable key and redirect to /snap with the keys in the query string.
   The page then pulls the blobs back out and deletes them.
--------------------------------------------------------------------------- */
async function handleShare(request: Request): Promise<Response> {
  try {
    const form = await request.formData();
    const files = form.getAll('photos').filter((f): f is File => f instanceof File);
    const cache = await caches.open(SHARE_CACHE);

    const ids: string[] = [];
    for (const file of files) {
      if (!file.type.startsWith('image/') || file.size === 0) continue;
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      await cache.put(
        new Request(path(`__shared/${id}`)),
        new Response(file, {
          headers: {
            'content-type': file.type,
            'x-filename': encodeURIComponent(file.name || 'shared.jpg'),
          },
        }),
      );
      ids.push(id);
    }

    if (!ids.length) {
      // Nothing usable was shared (text-only share, or an unsupported type).
      return Response.redirect(path('snap?shared=empty'), 303);
    }
    return Response.redirect(path(`snap?shared=${ids.join(',')}`), 303);
  } catch {
    return Response.redirect(path('snap?shared=error'), 303);
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.pathname === path('share-target')) {
    event.respondWith(handleShare(event.request));
  }
});

// Serve the stashed share blobs straight from the cache.
registerRoute(
  ({ url }) => url.pathname.startsWith(path('__shared/')),
  new CacheFirst({ cacheName: SHARE_CACHE }),
);

/* ---------------------------------------------------------------------------
   Runtime caching
--------------------------------------------------------------------------- */

// Open Food Facts lookups: try the network so barcode data stays fresh, but
// fall back to a cached hit so a previously scanned product still resolves
// offline.
registerRoute(
  ({ url }) => url.hostname.endsWith('openfoodfacts.org'),
  new NetworkFirst({
    cacheName: 'healthify-off-v1',
    networkTimeoutSeconds: 6,
  }),
);

// Lazy-loaded wasm/worker assets (zxing, tesseract) — immutable, cache hard.
registerRoute(
  ({ url }) => /\.(?:wasm|traineddata(?:\.gz)?)$/.test(url.pathname),
  new CacheFirst({ cacheName: 'healthify-wasm-v1' }),
);

registerRoute(
  ({ request }) => request.destination === 'image',
  new StaleWhileRevalidate({ cacheName: 'healthify-img-v1' }),
);

// SPA navigations fall back to the precached shell so deep links work offline.
// Anything the SW must see itself (share target, cached blobs) is excluded.
//
// The precache handler is wrapped rather than used directly: if the shell entry
// is missing it throws, and a throw inside respondWith gets the browser's own
// error page — not a network fallback. That entry can genuinely be absent, both
// when the user clears the offline copy from Settings and when the browser
// evicts part of the precache under storage pressure. Falling back to the
// network turns both into a normal load.
const shellHandler = createHandlerBoundToURL(path('index.html'));

registerRoute(
  new NavigationRoute(
    async (options) => {
      try {
        return await shellHandler(options);
      } catch {
        return fetch(options.request);
      }
    },
    { denylist: [/share-target/, /__shared\//] },
  ),
);

// AI provider calls must never be cached or intercepted — they carry the
// user's API key and are always live.
registerRoute(
  ({ url }) =>
    url.hostname === 'api.anthropic.com' ||
    url.hostname === 'generativelanguage.googleapis.com' ||
    url.hostname === 'openrouter.ai',
  async ({ request }) => fetch(request),
);
