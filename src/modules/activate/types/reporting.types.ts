/**
 * Activate Reporting - Type Definitions
 *
 * Purpose: TypeScript interfaces for the reporting system
 * Status: WORKING - Core types for reporting implementation
 *
 * TERMINOLOGY (consistent across all reports):
 * - INSTALLED: DR submitted via WhatsApp (installation was done)
 * - REVIEWED: QA feedback has been sent (feedback_sent = true)
 * - NOT REVIEWED: QA feedback not yet sent
 * - ACTIVATED: DR confirmed as active on OES report
 *
 * Following PAI principles:
 * - TYPE_SAFETY: 100% TypeScript coverage
 * - Null safety with explicit | null unions
 *
 * NLNH Confidence: HIGH
 */

// ============================================================================
// ANOMALY COUNTS (for data quality tracking)
// ============================================================================

/**
 * Anomaly counts for data quality tracking
 * Used in Reports tab for identifying discrepancies
 */
export interface AnomalyCounts {
  /** Installed (WA submission) but NOT activated on OES - may need maintenance ticket */
  wa_only: number;
  /** Activated on OES but NOT installed via WA - forgot to add to group? */
  oes_only: number;
}

// ============================================================================
// DAILY DR COUNTS WITH ZONE/PON BREAKDOWN
// ============================================================================

/**
 * Individual DR within a pole
 */
export interface DrBreakdown {
  /** DR number (e.g., "DR1731114") */
  drop_number: string;
  /** Installation status */
  is_installed: boolean;
  /** Activation status */
  is_activated: boolean;
  /** QA review status */
  is_reviewed: boolean;
  /** Installation date */
  installed_at: string | null;
  /** Activation date */
  activated_at: string | null;
  /** QA status label */
  qa_status: 'pending' | 'pass' | 'fail' | 'rework';
}

/**
 * Pole breakdown within a PON
 */
export interface PoleBreakdown {
  /** Pole identifier (e.g., "LAW.P.A453") */
  pole_no: string;
  /** Pole display name */
  pole_name: string;
  /** Total unique drops on this pole */
  total: number;
  /** DRs submitted via WhatsApp (installation done) */
  installed: number;
  /** Confirmed active on OES report */
  activated: number;
  /** QA feedback not yet sent */
  notReviewed: number;
  /** QA feedback has been sent */
  reviewed: number;
  /** Individual DRs on this pole (expanded when clicked) */
  drs?: DrBreakdown[];
  /** Anomaly counts (for Reports tab) */
  anomalies?: AnomalyCounts;
}

/**
 * PON breakdown within a zone
 */
export interface PonBreakdown {
  /** PON number (integer) */
  pon_no: number;
  /** PON display name (e.g., "PON 1.1") */
  pon_name: string;
  /** Total unique drops (counted once at first install/activation) */
  total: number;
  /** DRs submitted via WhatsApp (installation done) */
  installed: number;
  /** Confirmed active on OES report */
  activated: number;
  /** QA feedback not yet sent */
  notReviewed: number;
  /** QA feedback has been sent */
  reviewed: number;
  /** Pole breakdowns within this PON (expanded when clicked) */
  poles?: PoleBreakdown[];
  /** Anomaly counts (for Reports tab) */
  anomalies?: AnomalyCounts;
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
  /** Total unique drops (counted once at first install/activation) */
  total: number;
  /** DRs submitted via WhatsApp (installation done) */
  installed: number;
  /** Confirmed active on OES report */
  activated: number;
  /** QA feedback not yet sent */
  notReviewed: number;
  /** QA feedback has been sent */
  reviewed: number;
  /** Anomaly counts (for Reports tab) */
  anomalies?: AnomalyCounts;
}

/**
 * Project daily counts with zone breakdown
 */
