/**
 * Pulse · Search query module (PRD-061 Phase A, FR-SEARCH-*).
 *
 * Shared between `/api/staff/attendance-search` (list + totals) and
 * `/api/staff/attendance-search-export` (XLSX/CSV). Centralising the filter
 * parser, scope gate, and SQL builder here keeps the row-level guarantees
 * (every query honours scope, every query parses the same filter shape) in
 * one place — the export route would otherwise drift from the list route
 * the moment one of them learns a new filter.
 *
 * The CLAUDE.md "no conditional sql template fragments" rule applies here.
 * Neon-style tagged templates can't compose, so we build the WHERE as text
 * with $N placeholders + a params array and run via sql.query().
 *
 * Phase A scope and explicit deferrals:
 *   - Filters `staff[]`, `dept[]`, `site[]`, `dateRange`, `dayOfWeek[]`,
 *     `exceptionKinds[]`, `onlyWithOt`, `onlySundayHoliday`, `onlyActive`
 *     are implemented.
 *   - `project[]` and `minLatenessMin` are accepted but no-op'd until
 *     downstream tables (project↔staff link, shift schedules) land. Listed
 *     in PRD §14 / Phase C scope. Documented here so callers don't silently
 *     wonder where the filter went.
 *   - Exception kinds are mapped to the canonical enum used by
 *     `attendance_exceptions.exception_kind` (see migration 310). The
 *     PRD's friendly names (late, no-show, etc.) are aliased; unknown
 *     names are dropped without erroring so the URL contract is forward
 *     compatible.
 */

import { sql } from '@/lib/db-pool';
import { staffIdsSupervisedBy } from './supervisorScope';
import { getStaffIdForUser } from '@/services/staff/staffAccessService';
import type { AuthUser } from '@/lib/auth/types';

/** Hard cap on rows returned by a single Search query — FR-SEARCH-06 / FR-REPORT-COM-03. */
export const MAX_TOTAL_ROWS = 5000;

/** Hard cap on date-range span — FR-SEARCH-13. */
export const MAX_DATE_RANGE_DAYS = 365;

/** Default page size — FR-SEARCH-06. */
export const DEFAULT_PAGE_SIZE = 50;

/** Canonical attendance_exceptions.exception_kind enum (matches migration 310). */
const KNOWN_EXCEPTION_KINDS = new Set([
  'missing_clock_out',
  'geofence_mismatch',
  'clock_skew',
  'out_of_hours',
  'manual_override',
  'duplicate_entry',
  'vehicle_gps_mismatch',
  'forgotten_clock_out_retro',
]);

/**
 * Map PRD-friendly exception names → canonical enum values. The PRD lists
 * names like "geo-mismatch" and "missing-clockout" that don't exist in
 * the enum verbatim. We accept either the PRD spelling or the canonical
 * enum value; anything else is silently dropped.
 *
 * Names without a canonical equivalent today (`late`, `no_show`,
 * `early_out`, `missing_selfie`) are explicitly listed but mapped to
 * `null` so a future Phase C migration can wire them in without changing
 * the public URL contract.
 */
const EXCEPTION_ALIAS: Record<string, string | null> = {
  missing_clock_out: 'missing_clock_out',
  geofence_mismatch: 'geofence_mismatch',
  clock_skew: 'clock_skew',
  out_of_hours: 'out_of_hours',
  manual_override: 'manual_override',
  duplicate_entry: 'duplicate_entry',
  vehicle_gps_mismatch: 'vehicle_gps_mismatch',
  forgotten_clock_out_retro: 'forgotten_clock_out_retro',
  'missing-clockout': 'missing_clock_out',
  'geo-mismatch': 'geofence_mismatch',
  late: null,
  no_show: null,
  'no-show': null,
  'early-out': null,
  'missing-selfie': null,
};

const SORT_FIELDS = new Set(['work_date', 'full_name', 'hours', 'overtime', 'department']);
const SORT_DIRS = new Set(['asc', 'desc']);

/**
 * Server-side filter shape. The querystring parser builds this from
 * `req.query`; the export endpoint imports it from req.body for very
 * long staff[] payloads (FR-SEARCH-01).
 */
