/**
 * Resolve a project name parsed from a FiberTime PDF filename against the
 * FibreFlow `projects` table, scoped to projects that have an active
 * client_purchase_orders row (i.e. projects that are actually billable).
 *
 * Strategy: normalize both sides (lowercase, strip punctuation, digit-words
 * like "one" → "1") and compare token sets. Exact equality wins; otherwise
 * all candidates whose tokens are a superset of the parsed tokens are
 * returned so the caller can disambiguate.
 */

export interface BillableProject {
  id: string;
  name: string;
}

export interface ProjectResolution {
  /** True when exactly one project matched unambiguously. */
  matched: boolean;
  /** The canonical project (name + id) when matched=true. */
  project: BillableProject | null;
  /** Candidate list when matched=false (empty when zero matches). */
  candidates: BillableProject[];
  /** The raw parsed string (for error messages). */
  rawInput: string;
}

const WORD_TO_DIGIT: Record<string, string> = {
  one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
};

/**
 * Tokenize a project name into a normalized comparable form.
 *
 * Handles the real-world naming variants seen in FiberTime filenames:
 * - `POP01` / `POP1` / `POP 1` all collapse to `[pop, 1]`
 * - `Thembisa POP 1` and `Tembisa POP01` produce the same non-spelling tokens
 * - Leading zeros on numeric suffixes are stripped (`01` → `1`)
 * - Word-form digits are mapped (`one` → `1`)
 */
function normalizeTokens(s: string): string[] {
  return s
    .toLowerCase()
    // Insert a space at every letter↔digit boundary so "pop01" → "pop 01"
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    // Collapse any non-alphanumeric to spaces
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(t => WORD_TO_DIGIT[t] ?? t)
    // Strip leading zeros from numeric tokens (01 → 1, 007 → 7)
    .map(t => /^0\d+$/.test(t) ? t.replace(/^0+/, '') || '0' : t);
}

/** Levenshtein edit distance — small and iterative, no dep. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev: number[] = new Array(b.length + 1).fill(0).map((_, i) => i);
  const curr: number[] = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        (curr[j - 1] ?? 0) + 1,
        (prev[j] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j] ?? 0;
  }
  return prev[b.length] ?? 0;
}

/**
 * Maximum edit distance allowed per token when looking for a fuzzy match.
 * A value of 2 catches real-world variants like `Tembisa` ↔ `Thembisa`
 * (distance 1) without collapsing unrelated short names.
 */
const FUZZY_TOKEN_DISTANCE = 2;

function tokensEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sorted = (xs: string[]) => [...xs].sort();
  const sa = sorted(a);
  const sb = sorted(b);
  return sa.every((v, i) => v === sb[i]);
}

function tokensSubset(sub: string[], sup: string[]): boolean {
  const supSet = new Set(sup);
  return sub.length > 0 && sub.every(t => supSet.has(t));
}

/**
 * Fuzzy token-set match: every token in `sub` has at least one partner in
 * `sup` whose edit distance is ≤ FUZZY_TOKEN_DISTANCE. Numeric tokens must
 * match exactly — we don't want `1` to fuzzy-match `2`.
 */
function tokensFuzzySubset(sub: string[], sup: string[]): boolean {
  if (sub.length === 0) return false;
  return sub.every(t => {
    if (/^\d+$/.test(t)) return sup.includes(t);
    return sup.some(u => {
      if (/^\d+$/.test(u)) return false;
      return editDistance(t, u) <= FUZZY_TOKEN_DISTANCE;
    });
  });
}

/**
 * Fetch all projects with an active client_purchase_orders row.
 * Sorted alphabetically for stable dropdown display.
 */
export async function fetchBillableProjects(): Promise<BillableProject[]> {
  // Lazy import so pure-function consumers (and unit tests) don't pay the
  // cost of loading the Neon driver at module init.
  const { default: pool } = await import('@/lib/db');
  const result = await pool.query<{ id: string; project_name: string }>(
    `SELECT DISTINCT p.id, p.project_name
       FROM projects p
       JOIN client_purchase_orders cpo ON cpo.project_id = p.id
      WHERE cpo.status = 'active'
      ORDER BY p.project_name ASC`,
  );
  return result.rows.map(r => ({ id: r.id, name: r.project_name }));
}

/**
 * Pure resolution logic — no DB access. Exported for unit tests.
 *
 * Strategy, in order of preference:
 *   1. Exact normalized token-set match
 *   2. Token-subset match (input tokens are a subset of candidate tokens)
 *   3. Fuzzy token-subset match (per-token edit distance ≤ 2, digits exact)
 */
export function resolveProjectNameAgainst(
  rawInput: string,
  billable: BillableProject[],
): ProjectResolution {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { matched: false, project: null, candidates: [], rawInput };
  }

  const inputTokens = normalizeTokens(trimmed);

  const exactMatches = billable.filter(p => tokensEqual(normalizeTokens(p.name), inputTokens));
  if (exactMatches.length === 1) {
    return { matched: true, project: exactMatches[0]!, candidates: [], rawInput };
  }
  if (exactMatches.length > 1) {
    return { matched: false, project: null, candidates: exactMatches, rawInput };
  }

  const supersetMatches = billable.filter(p =>
    tokensSubset(inputTokens, normalizeTokens(p.name)),
  );
  if (supersetMatches.length === 1) {
    return { matched: true, project: supersetMatches[0]!, candidates: [], rawInput };
  }
  if (supersetMatches.length > 1) {
    return { matched: false, project: null, candidates: supersetMatches, rawInput };
  }

  // Fuzzy fallback: tolerate single-character spelling variants like
  // "Tembisa" ↔ "Thembisa". Numeric tokens still must match exactly.
  const fuzzyMatches = billable.filter(p =>
    tokensFuzzySubset(inputTokens, normalizeTokens(p.name)),
  );
  if (fuzzyMatches.length === 1) {
    return { matched: true, project: fuzzyMatches[0]!, candidates: [], rawInput };
  }

  return {
    matched: false,
    project: null,
    candidates: fuzzyMatches,
    rawInput,
  };
}

/**
 * DB-backed variant: fetches the live billable project list and delegates
 * to {@link resolveProjectNameAgainst}. This is the production entry point.
 */
export async function resolveProjectName(rawInput: string): Promise<ProjectResolution> {
  const billable = await fetchBillableProjects();
  return resolveProjectNameAgainst(rawInput, billable);
}
