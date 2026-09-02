import { useEffect, useRef, useState, type CSSProperties } from 'react';
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
 * The eased sample is held in a ref as well as state, so a change arriving
 * mid-flight starts from the digits currently on screen rather than the last
 * settled value — rapid logging chains smoothly instead of jumping back.
 *
 * `prefersReducedMotion` is handled inside `animateNumber`, which calls back
 * once with the target, so nothing here needs its own guard.
 */
export function CountUp({ value, format, className, style, as = 'span' }: Props) {
  const [shown, setShown] = useState(value);
  // What is actually painted right now. Read at the start of each animation.
  const current = useRef(value);

  useEffect(() => {
    return animateNumber(current.current, value, (n) => {
      current.current = n;
      setShown(n);
    });
  }, [value]);

  const Tag = as;
  return (
    <Tag className={className} style={style}>
      {format ? format(shown) : Math.round(shown)}
    </Tag>
  );
}
