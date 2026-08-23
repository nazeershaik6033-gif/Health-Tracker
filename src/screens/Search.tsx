import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/schema';
import { useApp } from '@/stores/useApp';
import {
  addFavourite,
  addMealItems,
  createFood,
  favouriteLabel,
  favouritesForSlot,
  logFavourite,
  removeFavourite,
  removeMealItem,
  updateMeal,
} from '@/db/repo';
import { searchFoods, frequentFoods } from '@/lib/foodSearch';
import { searchRemote } from '@/lib/foodLookup';
import { fatSecretReady, type FoodDraft } from '@/lib/fatsecret';
import { STARTER_FREQUENT } from '@/data/foods.seed';
import {
  buildMealItem,
  buildMealItemFromGrams,
  per100gFromItem,
  rescaleMealItem,
  roundNutrients,
  scaleNutrients,
} from '@/lib/nutrition';
import { draftToFood, generateFood } from '@/ai/service';
import { hasKey } from '@/ai/registry';
import { describeError } from '@/ai/types';
import { FoodRow } from '@/components/FoodRow';
import { FavouritesSection } from '@/components/FavouritesSection';
import { BottomSheet } from '@/components/BottomSheet';
import { PortionSheet } from '@/components/PortionSheet';
import { Button, EmptyState, PageHeader } from '@/components/ui';
import {
  IconCamera,
  IconChevronDown,
  IconPlus,
  IconSearch,
  IconSparkle,
} from '@/components/icons';
import {
  MEAL_SLOTS,
  MEAL_SLOT_LABEL,
  type Favourite,
  type Food,
  type MealItem,
  type MealSlot,
} from '@/types';

/** Marks a row that lives only in the current search result, not IndexedDB. */
const REMOTE_PREFIX = 'fatsecret:';

