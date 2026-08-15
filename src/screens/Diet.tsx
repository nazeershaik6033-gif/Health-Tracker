import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '@/stores/useApp';
import { useDay } from '@/stores/useDay';
import {
  addFavourite,
  deleteMeal,
  getFood,
  moveMealItems,
  removeFavourite,
  removeMealItem,
  replaceMealItem,
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
import { DayTotals } from '@/components/DayTotals';
import { Card, EmptyState, ScoreCircle } from '@/components/ui';
import { PortionSheet } from '@/components/PortionSheet';
import { MealPickerSheet } from '@/components/MealPickerSheet';
import { MacroStrip } from '@/components/MacroStrip';
import {
  IconChevronLeft,
  IconChevronRight,
  IconDiet,
  IconMove,
  IconPlus,
  IconSparkle,
  IconStar,
  IconTrash,
} from '@/components/icons';
import {
  MEAL_SLOTS,
  MEAL_SLOT_LABEL,
  type Food,
  type Meal,
  type MealItem,
  type MealSlot,
} from '@/types';

export default function Diet() {
  const navigate = useNavigate();
  const { profile, selectedDate, setSelectedDate, setPendingSlot, showToast } = useApp();
  const day = useDay();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmMeal, setConfirmMeal] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    mealId: string;
    slot: MealSlot;
    index: number;
    item: MealItem;
    food?: Food;
  } | null>(null);
  const [moving, setMoving] = useState<{
    mealId: string;
    from: MealSlot;
    indices: number[];
    label: string;
  } | null>(null);
  // Which rows are showing their macros. Purely a view concern, so it lives in
  // state rather than on the meal, and resets when the screen does.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const allKeys = useMemo(
    () => day.meals.flatMap((m) => m.items.map((_, i) => `${m.id}-${i}`)),
    [day.meals],
  );
  const allExpanded = allKeys.length > 0 && allKeys.every((k) => expanded.has(k));

  function toggleExpanded(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

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

  /**
   * Re-files logged food under a different heading, for the dinner entered as
   * lunch. Undo moves exactly what was moved back, using the positions the
   * items landed at — they are appended to the target, so they are no longer
   * where they started.
   */
  async function runMove(to: MealSlot) {
    if (!moving) return;
    const { mealId, indices, label } = moving;
    setMoving(null);

    const result = await moveMealItems(mealId, indices, to);
    if (!result) return;

    showToast({
      message: `${label} moved to ${MEAL_SLOT_LABEL[to]}`,
      actionLabel: 'Undo',
      onAction: () => void moveMealItems(result.mealId, result.indices, result.from),
    });
  }

  async function removeItem(mealId: string, index: number, name: string) {
    await removeMealItem(mealId, index);
    setConfirmDelete(null);
    showToast({ message: `${name} removed` });
  }

  /**
   * Pins everything in a slot as one favourite — the "this is my usual
   * breakfast" case. A day you already logged is the most accurate description
   * of a usual meal there is, so it is the cheapest place to capture one.
   */
  async function pinMeal(slot: MealSlot, meal: Meal) {
    const names = meal.items.map((i) => i.name);
    const label =
      names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
    const favourite = await addFavourite({
      slot,
      label,
      items: meal.items.map((item) => ({ ...item, nutrients: { ...item.nutrients } })),
    });

    showToast({
      message: `Pinned to ${MEAL_SLOT_LABEL[slot]} favourites`,
      actionLabel: 'Undo',
      onAction: () => removeFavourite(favourite.id),
    });
  }

  /** Pins one already-logged item, at exactly the portion it was logged at. */
  async function pinItem(slot: MealSlot, item: MealItem) {
    const favourite = await addFavourite({
      slot,
      items: [{ ...item, nutrients: { ...item.nutrients } }],
    });
    setEditing(null);

    showToast({
      message: `${item.name} pinned to ${MEAL_SLOT_LABEL[slot]}`,
      actionLabel: 'Undo',
      onAction: () => removeFavourite(favourite.id),
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

      {/* Day totals */}
      <div className="mb-3">
        <DayTotals totals={day.totals} targets={day.targets} burned={day.workoutKcal} />
      </div>

      {/* One switch for the whole day, because the question "where did today's
          carbs come from" is asked of every row at once, not one at a time. */}
      {allKeys.length > 0 && (
        <div className="mb-2 flex justify-end px-1">
          <button
            type="button"
            onClick={() => setExpanded(allExpanded ? new Set() : new Set(allKeys))}
            className="text-[12.5px] font-semibold text-brand-600"
          >
            {allExpanded ? 'Collapse all' : 'Expand all'}
          </button>
        </div>
      )}

      {/* Slots */}
      <div className="space-y-3">
        {MEAL_SLOTS.map((slot) => {
          const meal = day.bySlot[slot];
          const eaten = meal ? Math.round(mealNutrients(meal).kcal) : 0;
          const target = slotTarget(profile, slot);

          return (
            <Card key={slot} className="py-3">
              {/* Four controls plus a slot name plus a calorie readout is more
                  than one line holds on a phone, and "Morning Snack" cut to
                  "Morning Sn…" is the wrong thing to sacrifice. The controls are
                  tightened and the readout drops its unit — the card above
                  states the unit, and these are the only two numbers here. */}
              <div className="flex items-center gap-1 px-1">
                <h2 className="min-w-0 flex-1 truncate text-[15px] font-bold">
                  {MEAL_SLOT_LABEL[slot]}
                </h2>
                <span className="tabular shrink-0 text-[12.5px] text-secondary">
                  {eaten}/{target}
                </span>
                {/* Moves the whole slot at once — a meal logged under the wrong
                    heading is the usual reason to want this, and repairing it
                    row by row would be five sheets deep. */}
                {meal && meal.items.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setMoving({
                        mealId: meal.id,
                        from: slot,
                        indices: meal.items.map((_, i) => i),
                        label: MEAL_SLOT_LABEL[slot],
                      })
                    }
                    aria-label={`Move ${MEAL_SLOT_LABEL[slot]} to another meal`}
                    className="shrink-0 rounded-lg p-1 text-muted transition-transform active:scale-90"
                  >
                    <IconMove width={14} height={14} />
                  </button>
                )}
                {meal && meal.items.length > 0 && (
                  <button
                    type="button"
                    onClick={() => pinMeal(slot, meal)}
                    aria-label={`Save this ${MEAL_SLOT_LABEL[slot].toLowerCase()} as a favourite`}
                    className="shrink-0 rounded-lg p-1 text-muted transition-transform active:scale-90"
                  >
                    <IconStar width={14} height={14} />
                  </button>
                )}
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
                    className={`shrink-0 rounded-lg p-1 ${
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
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-500 text-white"
                >
                  <IconPlus width={15} height={15} strokeWidth={2.5} />
                </button>
              </div>

              {meal && meal.items.length > 0 ? (
                <ul className="mt-2">
                  {meal.items.map((item, i) => {
                    const key = `${meal.id}-${i}`;
                    return (
                      <li key={key} className="border-t border-[var(--surface-border)] px-1 py-2.5">
                        <div className="flex items-center gap-2">
                          {item.score !== undefined && <ScoreCircle score={item.score} size={28} />}
                          {/* Tapping the row edits the portion. Before this the
                              only way to fix a quantity was delete and re-add.
                              Name, portion and calories are three targets for
                              the one action, so the Expand chip can sit beside
                              the name without nesting inside a button. */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => openEdit(meal.id, slot, i, item)}
                                aria-label={`Edit ${item.name}`}
                                className="min-w-0 truncate text-left text-[14px] font-medium"
                              >
                                {item.name}
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleExpanded(key)}
                                aria-expanded={expanded.has(key)}
                                aria-label={`${expanded.has(key) ? 'Hide' : 'Show'} macros for ${item.name}`}
                                className="hairline shrink-0 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold text-secondary"
                              >
                                {expanded.has(key) ? 'Hide' : 'Expand'}
                              </button>
                              <span className="flex-1" />
                            </div>
                            <button
                              type="button"
                              tabIndex={-1}
                              aria-hidden="true"
                              onClick={() => openEdit(meal.id, slot, i, item)}
                              className="block w-full truncate text-left text-[12px] text-secondary"
                            >
                              {formatPortion(item.qty, item.servingLabel)}
                            </button>
                          </div>
                          <button
                            type="button"
                            tabIndex={-1}
                            aria-hidden="true"
                            onClick={() => openEdit(meal.id, slot, i, item)}
                            className="tabular shrink-0 text-[13px] font-semibold"
                          >
                            {Math.round(item.nutrients.kcal)}
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
                        </div>

                        {expanded.has(key) && <MacroStrip nutrients={item.nutrients} />}
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
          // Pins the portion shown in the sheet, which may differ from what is
          // logged — dial in the amount you usually eat, star it, then cancel.
          onFavourite={(qty, servingLabel, grams) =>
            pinItem(
              editing.slot,
              editing.food && grams !== undefined
                ? buildMealItemFromGrams(editing.food, grams)
                : editing.food
                  ? buildMealItem(editing.food, servingLabel, qty)
                  : rescaleMealItem(editing.item, qty, servingLabel),
            )
          }
          favouriteSlotLabel={MEAL_SLOT_LABEL[editing.slot]}
          // Moves the row as it is logged, not the portion currently dialled in
          // the sheet — an unsaved quantity change is a separate decision, and
          // silently committing it on the way out would be a surprise.
          onMove={() => {
            setMoving({
              mealId: editing.mealId,
              from: editing.slot,
              indices: [editing.index],
              label: editing.item.name,
            });
            setEditing(null);
          }}
          onDelete={async () => {
            await removeItem(editing.mealId, editing.index, editing.item.name);
            setEditing(null);
          }}
        />
      )}

      {moving && (
        <MealPickerSheet
          open
          intent="move"
          date={selectedDate}
          currentSlot={moving.from}
          title={`Move ${moving.label} to`}
          onPick={runMove}
          onClose={() => setMoving(null)}
        />
      )}
    </div>
  );
}
