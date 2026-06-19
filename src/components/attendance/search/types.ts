/**
 * Shared TypeScript types for the Pulse · Search page and its subcomponents.
 *
 * These are the client-side view types — distinct from the server-side
 * SearchRow / SearchTotals in `@/services/attendance/searchQueries`. The
 * server types are returned raw; the client types add the FormState shape
 * and preset DTO structure.
 */

// ---------------------------------------------------------------------------
// Date preset vocabulary — mirrors the server-side DatePreset union.
// ---------------------------------------------------------------------------

export const DATE_PRESETS = [
  { value: 'today',      label: 'Today' },
  { value: 'yesterday',  label: 'Yesterday' },
  { value: 'this_week',  label: 'This week' },
  { value: 'last_week',  label: 'Last week' },
  { value: 'last_7d',    label: 'Last 7 days' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'last_30d',   label: 'Last 30 days' },
  { value: 'custom',     label: 'Custom' },
] as const;

export type DatePreset = (typeof DATE_PRESETS)[number]['value'];

// ---------------------------------------------------------------------------
// Exception kinds (client-visible subset of the server enum).
// ---------------------------------------------------------------------------

export const EXCEPTION_KINDS = [
  { value: 'missing_clock_out',          label: 'Missing clock-out' },
  { value: 'geofence_mismatch',          label: 'Geofence mismatch' },
  { value: 'clock_skew',                 label: 'Clock skew' },
  { value: 'out_of_hours',               label: 'Out of hours' },
  { value: 'manual_override',            label: 'Manual override' },
  { value: 'duplicate_entry',            label: 'Duplicate entry' },
  { value: 'vehicle_gps_mismatch',       label: 'Vehicle GPS mismatch' },
  { value: 'forgotten_clock_out_retro',  label: 'Forgotten clock-out (retro)' },
] as const;

// ---------------------------------------------------------------------------
// Days of week chips.
// ---------------------------------------------------------------------------

export const DAYS_OF_WEEK = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
] as const;

// ---------------------------------------------------------------------------
// Sort types.
// ---------------------------------------------------------------------------

export type SortField = 'work_date' | 'full_name' | 'hours' | 'overtime' | 'department';
export type SortDir = 'asc' | 'desc';

// ---------------------------------------------------------------------------
// API response shapes.
// ---------------------------------------------------------------------------

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

export type ScopeNote =
  | { kind: 'orgwide' }
  | { kind: 'scoped'; staffCount: number }
  | { kind: 'no_scope'; reason: string };

export interface SearchResponse {
  rows: SearchRow[];
  totals: SearchTotals;
  scopeNote: ScopeNote;
  pagination: { page: number; pageSize: number; totalRows: number; hasMore: boolean };
}

// ---------------------------------------------------------------------------
// Filter form state (client-only — maps to/from URL params and preset JSON).
// ---------------------------------------------------------------------------

export interface FormState {
  dateRange: DatePreset;
  dateFrom: string;
  dateTo: string;
  departments: string;       // comma-separated, free-text
  exceptionKinds: string[];
  daysOfWeek: number[];
  onlyWithOt: boolean;
  onlySundayHoliday: boolean;
  onlyActive: boolean;
  staffIds: string;          // comma-separated UUIDs (advanced)
  siteIds: string;           // comma-separated UUIDs (advanced)
}

export const DEFAULT_FORM: FormState = {
  dateRange: 'this_week',
  dateFrom: '',
  dateTo: '',
  departments: '',
  exceptionKinds: [],
  daysOfWeek: [],
  onlyWithOt: false,
  onlySundayHoliday: false,
  onlyActive: true,
  staffIds: '',
  siteIds: '',
};

// ---------------------------------------------------------------------------
// Saved-preset DTO.
// ---------------------------------------------------------------------------

export const PRESET_FILTER_VERSION = 1;
export interface PresetFilterV1 extends FormState { v: 1 }

export interface PresetDto {
  id: string;
  name: string;
  filter: PresetFilterV1 | Record<string, unknown>;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}
