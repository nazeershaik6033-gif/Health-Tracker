import { createElement, useEffect, useRef, type CSSProperties } from 'react';
import { animateNumber } from '@/lib/motion';

interface Props {
  /** The target number. Changing it re-targets the animation in flight. */
  value: number;
  /** Renders the eased sample. Round or format here — the value is fractional. */
  format?: (n: number) => string;
  className?: string;
  style?: CSSProperties;
  /** Rendered element. A span by default; pass 'p' where a block is wanted. */
  as?: 'span' | 'p' | 'div';
}

/**
 * Eases a number toward its new value instead of snapping to it.
 *
 * The eased sample is written straight to the DOM node rather than held in
 * React state. State meant a full render — reconcile and commit — for every
 * counter on screen on every one of the ~34 frames an animation lasts, all of
 * it on the main thread and all of it competing with whatever scroll or
 * screen transition was running at the same time. The day summary alone shows
 * five of these at once, so a single logged meal used to schedule ~170
 * renders. Writing `textContent` is one DOM mutation with no reconciliation
 * behind it, and text is not a compositor property, so nothing is lost by
 * bypassing React here.
 *
 * The JSX child is deliberately the value at *mount* and never changes, so
 * React's reconciler sees identical children on every re-render and leaves the
 * node's text alone — which is what lets the imperative writes survive. If it
 * rendered `value` instead, a prop change would snap the digits to the target
 * before the effect could animate away from it.
 *
 * `current` holds what is actually painted right now, so a change arriving
 * mid-flight starts from the digits on screen rather than the last settled
 * value — rapid logging chains smoothly instead of jumping back.
 *
 * `prefersReducedMotion` is handled inside `animateNumber`, which calls back
 * once with the target, so nothing here needs its own guard.
 *
 * One constraint this buys: because only `value` re-runs the animation,
 * `format` must be a pure function of the number it is handed. A formatter
 * that closes over something else that can change on its own — a unit toggle,
 * a locale — would not repaint until the value moved. Every caller today
 * formats from `n` alone; a formatter that needs to react to anything else
 * should take that state as part of `value`, or use a plain span.
 */
export function CountUp({ value, format, className, style, as = 'span' }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const current = useRef(value);
  const initial = useRef(value);

  // Read through a ref so a caller passing an inline arrow — which is most of
  // them — does not restart the animation on every parent render.
  const formatRef = useRef(format);
  formatRef.current = format;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    return animateNumber(current.current, value, (n) => {
      current.current = n;
      const fmt = formatRef.current;
      const text = fmt ? fmt(n) : String(Math.round(n));
      // Most frames of a slow count land on the same rounded string; skipping
      // the write there keeps this off the paint path entirely.
      if (node.textContent !== text) node.textContent = text;
    });
  }, [value]);

  const text = format ? format(initial.current) : String(Math.round(initial.current));
  return createElement(as as 'span', { ref, className, style }, text);
}
