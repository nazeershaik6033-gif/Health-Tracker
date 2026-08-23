import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp } from '@/stores/useApp';
import { useDay } from '@/stores/useDay';
import { getFood, removeMealItem, replaceMealItem, restoreMealItem } from '@/db/repo';
import {
  buildMealItem,
  buildMealItemFromGrams,
  formatPortion,
  per100gFromItem,
  rescaleMealItem,
} from '@/lib/nutrition';
import {
  MACRO_META,
  SORT_LABEL,
  buildBreakdown,
  formatMacro,
  isMacroKey,
  slotTotals,
  sortBreakdown,
  sumRows,
  type SortDir,
  type SortField,
} from '@/lib/macroBreakdown';
import { relativeDayLabel } from '@/lib/date';
import { PortionSheet } from '@/components/PortionSheet';
import { Card, Chip, EmptyState, PageHeader } from '@/components/ui';
import { IconChevronDown, IconChevronUp, IconDiet, IconTrash } from '@/components/icons';
import { MEAL_SLOTS, MEAL_SLOT_LABEL, type Food, type MealItem, type MealSlot } from '@/types';

const SORT_FIELDS: SortField[] = ['amount', 'name', 'meal'];

/**
 * Where one number on the day summary came from.
 *
 * Opened by tapping Protein, Carbs, Fats, Fibre or the calorie ring. The list
 * is flat rather than grouped by meal so that sorting can rank the day's
 * biggest contributor outright — grouping would only ever sort within a slot,
 * which is not the question being asked. The slot is on every row, and the
 * filter chips narrow to one when that *is* the question.
 */
