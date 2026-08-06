import { IconCheck, IconPlus } from './icons';
import type { Food } from '@/types';
import { scaleNutrients } from '@/lib/nutrition';

/**
 * One row in the search / frequently-tracked list: name, default serving,
 * calories for that serving, and an add button that flips to a tick once
 * logged (the reference app's feedback pattern).
 */
export function FoodRow({
  food,
  added,
  onAdd,
  onOpen,
}: {
  food: Food;
  added?: boolean;
  onAdd: () => void;
  onOpen?: () => void;
}) {
  const serving = food.servings[0] ?? { label: '100 g', grams: 100 };
  const kcal = Math.round(scaleNutrients(food.per100g, serving.grams / 100).kcal);

  return (
    <div className="flex items-center gap-3 border-b border-[var(--surface-border)] py-3 last:border-0">
      <button type="button" onClick={onOpen ?? onAdd} className="min-w-0 flex-1 text-left">
        <p className="truncate text-[15px] font-semibold">{food.name}</p>
        <p className="truncate text-[12.5px] text-secondary">
          {serving.label}
          {food.brand ? ` · ${food.brand}` : ''}
        </p>
      </button>

      <span className="tabular shrink-0 text-[13px] font-medium text-secondary">{kcal} Cal</span>

      <button
        type="button"
        onClick={onAdd}
        aria-label={added ? `${food.name} added` : `Add ${food.name}`}
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
          added
            ? 'border-brand-500 bg-brand-500 text-white'
            : 'border-brand-500 text-brand-600 hover:bg-brand-50'
        }`}
      >
        {added ? (
          <IconCheck width={14} height={14} strokeWidth={2.75} />
        ) : (
          <IconPlus width={14} height={14} strokeWidth={2.75} />
        )}
      </button>
    </div>
  );
}
