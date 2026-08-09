import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp } from '@/stores/useApp';
import { addMealItems, createFood, getFood, upsertFood } from '@/db/repo';
import { buildMealItem, scaleNutrients } from '@/lib/nutrition';
import { Button, Card, Field, PageHeader, SectionTitle } from '@/components/ui';
import { MealPickerSheet } from '@/components/MealPickerSheet';
import { IconPlus, IconTrash } from '@/components/icons';
import { MEAL_SLOT_LABEL, type Food, type MealSlot, type Serving } from '@/types';

/**
 * Create a food by hand.
 *
 * Nothing in the app could do this: foods only arrived from the bundled seed
 * list, a barcode, a label scan, FatSecret or an AI guess. A home-cooked dish
 * — the thing people actually eat most — had no route in at all.
 *
 * Values are entered per serving, because that is how a recipe or a packet
 * reads, and converted to the per-100g basis everything else calculates on.
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

  async function save(logTo?: MealSlot) {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const draft = {
        name: trimmedName,
        brand: brand.trim() || undefined,
        per100g,
        servings,
        // Keep a built-in food's provenance when it is edited; only genuinely
        // new rows are marked custom.
        source: editing ? source : ('custom' as const),
        tags: ['custom'],
        verified: true,
      };
      const food = id ? await upsertFood({ ...draft, id }) : await createFood(draft);

      if (logTo) {
        await addMealItems(selectedDate, logTo, [
          buildMealItem(food, servings[0].label, 1),
        ]);
        showToast({ message: `${food.name} added to ${MEAL_SLOT_LABEL[logTo]}` });
        navigate('/diet');
      } else {
        showToast({
          message: editing ? `${food.name} updated` : `${food.name} saved to your foods`,
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
          food only affects what you add from now on.
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
            </p>
          </Card>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-lg gap-2 border-t border-[var(--surface-border)] bg-[var(--surface-card)] px-4 pt-3 pb-safe">
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
