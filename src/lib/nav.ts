import { useLayoutEffect, useRef, useState } from 'react';
import { useNavigate, type Location } from 'react-router-dom';

/**
 * Navigation direction, for route transitions.
 *
 * BrowserRouter stamps every history entry with an `idx`, so comparing the
 * incoming entry's idx with the last one tells a push from a pop without any
 * bookkeeping of our own — and it covers the browser's back button and the
 * iOS edge swipe too, which an onClick handler never sees.
 */
export type NavDirection = 'push' | 'pop' | 'fade';

/** The bottom-nav tabs. Moving between them is lateral, not deeper. */
export const TAB_ROUTES = ['/', '/diet', '/plans', '/streaks'];

const isTab = (path: string) => TAB_ROUTES.includes(path);

/** pathname per history idx, so a back button can tell whether popping lands where it means to go. */
const stack: string[] = [];

function historyIdx(): number {
  const state = window.history.state as { idx?: number } | null;
  return typeof state?.idx === 'number' ? state.idx : 0;
}

export function useNavDirection(location: Location): NavDirection {
  const prev = useRef<{ idx: number; path: string } | null>(null);
  const [dir, setDir] = useState<NavDirection>('fade');

  // Layout effect so the class is right before the browser paints the new
  // screen; a passive effect would let one frame through with the old one.
  useLayoutEffect(() => {
    const idx = historyIdx();
    stack[idx] = location.pathname;
    stack.length = idx + 1;

    const last = prev.current;
    prev.current = { idx, path: location.pathname };
    if (!last || last.path === location.pathname) return;

    const wantsBack = (location.state as { dir?: string } | null)?.dir === 'back';
    let next: NavDirection;
    if (isTab(last.path) && isTab(location.pathname)) next = 'fade';
    else if (wantsBack || idx < last.idx) next = 'pop';
    else if (idx > last.idx) next = 'push';
    else next = 'fade';
    setDir(next);
  }, [location]);

  return dir;
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
 * first visit to each screen doesn't flash a loading skeleton.
 */
export function prefetchWhenIdle(loaders: Array<() => Promise<unknown>>) {
  const run = () => {
    let i = 0;
    const next = () => {
      if (i >= loaders.length) return;
      void loaders[i++]()
        .catch(() => {
          /* offline or a stale deploy — the real navigation will retry */
        })
        .finally(() => schedule(next));
    };
    next();
  };
  const schedule = (fn: () => void) =>
    'requestIdleCallback' in window
      ? window.requestIdleCallback(fn, { timeout: 2000 })
      : setTimeout(fn, 120);
  schedule(run);
}
