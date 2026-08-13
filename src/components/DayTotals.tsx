import { RingProgress } from './RingProgress';
import { MacroBar } from './MacroBar';
import { Card } from './ui';
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
}: {
  totals: Nutrients;
  targets: Nutrients;
  /** Workout calories, shown as the second half of the net calculation. */
  burned?: number;
  /** Slightly tighter ring, for screens where this is not the hero element. */
  compact?: boolean;
}) {
  const net = totals.kcal - burned;
  const left = Math.max(0, targets.kcal - net);

  return (
    <Card className="space-y-3.5">
      <div className="flex items-center gap-3">
        <RingProgress
          value={net / (targets.kcal || 1)}
          size={compact ? 52 : 56}
          stroke={compact ? 4 : 4.5}
          color="var(--color-ring-calorie)"
          label={`${Math.round(net)} of ${targets.kcal} calories`}
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
      </div>

      {/* Absolute figures, not percentages: "58/75 g" says how much protein is
          still missing, where "77%" leaves you to work it out. */}
      <div className="hairline grid grid-cols-2 gap-x-5 gap-y-3 border-t pt-3.5">
        <MacroBar
          label="Protein"
          value={totals.protein}
          target={targets.protein}
          color="var(--color-macro-protein)"
          asPercent={false}
        />
        <MacroBar
          label="Fats"
          value={totals.fat}
          target={targets.fat}
          color="var(--color-macro-fat)"
          asPercent={false}
        />
        <MacroBar
          label="Carbs"
          value={totals.carbs}
          target={targets.carbs}
          color="var(--color-macro-carb)"
          asPercent={false}
        />
        <MacroBar
          label="Fibre"
          value={totals.fibre}
          target={targets.fibre}
          color="var(--color-macro-fibre)"
          asPercent={false}
        />
      </div>
    </Card>
  );
}
