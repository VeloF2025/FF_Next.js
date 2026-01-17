/**
 * Activate Reporting - Type Definitions
 *
 * Purpose: TypeScript interfaces for the reporting system
 * Status: WORKING - Core types for reporting implementation
 *
 * TERMINOLOGY (consistent across all reports):
 * - INSTALLED: DR submitted via WhatsApp (installation was done)
 * - COMPLETE: All required steps/photos submitted AND verified by QA
 * - INCOMPLETE: Missing steps/photos OR not verified by QA
 * - ACTIVATED: DR confirmed as active on OES report
 *
 * Following PAI principles:
 * - TYPE_SAFETY: 100% TypeScript coverage
 * - Null safety with explicit | null unions
 *
 * NLNH Confidence: HIGH
 */

// ============================================================================
// DAILY DR COUNTS WITH ZONE/PON BREAKDOWN
// ============================================================================

/**
 * PON breakdown within a zone
 */
export interface PonBreakdown {
  /** PON number (integer) */
  pon_no: number;
  /** PON display name (e.g., "PON 1.1") */
  pon_name: string;
  /** DRs submitted via WhatsApp (installation done) */
  installed: number;
  /** All steps/photos submitted AND verified by QA */
  complete: number;
  /** Missing steps/photos OR not verified by QA */
  incomplete: number;
  /** Confirmed active on OES report */
  activated: number;
}

/**
 * Zone breakdown containing PONs
 */
export interface ZoneBreakdown {
  /** Zone number (integer) */
  zone_no: number;
  /** Zone display name (e.g., "Zone 1") */
  zone_name: string;
  /** PON breakdowns within this zone */
  pons: PonBreakdown[];
  /** DRs submitted via WhatsApp (installation done) */
  installed: number;
  /** All steps/photos submitted AND verified by QA */
  complete: number;
  /** Missing steps/photos OR not verified by QA */
  incomplete: number;
  /** Confirmed active on OES report */
  activated: number;
}

/**
 * Project daily counts with zone breakdown
 */
export interface ProjectDailyCount {
  /** Project name */
  project: string;
  /** Date (YYYY-MM-DD) */
  date: string;
  /** DRs submitted via WhatsApp (installation done) */
  installed: number;
  /** All steps/photos submitted AND verified by QA */
  complete: number;
  /** Missing steps/photos OR not verified by QA */
  incomplete: number;
  /** Confirmed active on OES report */
  activated: number;
  /** Zone breakdowns (expanded when clicked) */
  zones: ZoneBreakdown[];
}

/**
 * Daily counts API response
 */
export interface DailyCountsResponse {
  /** Date range queried */
  date_range: {
    from: string;
    to: string;
  };
  /** Projects with their daily counts */
  projects: ProjectDailyCount[];
  /** Grand total across all projects */
  grand_total: {
    /** DRs submitted via WhatsApp (installation done) */
    installed: number;
    /** All steps/photos submitted AND verified by QA */
    complete: number;
    /** Missing steps/photos OR not verified by QA */
    incomplete: number;
    /** Confirmed active on OES report */
    activated: number;
  };
}

// ============================================================================
// DISCREPANCY REPORT (WhatsApp vs OES)
// ============================================================================

/**
 * Discrepancy type between WhatsApp and OES
 */
export type DiscrepancyType =
  | 'matched'   // Present in both WhatsApp and OES
  | 'wa_only'   // DR submitted via WhatsApp but not in OES (not yet activated)
  | 'oes_only'; // DR in OES but not from WhatsApp (manual install?)

/**
 * Individual discrepancy record
 */
export interface DiscrepancyRecord {
  /** DR number */
  drop_number: string;
  /** Project name */
  project: string | null;
  /** Type of discrepancy */
  discrepancy_type: DiscrepancyType;

  // WhatsApp data (if exists)
  /** When submitted via WhatsApp */
  wa_submitted_at: string | null;
  /** Who submitted via WhatsApp */
  wa_submitted_by: string | null;
  /** Sender phone number */
  wa_sender_phone: string | null;

  // OES data (if exists)
  /** Activation date from OES */
  oes_activation_date: string | null;
  /** Installation team from OES */
  oes_team: string | null;
  /** Status from OES */
  oes_status: string | null;
  /** ONT serial from OES */
  oes_serial_number: string | null;
}

/**
 * Discrepancy report API response
 */
export interface DiscrepancyReportResponse {
  /** WhatsApp submission date queried */
  wa_date: string;
  /** OES report date queried (usually wa_date + 1) */
  oes_date: string;

  /** Summary statistics */
  summary: {
    /** Total WhatsApp submissions */
    total_wa_submissions: number;
    /** Total OES activations */
    total_oes_activations: number;
    /** Matched in both systems */
    matched: number;
    /** Only in WhatsApp (not yet activated) */
    wa_only: number;
    /** Only in OES (manual installs?) */
    oes_only: number;
  };

  /** All discrepancy records */
  records: DiscrepancyRecord[];
}

// ============================================================================
// SERIAL VALIDATION REPORT
// ============================================================================

/**
 * Serial match status between WhatsApp and OES
 */
