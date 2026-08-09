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
 * The worker is still unregistered, and that part is load-bearing rather than
 * incidental: `registration.update()` only reinstalls when the worker *script*
 * changed, so on an unchanged build it would leave the precache deleted and
 * never refilled — the app would work online and silently stop working
 * offline. A fresh registration always installs, and installing is what
 * repopulates the precache. `registerSW({ immediate: true })` in main.tsx
 * re-registers on the next load, so offline is back a second or two after the
 * app is usable again.
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

  report('downloading');
  // Warm first, unregister second. Doing it this way means the navigation
  // below is answered from the HTTP cache even though no worker is installed
  // at that moment, which is what removes the blank screen.
  await warmShell();
  await unregisterWorkers();

  report('reloading');
  // A plain reload can still be answered from the HTTP cache, which on GitHub
  // Pages means the old index.html and therefore the old asset hashes. A
  // one-shot query param guarantees a fresh document; main.tsx strips it back
  // out so it never lingers in the address bar.
  const url = new URL(window.location.href);
  url.searchParams.set(RELOAD_PARAM, Date.now().toString(36));
  window.location.replace(url.toString());
}

/**
 * Drops the workers so the next load installs a fresh one.
 *
 * `update()` is not a substitute: it is a no-op when the script is unchanged,
 * which is exactly the case this button exists for, and the precache would
 * stay empty.
 */
async function unregisterWorkers(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  } catch {
    /* a browser that won't list its workers still gets a warm reload */
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
async function warmShell(): Promise<void> {
  const base = new URL(import.meta.env.BASE_URL, window.location.href);
  const urls = new Set<string>([base.toString()]);

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
