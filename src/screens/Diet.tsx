import { memo, useCallback, useMemo, useState } from 'react';
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
  restoreMeal,
  restoreMealItem,
} from '@/db/repo';
import {
  buildMealItem,
  buildMealItemFromGrams,
  formatPortion,
  mealNutrients,
  per100gFromItem,
  periodNutrients,
  periodTargets,
  rescaleMealItem,
  slotTarget,
} from '@/lib/nutrition';
import { addDays, relativeDayLabel, today } from '@/lib/date';
import { DayTotals } from '@/components/DayTotals';
import { PeriodMacros } from '@/components/PeriodMacros';
import { MICRO_IDS, microRows } from '@/lib/micros';
import { Card, EmptyState, ScoreCircle } from '@/components/ui';
import { PortionSheet } from '@/components/PortionSheet';
import { MealPickerSheet } from '@/components/MealPickerSheet';
import { MacroStrip } from '@/components/MacroStrip';
import { NextMealCard } from '@/components/NextMealCard';
import type { MacroKey } from '@/lib/macroBreakdown';
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconDiet,
  IconMove,
  IconPlus,
  IconSparkle,
  IconStar,
  IconTrash,
} from '@/components/icons';
import {
  DAY_PERIODS,
  DAY_PERIOD_ANCHOR,
  DAY_PERIOD_LABEL,
  MEAL_SLOTS,
  MEAL_SLOT_LABEL,
  type DayPeriod,
  type Food,
  type Meal,
  type MealItem,
  type MealSlot,
  type Nutrients,
} from '@/types';

/** A period's own eaten-against-target figures, for the expandable panel. */
interface PeriodMacroData {
  eaten: Nutrients;
  targets: Nutrients;
}

/** What a row needs to call back into the screen, in one stable object. */
interface RowActions {
  edit: (mealId: string, slot: MealSlot, index: number, item: MealItem) => void;
  toggleExpand: (key: string) => void;
  remove: (
    mealId: string,
    slot: MealSlot,
    index: number,
    item: MealItem,
    /** Runs only once the delete happens, so cancelling leaves callers alone. */
    onDone?: () => void,
  ) => void;
  moveItem: (mealId: string, slot: MealSlot, index: number, name: string) => void;
}

interface SlotActions {
  add: (slot: MealSlot) => void;
  pin: (slot: MealSlot, meal: Meal) => void;
  clearMeal: (slot: MealSlot, meal: Meal) => void;
  moveMeal: (slot: MealSlot, meal: Meal) => void;
}

