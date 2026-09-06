import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/schema';
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
  MICRO_BY_ID,
  MICRO_STATUS_COLOR,
  MICRO_STATUS_LABEL,
  SORT_LABEL,
  buildMicroBreakdown,
  formatMicro,
  isMicroId,
  microPct,
  microSlotTotals,
  microStatus,
  suggestFoods,
  sortMicroBreakdown,
  sumMicroRows,
  type SortDir,
  type SortField,
} from '@/lib/micros';
import { relativeDayLabel } from '@/lib/date';
import { PortionSheet } from '@/components/PortionSheet';
import { Card, Chip, EmptyState, PageHeader, SectionTitle } from '@/components/ui';
import { IconChevronDown, IconChevronUp, IconLeaf, IconTrash } from '@/components/icons';
import { MEAL_SLOTS, MEAL_SLOT_LABEL, type Food, type MealItem, type MealSlot } from '@/types';

const SORT_FIELDS: SortField[] = ['amount', 'name', 'meal'];

/**
 * Where one micronutrient's daily figure came from.
 *
 * Opened by tapping any row on the Micronutrients screen — the same gesture
 * that opens Protein or Carbs from the day summary, and deliberately built to
 * the same filter contract: a meal-slot chip to narrow the list, a sort field
 * and direction to reorder it. Two nutrient screens with different filter
 * behaviour would just be one more thing to relearn per screen.
 *
 * It differs from the macro version in one way the macro side never has to
 * consider: an item can carry no data at all for this nutrient. Those rows
 * stay in the list — dropping them would make "12 items logged" on this
 * screen disagree with the Diet screen it was reached from — but they sort
 * last and read as "No data" rather than a confident zero.
 */
