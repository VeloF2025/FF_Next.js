/**
 * Activate Data Service
 *
 * Centralized API calls for the Activate module.
 * Used by ActivateDataContext for unified data fetching.
 */

import type {
  DailyCountsResponse,
  DiscrepancyReportResponse,
  SerialValidationReportResponse,
  UserTeamAttributionResponse,
} from '../types/reporting.types';
import {
  looksLikeOntSerial,
  looksLikeGizzuSerial,
  detectSwappedSerials,
  maskSerial,
} from './qaAutoFailService';

// ============================================================================
// TYPES
// ============================================================================

/** QA Workflow phases in order */
export type QaWizardPhase =
  | 'prerequisites'
  | 'photo_review'
  | 'data_validation'
  | 'final_decision'
  | 'feedback'
  | 'completed';

/** Final QA decision */
export type QaDecision = 'PASS' | 'FAIL' | 'REWORK_NEEDED';

/** Serial validation status for display */
export type SerialValidationStatus = 'valid' | 'swapped' | 'missing' | 'invalid';

/** Workflow phase order for progress calculation */
export const QA_PHASE_ORDER: QaWizardPhase[] = [
  'prerequisites',
  'photo_review',
  'data_validation',
  'final_decision',
  'feedback',
  'completed',
];

export interface DrListItem {
  id: string;
  dropNumber: string;
  project: string | null;
  reviewDate: string;
  completedPhotos: number;
  outstandingPhotos: number;
  /** Actual photo count from OneMap sync */
  photoCount: number;
  /** ONT serial from OneMap sync */
  ontSerial: string | null;
  /** UPS serial from OneMap sync */
  upsSerial: string | null;
  status: 'complete' | 'incomplete';
  feedbackSent: string | null;
  createdAt: string;
  submittedDate: string | null;
  senderPhone: string | null;

  // Rich Status Model (new fields)
  /** Whether DR exists in oes_activations table */
  isActivated: boolean;
  /** Current workflow phase */
  qaPhase: QaWizardPhase | null;
  /** Final QA decision */
  qaDecision: QaDecision | null;
  /** OES activation date (when activated on Nokia OES) */
  oesActivationDate: string | null;

  // Serial Validation (new fields)
  /** ONT serial validation status */
  ontSerialStatus: SerialValidationStatus;
  /** UPS serial validation status */
  upsSerialStatus: SerialValidationStatus;
  /** Whether serials appear to be swapped */
  serialsSwapped: boolean;
  /** Masked ONT serial for display */
  ontSerialMasked: string;
  /** Masked UPS serial for display */
  upsSerialMasked: string;

  // Maintenance Ticket (new fields)
  /** Whether DR has been referred to maintenance */
  hasMaintenanceTicket: boolean;
  /** UID of the maintenance ticket if exists */
  maintenanceTicketUid: string | null;
}

export interface DashboardStats {
  /** Total unique drops (counted once at first install/activation) */
  totalDrops: number;
  /** Unique valid DRs from WhatsApp in active projects */
  installed: number;
  /** DRs present in OES activation report (1-day lag) */
  activated: number;
  /** DRs not yet QA reviewed */
  notReviewed: number;
  /** DRs that have been QA reviewed */
  reviewed: number;
  /** DRs with feedback sent (legacy) */
  totalFeedback: number;
}

export interface ProjectStat {
  project: string;
  /** Total unique drops for this project */
  total: number;
  /** Unique valid DRs from WhatsApp */
  installed: number;
  /** DRs in OES activation report */
  activated: number;
  /** Not yet QA reviewed */
  notReviewed: number;
  /** QA reviewed */
  reviewed: number;
}

export interface DailyStat {
  project: string;
  date: string;
  total: number;
  installed: number;
  activated: number;
  notReviewed: number;
  reviewed: number;
}

export interface PaginationInfo {
  currentPage: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  totalCount: number;
}

