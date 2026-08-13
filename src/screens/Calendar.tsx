import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useApp } from '@/stores/useApp';
import {
  dayBundle,
  deleteMeal,
  deleteWorkout,
  removeMealItem,
  replaceMealItem,
  summariseRange,
  getFood,
} from '@/db/repo';
import {
  formatDuration,
  fromISODate,
  isToday,
  relativeDayLabel,
  today,
  toISODate,
} from '@/lib/date';
import {
  buildMealItem,
  buildMealItemFromGrams,
  formatPortion,
  per100gFromItem,
  rescaleMealItem,
  totalNutrients,
} from '@/lib/nutrition';
import { RingProgress } from '@/components/RingProgress';
import { DayTotals } from '@/components/DayTotals';
import { PortionSheet } from '@/components/PortionSheet';
import { Button, Card, EmptyState, PageHeader, SectionTitle } from '@/components/ui';
import {
  IconChevronLeft,
  IconChevronRight,
  IconDroplet,
  IconDumbbell,
  IconMoon,
  IconScale,
  IconSteps,
  IconTrash,
} from '@/components/icons';
import { MEAL_SLOTS, MEAL_SLOT_LABEL, ZERO_NUTRIENTS, type Food, type MealItem } from '@/types';

/**
 * Month view of everything logged, and a full summary of whichever day is
 * selected.
 *
 * The Diet screen answers "what did I eat today"; this answers "what have I
 * been doing", which needs a month at a glance and every tracker on one screen
 * rather than one per route.
 */
