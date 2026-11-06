import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '@/stores/useApp';
import { useDay } from '@/stores/useDay';
import { dayBundle } from '@/db/repo';
import { dayContext, suggestNextMeal, type MealSuggestion } from '@/ai/service';
import { hasKey } from '@/ai/registry';
import { describeError } from '@/ai/types';
import { AIBadge, Skeleton } from './ui';
import { IconChevronRight, IconRefresh, IconSparkle } from './icons';
import { MEAL_SLOTS, MEAL_SLOT_LABEL, type Meal, type MealSlot } from '@/types';

/**
 * Which meal to suggest for.
 *
 * The slot the clock says it is, if nothing is logged there yet — otherwise the
 * next empty one after it, so mid-afternoon with lunch already logged asks
 * about dinner rather than about the lunch you just ate.
 */
export function nextSlot(
  bySlot: Record<MealSlot, Meal | undefined>,
  now = new Date(),
): MealSlot | null {
  const h = now.getHours();
  const current: MealSlot =
    h < 10 ? 'breakfast' : h < 12 ? 'morning_snack' : h < 15 ? 'lunch' : h < 18 ? 'evening_snack' : 'dinner';

  const empty = (slot: MealSlot) => !bySlot[slot]?.items.length;
  const from = MEAL_SLOTS.indexOf(current);

  for (let i = from; i < MEAL_SLOTS.length; i++) {
    if (empty(MEAL_SLOTS[i])) return MEAL_SLOTS[i];
  }
  // Everything from here on is logged; fall back to anything earlier that was
  // skipped, so a missed breakfast still gets a suggestion.
  return MEAL_SLOTS.slice(0, from).find(empty) ?? null;
}

/**
 * "What should I have for lunch?", answered from the day's own log.
 *
 * The gap it leads with is computed locally, so the card says something useful
 * with no API key and before any request is made. The AI call happens only when
 * asked for — this sits on the screen every time the Diet tab is opened, and
 * generating on every visit would burn a request to tell most people something
 * the arithmetic already said.
 */
export function NextMealCard({ date }: { date: string }) {
  const navigate = useNavigate();
  const { profile, settings, setPendingSlot } = useApp();
  const day = useDay(date);

  const [suggestion, setSuggestion] = useState<MealSuggestion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const keyed = hasKey(settings);
  const slot = nextSlot(day.bySlot);

  // A suggestion is about one specific day and one specific slot. Changing
  // either — or logging the meal it was about — makes it stale, so it goes.
  useEffect(() => {
    setSuggestion(null);
    setError('');
  }, [date, slot]);

  const remaining = {
    kcal: day.targets.kcal - day.totals.kcal,
    protein: day.targets.protein - day.totals.protein,
    fibre: day.targets.fibre - day.totals.fibre,
  };

  async function generate() {
    if (!keyed || busy || !slot) return;
    setBusy(true);
    setError('');
    try {
      const bundle = await dayBundle(date, profile);
      const result = await suggestNextMeal(
        settings,
        dayContext(bundle, profile),
        slot,
        remaining,
      );
      setSuggestion(result);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  /** Opens the food search prefilled, with the slot already chosen. */
  function logOption(name: string) {
    if (slot) setPendingSlot(slot);
    navigate(`/search?q=${encodeURIComponent(name)}`);
  }

  // Nothing left to suggest for. Saying so beats an empty card, but it does not
  // need the full treatment.
  if (!slot) {
    return (
      <div className="accent-card mb-3 p-4">
        <p className="accent-title text-[14px] font-bold">Every meal is logged</p>
        <p className="accent-body mt-1 text-[12.5px] leading-relaxed">
          {remaining.kcal >= 0
            ? `${Math.round(remaining.kcal).toLocaleString()} Cal still spare if you want something more.`
            : `You're ${Math.abs(Math.round(remaining.kcal)).toLocaleString()} Cal over — worth a walk this evening.`}
        </p>
      </div>
    );
  }

  const localLine = describeGap(remaining, day.meals.length > 0);

  return (
    <div className="accent-card mb-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <IconSparkle width={14} height={14} className="accent-rule-fg shrink-0" />
            <h2 className="accent-title text-[14px] font-bold tracking-tight">
              {MEAL_SLOT_LABEL[slot]} ideas
            </h2>
            {!keyed && <AIBadge label="Needs key" />}
          </div>
          <p className="accent-body mt-1 text-[12.5px] leading-relaxed">
            {suggestion?.headline || localLine}
          </p>
        </div>
        {suggestion && (
          <button
            type="button"
            onClick={generate}
            disabled={busy}
            aria-label="Suggest something else"
            className="accent-rule-fg shrink-0 rounded-lg p-1 transition-transform active:scale-90 disabled:opacity-40"
          >
            <IconRefresh width={15} height={15} className={busy ? 'animate-spin' : ''} />
          </button>
        )}
      </div>

      {busy && !suggestion && (
        <div className="mt-3 space-y-1.5">
          <Skeleton className="h-3 w-full rounded" />
          <Skeleton className="h-3 w-2/3 rounded" />
        </div>
      )}

      {suggestion && (
        <ul className="mt-3 space-y-2">
          {suggestion.options.map((option, i) => (
            <li key={`${option.name}-${i}`}>
              <button
                type="button"
                onClick={() => logOption(option.name)}
                className="accent-pill flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-transform active:scale-[0.99]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold">{option.name}</span>
                  <span className="block truncate text-[11.5px] opacity-80">
                    {option.portion}
                    {option.why && ` · ${option.why}`}
                  </span>
                </span>
                <span className="tabular shrink-0 text-right text-[11.5px] font-semibold">
                  <span className="block">{option.kcal} Cal</span>
                  <span className="block opacity-80">{option.protein} g P</span>
                </span>
                <IconChevronRight width={14} height={14} className="shrink-0 opacity-70" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {suggestion?.tip && (
        <p className="accent-body mt-2.5 text-[12px] leading-relaxed opacity-90">{suggestion.tip}</p>
      )}

      {error && <p className="accent-body mt-2 text-[12px]">{error}</p>}

      {!suggestion && !busy && (
        <div className="mt-3">
          {keyed ? (
            <button
              type="button"
              onClick={generate}
              className="accent-pill inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold transition-transform active:scale-95"
            >
              <IconSparkle width={12} height={12} />
              Ask Ria what to eat
            </button>
          ) : (
            <Link
              to="/settings"
              className="accent-pill inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold transition-transform active:scale-95"
            >
              <IconSparkle width={12} height={12} />
              Add an AI key for meal ideas
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The locally computed line, shown before any request and with no key at all.
 *
 * Leads with whichever gap is furthest off target, because "you're 12 g short
 * on protein" is a more useful prompt than a calorie figure most people can
 * already see on the ring directly above.
 */
function describeGap(
  remaining: { kcal: number; protein: number; fibre: number },
  logged: boolean,
): string {
  if (!logged) {
    return `Nothing logged yet — the whole ${Math.round(remaining.kcal).toLocaleString()} Cal is still yours to spend.`;
  }
  if (remaining.kcal < 0) {
    return `You're ${Math.abs(Math.round(remaining.kcal)).toLocaleString()} Cal over target. Keep this one small.`;
  }

  const cal = `${Math.round(remaining.kcal).toLocaleString()} Cal left`;
  if (remaining.protein > 15) return `${cal}, and ${Math.round(remaining.protein)} g of protein still to find.`;
  if (remaining.fibre > 8) return `${cal}, and ${Math.round(remaining.fibre)} g of fibre still to go.`;
  return `${cal}. Macros are close to where they should be.`;
}