export default function MicroBreakdown() {
  const navigate = useNavigate();
  const { id: idParam } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const { selectedDate, showToast, showConfirm } = useApp();

  // The date travels in the query string, exactly as the macro breakdown does,
  // so Calendar can open any past day without moving the app's selected date.
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

  const id = isMicroId(idParam) ? idParam : 'iron';
  const def = MICRO_BY_ID[id];

  const all = useMemo(() => buildMicroBreakdown(day.meals, id), [day.meals, id]);
  const perSlot = useMemo(() => microSlotTotals(all), [all]);
  // Every slot that has *items*, not just the ones with a known contribution —
  // "Breakfast" should still be a filter option when what it logged simply has
  // no data for this nutrient, which is a fact worth being able to isolate.
  const slotsPresent = useMemo(() => {
    const set = new Set<MealSlot>();
    for (const row of all) set.add(row.slot);
    return MEAL_SLOTS.filter((slot) => set.has(slot));
  }, [all]);

  const rows = useMemo(() => {
    const filtered = slotFilter === 'all' ? all : all.filter((r) => r.slot === slotFilter);
    return sortMicroBreakdown(filtered, sortField, sortDir);
  }, [all, slotFilter, sortField, sortDir]);

  const total = day.micros[id] ?? 0;
  const target = day.microTargets[id];
  const status = microStatus(id, total, target);
  const pct = microPct(total, target);
  const color = MICRO_STATUS_COLOR[status];
  const shown = sumMicroRows(rows);
  const unknownCount = all.filter((r) => r.value === undefined).length;

  // The whole catalog, for recommendations. Cheap — a few hundred rows — and
  // Dexie keeps it live so a food added mid-session shows up here too.
  const foods = useLiveQuery(async () => db.foods.toArray(), []);
  const recommended = useMemo(() => {
    if (!foods) return [];
    return suggestFoods(foods, id, target, 6).filter(
      // Recommending something already on today's plate is advice already taken.
      (p) => !day.meals.some((m) => m.items.some((i) => i.foodId === p.foodId)),
    );
  }, [foods, id, target, day.meals]);

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

  /** Asks first — the same prompt the Diet and macro-breakdown screens show. */
  function deleteRow(slot: MealSlot, mealId: string, index: number, item: MealItem) {
    showConfirm({
      title: `Delete ${item.name}?`,
      body: `${formatPortion(item.qty, item.servingLabel)} · ${Math.round(item.nutrients.kcal)} Cal will come off ${MEAL_SLOT_LABEL[slot]}.`,
      onConfirm: async () => {
        await removeMealItem(mealId, index);
        setEditing(null);
        showToast({
          message: `${item.name} removed`,
          actionLabel: 'Undo',
          onAction: () => restoreMealItem(date, slot, index, item),
        });
      },
    });
  }

  /* -------------------------------- render ------------------------------- */

  return (
    <div className="pb-28">
      <PageHeader title={def.label} subtitle={relativeDayLabel(date)} back={() => navigate(-1)} />

      <div className="space-y-3 px-4 pt-3">
        <Card className="space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="tabular text-[22px] font-extrabold">
              {formatMicro(id, total)}
              <span className="ml-1 text-[13px] font-semibold text-secondary">
                of {formatMicro(id, target)}
                {def.limit && ' max'}
              </span>
            </p>
            <p className="tabular text-[13px] font-bold" style={{ color }}>
              {pct}% · {MICRO_STATUS_LABEL[status]}
            </p>
          </div>
          <div className="surface-sunken h-2 w-full overflow-hidden rounded-full">
            <div
              className="h-full rounded-full transition-[width] duration-500 ease-out"
              style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }}
            />
          </div>
          <p className="text-[12.5px] leading-relaxed text-secondary">{def.why}</p>
          <p className="text-[12.5px] text-secondary">
            {all.length === 0
              ? 'Nothing logged for this day.'
              : `From ${all.length} item${all.length === 1 ? '' : 's'} logged${
                  slotFilter === 'all'
                    ? ''
                    : ` · ${formatMicro(id, shown)} in ${MEAL_SLOT_LABEL[slotFilter]}`
                }.`}
          </p>
          {unknownCount > 0 && (
            <p className="hairline border-t pt-2.5 text-[11.5px] leading-relaxed text-muted">
              {unknownCount} of {all.length} item{all.length === 1 ? '' : 's'} logged{' '}
              {unknownCount === 1 ? 'carries' : 'carry'} no {def.label.toLowerCase()} data — the
              total above is a floor, not the full picture.
            </p>
          )}
          {def.limit && status === 'over' && (
            <p className="hairline border-t pt-2.5 text-[12px] leading-relaxed text-secondary">
              Salt added at the table, pickles, papad and packaged snacks are usually where the
              difference sits — the cooking itself is rarely the whole story.
            </p>
          )}
        </Card>

        {all.length > 0 && (
          <>
            {/* Filter: which meal to look at. Slots with nothing logged are
                omitted rather than shown as dead chips — same rule the macro
                breakdown uses. */}
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
              <Chip active={slotFilter === 'all'} onClick={() => setSlotFilter('all')}>
                All meals
              </Chip>
              {slotsPresent.map((slot) => (
                <Chip key={slot} active={slotFilter === slot} onClick={() => setSlotFilter(slot)}>
                  {MEAL_SLOT_LABEL[slot]}
                  {perSlot.has(slot) ? ` · ${formatMicro(id, perSlot.get(slot)!)}` : ' · no data'}
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
                        {row.value === undefined ? (
                          <span className="tabular block text-[12.5px] font-semibold text-muted">
                            No data
                          </span>
                        ) : (
                          <>
                            <span
                              className={`tabular block text-[14px] font-bold ${
                                row.value === 0 ? 'text-muted' : ''
                              }`}
                            >
                              {formatMicro(id, row.value)}
                            </span>
                            <span className="tabular block text-[11px] text-muted">
                              {Math.round(row.share * 100)}% of day
                            </span>
                          </>
                        )}
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
            icon={<IconLeaf width={22} height={22} />}
            title={`No ${def.label.toLowerCase()} to break down`}
            body="Log something for this day and every item will show up here with what it contributed."
          />
        )}

        {/* --------------------------- recommendations --------------------- */}
        {/* Shown regardless of today's status: "keep eating these" is as
            useful a recommendation as "eat more of these". Sodium and every
            other ceiling nutrient are excluded upstream by suggestFoods — a
            list of foods to add makes no sense for a limit. */}
        {recommended.length > 0 && (
          <Card className="space-y-2.5">
            <SectionTitle>Good sources of {def.label}</SectionTitle>
            <div className="grid grid-cols-2 gap-2">
              {recommended.map((p) => (
                <button
                  key={p.foodId}
                  type="button"
                  onClick={() => navigate(`/search?q=${encodeURIComponent(p.name)}`)}
                  className="surface-sunken rounded-lg px-2.5 py-2 text-left transition-transform active:scale-95"
                >
                  <span className="block truncate text-[12.5px] font-semibold">{p.name}</span>
                  <span className="block truncate text-[11px] text-secondary">
                    {p.servingLabel} · {formatMicro(id, p.amount)}
                  </span>
                </button>
              ))}
            </div>
          </Card>
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
          onDelete={() => deleteRow(editing.slot, editing.mealId, editing.index, editing.item)}
        />
      )}
    </div>
  );
}
