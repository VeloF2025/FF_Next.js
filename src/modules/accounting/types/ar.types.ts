/**
 * PRD-060: FibreFlow Accounting Module
 * Accounts Receivable Type Definitions
 */

export type CustomerPaymentStatus = 'draft' | 'confirmed' | 'reconciled' | 'cancelled';
export type CreditNoteType = 'customer' | 'supplier';
export type CreditNoteStatus = 'draft' | 'approved' | 'applied' | 'cancelled';

// ── Customer Payments ────────────────────────────────────────────────────────

export interface CustomerPayment {
  id: string;
  paymentNumber: string;
  clientId: string;
  paymentDate: string;
  totalAmount: number;
  paymentMethod: 'eft' | 'cheque' | 'cash' | 'card';
  bankReference?: string;
  bankAccountId?: string;
  description?: string;
  status: CustomerPaymentStatus;
  glJournalEntryId?: string;
  projectId?: string;
  createdBy: string;
  confirmedBy?: string;
  confirmedAt?: string;
  createdAt: string;
  updatedAt: string;
  // Joined
  clientName?: string;
  allocations?: CustomerPaymentAllocation[];
}

export interface CustomerPaymentAllocation {
  id: string;
  paymentId: string;
  invoiceId: string;
  amountAllocated: number;
  createdAt: string;
  // Joined
  invoiceNumber?: string;
}

export interface CustomerPaymentCreateInput {
  clientId: string;
  paymentDate: string;
  totalAmount: number;
  paymentMethod?: 'eft' | 'cheque' | 'cash' | 'card';
  bankReference?: string;
  bankAccountId?: string;
  description?: string;
  projectId?: string;
  allocations: { invoiceId: string; amount: number }[];
}

// ── Credit Notes ─────────────────────────────────────────────────────────────

export interface CreditNote {
  id: string;
  creditNoteNumber: string;
  type: CreditNoteType;
  clientId?: string;
  customerInvoiceId?: string;
  supplierId?: string;
  supplierInvoiceId?: string;
  creditDate: string;
  reason?: string;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  totalAmount: number;
  status: CreditNoteStatus;
  glJournalEntryId?: string;
  projectId?: string;
  createdBy: string;
  approvedBy?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
  // Joined
  clientName?: string;
  supplierName?: string;
  invoiceNumber?: string;
}

export interface CreditNoteCreateInput {
  type: CreditNoteType;
  clientId?: string;
  customerInvoiceId?: string;
  supplierId?: string;
  supplierInvoiceId?: string;
  creditDate: string;
  reason?: string;
  subtotal: number;
  taxRate?: number;
  projectId?: string;
}
