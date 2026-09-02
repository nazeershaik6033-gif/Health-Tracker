import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
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

/** Travel past which a release dismisses, as a fraction of panel height. */
const DISMISS_TRAVEL = 0.32;
/** Downward flick speed (px/ms) that dismisses regardless of travel. */
const DISMISS_VELOCITY = 0.55;
/** Downward movement before a drag engages, so a tap is never read as one. */
const DRAG_SLOP = 6;

interface Drag {
  startY: number;
  lastY: number;
  lastT: number;
  velocity: number;
  /** False until the pointer has moved past the slop threshold. */
  engaged: boolean;
}

export function BottomSheet({ open, onClose, title, children, footer, maxHeight = '85%' }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  // The sheet used to unmount the instant `open` went false, so it vanished
  // with no exit. Rendering through a short closing phase gives it one.
  const [closing, setClosing] = useState(false);
  const [mounted, setMounted] = useState(open);
  // A drag dismiss finishes from wherever the finger left the panel. The
  // sheet-down keyframes can't do that — a CSS animation outranks an inline
  // style, so it would yank the panel back to 0 and replay the whole slide.
  // This flag swaps those classes out for a transition off the live position.
  const [dragExit, setDragExit] = useState(false);
  const exitTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Drives the fit below. iOS does not shrink the layout viewport for the
  // keyboard, so the footer holding the only Add/Save button ended up behind
  // it with no way to scroll to it — the sheet could be opened and edited but
  // never confirmed.
  const viewport = useViewportRect();

  useEffect(() => {
    if (open) {
      clearTimeout(exitTimer.current);
      setMounted(true);
      setClosing(false);
      setDragExit(false);
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

  const keyboard = viewport.keyboard;

  // The sheet has shrunk to fit above the keyboard, so the field the user just
  // tapped may now be out of view inside the sheet's own scroller. The browser
  // does this for the page but not for a nested scroll container.
  useEffect(() => {
    if (!open || keyboard === 0) return;
    const id = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return;
      if (!bodyRef.current?.contains(active)) return;
      active.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(id);
  }, [open, keyboard]);

  // Make the overlay's bottom edge land exactly on the visible bottom edge,
  // whether that is short of `inset: 0` (Safari's chrome mid-animation) or
  // well above it (the keyboard is up).
  //
  // Measured, never computed. Browsers disagree about what `position: fixed`
  // is anchored to — Chromium uses the layout viewport, iOS Safari often uses
  // the visual one — so any arithmetic from `innerHeight` and `offsetTop` is
  // right on one and wrong on the other. Reading back where the element truly
  // landed is correct on both. That is also why the panel is no longer offset
  // by `visualViewport.offsetTop`: where Safari had already applied it, doing
  // so again pushed the sheet down and took its footer off the screen.
  //
  // Resetting the height before each measurement is what makes this safe to
  // run on every viewport event: each pass recomputes from the natural size,
  // so an early bad sample corrects itself instead of accumulating.
  useEffect(() => {
    const el = overlayRef.current;
    const vv = window.visualViewport;
    if (!el || !vv) return;

    const sync = () => {
      el.style.height = '';
      const rect = el.getBoundingClientRect();
      const delta = vv.offsetTop + vv.height - rect.bottom;
      if (Math.abs(delta) > 0.5) el.style.height = `${rect.height + delta}px`;
    };

    sync();
    // iOS settles the viewport over roughly a second after the sheet opens or
    // the keyboard moves, and fires no event once it lands — hence the fixed
    // re-measure points.
    const timers = [120, 500, 1200].map((ms) => setTimeout(sync, ms));
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    window.addEventListener('orientationchange', sync);

    return () => {
      timers.forEach(clearTimeout);
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
      window.removeEventListener('orientationchange', sync);
    };
  }, [mounted, keyboard]);

  // ------------------------------------------------------------ drag to close
  //
  // Driven straight through the DOM rather than React state: a re-render per
  // pointermove cannot keep up with a finger on a 120Hz display, and the panel
  // visibly lags behind the touch. Writing transform directly keeps it locked
  // to the pointer at whatever rate the device runs.
  //
  // Where a drag may start from — and what it must not steal — is decided by
  // `startDrag` below.

  const panelHeight = () => panelRef.current?.offsetHeight || 1;

  const endDrag = (settle: boolean) => {
    const panel = panelRef.current;
    drag.current = null;
    if (!panel) return;
    panel.classList.remove('sheet-dragging');
    if (!settle) return;
    panel.style.transition = 'transform 420ms var(--ease-settle)';
    panel.style.transform = 'translate3d(0, 0, 0)';
    if (scrimRef.current) {
      scrimRef.current.style.transition = 'opacity var(--dur-scrim) var(--ease-standard)';
      scrimRef.current.style.opacity = '1';
    }
  };

  /**
   * `from: 'handle'` is the grab handle and title strip, which drag
   * unconditionally — that is the affordance the bar is there to advertise,
   * and it works however far the body is scrolled.
   *
   * `from: 'body'` is the content, which drags only from the top of its
   * scroll and only off non-interactive targets. Without the second rule a
   * sheet that is a list of buttons — the meal picker, the portion sheet —
   * could never be dragged at all, since every touch would land on a control;
   * without the first, capturing a tap into a text field fights the browser's
   * own focus and keyboard handling.
   */
  const startDrag = (e: PointerEvent<HTMLDivElement>, from: 'handle' | 'body') => {
    if (closing) return;
    if (from === 'body') {
      const body = bodyRef.current;
      if (!body || body.scrollTop > 0) return;
      if (
        (e.target as HTMLElement).closest(
          'input,textarea,select,button,a,[contenteditable="true"]',
        )
      ) {
        return;
      }
    }
    drag.current = {
      startY: e.clientY,
      lastY: e.clientY,
      lastT: performance.now(),
      velocity: 0,
      engaged: false,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* Safari throws if the pointer is already gone; the drag simply won't start. */
    }
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const panel = panelRef.current;
    if (!d || !panel) return;

    const dy = e.clientY - d.startY;
    if (!d.engaged) {
      // Downward past the slop only: an upward move on the body is the start
      // of a scroll, and stealing it would make the sheet impossible to read.
      if (dy < DRAG_SLOP) return;
      d.engaged = true;
      panel.classList.add('sheet-dragging');
    }

    const now = performance.now();
    const dt = now - d.lastT;
    if (dt > 0) {
      d.velocity = (e.clientY - d.lastY) / dt;
      d.lastT = now;
      d.lastY = e.clientY;
    }

    const y = Math.max(0, dy);
    panel.style.transform = `translate3d(0, ${y}px, 0)`;
    // Scrim fades in step with travel, so the page behind reappears as the
    // sheet leaves rather than snapping back at the end of the gesture.
    if (scrimRef.current) {
      scrimRef.current.style.opacity = String(Math.max(0, 1 - y / (panelHeight() * 0.9)));
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    const panel = panelRef.current;
    if (!d || !panel) {
      drag.current = null;
      return;
    }
    if (!d.engaged) {
      endDrag(false);
      return;
    }

    const y = Math.max(0, d.lastY - d.startY);
    // Either dragged far enough, or flicked hard enough to mean it.
    if (y > panelHeight() * DISMISS_TRAVEL || d.velocity > DISMISS_VELOCITY) {
      endDrag(false);
      // Carry on from where the finger let go rather than restarting the
      // slide. `closing` still runs the same EXIT_MS timer, so the panel is
      // gone by the time the parent unmounts it either way.
      setDragExit(true);
      panel.style.transition = `transform ${EXIT_MS}ms cubic-bezier(0.4, 0, 1, 1)`;
      panel.style.transform = 'translate3d(0, 100%, 0)';
      if (scrimRef.current) {
        scrimRef.current.style.transition = `opacity ${EXIT_MS}ms var(--ease-standard)`;
        scrimRef.current.style.opacity = '0';
      }
      requestClose();
      return;
    }
    endDrag(true);
  };

  if (!mounted) return null;

  return (
    <div ref={overlayRef} className="fixed inset-0 z-50 flex items-end justify-center">
      {/* Fixed rather than filling the overlay: with the keyboard up the
          overlay is only the visible strip, and the scrim should still cover
          whatever sits below it. */}
      <div
        ref={scrimRef}
        className={`fixed inset-0 bg-black/40 ${
          dragExit ? '' : closing ? 'animate-fade-out' : 'animate-fade-in'
        }`}
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
          dragExit ? '' : closing ? 'animate-sheet-down' : 'animate-sheet-up'
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
        <div
          onPointerDown={(e) => startDrag(e, 'handle')}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          // The strip is the drag surface, so it must not also scroll the page.
          style={{ touchAction: 'none' }}
        >
          <div className="flex justify-center pt-3 pb-1">
            <div className="surface-sunken h-1 w-10 rounded-full" />
          </div>
          {title && (
            <h2 className="px-5 pt-2 pb-2 text-[17px] font-bold tracking-tight">{title}</h2>
          )}
        </div>
        {/* pt-0.5 rather than 0: a child with a negative top margin would
            otherwise sit above scrollTop 0, where it is unreachable and gets
            clipped by the overflow. */}
        <div
          ref={bodyRef}
          onPointerDown={(e) => startDrag(e, 'body')}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="scroll-y min-h-0 flex-1 px-5 pt-0.5 pb-2"
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
