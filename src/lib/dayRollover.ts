import { useEffect } from 'react';
import { useApp } from '@/stores/useApp';

/** How often to re-check the wall clock while the app is open. */
const TICK_MS = 60_000;

/**
 * Keeps the app on the actual current day.
 *
 * `selectedDate` is read from the clock once, when the store is created. A PWA
 * that stays in the background overnight — which is the normal case for a
 * habit tracker opened every morning — would come back still showing
 * yesterday, and log the day's first meal onto the wrong date.
 *
 * Three triggers, because none of them is sufficient alone: `focus` and
 * `visibilitychange` catch the app being resumed, which is how the rollover
 * is nearly always noticed; the interval catches the app being left open
 * across midnight, where neither event fires.
 *
 * A day the user chose themselves is never moved — only a `selectedDate` that
 * is still sitting on what used to be today rolls forward.
 */
export function useDayRollover(): void {
  useEffect(() => {
    const check = () => useApp.getState().syncToToday();

    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };

    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', onVisible);
    const interval = setInterval(check, TICK_MS);
    // The app may have been restored from the bfcache with a stale date
    // already on screen, so check once on mount too.
    check();

    return () => {
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(interval);
    };
  }, []);
}
