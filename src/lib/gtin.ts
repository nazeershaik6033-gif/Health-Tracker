/**
 * GTIN normalisation.
 *
 * The same physical product carries different digit strings depending on which
 * symbology is printed on it, and databases store whichever form they were
 * given. A US can of cola is UPC-A `049000006346` on the pack, and Open Food
 * Facts holds it as EAN-13 `0049000006346`; a small pack is UPC-E `04900066`,
 * which is neither. Querying only the digits the scanner read therefore misses
 * products that are genuinely in the database — a miss that presents as "this
 * product isn't in the database" and sends the user to manual entry for
 * something that was there all along.
 *
 * So a lookup asks for a short, ordered list of candidate forms instead of one
 * string. The list is deliberately small: every entry is a network round-trip.
 */

/** Digits only — scanners and hand-typed codes both pick up stray characters. */
export function digitsOf(code: string): string {
  return code.replace(/\D/g, '');
}

/**
 * GTIN-13, the form most databases key on.
 *
 * Longer codes are GTIN-14 shipping cases whose trailing 13 identify the retail
 * unit; shorter ones are zero-padded, which is what the standard says a GTIN-13
 * field holds for a UPC-A or EAN-8.
 */
export function toGtin13(code: string): string {
  const digits = digitsOf(code);
  return digits.length >= 13 ? digits.slice(-13) : digits.padStart(13, '0');
}

/**
 * Expands a zero-suppressed UPC-E into its full UPC-A.
 *
 * UPC-E is not a truncation, so zero-padding it produces a code no product has:
 * the last digit before the check digit says *where* the omitted zeroes belong,
 * and the expansion differs for each case. This is why small packs — sweets,
 * single-serve drinks, the things most likely to be scanned — miss most often.
 *
 * Returns null for anything that isn't a plausible UPC-E.
 */
export function expandUpcE(code: string): string | null {
  const d = digitsOf(code);
  if (d.length !== 8) return null;
  // Only number systems 0 and 1 have a UPC-E form.
  if (d[0] !== '0' && d[0] !== '1') return null;

  const s = d[0];
  const [d1, d2, d3, d4, d5, d6] = d.slice(1, 7);
  const check = d[7];

  switch (d6) {
    case '0':
    case '1':
    case '2':
      return `${s}${d1}${d2}${d6}0000${d3}${d4}${d5}${check}`;
    case '3':
      return `${s}${d1}${d2}${d3}00000${d4}${d5}${check}`;
    case '4':
      return `${s}${d1}${d2}${d3}${d4}00000${d5}${check}`;
    default:
      return `${s}${d1}${d2}${d3}${d4}${d5}0000${d6}${check}`;
  }
}

/**
 * The forms worth asking a database for, most likely first, without duplicates.
 *
 * `format` comes from the decoder when it knows the symbology. It matters for
 * the 8-digit case, which is genuinely ambiguous between EAN-8 (a short code in
 * its own right) and UPC-E (a compressed UPC-A). Without it both readings are
 * tried, which costs one extra request and is far better than missing the
 * product.
 */
export function gtinCandidates(code: string, format?: string): string[] {
  const digits = digitsOf(code);
  if (!digits) return [];

  const out: string[] = [digits];
  const add = (value: string | null | undefined) => {
    if (value && !out.includes(value)) out.push(value);
  };

  const symbology = format?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? '';
  const looksUpcE = symbology.includes('upce');
  const looksEan8 = symbology.includes('ean8');

  if (digits.length === 8) {
    // A UPC-E expands before it pads: the padded form of a UPC-E is a code no
    // product carries, so trying it first would waste the first request.
    if (!looksEan8) {
      const upcA = expandUpcE(digits);
      add(upcA);
      if (upcA) add(toGtin13(upcA));
    }
    if (!looksUpcE) add(toGtin13(digits));
  } else {
    add(toGtin13(digits));
    // A 13-digit code that is really a zero-padded UPC-A: some databases hold
    // the 12-digit form the pack actually prints.
    if (digits.length === 13 && digits.startsWith('0')) add(digits.slice(1));
    // A 14-digit case code also resolves via its 13-digit retail unit, which
    // toGtin13 has already added.
  }

  // Three is the ceiling on purpose. Each candidate is a request on a phone
  // that may be on mobile data, and past the third the odds of a hit are not
  // worth the wait the user sits through.
  return out.slice(0, 3);
}
