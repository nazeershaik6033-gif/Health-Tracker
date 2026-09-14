import { useEffect } from 'react';
import type { FontFamilyId, FontSizeId } from '@/types';

/**
 * Applies the chosen typeface and text scale to <html>, mirroring `useTheme`
 * in shape and for the same reason: every component reads CSS vars keyed off
 * the document element, and the choice has to be visible before any single
 * component re-renders.
 */
export function useTypography(fontFamily: FontFamilyId, fontSize: FontSizeId) {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.fontFamily = fontFamily;
    root.dataset.fontSize = fontSize;
  }, [fontFamily, fontSize]);
}