export interface SearchFilters {
  staffIds: string[];
  departments: string[];
  siteIds: string[];
  /** Phase C — no-op today, accepted for URL forward-compat. */
  projectIds: string[];
  dateFrom: string; // YYYY-MM-DD, SAST
  dateTo: string;   // YYYY-MM-DD, SAST
  /** 0=Sunday … 6=Saturday (Postgres EXTRACT(DOW) convention). Empty = all days. */
  daysOfWeek: number[];
  /** Canonical enum values only (aliases already resolved by parseFilters). */
  exceptionKinds: string[];
  onlyWithOt: boolean;
  onlySundayHoliday: boolean;
  onlyActive: boolean;
  /** Phase C — no-op today. */
  minLatenessMin: number | null;
}

export interface SearchPagination {
  page: number;
  pageSize: number;
}

export interface SearchSort {
  field: 'work_date' | 'full_name' | 'hours' | 'overtime' | 'department';
  direction: 'asc' | 'desc';
}

export type ScopeNote =
  | { kind: 'orgwide' }
  | { kind: 'scoped'; staffCount: number }
  | { kind: 'no_scope'; reason: string };

export interface ResolvedScope {
  /** Null = no scope filter (super_admin/admin); array = WHERE staff_id = ANY($1). */
  allowedStaffIds: string[] | null;
  note: ScopeNote;
}

export interface SearchRow {
  staff_id: string;
  employee_id: string | null;
  full_name: string;
  department: string | null;
  work_date: string;
  regular_hrs: number;
  overtime_hrs: number;
  sunday_hrs: number;
  holiday_hrs: number;
  night_hrs: number;
  wage_amount_cents: number | null;
  exceptions_count: number;
  exception_kinds: string[];
  first_clock_in_at: string | null;
  last_clock_out_at: string | null;
  primary_site_name: string | null;
  primary_site_id: string | null;
}

export interface SearchTotals {
  rowCount: number;
  distinctStaffCount: number;
  totalRegularHrs: number;
  totalOvertimeHrs: number;
  totalSundayHrs: number;
  totalHolidayHrs: number;
  totalNightHrs: number;
  totalWageCents: number;
  totalExceptionsCount: number;
}

/** Thrown for unrecoverable filter shape issues; route translates to 400. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter((s) => s.length > 0);
  if (typeof v === 'string' && v.length > 0) return v.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

function asNumberArray(v: unknown): number[] {
  return asStringArray(v)
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isFinite(n));
}

function asBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v === '1' || v.toLowerCase() === 'true';
  return false;
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function todayInSast(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** SAST Monday for the calendar week containing `ymd`. */
function isoWeekMondaySast(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  const dow = d.getUTCDay();
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  return addDays(ymd, diffToMonday);
}

function startOfMonth(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

function endOfMonth(ymd: string): string {
  const [y, m] = ymd.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0));
  return last.toISOString().slice(0, 10);
}

export type DatePreset =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month'
  | 'last_7d'
  | 'last_30d'
  | 'custom';

export function resolveDatePreset(preset: DatePreset, today: string = todayInSast()): {
  from: string;
  to: string;
} {
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case 'this_week': {
      const monday = isoWeekMondaySast(today);
      return { from: monday, to: today };
    }
    case 'last_week': {
      const thisMonday = isoWeekMondaySast(today);
      const lastMonday = addDays(thisMonday, -7);
      const lastSunday = addDays(thisMonday, -1);
      return { from: lastMonday, to: lastSunday };
    }
    case 'this_month':
      return { from: startOfMonth(today), to: today };
    case 'last_month': {
      const firstThis = startOfMonth(today);
      const lastPrev = addDays(firstThis, -1);
      return { from: startOfMonth(lastPrev), to: endOfMonth(lastPrev) };
    }
    case 'last_7d':
      return { from: addDays(today, -6), to: today };
    case 'last_30d':
      return { from: addDays(today, -29), to: today };
    case 'custom':
      return { from: today, to: today };
  }
}

export interface RawQuery {
  [k: string]: string | string[] | undefined;
}

