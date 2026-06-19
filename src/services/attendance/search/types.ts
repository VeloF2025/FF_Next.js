/**
 * Pulse · Search — shared server-side types and constants.
 *
 * Imported by parse.ts, scope.ts, buildWhere.ts, and runQueries.ts.
 * The top-level `searchQueries.ts` barrel re-exports everything from here
 * so existing callers keep their import paths unchanged.
 */

/** Hard cap on rows returned by a single Search query — FR-SEARCH-06 / FR-REPORT-COM-03. */
export const MAX_TOTAL_ROWS = 5000;

/** Hard cap on date-range span — FR-SEARCH-13. */
export const MAX_DATE_RANGE_DAYS = 365;

/** Default page size — FR-SEARCH-06. */
export const DEFAULT_PAGE_SIZE = 50;

/** Thrown for unrecoverable filter shape issues; route translates to 400. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** Raw Next.js query object shape. */
export interface RawQuery {
  [k: string]: string | string[] | undefined;
}

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
