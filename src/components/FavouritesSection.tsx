import { memo, useState } from 'react';
import { favouriteLabel, removeFavourite, reorderFavourites, updateFavourite } from '@/db/repo';
import { formatPortion, sumNutrients } from '@/lib/nutrition';
import { Field } from './ui';
import {
  IconChevronDown,
  IconChevronUp,
  IconPlus,
  IconStar,
  IconTrash,
} from './icons';
import { MEAL_SLOT_LABEL, type Favourite, type MealSlot } from '@/types';

/**
 * The pinned list for one meal slot, above everything else on the food search.
 *
 * Two modes. Normally each row is a one-tap log at the quantity you saved, with
 * the row itself opening the portion sheet for a one-off change. "Edit" turns
 * the list into a rearrangeable one: rename, reorder, remove. Nothing here ever
 * reorders itself by usage — the order is the user's, and it stays put.
 */
export function FavouritesSection({
  slot,
  favourites,
  onLog,
  onOpen,
}: {
  slot: MealSlot;
  favourites: Favourite[];
  onLog: (favourite: Favourite) => void;
  onOpen: (favourite: Favourite) => void;
}) {
  const [editing, setEditing] = useState(false);

  if (!favourites.length) {
    return (
      <section className="mt-4">
        <Heading slot={slot} />
        <p className="hairline rounded-xl border border-dashed px-3.5 py-3 text-[12.5px] leading-relaxed text-muted">
          Nothing pinned to {MEAL_SLOT_LABEL[slot].toLowerCase()} yet. Set a portion on any
          food and tap the ☆ to keep it here — quantity and macros exactly as you entered
          them.
        </p>
      </section>
    );
  }

  async function move(index: number, delta: number) {
    const next = [...favourites];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    await reorderFavourites(next.map((f) => f.id));
  }

  return (
    <section className="mt-4">
      <Heading
        slot={slot}
        action={
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="text-[12.5px] font-semibold text-brand-600"
          >
            {editing ? 'Done' : 'Edit'}
          </button>
        }
      />

      <ul>
        {favourites.map((favourite, i) => (
          <FavouriteRow
            key={favourite.id}
            favourite={favourite}
            editing={editing}
            first={i === 0}
            last={i === favourites.length - 1}
            onLog={() => onLog(favourite)}
            onOpen={() => onOpen(favourite)}
            onMoveUp={() => move(i, -1)}
            onMoveDown={() => move(i, 1)}
          />
        ))}
      </ul>
    </section>
  );
}

function Heading({ slot, action }: { slot: MealSlot; action?: React.ReactNode }) {
  return (
    <div className="mb-1 flex items-center justify-between">
      <h2 className="flex items-center gap-1.5 text-[13px] font-bold text-secondary">
        <IconStar width={13} height={13} filled className="text-accent-500" />
        {MEAL_SLOT_LABEL[slot]} favourites
      </h2>
      {action}
    </div>
  );
}

const FavouriteRow = memo(function FavouriteRow({
  favourite,
  editing,
  first,
  last,
  onLog,
  onOpen,
  onMoveUp,
  onMoveDown,
}: {
  favourite: Favourite;
  editing: boolean;
  first: boolean;
  last: boolean;
  onLog: () => void;
  onOpen: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(() => favouriteLabel(favourite));

  const totals = sumNutrients(favourite.items.map((i) => i.nutrients));
  const name = favouriteLabel(favourite);
  // A single item describes itself by its portion; a combo by what is in it.
  const detail =
    favourite.items.length === 1
      ? `${formatPortion(favourite.items[0].qty, favourite.items[0].servingLabel)} · ${Math.round(favourite.items[0].grams)} g`
      : favourite.items.map((i) => i.name).join(', ');

  if (renaming) {
    return (
      <li className="hairline border-b py-2.5 last:border-0">
        <Field
          label="Name this favourite"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
        />
        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setDraft(name);
              setRenaming(false);
            }}
            className="rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={async () => {
              await updateFavourite(favourite.id, { label: draft.trim() || undefined });
              setRenaming(false);
            }}
            className="rounded-lg bg-brand-500 px-3 py-1.5 text-[12.5px] font-semibold text-white"
          >
            Save
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="hairline flex items-center gap-2 border-b py-2.5 last:border-0">
      {editing && (
        <div className="flex shrink-0 flex-col">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={first}
            aria-label={`Move ${name} up`}
            className="rounded p-0.5 text-muted disabled:opacity-25"
          >
            <IconChevronUp width={15} height={15} />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={last}
            aria-label={`Move ${name} down`}
            className="rounded p-0.5 text-muted disabled:opacity-25"
          >
            <IconChevronDown width={15} height={15} />
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={editing ? () => setRenaming(true) : onOpen}
        className="min-w-0 flex-1 text-left transition-transform active:scale-[0.99]"
      >
        <span className="block truncate text-[14px] font-semibold">{name}</span>
        <span className="block truncate text-[12px] text-secondary">{detail}</span>
      </button>

      <span className="tabular shrink-0 text-right">
        <span className="block text-[13px] font-bold">{Math.round(totals.kcal)}</span>
        <span className="block text-[10.5px] text-muted">
          {Math.round(totals.protein)}P · {Math.round(totals.carbs)}C · {Math.round(totals.fat)}F
        </span>
      </span>

      {editing ? (
        <button
          type="button"
          onClick={() => removeFavourite(favourite.id)}
          aria-label={`Unpin ${name}`}
          className="shrink-0 rounded-lg p-2 text-muted transition-transform active:scale-90"
        >
          <IconTrash width={15} height={15} />
        </button>
      ) : (
        <button
          type="button"
          onClick={onLog}
          aria-label={`Add ${name}`}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-2 border-accent-500 text-accent-500 transition-transform active:scale-90"
        >
          <IconPlus width={16} height={16} strokeWidth={2.25} />
        </button>
      )}
    </li>
  );
});
