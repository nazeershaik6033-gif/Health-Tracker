import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/schema';
import { useApp } from '@/stores/useApp';
import { addMealItems, createFood, removeMealItem } from '@/db/repo';
import { searchFoods, frequentFoods } from '@/lib/foodSearch';
import { searchRemote } from '@/lib/foodLookup';
import { fatSecretReady, type FoodDraft } from '@/lib/fatsecret';
import { STARTER_FREQUENT } from '@/data/foods.seed';
import { buildMealItem, scaleNutrients } from '@/lib/nutrition';
import { draftToFood, generateFood } from '@/ai/service';
import { hasKey } from '@/ai/registry';
import { describeError } from '@/ai/types';
import { FoodRow } from '@/components/FoodRow';
import { BottomSheet } from '@/components/BottomSheet';
import { Button, EmptyState, Field, PageHeader } from '@/components/ui';
import {
  IconCamera,
  IconChevronDown,
  IconSearch,
  IconSparkle,
} from '@/components/icons';
import { MEAL_SLOTS, MEAL_SLOT_LABEL, type Food, type MealSlot } from '@/types';

/** Marks a row that lives only in the current search result, not IndexedDB. */
const REMOTE_PREFIX = 'fatsecret:';

export default function Search() {
  const navigate = useNavigate();
  const { selectedDate, pendingSlot, setPendingSlot, showToast } = useApp();
  const settings = useApp((s) => s.settings);

  const [slot, setSlot] = useState<MealSlot>(pendingSlot ?? guessSlot());
  const [query, setQuery] = useState('');
  const [slotOpen, setSlotOpen] = useState(false);
  const [detail, setDetail] = useState<Food | null>(null);
  const [addedIds, setAddedIds] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState('');
  const [remote, setRemote] = useState<FoodDraft[]>([]);
  const [remoteWarning, setRemoteWarning] = useState('');
  const [remoteBusy, setRemoteBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const foods = useLiveQuery(async () => db.foods.toArray(), []);

  const results = useMemo(() => {
    if (!foods) return [];
    return query.trim() ? searchFoods(foods, query) : frequentFoods(foods, STARTER_FREQUENT);
  }, [foods, query]);

  useEffect(() => () => setPendingSlot(undefined), [setPendingSlot]);

  /* ------------------------- FatSecret name search ----------------------- */

  const fatsecret = settings.fatsecret;

  useEffect(() => {
    const q = query.trim();
    if (!fatSecretReady(fatsecret) || q.length < 2) {
      setRemote([]);
      setRemoteWarning('');
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    // Debounced so typing a dish name is one request, not one per keystroke.
    const timer = setTimeout(async () => {
      setRemoteBusy(true);
      try {
        const res = await searchRemote(fatsecret, q, controller.signal);
        if (cancelled) return;
        setRemote(res.foods);
        setRemoteWarning(res.warning ?? '');
      } catch {
        /* superseded by a newer query */
      } finally {
        if (!cancelled) setRemoteBusy(false);
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, fatsecret]);

  /**
   * FatSecret rows are not in IndexedDB yet, so they get display-only ids and
   * are written for real the moment the user acts on one. Saving every search
   * result instead would fill the local database with foods nobody picked.
   */
  const remoteFoods = useMemo<Food[]>(
    () =>
      remote.map((draft, i) => ({
        ...draft,
        id: `${REMOTE_PREFIX}${i}`,
        useCount: 0,
        createdAt: 0,
      })),
    [remote],
  );

  async function materialise(food: Food): Promise<Food> {
    if (!food.id.startsWith(REMOTE_PREFIX)) return food;
    const { id: _id, useCount: _useCount, createdAt: _createdAt, ...draft } = food;
    return createFood(draft);
  }

  async function add(food: Food, qty = 1, servingLabel?: string) {
    // A FatSecret row only becomes a real local food once it is actually used.
    const real = await materialise(food);
    const item = buildMealItem(real, servingLabel ?? real.servings[0]?.label ?? '100 g', qty);
    const meal = await addMealItems(selectedDate, slot, [item]);
    setAddedIds((prev) => [...prev, food.id]);
    setDetail(null);

    showToast({
      message: `${food.name} added`,
      actionLabel: 'Undo',
      onAction: async () => {
        // The item we just appended is always the last one in the slot.
        const fresh = await db.meals.get(meal.id);
        if (fresh) await removeMealItem(meal.id, fresh.items.length - 1);
        setAddedIds((prev) => prev.filter((id) => id !== food.id));
      },
    });
  }

  async function generate() {
    const q = query.trim();
    if (!q || generating) return;
    setGenerating(true);
    setGenError('');
    try {
      const draft = await generateFood(settings, q);
      const food = await createFood(draftToFood(draft, 'ai'));
      setDetail(food);
    } catch (err) {
      setGenError(describeError(err));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <PageHeader
        title={`Track For ${MEAL_SLOT_LABEL[slot]}`}
        back={() => navigate(-1)}
        action={
          <button
            type="button"
            onClick={() => setSlotOpen(true)}
            className="surface-card mr-1 flex items-center gap-1 rounded-full px-3 py-1.5 text-[12.5px] font-semibold"
          >
            {MEAL_SLOT_LABEL[slot]}
            <IconChevronDown width={14} height={14} />
          </button>
        }
      />

      <div className="px-4 pt-3">
        <div className="hairline flex items-center gap-2 rounded-xl border px-3.5 py-2.5">
          <IconSearch width={18} height={18} className="shrink-0 text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by Food Name/Dish"
            className="w-full bg-transparent text-[15px] outline-none placeholder:text-[var(--text-muted)]"
            autoComplete="off"
            enterKeyHint="search"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} className="text-[13px] text-muted">
              Clear
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => navigate('/snap')}
          className="mt-3 flex w-full items-center gap-3 rounded-xl bg-brand-50 p-3 text-left"
        >
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-bold text-brand-800">Track with Images</p>
            <p className="text-[12px] text-brand-700/80">You click. We scan and track!</p>
          </div>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white">
            <IconCamera width={18} height={18} />
          </span>
        </button>
      </div>

      <div className="flex-1 px-4 pb-28">
        <h2 className="mt-4 mb-1 text-[13px] font-bold text-secondary">
          {query.trim() ? 'Results' : 'Frequently Tracked Foods'}
        </h2>

        {results.length > 0 ? (
          <div>
            {results.map((food) => (
              <FoodRow
                key={food.id}
                food={food}
                added={addedIds.includes(food.id)}
                onAdd={() => add(food)}
                onOpen={() => setDetail(food)}
              />
            ))}
          </div>
        ) : query.trim() ? (
          <EmptyState
            icon={<IconSearch width={22} height={22} />}
            title={`No match for "${query.trim()}"`}
            body={
              hasKey(settings)
                ? 'Generate it with AI and it will be saved for next time.'
                : 'Add an AI key in Settings to generate foods that are not in the database.'
            }
            action={
              hasKey(settings) ? (
                <Button onClick={generate} disabled={generating}>
                  <IconSparkle width={16} height={16} />
                  {generating ? 'Generating…' : 'Generate This Food with AI'}
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => navigate('/settings')}>
                  Open Settings
                </Button>
              )
            }
          />
        ) : (
          <EmptyState title="Nothing here yet" body="Search for a food to get started." />
        )}

        {/* ---------------------- FatSecret results --------------------- */}
        {query.trim().length >= 2 && fatSecretReady(fatsecret) && (
          <div className="mt-5">
            <h2 className="mb-1 flex items-center gap-1.5 text-[13px] font-bold text-secondary">
              From FatSecret
              {remoteBusy && (
                <span className="text-[11px] font-medium text-muted">searching…</span>
              )}
            </h2>

            {remoteFoods.length > 0 ? (
              remoteFoods.map((food) => (
                <FoodRow
                  key={food.id}
                  food={food}
                  added={addedIds.includes(food.id)}
                  onAdd={() => add(food)}
                  onOpen={() => setDetail(food)}
                />
              ))
            ) : remoteWarning ? (
              <p className="rounded-xl bg-amber-50 p-3 text-[12px] leading-relaxed text-amber-900">
                {remoteWarning}
              </p>
            ) : (
              !remoteBusy && (
                <p className="py-2 text-[12.5px] text-muted">
                  Nothing in FatSecret for &quot;{query.trim()}&quot;.
                </p>
              )
            )}
          </div>
        )}

        {genError && <p className="mt-3 text-center text-[12.5px] text-red-600">{genError}</p>}

        {query.trim() && results.length > 0 && hasKey(settings) && (
          <button
            type="button"
            onClick={generate}
            disabled={generating}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--surface-border)] py-3 text-[13px] font-semibold text-brand-600 disabled:opacity-50"
          >
            <IconSparkle width={15} height={15} />
            {generating ? 'Generating…' : `Generate "${query.trim()}" with AI`}
          </button>
        )}

        <p className="mt-6 text-center text-[12px] text-muted">
          Can&apos;t find what you&apos;re looking for? Use the search bar above.
        </p>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--surface-border)] bg-[var(--surface-card)] px-4 pt-3 pb-safe">
        <Button size="lg" full onClick={() => navigate('/diet')}>
          Done — Track For {MEAL_SLOT_LABEL[slot]}
        </Button>
      </div>

      {/* Slot switcher */}
      <BottomSheet open={slotOpen} onClose={() => setSlotOpen(false)} title="Track for which meal?">
        <ul className="pb-3">
          {MEAL_SLOTS.map((s) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => {
                  setSlot(s);
                  setSlotOpen(false);
                }}
                className={`w-full border-b border-[var(--surface-border)] py-3.5 text-left text-[15px] last:border-0 ${
                  s === slot ? 'font-bold text-brand-600' : ''
                }`}
              >
                {MEAL_SLOT_LABEL[s]}
              </button>
            </li>
          ))}
        </ul>
      </BottomSheet>

      {detail && (
        <PortionSheet
          food={detail}
          onClose={() => setDetail(null)}
          onAdd={(qty, label) => add(detail, qty, label)}
        />
      )}
    </div>
  );
}

