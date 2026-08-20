/**
 * sheetLocation.ts — resolve a workbook tab name onto a stock_location row.
 *
 * Replaces the hardcoded sheet→UUID map that used to live in
 * ontSerialWorkbook.ts. That map silently dropped any tab it did not list: the
 * "Tembelilhle" tab (504 ONT + 504 Gizzu serials) had never imported, and the
 * warehouse it belongs to existed in the database the whole time. Resolving
 * against `stock_locations` means a new project imports as soon as it has a
 * warehouse, with no code change.
 *
 * The tab names do not equal the warehouse names, in three distinct ways —
 * all present in the live workbook:
 *
 *   Lawley       → "Lawley"           exact
 *   Mamelodi     → "Mamelodi Pop1"    warehouse name carries a suffix
 *   Tembelilhle  → "Tembelihle"       the tab is misspelled
 *   Thembisa     → Tembisa 1 | 2 | 3  genuinely ambiguous
 *
 * The last case is why this refuses rather than guesses. Nothing in the names
 * says which Tembisa depot owns those 2,520 serials; picking one would receive
 * them into the wrong warehouse silently, which is worse than not importing
 * them. Ambiguity needs an explicit alias — a human decision, recorded once.
 */

/** The subset of a stock_locations row this resolver needs. */
export interface LocationRef {
  id: string;
  name: string;
}

export type SheetLocationResult =
  | { ok: true; locationId: string; locationName: string; how: 'exact' | 'prefix' | 'fuzzy' | 'alias' }
  | {
      ok: false;
      reason: 'not-a-project' | 'no-match' | 'ambiguous' | 'alias-target-missing';
      candidates?: string[];
    };

/** Tabs that are summaries or documentation, never a project. */
export const NON_PROJECT_SHEETS: readonly string[] = ['info sheet', 'all'];

/**
 * Tabs whose warehouse cannot be derived from the name. Values are warehouse
 * NAMES, not UUIDs, so the ids still come from the database and a renamed or
 * retired warehouse is reported instead of silently mis-routing.
 */
export const SHEET_ALIASES: Record<string, string> = {
  // Three Tembisa depots exist; this workbook's single Thembisa tab has always
  // been received into Tembisa 1 (the previous hardcoded map's choice).
  thembisa: 'Tembisa 1',
  tembisa: 'Tembisa 1',
};

/** Shortest tab name eligible for fuzzy matching — below this an edit budget of 2 is most of the word. */
const MIN_FUZZY_LEN = 6;
const MAX_EDIT_DISTANCE = 2;

function normalise(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
}

/** Levenshtein distance, iterative two-row form. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    prev = row;
  }
  return prev[b.length]!;
}

export function resolveSheetLocation(
  sheetName: string,
  locations: LocationRef[],
  aliases: Record<string, string> = SHEET_ALIASES,
): SheetLocationResult {
  const key = normalise(sheetName);

  if (NON_PROJECT_SHEETS.includes(sheetName.toLowerCase().trim())) {
    return { ok: false, reason: 'not-a-project' };
  }

  // 1. Explicit alias wins — it is a recorded human decision.
  const aliasTarget = aliases[key];
  if (aliasTarget) {
    const target = locations.find((l) => normalise(l.name) === normalise(aliasTarget));
    if (!target) return { ok: false, reason: 'alias-target-missing', candidates: [aliasTarget] };
    return { ok: true, locationId: target.id, locationName: target.name, how: 'alias' };
  }

  // 2. Exact name.
  const exact = locations.filter((l) => normalise(l.name) === key);
  if (exact.length === 1) {
    return { ok: true, locationId: exact[0]!.id, locationName: exact[0]!.name, how: 'exact' };
  }
  if (exact.length > 1) {
    return { ok: false, reason: 'ambiguous', candidates: exact.map((l) => l.name) };
  }

  // 3. The warehouse name starts with the tab name ("Mamelodi" → "Mamelodi Pop1").
  const prefixed = locations.filter((l) => normalise(l.name).startsWith(key) && key.length >= 4);
  if (prefixed.length === 1) {
    return { ok: true, locationId: prefixed[0]!.id, locationName: prefixed[0]!.name, how: 'prefix' };
  }
  if (prefixed.length > 1) {
    return { ok: false, reason: 'ambiguous', candidates: prefixed.map((l) => l.name) };
  }

  // 4. A near-miss spelling, but only for names long enough that two edits are
  //    a typo rather than a different word, and only when one clear winner.
  if (key.length >= MIN_FUZZY_LEN) {
    const scored = locations
      .map((l) => ({ l, d: editDistance(key, normalise(l.name)) }))
      .filter((s) => s.d <= MAX_EDIT_DISTANCE)
      .sort((x, y) => x.d - y.d);

    if (scored.length > 0) {
      const best = scored[0]!;
      const tied = scored.filter((s) => s.d === best.d);
      if (tied.length === 1) {
        return { ok: true, locationId: best.l.id, locationName: best.l.name, how: 'fuzzy' };
      }
      return { ok: false, reason: 'ambiguous', candidates: tied.map((s) => s.l.name) };
    }
  }

  return { ok: false, reason: 'no-match' };
}
