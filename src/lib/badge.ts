import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/schema';
import { useApp } from '@/stores/useApp';
import type { MealSlot } from '@/types';

/**
 * Badges the installed app's icon with the main meals still to log today.
 *
 * Only meals whose time has come count — a 7 am badge of "3" would be nagging
 * about lunch and dinner — so breakfast counts from 9, lunch from 14 and
 * dinner from 21. Snacks never count; skipping one is not a gap.
 *
 * The Badging API exists in Chrome and Edge on desktop and Android and in
 * installed home-screen apps on iOS 16.4+. Elsewhere this does nothing. A web
 * app cannot run in the background, so the badge is refreshed while the app is
 * open and stays as it was left until the next visit.
 */
const DUE_AT: { slot: MealSlot; hour: number }[] = [
  { slot: 'breakfast', hour: 9 },
  { slot: 'lunch', hour: 14 },
  { slot: 'dinner', hour: 21 },
];

type BadgeNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

export function badgeSupported(): boolean {
  return typeof navigator !== 'undefined' && 'setAppBadge' in navigator;
}

export function useAppBadge(): void {
  const enabled = useApp((s) => s.ready && s.settings.onboardingDone && s.settings.appBadge !== false);
  const todayDate = useApp((s) => s.todayDate);

  const logged = useLiveQuery(
    async () => {
      if (!enabled) return undefined;
      const meals = await db.meals.where('date').equals(todayDate).toArray();
      return new Set(meals.filter((m) => m.items.length > 0).map((m) => m.slot));
    },
    [enabled, todayDate],
  );

  useEffect(() => {
    const nav = navigator as BadgeNavigator;
    if (!badgeSupported()) return;

    const apply = () => {
      if (!enabled || !logged) {
        void nav.clearAppBadge?.().catch(() => {});
        return;
      }
      const hour = new Date().getHours();
      const due = DUE_AT.filter((d) => hour >= d.hour && !logged.has(d.slot)).length;
      const op = due > 0 ? nav.setAppBadge?.(due) : nav.clearAppBadge?.();
      void op?.catch(() => {});
    };

    apply();
    // Hours pass while the app sits open; re-check so lunch becomes due.
    const timer = setInterval(apply, 10 * 60_000);
    return () => clearInterval(timer);
  }, [enabled, logged]);
}
