import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { prefersReducedMotion } from '@/lib/motion';
import { useViewportRect } from '@/lib/viewport';

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** Sticky footer that stays visible above the fold, e.g. "Track For Dinner". */
  footer?: ReactNode;
  /** Share of the *visible* viewport the panel may take, e.g. '85%'. */
  maxHeight?: string;
}

/** Matches the sheet-down / fade-out durations in styles/index.css. */
const EXIT_MS = 220;

export function BottomSheet({ open, onClose, title, children, footer, maxHeight = '85%' }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // The sheet used to unmount the instant `open` went false, so it vanished
  // with no exit. Rendering through a short closing phase gives it one.
  const [closing, setClosing] = useState(false);
  const [mounted, setMounted] = useState(open);
  const exitTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // The sheet is `position: fixed`, so without this it is laid out against the
  // *layout* viewport — which iOS does not shrink for the keyboard. The footer,
  // holding the only Add/Save button, ended up behind the keyboard with no way
  // to scroll to it: the sheet could be opened and edited but never confirmed.
  // Sizing the overlay to the visual viewport keeps the whole sheet, footer
  // included, inside the part of the screen the user can actually see.
  const viewport = useViewportRect();

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

  // The sheet has shrunk to fit above the keyboard, so the field the user just
  // tapped may now be out of view inside the sheet's own scroller. The browser
  // does this for the page but not for a nested scroll container.
  const keyboard = viewport.keyboard;
  useEffect(() => {
    if (!open || keyboard === 0) return;
    const id = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return;
      if (!scrollRef.current?.contains(active)) return;
      active.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(id);
  }, [open, keyboard]);

  if (!mounted) return null;

  return (
    <div
      className="fixed inset-x-0 z-50 flex items-end justify-center"
      style={{
        // Falls back to the layout viewport until the first measurement lands,
        // and wherever `visualViewport` is missing.
        top: viewport.height ? viewport.top : 0,
        height: viewport.height || undefined,
        bottom: viewport.height ? undefined : 0,
      }}
    >
      {/* Fixed rather than filling this container: the container is only the
          *visible* strip, and the scrim should still cover whatever sits below
          it — the keyboard is opaque, but a pinch-zoomed viewport is not. */}
      <div
        className={`fixed inset-0 bg-black/40 ${closing ? 'animate-fade-out' : 'animate-fade-in'}`}
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
          // With the keyboard up there is little enough room left that holding
          // back 15% of it would push the footer off again.
          maxHeight: keyboard > 0 ? '100%' : maxHeight,
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
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-0.5 pb-2"
        >
          {children}
        </div>
        {footer && (
          <div
            className="hairline shrink-0 border-t px-5 pt-3"
            // The home indicator is not in the way when the keyboard is, and
            // padding for it there just eats room the sheet needs.
            style={{
              paddingBottom:
                keyboard > 0 ? '0.75rem' : 'max(var(--safe-bottom, 0px), 0.5rem)',
            }}
          >
            {footer}
          </div>
        )}
        {!footer && <div className="pb-safe" />}
      </div>
    </div>
  );
}