export interface ProjectDailyCount {
  /** Project name */
  project: string;
  /** Date (YYYY-MM-DD) */
  date: string;
  /** Total unique drops (counted once at first install/activation) */
  total: number;
  /** DRs submitted via WhatsApp (installation done) */
  installed: number;
  /** Confirmed active on OES report */
  activated: number;
  /** QA feedback not yet sent */
  notReviewed: number;
  /** QA feedback has been sent */
  reviewed: number;
  /** Zone breakdowns (expanded when clicked) */
  zones: ZoneBreakdown[];
  /** Anomaly counts (for Reports tab) */
  anomalies?: AnomalyCounts;
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
    /** Total unique drops (counted once at first install/activation) */
    total: number;
    /** DRs submitted via WhatsApp (installation done) */
    installed: number;
    /** Confirmed active on OES report */
    activated: number;
    /** QA feedback not yet sent */
    notReviewed: number;
    /** QA feedback has been sent */
    reviewed: number;
    /** Anomaly counts (for Reports tab) */
    anomalies?: AnomalyCounts;
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
  /** QA feedback has been sent */
  reviewed: number;
  /** QA feedback not yet sent */
  notReviewed: number;
  /** Confirmed active on OES report */
  activated: number;
  /** Review rate (0-100) */
  review_rate: number;
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
    /** Average review rate */
    avg_review_rate: number;
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

/**
 * Report category for dashboard navigation
 */
export type ReportCategory =
  | 'anomalies'
  | 'trends'
  | 'team'
  | 'funnel'
  | 'offline'
  | 'swaps'
  | 'mismatches'
  | 'gaps' // Installed but Not Activated - money spent, never went live
  | 'progress' // Activation Progress - Project > Zone > PON tracking
  | 'maturity'; // Maturity Tracking - time to reach milestones, velocity, projections

// ============================================================================
// SERIAL MISMATCH TRACKING TYPES (Installation vs Activation)
// ============================================================================

/**
 * Mismatch investigation status
 */
export type MismatchStatus =
  | 'pending_investigation'  // Detected, needs investigation
  | 'ticket_created'         // Maintenance ticket created
  | 'resolved'               // Issue resolved
  | 'false_positive';        // Detection was incorrect

/**
 * Resolution type for mismatches
 */
export type MismatchResolution =
  | 'ont_replaced'      // ONT was legitimately replaced
  | 'data_corrected'    // Data entry error fixed
  | 'theft_confirmed'   // Unauthorized swap confirmed
  | 'false_alarm'       // No actual mismatch
  | 'other';            // Other resolution

/**
 * Individual serial mismatch record
 */
export interface SerialMismatchRecord {
  /** Unique ID */
  id: string;
  /** DR number */
  drop_number: string;
  /** Zone */
  zone: string | null;
  /** PON */
  pon: string | null;
  /** Address */
  address: string | null;

  /** Current serial (from offline report) - may be different ONT */
  current_serial: string;
  /** Expected/Original serial (from OES activation) */
  expected_serial: string;
  /** Mismatch type */
  mismatch_type: string;

  /** Investigation status */
  status: MismatchStatus;
  /** Resolution type */
  resolution: MismatchResolution | null;
  /** Investigation notes */
  notes: string | null;

  /** Associated maintenance ticket ID */
  ticket_id: string | null;
  /** Ticket status (if exists) */
  ticket_status: string | null;

  /** Activation date from OES */
  activation_date: string | null;
  /** Installation team from OES (critical for accountability) */
  installation_team: string | null;
  /** Last offline event */
  last_inform_date: string | null;
  /** Days since last inform */
  days_offline: number;
  /** Last down reason */
  down_reason: string | null;

  /** Days since mismatch detected */
  days_pending: number;
  /** Investigated at */
  investigated_at: string | null;
  /** Resolved at */
  resolved_at: string | null;
}

/**
 * Serial mismatch report summary
 */
export interface SerialMismatchSummary {
  /** Total mismatches */
  total: number;
  /** Pending investigation */
  pending_investigation: number;
  /** Ticket created */
  ticket_created: number;
  /** Resolved */
  resolved: number;
  /** False positives */
  false_positive: number;
  /** Breakdown by zone */
  by_zone: Record<string, number>;
  /** Breakdown by down reason */
  by_reason: Record<string, number>;
  /** Breakdown by installation team (critical for accountability) */
  by_team?: Record<string, number>;
}

/**
 * Serial mismatch report API response
 */
export interface SerialMismatchReportResponse {
  /** Summary statistics */
  summary: SerialMismatchSummary;
  /** Mismatch records */
  records: SerialMismatchRecord[];
  /** Total count */
  total_count: number;
  /** Pagination */
  page: number;
  page_size: number;
  /** Available statuses */
  available_statuses: MismatchStatus[];
  /** Available resolutions */
  available_resolutions: MismatchResolution[];
}

// ============================================================================
// SERIAL SWAP TRACKING TYPES
// ============================================================================

/**
 * Swap status for 1Map correction workflow
 */
export type SwapStatus =
  | 'pending_correction'   // Detected, waiting for technician to fix in 1Map mobile app
  | 'corrected_in_1map'    // Technician confirmed they fixed it in 1Map
  | 'false_positive';      // QA determined the detection was incorrect

/**
 * Individual serial swap record
 */
export interface SerialSwapRecord {
  /** DR number */
  drop_number: string;
  /** Project name */
  project: string | null;
  /** Zone number */
  zone_no: number | null;
  /** PON number */
  pon_no: number | null;

