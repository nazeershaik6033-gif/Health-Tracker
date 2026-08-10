import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/schema';
import { useApp } from '@/stores/useApp';
import { addMealItems, removeMealItem } from '@/db/repo';
import { searchFoods } from '@/lib/foodSearch';
import { searchExercises } from '@/lib/exerciseSearch';
import { buildMealItem } from '@/lib/nutrition';
import { PortionSheet } from '@/components/PortionSheet';
import { FoodRow } from '@/components/FoodRow';
import { PageHeader, EmptyState } from '@/components/ui';
import { IconChevronRight, IconDiet, IconDumbbell, IconPlus, IconSearch } from '@/components/icons';
import { MEAL_SLOT_LABEL, type Exercise, type Food, type MealSlot } from '@/types';

/**
 * One search across the two catalogs the app already has — foods and
 * exercises — reachable from the Home top bar rather than buried inside the
 * meal-logging flow. `/search` stays scoped to "add to this meal slot";
 * this is for "find the thing" from anywhere.
 */
export default function GlobalSearch() {
  const navigate = useNavigate();
  const { selectedDate, showToast } = useApp();
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState<Food | null>(null);
  const [addedIds, setAddedIds] = useState<string[]>([]);

  const foods = useLiveQuery(async () => db.foods.toArray(), []);
  const exercises = useLiveQuery(async () => db.exercises.toArray(), []);

  const q = query.trim();
  const foodResults = useMemo(
    () => (foods && q ? searchFoods(foods, q, 8) : []),
    [foods, q],
  );
  const exerciseResults = useMemo(
    () => (exercises && q ? searchExercises(exercises, q, {}, 8) : []),
    [exercises, q],
  );

  const nothing = q.length > 0 && foodResults.length === 0 && exerciseResults.length === 0;

  async function addFood(food: Food, qty = 1, servingLabel?: string) {
    const item = buildMealItem(food, servingLabel ?? food.servings[0]?.label ?? '100 g', qty);
    const slot = guessSlot();
    const meal = await addMealItems(selectedDate, slot, [item]);
    setAddedIds((prev) => [...prev, food.id]);
    setDetail(null);
    showToast({
      message: `${food.name} added to ${MEAL_SLOT_LABEL[slot]}`,
      actionLabel: 'Undo',
      onAction: async () => {
        const fresh = await db.meals.get(meal.id);
        if (fresh) await removeMealItem(meal.id, fresh.items.length - 1);
        setAddedIds((prev) => prev.filter((id) => id !== food.id));
      },
    });
  }

  return (
    <div className="pb-10">
      <PageHeader title="Search" back={() => navigate(-1)} />

      <div className="px-4 pt-3">
        <div className="hairline flex items-center gap-2 rounded-xl border px-3.5 py-2.5">
          <IconSearch width={18} height={18} className="shrink-0 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search foods and exercises"
            className="w-full bg-transparent text-[15px] outline-none placeholder:text-[var(--text-muted)]"
            autoComplete="off"
            enterKeyHint="search"
            autoFocus
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} className="text-[13px] text-muted">
              Clear
            </button>
          )}
        </div>

        {!q && (
          <button
            type="button"
            onClick={() => navigate('/food/recipe')}
            className="surface-card mt-3 flex w-full items-center gap-3 p-3 text-left"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white">
              <IconDiet width={18} height={18} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-bold">Build a food from ingredients</p>
              <p className="text-[11.5px] text-secondary">
                Give quantities, get the combined macros
              </p>
            </div>
            <IconChevronRight width={16} height={16} className="shrink-0 text-muted" />
          </button>
        )}
      </div>

      <div className="px-4 pt-4">
        {!q && (
          <EmptyState
            icon={<IconSearch width={22} height={22} />}
            title="Search anything"
            body="Foods, dishes and exercises — one search across everything you've logged and everything bundled in."
          />
        )}

        {nothing && (
          <EmptyState
            icon={<IconSearch width={22} height={22} />}
            title={`No match for "${q}"`}
            body="Try the Diet search to create a custom food, or Workout to add a custom exercise."
          />
        )}

        {foodResults.length > 0 && (
          <div className="mb-5">
            <h2 className="mb-1 text-[13px] font-bold text-secondary">Foods</h2>
            {foodResults.map((food) => (
              <FoodRow
                key={food.id}
                food={food}
                added={addedIds.includes(food.id)}
                onAdd={() => addFood(food)}
                onOpen={() => setDetail(food)}
              />
            ))}
          </div>
        )}

        {exerciseResults.length > 0 && (
          <div>
            <h2 className="mb-1 text-[13px] font-bold text-secondary">Exercises</h2>
            <ul>
              {exerciseResults.map((exercise) => (
                <ExerciseRow key={exercise.id} exercise={exercise} navigate={navigate} />
              ))}
            </ul>
          </div>
        )}
      </div>

      {detail && (
        <PortionSheet
          title={detail.name}
          brand={detail.brand}
          per100g={detail.per100g}
          servings={detail.servings}
          onClose={() => setDetail(null)}
          onConfirm={(qty, label) => addFood(detail, qty, label)}
          onEditFood={() => navigate(`/food/${detail.id}/edit`)}
        />
      )}
    </div>
  );
}

function ExerciseRow({
  exercise,
  navigate,
}: {
  exercise: Exercise;
  navigate: ReturnType<typeof useNavigate>;
}) {
  return (
    <li className="border-b border-[var(--surface-border)] last:border-0">
      <button
        type="button"
        onClick={() => navigate(`/trackers/workout?exercise=${exercise.id}`)}
        className="flex w-full items-center gap-3 py-3 text-left"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full tint-soft tint-brand">
          <IconDumbbell width={15} height={15} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold">{exercise.name}</p>
          <p className="truncate text-[12.5px] text-secondary">
            {exercise.muscles.join(', ')}
          </p>
        </div>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-500 text-white">
          <IconPlus width={14} height={14} strokeWidth={2.5} />
        </span>
      </button>
    </li>
  );
}

/** Sensible default slot based on the time of day — same rule as /search. */
function guessSlot(): MealSlot {
  const h = new Date().getHours();
  if (h < 10) return 'breakfast';
  if (h < 12) return 'morning_snack';
  if (h < 15) return 'lunch';
  if (h < 18) return 'evening_snack';
  return 'dinner';
}
