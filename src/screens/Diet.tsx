import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '@/stores/useApp';
import { useDay } from '@/stores/useDay';
import {
  deleteMeal,
  getFood,
  removeMealItem,
  replaceMealItem,
  restoreMeal,
  restoreMealItem,
} from '@/db/repo';
import {
  buildMealItem,
  buildMealItemFromGrams,
  formatPortion,
  mealNutrients,
  per100gFromItem,
  rescaleMealItem,
  slotTarget,
} from '@/lib/nutrition';
import { addDays, relativeDayLabel, today } from '@/lib/date';
import { RingProgress } from '@/components/RingProgress';
import { MacroBar } from '@/components/MacroBar';
import { Card, EmptyState, ScoreCircle } from '@/components/ui';
import { PortionSheet } from '@/components/PortionSheet';
import { NextMealCard } from '@/components/NextMealCard';
import type { MacroKey } from '@/lib/macroBreakdown';
import {
  IconChevronLeft,
  IconChevronRight,
  IconDiet,
  IconPlus,
  IconSparkle,
  IconTrash,
} from '@/components/icons';
import { MEAL_SLOTS, MEAL_SLOT_LABEL, type Food, type MealItem, type MealSlot } from '@/types';

export default function Diet() {
  const navigate = useNavigate();
  const { profile, selectedDate, setSelectedDate, setPendingSlot, showToast, showConfirm } =
    useApp();
  const day = useDay();
  const [editing, setEditing] = useState<{
    mealId: string;
    slot: MealSlot;
    index: number;
    item: MealItem;
    food?: Food;
  } | null>(null);

  /**
   * The logged item only remembers the one serving it used; the food row
   * carries the full list, so it is fetched to allow switching units.
   */
  async function openEdit(mealId: string, slot: MealSlot, index: number, item: MealItem) {
    const food = item.foodId ? await getFood(item.foodId) : undefined;
    setEditing({ mealId, slot, index, item, food });
  }

  async function saveEdit(qty: number, servingLabel: string, grams?: number) {
    if (!editing) return;
    const { mealId, index, item, food } = editing;
    const next =
      food && grams !== undefined
        ? buildMealItemFromGrams(food, grams)
        : food
          ? buildMealItem(food, servingLabel, qty)
          : rescaleMealItem(item, qty, servingLabel);
    await replaceMealItem(mealId, index, next);
    setEditing(null);
    showToast({ message: `${next.name} updated` });
  }

  const openSlot = (slot: MealSlot) => {
    setPendingSlot(slot);
    navigate('/search');
  };

  const macroLink = (key: MacroKey) => `/macro/${key}?date=${selectedDate}`;

  /**
   * The first tap asks; nothing is deleted until the prompt is answered.
   *
   * The trash icon used to arm silently on the first tap and delete on the
   * second, and disarmed itself on focus loss — so the question was never
   * stated and the first tap was often thrown away. Undo stays in the toast
   * behind the prompt, for the confirm that was itself a mistake.
   */
  function removeItem(
    slot: MealSlot,
    mealId: string,
    index: number,
    item: MealItem,
    // Runs only once the delete actually happens, so cancelling from inside
    // the portion sheet leaves that sheet open rather than closing it too.
    onDone?: () => void,
  ) {
    showConfirm({
      title: `Delete ${item.name}?`,
      body: `${formatPortion(item.qty, item.servingLabel)} · ${Math.round(item.nutrients.kcal)} Cal will come off ${MEAL_SLOT_LABEL[slot]}.`,
      onConfirm: async () => {
        await removeMealItem(mealId, index);
        onDone?.();
        showToast({
          message: `${item.name} removed`,
          actionLabel: 'Undo',
          onAction: () => restoreMealItem(selectedDate, slot, index, item),
        });
      },
    });
  }

  return (
    <div className="px-4 pt-safe">
      {/* Day switcher */}
      <div className="flex items-center justify-between py-3">
        <button
          type="button"
          aria-label="Previous day"
          onClick={() => setSelectedDate(addDays(selectedDate, -1))}
          className="rounded-full p-2 hover:surface-sunken"
        >
          <IconChevronLeft width={20} height={20} />
        </button>
        <h1 className="text-[17px] font-bold tracking-tight">{relativeDayLabel(selectedDate)}</h1>
        <button
          type="button"
          aria-label="Next day"
          onClick={() => setSelectedDate(addDays(selectedDate, 1))}
          disabled={selectedDate >= today()}
          className="rounded-full p-2 hover:surface-sunken disabled:opacity-30"
        >
          <IconChevronRight width={20} height={20} />
        </button>
      </div>

      {/* Day totals. Every figure here drills into the items behind it — a
          number you cannot interrogate is the one you end up not trusting. */}
      <Card className="mb-3 space-y-3.5">
        <Link
          to={macroLink('kcal')}
          aria-label={`${Math.round(day.totals.kcal)} calories eaten. See what contributed.`}
          className="flex items-center gap-3 rounded-xl transition-transform active:scale-[0.99]"
        >
          <RingProgress
            value={day.totals.kcal / (day.targets.kcal || 1)}
            size={56}
            stroke={4.5}
            color="var(--color-ring-calorie)"
          >
            <div className="text-center leading-none">
              <p className="tabular text-[13px] font-extrabold">{Math.round(day.totals.kcal)}</p>
              <p className="text-[8px] text-muted">kcal</p>
            </div>
          </RingProgress>
          <div className="flex-1">
            <p className="text-[15px] font-bold">
              {Math.max(0, day.targets.kcal - day.totals.kcal).toLocaleString()} Cal left
            </p>
            <p className="tabular text-[12.5px] text-secondary">
              {Math.round(day.totals.kcal).toLocaleString()} eaten
              {day.workoutKcal > 0 && ` · ${day.workoutKcal} burned`}
            </p>
          </div>
          <IconChevronRight width={16} height={16} className="shrink-0 text-muted" />
        </Link>
        <div className="hairline grid grid-cols-2 gap-x-5 gap-y-3 border-t pt-3.5">
          <MacroBar
            label="Protein"
            value={day.totals.protein}
            target={day.targets.protein}
            color="var(--color-macro-protein)"
            asPercent={false}
            to={macroLink('protein')}
          />
          <MacroBar
            label="Fats"
            value={day.totals.fat}
            target={day.targets.fat}
            color="var(--color-macro-fat)"
            asPercent={false}
            to={macroLink('fat')}
          />
          <MacroBar
            label="Carbs"
            value={day.totals.carbs}
            target={day.targets.carbs}
            color="var(--color-macro-carb)"
            asPercent={false}
            to={macroLink('carbs')}
          />
          <MacroBar
            label="Fibre"
            value={day.totals.fibre}
            target={day.targets.fibre}
            color="var(--color-macro-fibre)"
            asPercent={false}
            to={macroLink('fibre')}
          />
        </div>
      </Card>

      <NextMealCard date={selectedDate} />

      {/* Slots */}
      <div className="space-y-3">
        {MEAL_SLOTS.map((slot) => {
          const meal = day.bySlot[slot];
          const eaten = meal ? Math.round(mealNutrients(meal).kcal) : 0;
          const target = slotTarget(profile, slot);

          return (
            <Card key={slot} className="py-3">
              <div className="flex items-center gap-2 px-1">
                <h2 className="flex-1 text-[15px] font-bold">{MEAL_SLOT_LABEL[slot]}</h2>
                <span className="tabular text-[12.5px] text-secondary">
                  {eaten}/{target} Cal
                </span>
                {/* Clearing a whole slot means deleting every item, so this one
                    is worth an undo even more than a single row is. */}
                {meal && meal.items.length > 0 && (
                  <button
                    type="button"
                    aria-label={`Remove ${MEAL_SLOT_LABEL[slot]}`}
                    onClick={() => {
                      const snapshot = meal;
                      showConfirm({
                        title: `Clear ${MEAL_SLOT_LABEL[slot]}?`,
                        body: `All ${snapshot.items.length} item${
                          snapshot.items.length === 1 ? '' : 's'
                        } logged here will be deleted.`,
                        confirmLabel: 'Clear',
                        onConfirm: async () => {
                          await deleteMeal(snapshot.id);
                          showToast({
                            message: `${MEAL_SLOT_LABEL[slot]} removed`,
                            actionLabel: 'Undo',
                            onAction: () => restoreMeal(snapshot),
                          });
                        },
                      });
                    }}
                    className="rounded-lg p-1.5 text-muted transition-transform active:scale-90"
                  >
                    <IconTrash width={14} height={14} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => openSlot(slot)}
                  aria-label={`Add to ${MEAL_SLOT_LABEL[slot]}`}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-500 text-white"
                >
                  <IconPlus width={15} height={15} strokeWidth={2.5} />
                </button>
              </div>

              {meal && meal.items.length > 0 ? (
                <ul className="mt-2">
                  {meal.items.map((item, i) => {
                    const key = `${meal.id}-${i}`;
                    return (
                      <li
                        key={key}
                        className="flex items-center gap-2.5 border-t border-[var(--surface-border)] px-1 py-2.5"
                      >
                        {item.score !== undefined && <ScoreCircle score={item.score} size={28} />}
                        {/* Tapping the row edits the portion. Before this the
                            only way to fix a quantity was delete and re-add. */}
                        <button
                          type="button"
                          onClick={() => openEdit(meal.id, slot, i, item)}
                          aria-label={`Edit ${item.name}`}
                          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-medium">
                              {item.name}
                            </span>
                            <span className="block truncate text-[12px] text-secondary">
                              {formatPortion(item.qty, item.servingLabel)}
                            </span>
                          </span>
                          <span className="tabular shrink-0 text-[13px] font-semibold">
                            {Math.round(item.nutrients.kcal)}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => removeItem(slot, meal.id, i, item)}
                          aria-label={`Remove ${item.name}`}
                          className="shrink-0 rounded-lg p-1.5 text-muted transition-transform active:scale-90 hover:text-red-600"
                        >
                          <IconTrash width={15} height={15} />
                        </button>
                      </li>
                    );
                  })}

                  {meal.healthScore !== undefined && (
                    <li className="border-t border-[var(--surface-border)] pt-2">
                      <Link
                        to={`/meal/${meal.id}`}
                        className="flex items-center gap-2 rounded-lg tint-soft tint-brand px-2.5 py-2 text-[12.5px] font-semibold"
                      >
                        <IconSparkle width={13} height={13} />
                        You scored {meal.healthScore} on 10
                        <span className="flex-1" />
                        Know More
                        <IconChevronRight width={14} height={14} />
                      </Link>
                    </li>
                  )}
                </ul>
              ) : (
                <button
                  type="button"
                  onClick={() => openSlot(slot)}
                  className="mt-1 w-full px-1 py-2 text-left text-[13px] text-muted"
                >
                  Nothing logged — tap to add
                </button>
              )}
            </Card>
          );
        })}
      </div>

      {day.meals.length === 0 && (
        <EmptyState
          icon={<IconDiet width={22} height={22} />}
          title="No food logged for this day"
          body="Snap a photo, scan a barcode, or search the database to get started."
        />
      )}

      <div className="h-4" />

      {editing && (
        <PortionSheet
          title={editing.item.name}
          per100g={editing.food?.per100g ?? per100gFromItem(editing.item)}
          servings={
            editing.food?.servings ?? [
              {
                label: editing.item.servingLabel,
                grams: editing.item.grams / (editing.item.qty || 1),
              },
            ]
          }
          initialQty={editing.item.qty}
          initialServingLabel={editing.item.servingLabel}
          confirmLabel={(kcal) => `Save ${kcal} Cal`}
          onEditFood={
            editing.food ? () => navigate(`/food/${editing.food!.id}/edit`) : undefined
          }
          onClose={() => setEditing(null)}
          onConfirm={saveEdit}
          onDelete={() =>
            removeItem(editing.slot, editing.mealId, editing.index, editing.item, () =>
              setEditing(null),
            )
          }
        />
      )}
    </div>
  );
}