export interface DropsApiResponse {
  success: boolean;
  data: DrListItem[];
  pagination: PaginationInfo;
  summary: DashboardStats & { dailyStats?: DailyStat[] };
  projectStats: ProjectStat[];
  /** All active projects for filter dropdown */
  activeProjects: string[];
}

export interface DropsFilters {
  dateFrom?: string;
  dateTo?: string;
  project?: string;
  status?: string;
  qaStatus?: string;
  page?: number;
  search?: string;
}

// ============================================================================
// SERIAL VALIDATION HELPER
// ============================================================================

/**
 * Calculate serial validation status for a given serial
 * @param serial - The serial to validate
 * @param expectedType - Whether this is expected to be 'ont' or 'ups'
 * @param otherSerial - The other serial (for swap detection)
 */
export function calculateSerialStatus(
  serial: string | null,
  expectedType: 'ont' | 'ups',
  otherSerial: string | null
): SerialValidationStatus {
  if (!serial) return 'missing';

  // Check for swapped serials
  const swapInfo = detectSwappedSerials(
    expectedType === 'ont' ? serial : otherSerial,
    expectedType === 'ups' ? serial : otherSerial
  );
  if (swapInfo.swapped) return 'swapped';

  // Check if serial matches expected format
  if (expectedType === 'ont') {
    return looksLikeOntSerial(serial) ? 'valid' : 'invalid';
  }
  return looksLikeGizzuSerial(serial) ? 'valid' : 'invalid';
}

/**
 * Get the phase index for progress calculation (0-5)
 */
export function getPhaseIndex(phase: QaWizardPhase | null): number {
  if (!phase) return 0;
  const index = QA_PHASE_ORDER.indexOf(phase);
  return index >= 0 ? index : 0;
}

// ============================================================================
// DATE HELPERS
// ============================================================================

export function getTodaySAST(): string {
  const now = new Date();
  const sastOffset = 2 * 60; // SAST is UTC+2
  const sastTime = new Date(
    now.getTime() + sastOffset * 60 * 1000 + now.getTimezoneOffset() * 60 * 1000
  );
  return sastTime.toISOString().split('T')[0] as string;
}

export function getYesterdaySAST(): string {
  const today = getTodaySAST();
  const yesterdayDate = new Date(today);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  return yesterdayDate.toISOString().split('T')[0] as string;
}

// ============================================================================
// API FUNCTIONS
// ============================================================================

/**
 * Fetch drops list with filters and pagination
 */
