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
    params.push(`%${search}%`);
    const i = params.length;
    conditions.push(
      `(drop_number ILIKE $${i} OR wa_serial ILIKE $${i} OR oes_serial ILIKE $${i} OR onemap_serial ILIKE $${i} OR drops_serial ILIKE $${i})`
    );
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return { whereClause, params, page, pageSize, offset };
}

export const LEDGER_COLUMNS = `
  drop_number, project,
  wa_serial, oes_serial, onemap_serial, drops_serial, distinct_serial_count,
  wa_submitted_at, has_wa_submission, has_oes_activation,
  activation_status, oes_status, oes_activated_at,
  payment_status, latest_deduction_week, latest_deduction_note, deduction_verdict,
  onemap_fix_status, onemap_mismatch_ticket_id, is_offline,
  recon_class`;
