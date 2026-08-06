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
  toast?: ToastState;
  /** Slot pre-selected when the user came from the meal picker. */
  pendingSlot?: MealSlot;

  init: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  setSettings: (patch: Partial<Settings>) => Promise<void>;
  setSelectedDate: (date: string) => void;
  setPendingSlot: (slot?: MealSlot) => void;
  showToast: (t: Omit<ToastState, 'id'>) => void;
  dismissToast: () => void;
}

let toastSeq = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  settings: DEFAULT_SETTINGS,
  selectedDate: today(),

  async init() {
    await ensureSeeded();
    const [profile, settings] = await Promise.all([getProfile(), getSettings()]);
    set({ profile, settings, ready: true });
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
