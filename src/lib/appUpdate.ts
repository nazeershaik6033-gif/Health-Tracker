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
 *   forceReload() — deletes every Cache API entry, unregisters the workers and
 *   reloads past the HTTP cache. The nuclear option for when a cache is wedged.
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
 * Clears the offline cache and reloads. Resolves only if the navigation
 * somehow fails to start — normally the page is gone before that.
 */
export async function forceReload(): Promise<void> {
  if ('caches' in window) {
    try {
      const keys = await caches.keys();
      // Includes the share-target cache, so a photo shared but not yet
      // processed is dropped. Acceptable: this is a deliberate reset, and the
      // alternative is leaving the wedged cache the user is trying to clear.
      await Promise.all(keys.map((key) => caches.delete(key)));
    } catch {
      /* a cache we can't delete shouldn't stop the reload */
    }
  }

  if ('serviceWorker' in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    } catch {
      /* likewise */
    }
  }

  // A plain reload can still be answered from the HTTP cache, which on GitHub
  // Pages means the old index.html and therefore the old asset hashes. A
  // one-shot query param guarantees a fresh document; main.tsx strips it back
  // out so it never lingers in the address bar.
  const url = new URL(window.location.href);
  url.searchParams.set(RELOAD_PARAM, Date.now().toString(36));
  window.location.replace(url.toString());
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
