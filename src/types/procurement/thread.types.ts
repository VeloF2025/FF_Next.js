/** Lifecycle state of a procurement thread. */
export type ThreadStatus = 'active' | 'completed' | 'cancelled' | 'on_hold';

/** Procurement route selected at Step 2 (Strategy). */
export type ThreadStrategy = 'rfq' | 'direct_po';

/** Full procurement thread as stored in DB. */
export interface ProcurementThread {
  id: string;
  threadNumber: string;
  title: string | null;
  description: string | null;
  projectId: string | null;
  projectName?: string | null;
  requisitionId: string | null;
  requisitionNumber?: string | null;
  rfqId: string | null;
  quoteId: string | null;
  poId: string | null;
  poNumber?: string | null;
  grnId: string | null;
  paymentApprovalId: string | null;
  currentStep: number;
  strategy: ThreadStrategy | null;
  status: ThreadStatus;
  estimatedTotal: number | null;
  poTotal: number | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Lightweight view for list/table rendering. */
export interface ProcurementThreadListItem {
  id: string;
  threadNumber: string;
  title: string | null;
  projectId: string | null;
  projectName: string | null;
  requisitionId: string | null;
  requisitionNumber: string | null;
  poId: string | null;
  poNumber: string | null;
  currentStep: number;
  strategy: ThreadStrategy | null;
  status: ThreadStatus;
  estimatedTotal: number | null;
  poTotal: number | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
