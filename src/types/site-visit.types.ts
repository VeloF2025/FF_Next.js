/**
 * Site Visit Types
 * Created: 2026-04-06
 *
 * Data structures for the site visit scheduling and reporting system.
 */

// ==================== ENUMS ====================

export const SITE_VISIT_TYPES = ['inspection', 'progress_check', 'handover', 'safety_audit'] as const;
export type SiteVisitType = typeof SITE_VISIT_TYPES[number];

export const SITE_VISIT_STATUSES = ['scheduled', 'completed', 'cancelled', 'no_show'] as const;
export type SiteVisitStatus = typeof SITE_VISIT_STATUSES[number];

// ==================== CORE INTERFACE ====================

export interface SiteVisit {
  id: string;
  projectId: string;
  contractorId: string | null;

  scheduledDate: string;   // ISO date YYYY-MM-DD
  actualDate: string | null;

  visitType: SiteVisitType;
  status: SiteVisitStatus;

  inspectorName: string;
  inspectorId: string | null;

  notes: string | null;
  findings: string | null;
  actionItems: string[];
  attachments: string[];

  createdAt: string;
  updatedAt: string;
}

// ==================== WITH JOIN DETAILS ====================

export interface SiteVisitWithDetails extends SiteVisit {
  projectName: string | null;
  projectCode: string | null;
  contractorName: string | null;
}

// ==================== FORM DATA ====================

export interface SiteVisitFormData {
  projectId: string;
  contractorId?: string | null;
  scheduledDate: string;
  visitType: SiteVisitType;
  inspectorName: string;
  notes?: string;
}

export interface CompleteVisitFormData {
  actualDate: string;
  findings?: string;
  actionItems?: string[];
  notes?: string;
}

export interface UpdateVisitFormData {
  status?: SiteVisitStatus;
  actualDate?: string;
  findings?: string;
  actionItems?: string[];
  notes?: string;
  inspectorName?: string;
}

// ==================== FILTERS ====================

export interface SiteVisitFilter {
  projectId?: string;
  contractorId?: string;
  status?: SiteVisitStatus;
  fromDate?: string;
  toDate?: string;
}
