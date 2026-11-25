import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/stores/useApp';
import { saveProfile } from '@/db/repo';
import { useEnergy } from '@/lib/energy';
import { mealShares } from '@/lib/nutrition';
import { measureMaintenance, type AdaptiveResult } from '@/lib/adaptive';
import { persistState, requestPersistence, storageEstimate, type PersistState } from '@/lib/storage';
import { badgeSupported } from '@/lib/badge';
import { exportCsv } from '@/lib/csv';
import { formatBytes } from '@/lib/image';
import { Button, Card, Chip, Field, SectionTitle } from '@/components/ui';
import { IconBook, IconChevronRight, IconDownload, IconLeaf } from '@/components/icons';
import { MEAL_PRESETS, MEAL_SLOTS, MEAL_SLOT_LABEL, type MealSlot } from '@/types';

/* ------------------------------- primitives ------------------------------ */

function Switch({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${
        on ? 'bg-brand-500' : 'bg-[var(--surface-border)]'
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
          on ? 'left-[18px]' : 'left-0.5'
        }`}
      />
    </button>
  );
}

function Body({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return (
    <p className={`text-[12.5px] leading-relaxed ${muted ? 'text-muted' : 'text-secondary'}`}>
      {children}
    </p>
  );
}

function LinkCard({ to, icon, title, body }: { to: string; icon: ReactNode; title: string; body: string }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(to)}
      className="surface-card flex w-full items-center gap-3 p-4 text-left"
    >
      <span className="tint-soft tint-brand flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14.5px] font-semibold">{title}</span>
        <span className="block text-[12px] leading-snug text-secondary">{body}</span>
      </span>
      <IconChevronRight width={18} height={18} className="shrink-0 text-muted" />
    </button>
  );
}

/* ------------------------------ energy unit ------------------------------ */

export function EnergyUnitCard() {
  const unit = useApp((s) => s.settings.energyUnit ?? 'kcal');
  const setSettings = useApp((s) => s.setSettings);
  return (
    <Card className="space-y-3">
      <SectionTitle>Energy unit</SectionTitle>
      <div className="flex gap-2">
        <Chip active={unit === 'kcal'} onClick={() => setSettings({ energyUnit: 'kcal' })}>
          Calories (kcal)
        </Chip>
        <Chip active={unit === 'kj'} onClick={() => setSettings({ energyUnit: 'kj' })}>
          Kilojoules (kJ)
        </Chip>
      </div>
      <Body muted>
        Only changes how energy is shown — 1 kcal is 4.184 kJ. Everything is stored in kcal, so
        switching back and forth never changes a logged number. Exports always use kcal.
      </Body>
    </Card>
  );
}

/* ------------------------------- meal split ------------------------------ */

export function MealSplitCard() {
  const profile = useApp((s) => s.profile);
  const refreshProfile = useApp((s) => s.refreshProfile);
  const showToast = useApp((s) => s.showToast);
  const energy = useEnergy();
  const preset = profile?.mealPreset ?? 'standard';
  const current = mealShares(profile);

  const [draft, setDraft] = useState<Record<MealSlot, string>>(() => toDraft(current));
  useEffect(() => setDraft(toDraft(mealShares(profile))), [profile]);

  const total = MEAL_SLOTS.reduce((sum, s) => sum + (Number(draft[s]) || 0), 0);
  const addsUp = Math.abs(total - 100) < 0.6;

  async function choose(id: typeof preset) {
    // A period split saved against the old meal split would no longer match
    // it, so it is cleared and the periods follow the new meals again.
    await saveProfile({ mealPreset: id, periodShares: undefined });
    await refreshProfile();
    if (id !== 'custom') showToast({ message: 'Meal split updated' });
  }

  async function saveCustom() {
    const shares = MEAL_SLOTS.reduce(
      (acc, s) => {
        acc[s] = (Number(draft[s]) || 0) / total;
        return acc;
      },
      {} as Record<MealSlot, number>,
    );
    await saveProfile({ mealPreset: 'custom', mealShares: shares, periodShares: undefined });
    await refreshProfile();
    showToast({ message: 'Custom split saved' });
  }

  if (!profile) return null;
  return (
    <Card className="space-y-3">
      <SectionTitle>Calories per meal</SectionTitle>
      <Body>
        How the day&apos;s calories are shared between meals. Each meal&apos;s target on the Diet
        screen follows this, and so does the period split below unless you set that yourself.
      </Body>
      <div className="flex flex-wrap gap-2">
        {MEAL_PRESETS.map((p) => (
          <Chip key={p.id} active={preset === p.id} onClick={() => void choose(p.id)}>
            {p.label}
          </Chip>
        ))}
        <Chip active={preset === 'custom'} onClick={() => void choose('custom')}>
          Custom
        </Chip>
      </div>
      {preset !== 'custom' && (
        <Body muted>{MEAL_PRESETS.find((p) => p.id === preset)?.body}</Body>
      )}

      {preset === 'custom' ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            {MEAL_SLOTS.map((slot) => (
              <Field
                key={slot}
                label={MEAL_SLOT_LABEL[slot]}
                value={draft[slot]}
                onChange={(e) => setDraft((d) => ({ ...d, [slot]: e.target.value }))}
                inputMode="decimal"
                suffix="%"
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={saveCustom} disabled={!addsUp}>
              Save split
            </Button>
            <span className={`tabular text-[12.5px] font-semibold ${addsUp ? 'text-muted' : 'text-red-600'}`}>
              {Math.round(total * 10) / 10}% of the day
            </span>
          </div>
        </>
      ) : (
        <ul className="surface-sunken space-y-1 rounded-xl p-3">
          {MEAL_SLOTS.filter((s) => current[s] > 0).map((slot) => (
            <li key={slot} className="flex justify-between text-[12.5px]">
              <span>{MEAL_SLOT_LABEL[slot]}</span>
              <span className="tabular text-secondary">
                {Math.round(current[slot] * 100)}% · {energy.fmt(profile.targets.kcal * current[slot])}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function toDraft(shares: Record<MealSlot, number>): Record<MealSlot, string> {
  return MEAL_SLOTS.reduce(
    (acc, s) => {
      acc[s] = String(Math.round(shares[s] * 1000) / 10);
      return acc;
    },
    {} as Record<MealSlot, string>,
  );
}

/* -------------------------------- eat back ------------------------------- */

const EAT_BACK_STEPS = [0, 25, 50, 75, 100];

export function EatBackCard() {
  const pct = useApp((s) => s.settings.eatBackPct ?? 100);
  const setSettings = useApp((s) => s.setSettings);
  return (
    <Card className="space-y-3">
      <SectionTitle>Eat back exercise calories</SectionTitle>
      <Body>
        How much of what you burn — workouts, and steps if they count — is added back to the
        day&apos;s budget.
      </Body>
      <div className="flex flex-wrap gap-2">
        {EAT_BACK_STEPS.map((step) => (
          <Chip key={step} active={pct === step} onClick={() => setSettings({ eatBackPct: step })}>
            {step}%
          </Chip>
        ))}
      </div>
      <Body muted>
        Burn estimates from watches and formulas tend to run high, so many people eat back half or
        less. At 0% exercise never changes the target; the burn is still shown.
      </Body>
    </Card>
  );
}

/* ------------------------------- day start ------------------------------- */

export function DayStartCard() {
  const hour = useApp((s) => s.settings.dayStartHour ?? 0);
  const setSettings = useApp((s) => s.setSettings);
  const fmt = (h: number) =>
    h === 0 ? 'Midnight' : new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' });
  return (
    <Card className="space-y-3">
      <SectionTitle>Day starts at</SectionTitle>
      <div className="flex flex-wrap gap-2">
        {[0, 1, 2, 3, 4, 5].map((h) => (
          <Chip key={h} active={hour === h} onClick={() => setSettings({ dayStartHour: h })}>
            {fmt(h)}
          </Chip>
        ))}
      </div>
      <Body muted>
        For late nights: with the day starting at 3 am, a 1 am snack is logged to the evening
        before rather than opening a new day. Applies from now on — nothing already logged moves.
      </Body>
    </Card>
  );
}

/* ---------------------------- adaptive target ---------------------------- */

export function AdaptiveCard() {
  const profile = useApp((s) => s.profile);
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const refreshProfile = useApp((s) => s.refreshProfile);
  const showToast = useApp((s) => s.showToast);
  const energy = useEnergy();
  const [result, setResult] = useState<AdaptiveResult | null>(null);

  useEffect(() => {
    if (!profile) return;
    let live = true;
    void measureMaintenance(profile, settings).then((r) => live && setResult(r));
    return () => {
      live = false;
    };
    // Re-measure when inputs that change the answer change, not on every keystroke elsewhere.
  }, [profile, settings.eatBackPct, settings.countStepKcal]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!profile) return null;
  const using = profile.adaptiveTdee;

  async function apply(tdee: number) {
    await saveProfile({ adaptiveTdee: tdee, adaptiveAt: Date.now(), targetsManual: false });
    await refreshProfile();
    showToast({ message: `Maintenance set to ${energy.fmt(tdee)} from your own data` });
  }

  async function clear() {
    await saveProfile({ adaptiveTdee: undefined, adaptiveAt: undefined, targetsManual: false });
    await setSettings({ adaptiveAuto: false });
    await refreshProfile();
    showToast({ message: 'Back to the formula estimate' });
  }

  async function toggleTaper() {
    await saveProfile({ taperNearGoal: !profile!.taperNearGoal });
    await refreshProfile();
  }

  return (
    <Card className="space-y-3">
      <SectionTitle
        action={
          <Switch
            on={Boolean(settings.adaptiveAuto)}
            label="Update maintenance weekly"
            onToggle={() => setSettings({ adaptiveAuto: !settings.adaptiveAuto })}
          />
        }
      >
        Adaptive target
      </SectionTitle>
      <Body>
        Measures your real maintenance calories from the last four weeks of logging and your
        weight trend, instead of predicting it from a formula. With the switch on it re-measures
        weekly and updates your target when the data is solid.
      </Body>

      {using && (
        <p className="tint-soft tint-brand rounded-xl px-3 py-2 text-[12.5px] font-semibold">
          Using measured maintenance: {energy.fmt(using)}
          {profile.adaptiveAt &&
            ` · ${new Date(profile.adaptiveAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`}
        </p>
      )}

      {!result ? (
        <Body muted>Measuring…</Body>
      ) : result.ok ? (
        <div className="surface-sunken space-y-1.5 rounded-xl p-3 text-[12.5px]">
          <div className="flex justify-between font-semibold">
            <span>Measured maintenance</span>
            <span className="tabular">{energy.fmt(result.tdee)}</span>
          </div>
          <div className="flex justify-between text-secondary">
            <span>Formula estimate</span>
            <span className="tabular">{energy.fmt(result.formulaTdee)}</span>
          </div>
          <p className="pt-1 text-[11.5px] leading-relaxed text-muted">
            {result.loggedDays} logged days averaging {energy.fmt(result.avgNetIntake)} net, while
            the trend moved {result.deltaKg > 0 ? '+' : ''}
            {result.deltaKg} kg over {result.spanDays} days.
          </p>
          {result.unusual && (
            <p className="text-[11.5px] leading-relaxed text-amber-600">
              That is far from the formula. Check for days logged only in part before applying —
              the weekly update skips a figure like this.
            </p>
          )}
          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={() => apply(result.tdee)} disabled={using === result.tdee}>
              {using === result.tdee ? 'In use' : 'Use this'}
            </Button>
            {using && (
              <Button size="sm" variant="secondary" onClick={clear}>
                Use formula
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Body muted>{result.reason}</Body>
          {using && (
            <Button size="sm" variant="secondary" onClick={clear}>
              Use formula
            </Button>
          )}
        </div>
      )}

      {profile.targetsManual && (
        <Body muted>Your targets are set by hand, so neither this nor weight changes move them until you press Recalculate.</Body>
      )}

      <div className="flex items-start gap-3 border-t border-[var(--surface-border)] pt-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold">Ease off near goal weight</p>
          <Body muted>
            {profile.targetWeightKg
              ? 'Shrinks the deficit or surplus over the last 3 kg, so you arrive at maintenance instead of overshooting.'
              : 'Set a target weight on the Weight screen to use this.'}
          </Body>
        </div>
        <Switch on={Boolean(profile.taperNearGoal)} label="Ease off near goal weight" onToggle={toggleTaper} />
      </div>
    </Card>
  );
}

/* ------------------------------ AI visibility ---------------------------- */

export function AiVisibilityCard() {
  const showAi = useApp((s) => s.settings.showAi !== false);
  const setSettings = useApp((s) => s.setSettings);
  return (
    <Card className="space-y-3">
      <SectionTitle
        action={<Switch on={showAi} label="Show AI features" onToggle={() => setSettings({ showAi: !showAi })} />}
      >
        Show AI features
      </SectionTitle>
      <Body>
        {showAi
          ? 'Snap, Voice, the coach and AI estimates are shown. They need a key from the provider above to work.'
          : 'AI features are hidden and nothing is sent to an AI provider, even with a key saved. Barcode, label OCR, search, quick add and every tracker work as normal.'}
      </Body>
    </Card>
  );
}

/* ---------------------------- links to screens --------------------------- */

export function NutrientGoalsLink() {
  const hidden = useApp((s) => s.settings.hiddenMicros?.length ?? 0);
  const custom = useApp((s) => Object.keys(s.profile?.microGoals ?? {}).length);
  const bits = [custom ? `${custom} custom goal${custom === 1 ? '' : 's'}` : 'Reference intakes', hidden ? `${hidden} hidden` : ''];
  return (
    <LinkCard
      to="/settings/nutrients"
      icon={<IconLeaf width={19} height={19} />}
      title="Nutrient goals"
      body={bits.filter(Boolean).join(' · ')}
    />
  );
}

export function SourcesLink() {
  return (
    <LinkCard
      to="/sources"
      icon={<IconBook width={19} height={19} />}
      title="Sources & references"
      body="The studies and tables behind every number"
    />
  );
}

/* --------------------------- storage and badge --------------------------- */

export function StorageCard() {
  const appBadge = useApp((s) => s.settings.appBadge !== false);
  const setSettings = useApp((s) => s.setSettings);
  const [state, setState] = useState<PersistState | null>(null);
  const [usage, setUsage] = useState<{ usage: number; quota: number }>();

  useEffect(() => {
    void persistState().then(setState);
    void storageEstimate().then(setUsage);
  }, []);

  async function ask() {
    setState(await requestPersistence());
  }

  return (
    <Card className="space-y-3">
      <SectionTitle>Storage on this device</SectionTitle>
      {state === 'persisted' && (
        <Body>
          <span className="font-semibold text-brand-600">Protected.</span> The browser will not
          delete your data to free space — only clearing site data yourself removes it.
        </Body>
      )}
      {state === 'best-effort' && (
        <>
          <Body>
            <span className="font-semibold text-amber-600">Not protected yet.</span> The browser
            may clear your data if the device runs low on space. Installing the app to your home
            screen and using it regularly usually earns protection; you can also ask now.
          </Body>
          <Button size="sm" variant="secondary" onClick={ask}>
            Ask to protect storage
          </Button>
        </>
      )}
      {state === 'unsupported' && (
        <Body>This browser does not report whether storage is protected. Keep regular backups.</Body>
      )}
      {usage && (
        <Body muted>
          Using {formatBytes(usage.usage)} of {formatBytes(usage.quota)} available.
        </Body>
      )}

      {badgeSupported() && (
        <div className="flex items-start gap-3 border-t border-[var(--surface-border)] pt-3">
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-semibold">App icon badge</p>
            <Body muted>
              Shows how many of breakfast, lunch and dinner are still unlogged once their time has
              passed. Updates while the app is open.
            </Body>
          </div>
          <Switch on={appBadge} label="App icon badge" onToggle={() => setSettings({ appBadge: !appBadge })} />
        </div>
      )}
    </Card>
  );
}

/* --------------------------------- CSV ----------------------------------- */

export function CsvExportButton({ disabled }: { disabled?: boolean }) {
  const showToast = useApp((s) => s.showToast);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      const { rows, shared } = await exportCsv();
      showToast({ message: `${rows.toLocaleString()} food rows ${shared ? 'shared' : 'exported'} as CSV` });
    } catch (err) {
      showToast({ message: err instanceof Error ? err.message : 'CSV export failed', tone: 'warn' });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button variant="secondary" onClick={run} disabled={disabled || busy}>
      <IconDownload width={15} height={15} />
      {busy ? 'Preparing…' : 'Export CSV'}
    </Button>
  );
}
