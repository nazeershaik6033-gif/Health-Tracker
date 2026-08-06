import { useEffect } from 'react';
import type { Settings } from '@/types';

/**
 * Applies the theme to <html>. Kept out of React state because the class must
 * be on the document element (Tailwind's dark variant + our CSS vars both key
 * off it), and because the OS can change it while the app is open.
 */
export function useTheme(theme: Settings['theme']) {
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches);
      root.classList.toggle('dark', dark);
      document
        .querySelector('meta[name="theme-color"]:not([media])')
        ?.setAttribute('content', dark ? '#0B1210' : '#14A06A');
    };

    apply();
    if (theme !== 'system') return;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
}
