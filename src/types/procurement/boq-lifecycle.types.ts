/** Types for BOQ Procurement Lifecycle tracking. */

export type LifecycleStatus =
  | 'not_started'
  | 'ordered'
  | 'partially_delivered'
  | 'delivered'
  | 'invoiced'
  | 'partially_paid'
  | 'paid';

export interface LinkedPO {
  id: string;
  poNumber: string;
  orderedQty: number;
  orderedValue: number;
  status: string;
}

export interface LinkedGRN {
  id: string;
  grnNumber: string;
  receivedQty: number;
  status: string;
}

export interface LinkedInvoice {
  id: string;
  invoiceNumber: string;
  invoicedValue: number;
  paidValue: number;
  status: string;
}

export interface BOQLifecycleLine {
  boqItemId: string;
  itemCode: string | null;
  description: string;
  uom: string;
  boqQty: number;
  boqValue: number;
  orderedQty: number;
  orderedValue: number;
  receivedQty: number;
  receivedValue: number;
  invoicedValue: number;
  paidValue: number;
  lifecycleStatus: LifecycleStatus;
  linkedPOs: LinkedPO[];
  linkedGRNs: LinkedGRN[];
  linkedInvoices: LinkedInvoice[];
}

export interface BOQLifecycleSummary {
  totalBoqValue: number;
  totalOrderedValue: number;
  totalReceivedValue: number;
  totalInvoicedValue: number;
  totalPaidValue: number;
  orderedPercent: number;
  receivedPercent: number;
  invoicedPercent: number;
  paidPercent: number;
}

export interface BOQLifecycleResponse {
  summary: BOQLifecycleSummary;
  lines: BOQLifecycleLine[];
}
