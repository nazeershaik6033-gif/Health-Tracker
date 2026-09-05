import { MICRO_STATUS_COLOR, MICRO_STATUS_LABEL, formatMicro, type MicroRow } from '@/lib/micros';
import { IconChevronDown } from './icons';

interface Props {
  row: MicroRow;
  expanded: boolean;
  onToggle: () => void;
}

/**
 * One micronutrient against its daily target.
 *
 * Deliberately not `MacroBar`: a macro is a single number chased upward, while
 * a micro needs its own unit, a status word, and — for sodium — a bar that
 * fills toward a limit rather than a goal. Folding both into one component
 * would mean three flags and a worse version of each.
 */
export function MicroBar({ row, expanded, onToggle }: Props) {
  const { def, value, target, pct, status } = row;
  const color = MICRO_STATUS_COLOR[status];
  const width = Math.max(value > 0 ? 2 : 0, Math.min(100, pct));

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className="w-full px-1 py-2.5 text-left"
    >
      <div className="flex items-baseline gap-2">
        <span className="flex-1 text-[13.5px] font-semibold">{def.label}</span>
        <span className="tabular text-[12.5px] text-secondary">
          {formatMicro(def.id, value)} / {formatMicro(def.id, target)}
          {def.limit && ' max'}
        </span>
        <IconChevronDown
          width={15}
          height={15}
          className="shrink-0 text-muted transition-transform duration-200"
          style={{ transform: `rotate(${expanded ? 180 : 0}deg)` }}
        />
      </div>

      <div className="mt-1.5 flex items-center gap-2">
        <div className="surface-sunken h-1.5 flex-1 overflow-hidden rounded-full">
          <div
            className="h-full rounded-full transition-[width] duration-500 ease-out"
            style={{ width: `${width}%`, background: color }}
          />
        </div>
        {/* Fixed width and no wrapping: every row's bar has to end on the same
            vertical line, or twelve of them read as a ragged list rather than a
            comparable set. "On track" is the longest label this has to hold. */}
        <span
          className="tabular w-[86px] shrink-0 text-right text-[11.5px] font-semibold whitespace-nowrap"
          style={{ color }}
        >
          {pct}% · {MICRO_STATUS_LABEL[status]}
        </span>
      </div>
    </button>
  );
}
