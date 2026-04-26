/**
 * Pulse · Reports — runner / dispatcher (PRD-061 Phase C).
 *
 * Single entry point that the API route calls. Owns:
 *   - Filter parsing (date range / month / dept / sites / staff hints)
 *   - Scope resolution (re-uses Phase A's resolveScope) — admins org-wide,
 *     others narrowed via staffIdsSupervisedBy.
 *   - 50 000-row cap (FR-REPORT-COM-03) — anything that returns more than
 *     this throws ReportTooLargeError so the route can map it to a 413.
 *   - Run telemetry log (FR-REPORT-COM-02).
 *   - Dispatch by slug to the right module.
 *
 * Each report module exports a pure `runReport(input)` query function;
 * the runner is the only place that touches scope + telemetry, so a new
 * report only worries about its SQL.
 */

import type { AuthUser } from '@/lib/auth/types';
import { log } from '@/lib/logger';
import {
  resolveScope,
  type RawQuery,
} from '../searchQueries';
import {
  ALL_REPORT_SLUGS,
  type ReportInput,
  type ReportRunResult,
  type ReportSlug,
} from './types';
import { runMonthlyTotals } from './monthlyTotals';
import { runGeoMismatch } from './geoMismatch';
import { runOtTrend } from './otTrend';
import { runDeptRollup } from './deptRollup';
import { runWageCost } from './wageCost';
import { runBceaPremium } from './bceaPremium';

export const REPORT_ROW_CAP = 50_000;

