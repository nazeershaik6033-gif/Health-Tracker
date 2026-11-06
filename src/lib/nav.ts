import { useNavigate } from 'react-router-dom';

/**
 * History-depth helpers: which way a non-tab navigation moved, and a Back
 * that pops instead of pushing.
 *
 * BrowserRouter stamps every history entry with an `idx`, so comparing the
 * incoming entry's idx with the last one tells a push from a pop without any
 * bookkeeping of our own — and it covers the browser's back button and the
 * iOS edge swipe too, which an onClick handler never sees.
 */

/** pathname per history idx, so Back can tell whether popping lands where it means to go. */
const stack: string[] = [];

export function historyIdx(): number {
  const state = window.history.state as { idx?: number } | null;
  return typeof state?.idx === 'number' ? state.idx : 0;
}

/** Called once per committed navigation, from App. */
export function recordEntry(path: string): void {
  const idx = historyIdx();
  stack[idx] = path;
  stack.length = idx + 1;
}

/**
 * 'push' when the history stack grew, 'pop' when it shrank (or the move was
 * flagged as a back-navigation), 'none' for a replace.
 */
export function depthDirection(
  fromIdx: number,
  toIdx: number,
  state: unknown,
): 'push' | 'pop' | 'none' {
  if ((state as { dir?: string } | null)?.dir === 'back') return 'pop';
  if (toIdx > fromIdx) return 'push';
  if (toIdx < fromIdx) return 'pop';
  return 'none';
}

/**
 * Back that behaves like a native back: when the previous history entry is
 * the screen we'd go to anyway, pop it (so the stack doesn't grow and the
 * system back gesture stays truthful). Otherwise navigate there, flagged as a
 * backwards move so the transition still slides the right way.
 */
export function useGoBack() {
  const navigate = useNavigate();
  /**
   * `fallback` is where back leads. Pass -1 to mean "wherever the user came
   * from": that pops when there is an in-app entry to pop to, and goes Home
   * when there isn't — a screen opened from a deep link, the share sheet or a
   * reload has nothing behind it, and a bare navigate(-1) there either does
   * nothing or leaves the app.
   */
  return (fallback: string | -1) => {
    const idx = historyIdx();
    if (fallback === -1) {
      // Router idx starts at 0 on the app's first entry, so > 0 means an in-app page is behind us.
      if (idx > 0) navigate(-1);
      else navigate('/', { state: { dir: 'back' } });
      return;
    }
    const target = fallback.split('?')[0];
    if (idx > 0 && stack[idx - 1] === target) navigate(-1);
    else navigate(fallback, { state: { dir: 'back' } });
  };
}

/**
 * Warms lazy route chunks while the user is idle on the first screen, so the
 * first visit to each screen doesn't flash a loading skeleton. One at a time,
 * each in its own idle slot, so launch never competes with it.
 */
export function prefetchWhenIdle(loaders: Array<() => Promise<unknown>>) {
  const schedule = (fn: () => void) =>
    'requestIdleCallback' in window
      ? window.requestIdleCallback(fn, { timeout: 2000 })
      : setTimeout(fn, 120);
  let i = 0;
  const next = () => {
    if (i >= loaders.length) return;
    void loaders[i++]()
      .catch(() => {
        /* offline or a stale deploy — the real navigation will retry */
      })
      .finally(() => schedule(next));
  };
  schedule(next);
}
