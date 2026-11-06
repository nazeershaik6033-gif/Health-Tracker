interface Props {
  label: string;
  value: number;
  target: number;
  color: string;
  unit?: string;
  /** Show "12%" like the reference app instead of "24 / 100 g". */
  asPercent?: boolean;
}

export function MacroBar({ label, value, target, color, unit = 'g', asPercent = true }: Props) {
  const pct = target > 0 ? Math.round((value / target) * 100) : 0;
  const width = Math.max(0, Math.min(100, pct));
  const over = pct > 100;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12.5px] font-medium text-secondary">{label}</span>
        <span className={`tabular text-[13px] font-bold ${over ? 'text-red-500' : ''}`}>
          {asPercent ? `${pct}%` : `${Math.round(value)}/${Math.round(target)} ${unit}`}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-sunken)]">
        <div
          className="h-full origin-left rounded-full transition-[width] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
          style={{
            width: `${width}%`,
            background: over
              ? '#ef4444'
              : `linear-gradient(90deg, color-mix(in srgb, ${color} 65%, white), ${color})`,
            animation: 'grow-x 0.9s cubic-bezier(0.16,1,0.3,1) both',
          }}
        />
      </div>
    </div>
  );
}
