import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '@/stores/useApp';
import { addMealItems, createFood } from '@/db/repo';
import { buildMealItem, scaleNutrients } from '@/lib/nutrition';
import { Button, Card, Field, PageHeader, SectionTitle } from '@/components/ui';
import { MealPickerSheet } from '@/components/MealPickerSheet';
import { IconPlus, IconTrash } from '@/components/icons';
import { MEAL_SLOT_LABEL, type MealSlot, type Serving } from '@/types';

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
  const { selectedDate, showToast } = useApp();

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
      const food = await createFood({
        name: trimmedName,
        brand: brand.trim() || undefined,
        per100g,
        servings,
        source: 'custom',
        tags: ['custom'],
        verified: true,
      });

      if (logTo) {
        await addMealItems(selectedDate, logTo, [
          buildMealItem(food, servings[0].label, 1),
        ]);
        showToast({ message: `${food.name} added to ${MEAL_SLOT_LABEL[logTo]}` });
        navigate('/diet');
      } else {
        showToast({ message: `${food.name} saved to your foods` });
        navigate(-1);
      }
    } finally {
      setSaving(false);
    }
  }

  const preview = scaleNutrients(per100g, grams / 100);

  return (
    <div className="pb-32">
      <PageHeader title="Create a food" back={() => navigate(-1)} />

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
          Save only
        </Button>
        <Button size="lg" full disabled={!valid || saving} onClick={() => setPickerOpen(true)}>
          Save &amp; log
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
