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

// ============================================================================
// TYPES
// ============================================================================

export interface DrListItem {
  id: string;
  dropNumber: string;
  project: string | null;
  reviewDate: string;
  completedPhotos: number;
  outstandingPhotos: number;
  status: 'complete' | 'incomplete';
  feedbackSent: string | null;
  createdAt: string;
  submittedDate: string | null;
  senderPhone: string | null;
}

export interface DashboardStats {
  /** Total unique drops (counted once at first install/activation) */
  totalDrops: number;
  /** Unique valid DRs from WhatsApp in active projects */
  installed: number;
  /** DRs present in OES activation report (1-day lag) */
  activated: number;
  /** DRs not yet fully QA reviewed */
  incomplete: number;
  /** DRs marked complete by HITL or AI */
  complete: number;
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
  incomplete: number;
  /** Marked complete by HITL/AI */
  complete: number;
}

export interface DailyStat {
  project: string;
  date: string;
  total: number;
  installed: number;
  activated: number;
  incomplete: number;
  complete: number;
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
}

export interface DropsFilters {
  dateFrom?: string;
  dateTo?: string;
  project?: string;
  status?: string;
  page?: number;
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

  const response = await fetch(`/api/activate/drops?${params.toString()}`);

  if (!response.ok) {
    throw new Error('Failed to fetch drops');
  }

  const data = await response.json();

  if (!data.success) {
    throw new Error(data.message || 'Failed to fetch drops');
  }

  // Transform API response
  const transformedDrops: DrListItem[] = data.data.map((drop: any) => ({
    id: drop.id,
    dropNumber: drop.drop_number,
    project: drop.project,
    reviewDate: drop.updated_at,
    completedPhotos: drop.steps_completed || 0,
    outstandingPhotos: (drop.steps_total || 10) - (drop.steps_completed || 0),
    status: drop.is_complete ? 'complete' : 'incomplete',
    feedbackSent: drop.feedback_sent ? drop.feedback_sent_at : null,
    createdAt: drop.created_at,
    submittedDate: drop.submitted_date || null,
    senderPhone: drop.sender_phone || null,
  }));

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
      incomplete: transformedDrops.filter((d) => d.status === 'incomplete').length,
      complete: transformedDrops.filter((d) => d.status === 'complete').length,
      totalFeedback: transformedDrops.filter((d) => d.feedbackSent).length,
    },
    projectStats: data.projectStats || [],
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
