import { useState } from 'react';
import { useApp } from '@/stores/useApp';
import { useDay, useHistory } from '@/stores/useDay';
import { saveProfile, setWater } from '@/db/repo';
import { RingProgress } from '@/components/RingProgress';
import { TrendChart } from '@/components/TrendChart';
import { Button, Card, Field, PageHeader, SectionTitle } from '@/components/ui';
import { IconDroplet, IconMinus, IconPlus } from '@/components/icons';

export default function Water() {
  const { profile, selectedDate, refreshProfile } = useApp();
  const day = useDay();
  const history = useHistory(14);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState(String(day.waterGoal));

  const glasses = day.glasses;
  const goal = day.waterGoal;
  const glassMl = day.water?.glassMl ?? 250;

  const change = (delta: number) =>
    setWater(selectedDate, { glasses: Math.max(0, glasses + delta) }, goal);

  async function saveGoal() {
    const next = Math.max(1, Math.min(30, Number(goalInput) || goal));
    await saveProfile({ waterGoalGlasses: next });
    await setWater(selectedDate, { goalGlasses: next }, next);
    await refreshProfile();
    setEditingGoal(false);
  }

  return (
    <div className="pb-6">
      <PageHeader title="Water" subtitle={`Goal: ${goal} glasses · ${glassMl} ml each`} />

      <div className="space-y-3 px-4 pt-3">
        <Card className="flex flex-col items-center gap-4 py-6">
          <RingProgress
            value={glasses / (goal || 1)}
            size={148}
            stroke={11}
            color="var(--color-ring-water)"
            label={`${glasses} of ${goal} glasses`}
          >
            <div className="text-center">
              <p className="tabular text-3xl font-extrabold">{glasses}</p>
              <p className="text-[11px] text-muted">of {goal} glasses</p>
              <p className="tabular mt-0.5 text-[11px] text-muted">
                {((glasses * glassMl) / 1000).toFixed(1)} L
              </p>
            </div>
          </RingProgress>

          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => change(-1)}
              disabled={glasses === 0}
              aria-label="Remove a glass"
              className="hairline flex h-11 w-11 items-center justify-center rounded-full border disabled:opacity-35"
            >
              <IconMinus width={20} height={20} />
            </button>
            <button
              type="button"
              onClick={() => change(1)}
              aria-label="Add a glass"
              className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-ring-water)] text-white shadow-lg transition-transform active:scale-95"
            >
              <IconPlus width={26} height={26} strokeWidth={2.25} />
            </button>
            <button
              type="button"
              onClick={() => change(2)}
              aria-label="Add two glasses"
              className="hairline flex h-11 w-11 items-center justify-center rounded-full border text-[12px] font-bold"
            >
              +2
            </button>
          </div>

          <p className="text-[12.5px] text-secondary">
            {glasses >= goal
              ? "You've hit your water goal today."
              : `${goal - glasses} more to hit your goal.`}
          </p>
        </Card>

        <Card>
          <SectionTitle
            action={
              <button
                type="button"
                onClick={() => {
                  setGoalInput(String(goal));
                  setEditingGoal((v) => !v);
                }}
                className="text-[12.5px] font-semibold text-brand-600"
              >
                {editingGoal ? 'Cancel' : 'Edit goal'}
              </button>
            }
          >
            Daily goal
          </SectionTitle>
          {editingGoal ? (
            <div className="flex items-end gap-2">
              <Field
                value={goalInput}
                onChange={(e) => setGoalInput(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
                suffix="glasses"
                className="flex-1"
              />
              <Button onClick={saveGoal}>Save</Button>
            </div>
          ) : (
            <p className="text-[13px] text-secondary">
              {goal} glasses · about {((goal * glassMl) / 1000).toFixed(1)} L a day.
              {profile?.goal === 'lose' && ' Drinking before meals helps with satiety.'}
            </p>
          )}
        </Card>

        <Card>
          <SectionTitle>Last 14 days</SectionTitle>
          {history ? (
            <TrendChart
              data={history.map((h) => ({ date: h.date, value: h.glasses }))}
              color="var(--color-ring-water)"
              goal={goal}
              unit=" glasses"
            />
          ) : (
            <div className="h-[180px]" />
          )}
        </Card>

        <div className="flex items-start gap-2 px-1 text-[12px] text-muted">
          <IconDroplet width={14} height={14} className="mt-0.5 shrink-0" />
          <p>
            A glass is {glassMl} ml here. Tea, coffee and buttermilk all count toward hydration —
            log them as glasses if that is easier than tracking them as food.
          </p>
        </div>
      </div>
    </div>
  );
}