export default function CalendarScreen() {
  const navigate = useNavigate();
  const { profile, selectedDate, setSelectedDate, showToast } = useApp();

  const [cursor, setCursor] = useState(() => {
    const d = fromISODate(selectedDate);
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [confirmMeal, setConfirmMeal] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    mealId: string;
    index: number;
    item: MealItem;
    food?: Food;
  } | null>(null);

  const kcalTarget = profile?.targets.kcal ?? 2000;

  /* ------------------------------ month grid ----------------------------- */

  const { cells, monthLabel, from, to } = useMemo(() => {
    const first = new Date(cursor.year, cursor.month, 1);
    const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
    // Monday-first, which is what a week looks like everywhere this app is used.
    const lead = (first.getDay() + 6) % 7;

    const grid: (string | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= daysInMonth; d++) {
      grid.push(toISODate(new Date(cursor.year, cursor.month, d)));
    }

    return {
      cells: grid,
      monthLabel: first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
      from: toISODate(new Date(cursor.year, cursor.month, 1)),
      to: toISODate(new Date(cursor.year, cursor.month, daysInMonth)),
    };
  }, [cursor]);

  const summaries = useLiveQuery(() => summariseRange(from, to), [from, to]);
  const bundle = useLiveQuery(() => dayBundle(selectedDate, profile), [selectedDate, profile]);

  const todayISO = today();
  const atCurrentMonth =
    cursor.year === fromISODate(todayISO).getFullYear() &&
    cursor.month === fromISODate(todayISO).getMonth();

  function shiftMonth(delta: number) {
    setCursor((c) => {
      const d = new Date(c.year, c.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  /* ------------------------------- editing ------------------------------- */

  async function openEdit(mealId: string, index: number, item: MealItem) {
    // The food row carries the serving list; a logged item only remembers the
    // one serving it used, so without this you could not switch units.
    const food = item.foodId ? await getFood(item.foodId) : undefined;
    setEditing({ mealId, index, item, food });
  }

  async function saveEdit(qty: number, servingLabel: string, grams?: number) {
    if (!editing) return;
    const { mealId, index, item, food } = editing;

    const next: MealItem =
      food && grams !== undefined
        ? buildMealItemFromGrams(food, grams)
        : food
          ? buildMealItem(food, servingLabel, qty)
          : // No food row (deleted, or an AI/snap item): scale what was logged.
            rescaleMealItem(item, qty, servingLabel);

    await replaceMealItem(mealId, index, next);
    setEditing(null);
    showToast({ message: `${next.name} updated` });
  }

  async function deleteEdited() {
    if (!editing) return;
    await removeMealItem(editing.mealId, editing.index);
    const name = editing.item.name;
    setEditing(null);
    showToast({ message: `${name} removed` });
  }

  /* -------------------------------- render ------------------------------- */

  // Macros come from the meals already stored, so every past date has had this
  // breakdown all along — the calendar just never showed it, and a bare calorie
  // count cannot tell a 1900 kcal day that hit its protein from one that didn't.
  const dayTotals = useMemo(
    () => (bundle?.meals.length ? totalNutrients(bundle.meals) : ZERO_NUTRIENTS),
    [bundle?.meals],
  );
  const dayBurned = useMemo(
    () => (bundle?.workouts ?? []).reduce((sum, w) => sum + w.kcal, 0),
    [bundle?.workouts],
  );
  const targets = profile?.targets ?? ZERO_NUTRIENTS;

  return (
    <div className="pb-28">
      <PageHeader title="Calendar" back="/" />

      <div className="space-y-3 px-4 pt-3">
        {/* ---------------------------- month ---------------------------- */}
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              aria-label="Previous month"
              className="surface-sunken flex h-8 w-8 items-center justify-center rounded-full"
            >
              <IconChevronLeft width={16} height={16} />
            </button>
            <h2 className="text-[15px] font-bold tracking-tight">{monthLabel}</h2>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              aria-label="Next month"
              disabled={atCurrentMonth}
              className="surface-sunken flex h-8 w-8 items-center justify-center rounded-full disabled:opacity-30"
            >
              <IconChevronRight width={16} height={16} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-muted">
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
              <span key={i}>{d}</span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {cells.map((date, i) => {
              if (!date) return <span key={`pad-${i}`} />;
              const s = summaries?.get(date);
              const future = date > todayISO;
              const active = date === selectedDate;

              return (
                <button
                  key={date}
                  type="button"
                  disabled={future}
                  onClick={() => setSelectedDate(date)}
                  aria-label={
                    s
                      ? `${date}, ${s.kcal} calories, ${s.protein} g protein, ${s.carbs} g carbs, ${s.fat} g fat, ${s.fibre} g fibre`
                      : `${date}, nothing logged`
                  }
                  aria-current={active ? 'date' : undefined}
                  className={`relative flex aspect-square flex-col items-center justify-center rounded-xl transition-colors ${
                    active ? 'bg-brand-500 text-white' : future ? 'opacity-25' : 'surface-sunken'
                  }`}
                >
                  {/* Ring shows how close that day landed to the calorie target. */}
                  {s && s.kcal > 0 && !active && (
                    <span className="absolute inset-0 flex items-center justify-center">
                      <RingProgress
                        value={s.kcal / (kcalTarget || 1)}
                        size={34}
                        stroke={2.5}
                        color="var(--color-ring-calorie)"
                      />
                    </span>
                  )}
                  <span
                    className={`relative text-[12px] ${
                      isToday(date) ? 'font-extrabold' : 'font-semibold'
                    } ${active ? 'text-white' : ''}`}
                  >
                    {fromISODate(date).getDate()}
                  </span>
                  {/* Dots for the non-food trackers, so a day that only has
                      water or sleep logged doesn't look empty. */}
                  {s && (
                    <span className="relative mt-0.5 flex gap-[2px]">
                      {s.water && <Dot on={active} color="var(--color-ring-water)" />}
                      {s.sleep && <Dot on={active} color="var(--color-ring-sleep)" />}
                      {s.workouts && <Dot on={active} color="var(--color-ring-workout)" />}
                      {s.weight && <Dot on={active} color="var(--color-ring-weight)" />}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {!atCurrentMonth && (
            <button
              type="button"
              onClick={() => {
                const d = fromISODate(todayISO);
                setCursor({ year: d.getFullYear(), month: d.getMonth() });
                setSelectedDate(todayISO);
              }}
              className="w-full text-[12.5px] font-semibold text-brand-600"
            >
              Jump to today
            </button>
          )}
        </Card>

        {/* -------------------------- day summary ------------------------ */}
        <div className="flex items-baseline justify-between px-1">
          <h2 className="text-[16px] font-bold tracking-tight">
            {relativeDayLabel(selectedDate)}
          </h2>
          <span className="tabular text-[13px] font-semibold text-secondary">
            {Math.round(dayTotals.kcal)} / {kcalTarget} Cal
          </span>
        </div>

        {bundle && (
          <>
            {/* The same card the Diet screen shows for today, for any day you
                pick — calories, and where each macro actually landed. */}
            <DayTotals totals={dayTotals} targets={targets} burned={dayBurned} compact />
            {/* Meals */}
            {MEAL_SLOTS.map((slot) => {
              const meal = bundle.meals.find((m) => m.slot === slot);
              if (!meal || meal.items.length === 0) return null;
              return (
                <Card key={slot} className="space-y-1">
                  <SectionTitle
                    action={
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
                        className={`rounded-lg p-1.5 text-[11px] font-semibold ${
                          confirmMeal === meal.id ? 'tint-soft tint-danger' : 'text-muted'
                        }`}
                      >
                        {confirmMeal === meal.id ? 'Tap to confirm' : <IconTrash width={14} height={14} />}
                      </button>
                    }
                  >
                    {MEAL_SLOT_LABEL[slot]}
                  </SectionTitle>
                  {meal.items.map((item, i) => (
                    <button
                      key={`${meal.id}-${i}`}
                      type="button"
                      onClick={() => openEdit(meal.id, i, item)}
                      className="flex w-full items-center gap-3 border-b border-[var(--surface-border)] py-2.5 text-left last:border-0"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-semibold">{item.name}</p>
                        <p className="text-[12px] text-muted">
                          {formatPortion(item.qty, item.servingLabel)}
                        </p>
                      </div>
                      <span className="tabular text-[13px] font-bold">
                        {Math.round(item.nutrients.kcal)}
                      </span>
                      <IconChevronRight width={14} height={14} className="shrink-0 text-muted" />
                    </button>
                  ))}
                </Card>
              );
            })}

            {/* Trackers */}
            <Card className="space-y-1">
              <SectionTitle>Trackers</SectionTitle>
              <TrackerRow
                icon={<IconDroplet width={16} height={16} />}
                label="Water"
                value={
                  bundle.water.glasses > 0
                    ? `${bundle.water.glasses} of ${bundle.water.goalGlasses} glasses`
                    : undefined
                }
                onClick={() => navigate('/trackers/water')}
              />
              <TrackerRow
                icon={<IconMoon width={16} height={16} />}
                label="Sleep"
                value={
                  bundle.sleep && bundle.sleep.durationMin > 0
                    ? formatDuration(bundle.sleep.durationMin)
                    : undefined
                }
                onClick={() => navigate('/trackers/sleep')}
              />
              <TrackerRow
                icon={<IconScale width={16} height={16} />}
                label="Weight"
                value={bundle.weight ? `${bundle.weight.kg} kg` : undefined}
                onClick={() => navigate('/trackers/weight')}
              />
              <TrackerRow
                icon={<IconSteps width={16} height={16} />}
                label="Steps"
                value={
                  bundle.steps.count > 0 ? bundle.steps.count.toLocaleString() : undefined
                }
                onClick={() => navigate('/trackers/steps')}
              />
            </Card>

            {/* Workouts get their own rows so each can be deleted. */}
            <Card className="space-y-1">
              <SectionTitle
                action={
                  <button
                    type="button"
                    onClick={() => navigate('/trackers/workout')}
                    className="text-[12.5px] font-semibold text-brand-600"
                  >
                    Add
                  </button>
                }
              >
                Workouts
              </SectionTitle>
              {bundle.workouts.length === 0 ? (
                <p className="py-1 text-[12.5px] text-muted">Nothing logged.</p>
              ) : (
                bundle.workouts.map((w) => (
                  <div
                    key={w.id}
                    className="flex items-center gap-3 border-b border-[var(--surface-border)] py-2.5 last:border-0"
                  >
                    <IconDumbbell width={16} height={16} className="shrink-0 text-secondary" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-semibold capitalize">{w.type}</p>
                      <p className="text-[12px] text-muted">
                        {formatDuration(w.durationMin)} · {w.intensity}
                      </p>
                    </div>
                    <span className="tabular text-[13px] font-bold">{Math.round(w.kcal)}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${w.type}`}
                      onClick={async () => {
                        await deleteWorkout(w.id);
                        showToast({ message: `${w.type} removed` });
                      }}
                      className="shrink-0 p-1 text-red-600"
                    >
                      <IconTrash width={15} height={15} />
                    </button>
                  </div>
                ))
              )}
            </Card>

            {bundle.meals.length === 0 &&
              bundle.workouts.length === 0 &&
              bundle.water.glasses === 0 &&
              !bundle.weight && (
                <EmptyState
                  title="Nothing logged this day"
                  body="Pick another date above, or use the + button to add something."
                  action={
                    <Button onClick={() => navigate('/search')}>Log some food</Button>
                  }
                />
              )}
          </>
        )}
      </div>

      {editing && (
        <PortionSheet
          title={editing.item.name}
          per100g={
            editing.food?.per100g ??
            // Reconstruct a per-100g basis from what was logged, so the preview
            // stays honest even when the source food is gone.
            per100gFromItem(editing.item)
          }
          servings={
            editing.food?.servings ?? [
              { label: editing.item.servingLabel, grams: editing.item.grams / (editing.item.qty || 1) },
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
          onDelete={deleteEdited}
        />
      )}
    </div>
  );
}

function Dot({ color, on }: { color: string; on: boolean }) {
  return (
    <span
      className="h-[3px] w-[3px] rounded-full"
      style={{ background: on ? 'rgba(255,255,255,0.9)' : color }}
    />
  );
}

function TrackerRow({
  icon,
  label,
  value,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 border-b border-[var(--surface-border)] py-2.5 text-left last:border-0"
    >
      <span className="shrink-0 text-secondary">{icon}</span>
      <span className="flex-1 text-[14px] font-semibold">{label}</span>
      <span className={`text-[13px] ${value ? 'font-semibold' : 'text-muted'}`}>
        {value ?? 'Not logged'}
      </span>
      <IconChevronRight width={14} height={14} className="shrink-0 text-muted" />
    </button>
  );
}


