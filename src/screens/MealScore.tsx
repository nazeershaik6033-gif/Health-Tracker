import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/schema';
import { deleteMeal } from '@/db/repo';
import { useApp } from '@/stores/useApp';
import { RingProgress } from '@/components/RingProgress';
import { Button, Card, EmptyState, PageHeader, ScoreCircle } from '@/components/ui';
import { IconChevronRight, IconDiet, IconSparkle, IconTrash } from '@/components/icons';
import { formatPortion, mealNutrients } from '@/lib/nutrition';
import { MEAL_SLOT_LABEL } from '@/types';
import { Link } from 'react-router-dom';

/**
 * "Your Meal Score" — Ria's take on top, then a card per ingredient with its
 * own 0–10 circle, matching the reference app's breakdown screen.
 */
export default function MealScore() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast, showConfirm } = useApp();

  const meal = useLiveQuery(async () => (id ? db.meals.get(id) : undefined), [id]);
  const snap = useLiveQuery(
    async () => (meal?.snapId ? db.snaps.get(meal.snapId) : undefined),
    [meal?.snapId],
  );

  const [photo, setPhoto] = useState('');
  useEffect(() => {
    if (!snap) return;
    const url = URL.createObjectURL(snap.blob);
    setPhoto(url);
    return () => URL.revokeObjectURL(url);
  }, [snap]);

  if (meal === undefined) {
    return (
      <div className="min-h-dvh">
        <PageHeader title="Your Meal Score" back={() => navigate(-1)} />
      </div>
    );
  }

  if (!meal) {
    return (
      <div className="min-h-dvh">
        <PageHeader title="Your Meal Score" back="/diet" />
        <EmptyState
          icon={<IconDiet width={22} height={22} />}
          title="That meal is gone"
          body="It may have been deleted."
        />
      </div>
    );
  }

  const totals = mealNutrients(meal);
  const scored = meal.items.filter((i) => i.score !== undefined);
  const hasScores = scored.length > 0;

  return (
    <div className="pb-8">
      <PageHeader
        title="Your Meal Score"
        subtitle={MEAL_SLOT_LABEL[meal.slot]}
        back={() => navigate(-1)}
      />

      <div className="space-y-3 px-4 pt-3">
        {photo && (
          <img src={photo} alt="" className="h-48 w-full rounded-2xl object-cover" />
        )}

        {/* Overall */}
        <Card className="flex items-center gap-4">
          <RingProgress
            value={(meal.healthScore ?? 0) / 10}
            size={68}
            stroke={5}
            color={
              (meal.healthScore ?? 0) >= 8
                ? 'var(--color-brand-500)'
                : (meal.healthScore ?? 0) >= 5
                  ? '#e5a50a'
                  : '#dc2626'
            }
            label={`Meal score ${meal.healthScore ?? 0} out of 10`}
          >
            <div className="text-center leading-none">
              <p className="tabular text-lg font-extrabold">{meal.healthScore ?? '—'}</p>
              <p className="text-[8px] text-muted">of 10</p>
            </div>
          </RingProgress>
          <div className="min-w-0 flex-1">
            <p className="tabular text-[19px] font-extrabold">
              {Math.round(totals.kcal)} <span className="text-[13px] font-semibold">Cal</span>
            </p>
            <p className="tabular text-[12px] text-secondary">
              P {Math.round(totals.protein)}g · F {Math.round(totals.fat)}g · C{' '}
              {Math.round(totals.carbs)}g · Fibre {Math.round(totals.fibre)}g
            </p>
          </div>
        </Card>

        {/* Ria's take */}
        {meal.aiNote && (
          <div className="accent-card p-4">
            <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-bold text-brand-700">
              <IconSparkle width={13} height={13} />
              Ria&apos;s Take
            </p>
            <p className="text-[13px] leading-relaxed text-brand-800/90">{meal.aiNote}</p>
          </div>
        )}

        {/* Per-item breakdown */}
        <div>
          <h2 className="mb-2 px-1 text-[15px] font-bold tracking-tight">Meal Breakdown</h2>
          <div className="space-y-2">
            {meal.items.map((item, i) => (
              <Card key={`${item.name}-${i}`} className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[14.5px] font-bold">{item.name}</p>
                  <p className="tabular text-[12px] text-secondary">
                    {formatPortion(item.qty, item.servingLabel)} · {Math.round(item.nutrients.kcal)} Cal ·{' '}
                    {Math.round(item.nutrients.protein)}g protein
                  </p>
                  {item.note && (
                    <p className="mt-1.5 text-[12.5px] leading-relaxed text-secondary">
                      {item.note}
                    </p>
                  )}
                </div>
                {item.score !== undefined && <ScoreCircle score={item.score} size={36} />}
              </Card>
            ))}
          </div>
        </div>

        {!hasScores && (
          <p className="px-1 text-[12.5px] text-muted">
            This meal was logged by hand, so there are no per-item scores. Snap a photo or use
            voice logging to get them.
          </p>
        )}

        {/* Removing the whole meal was previously impossible from here: the
            only route was deleting each item on the Diet screen one by one. */}
        <Button
          variant="secondary"
          full
          onClick={() =>
            showConfirm({
              title: 'Remove this meal?',
              body: `All ${meal.items.length} item${
                meal.items.length === 1 ? '' : 's'
              } in it will be deleted.${
                meal.snapId ? ' The photo stays in your Snap Gallery.' : ''
              }`,
              confirmLabel: 'Remove',
              onConfirm: async () => {
                await deleteMeal(meal.id);
                showToast({ message: 'Meal removed' });
                navigate('/diet', { replace: true });
              },
            })
          }
        >
          <IconTrash width={15} height={15} />
          Remove this meal
        </Button>

        {meal.snapId && (
          <p className="px-1 text-[11.5px] text-muted">
            The photo stays in your Snap Gallery so you can log it again.
          </p>
        )}

        <Link
          to="/coach"
          className="flex items-center gap-2.5 accent-card p-3.5 text-brand-800"
        >
          <IconSparkle width={17} height={17} className="shrink-0 text-brand-600" />
          <span className="flex-1 text-[13.5px] font-semibold">Ask Ria about this meal</span>
          <IconChevronRight width={16} height={16} />
        </Link>
      </div>
    </div>
  );
}
