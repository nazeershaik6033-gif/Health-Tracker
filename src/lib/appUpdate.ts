/**
 * Getting onto the latest version.
 *
 * The service worker serves the app shell from a precache so it works offline.
 * That is the whole point of a PWA, and it is also why a freshly deployed
 * version does not always appear on the next visit: the page loads from cache
 * before the worker has noticed there is anything newer.
 *
 * Two escape hatches, in order of severity:
 *
 *   checkForUpdate() — asks the worker to re-fetch its script. If a new build
 *   exists it activates and the caller reloads. Cheap, and the right button
 *   99% of the time.
 *
 *   forceReload() — rebuilds the offline copy of the app shell. For when the
 *   precache is wedged and checkForUpdate() isn't enough.
 *
 * Neither touches IndexedDB, so no meal, photo or tracker entry is at risk.
 * The two stores are entirely separate: Cache API holds the app's own files,
 * IndexedDB holds the user's data.
 */

export type UpdateStatus = 'updated' | 'current' | 'unsupported';

export interface UpdateResult {
  status: UpdateStatus;
  detail: string;
}

/** Query param used to defeat the HTTP cache on a forced reload. */
export const RELOAD_PARAM = '__reload';

/**
 * Is this cache the app's own shell, as opposed to something the user would
 * miss?
 *
 * Workbox names its precache with a `workbox-` prefix; every cache this app
 * creates itself is named `healthify-*` (the share-target bucket, the scanner
 * and OCR binaries, scanned-barcode lookups, images). Only the former is ever
 * the thing that is wedged, so only the former is cleared.
 */
export const isAppShellCache = (name: string): boolean => name.startsWith('workbox-');

/** Stages reported while the shell is rebuilt, so the UI is never silent. */
export type ReloadStage = 'checking' | 'clearing' | 'downloading' | 'reloading';

const STAGE_DETAIL: Record<ReloadStage, string> = {
  checking: 'Checking the app can be re-downloaded…',
  clearing: 'Clearing the offline copy…',
  downloading: 'Re-downloading the app…',
  reloading: 'Reloading…',
};

export function describeStage(stage: ReloadStage): string {
  return STAGE_DETAIL[stage];
}