export class ReportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReportValidationError';
  }
}
export class ReportTooLargeError extends Error {
  readonly rowCount: number;
  constructor(rowCount: number) {
    super(`Result has ${rowCount} rows; over the ${REPORT_ROW_CAP} cap. Narrow your filters.`);
    this.name = 'ReportTooLargeError';
    this.rowCount = rowCount;
  }
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const YM_RE = /^\d{4}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter((s) => s.length > 0);
  if (typeof v === 'string' && v.length > 0) return v.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

function todayInSast(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function lastCompletedMonth(): string {
  const today = todayInSast();
  const [y, m] = today.slice(0, 7).split('-').map(Number) as [number, number];
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, '0')}`;
}

function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const from = `${month}-01`;
  const last = new Date(Date.UTC(y, m, 0));
  return { from, to: last.toISOString().slice(0, 10) };
}

export function isReportSlug(s: string): s is ReportSlug {
  return (ALL_REPORT_SLUGS as readonly string[]).includes(s);
}

/**
 * Parse the querystring into a `ReportInput`. Each report tolerates
 * absent fields it doesn't care about; this parser is permissive on
 * shape and validates only what every report needs (UUIDs as UUIDs,
 * dates as YYYY-MM-DD, months as YYYY-MM).
 */
export async function parseAndScopeInput(
  query: RawQuery,
  user: AuthUser,
  slug: ReportSlug
): Promise<ReportInput> {
  const monthRaw = typeof query.month === 'string' ? query.month : '';
  const month = monthRaw && YM_RE.test(monthRaw)
    ? monthRaw
    : (slug === 'monthly-totals' ? lastCompletedMonth() : undefined);

  let dateFrom = typeof query.dateFrom === 'string' ? query.dateFrom : '';
  let dateTo = typeof query.dateTo === 'string' ? query.dateTo : '';
  if (!YMD_RE.test(dateFrom)) dateFrom = '';
  if (!YMD_RE.test(dateTo)) dateTo = '';

  /** Resolve a `?dateRange=` shorthand to concrete SAST bounds. */
  const dateRange = typeof query.dateRange === 'string' ? query.dateRange : '';
  const today = todayInSast();
  if (dateRange && !dateFrom && !dateTo) {
    const offsetDay = (offset: number) => {
      const x = new Date(`${today}T00:00:00Z`);
      x.setUTCDate(x.getUTCDate() + offset);
      return x.toISOString().slice(0, 10);
    };
    switch (dateRange) {
      case 'this_month':
        dateFrom = `${today.slice(0, 7)}-01`;
        dateTo = today;
        break;
      case 'last_month': {
        const [y, m] = today.slice(0, 7).split('-').map(Number) as [number, number];
        const prevMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
        const b = monthBounds(prevMonth);
        dateFrom = b.from;
        dateTo = b.to;
        break;
      }
      case 'last_30d':
        dateFrom = offsetDay(-29);
        dateTo = today;
        break;
      case 'last_7d':
        dateFrom = offsetDay(-6);
        dateTo = today;
        break;
      case 'last_12_weeks':
        dateFrom = offsetDay(-(12 * 7 - 1));
        dateTo = today;
        break;
      case 'custom':
      default:
        // 'custom': caller sent dateFrom + dateTo already.
        // unknown: per-slug defaults below take over.
        break;
    }
  }

  // monthly-totals: derive from month
  if (slug === 'monthly-totals' && month) {
    const b = monthBounds(month);
    dateFrom = b.from;
    dateTo = b.to;
  }
  // ot-trend: ALWAYS last 12 weeks regardless of input (FR-REPORT-OT-01)
  if (slug === 'ot-trend') {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 12 * 7 + 1);
    dateFrom = d.toISOString().slice(0, 10);
    dateTo = today;
  }
  // Default to last 30 days if a report needs a date range and didn't get one.
  const needsRange = slug !== 'monthly-totals' && slug !== 'ot-trend';
  if (needsRange && (!dateFrom || !dateTo)) {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 29);
    dateFrom = d.toISOString().slice(0, 10);
    dateTo = today;
  }
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new ReportValidationError('dateFrom must be on or before dateTo');
  }

  const departments = asStringArray(query.departments);
  const siteIds = asStringArray(query.siteIds).filter((id) => UUID_RE.test(id));
  const staffIdsHint = asStringArray(query.staffIds).filter((id) => UUID_RE.test(id));
  const groupBy = typeof query.groupBy === 'string' ? query.groupBy : undefined;

  const scope = await resolveScope(user);
  let scopedStaffIds: string[] | null;
  let hasAnyStaff: boolean;
  if (scope.allowedStaffIds === null) {
    // Org-wide; honour the user's typed list if any.
    scopedStaffIds = staffIdsHint.length > 0 ? staffIdsHint : null;
    hasAnyStaff = true;
  } else {
    if (staffIdsHint.length === 0) {
      scopedStaffIds = scope.allowedStaffIds;
    } else {
      const allowed = new Set(scope.allowedStaffIds);
      scopedStaffIds = staffIdsHint.filter((id) => allowed.has(id));
    }
    hasAnyStaff = scopedStaffIds !== null && scopedStaffIds.length > 0;
  }

  return {
    scope,
    scopedStaffIds,
    hasAnyStaff,
    month,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    departments,
    siteIds,
    staffIdsHint,
    groupBy,
  };
}

const DISPATCH: Record<ReportSlug, (input: ReportInput) => Promise<ReportRunResult>> = {
  'monthly-totals': runMonthlyTotals,
  'geo-mismatch':   runGeoMismatch,
  'ot-trend':       runOtTrend,
  'dept-rollup':    runDeptRollup,
  'wage-cost':      runWageCost,
  'bcea-premium':   runBceaPremium,
};

/**
 * Run a report. Logs telemetry whether the run succeeds or throws; emits
 * a `ReportTooLargeError` if the result blows past the 50k cap so the
 * caller can convert to 413. The cap is an upper bound on the row array
 * the per-report module returns — it does NOT limit intermediate query
 * row counts (those are the report's own concern).
 */
export async function runReport(
  slug: ReportSlug,
  input: ReportInput,
  user: AuthUser
): Promise<ReportRunResult> {
  const startedAt = Date.now();
  let rowCount = 0;
  let errorMsg: string | null = null;
  try {
    if (!input.hasAnyStaff) {
      const empty = { rows: [], columns: [], notes: ['No staff in scope.'] };
      rowCount = 0;
      return empty;
    }
    const result = await DISPATCH[slug](input);
    rowCount = result.rows.length;
    if (rowCount > REPORT_ROW_CAP) {
      throw new ReportTooLargeError(rowCount);
    }
    return result;
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    const durationMs = Date.now() - startedAt;
    // FR-REPORT-COM-02 — telemetry sink is the standard logger today.
    // params_json is bounded — we strip the scope object to keep the line
    // grep-able, and we never log staff IDs (privacy).
    log.info('[pulse-report] run', {
      userId: user.id,
      role: user.role,
      slug,
      rowCount,
      durationMs,
      params: {
        month: input.month,
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        deptCount: input.departments.length,
        siteCount: input.siteIds.length,
        groupBy: input.groupBy,
      },
      error: errorMsg,
    });
  }
}
