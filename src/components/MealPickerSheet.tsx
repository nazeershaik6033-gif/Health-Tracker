import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/schema';
import { useApp } from '@/stores/useApp';
import { BottomSheet } from './BottomSheet';
import { IconChevronRight, IconPlus } from './icons';
import { MEAL_SLOTS, MEAL_SLOT_LABEL, type MealSlot } from '@/types';
import { mealNutrients, slotTarget } from '@/lib/nutrition';

const DEFAULT_TITLE: Record<'track' | 'move', string> = {
  track: 'Select a Meal You Would Like to Track',
  move: 'Move to which meal?',
};

/**
 * Slot chooser — each slot shows eaten/target so the user can see at a glance
 * which meal still has room.
 *
 * Serves both "where should this go" questions the app asks: picking a slot to
 * log into, and picking one to move something already logged into. The numbers
 * are what make it worth sharing — when moving a 533 Cal halwa out of a
 * breakfast that is 310 over, seeing which slot has headroom is the whole
 * decision.
 */
export function MealPickerSheet({
  open,
  onClose,
  onPick,
  date,
  intent = 'track',
  title,
  currentSlot,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (slot: MealSlot) => void;
  date: string;
  /** Chooses the default title and the row affordance. */
  intent?: 'track' | 'move';
  /** Overrides the default title, e.g. to name what is being moved. */
  title?: string;
  /** Shown as "Current" and not selectable — moving there would be a no-op. */
  currentSlot?: MealSlot;
}) {
  const profile = useApp((s) => s.profile);
  const meals = useLiveQuery(
    async () => (open ? db.meals.where('date').equals(date).toArray() : []),
    [date, open],
  );

  return (
    <BottomSheet open={open} onClose={onClose} title={title ?? DEFAULT_TITLE[intent]}>
      <ul className="pb-3">
        {MEAL_SLOTS.map((slot) => {
          const meal = meals?.find((m) => m.slot === slot);
          const eaten = meal ? Math.round(mealNutrients(meal).kcal) : 0;
          const target = slotTarget(profile, slot);
          const isCurrent = slot === currentSlot;
          return (
            <li key={slot}>
              <button
                type="button"
                disabled={isCurrent}
                onClick={() => onPick(slot)}
                className="flex w-full items-center gap-3 border-b border-[var(--surface-border)] py-3.5 text-left last:border-0 disabled:opacity-45"
              >
                <span className="flex-1 text-[15px] font-semibold">{MEAL_SLOT_LABEL[slot]}</span>
                <span className="tabular text-[13px] text-secondary">
                  {eaten}/{target} Cal
                </span>
                {isCurrent ? (
                  <span className="text-[12px] font-semibold text-muted">Current</span>
                ) : intent === 'move' ? (
                  <span className="flex h-7 w-7 items-center justify-center text-muted">
                    <IconChevronRight width={17} height={17} />
                  </span>
                ) : (
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-500 text-white">
                    <IconPlus width={15} height={15} strokeWidth={2.5} />
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </BottomSheet>
  );
}
