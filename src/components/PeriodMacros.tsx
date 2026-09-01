import { MacroBar } from './MacroBar';
import { periodNutrients, periodTargets } from '@/lib/nutrition';
import {
  DAY_PERIOD_LABEL,
  DAY_PERIOD_SLOTS,
  MEAL_SLOT_LABEL,
  type DayPeriod,
  type Meal,
  type Profile,
} from '@/types';

interface Props {
  period: DayPeriod;
  /** Every meal logged on the day — the period picks out its own slots. */
  meals: Meal[];
  profile: Profile | undefined;
  id?: string;
}

/**
 * The day card's four macro bars, scoped to one part of the day. Slots on
 * their own only ever showed calories, so a protein or fibre shortfall could
 * only be read against the whole day — too late to fix by dinner.
 */
export function PeriodMacros({ period, meals, profile, id }: Props) {
  const eaten = periodNutrients(meals, period);
  const targets = periodTargets(profile, period);
  const slots = DAY_PERIOD_SLOTS[period].map((slot) => MEAL_SLOT_LABEL[slot]).join(' + ');

  return (
    <div id={id} className="surface-sunken mt-2.5 rounded-xl px-3 py-3">
      <p className="mb-2.5 text-[11.5px] font-semibold tracking-wide text-muted uppercase">
        {DAY_PERIOD_LABEL[period]} · {slots}
      </p>
      <div className="grid grid-cols-2 gap-x-5 gap-y-3">
        <MacroBar
          label="Protein"
          value={eaten.protein}
          target={targets.protein}
          color="var(--color-macro-protein)"
          asPercent={false}
        />
        <MacroBar
          label="Fats"
          value={eaten.fat}
          target={targets.fat}
          color="var(--color-macro-fat)"
          asPercent={false}
        />
        <MacroBar
          label="Carbs"
          value={eaten.carbs}
          target={targets.carbs}
          color="var(--color-macro-carb)"
          asPercent={false}
        />
        <MacroBar
          label="Fibre"
          value={eaten.fibre}
          target={targets.fibre}
          color="var(--color-macro-fibre)"
          asPercent={false}
        />
      </div>
    </div>
  );
}
