import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { RingProgress } from './RingProgress';

interface Props {
  to: string;
  label: string;
  icon: ReactNode;
  color: string;
  /** 0–1 progress toward the tile's goal. */
  value: number;
  caption?: string;
}

/** Compact tracker tile with a ring — the Weight/Workout/Walk/Sleep/Hydrate row. */
export function TrackerTile({ to, label, icon, color, value, caption }: Props) {
  return (
    <Link
      to={to}
      className="surface-card flex flex-col items-center gap-1.5 px-1 py-3 transition-transform active:scale-[0.97]"
    >
      <RingProgress value={value} size={44} stroke={3} color={color} label={`${label} progress`}>
        <span style={{ color }}>{icon}</span>
      </RingProgress>
      <span className="text-[11px] font-semibold">{label}</span>
      {caption && <span className="tabular text-[10px] text-muted">{caption}</span>}
    </Link>
  );
}

/**
 * Wide "Your Trackers" row used on the expanded list — name on the left,
 * status underneath, and either a + or a chevron on the right depending on
 * whether the tracker is set up yet.
 */
export function TrackerRow({
  to,
  label,
  status,
  icon,
  color,
  onQuickAdd,
}: {
  to: string;
  label: string;
  status: string;
  icon: ReactNode;
  color: string;
  onQuickAdd?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 py-3">
      <div
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border"
        style={{ borderColor: `color-mix(in srgb, ${color} 35%, transparent)`, color }}
      >
        {icon}
      </div>
      <Link to={to} className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-bold">{label}</p>
        <p className="truncate text-[13px] text-secondary">{status}</p>
      </Link>
      {onQuickAdd ? (
        <button
          type="button"
          onClick={onQuickAdd}
          aria-label={`Add ${label}`}
          className="hairline flex h-8 w-8 items-center justify-center rounded-lg border text-secondary transition-colors hover:border-brand-500 hover:text-brand-600"
        >
          <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      ) : (
        <Link to={to} aria-label={`Open ${label}`} className="p-2 text-muted">
          <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="m9 5 7 7-7 7" />
          </svg>
        </Link>
      )}
    </div>
  );
}