export function parseFilters(query: RawQuery): SearchFilters {
  const dateRange = (typeof query.dateRange === 'string' ? query.dateRange : 'this_week') as DatePreset;
  const explicitFrom = typeof query.dateFrom === 'string' ? query.dateFrom : '';
  const explicitTo = typeof query.dateTo === 'string' ? query.dateTo : '';

  let dateFrom: string;
  let dateTo: string;
  if (dateRange === 'custom') {
    if (!YMD_RE.test(explicitFrom) || !YMD_RE.test(explicitTo)) {
      throw new ValidationError(
        'dateRange=custom requires dateFrom and dateTo as YYYY-MM-DD'
      );
    }
    dateFrom = explicitFrom;
    dateTo = explicitTo;
  } else {
    const resolved = resolveDatePreset(dateRange);
    dateFrom = resolved.from;
    dateTo = resolved.to;
  }

  if (dateFrom > dateTo) {
    throw new ValidationError('dateFrom must be on or before dateTo');
  }

  const spanDays =
    Math.floor(
      (Date.parse(`${dateTo}T00:00:00Z`) - Date.parse(`${dateFrom}T00:00:00Z`)) / 86400000
    ) + 1;
  const confirmLongRange = asBool(query.confirmLongRange);
  if (spanDays > MAX_DATE_RANGE_DAYS && !confirmLongRange) {
    throw new ValidationError(
      `Date range spans ${spanDays} days (max ${MAX_DATE_RANGE_DAYS} without confirmLongRange=1)`
    );
  }

  const daysOfWeek = Array.from(
    new Set(asNumberArray(query.daysOfWeek).filter((n) => n >= 0 && n <= 6))
  ).sort();

  const requestedKinds = asStringArray(query.exceptionKinds);
  const canonicalKinds = Array.from(
    new Set(
      requestedKinds
        .map((k) => EXCEPTION_ALIAS[k])
        .filter((k): k is string => typeof k === 'string' && KNOWN_EXCEPTION_KINDS.has(k))
    )
  );

  const minLatenessMinRaw = typeof query.minLatenessMin === 'string'
    ? Number.parseInt(query.minLatenessMin, 10)
    : null;
  const minLatenessMin = Number.isFinite(minLatenessMinRaw as number)
    ? (minLatenessMinRaw as number)
    : null;

  // Validate UUID-shaped fields up front rather than letting the DB reject
  // them with a less helpful "invalid input syntax for type uuid" error.
  const staffIds = asStringArray(query.staffIds).filter((id) => UUID_RE.test(id));
  const siteIds = asStringArray(query.siteIds).filter((id) => UUID_RE.test(id));
  const projectIds = asStringArray(query.projectIds).filter((id) => UUID_RE.test(id));

  return {
    staffIds,
    departments: asStringArray(query.departments),
    siteIds,
    projectIds,
    dateFrom,
    dateTo,
    daysOfWeek,
    exceptionKinds: canonicalKinds,
    onlyWithOt: asBool(query.onlyWithOt),
    onlySundayHoliday: asBool(query.onlySundayHoliday),
    onlyActive: asBool(query.onlyActive),
    minLatenessMin,
  };
}

export function parseSort(query: RawQuery): SearchSort {
  const field = typeof query.sortField === 'string' && SORT_FIELDS.has(query.sortField)
    ? (query.sortField as SearchSort['field'])
    : 'work_date';
  const direction = typeof query.sortDir === 'string' && SORT_DIRS.has(query.sortDir)
    ? (query.sortDir as SearchSort['direction'])
    : 'desc';
  return { field, direction };
}

export function parsePagination(query: RawQuery): SearchPagination {
  const page = Number.parseInt(typeof query.page === 'string' ? query.page : '1', 10);
  const pageSize = Number.parseInt(
    typeof query.pageSize === 'string' ? query.pageSize : String(DEFAULT_PAGE_SIZE),
    10
  );
  return {
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: Number.isFinite(pageSize) && pageSize > 0 ? Math.min(pageSize, MAX_TOTAL_ROWS) : DEFAULT_PAGE_SIZE,
  };
}

/**
 * Resolve the viewer's scope. Super_admin / admin always get the unfiltered
 * org-wide treatment (PRD §3.1, FR-SEARCH-08); every other role's results
 * are intersected with `staffIdsSupervisedBy`. A user without a linked
 * staff record (e.g. an admin user that was never linked to a staff row)
 * gets `no_scope` — empty result, distinct from "your filters matched
 * nothing" so the UI can show the right empty state (FR-SEARCH-12).
 */