  /** ONT serial from 1Map (may be swapped) */
  ont_serial: string | null;
  /** UPS serial from 1Map (may be swapped) */
  ups_serial: string | null;

  /** Human-readable swap details */
  swap_details: string;
  /** Current correction status */
  swap_status: SwapStatus;

  /** When swap was first detected */
  detected_at: string;
  /** When marked as corrected */
  corrected_at: string | null;
  /** Who marked as corrected */
  corrected_by: string | null;

  /** Technician name from WhatsApp */
  technician_name: string | null;
  /** Technician phone */
  technician_phone: string | null;

  /** Days since detection (for aging) */
  days_pending: number;
}

/**
 * Serial swap report summary statistics
 */
export interface SerialSwapSummary {
  /** Total swaps detected (all time in range) */
  total_detected: number;
  /** Pending correction */
  pending_correction: number;
  /** Corrected in 1Map */
  corrected: number;
  /** Marked as false positive */
  false_positive: number;
  /** Average days to resolve */
  avg_resolution_days: number | null;
  /** Swaps pending > 7 days (critical backlog) */
  backlog_over_7_days: number;
  /** Breakdown by project */
  by_project: Record<string, {
    pending: number;
    corrected: number;
    total: number;
  }>;
}

/**
 * Serial swap report API response
 */
export interface SerialSwapReportResponse {
  /** Date range queried */
  date_range: {
    from: string;
    to: string;
  };
  /** Project filter (if any) */
  project: string | null;
  /** Summary statistics */
  summary: SerialSwapSummary;
  /** All swap records (paginated) */
  records: SerialSwapRecord[];
  /** Total record count (for pagination) */
  total_count: number;
  /** Page number */
  page: number;
  /** Page size */
  page_size: number;
  /** Available statuses for filtering */
  available_statuses: SwapStatus[];
}

// ============================================================================
// TREND ANALYSIS TYPES
// ============================================================================

/**
 * Time grouping options for trend reports
 */
export type TrendGroupBy = 'day' | 'week' | 'month';

/**
 * Single data point in trend series
 */
export interface TrendDataPoint {
  /** Date/period label (YYYY-MM-DD or Week XX) */
  label: string;
  /** Full date for sorting */
  date: string;
  /** DRs submitted via WhatsApp */
  installed: number;
  /** Confirmed active on OES */
  activated: number;
  /** QA feedback sent */
  reviewed: number;
  /** QA feedback not sent */
  notReviewed: number;
  /** Per-project breakdown (optional, included when no project filter) */
  by_project?: Record<string, {
    installed: number;
    activated: number;
    reviewed: number;
    notReviewed: number;
  }>;
}

/**
 * Trend analysis API response
 */
export interface TrendAnalysisResponse {
  /** Date range queried */
  date_range: {
    from: string;
    to: string;
  };
  /** Grouping used */
  group_by: TrendGroupBy;
  /** Project filter (if any) */
  project: string | null;
  /** Available projects in the data (for toggle UI) */
  available_projects: string[];
  /** Data points for chart */
  data: TrendDataPoint[];
  /** Velocity metrics */
  velocity: {
    /** Average installs per period */
    avg_installed: number;
    /** Average activations per period */
    avg_activated: number;
    /** Trend direction for installs */
    installed_trend: 'up' | 'down' | 'stable';
    /** Trend direction for activations */
    activated_trend: 'up' | 'down' | 'stable';
    /** Week-over-week change % for installs */
    installed_wow_change: number;
    /** Week-over-week change % for activations */
    activated_wow_change: number;
  };
}

/**
 * Project progress tracker data
 */
export interface ProjectProgress {
  /** Project name */
  project: string;
  /** Total scope (from drops table if available) */
  total_scope: number | null;
  /** Current installed count */
  installed: number;
  /** Current activated count */
  activated: number;
  /** Completion % based on scope */
  completion_percent: number | null;
  /** Estimated completion date (linear projection) */
  estimated_completion: string | null;
  /** Days remaining (estimated) */
  days_remaining: number | null;
}

// ============================================================================
// RESUBMISSION ANALYSIS TYPES
// ============================================================================

/**
 * Resubmission metrics per grouping
 */
export interface ResubmissionMetrics {
  /** Group name (project or team) */
  group_name: string;
  /** Total DRs with submissions */
  total_drs: number;
  /** DRs with 2+ submissions */
  resubmitted_drs: number;
  /** Resubmission rate (0-100) */
  resubmission_rate: number;
  /** Average submissions per DR */
  avg_submissions: number;
  /** Max submissions on any DR */
  max_submissions: number;
}

/**
 * Individual DR with high resubmissions
 */
export interface TopResubmittedDR {
  /** DR number */
  drop_number: string;
  /** Project name */
  project: string | null;
  /** Submission count */
  submission_count: number;
  /** First submitted */
  first_submitted_at: string;
  /** Last resubmitted */
  last_resubmitted_at: string;
  /** Submitter name */
  submitted_by: string | null;
}

/**
 * Resubmission analysis API response
 */
export interface ResubmissionAnalysisResponse {
  /** Date range queried */
  date_range: {
    from: string;
    to: string;
  };
  /** Overall summary */
  summary: {
    /** Total DRs checked */
    total_drs: number;
    /** DRs with resubmissions */
    resubmitted_drs: number;
    /** Overall resubmission rate */
    resubmission_rate: number;
    /** Average submissions per DR */
    avg_submissions: number;
  };
  /** Breakdown by project */
  by_project: ResubmissionMetrics[];
  /** Breakdown by user/team */
  by_user: ResubmissionMetrics[];
  /** Top resubmitted DRs */
  top_resubmitted: TopResubmittedDR[];
}

// ============================================================================
// QA WORKFLOW FUNNEL TYPES
// ============================================================================

/**
 * Funnel stage metrics
 */
export interface FunnelStageMetrics {
  /** Stage name */
  stage: string;
  /** Count at this stage */
  count: number;
  /** Percentage of total */
  percentage: number;
  /** Drop-off from previous stage */
  drop_off_percent: number;
}

/**
 * Photo step completion metrics
 */
export interface PhotoStepMetrics {
  /** Step number (1-10) */
  step: number;
  /** Step label */
  label: string;
  /** Completion count */
  completed: number;
  /** Total checked */
  total: number;
  /** Completion rate (0-100) */
  completion_rate: number;
  /** VLM pass rate if evaluated */
  vlm_pass_rate: number | null;
}

/**
 * Processing time metrics (in minutes)
 */
export interface ProcessingTimeMetrics {
  /** Stage name */
  stage: string;
  /** 50th percentile */
  p50: number;
  /** 90th percentile */
  p90: number;
  /** 99th percentile */
  p99: number;
  /** Average */
  avg: number;
  /** Target time (minutes) */
  target: number;
  /** Meeting target rate (0-100) */
  meeting_target_rate: number;
}

/**
 * QA Workflow Funnel API response
 */
export interface QAFunnelResponse {
  /** Date range queried */
  date_range: {
    from: string;
    to: string;
  };
  /** Project filter (if any) */
  project: string | null;
  /** Funnel stages */
  funnel: FunnelStageMetrics[];
  /** Photo step analysis */
  photo_steps: PhotoStepMetrics[];
  /** Processing time metrics */
  processing_times: ProcessingTimeMetrics[];
  /** Summary metrics */
  summary: {
    /** Total submitted */
    total_submitted: number;
    /** End-to-end conversion rate */
    conversion_rate: number;
    /** Average end-to-end time (minutes) */
    avg_cycle_time: number;
    /** Photo completion rate */
    photo_completion_rate: number;
  };
}

// ============================================================================
// ENHANCED TEAM PERFORMANCE TYPES
// ============================================================================

/**
 * Enhanced technician metrics for leaderboard
 */
export interface TechnicianLeaderboardEntry {
  /** Rank position */
  rank: number;
  /** User name (formal_name from wa_contacts if mapped, otherwise WhatsApp display name) */
  user_name: string | null;
  /** Phone number */
  sender_phone: string | null;
  /** Team name (from wa_contacts mapping) */
  team: string | null;
  /** Role (activator, installer, supervisor - from wa_contacts) */
  role: string;
  /** Project(s) */
  projects: string[];
  /** Total submissions */
  total_submissions: number;
  /** First-pass success count */
  first_pass_success: number;
  /** First-pass success rate (0-100) */
  first_pass_rate: number;
  /** Resubmission count */
  resubmissions: number;
  /** Resubmission rate (0-100) */
  resubmission_rate: number;
  /** ONT serial scanned count */
  ont_scanned: number;
  /** UPS serial scanned count */
  ups_scanned: number;
  /** Serial compliance rate (0-100) */
  serial_compliance: number;
  /** Average VLM quality score (if available) */
  avg_quality_score: number | null;
  /** 7-day trend data (for sparkline) */
  trend_7d: number[];
}

/**
 * Team comparison metrics
 */
export interface TeamComparisonEntry {
  /** Team name (from OES) */
  team: string;
  /** Project(s) */
  projects: string[];
  /** Total activations */
  total_activations: number;
  /** Matched to WA submissions */
  matched_to_wa: number;
  /** WA submission match rate (0-100) */
  wa_match_rate: number;
  /** Average activation time (hours from submission to activation) */
  avg_activation_time: number | null;
  /** Average ONT signal quality (dBm) */
  avg_ont_signal: number | null;
  /** Average OLT signal quality (dBm) */
  avg_olt_signal: number | null;
}

/**
 * Compliance metrics summary
 */
export interface ComplianceMetrics {
  /** WA submission compliance (activated with WA submission %) */
  wa_submission_compliance: number;
  /** Serial scan compliance (ONT scanned %) */
  serial_scan_compliance: number;
  /** Photo completion (all 10 steps %) */
  photo_completion_compliance: number;
  /** Target values for gauges */
  targets: {
    wa_submission: number;
    serial_scan: number;
    photo_completion: number;
  };
}

/**
 * Enhanced Team Performance API response
 */
export interface TeamPerformanceResponse {
  /** Date range queried */
  date_range: {
    from: string;
    to: string;
  };
  /** Project filter (if any) */
  project: string | null;
  /** Technician leaderboard */
  leaderboard: TechnicianLeaderboardEntry[];
  /** Team comparison */
  teams: TeamComparisonEntry[];
  /** Compliance metrics */
  compliance: ComplianceMetrics;
  /** Summary */
  summary: {
    total_technicians: number;
    total_teams: number;
    avg_first_pass_rate: number;
    avg_serial_compliance: number;
    top_performer: string | null;
  };
}

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

// ============================================================================
// OFFLINE DEVICES REPORT TYPES
// ============================================================================

/**
 * Match status for offline device against existing systems
 */
export type OfflineMatchStatus = 'matched_drops' | 'matched_oes' | 'unmatched';

/**
 * Offline bucket categories
 */
export type OfflineBucket =
  | 'Less than 20 days'
  | '20 - 40 Days'
  | '40 - 60 Days'
  | 'More than 60 Days';

/**
 * Individual offline device record
 */
export interface OfflineDeviceRecord {
  /** Unique ID */
  id: string;
  /** DR number */
  drop_number: string;
  /** ONT serial from report */
  serial_number: string;
  /** Area code (law, moh, mam) */
  area_code: string;
  /** Zone (from summary report) */
  zone: string | null;
  /** Planned PON */
  planned_pon: string | null;
  /** Full address */
  address: string | null;
  /** Pole number */
  pole_number: string | null;
  /** Last down reason */
  last_down_reason: string;
  /** Last inform date */
  last_inform_date: string | null;
  /** Days offline */
  days_since_last_inform: number;
  /** Offline bucket category */
  offline_bucket: string;
  /** Match status against drops/OES */
  match_status: OfflineMatchStatus;
  /** Expected serial from OES */
  expected_serial: string | null;
  /** Serial mismatch flag */
  serial_mismatch: boolean;
  /** Report date imported from */
  report_date: string;
  /** Installation date */
  installation_date: string | null;
  /** Revenue 30-day average */
  revenue_30day_avg: number | null;
}

/**
 * Summary statistics for offline devices
 */
export interface OfflineDevicesSummary {
  /** Total offline devices */
  total_devices: number;
  /** Matched to drops table */
  matched_drops: number;
  /** Matched to OES activations */
  matched_oes: number;
  /** No match found */
  unmatched: number;
  /** Serial mismatches */
  serial_mismatches: number;
  /** Breakdown by offline bucket */
  by_bucket: Record<string, number>;
  /** Breakdown by last down reason */
  by_reason: Record<string, number>;
  /** Breakdown by zone */
  by_zone: Record<string, number>;
}

/**
 * Offline devices report filters
 */
export interface OfflineDevicesFilters extends ReportFilters {
  /** Filter by zone */
  zone?: string;
  /** Filter by offline bucket */
  offlineBucket?: string;
  /** Filter by match status */
  matchStatus?: OfflineMatchStatus;
  /** Only show serial mismatches */
  serialMismatchOnly?: boolean;
  /** Filter by last down reason */
  lastDownReason?: string;
}

/**
 * Offline devices report API response
 */
export interface OfflineDevicesReportResponse {
  /** Date range queried */
  date_range: {
    from: string;
    to: string;
  };
  /** Project filter (if any) */
  project: string | null;
  /** Summary statistics */
  summary: OfflineDevicesSummary;
  /** Available zones for filtering */
  available_zones: string[];
  /** Available reasons for filtering */
  available_reasons: string[];
  /** Available buckets for filtering */
  available_buckets: string[];
  /** Device records (paginated) */
  records: OfflineDeviceRecord[];
  /** Total record count (for pagination) */
  total_count: number;
  /** Page number */
  page: number;
  /** Page size */
  page_size: number;
}

// ============================================================================
// ACTIVATION PROGRESS REPORT TYPES (Project > Zone > PON tracking)
// ============================================================================

/**
 * View mode for activation progress report
 */
export type ActivationProgressView = 'hierarchy' | 'flat';

/**
 * Time granularity for progress tracking
 */
export type ActivationProgressGranularity = 'daily' | 'weekly' | 'cumulative';

/**
 * PON-level progress data
 */
export interface PonProgressNode {
  pon_no: number;
  total_scope: number;
  activated: number;
  remaining: number;
  completion_percent: number;
}

/**
 * Zone-level progress data
 */
export interface ZoneProgressNode {
  zone_no: number;
  total_scope: number;
  activated: number;
  remaining: number;
  completion_percent: number;
  pons: PonProgressNode[];
}

/**
 * Project-level progress data
 */
export interface ProjectProgressNode {
  project_id: string;
  project_name: string;
  total_scope: number;
  activated: number;
  remaining: number;
  completion_percent: number;
  zones: ZoneProgressNode[];
}

/**
 * Flat row for table view
 */
export interface FlatProgressRow {
  project_name: string;
  project_id: string;
  zone_no: number;
  pon_no: number;
  total_scope: number;
  activated: number;
  remaining: number;
  completion_percent: number;
}

/**
 * Time series data point for charts
 */
export interface ActivationTimeSeriesPoint {
  date: string;
  label: string;
  activated: number;
  cumulative: number;
  total_scope: number;
  completion_percent: number;
}

/**
 * Summary statistics for activation progress
 */
export interface ActivationProgressSummary {
  total_scope: number;
  total_activated: number;
  total_remaining: number;
  completion_percent: number;
  activation_rate_per_day: number;
  days_in_range: number;
  first_activation_date: string | null;
  last_activation_date: string | null;
}

/**
 * API Response for activation progress report
 */
export interface ActivationProgressResponse {
  date_range: {
    from: string;
    to: string;
  };
  project: string | null;
  granularity: ActivationProgressGranularity;
  view: ActivationProgressView;
  summary: ActivationProgressSummary;
  hierarchy: ProjectProgressNode[];
  flat: FlatProgressRow[];
  time_series: ActivationTimeSeriesPoint[];
}

// ============================================================================
// MATURITY TRACKING REPORT TYPES (Uptake Velocity & Project Timeline)
// ============================================================================

/**
 * Milestone completion data
 */
export interface MilestoneData {
  /** Milestone percentage (e.g., 25, 50, 75, 90) */
  percent: number;
  /** Date milestone was reached (null if not yet reached) */
  reached_date: string | null;
  /** Days from first activation to reach this milestone */
  days_to_reach: number | null;
}

/**
 * Velocity metrics for uptake analysis
 */
export interface VelocityMetrics {
  /** Activations per week over last 4 weeks */
  last_4_weeks: number;
  /** Activations per week over last 12 weeks */
  last_12_weeks: number;
  /** Activations per week all-time */
  all_time: number;
  /** Week-over-week change percentage */
  wow_change_percent: number;
  /** Trend direction */
  trend: 'accelerating' | 'steady' | 'slowing' | 'stalled';
}

/**
 * Projection data for completion estimate
 */
export interface ProjectionData {
  /** Projected completion date at current velocity */
  projected_completion_date: string | null;
  /** Estimated days to completion */
  days_to_completion: number | null;
  /** Confidence level (based on velocity stability) */
  confidence: 'high' | 'medium' | 'low' | 'unknown';
  /** Weekly activations needed to hit target date (if set) */
  required_weekly_rate: number | null;
}

/**
 * PON-level maturity data
 */
export interface PonMaturityNode {
  pon_no: number;
  total_scope: number;
  activated: number;
  remaining: number;
  completion_percent: number;
  first_activation_date: string | null;
  latest_activation_date: string | null;
  age_days: number;
  milestones: MilestoneData[];
}

/**
 * Zone-level maturity data
 */
export interface ZoneMaturityNode {
  zone_no: number;
  total_scope: number;
  activated: number;
  remaining: number;
  completion_percent: number;
  first_activation_date: string | null;
  latest_activation_date: string | null;
  age_days: number;
  milestones: MilestoneData[];
  pons: PonMaturityNode[];
}

/**
 * Project-level maturity data
 */
export interface ProjectMaturityNode {
  project_id: string;
  project_name: string;
  total_scope: number;
  activated: number;
  remaining: number;
  completion_percent: number;
  first_activation_date: string | null;
  latest_activation_date: string | null;
  age_days: number;
  milestones: MilestoneData[];
  velocity: VelocityMetrics;
  projection: ProjectionData;
  zones: ZoneMaturityNode[];
}

/**
 * Flat row for maturity table view
 */
export interface FlatMaturityRow {
  project_id: string;
  project_name: string;
  zone_no: number;
  pon_no: number;
  total_scope: number;
  activated: number;
  remaining: number;
  completion_percent: number;
  first_activation_date: string | null;
  latest_activation_date: string | null;
  age_days: number;
  milestones: MilestoneData[];
  velocity: VelocityMetrics;
  projection: ProjectionData;
}

/**
 * Summary statistics for maturity tracking
 */
export interface MaturityTrackingSummary {
  /** Total projects tracked */
  total_projects: number;
  /** Total scope across all projects */
  total_scope: number;
  /** Total activated across all projects */
  total_activated: number;
  /** Total remaining across all projects */
  total_remaining: number;
  /** Average completion percentage */
  avg_completion_percent: number;
  /** Oldest project age in days */
  oldest_project_age_days: number;
  /** Youngest project age in days */
  youngest_project_age_days: number;
  /** Average age (days since first activation) */
  avg_age_days: number;
  /** Average days to reach 25% */
  avg_days_to_25_percent: number | null;
  /** Average days to reach 50% */
  avg_days_to_50_percent: number | null;
  /** Average days to reach 75% */
  avg_days_to_75_percent: number | null;
  /** Average days to reach 90% */
  avg_days_to_90_percent: number | null;
  /** Projects not started (0%) */
  projects_not_started: number;
  /** Projects in early stage (0-25%) */
  projects_early_stage: number;
  /** Projects in mid progress (25-75%) */
  projects_mid_progress: number;
  /** Projects near complete (75-99%) */
  projects_near_complete: number;
  /** Projects complete (100%) */
  projects_complete: number;
}

/**
 * API Response for maturity tracking report
 */
export interface MaturityTrackingResponse {
  /** As-of date for the report */
  as_of_date: string;
  /** Project filter (if any) */
  project: string | null;
  /** Summary statistics */
  summary: MaturityTrackingSummary;
  /** Hierarchical project data */
  hierarchy: ProjectMaturityNode[];
  /** Flat table data */
  flat: FlatMaturityRow[];
}
