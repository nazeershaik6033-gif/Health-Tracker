import { useMemo, useState, type KeyboardEvent } from "react";
import { scaleNutrients } from "@/lib/nutrition";
import { BottomSheet } from "./BottomSheet";
import { Button, Field } from "./ui";
import { IconMove, IconStar, IconTrash } from "./icons";
import type { Food, Serving } from "@/types";

/**
 * Serving choice + quantity, with live nutrition.
 *
 * Shared deliberately: adding a food and editing one already logged are the
 * same decision, so they get the same control. Editing used to be impossible —
 * the only way to fix a portion was to delete the row and add it again.
 *
 * `servings` is passed separately from the food because a logged item may
 * reference a serving the food no longer lists (an AI-generated portion, or a
 * food edited since). Dropping the user onto a different serving silently
 * would change the numbers they already logged.
 */
export interface PortionSheetProps {
  title: string;
  brand?: string;
  /** Per-100g basis for the live preview. */
  per100g: Food["per100g"];
  servings: Serving[];
  initialQty?: number;
  initialServingLabel?: string;
  /**
   * Grams the entry actually logged. Only meaningful when reopening something
   * already logged, and only needed when `initialServingLabel` is not one of
   * `servings` — it is what lets the sheet rebuild the missing serving instead
   * of quietly substituting another one.
   */
  initialGrams?: number;
  confirmLabel?: (kcal: number) => string;
  onClose: () => void;
  /** `grams` is set only when the user typed an exact weight. */
  onConfirm: (qty: number, servingLabel: string, grams?: number) => void;
  /** Shown only when editing something already logged. */
  onDelete?: () => void;
  /** Opens the food's own editor. Absent when there is no food row behind it. */
  onEditFood?: () => void;
  /**
   * Pins the portion currently shown to a meal slot.
   *
   * The star lives here rather than on the food row because this is the only
   * screen where the quantity exists: "2 rotis for breakfast" can be saved the
   * moment it is dialled in, without logging it first and starring it after.
   */
  onFavourite?: (qty: number, servingLabel: string, grams?: number) => void;
  /** e.g. "Breakfast" — names the slot the star would pin to. */
  favouriteSlotLabel?: string;
  /** Renders the star already filled, for a portion that is pinned. */
  favourited?: boolean;
  /**
   * Opens the slot picker to re-file this item under a different meal. Only
   * meaningful for something already logged, so it is absent while adding.
   */
  onMove?: () => void;
}

/** A label this sheet itself writes for a weight-mode entry, e.g. "225 g". */
const WEIGHT_LABEL = /^\s*\d+(\.\d+)?\s*(g|ml)\s*$/i;

/** Keeps a number field to one leading number: "1.2.3" and "-4" never appear. */
function sanitizeNumeric(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  const [whole, ...rest] = cleaned.split(".");
  return rest.length ? `${whole}.${rest.join("")}` : whole;
}

