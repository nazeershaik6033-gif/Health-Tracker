import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/stores/useApp';
import { saveProfile, setWeight } from '@/db/repo';
import { today } from '@/lib/date';
import {
  ACTIVITY_LABEL,
  GOAL_LABEL,
  computeTargets,
  displayToKg,
  kgToDisplay,
  weightUnit,
} from '@/lib/nutrition';
import { Button, Card, Field } from '@/components/ui';
import { IconCheck, IconSparkle } from '@/components/icons';
import type { ActivityLevel, Goal, Sex, UnitSystem } from '@/types';

const STEPS = ['You', 'Body', 'Goal', 'Targets'] as const;

export default function Onboarding() {
  const navigate = useNavigate();
  const { setSettings, refreshProfile } = useApp();

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [sex, setSex] = useState<Sex>('other');
  const [birthYear, setBirthYear] = useState(String(new Date().getFullYear() - 28));
  const [units, setUnits] = useState<UnitSystem>('metric');
  const [heightCm, setHeightCm] = useState('170');
  const [weightInput, setWeightInput] = useState('70');
  const [targetWeightInput, setTargetWeightInput] = useState('');
  const [goal, setGoal] = useState<Goal>('lose');
  const [activity, setActivity] = useState<ActivityLevel>('light');
  const [kcalOverride, setKcalOverride] = useState('');

  const weightKg = displayToKg(Number(weightInput) || 0, units);
  const heightValue = Number(heightCm) || 0;

  const computed = useMemo(
    () =>
      computeTargets({
        sex,
        birthYear: Number(birthYear) || new Date().getFullYear() - 28,
        heightCm: units === 'imperial' ? heightValue * 2.54 : heightValue,
        weightKg: weightKg || 70,
        goal,
        activity,
      }),
    [sex, birthYear, heightValue, weightKg, goal, activity, units],
  );

  const targets = kcalOverride
    ? computeTargetsWithKcal(computed, Number(kcalOverride))
    : computed;

  const canAdvance = () => {
    if (step === 0) return name.trim().length > 0 && Number(birthYear) > 1900;
    if (step === 1) return heightValue > 0 && weightKg > 0;
    return true;
  };

  async function finish() {
    setSaving(true);
    try {
      const cm = units === 'imperial' ? heightValue * 2.54 : heightValue;
      await saveProfile({
        name: name.trim(),
        sex,
        birthYear: Number(birthYear),
        heightCm: cm,
        startWeightKg: weightKg,
        targetWeightKg: targetWeightInput
          ? displayToKg(Number(targetWeightInput), units)
          : undefined,
        goal,
        activity,
        units,
        targets,
        targetsManual: Boolean(kcalOverride),
      });
      // Seed today's weigh-in so the weight tracker has a starting point.
      await setWeight(today(), weightKg);
      await setSettings({ onboardingDone: true });
      await refreshProfile();
      navigate('/', { replace: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col px-5 pt-safe pb-safe">
      <div className="flex items-center gap-1.5 py-4">
        {STEPS.map((label, i) => (
          <div key={label} className="flex flex-1 flex-col gap-1.5">
            <div
              className={`h-1 rounded-full transition-colors ${
                i <= step ? 'bg-brand-500' : 'surface-sunken'
              }`}
            />
            <span
              className={`text-[10.5px] font-semibold ${
                i <= step ? 'text-brand-600' : 'text-muted'
              }`}
            >
              {label}
            </span>
          </div>
        ))}
      </div>

      <div className="flex-1 py-2">
        {step === 0 && (
          <Section
            title="Welcome to Healthify"
            body="A few details so your calorie and macro targets actually fit you. Everything stays on this device."
          >
            <Field
              label="What should we call you?"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              autoFocus
              autoComplete="given-name"
            />
            <Field
              label="Year of birth"
              value={birthYear}
              onChange={(e) => setBirthYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
              inputMode="numeric"
              placeholder="1996"
            />
            <Choice
              label="Sex"
              hint="Used only for the BMR formula."
              value={sex}
              onChange={setSex}
              options={[
                ['male', 'Male'],
                ['female', 'Female'],
                ['other', 'Prefer not to say'],
              ]}
            />
          </Section>
        )}

        {step === 1 && (
          <Section title="Your body" body="We use these to estimate what you burn in a day.">
            <Choice
              label="Units"
              value={units}
              onChange={(u: UnitSystem) => {
                // Convert the entered weight so the number stays meaningful.
                const kg = displayToKg(Number(weightInput) || 0, units);
                setWeightInput(String(Math.round(kgToDisplay(kg, u) * 10) / 10));
                if (targetWeightInput) {
                  const tKg = displayToKg(Number(targetWeightInput), units);
                  setTargetWeightInput(String(Math.round(kgToDisplay(tKg, u) * 10) / 10));
                }
                setHeightCm((h) =>
                  String(
                    Math.round(
                      (u === 'imperial' ? Number(h) / 2.54 : Number(h) * 2.54) * 10,
                    ) / 10,
                  ),
                );
                setUnits(u);
              }}
              options={[
                ['metric', 'Metric (kg, cm)'],
                ['imperial', 'Imperial (lb, in)'],
              ]}
            />
            <Field
              label="Height"
              value={heightCm}
              onChange={(e) => setHeightCm(e.target.value)}
              inputMode="decimal"
              suffix={units === 'imperial' ? 'in' : 'cm'}
            />
            <Field
              label="Current weight"
              value={weightInput}
              onChange={(e) => setWeightInput(e.target.value)}
              inputMode="decimal"
              suffix={weightUnit(units)}
            />
            <Choice
              label="How active are you?"
              value={activity}
              onChange={setActivity}
              options={(Object.keys(ACTIVITY_LABEL) as ActivityLevel[]).map((k) => [
                k,
                ACTIVITY_LABEL[k],
              ])}
            />
          </Section>
        )}

        {step === 2 && (
          <Section title="Your goal" body="This sets your calorie target and macro split.">
            <Choice
              label="I want to"
              value={goal}
              onChange={setGoal}
              options={(Object.keys(GOAL_LABEL) as Goal[]).map((k) => [k, GOAL_LABEL[k]])}
            />
            {goal !== 'maintain' && (
              <Field
                label="Target weight (optional)"
                value={targetWeightInput}
                onChange={(e) => setTargetWeightInput(e.target.value)}
                inputMode="decimal"
                suffix={weightUnit(units)}
                hint="Shown on the weight tracker as progress."
              />
            )}
          </Section>
        )}

        {step === 3 && (
          <Section
            title="Your daily targets"
            body="Calculated with Mifflin-St Jeor. Adjust the calories if you already know your number."
          >
            <Card className="space-y-3">
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] font-semibold text-secondary">Calories</span>
                <span className="tabular text-2xl font-extrabold text-brand-600">
                  {targets.kcal.toLocaleString()}
                </span>
              </div>
              <div className="hairline grid grid-cols-4 gap-2 border-t pt-3 text-center">
                <Macro label="Protein" value={`${targets.protein}g`} />
                <Macro label="Fat" value={`${targets.fat}g`} />
                <Macro label="Carbs" value={`${targets.carbs}g`} />
                <Macro label="Fibre" value={`${targets.fibre}g`} />
              </div>
            </Card>
            <Field
              label="Override calories (optional)"
              value={kcalOverride}
              onChange={(e) => setKcalOverride(e.target.value.replace(/\D/g, '').slice(0, 5))}
              inputMode="numeric"
              placeholder={String(computed.kcal)}
              suffix="kcal"
              hint="Leave blank to keep the calculated target and let it follow your weight."
            />
            <div className="flex items-start gap-2 accent-card p-3 text-[12.5px] text-brand-800">
              <IconSparkle width={16} height={16} className="mt-0.5 shrink-0" />
              <p>
                Add an AI key in Settings to unlock photo calorie tracking, label scanning, voice
                logging and your coach. Everything else works without one.
              </p>
            </div>
          </Section>
        )}
      </div>

      <div className="flex gap-2 pb-4">
        {step > 0 && (
          <Button variant="secondary" size="lg" onClick={() => setStep((s) => s - 1)}>
            Back
          </Button>
        )}
        {step < STEPS.length - 1 ? (
          <Button size="lg" full disabled={!canAdvance()} onClick={() => setStep((s) => s + 1)}>
            Continue
          </Button>
        ) : (
          <Button size="lg" full disabled={saving} onClick={finish}>
            <IconCheck width={18} height={18} />
            {saving ? 'Setting up…' : 'Start tracking'}
          </Button>
        )}
      </div>
    </div>
  );
}

function computeTargetsWithKcal(base: ReturnType<typeof computeTargets>, kcal: number) {
  if (!kcal || kcal < 800) return base;
  const ratio = kcal / base.kcal;
  return {
    kcal,
    protein: Math.round(base.protein),
    fat: Math.round(base.fat * ratio),
    carbs: Math.round(base.carbs * ratio),
    fibre: Math.round((kcal / 1000) * 14),
  };
}

function Section({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[26px] leading-tight font-extrabold tracking-tight">{title}</h1>
        <p className="mt-1.5 text-[14px] text-secondary">{body}</p>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Macro({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="tabular text-[15px] font-bold">{value}</p>
      <p className="text-[11px] text-muted">{label}</p>
    </div>
  );
}

function Choice<T extends string>({
  label,
  hint,
  value,
  onChange,
  options,
}: {
  label: string;
  hint?: string;
  value: T;
  onChange: (v: T) => void;
  options: [T, string][];
}) {
  return (
    <div>
      <span className="mb-1.5 block text-[13px] font-medium text-secondary">{label}</span>
      <div className="space-y-1.5">
        {options.map(([val, text]) => (
          <button
            key={val}
            type="button"
            onClick={() => onChange(val)}
            className={`hairline flex w-full items-center gap-2.5 rounded-xl border px-3.5 py-3 text-left text-[14px] transition-colors ${
              value === val ? 'border-brand-500 tint-soft tint-brand font-semibold' : ''
            }`}
          >
            <span
              className={`flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border-2 ${
                value === val ? 'border-brand-500' : 'border-[var(--surface-border)]'
              }`}
              style={{ width: '1.125rem', height: '1.125rem' }}
            >
              {value === val && <span className="h-2 w-2 rounded-full bg-brand-500" />}
            </span>
            {text}
          </button>
        ))}
      </div>
      {hint && <p className="mt-1 text-[12px] text-muted">{hint}</p>}
    </div>
  );
}
