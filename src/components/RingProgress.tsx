import type { ReactNode } from 'react';

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
 * Circular progress ring used for calories and every tracker tile.
 * Over-target is shown as a second, darker arc riding on the full ring so
 * "1,800 of 1,500" reads as overshoot rather than silently clamping at 100%.
 */
export function RingProgress({
  value,
  size = 56,
  stroke = 4,
  color = 'var(--color-ring-calorie)',
  trackColor = 'var(--surface-sunken)',
  children,
  className = '',
  label,
}: Props) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const primary = Math.max(0, Math.min(1, value));
  const overflow = Math.max(0, Math.min(1, value - 1));

  return (
    <div
      className={`relative inline-flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={trackColor} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - primary)}
          style={{ transition: 'stroke-dashoffset 500ms var(--ease-settle)' }}
        />
        {overflow > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="color-mix(in srgb, var(--surface-card) 25%, #b91c1c)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - overflow)}
            style={{ transition: 'stroke-dashoffset 500ms var(--ease-settle)' }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}
