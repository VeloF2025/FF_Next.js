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

import pool from '@/lib/db';

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

function normalizeTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(t => WORD_TO_DIGIT[t] ?? t);
}

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
 * Fetch all projects with an active client_purchase_orders row.
 * Sorted alphabetically for stable dropdown display.
 */
export async function fetchBillableProjects(): Promise<BillableProject[]> {
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
 * Resolve `rawInput` (e.g. "Thembisa POP 1") against billable projects.
 * Exact token-set match wins. If no exact match, any project whose tokens
 * are a superset of the input tokens is returned as a candidate.
 */
export async function resolveProjectName(rawInput: string): Promise<ProjectResolution> {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { matched: false, project: null, candidates: [], rawInput };
  }

  const billable = await fetchBillableProjects();
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

  return {
    matched: false,
    project: null,
    candidates: supersetMatches,
    rawInput,
  };
}
