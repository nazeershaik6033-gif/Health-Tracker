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

/** Matches `--dur-count` in styles/index.css. */
export const COUNT_MS = 560;

/**
 * Counts a number up to its new value.
 *
 * Eases over 560ms with a cubic ease-out — the same curve and duration the
 * Premium tracker uses, so a number and the ring beside it agree.
 *
 * Re-targeting is the part that matters: `from` is whatever the caller is
 * currently displaying, not the last settled value, so a second change
 * arriving mid-flight continues from where the digits actually are instead of
 * snapping back to the old start.
 */
export function animateNumber(
  from: number,
  to: number,
  onFrame: (value: number) => void,
  durationMs = COUNT_MS,
): () => void {
  if (from === to || !Number.isFinite(to) || prefersReducedMotion()) {
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
    // Land on the exact target rather than the last eased sample, so a
    // counter always finishes on the real number.
    else onFrame(to);
  };

  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

/**
 * Which way a screen transition should travel, given where navigation came
 * from and where it went.
 *
 * `order` is the bottom-nav tab order. A move along it is a sideways step and
 * animates as one; anything else — a drill-down into a tracker, an editor, a
 * route that isn't a tab at all — returns 'none' and gets the plain fade-up,
 * because a horizontal slide would imply a step along a bar the user never
 * touched.
 */
export function routeDirection(
  from: string,
  to: string,
  order: readonly string[],
): 'left' | 'right' | 'none' {
  if (from === to) return 'none';
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  if (a < 0 || b < 0) return 'none';
  return b > a ? 'right' : 'left';
}

/**
 * Samples the real frame rate by counting animation frames over a window.
 *
 * Deliberately not a per-frame delta: an instantaneous 1/dt swings wildly and
 * reads as noise. Counting whole frames across ~500ms gives a number stable
 * enough to tell 120 from 60 from a genuine stall, which is the whole point of
 * having it on screen.
 *
 * Returns a stop function. Reports nothing after it is called.
 */
export function sampleFrameRate(
  onSample: (fps: number) => void,
  windowMs = 500,
): () => void {
  let raf = 0;
  let frames = 0;
  let windowStart = performance.now();
  let stopped = false;

  const tick = (now: number) => {
    if (stopped) return;
    frames += 1;
    const elapsed = now - windowStart;
    if (elapsed >= windowMs) {
      onSample(Math.round((frames * 1000) / elapsed));
      frames = 0;
      windowStart = now;
    }
    raf = requestAnimationFrame(tick);
  };

  raf = requestAnimationFrame(tick);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
  };
}
