import { useState } from "react";
import { scaleNutrients } from "@/lib/nutrition";
import { BottomSheet } from "./BottomSheet";
import { Button, Field } from "./ui";
import { IconTrash } from "./icons";
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
  confirmLabel?: (kcal: number) => string;
  onClose: () => void;
  /** `grams` is set only when the user typed an exact weight. */
  onConfirm: (qty: number, servingLabel: string, grams?: number) => void;
  /** Shown only when editing something already logged. */
  onDelete?: () => void;
  /** Opens the food's own editor. Absent when there is no food row behind it. */
  onEditFood?: () => void;
}

export function PortionSheet({
  title,
  brand,
  per100g,
  servings,
  initialQty = 1,
  initialServingLabel,
  confirmLabel,
  onClose,
  onConfirm,
  onDelete,
  onEditFood,
}: PortionSheetProps) {
  const fallback: Serving = servings[0] ?? { label: "100 g", grams: 100 };
  const [servingLabel, setServingLabel] = useState(
    initialServingLabel ?? fallback.label,
  );
  const [qty, setQty] = useState(String(initialQty));
  // Servings cover "one katori"; grams cover "170 g off the kitchen scale".
  // Neither replaces the other, so both are offered.
  const [mode, setMode] = useState<"serving" | "grams">("serving");

  const serving = servings.find((s) => s.label === servingLabel) ?? fallback;
  const quantity = Math.max(0, Number(qty) || 0);

  const [gramsDraft, setGramsDraft] = useState(() =>
    String(
      Math.round(
        (servings.find((s) => s.label === initialServingLabel)?.grams ??
          fallback.grams) * (initialQty || 1),
      ),
    ),
  );
  const typedGrams = Math.max(0, Number(gramsDraft) || 0);
  const grams = mode === "grams" ? typedGrams : serving.grams * quantity;
  const n = scaleNutrients(per100g, grams / 100);
  const kcal = Math.round(n.kcal);

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
          <Button
            size="lg"
            full
            disabled={grams <= 0}
            onClick={() =>
              mode === "grams"
                ? onConfirm(
                    1,
                    `${Math.round(typedGrams * 10) / 10} g`,
                    typedGrams,
                  )
                : onConfirm(quantity, servingLabel)
            }
          >
            {confirmLabel ? confirmLabel(kcal) : `Add ${kcal} Cal`}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 pb-2">
        <div className="-mt-2 flex items-center gap-2">
          {brand && (
            <p className="flex-1 text-[13px] text-secondary">{brand}</p>
          )}
          {onEditFood && (
            <button
              type="button"
              onClick={onEditFood}
              className="ml-auto text-[12.5px] font-semibold text-brand-600"
            >
              Edit food
            </button>
          )}
        </div>

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
              onChange={(e) =>
                setGramsDraft(e.target.value.replace(/[^0-9.]/g, ""))
              }
              inputMode="decimal"
              suffix="g"
              hint="Tap a serving below to fill in its weight."
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {servings.map((s) => (
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
                {servings.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => setServingLabel(s.label)}
                    className={`hairline rounded-full border px-3 py-1.5 text-[13px] font-medium ${
                      s.label === servingLabel
                        ? "border-brand-500 bg-brand-50 text-brand-700"
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
                onChange={(e) => setQty(e.target.value)}
                inputMode="decimal"
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