export type SerialMatchStatus =
  | 'match'         // Serials match perfectly
  | 'mismatch'      // Serials don't match (wrong ONT installed)
  | 'missing_wa'    // No serial from WhatsApp/unified
  | 'missing_oes'   // No serial from OES
  | 'both_missing'; // Neither has serial

/**
 * Individual serial validation record
 */
export interface SerialValidationRecord {
  /** DR number */
  drop_number: string;
  /** Project name */
  project: string | null;

  // ONT Serial comparison
  /** ONT serial from WhatsApp/unified (scanned on-site) */
  ont_serial_wa: string | null;
  /** ONT serial from OES (system of record) */
  ont_serial_oes: string | null;
  /** Match status */
  ont_match_status: SerialMatchStatus;

  // UPS Serial check
  /** UPS serial from WhatsApp/unified */
  ups_serial_wa: string | null;
  /** Whether UPS serial exists */
  ups_serial_exists: boolean;

  // Metadata
  /** When submitted */
  submitted_at: string | null;
  /** Who submitted */
  submitted_by: string | null;
}

/**
 * Serial validation report API response
 */
export interface SerialValidationReportResponse {
  /** Date range queried */
  date_range: {
    from: string;
    to: string;
  };

  /** Summary statistics */
  summary: {
    /** Total records checked */
    total_checked: number;
    /** ONT serials that match */
    ont_matches: number;
    /** ONT serials that don't match (CRITICAL) */
    ont_mismatches: number;
    /** ONT serials missing from either source */
    ont_missing: number;
    /** UPS serials present */
    ups_present: number;
    /** UPS serials missing */
    ups_missing: number;
  };

  /** All validation records */
  records: SerialValidationRecord[];
  /** Only mismatched records (convenience filter) */
  mismatches_only: SerialValidationRecord[];
}

// ============================================================================
// USER/TEAM ATTRIBUTION
// ============================================================================

/**
 * User performance metrics (WhatsApp submitters)
 */
export interface UserPerformance {
  /** User name from WhatsApp */
  user_name: string | null;
  /** Sender phone number */
  sender_phone: string | null;
  /** Project name */
  project: string;

  // Counts (using consistent terminology)
  /** DRs submitted via WhatsApp (installation done) */
  installed: number;
  /** All steps/photos submitted AND verified by QA */
  complete: number;
  /** Missing steps/photos OR not verified by QA */
  incomplete: number;
  /** Confirmed active on OES report */
  activated: number;
  /** Completion rate (0-100) */
  completion_rate: number;
  /** Activation rate (0-100) */
  activation_rate: number;

  // Serial compliance
  /** DRs with ONT serial scanned */
  ont_scanned: number;
  /** DRs with UPS serial scanned */
  ups_scanned: number;
  /** Serial compliance rate (0-100) */
  serial_compliance_rate: number;
}

/**
 * Team performance metrics (from OES)
 */
export interface TeamPerformance {
  /** Team name from OES */
  team: string;
  /** Project name */
  project: string | null;

  // From OES activations
  /** Total activations */
  total_activations: number;

  // Match with WA submissions
  /** Matched to WhatsApp submissions */
  matched_to_wa: number;
  /** Match rate (0-100) */
  match_rate: number;
}

/**
 * User/Team attribution report API response
 */
export interface UserTeamAttributionResponse {
  /** Date range queried */
  date_range: {
    from: string;
    to: string;
  };

  /** User performance list */
  users: UserPerformance[];
  /** Team performance list */
  teams: TeamPerformance[];

  /** Summary statistics */
  summary: {
    /** Total unique users */
    total_users: number;
    /** Total unique teams */
    total_teams: number;
    /** Average completion rate */
    avg_completion_rate: number;
    /** Average serial compliance */
    avg_serial_compliance: number;
  };
}

// ============================================================================
// REPORT FILTER OPTIONS
// ============================================================================

/**
 * Common filter options for all reports
 */
export interface ReportFilters {
  /** Start date (YYYY-MM-DD) */
  dateFrom: string;
  /** End date (YYYY-MM-DD) */
  dateTo: string;
  /** Filter by project (optional) */
  project?: string;
}

/**
 * Discrepancy report specific filters
 */
export interface DiscrepancyFilters extends ReportFilters {
  /** Filter by discrepancy type */
  discrepancyType?: DiscrepancyType;
}

/**
 * Serial validation specific filters
 */
export interface SerialValidationFilters extends ReportFilters {
  /** Filter by serial match status */
  serialStatus?: SerialMatchStatus;
  /** Only show mismatches */
  mismatchesOnly?: boolean;
}

/**
 * Report type identifier
 */
export type ReportType =
  | 'daily-counts'
  | 'discrepancy'
  | 'serial-validation'
  | 'user-attribution';

// ============================================================================
// UI STATE TYPES
// ============================================================================

/**
 * Expanded state for accordion UI
 */
export interface ExpandedState {
  /** Expanded project names */
  projects: Set<string>;
  /** Expanded zone keys (project_zone) */
  zones: Set<string>;
}

/**
 * Sort configuration
 */
export interface SortConfig {
  /** Field to sort by */
  field: string;
  /** Sort direction */
  direction: 'asc' | 'desc';
}
