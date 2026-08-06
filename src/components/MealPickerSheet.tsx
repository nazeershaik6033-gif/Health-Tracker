import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/schema';
import { useApp } from '@/stores/useApp';
import { BottomSheet } from './BottomSheet';
import { IconPlus } from './icons';
import { MEAL_SLOTS, MEAL_SLOT_LABEL, type MealSlot } from '@/types';
import { mealNutrients, slotTarget } from '@/lib/nutrition';

/**
 * "Select a Meal You Would Like to Track" — each slot shows eaten/target so
 * the user can see at a glance which meal still has room.
 */
export function MealPickerSheet({
  open,
  onClose,
  onPick,
  date,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (slot: MealSlot) => void;
  date: string;
}) {
  const profile = useApp((s) => s.profile);
  const meals = useLiveQuery(
    async () => (open ? db.meals.where('date').equals(date).toArray() : []),
    [date, open],
  );

  return (
    <BottomSheet open={open} onClose={onClose} title="Select a Meal You Would Like to Track">
      <ul className="pb-3">
        {MEAL_SLOTS.map((slot) => {
          const meal = meals?.find((m) => m.slot === slot);
          const eaten = meal ? Math.round(mealNutrients(meal).kcal) : 0;
          const target = slotTarget(profile, slot);
          return (
            <li key={slot}>
              <button
                type="button"
                onClick={() => onPick(slot)}
                className="flex w-full items-center gap-3 border-b border-[var(--surface-border)] py-3.5 text-left last:border-0"
              >
                <span className="flex-1 text-[15px] font-semibold">{MEAL_SLOT_LABEL[slot]}</span>
                <span className="tabular text-[13px] text-secondary">
                  {eaten}/{target} Cal
                </span>
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-500 text-white">
                  <IconPlus width={15} height={15} strokeWidth={2.5} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </BottomSheet>
  );
}
