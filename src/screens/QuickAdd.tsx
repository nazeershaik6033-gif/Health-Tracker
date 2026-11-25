import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/stores/useApp';
import { addMealItems, removeMealItems } from '@/db/repo';
import { relativeDayLabel } from '@/lib/date';
import { useEnergy } from '@/lib/energy';
import { HAPTIC, haptic } from '@/lib/motion';
import { roundNutrients } from '@/lib/nutrition';
import { Button, Chip, Field, PageHeader } from '@/components/ui';
import { MEAL_SLOTS, MEAL_SLOT_LABEL, type MealItem, type MealSlot } from '@/types';

function guessSlot(): MealSlot {
  const h = new Date().getHours();
  if (h < 10) return 'breakfast';
  if (h < 12) return 'morning_snack';
  if (h < 15) return 'lunch';
  if (h < 18) return 'evening_snack';
  return 'dinner';
}

/** A number from a text field, or undefined when it is blank or not a number. */
function num(value: string): number | undefined {
  const n = Number(value.replace(',', '.'));
  return value.trim() && Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * Quick add: log energy straight to a meal when the number is already known —
 * a restaurant menu, a pack read in the shop, last night's leftovers.
 *
 * Nothing is saved as a food. The entry stands alone, carries no
 * micronutrients (so it counts against the day's micro coverage rather than as
 * a confident zero), and is stored as one 100 g "serving" so the edit sheet can
 * scale it later like anything else.
 */
export default function QuickAdd() {
  const navigate = useNavigate();
  const selectedDate = useApp((s) => s.selectedDate);
  const pendingSlot = useApp((s) => s.pendingSlot);
  const setPendingSlot = useApp((s) => s.setPendingSlot);
  const showToast = useApp((s) => s.showToast);
  const energy = useEnergy();

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [fibre, setFibre] = useState('');
  const [slot, setSlot] = useState<MealSlot>(pendingSlot ?? guessSlot());
  const [busy, setBusy] = useState(false);

  useEffect(() => () => setPendingSlot(undefined), [setPendingSlot]);

  const p = num(protein) ?? 0;
  const c = num(carbs) ?? 0;
  const f = num(fat) ?? 0;
  const macroKcal = p * 4 + c * 4 + f * 9;
  const typed = num(amount);
  // Energy may be left blank when macros are given — it is worked out from them.
  const kcal = typed !== undefined ? energy.toKcal(typed) : macroKcal;
  const canSave = kcal > 0 && !busy;
  // Only flagged when the macros come to clearly *more* than the energy typed —
  // that cannot be right. Less is normal: most people fill in protein alone.
  const mismatch = typed !== undefined && macroKcal > kcal * 1.15 + 20;

  async function save(again: boolean) {
    if (!canSave) return;
    setBusy(true);
    const item: MealItem = {
      name: name.trim() || 'Quick add',
      qty: 1,
      servingLabel: '1 serving',
      grams: 100,
      nutrients: roundNutrients({ kcal, protein: p, carbs: c, fat: f, fibre: num(fibre) ?? 0 }),
      note: 'Quick add',
    };
    try {
      const before = await addMealItems(selectedDate, slot, [item]);
      haptic(HAPTIC.success);
      const index = before.items.length - 1;
      showToast({
        message: `${item.name} · ${energy.fmt(kcal)} added to ${MEAL_SLOT_LABEL[slot]}`,
        actionLabel: 'Undo',
        onAction: () => removeMealItems(before.id, [index]),
      });
      if (again) {
        setName('');
        setAmount('');
        setProtein('');
        setCarbs('');
        setFat('');
        setFibre('');
      } else {
        navigate('/diet');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh pb-8">
      <PageHeader title="Quick add" back={-1} subtitle={relativeDayLabel(selectedDate)} />

      <div className="space-y-4 px-4 pt-4">
        <Field
          label="What was it?"
          placeholder="Quick add"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
        />
        <Field
          label="Energy"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          suffix={energy.label}
          autoFocus
          hint={
            typed === undefined && macroKcal > 0
              ? `Worked out from the macros: ${energy.fmt(macroKcal)}`
              : undefined
          }
        />

        <div>
          <p className="mb-1.5 text-[13px] font-medium text-secondary">Macros (optional)</p>
          <div className="grid grid-cols-2 gap-2">
            <Field placeholder="Protein" value={protein} onChange={(e) => setProtein(e.target.value)} inputMode="decimal" suffix="g" aria-label="Protein" />
            <Field placeholder="Carbs" value={carbs} onChange={(e) => setCarbs(e.target.value)} inputMode="decimal" suffix="g" aria-label="Carbs" />
            <Field placeholder="Fat" value={fat} onChange={(e) => setFat(e.target.value)} inputMode="decimal" suffix="g" aria-label="Fat" />
            <Field placeholder="Fibre" value={fibre} onChange={(e) => setFibre(e.target.value)} inputMode="decimal" suffix="g" aria-label="Fibre" />
          </div>
          {mismatch && (
            <p className="mt-1.5 text-[12px] text-amber-600">
              Those macros alone come to {energy.fmt(macroKcal)}, more than the {energy.fmt(kcal)}{' '}
              typed. Both are kept as entered — check one of them.
            </p>
          )}
        </div>

        <div>
          <p className="mb-2 text-[13px] font-medium text-secondary">Meal</p>
          <div className="flex flex-wrap gap-2">
            {MEAL_SLOTS.map((s) => (
              <Chip key={s} active={slot === s} onClick={() => setSlot(s)}>
                {MEAL_SLOT_LABEL[s]}
              </Chip>
            ))}
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <Button full size="lg" onClick={() => save(false)} disabled={!canSave}>
            Add {kcal > 0 ? energy.fmt(kcal) : ''}
          </Button>
          <Button size="lg" variant="secondary" onClick={() => save(true)} disabled={!canSave}>
            Add another
          </Button>
        </div>

        <p className="text-[11.5px] leading-relaxed text-muted">
          Quick adds carry no vitamins or minerals, so they count as unknown on the
          Micronutrients screen rather than as zero. For something you eat often, create a food
          instead and it will be one tap next time.
        </p>
      </div>
    </div>
  );
}
