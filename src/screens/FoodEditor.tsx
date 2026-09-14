import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp } from '@/stores/useApp';
import {
  addMealItems,
  applyFoodMicrosToHistory,
  createFood,
  getFood,
  upsertFood,
} from '@/db/repo';
import { buildMealItem, scaleNutrients } from '@/lib/nutrition';
import { MICROS, hasMicros, roundMicros } from '@/lib/micros';
import { Button, Card, Field, PageHeader, SectionTitle } from '@/components/ui';
import { MealPickerSheet } from '@/components/MealPickerSheet';
import { IconChevronDown, IconPlus, IconTrash } from '@/components/icons';
import {
  MEAL_SLOT_LABEL,
  type Food,
  type MealSlot,
  type MicroId,
  type Micros,
  type Serving,
} from '@/types';

/**
 * Create a food by hand.
 *
 * Nothing in the app could do this: foods only arrived from the bundled seed
 * list, a barcode, a label scan, FatSecret or an AI guess. A home-cooked dish
 * — the thing people actually eat most — had no route in at all.
 *
 * Values are entered per serving, because that is how a recipe or a packet
 * reads, and converted to the per-100g basis everything else calculates on.
 * That applies to the micronutrients too: a pack lists iron per serving, and
 * asking someone to divide by 1.4 before typing is how figures get entered
 * wrong.
 */
