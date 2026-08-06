import { useState } from 'react';
import { useApp } from '@/stores/useApp';
import { useWeightHistory } from '@/stores/useDay';
import { saveProfile, setWeight } from '@/db/repo';
import { displayToKg, kgToDisplay, weightUnit } from '@/lib/nutrition';
import { relativeDayLabel } from '@/lib/date';
import { TrendChart } from '@/components/TrendChart';
import { Button, Card, Field, PageHeader, SectionTitle } from '@/components/ui';
import { IconScale } from '@/components/icons';

export default function Weight() {
  const { profile, selectedDate, refreshProfile } = useApp();
  const history = useWeightHistory(120);

  const units = profile?.units ?? 'metric';
  const unit = weightUnit(units);
  const latest = history?.length ? history[history.length - 1] : undefined;
  const start = profile?.startWeightKg ?? latest?.kg ?? 0;
  const target = profile?.targetWeightKg;

  const [input, setInput] = useState('');
  const [targetInput, setTargetInput] = useState(
    target ? String(Math.round(kgToDisplay(target, units) * 10) / 10) : '',
  );
  const [editingTarget, setEditingTarget] = useState(false);

  const changeKg = latest ? latest.kg - start : 0;

  async function log() {
    const value = Number(input);
    if (!value || value <= 0) return;
    await setWeight(selectedDate, displayToKg(value, units));
    await refreshProfile();
    setInput('');
  }

  async function saveTarget() {
    const value = Number(targetInput);
    await saveProfile({ targetWeightKg: value > 0 ? displayToKg(value, units) : undefined });
    await refreshProfile();
    setEditingTarget(false);
  }

  return (
    <div className="pb-6">
      <PageHeader
        title="Weight"
        subtitle={latest ? `Last logged ${relativeDayLabel(latest.date)}` : 'Not logged yet'}
      />

      <div className="space-y-3 px-4 pt-3">
        <Card className="py-6 text-center">
          <p className="tabular text-4xl font-extrabold">
            {latest ? kgToDisplay(latest.kg, units).toFixed(1) : '—'}
            <span className="ml-1 text-lg font-bold text-muted">{unit}</span>
          </p>
          {latest && (
            <p
              className={`tabular mt-1 text-[13px] font-semibold ${
                changeKg < 0 ? 'text-brand-600' : changeKg > 0 ? 'text-accent-600' : 'text-muted'
              }`}
            >
              {changeKg === 0
                ? 'Same as your starting weight'
                : `${Math.abs(kgToDisplay(changeKg, units)).toFixed(1)} ${unit} ${
                    changeKg < 0 ? 'lost' : 'gained'
                  } since you started`}
            </p>
          )}
          {target && latest && (
            <p className="tabular mt-1 text-[12.5px] text-secondary">
              {Math.abs(kgToDisplay(latest.kg - target, units)).toFixed(1)} {unit} to go
            </p>
          )}
        </Card>

        <Card className="space-y-3">
          <SectionTitle>Log a weigh-in</SectionTitle>
          <div className="flex items-end gap-2">
            <Field
              value={input}
              onChange={(e) => setInput(e.target.value)}
              inputMode="decimal"
              placeholder={latest ? kgToDisplay(latest.kg, units).toFixed(1) : '70'}
              suffix={unit}
              className="flex-1"
              hint={`Saved against ${relativeDayLabel(selectedDate)}`}
            />
            <Button onClick={log} disabled={!Number(input)} className="mb-5">
              Save
            </Button>
          </div>
        </Card>

        <Card>
          <SectionTitle
            action={
              <button
                type="button"
                onClick={() => setEditingTarget((v) => !v)}
                className="text-[12.5px] font-semibold text-brand-600"
              >
                {editingTarget ? 'Cancel' : target ? 'Edit' : 'Set'}
              </button>
            }
          >
            Target weight
          </SectionTitle>
          {editingTarget ? (
            <div className="flex items-end gap-2">
              <Field
                value={targetInput}
                onChange={(e) => setTargetInput(e.target.value)}
                inputMode="decimal"
                suffix={unit}
                className="flex-1"
                hint="Leave blank to clear"
              />
              <Button onClick={saveTarget} className="mb-5">
                Save
              </Button>
            </div>
          ) : (
            <p className="text-[13px] text-secondary">
              {target
                ? `${kgToDisplay(target, units).toFixed(1)} ${unit}. Your calorie target follows your current weight automatically.`
                : 'No target set. Setting one shows progress on the home screen.'}
            </p>
          )}
        </Card>

        <Card>
          <SectionTitle>Trend</SectionTitle>
          {history && history.length > 1 ? (
            <TrendChart
              data={history.map((w) => ({
                date: w.date,
                value: Math.round(kgToDisplay(w.kg, units) * 10) / 10,
              }))}
              color="var(--color-ring-weight)"
              kind="area"
              goal={target ? Math.round(kgToDisplay(target, units) * 10) / 10 : undefined}
              unit={` ${unit}`}
              domainFromData
            />
          ) : (
            <p className="py-8 text-center text-[13px] text-muted">
              Log at least two weigh-ins to see a trend.
            </p>
          )}
        </Card>

        <div className="flex items-start gap-2 px-1 text-[12px] text-muted">
          <IconScale width={14} height={14} className="mt-0.5 shrink-0" />
          <p>
            Weigh yourself at the same time of day, ideally first thing. Day-to-day swings of a
            kilo are water, not fat — the trend line is what matters.
          </p>
        </div>
      </div>
    </div>
  );
}
