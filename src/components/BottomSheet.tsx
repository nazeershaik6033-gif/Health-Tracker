import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
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
const EXIT_MS = 260;
/** Dragged further than this (px), or flicked faster than FLICK, closes. */
const DISMISS_PX = 110;
const FLICK = 0.6;

export function BottomSheet({ open, onClose, title, children, footer, maxHeight = '85vh' }: Props) {
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

  // Drag-to-dismiss on the grab handle and title. Only that strip is a drag
  // target, so it never fights the scrolling content below it.
  const [drag, setDrag] = useState(0);
  const dragging = useRef<{ y: number; t: number; pointer: number } | null>(null);

  const onPointerDown = (e: ReactPointerEvent) => {
    if (closing) return;
    dragging.current = { y: e.clientY, t: performance.now(), pointer: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = dragging.current;
    if (!d || d.pointer !== e.pointerId) return;
    const dy = e.clientY - d.y;
    // Rubber-band upward pulls instead of letting the sheet leave the bottom.
    setDrag(dy > 0 ? dy : dy / 6);
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    const d = dragging.current;
    if (!d || d.pointer !== e.pointerId) return;
    dragging.current = null;
    const dy = e.clientY - d.y;
    const velocity = dy / Math.max(1, performance.now() - d.t);
    if (dy > DISMISS_PX || (dy > 24 && velocity > FLICK)) {
      requestClose();
    } else {
      setDrag(0);
    }
  };

  // A fresh open always starts seated, whatever the last close left behind.
  useEffect(() => {
    if (open) setDrag(0);
  }, [open]);

  if (!mounted) return null;

  const isDragging = dragging.current !== null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div
        className={`absolute inset-0 bg-black/45 backdrop-blur-[2px] ${closing ? 'animate-fade-out' : 'animate-fade-in'}`}
        onClick={requestClose}
        aria-hidden="true"
        style={drag > 0 && !closing ? { opacity: Math.max(0.2, 1 - drag / 400) } : undefined}
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative flex w-full max-w-lg flex-col shadow-[0_-12px_40px_-12px_rgb(0_0_0/0.35)] outline-none ${
          closing ? 'animate-sheet-down' : 'animate-sheet-up'
        }`}
        style={{
          maxHeight,
          background: 'var(--surface-card)',
          borderTopLeftRadius: 'var(--radius-sheet)',
          borderTopRightRadius: 'var(--radius-sheet)',
          ['--drag' as string]: `${Math.max(0, drag)}px`,
          ...(closing
            ? {}
            : {
                transform: drag ? `translate3d(0, ${drag}px, 0)` : undefined,
                transition: isDragging ? 'none' : 'transform 0.45s cubic-bezier(0.34, 1.3, 0.64, 1)',
              }),
        }}
      >
        <div
          className="cursor-grab touch-none select-none active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="flex justify-center pt-3 pb-1.5">
            <div className="h-1.5 w-11 rounded-full bg-[var(--text-muted)] opacity-35" />
          </div>
          {title && (
            <h2 className="px-5 pt-1.5 pb-2.5 text-[18px] font-bold tracking-tight">{title}</h2>
          )}
        </div>
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
