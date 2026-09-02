import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { prefersReducedMotion } from '@/lib/motion';

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** Sticky footer that stays visible above the fold, e.g. "Track For Dinner". */
  footer?: ReactNode;
  maxHeight?: string;
}

/** Matches the sheet-down / fade-out durations in styles/index.css. */
const EXIT_MS = 220;

export function BottomSheet({ open, onClose, title, children, footer, maxHeight = '85dvh' }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  // The sheet used to unmount the instant `open` went false, so it vanished
  // with no exit. Rendering through a short closing phase gives it one.
  const [closing, setClosing] = useState(false);
  const [mounted, setMounted] = useState(open);
  const exitTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (open) {
      clearTimeout(exitTimer.current);
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    if (prefersReducedMotion()) {
      setMounted(false);
      return;
    }
    setClosing(true);
    exitTimer.current = setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, EXIT_MS);
    return () => clearTimeout(exitTimer.current);
  }, [open, mounted]);

  // Let the exit play before the parent tears the content down.
  const requestClose = useCallback(() => {
    if (closing) return;
    onClose();
  }, [closing, onClose]);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    document.addEventListener('keydown', onKey);

    // Lock the page behind the sheet so iOS doesn't scroll it under the panel.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Move focus in so the sheet is reachable by keyboard and screen readers.
    const focusTimer = setTimeout(() => panelRef.current?.focus(), 50);

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      clearTimeout(focusTimer);
    };
  }, [open, requestClose]);

  if (!mounted) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div
        className={`absolute inset-0 bg-black/40 ${closing ? 'animate-fade-out' : 'animate-fade-in'}`}
        onClick={requestClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative flex w-full max-w-lg flex-col outline-none ${
          closing ? 'animate-sheet-down' : 'animate-sheet-up'
        }`}
        style={{
          maxHeight,
          background: 'var(--surface-card)',
          borderTopLeftRadius: 'var(--radius-sheet)',
          borderTopRightRadius: 'var(--radius-sheet)',
        }}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="surface-sunken h-1 w-10 rounded-full" />
        </div>
        {title && (
          <h2 className="px-5 pt-2 pb-2 text-[17px] font-bold tracking-tight">{title}</h2>
        )}
        {/* pt-0.5 rather than 0: a child with a negative top margin would
            otherwise sit above scrollTop 0, where it is unreachable and gets
            clipped by the overflow. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-0.5 pb-2">
          {children}
        </div>
        {footer && (
          <div className="hairline border-t px-5 pt-3 pb-safe">{footer}</div>
        )}
        {!footer && <div className="pb-safe" />}
      </div>
    </div>
  );
}
