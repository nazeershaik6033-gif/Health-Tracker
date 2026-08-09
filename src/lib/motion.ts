/**
 * Motion helpers.
 *
 * Everything here is built on platform APIs — no animation library, so the PWA
 * ships nothing extra and still works offline. The global
 * `prefers-reduced-motion` rule in `styles/index.css` neutralises all of it for
 * users who ask for less movement, so nothing below needs its own guard.
 */

export function supportsViewTransitions(): boolean {
  return typeof document !== 'undefined' && 'startViewTransition' in document;
}

/**
 * Runs a DOM update inside a View Transition when the browser has one, and
 * plainly when it doesn't. Safari and Firefox fall through to the direct call,
 * which is the current behaviour — nothing regresses.
 *
 * Use this only where the update genuinely happens inside the callback; a
 * transition cannot animate a change React has already committed.
 */
export function withViewTransition(update: () => void): void {
  if (!supportsViewTransitions() || prefersReducedMotion()) {
    update();
    return;
  }
  document.startViewTransition(update);
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * A short vibration for moments where something committed — a set logged, a
 * barcode read. Generalises the single `navigator.vibrate(40)` that used to
 * live in the barcode scanner.
 *
 * Silent where unsupported (all of iOS Safari), so callers never branch.
 */
export function haptic(pattern: number | number[] = 15): void {
  if (prefersReducedMotion()) return;
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      /* some browsers throw when the page is not visible; not worth surfacing */
    }
  }
}

/** Distinct feels, so a success and a failure aren't the same buzz. */
export const HAPTIC = {
  tap: 10,
  success: [12, 40, 18] as number[],
  warn: [30, 60, 30] as number[],
} as const;

/**
 * Counts a number up to its new value.
 *
 * Paired with `RingProgress`, whose stroke transition is 500ms — matching that
 * duration is what makes the ring and its readout arrive together instead of
 * the number snapping first.
 */
export function animateNumber(
  from: number,
  to: number,
  onFrame: (value: number) => void,
  durationMs = 500,
): () => void {
  if (from === to || prefersReducedMotion()) {
    onFrame(to);
    return () => {};
  }

  let raf = 0;
  const start = performance.now();
  // Same curve as the house easing, so numeric and spatial motion agree.
  const ease = (t: number) => 1 - Math.pow(1 - t, 3);

  const step = (now: number) => {
    const t = Math.min(1, (now - start) / durationMs);
    onFrame(from + (to - from) * ease(t));
    if (t < 1) raf = requestAnimationFrame(step);
  };

  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}
