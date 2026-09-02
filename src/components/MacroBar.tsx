import { Link } from 'react-router-dom';
import { CountUp } from './CountUp';
import { IconChevronRight } from './icons';

interface Props {
  label: string;
  value: number;
  target: number;
  color: string;
  unit?: string;
  /** Show "12%" like the reference app instead of "24 / 100 g". */
  asPercent?: boolean;
  /**
   * Makes the whole bar a link into the breakdown of this figure. Without it
   * the number is a dead end — you can see protein is over target but not
   * which item put it there.
   */
  to?: string;
}

export function MacroBar({ label, value, target, color, unit = 'g', asPercent = true, to }: Props) {
  const pct = target > 0 ? Math.round((value / target) * 100) : 0;
  const width = Math.max(0, Math.min(100, pct));
  const over = pct > 100;

  const body = (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-0.5 text-[13px] text-secondary">
          {label}:
          {to && <IconChevronRight width={12} height={12} className="text-muted" />}
        </span>
        <span className={`tabular text-[13px] font-semibold ${over ? 'text-red-600' : ''}`}>
          {/* Counted either way, over the same 560ms the bar beside it takes
              to grow, so the number and the fill arrive together rather than
              the digits snapping ahead of the bar. Only the figure that moves
              is counted — the target it is measured against is fixed. */}
          {asPercent ? (
            <CountUp value={pct} format={(n) => `${Math.round(n)}%`} />
          ) : (
            <>
              <CountUp value={value} />/{Math.round(target)} {unit}
            </>
          )}
        </span>
      </div>
      <div className="surface-sunken mt-1.5 h-1.5 w-full overflow-hidden rounded-full">
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${width}%`, background: over ? '#dc2626' : color }}
        />
      </div>
    </>
  );

  if (!to) return <div>{body}</div>;

  return (
    <Link
      to={to}
      aria-label={`${label}: ${Math.round(value)} of ${Math.round(target)} ${unit}. See what contributed.`}
      className="block rounded-lg transition-transform active:scale-[0.98]"
    >
      {body}
    </Link>
  );
}
