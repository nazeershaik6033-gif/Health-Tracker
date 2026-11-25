/**
 * Persistent storage.
 *
 * Everything this app knows lives in IndexedDB on the device. By default a
 * browser treats that as "best effort" and may delete it under storage
 * pressure — and Safari also clears script-written storage for sites not used
 * for a while. Asking for persistence moves the origin out of that pool: once
 * granted, the data goes only when the user clears it themselves.
 *
 * Chrome and Edge decide silently from engagement (an installed app, or one
 * used often, is normally granted), Firefox asks the user once and remembers,
 * Safari grants it to installed home-screen apps. Asking is harmless when it
 * is refused, and a refusal today can become a grant later as engagement
 * grows, so the app asks again on each launch until it has it.
 */

export type PersistState = 'persisted' | 'best-effort' | 'unsupported';

export async function persistState(): Promise<PersistState> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persisted) return 'unsupported';
  try {
    return (await navigator.storage.persisted()) ? 'persisted' : 'best-effort';
  } catch {
    return 'unsupported';
  }
}

/** Requests persistence if not already granted. Resolves to the resulting state. */
export async function requestPersistence(): Promise<PersistState> {
  const now = await persistState();
  if (now !== 'best-effort' || !navigator.storage.persist) return now;
  try {
    return (await navigator.storage.persist()) ? 'persisted' : 'best-effort';
  } catch {
    return 'best-effort';
  }
}

/** Bytes used and available to this origin, where the browser says. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | undefined> {
  try {
    const est = await navigator.storage?.estimate?.();
    if (!est || est.usage === undefined || est.quota === undefined) return undefined;
    return { usage: est.usage, quota: est.quota };
  } catch {
    return undefined;
  }
}
