import type { Nutrients } from '@/types';

/**
 * One logged item's macros, in the row itself.
 *
 * The day card at the top of Diet answers "how did today go"; this answers
 * "which of these rows is why", without opening a sheet per item. It shows
 * absolute grams and no targets on purpose — a single food has no target of its
 * own, and a percentage of the day's goal would just be the same four numbers
 * divided by four constants.
 */
export function MacroStrip({ nutrients }: { nutrients: Nutrients }) {
  return (
    <div className="surface-sunken mt-1.5 grid grid-cols-4 gap-1 rounded-xl px-2 py-2">
      <Macro label="Protein" grams={nutrients.protein} color="var(--color-macro-protein)" />
      <Macro label="Fats" grams={nutrients.fat} color="var(--color-macro-fat)" />
      <Macro label="Carbs" grams={nutrients.carbs} color="var(--color-macro-carb)" />
      <Macro label="Fibre" grams={nutrients.fibre} color="var(--color-macro-fibre)" />
    </div>
  );
}

function Macro({ label, grams, color }: { label: string; grams: number; color: string }) {
  return (
    <div className="text-center">
      <p className="tabular text-[13px] font-bold" style={{ color }}>
        {formatGrams(grams)}
      </p>
      <p className="text-[10px] text-muted">{label}</p>
    </div>
  );
}

/**
 * A decimal below 10 g, whole numbers above it. Rounding a 1.4 g protein to
 * "1 g" loses a third of it; carrying a decimal on 51 g is noise.
 */
function formatGrams(value: number): string {
  const g = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
  return `${g} g`;
}
