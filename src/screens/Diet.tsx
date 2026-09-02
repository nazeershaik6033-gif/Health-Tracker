import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '@/stores/useApp';
import { useDay } from '@/stores/useDay';
import { deleteMeal, getFood, removeMealItem, replaceMealItem } from '@/db/repo';
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
  const { profile, selectedDate, setSelectedDate, setPendingSlot, showToast } = useApp();
  const day = useDay();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmMeal, setConfirmMeal] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    mealId: string;
    index: number;
    item: MealItem;
    food?: Food;
  } | null>(null);

  /**
   * The logged item only remembers the one serving it used; the food row
   * carries the full list, so it is fetched to allow switching units.
   */
  async function openEdit(mealId: string, index: number, item: MealItem) {
    const food = item.foodId ? await getFood(item.foodId) : undefined;
    setEditing({ mealId, index, item, food });
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

  async function removeItem(mealId: string, index: number, name: string) {
    await removeMealItem(mealId, index);
    setConfirmDelete(null);
    showToast({ message: `${name} removed` });
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

      {/* Day totals */}
      <Card className="mb-3 space-y-3.5">
        <div className="flex items-center gap-3">
          <RingProgress
            value={day.totals.kcal / (day.targets.kcal || 1)}
            size={56}
            stroke={4.5}
            color="var(--color-ring-calorie)"
            label={`${Math.round(day.totals.kcal)} of ${day.targets.kcal} calories`}
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
        </div>
        <div className="hairline grid grid-cols-2 gap-x-5 gap-y-3 border-t pt-3.5">
          <MacroBar
            label="Protein"
            value={day.totals.protein}
            target={day.targets.protein}
            color="var(--color-macro-protein)"
            asPercent={false}
          />
          <MacroBar
            label="Fats"
            value={day.totals.fat}
            target={day.targets.fat}
            color="var(--color-macro-fat)"
            asPercent={false}
          />
          <MacroBar
            label="Carbs"
            value={day.totals.carbs}
            target={day.targets.carbs}
            color="var(--color-macro-carb)"
            asPercent={false}
          />
          <MacroBar
            label="Fibre"
            value={day.totals.fibre}
            target={day.targets.fibre}
            color="var(--color-macro-fibre)"
            asPercent={false}
          />
        </div>
      </Card>

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
                {/* Clearing a whole slot used to mean deleting every item. */}
                {meal && meal.items.length > 0 && (
                  <button
                    type="button"
                    aria-label={
                      confirmMeal === meal.id
                        ? `Confirm remove ${MEAL_SLOT_LABEL[slot]}`
                        : `Remove ${MEAL_SLOT_LABEL[slot]}`
                    }
                    onClick={async () => {
                      if (confirmMeal !== meal.id) {
                        setConfirmMeal(meal.id);
                        return;
                      }
                      await deleteMeal(meal.id);
                      setConfirmMeal(null);
                      showToast({ message: `${MEAL_SLOT_LABEL[slot]} removed` });
                    }}
                    onBlur={() => setConfirmMeal(null)}
                    className={`rounded-lg p-1.5 ${
                      confirmMeal === meal.id ? 'tint-soft tint-danger' : 'text-muted'
                    }`}
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
                          onClick={() => openEdit(meal.id, i, item)}
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
                          onClick={() =>
                            confirmDelete === key
                              ? removeItem(meal.id, i, item.name)
                              : setConfirmDelete(key)
                          }
                          onBlur={() => setConfirmDelete(null)}
                          aria-label={
                            confirmDelete === key ? `Confirm remove ${item.name}` : `Remove ${item.name}`
                          }
                          className={`shrink-0 rounded-lg p-1.5 transition-colors ${
                            confirmDelete === key
                              ? 'tint-soft tint-danger'
                              : 'text-muted hover:text-red-600'
                          }`}
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
          initialGrams={editing.item.grams}
          confirmLabel={(kcal) => `Save ${kcal} Cal`}
          onEditFood={
            editing.food ? () => navigate(`/food/${editing.food!.id}/edit`) : undefined
          }
          onClose={() => setEditing(null)}
          onConfirm={saveEdit}
          onDelete={async () => {
            await removeItem(editing.mealId, editing.index, editing.item.name);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