export default function FoodEditor() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { id } = useParams<{ id: string }>();
  const { selectedDate, showToast } = useApp();
  const editing = Boolean(id);
  const [loaded, setLoaded] = useState(!editing);
  const [source, setSource] = useState<Food['source']>('custom');

  const [name, setName] = useState(params.get('name') ?? '');
  const [brand, setBrand] = useState('');
  const [servingLabel, setServingLabel] = useState('1 serving');
  const [servingGrams, setServingGrams] = useState('100');
  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');
  const [fat, setFat] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fibre, setFibre] = useState('');
  /**
   * Micronutrients as typed, per serving, keyed by nutrient.
   *
   * Strings rather than numbers because blank has to survive round-tripping:
   * every other figure in this editor treats an empty box as zero, and here
   * that would be a lie. A food with no iron figure is not a food with no
   * iron — it is a food nobody has measured — and the day view counts on the
   * difference to work out how much of the day it actually saw.
   */
  const [microInput, setMicroInput] = useState<Partial<Record<MicroId, string>>>({});
  const [extra, setExtra] = useState<Serving[]>([]);
  const [extraLabel, setExtraLabel] = useState('');
  const [extraGrams, setExtraGrams] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Editing loads the stored food back into per-serving figures, since that is
  // how it was entered — showing raw per-100g numbers would be a different food
  // to the one the user typed.
  useEffect(() => {
    if (!id) return;
    void (async () => {
      const food = await getFood(id);
      if (!food) {
        showToast({ message: 'That food no longer exists' });
        navigate('/search', { replace: true });
        return;
      }
      const first = food.servings[0] ?? { label: '1 serving', grams: 100 };
      const factor = first.grams / 100;
      setName(food.name);
      setBrand(food.brand ?? '');
      setServingLabel(first.label);
      setServingGrams(String(first.grams));
      setKcal(String(Math.round(food.per100g.kcal * factor)));
      setProtein(String(Math.round(food.per100g.protein * factor * 10) / 10));
      setFat(String(Math.round(food.per100g.fat * factor * 10) / 10));
      setCarbs(String(Math.round(food.per100g.carbs * factor * 10) / 10));
      setFibre(String(Math.round(food.per100g.fibre * factor * 10) / 10));
      const loadedMicros: Partial<Record<MicroId, string>> = {};
      for (const def of MICROS) {
        const per100 = food.micros?.[def.id];
        if (per100 === undefined) continue;
        const value = per100 * factor;
        loadedMicros[def.id] = String(
          value >= 10 ? Math.round(value) : Math.round(value * 100) / 100,
        );
      }
      setMicroInput(loadedMicros);
      // Everything after the first serving, minus the 100 g row the editor adds.
      setExtra(food.servings.slice(1).filter((sv) => sv.grams !== 100));
      setSource(food.source);
      setLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const num = (v: string) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };

  const grams = num(servingGrams);
  const trimmedName = name.trim();
  // A food with no weight cannot be rescaled, and one with no calories is not
  // a food entry. Both would silently corrupt every total that used it.
  const valid = trimmedName.length > 0 && grams > 0 && num(kcal) > 0;

  const servings: Serving[] = [
    { label: servingLabel.trim() || '1 serving', grams },
    ...extra,
    ...(grams === 100 || extra.some((s) => s.grams === 100) ? [] : [{ label: '100 g', grams: 100 }]),
  ];

  /** Entered per serving; stored per 100 g, which is what every total uses. */
  const per100g = {
    kcal: grams ? (num(kcal) * 100) / grams : 0,
    protein: grams ? (num(protein) * 100) / grams : 0,
    fat: grams ? (num(fat) * 100) / grams : 0,
    carbs: grams ? (num(carbs) * 100) / grams : 0,
    fibre: grams ? (num(fibre) * 100) / grams : 0,
  };

  /**
   * The typed micronutrients, per 100 g, or undefined when none were given.
   *
   * Only boxes with something in them become keys. Blank stays absent rather
   * than becoming zero, which is what lets `hasMicros` and the day's coverage
   * figure keep telling the truth about what is known and what merely wasn't
   * filled in.
   */
  const micros: Micros | undefined = (() => {
    if (!grams) return undefined;
    const out: Micros = {};
    for (const def of MICROS) {
      const raw = microInput[def.id]?.trim();
      if (!raw) continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) continue;
      out[def.id] = (n * 100) / grams;
    }
    return hasMicros(out) ? roundMicros(out) : undefined;
  })();

  const microCount = MICROS.filter((def) => micros?.[def.id] !== undefined).length;

  async function save(logTo?: MealSlot) {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const draft = {
        name: trimmedName,
        brand: brand.trim() || undefined,
        per100g,
        // Always present, even as undefined: `upsertFood` merges over the
        // stored row, so an omitted key would keep whatever micros were there
        // before and clearing the fields would appear to do nothing.
        micros,
        servings,
        // Keep a built-in food's provenance when it is edited; only genuinely
        // new rows are marked custom.
        source: editing ? source : ('custom' as const),
        tags: ['custom'],
        verified: true,
      };
      const food = id ? await upsertFood({ ...draft, id }) : await createFood(draft);

      // Give the micronutrients to meals already logged from this food. Only
      // items carrying none are touched, so nothing recorded is rewritten —
      // but the day that sent the user here stops naming this food as missing
      // data they have now typed in.
      const filled = micros ? await applyFoodMicrosToHistory(food.id, micros) : 0;

      if (logTo) {
        await addMealItems(selectedDate, logTo, [
          buildMealItem(food, servings[0].label, 1),
        ]);
        showToast({ message: `${food.name} added to ${MEAL_SLOT_LABEL[logTo]}` });
        navigate('/diet');
      } else {
        showToast({
          message: filled
            ? `${food.name} updated — micronutrients added to ${filled} logged ${
                filled === 1 ? 'entry' : 'entries'
              }`
            : editing
              ? `${food.name} updated`
              : `${food.name} saved to your foods`,
        });
        navigate(-1);
      }
    } finally {
      setSaving(false);
    }
  }

  const preview = scaleNutrients(per100g, grams / 100);

  if (!loaded) {
    return (
      <div className="min-h-dvh">
        <PageHeader title="Edit food" back={() => navigate(-1)} />
      </div>
    );
  }

  return (
    <div className="pb-32">
      <PageHeader title={editing ? 'Edit food' : 'Create a food'} back={() => navigate(-1)} />

      {editing && (
        <p className="mx-4 mt-3 accent-card accent-amber p-3 text-[11.5px] leading-relaxed">
          Meals you have already logged keep the numbers they were logged with — changing this
          food only affects what you add from now on. Micronutrients are the exception: those
          fill in backwards too, since a blank there was never a number you logged.
        </p>
      )}

      <div className="space-y-3 px-4 pt-3">
        <Card className="space-y-3">
          <SectionTitle>What is it?</SectionTitle>
          <Field
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Mum's rajma"
            autoFocus
          />
          <Field
            label="Brand (optional)"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            placeholder="Homemade"
          />
        </Card>

        <Card className="space-y-3">
          <SectionTitle>One serving</SectionTitle>
          <div className="flex gap-2">
            <Field
              label="Called"
              value={servingLabel}
              onChange={(e) => setServingLabel(e.target.value)}
              placeholder="1 katori"
              className="flex-1"
            />
            <Field
              label="Weighs"
              value={servingGrams}
              onChange={(e) => setServingGrams(e.target.value.replace(/[^0-9.]/g, ''))}
              inputMode="decimal"
              suffix="g"
              className="w-28"
            />
          </div>
          <p className="text-[11.5px] leading-relaxed text-muted">
            The weight is what lets the app rescale this food later — half a portion, or an
            exact amount off a kitchen scale.
          </p>
        </Card>

        <Card className="space-y-3">
          <SectionTitle>Nutrition per serving</SectionTitle>
          <Field
            label="Calories"
            value={kcal}
            onChange={(e) => setKcal(e.target.value.replace(/[^0-9.]/g, ''))}
            inputMode="decimal"
            suffix="kcal"
          />
          <div className="grid grid-cols-2 gap-2">
            <Field
              label="Protein"
              value={protein}
              onChange={(e) => setProtein(e.target.value.replace(/[^0-9.]/g, ''))}
              inputMode="decimal"
              suffix="g"
            />
            <Field
              label="Fat"
              value={fat}
              onChange={(e) => setFat(e.target.value.replace(/[^0-9.]/g, ''))}
              inputMode="decimal"
              suffix="g"
            />
            <Field
              label="Carbs"
              value={carbs}
              onChange={(e) => setCarbs(e.target.value.replace(/[^0-9.]/g, ''))}
              inputMode="decimal"
              suffix="g"
            />
            <Field
              label="Fibre"
              value={fibre}
              onChange={(e) => setFibre(e.target.value.replace(/[^0-9.]/g, ''))}
              inputMode="decimal"
              suffix="g"
            />
          </div>
          <p className="text-[11.5px] text-muted">
            Macros are optional — calories alone still tracks. Leave a field blank for zero.
          </p>
        </Card>

        {/*
          Micronutrients. Collapsed, because most foods are logged without
          them and twelve extra boxes above the Save button would make the
          common case worse. Open, it is the only way to give a home-cooked
          dish or a hand-typed packet any micro data at all — which is what
          the Micronutrients screen means when it says it is working from a
          fraction of the day.
        */}
        <details className="surface-card group rounded-2xl px-4 py-3.5">
          <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            <SectionTitle
              action={
                <span className="flex items-center gap-2">
                  {microCount > 0 && (
                    <span className="tint-soft tint-brand tabular rounded-full px-2 py-0.5 text-[11px] font-bold">
                      {microCount}
                    </span>
                  )}
                  <IconChevronDown
                    width={16}
                    height={16}
                    className="text-muted transition-transform group-open:rotate-180"
                  />
                </span>
              }
            >
              Micronutrients (optional)
            </SectionTitle>
          </summary>

          <div className="space-y-3">
            <p className="text-[11.5px] leading-relaxed text-muted">
              Per serving, straight off the pack. Leave anything you don't know{' '}
              <strong className="font-semibold">blank</strong> — blank means unknown, not zero,
              and only the ones you fill in are counted.
            </p>

            {(['mineral', 'vitamin'] as const).map((group) => (
              <div key={group}>
                <p className="mb-1.5 text-[11px] font-bold tracking-wide text-muted uppercase">
                  {group === 'mineral' ? 'Minerals' : 'Vitamins'}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {MICROS.filter((def) => def.group === group).map((def) => (
                    <Field
                      key={def.id}
                      label={def.label}
                      value={microInput[def.id] ?? ''}
                      onChange={(e) =>
                        setMicroInput((prev) => ({
                          ...prev,
                          [def.id]: e.target.value.replace(/[^0-9.]/g, ''),
                        }))
                      }
                      inputMode="decimal"
                      placeholder="—"
                      suffix={def.unit}
                    />
                  ))}
                </div>
              </div>
            ))}

            {microCount > 0 && (
              <button
                type="button"
                onClick={() => setMicroInput({})}
                className="text-[12px] font-semibold text-red-600"
              >
                Clear all {microCount}
              </button>
            )}
          </div>
        </details>

        {/* Extra servings, so "1 katori" and "1 bowl" can both exist. */}
        <Card className="space-y-3">
          <SectionTitle>Other servings (optional)</SectionTitle>
          {extra.length > 0 && (
            <ul>
              {extra.map((s, i) => (
                <li
                  key={`${s.label}-${i}`}
                  className="flex items-center gap-2 border-b border-[var(--surface-border)] py-2 last:border-0"
                >
                  <span className="flex-1 text-[13.5px] font-medium">{s.label}</span>
                  <span className="tabular text-[12.5px] text-secondary">{s.grams} g</span>
                  <button
                    type="button"
                    aria-label={`Remove serving ${s.label}`}
                    onClick={() => setExtra((prev) => prev.filter((_, j) => j !== i))}
                    className="p-1 text-red-600"
                  >
                    <IconTrash width={14} height={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-end gap-2">
            <Field
              label="Called"
              value={extraLabel}
              onChange={(e) => setExtraLabel(e.target.value)}
              placeholder="1 bowl"
              className="flex-1"
            />
            <Field
              label="Weighs"
              value={extraGrams}
              onChange={(e) => setExtraGrams(e.target.value.replace(/[^0-9.]/g, ''))}
              inputMode="decimal"
              suffix="g"
              className="w-24"
            />
            <Button
              variant="secondary"
              className="mb-1"
              aria-label="Add serving"
              disabled={!extraLabel.trim() || num(extraGrams) <= 0}
              onClick={() => {
                setExtra((prev) => [
                  ...prev,
                  { label: extraLabel.trim(), grams: num(extraGrams) },
                ]);
                setExtraLabel('');
                setExtraGrams('');
              }}
            >
              <IconPlus width={15} height={15} />
            </Button>
          </div>
        </Card>

        {valid && (
          <Card>
            <SectionTitle>Per 100 g</SectionTitle>
            <div className="surface-sunken grid grid-cols-5 gap-1 rounded-xl p-3 text-center">
              <Stat label="Cal" value={Math.round(per100g.kcal)} />
              <Stat label="Protein" value={`${Math.round(per100g.protein)}g`} />
              <Stat label="Fat" value={`${Math.round(per100g.fat)}g`} />
              <Stat label="Carbs" value={`${Math.round(per100g.carbs)}g`} />
              <Stat label="Fibre" value={`${Math.round(per100g.fibre)}g`} />
            </div>
            <p className="mt-2 text-center text-[11.5px] text-muted">
              {servingLabel.trim() || '1 serving'} = {Math.round(preview.kcal)} Cal
              {microCount > 0 &&
                ` · ${microCount} micronutrient${microCount === 1 ? '' : 's'}`}
            </p>
          </Card>
        )}
      </div>

      <div className="dock inset-x-0 z-20 mx-auto flex shell-w gap-2 border-t border-[var(--surface-border)] bg-[var(--surface-card)] px-4 pt-3 pb-safe">
        <Button variant="secondary" disabled={!valid || saving} onClick={() => save()}>
          {editing ? 'Save' : 'Save only'}
        </Button>
        <Button size="lg" full disabled={!valid || saving} onClick={() => setPickerOpen(true)}>
          {editing ? 'Save & log' : 'Save & log'}
        </Button>
      </div>

      <MealPickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(slot) => save(slot)}
        date={selectedDate}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="tabular text-[14px] font-bold">{value}</p>
      <p className="text-[10px] text-muted">{label}</p>
    </div>
  );
}
