import { useState } from 'react';
import { useApp } from '@/stores/useApp';
import { useDay, useHistory } from '@/stores/useDay';
import { saveProfile, setSteps } from '@/db/repo';
import { RingProgress } from '@/components/RingProgress';
import { TrendChart } from '@/components/TrendChart';
import { Button, Card, Field, PageHeader, SectionTitle } from '@/components/ui';
import { IconSteps as IconStepsGlyph, IconInfo } from '@/components/icons';

const QUICK_ADD = [500, 1000, 2500];

export default function Steps() {
  const { selectedDate, refreshProfile } = useApp();
  const day = useDay();
  const history = useHistory(14);

  const goal = day.stepGoal;
  const count = day.stepCount;
  const [input, setInput] = useState('');
  const [goalInput, setGoalInput] = useState(String(goal));
  const [editingGoal, setEditingGoal] = useState(false);

  const set = (value: number) => setSteps(selectedDate, Math.max(0, value), goal);

  async function saveGoal() {
    const next = Math.max(1000, Math.min(50000, Number(goalInput) || goal));
    await saveProfile({ stepGoal: next });
    await setSteps(selectedDate, count, next);
    await refreshProfile();
    setEditingGoal(false);
  }

  return (
    <div className="pb-6">
      <PageHeader title="Steps" subtitle={`Goal: ${goal.toLocaleString()} steps`} />

      <div className="space-y-3 px-4 pt-3">
        <Card className="flex flex-col items-center gap-4 py-6">
          <RingProgress
            value={count / (goal || 1)}
            size={148}
            stroke={11}
            color="var(--color-ring-walk)"
            label={`${count} of ${goal} steps`}
          >
            <div className="text-center">
              <p className="tabular text-3xl font-extrabold">{count.toLocaleString()}</p>
              <p className="text-[11px] text-muted">of {goal.toLocaleString()}</p>
            </div>
          </RingProgress>

          <div className="flex gap-2">
            {QUICK_ADD.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => set(count + n)}
                className="hairline rounded-full border px-3.5 py-2 text-[13px] font-semibold"
              >
                +{n.toLocaleString()}
              </button>
            ))}
          </div>
        </Card>

        <Card className="space-y-3">
          <SectionTitle>Set today&apos;s total</SectionTitle>
          <div className="flex items-end gap-2">
            <Field
              value={input}
              onChange={(e) => setInput(e.target.value.replace(/\D/g, ''))}
              inputMode="numeric"
              placeholder={String(count)}
              suffix="steps"
              className="flex-1"
            />
            <Button
              onClick={() => {
                set(Number(input) || 0);
                setInput('');
              }}
              disabled={!input}
            >
              Save
            </Button>
          </div>
          <p className="text-[12px] text-muted">
            Replaces the day&apos;s total — use this to copy the number from your phone&apos;s
            health app or watch.
          </p>
        </Card>

        <Card>
          <SectionTitle
            action={
              <button
                type="button"
                onClick={() => setEditingGoal((v) => !v)}
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
                suffix="steps"
                className="flex-1"
              />
              <Button onClick={saveGoal}>Save</Button>
            </div>
          ) : (
            <p className="text-[13px] text-secondary">
              {goal.toLocaleString()} steps a day. Anything above about 7,000 is where most of the
              health benefit shows up.
            </p>
          )}
        </Card>

        <Card>
          <SectionTitle>Last 14 days</SectionTitle>
          {history ? (
            <TrendChart
              data={history.map((h) => ({ date: h.date, value: h.steps }))}
              color="var(--color-ring-walk)"
              goal={goal}
              unit=" steps"
            />
          ) : (
            <div className="h-[180px]" />
          )}
        </Card>

        <div className="flex items-start gap-2 px-1 text-[12px] text-muted">
          <IconInfo width={14} height={14} className="mt-0.5 shrink-0" />
          <p>
            Steps are entered by hand. A browser can&apos;t read your phone&apos;s pedometer in the
            background, so auto-tracking isn&apos;t something this app can honestly offer — copy
            the number across once a day instead.
          </p>
        </div>

        <div className="flex items-start gap-2 px-1 text-[12px] text-muted">
          <IconStepsGlyph width={14} height={14} className="mt-0.5 shrink-0" />
          <p>Steps aren&apos;t counted toward calories burned — log walks under Workout for that.</p>
        </div>
      </div>
    </div>
  );
}