export async function fetchDrops(filters: DropsFilters = {}): Promise<DropsApiResponse> {
  const params = new URLSearchParams();

  if (filters.page) params.set('page', filters.page.toString());
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  if (filters.project && filters.project !== 'all') params.set('project', filters.project);
  if (filters.status && filters.status !== 'all') params.set('status', filters.status);
  if (filters.qaStatus && filters.qaStatus !== 'all') params.set('qaStatus', filters.qaStatus);
  if (filters.search && filters.search.trim()) params.set('search', filters.search.trim());

  const response = await fetch(`/api/activate/drops?${params.toString()}`);

  if (!response.ok) {
    throw new Error('Failed to fetch drops');
  }

  const data = await response.json();

  if (!data.success) {
    throw new Error(data.message || 'Failed to fetch drops');
  }

  // Transform API response
  const transformedDrops: DrListItem[] = data.data.map((drop: any) => {
    const ontSerial = drop.ont_serial_scanned || null;
    const upsSerial = drop.ups_serial_scanned || null;
    const swapInfo = detectSwappedSerials(ontSerial, upsSerial);

    return {
      id: drop.id,
      dropNumber: drop.drop_number,
      project: drop.project,
      reviewDate: drop.updated_at,
      completedPhotos: drop.steps_completed || 0,
      outstandingPhotos: (drop.steps_total || 10) - (drop.steps_completed || 0),
      photoCount: drop.photo_count || 0,
      ontSerial,
      upsSerial,
      status: drop.is_complete ? 'complete' : 'incomplete',
      feedbackSent: drop.feedback_sent ? drop.feedback_sent_at : null,
      createdAt: drop.created_at,
      submittedDate: drop.submitted_date || null,
      senderPhone: drop.sender_phone || null,

      // Rich Status Model
      isActivated: drop.is_activated || false,
      qaPhase: drop.qa_phase || null,
      qaDecision: drop.qa_decision || null,
      oesActivationDate: drop.oes_activation_date || null,

      // Serial Validation
      ontSerialStatus: calculateSerialStatus(ontSerial, 'ont', upsSerial),
      upsSerialStatus: calculateSerialStatus(upsSerial, 'ups', ontSerial),
      serialsSwapped: swapInfo.swapped,
      ontSerialMasked: maskSerial(ontSerial),
      upsSerialMasked: maskSerial(upsSerial),

      // Maintenance Ticket
      hasMaintenanceTicket: drop.has_maintenance_ticket || false,
      maintenanceTicketUid: drop.maintenance_ticket_uid || null,
    };
  });

  return {
    success: true,
    data: transformedDrops,
    pagination: data.pagination || {
      currentPage: 1,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
      totalCount: transformedDrops.length,
    },
    summary: data.summary || {
      totalDrops: transformedDrops.length,
      notReviewed: transformedDrops.filter((d) => !d.feedbackSent).length,
      reviewed: transformedDrops.filter((d) => d.feedbackSent).length,
      totalFeedback: transformedDrops.filter((d) => d.feedbackSent).length,
    },
    projectStats: data.projectStats || [],
    activeProjects: data.activeProjects || [],
  };
}

/**
 * Fetch daily counts report
 */
export async function fetchDailyCounts(
  dateFrom: string,
  dateTo: string,
  project?: string
): Promise<DailyCountsResponse> {
  const params = new URLSearchParams();
  params.set('dateFrom', dateFrom);
  params.set('dateTo', dateTo);
  if (project) params.set('project', project);

  const response = await fetch(`/api/activate/reporting/daily-counts?${params.toString()}`);

  if (!response.ok) {
    throw new Error('Failed to fetch daily counts');
  }

  return response.json();
}

/**
 * Fetch discrepancy report
 */
export async function fetchDiscrepancy(
  waDate: string,
  project?: string
): Promise<DiscrepancyReportResponse> {
  const params = new URLSearchParams();
  params.set('waDate', waDate);
  if (project) params.set('project', project);

  const response = await fetch(`/api/activate/reporting/discrepancy?${params.toString()}`);

  if (!response.ok) {
    throw new Error('Failed to fetch discrepancy report');
  }

  return response.json();
}

/**
 * Fetch serial validation report
 */
export async function fetchSerialValidation(
  dateFrom: string,
  dateTo: string,
  project?: string
): Promise<SerialValidationReportResponse> {
  const params = new URLSearchParams();
  params.set('dateFrom', dateFrom);
  params.set('dateTo', dateTo);
  if (project) params.set('project', project);

  const response = await fetch(`/api/activate/reporting/serial-validation?${params.toString()}`);

  if (!response.ok) {
    throw new Error('Failed to fetch serial validation report');
  }

  return response.json();
}

/**
 * Fetch user/team attribution report
 */
export async function fetchUserAttribution(
  dateFrom: string,
  dateTo: string,
  project?: string
): Promise<UserTeamAttributionResponse> {
  const params = new URLSearchParams();
  params.set('dateFrom', dateFrom);
  params.set('dateTo', dateTo);
  if (project) params.set('project', project);

  const response = await fetch(`/api/activate/reporting/user-attribution?${params.toString()}`);

  if (!response.ok) {
    throw new Error('Failed to fetch user attribution report');
  }

  return response.json();
}