export async function resolveScope(user: AuthUser): Promise<ResolvedScope> {
  if (user.role === 'super_admin' || user.role === 'admin') {
    return { allowedStaffIds: null, note: { kind: 'orgwide' } };
  }
  const viewerStaffId = await getStaffIdForUser(user.id);
  if (!viewerStaffId) {
    return {
      allowedStaffIds: [],
      note: {
        kind: 'no_scope',
        reason: 'Your account is not linked to a staff record; no rows in scope.',
      },
    };
  }
  const ids = await staffIdsSupervisedBy(viewerStaffId);
  return {
    allowedStaffIds: ids,
    note: { kind: 'scoped', staffCount: ids.length },
  };
}

/**
 * Intersect user-supplied `filters.staffIds` with the role-derived scope.
 * If the user supplied no staffIds, the scope alone constrains; if they
 * supplied some, we keep only the overlap so a manager can't expand
 * their visibility by listing IDs outside their reports.
 */
function effectiveStaffIds(
  filters: SearchFilters,
  scope: ResolvedScope
): string[] | null {
  if (scope.allowedStaffIds === null) {
    return filters.staffIds.length > 0 ? filters.staffIds : null;
  }
  if (filters.staffIds.length === 0) return scope.allowedStaffIds;
  const allowed = new Set(scope.allowedStaffIds);
  return filters.staffIds.filter((id) => allowed.has(id));
}

interface BuiltWhere {
  /** Final SQL clause text without the leading WHERE keyword. */
  text: string;
  params: unknown[];
}

/**
 * Build the WHERE clause as $-bound text. Returned `text` always starts
 * with the date-range predicates, so it is never empty — callers can safely
 * inline with `WHERE ${text}`. Subsequent predicates are AND-joined; absent
 * filters are skipped entirely (no `AND TRUE` padding).
 */
function buildBaseWhere(
  filters: SearchFilters,
  scopedStaffIds: string[] | null
): BuiltWhere {
  const parts: string[] = [];
  const params: unknown[] = [];
  const next = () => `$${params.length + 1}`;

  params.push(filters.dateFrom);
  parts.push(`ds.work_date >= ${next()}::date`);

  params.push(filters.dateTo);
  parts.push(`ds.work_date <= $${params.length}::date`);

  if (scopedStaffIds !== null) {
    params.push(scopedStaffIds);
    parts.push(`ds.staff_id = ANY($${params.length}::uuid[])`);
  }
  if (filters.departments.length > 0) {
    params.push(filters.departments);
    parts.push(`s.department = ANY($${params.length}::text[])`);
  }
  if (filters.daysOfWeek.length > 0) {
    params.push(filters.daysOfWeek);
    parts.push(`EXTRACT(DOW FROM ds.work_date)::int = ANY($${params.length}::int[])`);
  }
  if (filters.onlyWithOt) {
    parts.push(`ds.overtime_hrs > 0`);
  }
  if (filters.onlySundayHoliday) {
    parts.push(`(ds.sunday_hrs > 0 OR ds.holiday_hrs > 0)`);
  }
  if (filters.onlyActive) {
    // is_active is the soft-flag; end_date is the hard termination date.
    // Either being set rules a staff member out for "active staff today".
    parts.push(`(s.is_active = true OR s.is_active IS NULL) AND s.end_date IS NULL`);
  }
  if (filters.siteIds.length > 0) {
    params.push(filters.siteIds);
    parts.push(`EXISTS (
      SELECT 1 FROM attendance_entries e
      WHERE e.staff_id = ds.staff_id
        AND e.work_date = ds.work_date
        AND e.site_geofence_id = ANY($${params.length}::uuid[])
    )`);
  }
  if (filters.exceptionKinds.length > 0) {
    // Match only unresolved exceptions — a day whose only exception was
    // resolved should not surface in a "show me geo-mismatch days" filter.
    params.push(filters.exceptionKinds);
    parts.push(`EXISTS (
      SELECT 1 FROM attendance_exceptions x
      JOIN attendance_entries xe ON xe.id = x.entry_id
      WHERE xe.staff_id = ds.staff_id
        AND xe.work_date = ds.work_date
        AND x.resolved_at IS NULL
        AND x.exception_kind = ANY($${params.length}::text[])
    )`);
  }

  return { text: parts.join('\n  AND '), params };
}