export default function MacroBreakdown() {
  const navigate = useNavigate();
  const { key } = useParams<{ key: string }>();
  const [params] = useSearchParams();
  const { selectedDate, showToast } = useApp();

  // The date travels in the query string so the screen can be opened for any
  // day (from Calendar) without moving the app's selected date underneath it.
  const date = params.get('date') ?? selectedDate;
  const day = useDay(date);

  const [slotFilter, setSlotFilter] = useState<MealSlot | 'all'>('all');
  const [sortField, setSortField] = useState<SortField>('amount');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [editing, setEditing] = useState<{
    mealId: string;
    slot: MealSlot;
    index: number;
    item: MealItem;
    food?: Food;
  } | null>(null);

  const macro = isMacroKey(key) ? key : 'protein';
  const meta = MACRO_META[macro];

  const all = useMemo(() => buildBreakdown(day.meals, macro), [day.meals, macro]);
  const perSlot = useMemo(() => slotTotals(all), [all]);

  const rows = useMemo(() => {
    const filtered = slotFilter === 'all' ? all : all.filter((r) => r.slot === slotFilter);
    return sortBreakdown(filtered, sortField, sortDir);
  }, [all, slotFilter, sortField, sortDir]);

  const total = day.totals[macro];
  const target = day.targets[macro];
  const shown = sumRows(rows);
  const pct = target > 0 ? Math.round((total / target) * 100) : 0;
  const over = total > target && target > 0;

  /* ------------------------------- editing ------------------------------- */

  async function openEdit(row: (typeof rows)[number]) {
    // The logged item only remembers the serving it used; the food row carries
    // the full list, so it is fetched to allow switching units.
    const food = row.item.foodId ? await getFood(row.item.foodId) : undefined;
    setEditing({ mealId: row.mealId, slot: row.slot, index: row.index, item: row.item, food });
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

  async function deleteRow(slot: MealSlot, mealId: string, index: number, item: MealItem) {
    await removeMealItem(mealId, index);
    setEditing(null);
    showToast({
      message: `${item.name} removed`,
      actionLabel: 'Undo',
      onAction: () => restoreMealItem(date, slot, index, item),
    });
  }

  /* -------------------------------- render ------------------------------- */

  return (
    <div className="pb-28">
      <PageHeader
        title={meta.label}
        subtitle={relativeDayLabel(date)}
        back={() => navigate(-1)}
      />

      <div className="space-y-3 px-4 pt-3">
        <Card className="space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="tabular text-[22px] font-extrabold">
              {formatMacro(total, macro)}
              <span className="ml-1 text-[13px] font-semibold text-secondary">
                of {formatMacro(target, macro)} {meta.unit}
              </span>
            </p>
            <p className={`tabular text-[13px] font-bold ${over ? 'text-red-600' : 'text-secondary'}`}>
              {pct}%
            </p>
          </div>
          <div className="surface-sunken h-2 w-full overflow-hidden rounded-full">
            <div
              className="h-full rounded-full transition-[width] duration-500 ease-out"
              style={{
                width: `${Math.max(0, Math.min(100, pct))}%`,
                background: over ? '#dc2626' : meta.color,
              }}
            />
          </div>
          <p className="text-[12.5px] text-secondary">
            {all.length === 0
              ? 'Nothing logged for this day.'
              : `From ${all.length} item${all.length === 1 ? '' : 's'} logged${
                  slotFilter === 'all'
                    ? ''
                    : ` · ${formatMacro(shown, macro)} ${meta.unit} in ${MEAL_SLOT_LABEL[slotFilter]}`
                }.`}
          </p>
        </Card>

        {all.length > 0 && (
          <>
            {/* Filter: which meal to look at. Slots with nothing logged are
                omitted rather than shown as dead chips. */}
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
              <Chip active={slotFilter === 'all'} onClick={() => setSlotFilter('all')}>
                All meals
              </Chip>
              {MEAL_SLOTS.filter((slot) => perSlot.has(slot)).map((slot) => (
                <Chip
                  key={slot}
                  active={slotFilter === slot}
                  onClick={() => setSlotFilter(slot)}
                >
                  {MEAL_SLOT_LABEL[slot]} · {formatMacro(perSlot.get(slot) ?? 0, macro)}
                </Chip>
              ))}
            </div>

            {/* Sort: the field, and the direction as a separate toggle so
                switching between ascending and descending is one tap rather
                than cycling through every field to get back. */}
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-semibold text-muted">Sort</span>
              <div className="flex flex-1 gap-1.5">
                {SORT_FIELDS.map((field) => (
                  <button
                    key={field}
                    type="button"
                    onClick={() => setSortField(field)}
                    className={`hairline flex-1 rounded-lg border py-1.5 text-[12.5px] font-semibold transition-transform active:scale-95 ${
                      sortField === field ? 'border-brand-500 tint-soft tint-brand' : ''
                    }`}
                  >
                    {SORT_LABEL[field]}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                aria-label={
                  sortDir === 'asc'
                    ? `Sorted ascending by ${SORT_LABEL[sortField].toLowerCase()}, tap for descending`
                    : `Sorted descending by ${SORT_LABEL[sortField].toLowerCase()}, tap for ascending`
                }
                className="surface-sunken hairline flex h-8 shrink-0 items-center gap-1 rounded-lg border px-2.5 text-[12px] font-bold transition-transform active:scale-95"
              >
                {sortDir === 'asc' ? (
                  <IconChevronUp width={14} height={14} />
                ) : (
                  <IconChevronDown width={14} height={14} />
                )}
                {sortDir === 'asc' ? 'Asc' : 'Desc'}
              </button>
            </div>

            <Card padded={false} className="px-4 py-1">
              <ul>
                {rows.map((row) => (
                  <li
                    key={`${row.mealId}-${row.index}`}
                    className="flex items-center gap-2.5 border-b border-[var(--surface-border)] py-2.5 last:border-0"
                  >
                    <button
                      type="button"
                      onClick={() => openEdit(row)}
                      aria-label={`Edit ${row.item.name}`}
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left transition-transform active:scale-[0.99]"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-semibold">
                          {row.item.name}
                        </span>
                        <span className="block truncate text-[12px] text-secondary">
                          {MEAL_SLOT_LABEL[row.slot]} ·{' '}
                          {formatPortion(row.item.qty, row.item.servingLabel)}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span
                          className={`tabular block text-[14px] font-bold ${
                            row.value === 0 ? 'text-muted' : ''
                          }`}
                        >
                          {formatMacro(row.value, macro)}
                          <span className="ml-0.5 text-[11px] font-semibold text-secondary">
                            {meta.unit}
                          </span>
                        </span>
                        <span className="tabular block text-[11px] text-muted">
                          {Math.round(row.share * 100)}% of day
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteRow(row.slot, row.mealId, row.index, row.item)}
                      aria-label={`Remove ${row.item.name}`}
                      className="shrink-0 rounded-lg p-1.5 text-muted transition-transform active:scale-90 hover:text-red-600"
                    >
                      <IconTrash width={15} height={15} />
                    </button>
                  </li>
                ))}
              </ul>
            </Card>

            {rows.length === 0 && (
              <p className="px-1 py-4 text-center text-[13px] text-muted">
                Nothing logged in {slotFilter === 'all' ? 'this day' : MEAL_SLOT_LABEL[slotFilter]}.
              </p>
            )}
          </>
        )}

        {all.length === 0 && (
          <EmptyState
            icon={<IconDiet width={22} height={22} />}
            title={`No ${meta.label.toLowerCase()} to break down`}
            body="Log something for this day and every item will show up here with what it contributed."
          />
        )}
      </div>

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
          onEditFood={editing.food ? () => navigate(`/food/${editing.food!.id}/edit`) : undefined}
          onClose={() => setEditing(null)}
          onConfirm={saveEdit}
          onDelete={() =>
            deleteRow(editing.slot, editing.mealId, editing.index, editing.item)
          }
        />
      )}
    </div>
  );
}
