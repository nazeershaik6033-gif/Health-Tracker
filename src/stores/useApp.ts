import { create } from 'zustand';
import type { MealSlot, Profile, Settings } from '@/types';
import { DEFAULT_SETTINGS, ensureSeeded, getProfile, getSettings, saveSettings } from '@/db/repo';
import { today } from '@/lib/date';

interface ToastState {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
}

interface AppState {
  ready: boolean;
  profile?: Profile;
  settings: Settings;
  /** The day every screen is currently showing. */
  selectedDate: string;
  /** What the app last believed the current date to be. See `syncToToday`. */
  todayDate: string;
  toast?: ToastState;
  /** Slot pre-selected when the user came from the meal picker. */
  pendingSlot?: MealSlot;

  init: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  setSettings: (patch: Partial<Settings>) => Promise<void>;
  setSelectedDate: (date: string) => void;
  syncToToday: () => void;
  setPendingSlot: (slot?: MealSlot) => void;
  showToast: (t: Omit<ToastState, 'id'>) => void;
  dismissToast: () => void;
}

let toastSeq = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
/** Shared across concurrent init() calls so startup work runs exactly once. */
let initPromise: Promise<void> | undefined;

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  settings: DEFAULT_SETTINGS,
  selectedDate: today(),
  todayDate: today(),

  async init() {
    // StrictMode invokes the init effect twice in dev, and a user can open two
    // tabs at once. Share one in-flight promise so the work happens once.
    if (initPromise) return initPromise;

    initPromise = (async () => {
      try {
        await ensureSeeded();
      } catch (err) {
        // Seeding is best-effort. A failure here must not strand the app on
        // its loading skeleton — the bundled food list may be incomplete, but
        // everything else still works.
        console.error('Food database seeding failed:', err);
      }

      try {
        const [profile, settings] = await Promise.all([getProfile(), getSettings()]);
        set({ profile, settings, ready: true });
      } catch (err) {
        // IndexedDB can be unavailable outright (private browsing in some
        // browsers, storage disabled). Come up with defaults rather than
        // rendering nothing at all.
        console.error('Could not read local data:', err);
        set({ settings: DEFAULT_SETTINGS, ready: true });
      }
    })();

    return initPromise;
  },

  async refreshProfile() {
    set({ profile: await getProfile() });
  },

  async refreshSettings() {
    set({ settings: await getSettings() });
  },

  async setSettings(patch) {
    await saveSettings(patch);
    set({ settings: { ...get().settings, ...patch } });
  },

  setSelectedDate(date) {
    set({ selectedDate: date });
  },

  /**
   * Rolls the app onto the new day once the clock has passed midnight.
   *
   * Only moves `selectedDate` if it was still pinned to what the app thought
   * today was. Someone reviewing last Tuesday keeps looking at last Tuesday —
   * having the screen jump to today underneath them would be worse than the
   * stale date this fixes.
   */
  syncToToday() {
    const now = today();
    const { todayDate, selectedDate } = get();
    if (now === todayDate) return;
    set({
      todayDate: now,
      selectedDate: selectedDate === todayDate ? now : selectedDate,
    });
  },

  setPendingSlot(slot) {
    set({ pendingSlot: slot });
  },

  showToast(t) {
    if (toastTimer) clearTimeout(toastTimer);
    const id = ++toastSeq;
    set({ toast: { ...t, id } });
    // Undo needs long enough to actually reach for, short enough not to linger.
    toastTimer = setTimeout(() => {
      if (get().toast?.id === id) set({ toast: undefined });
    }, 5000);
  },

  dismissToast() {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: undefined });
  },
}));

/** True once the user has finished onboarding and has a profile row. */
export const useOnboarded = () =>
  useApp((s) => s.ready && Boolean(s.profile) && s.settings.onboardingDone);