export default function Search() {
  const navigate = useNavigate();
  const { selectedDate, pendingSlot, setPendingSlot, showToast } = useApp();
  const settings = useApp((s) => s.settings);
  const [searchParams] = useSearchParams();

  const [slot, setSlot] = useState<MealSlot>(pendingSlot ?? guessSlot());
  // Prefilled by anything that already knows what you're looking for — today
  // the AI meal suggestions, which would otherwise be read-only advice.
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '');
  const [slotOpen, setSlotOpen] = useState(false);
  const [detail, setDetail] = useState<Food | null>(null);
  const [favDetail, setFavDetail] = useState<Favourite | null>(null);
  const [addedIds, setAddedIds] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState('');
  const [remote, setRemote] = useState<FoodDraft[]>([]);
  const [remoteWarning, setRemoteWarning] = useState('');
  const [remoteBusy, setRemoteBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const foods = useLiveQuery(async () => db.foods.toArray(), []);

  // Re-reads only when the slot changes or something in this slot is pinned,
  // renamed, reordered or removed.
  const favourites = useLiveQuery(() => favouritesForSlot(slot), [slot], [] as Favourite[]);

  /**
   * Filtering runs against a deferred copy of the query, so a keystroke paints
   * the input immediately and React re-runs the (interruptible) list render
   * behind it. Scoring every food synchronously on each keystroke is what made
   * typing here feel like it was catching.
   */
  const deferredQuery = useDeferredValue(query);

  const results = useMemo(() => {
    if (!foods) return [];
    return deferredQuery.trim()
      ? searchFoods(foods, deferredQuery)
      : frequentFoods(foods, STARTER_FREQUENT);
  }, [foods, deferredQuery]);

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

  async function add(food: Food, qty = 1, servingLabel?: string, grams?: number) {
    // A FatSecret row only becomes a real local food once it is actually used.
    const real = await materialise(food);
    const item =
      grams !== undefined
        ? buildMealItemFromGrams(real, grams)
        : buildMealItem(real, servingLabel ?? real.servings[0]?.label ?? '100 g', qty);
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

  /* ------------------------------ favourites ----------------------------- */

  /** Pins the portion currently dialled into the sheet to the selected slot. */
  async function pinFood(food: Food, qty: number, servingLabel: string, grams?: number) {
    const real = await materialise(food);
    const item =
      grams !== undefined
        ? buildMealItemFromGrams(real, grams)
        : buildMealItem(real, servingLabel, qty);
    const favourite = await addFavourite({ slot, items: [item] });
    setDetail(null);

    showToast({
      message: `${item.name} pinned to ${MEAL_SLOT_LABEL[slot]}`,
      actionLabel: 'Undo',
      onAction: () => removeFavourite(favourite.id),
    });
  }

  async function logFav(favourite: Favourite) {
    const meal = await logFavourite(selectedDate, favourite, slot);
    const count = favourite.items.length;

    showToast({
      message: `${favouriteLabel(favourite)} added`,
      actionLabel: 'Undo',
      onAction: async () => {
        // Favourites append to the end of the slot, so the items just added are
        // the last `count` of them however many were already there.
        const fresh = await db.meals.get(meal.id);
        if (fresh) await updateMeal(meal.id, { items: fresh.items.slice(0, -count) });
      },
    });
  }

  /**
   * A single-item favourite reopens the portion sheet so the saved quantity can
   * be overridden for one meal without disturbing what is pinned. A combo has
   * no single portion to edit, so tapping it just logs it.
   */
  function openFav(favourite: Favourite) {
    if (favourite.items.length === 1) setFavDetail(favourite);
    else void logFav(favourite);
  }

  async function logFavItem(item: MealItem) {
    await addMealItems(selectedDate, slot, [item]);
    setFavDetail(null);
    showToast({ message: `${item.name} added` });
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
          className="mt-3 flex w-full items-center gap-3 accent-card p-3 text-left"
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
        {/* Pinned first, and only when browsing: while searching, the thing
            being searched for is what should be at the top of the screen. */}
        {!query.trim() && (
          <FavouritesSection
            slot={slot}
            favourites={favourites ?? []}
            onLog={logFav}
            onOpen={openFav}
          />
        )}

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
                ? 'Generate it with AI, or enter it yourself — either way it is saved for next time.'
                : 'Enter it yourself and it is saved for next time. An AI key would also let the app estimate it for you.'
            }
            action={
              <div className="flex flex-col gap-2">
                {hasKey(settings) && (
                  <Button onClick={generate} disabled={generating}>
                    <IconSparkle width={16} height={16} />
                    {generating ? 'Generating…' : 'Generate This Food with AI'}
                  </Button>
                )}
                {/* The moment you learn the food is missing is the moment to
                    offer creating it, with the name already filled in. */}
                <Button
                  variant={hasKey(settings) ? 'secondary' : 'primary'}
                  onClick={() =>
                    navigate(`/food/new?name=${encodeURIComponent(query.trim())}`)
                  }
                >
                  <IconPlus width={15} height={15} />
                  Create it yourself
                </Button>
              </div>
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
              <p className="accent-card accent-amber p-3 text-[12px] leading-relaxed">
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

        <button
          type="button"
          onClick={() => navigate(`/food/new?name=${encodeURIComponent(query.trim())}`)}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--surface-border)] py-3 text-[13px] font-semibold text-brand-600"
        >
          <IconPlus width={15} height={15} />
          Create a custom food
        </button>
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
          title={detail.name}
          brand={detail.brand}
          per100g={detail.per100g}
          servings={detail.servings}
          onClose={() => setDetail(null)}
          onConfirm={(qty, label, grams) => add(detail, qty, label, grams)}
          onFavourite={(qty, label, grams) => pinFood(detail, qty, label, grams)}
          favouriteSlotLabel={MEAL_SLOT_LABEL[slot]}
          onEditFood={
            // A FatSecret stub has no row to edit until it is used.
            detail.id.startsWith(REMOTE_PREFIX)
              ? undefined
              : () => navigate(`/food/${detail.id}/edit`)
          }
        />
      )}

      {/* One-off override of a pinned portion. What is saved stays saved. */}
      {favDetail && favDetail.items[0] && (
        <PortionSheet
          title={favouriteLabel(favDetail)}
          per100g={per100gFromItem(favDetail.items[0])}
          servings={[
            {
              label: favDetail.items[0].servingLabel,
              grams: favDetail.items[0].grams / (favDetail.items[0].qty || 1),
            },
          ]}
          initialQty={favDetail.items[0].qty}
          initialServingLabel={favDetail.items[0].servingLabel}
          onClose={() => setFavDetail(null)}
          onConfirm={(qty, label, grams) => {
            const base = favDetail.items[0];
            const item =
              grams !== undefined
                ? {
                    ...base,
                    qty: 1,
                    servingLabel: label,
                    grams,
                    nutrients: roundNutrients(
                      scaleNutrients(per100gFromItem(base), grams / 100),
                    ),
                  }
                : rescaleMealItem(base, qty, label);
            void logFavItem(item);
          }}
        />
      )}
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