/** Portion picker — serving choice plus quantity, with live nutrition. */
function PortionSheet({
  food,
  onClose,
  onAdd,
}: {
  food: Food;
  onClose: () => void;
  onAdd: (qty: number, servingLabel: string) => void;
}) {
  const [servingLabel, setServingLabel] = useState(food.servings[0]?.label ?? '100 g');
  const [qty, setQty] = useState('1');

  const serving = food.servings.find((s) => s.label === servingLabel) ?? food.servings[0];
  const quantity = Math.max(0, Number(qty) || 0);
  const grams = (serving?.grams ?? 100) * quantity;
  const n = scaleNutrients(food.per100g, grams / 100);

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={food.name}
      footer={
        <Button size="lg" full disabled={quantity <= 0} onClick={() => onAdd(quantity, servingLabel)}>
          Add {Math.round(n.kcal)} Cal
        </Button>
      }
    >
      <div className="space-y-4 pb-2">
        {food.brand && <p className="-mt-2 text-[13px] text-secondary">{food.brand}</p>}

        <div>
          <span className="mb-1.5 block text-[13px] font-medium text-secondary">Serving</span>
          <div className="flex flex-wrap gap-2">
            {food.servings.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => setServingLabel(s.label)}
                className={`hairline rounded-full border px-3 py-1.5 text-[13px] font-medium ${
                  s.label === servingLabel ? 'border-brand-500 bg-brand-50 text-brand-700' : ''
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <Field
          label="Quantity"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          inputMode="decimal"
          suffix={`× ${serving?.label ?? ''}`}
        />

        <div className="surface-sunken grid grid-cols-5 gap-1 rounded-xl p-3 text-center">
          <Stat label="Cal" value={Math.round(n.kcal)} />
          <Stat label="Protein" value={`${Math.round(n.protein)}g`} />
          <Stat label="Fat" value={`${Math.round(n.fat)}g`} />
          <Stat label="Carbs" value={`${Math.round(n.carbs)}g`} />
          <Stat label="Fibre" value={`${Math.round(n.fibre)}g`} />
        </div>

        <p className="text-center text-[11.5px] text-muted">{Math.round(grams)} g total</p>
      </div>
    </BottomSheet>
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

/** Sensible default slot based on the time of day. */
function guessSlot(): MealSlot {
  const h = new Date().getHours();
  if (h < 10) return 'breakfast';
  if (h < 12) return 'morning_snack';
  if (h < 15) return 'lunch';
  if (h < 18) return 'evening_snack';
  return 'dinner';
}
