/**
 * Customer Invoice Types
 * Invoices generated from OES activations against Client POs
 */

export type CustomerInvoiceStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'sent'
  | 'paid'
  | 'partially_paid'
  | 'overdue'
  | 'cancelled';

export type IncomeType = 'activation' | 'bonus' | 'adjustment' | 'other';

export interface CustomerInvoice {
  id: string;
  invoiceNumber: string;
  projectId: string;
  clientId: string;
  clientPoId?: string;

  // Billing period
  billingPeriodStart: string;
  billingPeriodEnd: string;

  // Amounts
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  totalAmount: number;
  amountPaid: number;

  // Status
  status: CustomerInvoiceStatus;

  // Dates
  invoiceDate: string;
  dueDate?: string;
  sentAt?: string;
  paidAt?: string;

  // Notes
  notes?: string;
  internalNotes?: string;

  // Audit
  createdBy: string;
  approvedBy?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;

  // Joined data
  clientName?: string;
  projectName?: string;
  clientPoNumber?: string;

  // Line items (when fetched with detail)
  items?: CustomerInvoiceItem[];
}

export interface CustomerInvoiceItem {
  id: string;
  invoiceId: string;
  dropId?: string;
  oesActivationId?: string;
  dropNumber: string;
  activationDate?: string;
  description?: string;
  unitPrice: number;
  quantity: number;
  taxAmount: number;
  lineTotal: number;
  incomeType: IncomeType;
  createdAt: string;
}

export interface CustomerInvoiceCreateInput {
  clientPoId?: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  taxRate?: number;
  dueDate?: string;
  notes?: string;
  internalNotes?: string;
  items?: CustomerInvoiceItemInput[];
}

export interface CustomerInvoiceItemInput {
  dropId?: string;
  oesActivationId?: string;
  dropNumber: string;
  activationDate?: string;
  description?: string;
  unitPrice: number;
  quantity?: number;
  incomeType?: IncomeType;
}

export interface CustomerInvoiceUpdateInput {
  taxRate?: number;
  dueDate?: string;
  notes?: string;
  internalNotes?: string;
}

export interface GenerateInvoiceInput {
  clientPoId?: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  dueDate?: string;
  notes?: string;
}

export interface GenerateInvoicePreview {
  clientPoId?: string;
  clientPoNumber?: string;
  pricePerDrop: number;
  taxRate: number;
  drops: UninvoicedDrop[];
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
}

export interface UninvoicedDrop {
  dropId: string;
  dropNumber: string;
  lid?: string;
  clientPoId?: string;
  clientPoNumber?: string;
  activationDate: string;
  pricePerDrop: number;
}

export interface RecordPaymentInput {
  amount: number;
  paymentDate?: string;
  reference?: string;
  notes?: string;
}

export interface CustomerInvoiceSummary {
  totalInvoiced: number;
  totalPaid: number;
  totalOutstanding: number;
  invoiceCount: number;
  draftCount: number;
  pendingApprovalCount: number;
  sentCount: number;
  overdueCount: number;
}