export default function Diet() {
  const navigate = useNavigate();
  // Selectors rather than the whole store: destructuring `useApp()` subscribes
  // to every field, so showing a toast — which every delete does — re-rendered
  // this entire screen a second time for nothing.
  const profile = useApp((s) => s.profile);
  const selectedDate = useApp((s) => s.selectedDate);
  const setSelectedDate = useApp((s) => s.setSelectedDate);
  const setPendingSlot = useApp((s) => s.setPendingSlot);
  const showToast = useApp((s) => s.showToast);
  const showConfirm = useApp((s) => s.showConfirm);

  const day = useDay();
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

  // Which parts of the day are showing their macros. Separate from `expanded`
  // above: that one opens a single item's macros, this one a whole stretch of
  // the day against its share of the targets.
  const [openPeriods, setOpenPeriods] = useState<Record<DayPeriod, boolean>>({
    morning: false,
    afternoon: false,
    night: false,
  });

  const togglePeriod = useCallback(
    (period: DayPeriod) => setOpenPeriods((open) => ({ ...open, [period]: !open[period] })),
    [],
  );

  // Derived here rather than inside each card: the cards are memoised, so a
  // fresh object per render would undo that.
  const periodMacros = useMemo(
    () =>
      DAY_PERIODS.reduce(
        (acc, period) => {
          acc[period] = {
            eaten: periodNutrients(day.meals, period),
            targets: periodTargets(profile, period),
          };
          return acc;
        },
        {} as Record<DayPeriod, PeriodMacroData>,
      ),
    [day.meals, profile],
  );

  const microsOnTrack = microRows(day.micros, day.microTargets).filter(
    (r) => r.status === 'good',
  ).length;

  /**
   * The logged item only remembers the one serving it used; the food row
   * carries the full list, so it is fetched to allow switching units.
   */
  const openEdit = useCallback(
    async (mealId: string, slot: MealSlot, index: number, item: MealItem) => {
      const food = item.foodId ? await getFood(item.foodId) : undefined;
      setEditing({ mealId, slot, index, item, food });
    },
    [],
  );

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

  /**
   * Every callback a row or card receives is stable for the life of the screen,
   * which is what lets the memoised children below actually bail out. Without
   * this each render minted new function props and every row re-rendered anyway.
   */
  const rowActions = useMemo<RowActions>(
    () => ({
      edit: (mealId, slot, index, item) => void openEdit(mealId, slot, index, item),
      toggleExpand: (key) =>
        setExpanded((prev) => {
          const next = new Set(prev);
          if (!next.delete(key)) next.add(key);
          return next;
        }),
      remove: (mealId, slot, index, item, onDone) =>
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
        }),
      moveItem: (mealId, slot, index, name) =>
        setMoving({ mealId, from: slot, indices: [index], label: name }),
    }),
    [openEdit, showToast, showConfirm, selectedDate],
  );

  const slotActions = useMemo<SlotActions>(
    () => ({
      add: (slot) => {
        setPendingSlot(slot);
        navigate('/search');
      },
      /**
       * Pins everything in a slot as one favourite — the "this is my usual
       * breakfast" case. A day you already logged is the most accurate
       * description of a usual meal there is.
       */
      pin: async (slot, meal) => {
        const names = meal.items.map((i) => i.name);
        const label =
          names.length > 2
            ? `${names.slice(0, 2).join(', ')} +${names.length - 2}`
            : names.join(', ');
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
      },
      clearMeal: (slot, meal) =>
        showConfirm({
          title: `Clear ${MEAL_SLOT_LABEL[slot]}?`,
          body: `All ${meal.items.length} item${
            meal.items.length === 1 ? '' : 's'
          } logged here will be deleted.`,
          confirmLabel: 'Clear',
          onConfirm: async () => {
            await deleteMeal(meal.id);
            showToast({
              message: `${MEAL_SLOT_LABEL[slot]} removed`,
              actionLabel: 'Undo',
              onAction: () => restoreMeal(meal),
            });
          },
        }),
      moveMeal: (slot, meal) =>
        setMoving({
          mealId: meal.id,
          from: slot,
          indices: meal.items.map((_, i) => i),
          label: MEAL_SLOT_LABEL[slot],
        }),
    }),
    [navigate, setPendingSlot, showToast, showConfirm],
  );

  const macroLink = useCallback(
    (key: MacroKey) => `/macro/${key}?date=${selectedDate}`,
    [selectedDate],
  );

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

      {/* Day totals. Every figure drills into the items behind it — a number
          you cannot interrogate is the one you end up not trusting. */}
      <div className="mb-3">
        <DayTotals
          totals={day.totals}
          targets={day.targets}
          burned={day.burnedKcal}
          macroHref={macroLink}
          micros={{
            onTrack: microsOnTrack,
            total: MICRO_IDS.length,
            href: `/micros?date=${selectedDate}`,
          }}
        />
      </div>

      <NextMealCard date={selectedDate} />

      {/* One switch for the whole day, because the question "where did today's
          carbs come from" is asked of every row at once, not one at a time. */}
      {allKeys.length > 0 && (
        <div className="mb-2 flex justify-end px-1">
          <button
            type="button"
            onClick={() => setExpanded(allExpanded ? new Set() : new Set(allKeys))}
            className="rounded-lg px-1 text-[12.5px] font-semibold text-brand-600"
          >
            {allExpanded ? 'Collapse all' : 'Expand all'}
          </button>
        </div>
      )}

      {/* Slots */}
      <div className="space-y-3">
        {MEAL_SLOTS.map((slot) => {
          // Each period hangs its macros off the first slot it covers, so the
          // snack slots fold into the button above them.
          const period = DAY_PERIODS.find((p) => DAY_PERIOD_ANCHOR[p] === slot);
          return (
            <SlotCard
              key={slot}
              slot={slot}
              meal={day.bySlot[slot]}
              target={slotTarget(profile, slot)}
              expanded={expanded}
              actions={slotActions}
              rowActions={rowActions}
              period={period}
              periodOpen={period ? openPeriods[period] : false}
              periodMacros={period ? periodMacros[period] : undefined}
              onTogglePeriod={togglePeriod}
            />
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
            rowActions.moveItem(
              editing.mealId,
              editing.slot,
              editing.index,
              editing.item.name,
            );
            setEditing(null);
          }}
          // The prompt opens over the sheet; the sheet closes only once the
          // delete actually happens, so cancelling leaves you where you were.
          onDelete={() =>
            rowActions.remove(editing.mealId, editing.slot, editing.index, editing.item, () =>
              setEditing(null),
            )
          }
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

/* -------------------------------- slot card ------------------------------- */

/**
 * Memoised because the screen holds five of these and every tap used to
 * re-render all of them. Arming a delete confirm — which touches no data at
 * all — cost 85 ms on a five-row day and 215 ms on a forty-row one, and that
 * cost landed on every tap, which is what made the whole app feel slow.
 */
const SlotCard = memo(function SlotCard({
  slot,
  meal,
  target,
  expanded,
  actions,
  rowActions,
  period,
  periodOpen,
  periodMacros,
  onTogglePeriod,
}: {
  slot: MealSlot;
  meal: Meal | undefined;
  target: number;
  expanded: ReadonlySet<string>;
  actions: SlotActions;
  rowActions: RowActions;
  /** Set only on the slot that carries a period's expand button. */
  period?: DayPeriod;
  periodOpen: boolean;
  periodMacros?: PeriodMacroData;
  onTogglePeriod: (period: DayPeriod) => void;
}) {
  const eaten = meal ? Math.round(mealNutrients(meal).kcal) : 0;
  const filled = Boolean(meal && meal.items.length > 0);

  return (
    <Card className="py-3">
      {/* Four controls plus a slot name plus a calorie readout is more than one
          line holds on a phone, and "Morning Snack" cut to "Morning Sn…" is the
          wrong thing to sacrifice. The controls are tightened and the readout
          drops its unit — the card above states the unit. */}
      <div className="flex items-center gap-1 px-1">
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-bold">{MEAL_SLOT_LABEL[slot]}</h2>
        {/* Only the three slots that start a period carry this, and all three
            of those labels are short — the long one, Morning Snack, folds into
            the Morning button rather than getting one of its own. */}
        {period && (
          <button
            type="button"
            onClick={() => onTogglePeriod(period)}
            aria-expanded={periodOpen}
            aria-controls={`period-macros-${period}`}
            aria-label={`${periodOpen ? 'Hide' : 'Show'} ${DAY_PERIOD_LABEL[period]} macros`}
            className="surface-sunken flex shrink-0 items-center gap-0.5 rounded-full px-0.5 py-0.5 text-[10px] font-semibold text-secondary"
          >
            {/* The row has room for the period's name on a modern phone but
                not on a 360px one, where it would eat into the slot name the
                card is actually about. Below that it drops to the chevron
                alone; the button keeps its accessible name either way. */}
            <span className="max-[379px]:hidden">{DAY_PERIOD_LABEL[period]}</span>
            {periodOpen ? (
              <IconChevronUp width={10} height={10} />
            ) : (
              <IconChevronDown width={10} height={10} />
            )}
          </button>
        )}
        <span className="tabular shrink-0 text-[12.5px] text-secondary">
          {eaten}/{target}
        </span>
        {/* Moves the whole slot at once — a meal logged under the wrong heading
            is the usual reason to want this. */}
        {filled && (
          <button
            type="button"
            onClick={() => actions.moveMeal(slot, meal!)}
            aria-label={`Move all of ${MEAL_SLOT_LABEL[slot]} to another meal`}
            className="shrink-0 rounded-lg p-1 text-muted"
          >
            <IconMove width={14} height={14} />
          </button>
        )}
        {filled && (
          <button
            type="button"
            onClick={() => actions.pin(slot, meal!)}
            aria-label={`Save this ${MEAL_SLOT_LABEL[slot].toLowerCase()} as a favourite`}
            className="shrink-0 rounded-lg p-1 text-muted"
          >
            <IconStar width={14} height={14} />
          </button>
        )}
        {/* Clearing a whole slot deletes every item in it, so it asks first. */}
        {filled && (
          <button
            type="button"
            aria-label={`Remove ${MEAL_SLOT_LABEL[slot]}`}
            onClick={() => actions.clearMeal(slot, meal!)}
            className="shrink-0 rounded-lg p-1 text-muted transition-transform active:scale-90"
          >
            <IconTrash width={14} height={14} />
          </button>
        )}
        <button
          type="button"
          onClick={() => actions.add(slot)}
          aria-label={`Add to ${MEAL_SLOT_LABEL[slot]}`}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-500 text-white"
        >
          <IconPlus width={15} height={15} strokeWidth={2.5} />
        </button>
      </div>

      {period && periodOpen && periodMacros && (
        <PeriodMacros
          id={`period-macros-${period}`}
          period={period}
          eaten={periodMacros.eaten}
          targets={periodMacros.targets}
        />
      )}

      {meal && meal.items.length > 0 ? (
        <ul className="mt-2">
          {meal.items.map((item, i) => {
            const key = `${meal.id}-${i}`;
            return (
              <ItemRow
                key={key}
                rowKey={key}
                item={item}
                mealId={meal.id}
                slot={slot}
                index={i}
                expanded={expanded.has(key)}
                actions={rowActions}
              />
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
          onClick={() => actions.add(slot)}
          className="mt-1 w-full rounded-lg px-1 py-2 text-left text-[13px] text-muted"
        >
          Nothing logged — tap to add
        </button>
      )}
    </Card>
  );
});

/* -------------------------------- item row -------------------------------- */

/**
 * One logged item. Memoised so that expanding a row, or arming its delete,
 * re-renders that row and nothing else.
 */
const ItemRow = memo(function ItemRow({
  rowKey,
  item,
  mealId,
  slot,
  index,
  expanded,
  actions,
}: {
  rowKey: string;
  item: MealItem;
  mealId: string;
  slot: MealSlot;
  index: number;
  expanded: boolean;
  actions: RowActions;
}) {
  return (
    <li className="border-t border-[var(--surface-border)] px-1 py-2.5">
      <div className="flex items-center gap-1.5">
        {item.score !== undefined && <ScoreCircle score={item.score} size={28} />}
        {/* Tapping the row edits the portion. Name, portion and calories are
            three targets for the one action, so the Expand chip can sit beside
            the name without nesting inside a button. */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => actions.edit(mealId, slot, index, item)}
              aria-label={`Edit ${item.name}`}
              className="min-w-0 truncate rounded text-left text-[14px] font-medium"
            >
              {item.name}
            </button>
            <button
              type="button"
              onClick={() => actions.toggleExpand(rowKey)}
              aria-expanded={expanded}
              aria-label={`${expanded ? 'Hide' : 'Show'} macros for ${item.name}`}
              className="hairline shrink-0 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold text-secondary"
            >
              {expanded ? 'Hide' : 'Expand'}
            </button>
            <span className="flex-1" />
          </div>
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={() => actions.edit(mealId, slot, index, item)}
            className="block w-full truncate text-left text-[12px] text-secondary"
          >
            {formatPortion(item.qty, item.servingLabel)}
          </button>
        </div>
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => actions.edit(mealId, slot, index, item)}
          className="tabular shrink-0 text-[13px] font-semibold"
        >
          {Math.round(item.nutrients.kcal)}
        </button>
        {/* Moving one item used to live only inside the portion sheet, two taps
            deep, where nobody found it. It is the same action as the one on the
            slot header, so it gets the same icon. */}
        <button
          type="button"
          onClick={() => actions.moveItem(mealId, slot, index, item.name)}
          aria-label={`Move ${item.name} to another meal`}
          className="shrink-0 rounded-lg p-1 text-muted"
        >
          <IconMove width={14} height={14} />
        </button>
        {/* One tap opens the prompt. The row no longer holds an armed flag,
            which also removes the hazard that came with it: row keys are
            index-based, so a deleted item hands its key — and this very
            component instance — to the next one along. */}
        <button
          type="button"
          onClick={() => actions.remove(mealId, slot, index, item)}
          aria-label={`Remove ${item.name}`}
          className="shrink-0 rounded-lg p-1 text-muted transition-transform active:scale-90"
        >
          <IconTrash width={14} height={14} />
        </button>
      </div>

      {expanded && <MacroStrip nutrients={item.nutrients} />}
    </li>
  );
});
