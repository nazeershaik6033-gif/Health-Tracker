import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/schema';
import { useApp } from '@/stores/useApp';
import { addMealItems, createFood } from '@/db/repo';
import { searchFoods } from '@/lib/foodSearch';
import { scaleNutrients, sumNutrients, roundNutrients, buildMealItemFromGrams } from '@/lib/nutrition';
import { hasMicros, roundMicros, scaleMicros, sumMicros } from '@/lib/micros';
import { today } from '@/lib/date';
import { BottomSheet } from '@/components/BottomSheet';
import { MealPickerSheet } from '@/components/MealPickerSheet';
import { FoodRow } from '@/components/FoodRow';
import { Button, Card, Field, PageHeader, SectionTitle, EmptyState } from '@/components/ui';
import { IconPlus, IconSearch, IconTrash } from '@/components/icons';
import { MEAL_SLOT_LABEL, ZERO_NUTRIENTS, type Food, type MealSlot } from '@/types';

interface Ingredient {
  food: Food;
  grams: number;
  /**
   * The raw text of the grams field.
   *
   * The input was bound straight to `grams`, so every keystroke round-tripped
   * through `Number()` before being rendered back: typing "12." produced
   * `Number("12.") === 12`, which re-rendered as "12" and ate the decimal point
   * on the way in. Same defect the set-weight field had, and the same fix —
   * hold the text, parse alongside it.
   */
  draft: string;
}

const makeIngredient = (food: Food, grams: number): Ingredient => ({
  food,
  grams,
  draft: String(grams),
});

/** Digits and at most one decimal point, so "1.2.5" can never be typed. */
function sanitiseDecimal(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  const [head, ...rest] = cleaned.split('.');
  return rest.length ? `${head}.${rest.join('')}` : head;
}

/**
 * Build a food from raw ingredients and their quantities.
 *
 * Every other route to a food is either "typed in whole" (FoodEditor) or
 * "read off a photo/label" — nothing let you say "200 g toor dal, 30 g ghee,
 * 1 onion" and get the combined macros back. This does that by summing each
 * ingredient's contribution, exactly the way a Snap analysis sums per-item
 * nutrients, then stores the result as an ordinary food: per 100 g, with a
 * serving derived from how many servings the batch makes. Nothing downstream
 * needs to know it came from ingredients rather than a label.
 */