function orderByClauseSql(sort: SearchSort): string {
  const dir = sort.direction === 'asc' ? 'ASC' : 'DESC';
  switch (sort.field) {
    case 'work_date':
      return `ORDER BY ds.work_date ${dir}, full_name ASC`;
    case 'full_name':
      return `ORDER BY full_name ${dir}, ds.work_date DESC`;
    case 'hours':
      return `ORDER BY (ds.regular_hrs + ds.overtime_hrs) ${dir}, ds.work_date DESC`;
    case 'overtime':
      return `ORDER BY ds.overtime_hrs ${dir}, ds.work_date DESC`;
    case 'department':
      return `ORDER BY s.department ${dir} NULLS LAST, full_name ASC`;
  }
}

interface RowQueryResult extends Record<string, unknown> {
  staff_id: string;
  employee_id: string | null;
  full_name: string;
  department: string | null;
  work_date: string;
  regular_hrs: string;
  overtime_hrs: string;
  sunday_hrs: string;
  holiday_hrs: string;
  night_hrs: string;
  wage_amount_cents: string | null;
  exceptions_count: number;
  exception_kinds: string[] | null;
  first_clock_in_at: string | null;
  last_clock_out_at: string | null;
  primary_site_id: string | null;
  primary_site_name: string | null;
}

async function runCountQuery(
  filters: SearchFilters,
  scopedStaffIds: string[] | null
): Promise<number> {
  const where = buildBaseWhere(filters, scopedStaffIds);
  const text = `
    SELECT COUNT(*)::int AS count
    FROM attendance_daily_summaries ds
    JOIN staff s ON s.id = ds.staff_id
    WHERE ${where.text}
  `;
  const rows = await sql.query<{ count: number }>(text, where.params);
  return rows[0]?.count ?? 0;
}

async function runTotalsQuery(
  filters: SearchFilters,
  scopedStaffIds: string[] | null
): Promise<SearchTotals> {
  const where = buildBaseWhere(filters, scopedStaffIds);
  const text = `
    SELECT
      COUNT(*)::int                                AS row_count,
      COUNT(DISTINCT ds.staff_id)::int             AS distinct_staff_count,
      COALESCE(SUM(ds.regular_hrs),  0)::text      AS total_regular_hrs,
      COALESCE(SUM(ds.overtime_hrs), 0)::text      AS total_overtime_hrs,
      COALESCE(SUM(ds.sunday_hrs),   0)::text      AS total_sunday_hrs,
      COALESCE(SUM(ds.holiday_hrs),  0)::text      AS total_holiday_hrs,
      COALESCE(SUM(ds.night_hrs),    0)::text      AS total_night_hrs,
      COALESCE(SUM(ds.wage_amount_cents), 0)::text AS total_wage_cents,
      COALESCE(SUM((
        SELECT COUNT(*) FROM attendance_exceptions x
        JOIN attendance_entries xe ON xe.id = x.entry_id
        WHERE xe.staff_id = ds.staff_id
          AND xe.work_date = ds.work_date
          AND x.resolved_at IS NULL
      )), 0)::int                                  AS total_exceptions_count
    FROM attendance_daily_summaries ds
    JOIN staff s ON s.id = ds.staff_id
    WHERE ${where.text}
  `;
  const rows = await sql.query<{
    row_count: number;
    distinct_staff_count: number;
    total_regular_hrs: string;
    total_overtime_hrs: string;
    total_sunday_hrs: string;
    total_holiday_hrs: string;
    total_night_hrs: string;
    total_wage_cents: string | null;
    total_exceptions_count: number;
  }>(text, where.params);
  const r = rows[0];
  return {
    rowCount: r?.row_count ?? 0,
    distinctStaffCount: r?.distinct_staff_count ?? 0,
    totalRegularHrs: Number(r?.total_regular_hrs ?? 0),
    totalOvertimeHrs: Number(r?.total_overtime_hrs ?? 0),
    totalSundayHrs: Number(r?.total_sunday_hrs ?? 0),
    totalHolidayHrs: Number(r?.total_holiday_hrs ?? 0),
    totalNightHrs: Number(r?.total_night_hrs ?? 0),
    totalWageCents: Number(r?.total_wage_cents ?? 0),
    totalExceptionsCount: r?.total_exceptions_count ?? 0,
  };
}