export async function checkForUpdate(): Promise<UpdateResult> {
  if (!('serviceWorker' in navigator)) {
    return {
      status: 'unsupported',
      detail: 'This browser has no service worker, so nothing is cached — every load is already the latest.',
    };
  }

  let registrations: readonly ServiceWorkerRegistration[];
  try {
    registrations = await navigator.serviceWorker.getRegistrations();
  } catch {
    return { status: 'unsupported', detail: 'This browser would not report its service workers.' };
  }

  if (!registrations.length) {
    return {
      status: 'unsupported',
      detail: 'No service worker is installed here, so this page is already coming straight from the network.',
    };
  }

  let found = false;

  await Promise.all(
    registrations.map(async (registration) => {
      // `updatefound` fires while update() is still in flight, so listen across
      // the call rather than inspecting the registration afterwards.
      const onUpdateFound = () => {
        found = true;
      };
      registration.addEventListener('updatefound', onUpdateFound);
      try {
        await registration.update();
        // One extra turn: the event can land immediately after update() settles.
        await new Promise((resolve) => setTimeout(resolve, 0));
      } catch {
        /* offline, or the SW script 404s — treated as "no update" below */
      } finally {
        registration.removeEventListener('updatefound', onUpdateFound);
      }

      // sw.ts calls skipWaiting() on install, so a waiting worker is unusual —
      // but a browser that suppressed that still needs the nudge.
      if (registration.waiting) {
        found = true;
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    }),
  );

  // When an update is found the caller reloads. That reload is often a
  // backstop rather than the thing that fires: registerType is 'autoUpdate',
  // so vite-plugin-pwa reloads on `controllerchange` as soon as the new worker
  // takes over, frequently before this result is even rendered. Both paths end
  // on the new build, and neither runs twice — whichever wins, the page is gone.
  return found
    ? { status: 'updated', detail: 'A new version is ready. Reloading…' }
    : { status: 'current', detail: "You're on the latest version." };
}

/**
 * Rebuilds the offline copy of the app shell, then reloads. Resolves only if
 * the navigation somehow fails to start — normally the page is gone before
 * that.
 *
 * Deliberately narrow. An earlier version deleted every Cache API entry, which
 * took the scanner and OCR binaries, saved barcode lookups and any photo
 * shared but not yet processed with it, and then navigated with nothing warm
 * to serve the app — a blank screen for as long as the cold download took.
 * Neither is needed to replace a wedged shell:
 *
 *   - only the workbox precache is cleared; the `healthify-*` caches are the
 *     user's, not the app's, and are never what's wedged
 *   - the shell is fetched back *before* navigating, so the reload comes off a
 *     warm HTTP cache rather than a cold network
 *
 * The worker is left registered throughout and asked to refill its own
 * precache — see `rebuildPrecache()` for why nothing the page can do on its
 * own works here.
 *
 * Throws without changing anything when the app cannot be re-fetched. This is
 * not hypothetical: the precache can be the only working copy — a host that
 * has stopped serving the site leaves the installed app running happily from
 * cache. Clearing it then is irreversible from inside the app, because the
 * next load has nowhere to come from. Checking first costs one request.
 */
export async function forceReload(onProgress?: (stage: ReloadStage) => void): Promise<void> {
  const report = (stage: ReloadStage) => onProgress?.(stage);

  report('checking');
  const reachable = await appIsReachable();
  if (!reachable.ok) {
    throw new Error(
      `Not clearing the cache — the app could not be re-downloaded (${reachable.detail}). ` +
        'Your offline copy is still intact. Try again when you have a connection and the site is up.',
    );
  }

  report('clearing');
  if ('caches' in window) {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.filter(isAppShellCache).map((key) => caches.delete(key)));
    } catch {
      /* a cache we can't delete shouldn't stop the reload */
    }
  }

  // Work out where we're going *before* warming, so the exact URL that gets
  // navigated to is the one that ends up in the HTTP cache. Warming the bare
  // base URL while navigating to `/settings?__reload=…` warmed nothing usable:
  // caches key on the full URL, query string included.
  //
  // The target is the app root rather than the current route. Without a worker
  // there is no SPA fallback in the page's own control, and the root is the one
  // path guaranteed to be a real file on every host we deploy to.
  const target = new URL(import.meta.env.BASE_URL, window.location.href);
  target.searchParams.set(RELOAD_PARAM, Date.now().toString(36));

  report('downloading');
  await warmShell(target.toString());

  // Ask the worker to refill its own precache, and only fall back to dropping
  // it if that doesn't work. Rebuilding in place keeps a worker present the
  // whole time, which matters most on an installed iOS PWA where a moment with
  // neither worker nor offline copy can leave nothing to load.
  await rebuildPrecache();

  report('reloading');
  window.location.replace(target.toString());
}

/** How long to wait for the precache to come back before giving up on it. */
const REBUILD_TIMEOUT_MS = 20_000;

/** How long to wait for the worker to say it understood the request. */
const ACK_TIMEOUT_MS = 2_000;

/**
 * Sends the rebuild request and reports whether the worker acknowledged it.
 *
 * A worker installed before the REPRECACHE handler existed — which is every
 * worker already out there at the time this shipped — stays silent. Waiting
 * out the full rebuild timeout to discover that would leave an upgrading user
 * staring at "Re-downloading…" for twenty seconds before the fallback, so the
 * ack is what keeps that case quick.
 */
function askWorkerToRebuild(worker: ServiceWorker): Promise<boolean> {
  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent) => {
      if ((event.data as { type?: string } | undefined)?.type === 'REPRECACHE_ACK') {
        settle(true);
      }
    };
    const settle = (ok: boolean) => {
      clearTimeout(timer);
      navigator.serviceWorker.removeEventListener('message', onMessage);
      resolve(ok);
    };
    const timer = setTimeout(() => settle(false), ACK_TIMEOUT_MS);

    navigator.serviceWorker.addEventListener('message', onMessage);
    worker.postMessage({ type: 'REPRECACHE' });
  });
}

