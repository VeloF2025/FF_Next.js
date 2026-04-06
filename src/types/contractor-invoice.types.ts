/**
 * Contractor Invoice Types
 * Created: 2026-04-06
 *
 * Defines data structures for the full invoice / progress claim lifecycle.
 * Status flow: submitted → under_review → approved → paid
 *              approved → rejected (with reason)
 */

// ==================== STATUS ENUM ====================

export type ContractorInvoiceStatus =
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'paid'
  | 'rejected';

export const CONTRACTOR_INVOICE_STATUSES: ContractorInvoiceStatus[] = [
  'submitted',
  'under_review',
  'approved',
  'paid',
  'rejected',
];

// ==================== LINE ITEM ====================

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
}

// ==================== CORE INTERFACE ====================

export interface ContractorInvoice {
  id: string;               // UUID
  contractorId: string;
  contractorProjectId: number | null;
  invoiceNumber: string;
  status: ContractorInvoiceStatus;
  lineItems: InvoiceLineItem[];
  totalAmount: number;
  rejectionReason: string | null;
  notes: string | null;
  createdBy: string | null; // UUID
  createdAt: Date;
  updatedAt: Date;
}

// ==================== WITH PROJECT DETAILS ====================

export interface ContractorInvoiceWithDetails extends ContractorInvoice {
  projectName: string | null;
  projectCode: string | null;
  role: string | null;
}

// ==================== FORM DATA ====================

export interface ContractorInvoiceFormData {
  invoiceNumber: string;
  contractorProjectId?: number;
  lineItems: InvoiceLineItem[];
  totalAmount: number;
  notes?: string;
  /** Optional: IDs of approved progress claims to bundle into this invoice */
  claimIds?: string[];
}

// ==================== ACTION (STATUS TRANSITION) ====================

export type ContractorInvoiceAction = 'submit' | 'review' | 'approve' | 'pay' | 'reject';

export interface ContractorInvoiceActionPayload {
  action: ContractorInvoiceAction;
  rejectionReason?: string;
  notes?: string;
}

// ==================== VALID TRANSITIONS ====================

/**
 * Maps each action to its required current status and resulting status.
 */
export const INVOICE_TRANSITIONS: Record<
  ContractorInvoiceAction,
  { from: ContractorInvoiceStatus; to: ContractorInvoiceStatus }
> = {
  submit:  { from: 'submitted',     to: 'submitted' },    // idempotent re-submit not used; kept for completeness
  review:  { from: 'submitted',     to: 'under_review' },
  approve: { from: 'under_review',  to: 'approved' },
  pay:     { from: 'approved',      to: 'paid' },
  reject:  { from: 'approved',      to: 'rejected' },
};

// ==================== FILTERS ====================

export interface ContractorInvoiceFilter {
  contractorId: string;
  status?: ContractorInvoiceStatus;
}

// ==================== SUMMARY ====================

export interface ContractorInvoiceSummary {
  totalInvoiced: number;
  totalApproved: number;
  totalPaid: number;
  invoiceCount: number;
}
