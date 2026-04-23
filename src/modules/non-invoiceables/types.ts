/**
 * Non-Invoiceable Action Centre Types
 * Unified view across PP data, offline devices, OLT mismatches, and billing deductions
 *
 * Sources aggregated:
 *   - oes_pp_data          (pre-provisions not yet activated)
 *   - offline_devices      (offline / serial mismatch from field)
 *   - olt_mismatch_records (OLT serial does not match OES)
 *   - ft_billing_deductions (weekly billing deduction notes)
 */

// ---------------------------------------------------------------------------
// Core enumerations
// ---------------------------------------------------------------------------

/** The 6 categories of non-invoiceable issues tracked in the action centre. */
export type NonInvoiceableCategory =
  | 'pre_provision'   // ONT pre-registered but not yet activated in OES
  | 'serial_mismatch' // Drop# / ONT serial does not match across systems
  | 'offline'         // Device not active or fiber break detected (note5)
  | 'low_signal'      // Signal below -26dB threshold (note1)
  | 'degraded'        // Signal degraded >2dB vs link budget (note3) — monitor only
  | 'missing_dr';     // No DR photo submission on field app (note2)

/** Source system that originally detected or reported the issue. */
export type IssueSource =
  | 'oes_pp_data'
  | 'offline_devices'
  | 'olt_mismatch'
  | 'ft_billing';

/**
 * Lifecycle status for unified action tracking.
 * false_positive: reviewed and confirmed not a real issue.
 */
export type ActionStatus =
  | 'open'
  | 'ticketed'
  | 'in_progress'
  | 'resolved'
  | 'false_positive';

// ---------------------------------------------------------------------------
// Core domain model
// ---------------------------------------------------------------------------

/**
 * A unified non-invoiceable item — one row in the action centre.
 * Composed from one or more source system records sharing the same DR number.
 */
export interface NonInvoiceableItem {
  /** Composite identifier: `<source>:<source_id>` e.g. `olt_mismatch:1234` */
  id: string;
  dr_number: string;
  project: string;
  category: NonInvoiceableCategory;
  source: IssueSource;

  // -- Status --
  action_status: ActionStatus;
  /** Calendar days since first_detected. */
  days_open: number;
  /** ISO 8601 date string of when the issue was first recorded. */
  first_detected: string;

  // -- Serial comparison (populated when relevant to the category) --
  oes_serial: string | null;
  olt_serial: string | null;
  onemap_serial: string | null;
  wa_serial: string | null;
  offline_serial: string | null;

  // -- Signal data --
  signal_dbm: number | null;

  // -- Offline data --
  offline_bucket: string | null;
  last_down_reason: string | null;

  // -- Pre-provision data --
  pp_resolution_status: string | null;

  // -- OLT investigation data --
  olt_fix_status: string | null;

  // -- Maintenance ticket linkage (UUID from maintenance_tickets.id) --
  ticket_id: string | null;
  ticket_uid: string | null;
  ticket_status: string | null;

  // -- Billing impact --
  /** Number of distinct billing weeks on which a deduction was recorded. */
  billing_deduction_count: number;
  /** ISO week string of the most recent deduction e.g. `2026-W14` */
  last_deducted_week: string | null;
  /** Raw FT billing note key e.g. `note1` through `note5`. */
  deduction_note: string | null;

  // -- Organisational context --
  zone: string | null;
  team: string | null;
}

// ---------------------------------------------------------------------------
// Dashboard / overview
// ---------------------------------------------------------------------------

/** Per-category summary used inside NonInvoiceableOverview. */
interface CategorySummary {
  total: number;
  open: number;
  ticketed: number;
  resolved: number;
}

/** Per-project summary used inside NonInvoiceableOverview. */
interface ProjectSummary {
  total: number;
  open: number;
  ticketed: number;
}

/** One week's trend entry showing billing vs actioned state. */
interface WeeklyTrendEntry {
  /** ISO week string e.g. `2026-W14` */
  week_ending: string;
  total_deductions: number;
  /** Issues that already had a ticket before the billing run. */
  already_actioned: number;
  /** Issues billed with no ticket at billing time. */
  missed: number;
}

/** Overview dashboard statistics for the Non-Invoiceable Action Centre. */
export interface NonInvoiceableOverview {
  /** Open/ticketed/resolved counts per category. */
  by_category: Record<NonInvoiceableCategory, CategorySummary>;

