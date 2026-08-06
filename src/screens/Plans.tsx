import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/stores/useApp';
import { dayBundle, latestPlan, savePlan } from '@/db/repo';
import { dayContext, generateDietPlan, generateWorkoutPlan } from '@/ai/service';
import { hasKey } from '@/ai/registry';
import { describeError } from '@/ai/types';
import { Button, Card, EmptyState, Skeleton } from '@/components/ui';
import { IconDumbbell, IconPlans, IconRefresh, IconSparkle } from '@/components/icons';
import { MEAL_SLOT_LABEL } from '@/types';
import type { Plan } from '@/types';

type Tab = 'diet' | 'workout';

export default function Plans() {
  const navigate = useNavigate();
  const { profile, settings, selectedDate } = useApp();
  const keyed = hasKey(settings);

  const [tab, setTab] = useState<Tab>('diet');
  const [plans, setPlans] = useState<Record<Tab, Plan | null | undefined>>({
    diet: undefined,
    workout: undefined,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      const [diet, workout] = await Promise.all([latestPlan('diet'), latestPlan('workout')]);
      setPlans({ diet: diet ?? null, workout: workout ?? null });
    })();
  }, []);

  async function generate(kind: Tab) {
    if (!keyed || busy) return;
    setBusy(true);
    setError('');
    try {
      const bundle = await dayBundle(selectedDate, profile);
      const context = dayContext(bundle, profile);

      const plan =
        kind === 'diet'
          ? await savePlan({ kind: 'diet', ...(await generateDietPlan(settings, context, 3)) })
          : await savePlan({
              kind: 'workout',
              days: [],
              ...(await generateWorkoutPlan(settings, context)),
            });

      setPlans((prev) => ({ ...prev, [kind]: plan }));
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  const plan = plans[tab];

  return (
    <div className="px-4 pt-safe pb-6">
      <div className="flex items-center justify-between py-3">
        <h1 className="text-[22px] font-extrabold tracking-tight">Plans</h1>
        {plan && keyed && (
          <button
            type="button"
            onClick={() => generate(tab)}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] font-semibold text-brand-600 disabled:opacity-50"
          >
            <IconRefresh width={14} height={14} className={busy ? 'animate-spin' : ''} />
            Regenerate
          </button>
        )}
      </div>

      <div className="surface-sunken mb-4 flex gap-1 rounded-xl p-1">
        {(['diet', 'workout'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 rounded-lg py-2 text-[13px] font-semibold transition-colors ${
              tab === t ? 'bg-[var(--surface-card)] shadow-sm' : 'text-secondary'
            }`}
          >
            {t === 'diet' ? 'Diet' : 'Workout'}
          </button>
        ))}
      </div>

      {!keyed ? (
        <EmptyState
          icon={<IconSparkle width={22} height={22} />}
          title="Plans are AI-generated"
          body="Add an API key and Ria will build a plan from your targets, your goal and what you actually log."
          action={<Button onClick={() => navigate('/settings')}>Open Settings</Button>}
        />
      ) : busy && !plan ? (
        <Card className="space-y-3">
          <div className="flex items-center gap-2">
            <IconSparkle width={16} height={16} className="animate-pulse text-brand-600" />
            <p className="text-[14px] font-bold">Building your plan…</p>
          </div>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-xl" />
          ))}
        </Card>
      ) : plan === undefined ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : plan === null ? (
        <EmptyState
          icon={tab === 'diet' ? <IconPlans width={22} height={22} /> : <IconDumbbell width={22} height={22} />}
          title={tab === 'diet' ? 'No diet plan yet' : 'No workout plan yet'}
          body={
            tab === 'diet'
              ? 'Ria will build three days of meals around your calorie and protein targets.'
              : 'Ria will build a week of training matched to your goal and current activity level.'
          }
          action={
            <Button onClick={() => generate(tab)} disabled={busy}>
              <IconSparkle width={16} height={16} />
              {busy ? 'Building…' : 'Generate a plan'}
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          <Card>
            <h2 className="text-[16px] font-bold tracking-tight">{plan.title}</h2>
            {plan.summary && (
              <p className="mt-1.5 text-[13px] leading-relaxed text-secondary">{plan.summary}</p>
            )}
          </Card>

          {tab === 'diet' &&
            plan.days.map((day) => (
              <Card key={day.label} className="py-3">
                <h3 className="px-1 text-[14px] font-bold">{day.label}</h3>
                <ul className="mt-1">
                  {day.meals.map((meal, i) => (
                    <li
                      key={`${meal.slot}-${i}`}
                      className="flex items-start gap-3 border-t border-[var(--surface-border)] px-1 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-bold tracking-wide text-brand-600 uppercase">
                          {MEAL_SLOT_LABEL[meal.slot]}
                        </p>
                        <p className="mt-0.5 text-[13.5px] leading-snug">{meal.suggestion}</p>
                      </div>
                      <span className="tabular shrink-0 text-[12.5px] font-semibold text-secondary">
                        {Math.round(meal.kcal)} Cal
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="tabular mt-2 border-t border-[var(--surface-border)] px-1 pt-2 text-right text-[12px] font-semibold text-secondary">
                  {Math.round(day.meals.reduce((s, m) => s + m.kcal, 0))} Cal total
                </p>
              </Card>
            ))}

          {tab === 'workout' &&
            (plan.workouts ?? []).map((w, i) => (
              <Card key={`${w.day}-${i}`} className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-ring-workout)]/12 text-[var(--color-ring-workout)]">
                  <IconDumbbell width={19} height={19} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-[14px] font-bold">{w.day}</p>
                    <span className="tabular shrink-0 text-[12px] text-secondary">
                      {w.minutes} min
                    </span>
                  </div>
                  <p className="text-[12.5px] font-semibold text-brand-600">{w.focus}</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-secondary">{w.detail}</p>
                </div>
              </Card>
            ))}

          <p className="px-1 text-center text-[11px] text-muted">
            A plan is a starting point, not a prescription. Adjust it to how you actually eat and
            train.
          </p>
        </div>
      )}

      {error && <p className="mt-3 text-center text-[12.5px] text-red-600">{error}</p>}
    </div>
  );
}
