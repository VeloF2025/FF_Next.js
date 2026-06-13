/**
 * Pure query-builder for the per-DR three-way reconciliation ledger
 * (v_dr_reconciliation_ledger, migration 414). Extracted from the API handler so
 * the filter/pagination/param-binding logic is unit-testable without a DB.
 *
 * Every user value is BOUND as a parameter — nothing is interpolated into SQL.
 */

export const RECON_CLASSES = [
  'serial_other_dr',
  'wa_no_oes',
  'oes_no_1map',
  'deducted_but_active',
  'all_agree',
  'no_evidence',
] as const;

export type ReconClass = (typeof RECON_CLASSES)[number];

/**
 * One row of v_dr_reconciliation_ledger. Canonical home is this pure module (no
 * React/server deps → bundle-safe); the data-sync types barrel re-exports it.
 */
export interface ReconLedgerRow {
  drop_number: string;
  project: string | null;
  /** WA leg used by recon: scanned serial, falling back to the typed serial (rec #5). */
  wa_serial: string | null;
  /** Raw serial parsed from wa_original_text (rec #5); shown even when a scan exists. */
  wa_typed_serial: string | null;
  /** Which source `wa_serial` came from. */
  wa_serial_source: 'scanned' | 'typed' | null;
  oes_serial: string | null;
  onemap_serial: string | null;
  drops_serial: string | null;
  distinct_serial_count: number;
  wa_submitted_at: string | null;
  has_wa_submission: boolean;
  has_oes_activation: boolean;
  activation_status: string | null;
  oes_status: string | null;
  oes_activated_at: string | null;
  payment_status: string | null;
  latest_deduction_week: string | null;
  latest_deduction_note: string | null;
  deduction_verdict: string | null;
  onemap_fix_status: string | null;
  onemap_mismatch_ticket_id: string | null;
  is_offline: boolean | null;
  recon_class: ReconClass;
}

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;

export interface LedgerQueryInput {
  recon_class?: string | string[];
  project?: string | string[];
  search?: string | string[];
  page?: string | string[];
  pageSize?: string | string[];
}

export interface LedgerQuery {
  whereClause: string;
  params: string[];
  page: number;
  pageSize: number;
  offset: number;
}

function firstStr(v: string | string[] | undefined): string | null {
  if (v === undefined) return null;
  const s = Array.isArray(v) ? v[0] : v;
  return s === undefined ? null : String(s);
}

function parseIntClamped(v: string | null, def: number, min: number, max: number): number {
  const n = parseInt(String(v ?? ''), 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

/**
 * Build the parameterised WHERE clause + pagination for a ledger query.
 * Unknown recon_class values are ignored (treated as "no class filter") rather
 * than rejected, so a stale bookmark never 400s.
 */
export function buildLedgerQuery(input: LedgerQueryInput): LedgerQuery {
  const page = parseIntClamped(firstStr(input.page), 1, 1, Number.MAX_SAFE_INTEGER);
  const pageSize = parseIntClamped(firstStr(input.pageSize), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  const params: string[] = [];

  const reconClass = firstStr(input.recon_class);
  if (reconClass && (RECON_CLASSES as readonly string[]).includes(reconClass)) {
    params.push(reconClass);
    conditions.push(`recon_class = $${params.length}`);
  }

  const project = firstStr(input.project)?.trim();
  if (project) {
    params.push(project);
    conditions.push(`project = $${params.length}`);
  }

  const search = firstStr(input.search)?.trim();
  if (search) {
    // Escape LIKE wildcards so a literal '%'/'_' in the query matches literally
    // rather than broadening the result set (backslash is Postgres' default LIKE
    // escape char; the value is still bound, never interpolated).
    const escaped = search.replace(/[\\%_]/g, '\\$&');
    params.push(`%${escaped}%`);
    const i = params.length;
    conditions.push(
      `(drop_number ILIKE $${i} OR wa_serial ILIKE $${i} OR wa_typed_serial ILIKE $${i} OR oes_serial ILIKE $${i} OR onemap_serial ILIKE $${i} OR drops_serial ILIKE $${i})`
    );
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return { whereClause, params, page, pageSize, offset };
}

export const LEDGER_COLUMNS = `
  drop_number, project,
  wa_serial, wa_typed_serial, wa_serial_source, oes_serial, onemap_serial, drops_serial, distinct_serial_count,
  wa_submitted_at, has_wa_submission, has_oes_activation,
  activation_status, oes_status, oes_activated_at,
  payment_status, latest_deduction_week, latest_deduction_note, deduction_verdict,
  onemap_fix_status, onemap_mismatch_ticket_id, is_offline,
  recon_class`;
