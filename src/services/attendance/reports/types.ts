/**
 * Pulse · Reports — shared types (PRD-061 Phase C, FR-REPORT-*).
 *
 * Each P1 report exports a `runReport(input, scope)` function that returns
 * `{ rows, meta }`. The dispatcher validates the slug, parses the inputs,
 * and routes to the right module. Keeping the interface narrow means
 * adding a new report later (Phase C2) is a one-file change plus a
 * dispatcher entry.
 */

import type { ResolvedScope } from '../searchQueries';

export type ReportSlug =
  | 'monthly-totals'
  | 'geo-mismatch'
  | 'ot-trend'
  | 'dept-rollup'
  | 'wage-cost'
  | 'bcea-premium';

export const ALL_REPORT_SLUGS: ReadonlyArray<ReportSlug> = [
  'monthly-totals',
  'geo-mismatch',
  'ot-trend',
  'dept-rollup',
  'wage-cost',
  'bcea-premium',
];

/** Catalogue entry — drives the index tile grid and the per-slug page. */
export interface ReportDef {
  slug: ReportSlug;
  title: string;
  /** Short blurb for the tile (≤ 80 chars). */
  blurb: string;
  /** Inputs the report accepts; the per-slug form renders these. */
  inputs: ReadonlyArray<ReportInputDef>;
  /** Whether the result row count is allowed to exceed the 50k cap. */
  allowLargeResults?: boolean;
}

export type ReportInputDef =
  | { kind: 'date_range'; defaultPreset: 'this_month' | 'last_month' | 'last_30d' | 'last_12_weeks' }
  | { kind: 'month'; label?: string }
  | { kind: 'departments_text'; label?: string }
  | { kind: 'sites_text'; label?: string }
  | { kind: 'staff_ids_text'; label?: string }
  | { kind: 'group_by'; options: ReadonlyArray<{ value: string; label: string }>; default: string };
// `lateness_min` will be added back when the late-arrivals report ships
// in Phase C2 (needs shift-schedule data the DB doesn't carry today).

/** Catalogue used by both the API dispatcher and the index/[slug] pages. */
export const REPORT_CATALOGUE: ReadonlyArray<ReportDef> = [
  {
    slug: 'monthly-totals',
    title: 'Monthly per-staff totals',
    blurb: 'One row per active staff for a given month — hours, OT, exceptions, wage.',
    inputs: [
      { kind: 'month' },
      { kind: 'departments_text' },
      { kind: 'sites_text' },
    ],
  },
  {
    slug: 'geo-mismatch',
    title: 'Geo-mismatch incidents',
    blurb: 'Clock-ins flagged outside any site geofence — fraud or stale data triage.',
    inputs: [
      { kind: 'date_range', defaultPreset: 'last_30d' },
      { kind: 'departments_text' },
      { kind: 'sites_text' },
    ],
  },
  {
    slug: 'ot-trend',
    title: 'OT trend (last 12 weeks)',
    blurb: 'Per-staff overtime hours week-by-week — spot creep before payroll close.',
    inputs: [
      { kind: 'departments_text' },
      { kind: 'staff_ids_text' },
    ],
  },
  {
    slug: 'dept-rollup',
    title: 'Department rollup',
    blurb: 'Headcount, hours, OT, exceptions, wage-cost rolled up per department.',
    inputs: [
      { kind: 'date_range', defaultPreset: 'last_30d' },
      { kind: 'departments_text' },
    ],
  },
  {
    slug: 'wage-cost',
    title: 'Wage cost rollup',
    blurb: 'Sum of wage_amount over a date range, grouped by your dimension of choice.',
    inputs: [
      { kind: 'date_range', defaultPreset: 'last_30d' },
      { kind: 'group_by', default: 'dept', options: [
        { value: 'dept', label: 'Department' },
        { value: 'site', label: 'Site' },
        { value: 'none', label: 'None (total only)' },
      ] },
    ],
  },
  {
    slug: 'bcea-premium',
    title: 'BCEA Sunday + holiday work',
    blurb: 'BCEA s16/s18 compliance — hours worked on Sundays and public holidays per staff.',
    inputs: [
      { kind: 'date_range', defaultPreset: 'last_30d' },
      { kind: 'departments_text' },
      { kind: 'sites_text' },
    ],
  },
];

/** Result column metadata — drives table rendering and XLSX header order. */
export interface ReportColumn {
  key: string;
  label: string;
  align?: 'left' | 'right';
  /** Render hint: 'number' for tabular-nums right-align, 'currency_rand' to fmt cents → R. */
  format?: 'number' | 'currency_rand' | 'integer';
}

export interface ReportRunResult {
  /** Generic JSON rows; the per-slug page knows the column shape. */
  rows: Array<Record<string, unknown>>;
  columns: ReadonlyArray<ReportColumn>;
  /** Optional notes (e.g. "wage_amount NULL for X rows" — graceful degrade). */
  notes: string[];
}

/** Server-resolved input shape passed to each report module. */
export interface ReportInput {
  /** Filtered staff ids (already intersected with supervisorScope). null = org-wide. */
  scopedStaffIds: string[] | null;
  /** Whether the resolved scope has any staff at all. */
  hasAnyStaff: boolean;
  scope: ResolvedScope;

  // Optional inputs — any given report uses only the ones it cares about.
  month?: string;        // YYYY-MM (SAST)
  dateFrom?: string;     // YYYY-MM-DD
  dateTo?: string;       // YYYY-MM-DD
  departments: string[];
  siteIds: string[];
  staffIdsHint: string[]; // staff IDs the user TYPED (already merged into scopedStaffIds)
  groupBy?: string;
}
