/**
 * Contractor Progress Claim Types
 * Created: 2026-04-06
 *
 * Defines data structures for progress claims submitted by contractors
 * against project assignments.
 *
 * Status flow: pending → approved (with amount_approved)
 *              pending → rejected (with review_notes)
 *              approved → invoiced (when included in an invoice)
 */

// ==================== STATUS ENUM ====================

export type ContractorClaimStatus = 'pending' | 'approved' | 'rejected' | 'invoiced';

export const CONTRACTOR_CLAIM_STATUSES: ContractorClaimStatus[] = [
  'pending',
  'approved',
  'rejected',
  'invoiced',
];

// ==================== CORE INTERFACE ====================

export interface ContractorProgressClaim {
  id: string;
  contractorId: string;
  contractorProjectId: number | null;

  claimNumber: number;
  claimDate: Date;
  periodStart: Date;
  periodEnd: Date;
  description: string;

  amountClaimed: number;
  amountApproved: number | null;

  status: ContractorClaimStatus;

  submittedBy: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewNotes: string | null;

  invoiceId: string | null;

  createdAt: Date;
  updatedAt: Date;
}

// ==================== WITH PROJECT DETAILS ====================

export interface ContractorProgressClaimWithDetails extends ContractorProgressClaim {
  projectName: string | null;
  projectCode: string | null;
  role: string | null;
}

// ==================== FORM DATA ====================

export interface ContractorProgressClaimFormData {
  contractorProjectId?: number;
  claimDate: string;       // ISO date YYYY-MM-DD
  periodStart: string;     // ISO date YYYY-MM-DD
  periodEnd: string;       // ISO date YYYY-MM-DD
  description: string;
  amountClaimed: number;
}

// ==================== REVIEW PAYLOAD ====================

export type ContractorClaimReviewAction = 'approve' | 'reject';

export interface ContractorClaimReviewPayload {
  action: ContractorClaimReviewAction;
  amountApproved?: number;  // required for approve
  reviewNotes?: string;
}

// ==================== FILTERS ====================

export interface ContractorClaimFilter {
  contractorId: string;
  status?: ContractorClaimStatus;
}

// ==================== SUMMARY ====================

export interface ContractorClaimSummary {
  totalClaimed: number;
  totalApproved: number;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  invoicedCount: number;
}
