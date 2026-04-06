/**
 * Contractor Payment Types
 * Created: 2026-04-06
 *
 * Defines data structures for tracking payments to contractors
 * per project assignment.
 */

// ==================== CORE INTERFACE ====================

export interface ContractorPayment {
  id: string;          // UUID
  contractorId: string;
  contractorProjectId: number | null;

  // Payment details
  amount: number;
  paymentDate: Date;
  reference: string | null;
  notes: string | null;

  // Audit
  recordedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ==================== WITH PROJECT DETAILS ====================

export interface ContractorPaymentWithDetails extends ContractorPayment {
  projectName: string | null;
  projectCode: string | null;
  role: string | null;
}

// ==================== FORM DATA ====================

export interface ContractorPaymentFormData {
  amount: number;
  paymentDate: string;        // ISO date string YYYY-MM-DD
  reference?: string;
  notes?: string;
  contractorProjectId?: number;
}

// ==================== FILTERS ====================

export interface ContractorPaymentFilter {
  contractorId: string;
  fromDate?: string;   // ISO date string
  toDate?: string;     // ISO date string
}

// ==================== SUMMARY ====================

export interface ContractorPaymentSummary {
  totalPaid: number;
  paymentCount: number;
  lastPaymentDate: Date | null;
}