export function PortionSheet({
  title,
  brand,
  per100g,
  servings,
  initialQty = 1,
  initialServingLabel,
  initialGrams,
  confirmLabel,
  onClose,
  onConfirm,
  onDelete,
  onEditFood,
  onFavourite,
  favouriteSlotLabel,
  favourited = false,
  onMove,
}: PortionSheetProps) {
  // The serving that was logged is not always one the food still lists — an AI
  // portion, a weight typed by hand, a food edited since. Without this the
  // lookup below missed and the sheet silently reset to the food's first
  // serving, so opening a row to change its quantity changed the amount too.
  const options: Serving[] = useMemo(() => {
    const base = servings.length ? servings : [{ label: "100 g", grams: 100 }];
    if (!initialServingLabel) return base;
    if (base.some((s) => s.label === initialServingLabel)) return base;
    // Reconstructable only when the caller said how much was logged.
    if (!initialGrams) return base;
    return [
      { label: initialServingLabel, grams: initialGrams / (initialQty || 1) },
      ...base,
    ];
  }, [servings, initialServingLabel, initialGrams, initialQty]);

  const fallback: Serving = options[0];
  const [servingLabel, setServingLabel] = useState(
    initialServingLabel ?? fallback.label,
  );
  const [qty, setQty] = useState(String(initialQty));
  // Servings cover "one katori"; grams cover "170 g off the kitchen scale".
  // Neither replaces the other, so both are offered. An entry that was logged
  // by weight reopens by weight: showing "225 g" as a serving chip and 1 as a
  // quantity is a worse answer to "what did I log?" than the number itself.
  const [mode, setMode] = useState<"serving" | "grams">(
    initialServingLabel && WEIGHT_LABEL.test(initialServingLabel)
      ? "grams"
      : "serving",
  );

  const serving = options.find((s) => s.label === servingLabel) ?? fallback;
  const quantity = Math.max(0, Number(qty) || 0);

  const [gramsDraft, setGramsDraft] = useState(() =>
    String(
      Math.round(
        (options.find((s) => s.label === initialServingLabel)?.grams ??
          fallback.grams) * (initialQty || 1),
      ),
    ),
  );
  const typedGrams = Math.max(0, Number(gramsDraft) || 0);
  const grams = mode === "grams" ? typedGrams : serving.grams * quantity;
  const n = scaleNutrients(per100g, grams / 100);
  const kcal = Math.round(n.kcal);

  const canConfirm = grams > 0;
  const confirm = () => {
    if (!canConfirm) return;
    if (mode === "grams") {
      onConfirm(1, `${Math.round(typedGrams * 10) / 10} g`, typedGrams);
    } else {
      onConfirm(quantity, servingLabel);
    }
  };

  // Enter on a hardware keyboard, "Done" on a phone: both should commit, since
  // the whole sheet is one decision and the button may be a scroll away.
  const submitOnEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.currentTarget.blur();
    confirm();
  };

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={title}
      footer={
        <div className="flex gap-2">
          {onDelete && (
            <Button
              variant="secondary"
              onClick={onDelete}
              aria-label={`Remove ${title}`}
            >
              <IconTrash width={16} height={16} />
            </Button>
          )}
          {onFavourite && (
            <Button
              variant="secondary"
              aria-label={
                favourited
                  ? `${title} is a favourite for ${favouriteSlotLabel}`
                  : `Save this portion as a ${favouriteSlotLabel} favourite`
              }
              aria-pressed={favourited}
              onClick={() =>
                mode === "grams"
                  ? onFavourite(
                      1,
                      `${Math.round(typedGrams * 10) / 10} g`,
                      typedGrams,
                    )
                  : onFavourite(quantity, servingLabel)
              }
            >
              <IconStar
                width={16}
                height={16}
                filled={favourited}
                className={favourited ? "text-accent-500" : undefined}
              />
            </Button>
          )}
          <Button size="lg" full disabled={!canConfirm} onClick={confirm}>
            {confirmLabel ? confirmLabel(kcal) : `Add ${kcal} Cal`}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 pb-2">
        {(brand || onMove || onEditFood) && (
          <div className="flex items-center gap-3">
            {brand && <p className="min-w-0 truncate text-[13px] text-secondary">{brand}</p>}
            <div className="ml-auto flex shrink-0 items-center gap-3">
              {onMove && (
                <button
                  type="button"
                  onClick={onMove}
                  className="flex items-center gap-1 text-[12.5px] font-semibold text-brand-600"
                >
                  <IconMove width={14} height={14} />
                  Move
                </button>
              )}
              {onEditFood && (
                <button
                  type="button"
                  onClick={onEditFood}
                  className="text-[12.5px] font-semibold text-brand-600"
                >
                  Edit food
                </button>
              )}
            </div>
          </div>
        )}

        <div className="surface-sunken flex gap-1 rounded-xl p-1">
          {(["serving", "grams"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                // Carry the current weight across so switching never changes
                // the amount out from under the user.
                if (m === "grams")
                  setGramsDraft(String(Math.round(serving.grams * quantity)));
                setMode(m);
              }}
              className={`flex-1 rounded-lg py-1.5 text-[12.5px] font-semibold capitalize transition-colors ${
                mode === m
                  ? "bg-[var(--surface-card)] shadow-sm"
                  : "text-secondary"
              }`}
            >
              {m === "serving" ? "By serving" : "By weight"}
            </button>
          ))}
        </div>

        {mode === "grams" ? (
          <div>
            <Field
              label="Weight"
              value={gramsDraft}
              onChange={(e) => setGramsDraft(sanitizeNumeric(e.target.value))}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={submitOnEnter}
              inputMode="decimal"
              enterKeyHint="done"
              autoComplete="off"
              suffix="g"
              hint="Tap a serving below to fill in its weight."
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {options.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => setGramsDraft(String(Math.round(s.grams)))}
                  className="hairline rounded-full border px-3 py-1.5 text-[12.5px] font-medium"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div>
              <span className="mb-1.5 block text-[13px] font-medium text-secondary">
                Serving
              </span>
              <div className="flex flex-wrap gap-2">
                {options.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => setServingLabel(s.label)}
                    className={`hairline rounded-full border px-3 py-1.5 text-[13px] font-medium ${
                      s.label === servingLabel
                        ? "border-brand-500 tint-soft tint-brand"
                        : ""
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-end gap-2">
              <Field
                label="Quantity"
                value={qty}
                onChange={(e) => setQty(sanitizeNumeric(e.target.value))}
                onFocus={(e) => e.currentTarget.select()}
                onKeyDown={submitOnEnter}
                inputMode="decimal"
                enterKeyHint="done"
                autoComplete="off"
                suffix={`× ${serving.label}`}
                className="flex-1"
              />
              {/* Steppers because typing a decimal on a phone keyboard to change
              1 → 2 is more work than it should be. */}
              <div className="mb-1 flex gap-1">
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label="Decrease quantity"
                  onClick={() =>
                    setQty(
                      String(Math.max(0, Math.round((quantity - 0.5) * 2) / 2)),
                    )
                  }
                >
                  −
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label="Increase quantity"
                  onClick={() =>
                    setQty(String(Math.round((quantity + 0.5) * 2) / 2))
                  }
                >
                  +
                </Button>
              </div>
            </div>
          </>
        )}

        <div className="surface-sunken grid grid-cols-5 gap-1 rounded-xl p-3 text-center">
          <Stat label="Cal" value={kcal} />
          <Stat label="Protein" value={`${Math.round(n.protein)}g`} />
          <Stat label="Fat" value={`${Math.round(n.fat)}g`} />
          <Stat label="Carbs" value={`${Math.round(n.carbs)}g`} />
          <Stat label="Fibre" value={`${Math.round(n.fibre)}g`} />
        </div>

        <p className="text-center text-[11.5px] text-muted">
          {Math.round(grams)} g total
        </p>
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