export default function RecipeBuilder() {
  const navigate = useNavigate();
  const { selectedDate, showToast } = useApp();

  const [name, setName] = useState('');
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [servingsCount, setServingsCount] = useState('1');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [date, setDate] = useState(selectedDate);
  const [logSlotOpen, setLogSlotOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);

  const foods = useLiveQuery(async () => db.foods.toArray(), []);
  const results = useMemo(
    () => (foods && query.trim() ? searchFoods(foods, query, 20) : []),
    [foods, query],
  );

  const totalGrams = ingredients.reduce((sum, i) => sum + i.grams, 0);
  const totals = roundNutrients(
    sumNutrients(ingredients.map((i) => scaleNutrients(i.food.per100g, i.grams / 100))),
  );
  const per100g =
    totalGrams > 0 ? scaleNutrients(totals, 100 / totalGrams) : { ...ZERO_NUTRIENTS };

  /**
   * Micros are summed the same way, but only from ingredients that carry them.
   * A recipe whose ingredients are half unknown would otherwise claim a
   * complete micronutrient profile while quietly under-counting every value,
   * so the whole recipe reports none unless the data is essentially complete.
   */
  const knownMicroGrams = ingredients
    .filter((i) => hasMicros(i.food.micros))
    .reduce((sum, i) => sum + i.grams, 0);
  const microsPer100g =
    totalGrams > 0 && knownMicroGrams / totalGrams >= 0.9
      ? roundMicros(
          scaleMicros(
            sumMicros(
              ingredients
                .filter((i) => hasMicros(i.food.micros))
                .map((i) => scaleMicros(i.food.micros!, i.grams / 100)),
            ),
            100 / totalGrams,
          ),
        )
      : undefined;

  const servings = Math.max(1, Math.round(Number(servingsCount) || 1));
  const servingGrams = totalGrams / servings;
  const perServing = roundNutrients(scaleNutrients(per100g, servingGrams / 100));
  const servingLabel = servings === 1 ? '1 serving' : `1 of ${servings} servings`;

  const trimmedName = name.trim();
  const valid = trimmedName.length > 0 && ingredients.length > 0 && totalGrams > 0;

  function addIngredient(food: Food) {
    setIngredients((prev) =>
      prev.some((i) => i.food.id === food.id)
        ? prev
        : [...prev, makeIngredient(food, food.servings[0]?.grams ?? 100)],
    );
    setAddOpen(false);
    setQuery('');
  }

  function setGrams(index: number, draft: string) {
    const grams = Number(draft);
    setIngredients((prev) =>
      prev.map((i, j) =>
        j === index
          ? { ...i, draft, grams: draft === '' || !Number.isFinite(grams) ? 0 : grams }
          : i,
      ),
    );
  }

  function removeIngredient(index: number) {
    setIngredients((prev) => prev.filter((_, j) => j !== index));
  }

  async function saveFood(): Promise<Food> {
    return createFood({
      name: trimmedName,
      per100g,
      micros: microsPer100g,
      servings: [
        { label: servingLabel, grams: servingGrams },
        ...(Math.round(servingGrams) === 100 ? [] : [{ label: '100 g', grams: 100 }]),
      ],
      source: 'custom',
      // Recorded so the ingredient list is never lost, even though only the
      // combined macros are what the rest of the app calculates on.
      tags: ['custom', 'recipe', ...ingredients.map((i) => i.food.name)],
      verified: true,
    });
  }

  async function saveOnly() {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const food = await saveFood();
      showToast({ message: `${food.name} saved to your foods` });
      navigate(-1);
    } finally {
      setSaving(false);
    }
  }

  async function saveAndLog(slot: MealSlot) {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const food = await saveFood();
      await addMealItems(date, slot, [buildMealItemFromGrams(food, servingGrams)]);
      setLogSlotOpen(false);
      showToast({ message: `${food.name} added to ${MEAL_SLOT_LABEL[slot]}` });
      navigate('/diet');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pb-32">
      <PageHeader title="Build a food" back={() => navigate(-1)} />

      <div className="space-y-3 px-4 pt-3">
        <Card className="space-y-3">
          <SectionTitle>What is it?</SectionTitle>
          <Field
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Dal Tadka"
            autoFocus
          />
        </Card>

        <Card className="space-y-1">
          <div className="flex items-center justify-between">
            <SectionTitle>Ingredients</SectionTitle>
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="flex items-center gap-1 text-[13px] font-semibold text-brand-600"
            >
              <IconPlus width={14} height={14} />
              Add
            </button>
          </div>

          {ingredients.length === 0 ? (
            <p className="py-3 text-[12.5px] text-muted">
              Add each raw ingredient and how much of it you used. The macros below are computed
              from what&apos;s already in your food database.
            </p>
          ) : (
            <ul>
              {ingredients.map((ing, i) => {
                const kcal = Math.round(scaleNutrients(ing.food.per100g, ing.grams / 100).kcal);
                return (
                  <li
                    key={ing.food.id}
                    className="flex items-center gap-2 border-b border-[var(--surface-border)] py-2.5 last:border-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-semibold">{ing.food.name}</p>
                      <p className="tabular text-[11.5px] text-muted">{kcal} Cal</p>
                    </div>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={ing.draft}
                      onChange={(e) => setGrams(i, sanitiseDecimal(e.target.value))}
                      aria-label={`${ing.food.name} quantity in grams`}
                      className="hairline w-16 rounded-lg border bg-transparent px-2 py-1.5 text-right text-[13px] tabular"
                    />
                    <span className="text-[12px] text-muted">g</span>
                    <button
                      type="button"
                      aria-label={`Remove ${ing.food.name}`}
                      onClick={() => removeIngredient(i)}
                      className="p-1 text-red-600"
                    >
                      <IconTrash width={14} height={14} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {ingredients.length > 0 && (
          <Card className="space-y-3">
            <SectionTitle>Makes how many servings?</SectionTitle>
            <Field
              value={servingsCount}
              onChange={(e) => setServingsCount(e.target.value.replace(/[^0-9]/g, ''))}
              inputMode="numeric"
              suffix={`× ${Math.round(servingGrams)} g each`}
            />
            <p className="text-[11.5px] leading-relaxed text-muted">
              1 if this is a single portion you&apos;re eating now — more if it&apos;s a batch
              you&apos;ll split up, like a pot of dal for the week.
            </p>
          </Card>
        )}

        {valid && (
          <Card className="space-y-3">
            <SectionTitle>Macros</SectionTitle>
            <div>
              <p className="mb-1 text-[11.5px] font-semibold text-muted">
                Per serving ({Math.round(servingGrams)} g)
              </p>
              <Totals n={perServing} />
            </div>
            {servings > 1 && (
              <div>
                <p className="mb-1 text-[11.5px] font-semibold text-muted">
                  Whole batch ({Math.round(totalGrams)} g)
                </p>
                <Totals n={totals} />
              </div>
            )}
          </Card>
        )}
      </div>

      <div className="dock inset-x-0 z-20 mx-auto flex max-w-lg gap-2 border-t border-[var(--surface-border)] bg-[var(--surface-card)] px-4 pt-3 pb-safe">
        <Button variant="secondary" disabled={!valid || saving} onClick={saveOnly}>
          Save only
        </Button>
        <Button size="lg" full disabled={!valid || saving} onClick={() => setPickerOpen(true)}>
          Save & log
        </Button>
      </div>

      {/* Ingredient search */}
      <BottomSheet open={addOpen} onClose={() => setAddOpen(false)} title="Add an ingredient">
        <div className="hairline mb-2 flex items-center gap-2 rounded-xl border px-3.5 py-2.5">
          <IconSearch width={16} height={16} className="shrink-0 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name — toor dal, ghee, onion…"
            className="w-full bg-transparent text-[14px] outline-none placeholder:text-[var(--text-muted)]"
            autoFocus
          />
        </div>
        {query.trim() && results.length === 0 && (
          <EmptyState
            icon={<IconSearch width={20} height={20} />}
            title={`No match for "${query.trim()}"`}
            body="Not in your food database yet. Add it as a custom food first, then come back here."
          />
        )}
        <ul className="scroll-y max-h-[50vh] pb-2">
          {results.map((food) => (
            <FoodRow
              key={food.id}
              food={food}
              added={ingredients.some((i) => i.food.id === food.id)}
              onAdd={() => addIngredient(food)}
            />
          ))}
        </ul>
      </BottomSheet>

      {/* Date + slot for "Save & log" */}
      <BottomSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="When did you eat this?"
        footer={
          <Button
            size="lg"
            full
            onClick={() => {
              setPickerOpen(false);
              setLogSlotOpen(true);
            }}
          >
            Continue
          </Button>
        }
      >
        <Field
          label="Date"
          type="date"
          value={date}
          max={today()}
          onChange={(e) => setDate(e.target.value)}
        />
        <div className="h-2" />
      </BottomSheet>

      <MealPickerSheet
        open={logSlotOpen}
        onClose={() => setLogSlotOpen(false)}
        onPick={saveAndLog}
        date={date}
      />
    </div>
  );
}

function Totals({ n }: { n: { kcal: number; protein: number; fat: number; carbs: number; fibre: number } }) {
  return (
    <div className="surface-sunken grid grid-cols-5 gap-1 rounded-xl p-3 text-center">
      <Stat label="Cal" value={Math.round(n.kcal)} />
      <Stat label="Protein" value={`${Math.round(n.protein)}g`} />
      <Stat label="Fat" value={`${Math.round(n.fat)}g`} />
      <Stat label="Carbs" value={`${Math.round(n.carbs)}g`} />
      <Stat label="Fibre" value={`${Math.round(n.fibre)}g`} />
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
