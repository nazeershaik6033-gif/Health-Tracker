import { useMemo, useState } from 'react';
import { useApp } from '@/stores/useApp';
import { saveProfile } from '@/db/repo';
import { MICROS, formatMicro, referenceTargets } from '@/lib/micros';
import { Button, Card, PageHeader, SectionTitle } from '@/components/ui';
import type { MicroId, Micros } from '@/types';
import type { MicroDef, MicroGroup } from '@/lib/micros';

const GROUPS: { id: MicroGroup; label: string }[] = [
  { id: 'mineral', label: 'Minerals' },
  { id: 'vitamin', label: 'Vitamins' },
  { id: 'omega3', label: 'Omega-3' },
];

/**
 * Per-nutrient goals and visibility.
 *
 * Goals: blank follows the ICMR-NIN / WHO reference for your age and sex, a
 * number replaces it — for a dietitian's figure, pregnancy, a diagnosed
 * deficiency, none of which the app models. Visibility: a hidden nutrient
 * drops off the Micronutrients screen and out of the "x of y on track" counts,
 * for anyone who only cares about a few. Hidden nutrients are still recorded,
 * so switching one back on shows its full history.
 */
export default function NutrientGoals() {
  const profile = useApp((s) => s.profile);
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const refreshProfile = useApp((s) => s.refreshProfile);
  const showToast = useApp((s) => s.showToast);

  const reference = useMemo(() => referenceTargets(profile), [profile]);
  const [drafts, setDrafts] = useState<Partial<Record<MicroId, string>>>(() => {
    const out: Partial<Record<MicroId, string>> = {};
    for (const [id, v] of Object.entries(profile?.microGoals ?? {})) {
      if (typeof v === 'number') out[id as MicroId] = String(v);
    }
    return out;
  });
  const [dirty, setDirty] = useState(false);
  const hidden = new Set(settings.hiddenMicros ?? []);

  function patch(id: MicroId, value: string) {
    setDrafts((d) => ({ ...d, [id]: value }));
    setDirty(true);
  }

  async function toggle(id: MicroId) {
    const next = new Set(hidden);
    if (!next.delete(id)) next.add(id);
    await setSettings({ hiddenMicros: [...next] });
  }

  async function save() {
    const goals: Micros = {};
    for (const [id, raw] of Object.entries(drafts)) {
      const n = Number(String(raw).replace(',', '.'));
      if (String(raw).trim() && Number.isFinite(n) && n > 0) goals[id as MicroId] = n;
    }
    await saveProfile({ microGoals: Object.keys(goals).length ? goals : undefined });
    await refreshProfile();
    setDirty(false);
    showToast({ message: 'Nutrient goals saved' });
  }

  async function resetAll() {
    setDrafts({});
    await saveProfile({ microGoals: undefined });
    await setSettings({ hiddenMicros: [] });
    await refreshProfile();
    setDirty(false);
    showToast({ message: 'Back to the reference intakes' });
  }

  const row = (def: MicroDef) => {
    const isHidden = hidden.has(def.id);
    const draft = drafts[def.id] ?? '';
    return (
      <li key={def.id} className="flex items-center gap-3 py-2">
        <input
          type="checkbox"
          checked={!isHidden}
          onChange={() => void toggle(def.id)}
          aria-label={`Show ${def.label}`}
          className="h-4 w-4 shrink-0 accent-[var(--color-brand-500)]"
        />
        <span className={`min-w-0 flex-1 ${isHidden ? 'opacity-45' : ''}`}>
          <span className="block truncate text-[14px] font-semibold">{def.label}</span>
          <span className="block text-[11.5px] text-muted">
            {def.limit ? 'Ceiling' : 'Reference'} {formatMicro(def.id, reference[def.id])}
          </span>
        </span>
        <label className="relative w-28 shrink-0">
          <span className="sr-only">{def.label} goal</span>
          <input
            value={draft}
            onChange={(e) => patch(def.id, e.target.value)}
            inputMode="decimal"
            placeholder={String(Math.round(reference[def.id] * 100) / 100)}
            disabled={isHidden}
            className="hairline w-full rounded-lg border bg-transparent py-1.5 pr-9 pl-2.5 text-right text-[13.5px] outline-none focus:border-brand-500 disabled:opacity-45"
          />
          <span className="absolute top-1/2 right-2 -translate-y-1/2 text-[11px] text-muted">
            {def.unit}
          </span>
        </label>
      </li>
    );
  };

  return (
    <div className="pb-28">
      <PageHeader
        title="Nutrient goals"
        back="/settings"
        action={
          <button type="button" onClick={resetAll} className="px-2 text-[12.5px] font-semibold text-brand-600">
            Reset
          </button>
        }
      />
      <div className="space-y-3 px-4 pt-3">
        <p className="px-1 text-[12.5px] leading-relaxed text-secondary">
          Leave a goal blank to follow the reference intake for your age and sex. Untick a
          nutrient to hide it — it is still recorded, just not shown or counted.
        </p>
        {GROUPS.map((g) => {
          const defs = MICROS.filter((d) => d.group === g.id);
          if (!defs.length) return null;
          return (
            <Card key={g.id}>
              <SectionTitle>{g.label}</SectionTitle>
              <ul className="divide-y divide-[var(--surface-border)]">{defs.map(row)}</ul>
            </Card>
          );
        })}
      </div>

      <div className="chrome-canvas fixed inset-x-0 bottom-0 z-20 border-t border-[var(--surface-border)] px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        <Button full size="lg" onClick={save} disabled={!dirty}>
          Save goals
        </Button>
      </div>
    </div>
  );
}
