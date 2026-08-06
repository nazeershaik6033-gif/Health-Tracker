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
        <span className="text-[13px] text-secondary">{label}:</span>
        <span className={`tabular text-[13px] font-semibold ${over ? 'text-red-600' : ''}`}>
          {asPercent ? `${pct}%` : `${Math.round(value)}/${Math.round(target)} ${unit}`}
        </span>
      </div>
      <div className="surface-sunken mt-1.5 h-1.5 w-full overflow-hidden rounded-full">
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${width}%`, background: over ? '#dc2626' : color }}
        />
      </div>
    </div>
  );
}
