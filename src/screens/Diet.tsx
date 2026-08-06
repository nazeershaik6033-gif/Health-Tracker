import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '@/stores/useApp';
import { useDay } from '@/stores/useDay';
import { removeMealItem } from '@/db/repo';
import { formatPortion, mealNutrients, slotTarget } from '@/lib/nutrition';
import { addDays, relativeDayLabel, today } from '@/lib/date';
import { RingProgress } from '@/components/RingProgress';
import { MacroBar } from '@/components/MacroBar';
import { Card, EmptyState, ScoreCircle } from '@/components/ui';
import {
  IconChevronLeft,
  IconChevronRight,
  IconDiet,
  IconPlus,
  IconSparkle,
  IconTrash,
} from '@/components/icons';
import { MEAL_SLOTS, MEAL_SLOT_LABEL, type MealSlot } from '@/types';

export default function Diet() {
  const navigate = useNavigate();
  const { profile, selectedDate, setSelectedDate, setPendingSlot, showToast } = useApp();
  const day = useDay();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

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
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] font-medium">{item.name}</p>
                          <p className="truncate text-[12px] text-secondary">
                            {formatPortion(item.qty, item.servingLabel)}
                          </p>
                        </div>
                        <span className="tabular shrink-0 text-[13px] font-semibold">
                          {Math.round(item.nutrients.kcal)}
                        </span>
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
                              ? 'bg-red-50 text-red-600'
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
                        className="flex items-center gap-2 rounded-lg bg-brand-50 px-2.5 py-2 text-[12.5px] font-semibold text-brand-800"
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
    </div>
  );
}
