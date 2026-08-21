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

/** The subset of a row this resolver needs — a stock_location OR a project. */
export interface NamedRef {
  id: string;
  name: string;
}

/** Back-compat alias: warehouses were the original and only target. */
export type LocationRef = NamedRef;

export type SheetLocationResult =
  | { ok: true; locationId: string; locationName: string; how: 'exact' | 'prefix' | 'fuzzy' | 'alias' }
  | {
      ok: false;
      reason: 'not-a-project' | 'no-match' | 'ambiguous' | 'alias-target-missing';
      candidates?: string[];
    };

/**
 * Tabs that are summaries or documentation, never a project.
 *
 * Compared AFTER `normalise()`, same as every other rule — matching on the raw
 * lowercased name instead would let "Info-Sheet" or "ALL " fall through to the
 * matching rules and be reported to ops as lost rows, when it is a tab we
 * ignore on purpose.
 */
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

/**
 * Tab -> PROJECT aliases. Deliberately EMPTY.
 *
 * One tab cannot be resolved to a project from its name and has no answer this
 * code is entitled to invent: `Thembisa` matches Thembisa POP 1, POP 2 and
 * POP 3 equally. It is refused and reported, leaving the allocation unset
 * rather than wrong. Add an entry here only when someone decides what it means.
 *
 * `Tembelilhle` needs no alias: it is a misspelling of `Themb'elihle` (Lenasia,
 * Gauteng) and the fuzzy step resolves it — edit distance 2 after
 * normalisation, next nearest project 8, so a unique winner rather than a coin
 * flip. Its stock is observed INSTALLING on Thembisa POP 1 and Etwatwa, but
 * that is the allocation-vs-reality divergence this module exists to record; it
 * does not make the allocation wrong.
 */
export const PROJECT_ALIASES: Record<string, string> = {};

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

/**
 * Resolve a tab name onto one of `candidates` by name.
 *
 * Used for two different target sets: the WAREHOUSE a tab's stock is held at,
 * and the PROJECT it is allocated to. The rules are identical — the tab names
 * mismatch their targets the same way in both directions — so the logic lives
 * once and takes the candidate list as a parameter.
 */
export function resolveSheetTarget(
  sheetName: string,
  candidates: NamedRef[],
  aliases: Record<string, string> = {},
): SheetLocationResult {
  return resolveAgainst(sheetName, candidates, aliases);
}

export function resolveSheetLocation(
  sheetName: string,
  locations: LocationRef[],
  aliases: Record<string, string> = SHEET_ALIASES,
): SheetLocationResult {
  return resolveAgainst(sheetName, locations, aliases);
}

function resolveAgainst(
  sheetName: string,
  locations: NamedRef[],
  aliases: Record<string, string>,
): SheetLocationResult {
  const key = normalise(sheetName);

  if (NON_PROJECT_SHEETS.some((n) => normalise(n) === key)) {
    return { ok: false, reason: 'not-a-project' };
  }

  // 1. Explicit alias wins — it is a recorded human decision.
  //    NOTE: this deliberately runs before the exact-name check. If a warehouse
  //    is ever literally renamed to a tab name that has an alias, the alias
  //    would still redirect it — revisit this ordering then; today no warehouse
  //    shares a name with an alias key.
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
