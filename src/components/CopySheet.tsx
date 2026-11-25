import { useEffect, useState } from 'react';
import { BottomSheet } from './BottomSheet';
import { Button, Chip } from './ui';
import { IconCopy } from './icons';
import { useApp } from '@/stores/useApp';
import { copyMealItems, removeMealItems } from '@/db/repo';
import { addDays, relativeDayLabel, today } from '@/lib/date';
import { useEnergy } from '@/lib/energy';
import { MEAL_SLOTS, MEAL_SLOT_LABEL, type MealItem, type MealSlot } from '@/types';

/**
 * "Copy to…" for logged food: pick a day and a meal, and the items are logged
 * there as fresh entries.
 *
 * The slot defaults to the one the food came from — copying breakfast lands in
 * breakfast unless you say otherwise — and the day to today, or to tomorrow
 * when copying from today, since copying today onto itself is rarely meant.
 */
export function CopySheet({
  open,
  onClose,
  items,
  fromDate,
  fromSlot,
  label,
}: {
  open: boolean;
  onClose: () => void;
  items: MealItem[];
  fromDate: string;
  fromSlot: MealSlot;
  /** What is being copied, for the title and toast: "Breakfast", "Poha". */
  label: string;
}) {
  const showToast = useApp((s) => s.showToast);
  const energy = useEnergy();
  const now = today();
  const [date, setDate] = useState(fromDate === now ? addDays(now, 1) : now);
  const [slot, setSlot] = useState<MealSlot>(fromSlot);
  const [busy, setBusy] = useState(false);

  // Re-seed each time the sheet opens on something new.
  useEffect(() => {
    if (!open) return;
    setDate(fromDate === today() ? addDays(today(), 1) : today());
    setSlot(fromSlot);
  }, [open, fromDate, fromSlot]);

  const kcal = items.reduce((sum, i) => sum + i.nutrients.kcal, 0);
  const sameSpot = date === fromDate && slot === fromSlot;
  const quickDays = [addDays(now, -1), now, addDays(now, 1)];

  async function run() {
    if (busy || !items.length) return;
    setBusy(true);
    try {
      const result = await copyMealItems(items, date, slot);
      onClose();
      showToast({
        message: `${label} copied to ${MEAL_SLOT_LABEL[slot]}, ${relativeDayLabel(date).toLowerCase()}`,
        actionLabel: 'Undo',
        onAction: () => removeMealItems(result.mealId, result.indices),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={`Copy ${label}`}
      footer={
        <Button full onClick={run} disabled={busy || !items.length}>
          <IconCopy width={16} height={16} />
          Copy to {MEAL_SLOT_LABEL[slot]}, {relativeDayLabel(date)}
        </Button>
      }
    >
      <div className="space-y-4 pb-3">
        <p className="text-[12.5px] text-secondary">
          {items.length} item{items.length === 1 ? '' : 's'} · {energy.fmt(kcal)}. Copies are
          new entries, so editing one never changes the other.
        </p>

        <div>
          <p className="mb-2 text-[12px] font-semibold text-secondary">Day</p>
          <div className="flex flex-wrap items-center gap-2">
            {quickDays.map((d) => (
              <Chip key={d} active={date === d} onClick={() => setDate(d)}>
                {relativeDayLabel(d)}
              </Chip>
            ))}
            <input
              type="date"
              aria-label="Another day"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="hairline rounded-full border bg-transparent px-3 py-1.5 text-[13px]"
            />
          </div>
        </div>

        <div>
          <p className="mb-2 text-[12px] font-semibold text-secondary">Meal</p>
          <div className="flex flex-wrap gap-2">
            {MEAL_SLOTS.map((s) => (
              <Chip key={s} active={slot === s} onClick={() => setSlot(s)}>
                {MEAL_SLOT_LABEL[s]}
              </Chip>
            ))}
          </div>
        </div>

        {sameSpot && (
          <p className="text-[12px] text-muted">
            That is where it already is — copying will log it a second time.
          </p>
        )}
      </div>
    </BottomSheet>
  );
}
