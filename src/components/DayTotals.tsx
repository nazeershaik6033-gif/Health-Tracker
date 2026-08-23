import { Link } from 'react-router-dom';
import { RingProgress } from './RingProgress';
import { MacroBar } from './MacroBar';
import { Card } from './ui';
import { IconChevronRight } from './icons';
import type { MacroKey } from '@/lib/macroBreakdown';
import type { Nutrients } from '@/types';

/**
 * A day in one card: calories against target, and all four macros.
 *
 * Shared by Diet and Calendar rather than duplicated. Both answer "how did this
 * day go", and a day that reads one way on today's screen must read the same
 * way when you scroll back to it a month later — which is exactly what two
 * hand-kept copies of this layout would eventually stop doing.
 */
export function DayTotals({
  totals,
  targets,
  burned = 0,
  compact = false,
  macroHref,
}: {
  totals: Nutrients;
  targets: Nutrients;
  /** Workout calories, shown as the second half of the net calculation. */
  burned?: number;
  /** Slightly tighter ring, for screens where this is not the hero element. */
  compact?: boolean;
  /**
   * When given, every figure here links into the breakdown of the items behind
   * it. Without it these are read-only totals — which is all they were, and
   * why "why is my protein over?" had no answer on this screen.
   */
  macroHref?: (key: MacroKey) => string;
}) {
  const net = totals.kcal - burned;
  const left = Math.max(0, targets.kcal - net);

  // Built once and wrapped below rather than rendered by an inline component:
  // a component defined during render is a new type each time, which would
  // remount the ring and replay its animation on every state change.
  const calorieRow = (
    <>
      <RingProgress
        value={net / (targets.kcal || 1)}
        size={compact ? 52 : 56}
        stroke={compact ? 4 : 4.5}
        color="var(--color-ring-calorie)"
        label={macroHref ? undefined : `${Math.round(net)} of ${targets.kcal} calories`}
      >
        <div className="text-center leading-none">
          <p className="tabular text-[13px] font-extrabold">{Math.round(net)}</p>
          <p className="text-[8px] text-muted">kcal</p>
        </div>
      </RingProgress>

      <div className="flex-1">
        <p className="text-[15px] font-bold">{left.toLocaleString()} Cal left</p>
        <p className="tabular text-[12.5px] text-secondary">
          {Math.round(totals.kcal).toLocaleString()} eaten
          {burned > 0 && ` · ${Math.round(burned)} burned`}
        </p>
      </div>

      {net > targets.kcal && (
        <span className="tint-soft tint-danger shrink-0 rounded-lg px-2 py-1 text-[11px] font-bold">
          +{Math.round(net - targets.kcal)}
        </span>
      )}
    </>
  );

  return (
    <Card className="space-y-3.5">
      {macroHref ? (
        <Link
          to={macroHref('kcal')}
          aria-label={`${Math.round(net)} of ${targets.kcal} calories. See what contributed.`}
          className="flex items-center gap-3 rounded-xl transition-transform active:scale-[0.99]"
        >
          {calorieRow}
          <IconChevronRight width={16} height={16} className="shrink-0 text-muted" />
        </Link>
      ) : (
        <div className="flex items-center gap-3">{calorieRow}</div>
      )}

      {/* Absolute figures, not percentages: "58/75 g" says how much protein is
          still missing, where "77%" leaves you to work it out. */}
      <div className="hairline grid grid-cols-2 gap-x-5 gap-y-3 border-t pt-3.5">
        <MacroBar
          label="Protein"
          value={totals.protein}
          target={targets.protein}
          color="var(--color-macro-protein)"
          asPercent={false}
          to={macroHref?.('protein')}
        />
        <MacroBar
          label="Fats"
          value={totals.fat}
          target={targets.fat}
          color="var(--color-macro-fat)"
          asPercent={false}
          to={macroHref?.('fat')}
        />
        <MacroBar
          label="Carbs"
          value={totals.carbs}
          target={targets.carbs}
          color="var(--color-macro-carb)"
          asPercent={false}
          to={macroHref?.('carbs')}
        />
        <MacroBar
          label="Fibre"
          value={totals.fibre}
          target={targets.fibre}
          color="var(--color-macro-fibre)"
          asPercent={false}
          to={macroHref?.('fibre')}
        />
      </div>
    </Card>
  );
}
