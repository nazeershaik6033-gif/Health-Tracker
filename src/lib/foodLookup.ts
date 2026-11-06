import type { FatSecretConfig, Settings } from '@/types';
import { lookupBarcode as lookupOFF } from './openfoodfacts';
import {
  describeFatSecretError,
  fatSecretReady,
  lookupFatSecretBarcode,
  searchFatSecret,
  type FoodDraft,
} from './fatsecret';

/**
 * The tiered food lookup, in one place so the screens don't each grow their
 * own provider ladder.
 *
 * Order is FatSecret → Open Food Facts. FatSecret goes first when it's
 * configured because the user opted into it and its branded coverage is
 * curated rather than crowd-sourced; Open Food Facts is the keyless fallback
 * that always works. A failing tier never blocks the next one — it comes back
 * as a `warning` so the UI can mention it without turning a found product into
 * an error screen.
 */

export interface BarcodeResult {
  found: boolean;
  food?: FoodDraft;
  /** Human-readable provenance for the result card. */
  note?: string;
  /** Product exists but carries no usable nutrition. */
  partial?: boolean;
  /**
   * What the product is, when a database knew the name but not the numbers.
   * A bare barcode is useless to both the user and the AI fallback; a name is
   * the difference between "not found" and "we know what this is, just not
   * what's in it".
   */
  productName?: string;
  brand?: string;
  /** A tier that failed while a later one succeeded (or also failed). */
  warning?: string;
}

export async function lookupBarcodeTiered(
  settings: Settings,
  barcode: string,
  signal?: AbortSignal,
  /** Symbology the decoder reported, which disambiguates 8-digit codes. */
  format?: string,
): Promise<BarcodeResult> {
  let warning: string | undefined;

  if (fatSecretReady(settings.fatsecret)) {
    try {
      const food = await lookupFatSecretBarcode(settings.fatsecret, barcode, signal);
      if (food) return { found: true, food, note: 'FatSecret' };
    } catch (err) {
      if (isAbort(err)) throw err;
      warning = `FatSecret: ${describeFatSecretError(err)}`;
    }
  }

  try {
    const off = await lookupOFF(barcode, signal, format);
    if (off.found && off.food && !off.partial) {
      return {
        found: true,
        food: off.food,
        warning,
        note: [
          'Open Food Facts',
          off.nutriscore ? `Nutri-Score ${off.nutriscore}` : '',
          off.novaGroup ? `NOVA ${off.novaGroup}` : '',
        ]
          .filter(Boolean)
          .join(' · '),
      };
    }
    return {
      found: false,
      warning,
      partial: off.partial,
      productName: off.found ? off.food?.name : undefined,
      brand: off.found ? off.food?.brand : undefined,
      note: off.found
        ? `"${off.food?.name ?? 'That product'}" is in Open Food Facts but has no nutrition data.`
        : undefined,
    };
  } catch (err) {
    if (isAbort(err)) throw err;
    const offMessage =
      err instanceof TypeError
        ? "Couldn't reach Open Food Facts — you may be offline."
        : err instanceof Error
          ? err.message
          : 'Open Food Facts lookup failed.';
    // Both tiers are down: lead with Open Food Facts (it's the one every user
    // has) and keep the FatSecret detail alongside it.
    return { found: false, warning: [warning, offMessage].filter(Boolean).join(' · ') };
  }
}

export interface RemoteSearchResult {
  foods: FoodDraft[];
  warning?: string;
}

/**
 * Name search against FatSecret. Returns empty rather than throwing when
 * FatSecret isn't configured, so callers can render local results unchanged.
 */
export async function searchRemote(
  cfg: FatSecretConfig,
  query: string,
  signal?: AbortSignal,
): Promise<RemoteSearchResult> {
  if (!fatSecretReady(cfg) || !query.trim()) return { foods: [] };
  try {
    return { foods: await searchFatSecret(cfg, query, signal) };
  } catch (err) {
    if (isAbort(err)) throw err;
    return { foods: [], warning: describeFatSecretError(err) };
  }
}

const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError';