async function runRowsQuery(
  filters: SearchFilters,
  scopedStaffIds: string[] | null,
  sort: SearchSort,
  offset: number,
  limit: number
): Promise<SearchRow[]> {
  const where = buildBaseWhere(filters, scopedStaffIds);
  const orderBy = orderByClauseSql(sort);
  // Limit and offset are appended as the last two params so the call site
  // can read the binding order at a glance.
  const params = [...where.params, limit, offset];
  const limitIdx = where.params.length + 1;
  const offsetIdx = where.params.length + 2;
  const text = `
    WITH days AS (
      SELECT
        ds.staff_id,
        ds.work_date,
        ds.regular_hrs::text  AS regular_hrs,
        ds.overtime_hrs::text AS overtime_hrs,
        ds.sunday_hrs::text   AS sunday_hrs,
        ds.holiday_hrs::text  AS holiday_hrs,
        ds.night_hrs::text    AS night_hrs,
        ds.wage_amount_cents::text AS wage_amount_cents,
        s.employee_id,
        s.department,
        TRIM(COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, '')) AS full_name
      FROM attendance_daily_summaries ds
      JOIN staff s ON s.id = ds.staff_id
      WHERE ${where.text}
    ),
    day_entry_agg AS (
      SELECT
        e.staff_id,
        e.work_date,
        MIN(e.clock_in_at)  AS first_clock_in_at,
        MAX(e.clock_out_at) AS last_clock_out_at,
        (ARRAY_AGG(e.site_geofence_id) FILTER (WHERE e.site_geofence_id IS NOT NULL))[1] AS primary_site_id
      FROM attendance_entries e
      JOIN days d ON d.staff_id = e.staff_id AND d.work_date = e.work_date
      GROUP BY e.staff_id, e.work_date
    ),
    day_exception_agg AS (
      -- Outstanding exceptions only — resolved ones drop out of the badge so
      -- a supervisor sees the queue length, not the cumulative history.
      SELECT
        xe.staff_id,
        xe.work_date,
        COUNT(*)::int AS exceptions_count,
        ARRAY_AGG(DISTINCT x.exception_kind ORDER BY x.exception_kind) AS exception_kinds
      FROM attendance_exceptions x
      JOIN attendance_entries xe ON xe.id = x.entry_id
      JOIN days d ON d.staff_id = xe.staff_id AND d.work_date = xe.work_date
      WHERE x.resolved_at IS NULL
      GROUP BY xe.staff_id, xe.work_date
    )
    SELECT
      d.staff_id,
      d.employee_id,
      d.full_name,
      d.department,
      d.work_date::text AS work_date,
      d.regular_hrs,
      d.overtime_hrs,
      d.sunday_hrs,
      d.holiday_hrs,
      d.night_hrs,
      d.wage_amount_cents,
      COALESCE(dx.exceptions_count, 0) AS exceptions_count,
      COALESCE(dx.exception_kinds, ARRAY[]::text[]) AS exception_kinds,
      de.first_clock_in_at::text AS first_clock_in_at,
      de.last_clock_out_at::text AS last_clock_out_at,
      de.primary_site_id::text   AS primary_site_id,
      site.name                  AS primary_site_name
    FROM days d
    JOIN attendance_daily_summaries ds ON ds.staff_id = d.staff_id AND ds.work_date = d.work_date
    JOIN staff s                       ON s.id = d.staff_id
    LEFT JOIN day_entry_agg     de ON de.staff_id = d.staff_id AND de.work_date = d.work_date
    LEFT JOIN day_exception_agg dx ON dx.staff_id = d.staff_id AND dx.work_date = d.work_date
    LEFT JOIN fleet_authorized_locations site ON site.id = de.primary_site_id
    ${orderBy}
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;
  const rows = await sql.query<RowQueryResult>(text, params);
  return rows.map((r) => ({
    staff_id: r.staff_id,
    employee_id: r.employee_id,
    full_name: r.full_name,
    department: r.department,
    work_date: r.work_date,
    regular_hrs: Number(r.regular_hrs),
    overtime_hrs: Number(r.overtime_hrs),
    sunday_hrs: Number(r.sunday_hrs),
    holiday_hrs: Number(r.holiday_hrs),
    night_hrs: Number(r.night_hrs),
    wage_amount_cents: r.wage_amount_cents === null ? null : Number(r.wage_amount_cents),
    exceptions_count: r.exceptions_count,
    exception_kinds: r.exception_kinds ?? [],
    first_clock_in_at: r.first_clock_in_at,
    last_clock_out_at: r.last_clock_out_at,
    primary_site_id: r.primary_site_id,
    primary_site_name: r.primary_site_name,
  }));
}

interface ScopeParts {
  hasAnyStaff: boolean;
  scopedStaffIds: string[] | null;
}

function buildScopeParts(filters: SearchFilters, scope: ResolvedScope): ScopeParts {
  const ids = effectiveStaffIds(filters, scope);
  if (ids === null) return { hasAnyStaff: true, scopedStaffIds: null };
  return { hasAnyStaff: ids.length > 0, scopedStaffIds: ids };
}

const EMPTY_TOTALS: SearchTotals = {
  rowCount: 0,
  distinctStaffCount: 0,
  totalRegularHrs: 0,
  totalOvertimeHrs: 0,
  totalSundayHrs: 0,
  totalHolidayHrs: 0,
  totalNightHrs: 0,
  totalWageCents: 0,
  totalExceptionsCount: 0,
};

/**
 * Run the paginated search. Returns rows + totals strip + scope note.
 * Filter, scope, and sort are pre-validated by the parse* helpers — this
 * function does no further validation and trusts its inputs.
 */
export async function runSearch(opts: {
  filters: SearchFilters;
  scope: ResolvedScope;
  pagination: SearchPagination;
  sort: SearchSort;
}): Promise<{
  rows: SearchRow[];
  totals: SearchTotals;
  scopeNote: ScopeNote;
  pagination: { page: number; pageSize: number; totalRows: number; hasMore: boolean };
}> {
  const { filters, scope, pagination, sort } = opts;
  const { hasAnyStaff, scopedStaffIds } = buildScopeParts(filters, scope);

  if (!hasAnyStaff) {
    return {
      rows: [],
      totals: EMPTY_TOTALS,
      scopeNote: scope.note,
      pagination: { ...pagination, totalRows: 0, hasMore: false },
    };
  }

  const offset = (pagination.page - 1) * pagination.pageSize;
  const limit = Math.min(pagination.pageSize, MAX_TOTAL_ROWS);

  const totalRows = await runCountQuery(filters, scopedStaffIds);
  if (totalRows === 0) {
    return {
      rows: [],
      totals: EMPTY_TOTALS,
      scopeNote: scope.note,
      pagination: { ...pagination, totalRows: 0, hasMore: false },
    };
  }

  const [rows, totals] = await Promise.all([
    runRowsQuery(filters, scopedStaffIds, sort, offset, limit),
    runTotalsQuery(filters, scopedStaffIds),
  ]);

  return {
    rows,
    totals,
    scopeNote: scope.note,
    pagination: {
      ...pagination,
      totalRows,
      hasMore: offset + rows.length < totalRows,
    },
  };
}

/**
 * Variant of runSearch for export — no pagination, returns up to
 * MAX_TOTAL_ROWS rows. The export endpoint streams to XLSX/CSV; capping
 * at 5000 keeps memory bounded (FR-REPORT-COM-03 ceiling for reports;
 * Search reuses the same number).
 */
export async function runSearchForExport(opts: {
  filters: SearchFilters;
  scope: ResolvedScope;
  sort: SearchSort;
}): Promise<{
  rows: SearchRow[];
  totals: SearchTotals;
  scopeNote: ScopeNote;
  rowsTruncated: boolean;
}> {
  const { filters, scope, sort } = opts;
  const { hasAnyStaff, scopedStaffIds } = buildScopeParts(filters, scope);

  if (!hasAnyStaff) {
    return {
      rows: [],
      totals: EMPTY_TOTALS,
      scopeNote: scope.note,
      rowsTruncated: false,
    };
  }

  const totalRows = await runCountQuery(filters, scopedStaffIds);
  const cap = MAX_TOTAL_ROWS;
  const [rows, totals] = await Promise.all([
    runRowsQuery(filters, scopedStaffIds, sort, 0, cap),
    runTotalsQuery(filters, scopedStaffIds),
  ]);
  return {
    rows,
    totals,
    scopeNote: scope.note,
    rowsTruncated: totalRows > cap,
  };
}