  /** Percentage of all issues that have an associated ticket (0–100). */
  coverage_rate: number;
  /** Percentage of all issues that are in resolved state (0–100). */
  resolution_rate: number;
  /** Count of DR numbers that have been deducted in 2 or more distinct weeks. */
  repeat_offenders: number;

  /** Aggregated counts per project. */
  by_project: Record<string, ProjectSummary>;

  /** Rolling 4-week trend for billing vs actioned state. */
  weekly_trend: WeeklyTrendEntry[];
}

// ---------------------------------------------------------------------------
// API contract
// ---------------------------------------------------------------------------

/** Query filters accepted by the /api/non-invoiceables/items endpoint. */
export interface NonInvoiceableFilters {
  project?: string;
  category?: NonInvoiceableCategory;
  action_status?: ActionStatus;
  /** When true, return only items that have a linked ticket. */
  has_ticket?: boolean;
  /** When true, return only items that appear in billing deductions. */
  was_billed?: boolean;
  /** Free-text search across dr_number, project, zone, team. */
  search?: string;
  /** ISO date string — inclusive lower bound on first_detected. */
  date_from?: string;
  /** ISO date string — inclusive upper bound on first_detected. */
  date_to?: string;
  page?: number;
  limit?: number;
}

/** Paginated response envelope for the items list endpoint. */
export interface NonInvoiceableItemsResponse {
  items: NonInvoiceableItem[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

// ---------------------------------------------------------------------------
// UI constants
// ---------------------------------------------------------------------------

/** Human-readable label for each category (used in badges, headings, filters). */
export const CATEGORY_LABELS: Record<NonInvoiceableCategory, string> = {
  pre_provision: 'Pre-Provision',
  serial_mismatch: 'Serial Mismatch',
  offline: 'Offline',
  low_signal: 'Low Signal',
  degraded: 'Degraded',
  missing_dr: 'Missing DR',
};

/**
 * Tailwind badge colour classes per category.
 * Uses 10% opacity backgrounds with matching text — consistent with the
 * existing billing and NOC badge patterns in the project.
 */
export const CATEGORY_COLORS: Record<NonInvoiceableCategory, string> = {
  pre_provision: 'bg-cyan-500/10 text-cyan-400',
  serial_mismatch: 'bg-red-500/10 text-red-400',
  offline: 'bg-purple-500/10 text-purple-400',
  low_signal: 'bg-orange-500/10 text-orange-400',
  degraded: 'bg-yellow-500/10 text-yellow-400',
  missing_dr: 'bg-blue-500/10 text-blue-400',
};

/** Tooltip / help text shown alongside each category badge. */
export const CATEGORY_DESCRIPTIONS: Record<NonInvoiceableCategory, string> = {
  pre_provision: 'ONT pre-registered but not yet activated in OES',
  serial_mismatch: 'Drop# / ONT serial does not match across systems',
  offline: 'Device not active or fiber break detected',
  low_signal: 'Signal below -26dB threshold',
  degraded: 'Signal degraded >2dB vs link budget (monitor only)',
  missing_dr: 'No DR photo submission on field app',
};

/**
 * Maps FT billing note keys to our internal NonInvoiceableCategory.
 * note1 → low_signal
 * note2 → missing_dr
 * note3 → degraded
 * note4 → serial_mismatch
 * note5 → offline
 */
export const NOTE_TO_CATEGORY: Record<string, NonInvoiceableCategory> = {
  note1: 'low_signal',
  note2: 'missing_dr',
  note3: 'degraded',
  note4: 'serial_mismatch',
  note5: 'offline',
};

/**
 * Valid QContact ticket types that may be raised for each category.
 * `degraded` has an empty array — it is monitor-only and should not
 * generate tickets.
 */
export const CATEGORY_TICKET_TYPES: Record<NonInvoiceableCategory, string[]> = {
  pre_provision: [
    'pre_provision',
    'fault_repair',
    'modification',
    'ont_swap',
    'new_installation',
  ],
  serial_mismatch: [
    'serial_mismatch',
    'olt_investigation',
    'fault_repair',
    'ont_swap',
  ],
  offline: ['fault_repair', 'ont_swap', 'new_installation'],
  low_signal: ['fault_repair'],
  degraded: [], // monitor only — no tickets raised
  missing_dr: ['fault_repair'],
};
