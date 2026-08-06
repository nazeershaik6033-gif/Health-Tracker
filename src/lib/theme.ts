import { useEffect } from 'react';
import type { ResolvedTheme, ThemeId } from '@/types';

/** Browser-chrome colour per theme — the status bar on iOS, the tab strip elsewhere. */
const THEME_COLOR: Record<ResolvedTheme, string> = {
  light: '#14A06A',
  sepia: '#14A06A',
  dark: '#0B1210',
  black: '#000000',
};

/** Themes that need `.dark` — used for `color-scheme` and the skeleton shimmer. */
const IS_DARK: Record<ResolvedTheme, boolean> = {
  light: false,
  sepia: false,
  dark: true,
  black: true,
};

export function resolveTheme(theme: ThemeId, prefersDark: boolean): ResolvedTheme {
  return theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;
}

/**
 * Applies the theme to <html>. Kept out of React state because the attributes
 * must be on the document element (every component reads the CSS vars keyed
 * off it), and because the OS can change it while the app is open.
 *
 * Two hooks are set rather than one: `data-theme` selects the palette, and the
 * `dark` class carries `color-scheme` so form controls, scrollbars and the
 * shimmer overlay follow. Sepia is light-ish, black is dark-ish, so the two
 * are not interchangeable.
 */
export function useTheme(theme: ThemeId) {
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    const apply = () => {
      const resolved = resolveTheme(theme, media.matches);
      root.dataset.theme = resolved;
      root.classList.toggle('dark', IS_DARK[resolved]);
      document
        .querySelector('meta[name="theme-color"]:not([media])')
        ?.setAttribute('content', THEME_COLOR[resolved]);
    };

    apply();
    // Only `system` cares what the OS is doing; the rest are pinned.
    if (theme !== 'system') return;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
}
