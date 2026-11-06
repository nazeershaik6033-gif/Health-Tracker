import { useEffect, useId, useState, type ReactNode } from 'react';

interface Props {
  /** 0–1; values above 1 are drawn as a full ring plus an overflow arc. */
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  trackColor?: string;
  children?: ReactNode;
  className?: string;
  label?: string;
}

/**
 * Circular progress ring used for calories and every tracker.
 * Over-target is shown as a second, darker arc riding on the full ring so
 * "1,800 of 1,500" reads as overshoot rather than silently clamping at 100%.
 *
 * The arc is a gradient from a lighter tint of the colour to the colour, and
 * it sweeps in from zero on mount — the stroke transition does the work, the
 * ring just renders empty for its first frame.
 */
export function RingProgress({
  value,
  size = 56,
  stroke = 4,
  color = 'var(--color-ring-calorie)',
  trackColor,
  children,
  className = '',
  label,
}: Props) {
  const id = useId().replace(/:/g, '');
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const shown = mounted && Number.isFinite(value) ? value : 0;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const primary = Math.max(0, Math.min(1, shown));
  const overflow = Math.max(0, Math.min(1, shown - 1));
  const track = trackColor ?? `color-mix(in srgb, ${color} 14%, var(--surface-sunken))`;
  const transition = 'stroke-dashoffset 1.1s cubic-bezier(0.16, 1, 0.3, 1)';

  return (
    <div
      className={`relative inline-flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <defs>
          <linearGradient id={`ring-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" style={{ stopColor: `color-mix(in srgb, ${color} 55%, white)` }} />
            <stop offset="100%" style={{ stopColor: color }} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: track }} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#ring-${id})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - primary)}
          // A zero-length round-capped arc still draws a dot; hide it.
          opacity={primary > 0.001 ? 1 : 0}
          style={{ transition: `${transition}, opacity 0.2s` }}
        />
        {overflow > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="color-mix(in srgb, var(--surface-card) 20%, #dc2626)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - overflow)}
            style={{ transition }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}