/**
 * Gets the offline copy back after it has been deleted.
 *
 * The page cannot do this itself, which is the whole reason the worker grew a
 * REPRECACHE handler. `update()` is a no-op when the worker script is
 * unchanged — exactly this button's case — and unregister-then-register is no
 * better: with the script byte-identical and the old worker still controlling
 * this page, the browser hands the *running* worker straight back, no install
 * event fires, and nothing is fetched. Measured directly:
 * `registered. installing=false waiting=false active=true`, precache still
 * empty. Only the worker re-running precaching refills it.
 *
 * Rebuilding in place also means a worker is present throughout, rather than
 * there being a moment with neither worker nor offline copy — survivable in a
 * browser tab, much less so in an installed iOS PWA.
 *
 * The fallback matters for anyone upgrading: their installed worker predates
 * the REPRECACHE handler and will ignore the message. Dropping the
 * registration lets the next load install a genuinely new worker, and the
 * warmed HTTP cache carries that load.
 */
async function rebuildPrecache(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.ready;
    const worker = registration.active;

    if (worker && (await askWorkerToRebuild(worker))) {
      // Acknowledged, so this worker understands the request. Now judge it by
      // the cache reappearing rather than by the completion message — the
      // outcome is what matters, and it holds whether or not that message
      // survives the trip.
      const rebuilt = await until(
        async () => (await caches.keys()).some(isAppShellCache),
        REBUILD_TIMEOUT_MS,
      );
      if (rebuilt) return;
    }

    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((r) => r.unregister()));
  } catch {
    /* the warmed HTTP cache carries the reload; the next load re-registers */
  }
}

/**
 * Polls until `check` passes or the deadline expires. Resolves either way —
 * the reload has to happen regardless, and the warmed HTTP cache carries it
 * even if the precache is still filling.
 */
async function until(check: () => Promise<boolean>, timeoutMs = REBUILD_TIMEOUT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if (await check()) return true;
    } catch {
      return false;
    }
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/** How long the shell warm-up may take before we reload anyway. */
const WARM_TIMEOUT_MS = 10_000;

/**
 * Re-fetches the documents and assets this page is already running, so the
 * reload is served warm.
 *
 * The asset URLs come from the performance timeline rather than a hardcoded
 * list, which keeps this correct across content-hashed filenames without
 * needing the build manifest. Failures are ignored: a warm cache is an
 * optimisation, and the reload has to happen either way.
 */
async function warmShell(documentUrl: string): Promise<void> {
  // The document URL must be the exact one we will navigate to, query string
  // included — anything else warms a cache entry the navigation never reads.
  const urls = new Set<string>([documentUrl]);

  try {
    for (const entry of performance.getEntriesByType('resource')) {
      const { name, initiatorType } = entry as PerformanceResourceTiming;
      if (initiatorType !== 'script' && initiatorType !== 'link' && initiatorType !== 'css') {
        continue;
      }
      if (new URL(name, window.location.href).origin === window.location.origin) {
        urls.add(name);
      }
    }
  } catch {
    /* no performance timeline: the base document alone is still worth warming */
  }

  const warm = Promise.all(
    [...urls].map((url) => fetch(url, { cache: 'reload' }).catch(() => undefined)),
  );
  // Don't let one stalled asset hold the reload hostage.
  await Promise.race([warm, new Promise((resolve) => setTimeout(resolve, WARM_TIMEOUT_MS))]);
}

/**
 * Can the app actually be downloaded again right now?
 *
 * Deliberately bypasses both the service worker and the HTTP cache, since a
 * cached 200 would answer the wrong question entirely — the point is whether
 * the *origin* still has the app.
 */
export async function appIsReachable(): Promise<{ ok: boolean; detail: string }> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ok: false, detail: 'you appear to be offline' };
  }

  const url = new URL(import.meta.env.BASE_URL, window.location.href);
  url.searchParams.set('__probe', Date.now().toString(36));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url.toString(), {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, detail: `the server returned ${res.status}` };
    // A 200 that isn't HTML means something is answering, but not with the app
    // — a captive portal or a host's error page dressed as success.
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('text/html')) {
      return { ok: false, detail: `the server returned ${type || 'an unknown type'}, not the app` };
    }
    return { ok: true, detail: 'reachable' };
  } catch {
    return { ok: false, detail: 'the request failed' };
  } finally {
    clearTimeout(timer);
  }
}

/** Build stamp shown in Settings so "did it update?" has a checkable answer. */
export function buildLabel(): string {
  const time = new Date(__BUILD_TIME__);
  const when = Number.isNaN(time.getTime())
    ? __BUILD_TIME__
    : time.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
  return __BUILD_SHA__ ? `${__BUILD_SHA__} · ${when}` : when;
}
