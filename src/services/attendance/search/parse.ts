/**
 * Pulse · Search — filter, pagination, and sort parsing (PRD-061 Phase A).
 *
 * All functions are pure and take raw Next.js `req.query`-shaped input.
 * They validate and normalise the URL contract into well-typed server-side
 * filter/pagination/sort objects. Callers receive a `ValidationError` on
 * bad input; the route layer translates that to a 400 response.
 *
 * No database access here — parsing is synchronous and testable in isolation.
 */

import {
  MAX_TOTAL_ROWS,
  MAX_DATE_RANGE_DAYS,
  DEFAULT_PAGE_SIZE,
  ValidationError,
  type RawQuery,
  type SearchFilters,
  type SearchPagination,
  type SearchSort,
  type DatePreset,
} from './types';

// Re-export for backward compat via the barrel.
export { ValidationError };

// ---------------------------------------------------------------------------
// Raw-value coercers
// ---------------------------------------------------------------------------

export function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter((s) => s.length > 0);
  if (typeof v === 'string' && v.length > 0) return v.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

export function asNumberArray(v: unknown): number[] {
  return asStringArray(v)
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isFinite(n));
}

export function asBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v === '1' || v.toLowerCase() === 'true';
  return false;
}

// ---------------------------------------------------------------------------
// Date-range utilities
// ---------------------------------------------------------------------------

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

export function resolveDatePreset(preset: DatePreset, today: string = todayInSast()): { from: string; to: string } {
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

// ---------------------------------------------------------------------------
// Exception kind alias mapping (PRD-friendly names → canonical enum values)
// ---------------------------------------------------------------------------

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
 * Map PRD-friendly exception names → canonical enum values. Names without a
 * canonical equivalent today (`late`, `no_show`, etc.) map to `null` so a
 * future Phase C migration can wire them in without changing the URL contract.
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

// ---------------------------------------------------------------------------
// Sort field / direction allow-lists
// ---------------------------------------------------------------------------

const SORT_FIELDS = new Set(['work_date', 'full_name', 'hours', 'overtime', 'department']);
const SORT_DIRS = new Set(['asc', 'desc']);

// ---------------------------------------------------------------------------
// Public parse functions
// ---------------------------------------------------------------------------

export function parseFilters(query: RawQuery): SearchFilters {
  const dateRange = (typeof query.dateRange === 'string' ? query.dateRange : 'this_week') as DatePreset;
  const explicitFrom = typeof query.dateFrom === 'string' ? query.dateFrom : '';
  const explicitTo = typeof query.dateTo === 'string' ? query.dateTo : '';

  let dateFrom: string;
  let dateTo: string;
  if (dateRange === 'custom') {
    if (!YMD_RE.test(explicitFrom) || !YMD_RE.test(explicitTo)) {
      throw new ValidationError('dateRange=custom requires dateFrom and dateTo as YYYY-MM-DD');
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
  const minLatenessMin = Number.isFinite(minLatenessMinRaw as number) ? (minLatenessMinRaw as number) : null;

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
