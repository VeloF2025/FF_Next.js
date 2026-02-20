// ============= Purchase Requisition Types =============
// PRD-050: Comprehensive Procurement Portal - Phase 1

// Status enums
export type RequisitionStatus =
  | 'draft'
  | 'submitted'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'ordered'
  | 'partially_ordered'
  | 'closed'
  | 'cancelled';

export type RequisitionUrgency = 'low' | 'normal' | 'high' | 'critical';

// ============= Purchase Requisition =============

export interface PurchaseRequisition {
  id: string;
  requisitionNumber: string;

  // Context
  projectId?: string;
  department?: string;

  // Requestor
  requestedBy: string;
  requestedByName?: string;
  requestedDate: string;
  requiredDate?: string;

  // Approval
  status: RequisitionStatus;
  approvedBy?: string;
  approvedAt?: string;
  rejectionReason?: string;

  // Financials
  estimatedTotal?: number;
  currency: string;

  // Tracking
  urgency: RequisitionUrgency;
  notes?: string;

  // Items
  items?: PurchaseRequisitionItem[];
  itemCount?: number;

  // Approval workflow
  approvalRequestId?: string | null;

  // Timestamps
  createdAt: string;
  updatedAt: string;
}

// ============= Purchase Requisition Item =============

export interface PurchaseRequisitionItem {
  id: string;
  requisitionId: string;

  // Item reference
  stockItemId?: string;
  itemCode?: string;
  itemDescription: string;

  // Quantities
  quantity: number;
  uom: string;
  estimatedUnitPrice?: number;
  estimatedTotal?: number;

  // Supplier suggestion
  suggestedSupplierId?: number;
  suggestedSupplierName?: string;

  notes?: string;

  // Conversion tracking
  convertedToRfq: boolean;
  convertedToPo: boolean;
  rfqId?: string;
  poId?: string;

  // Timestamps
  createdAt: string;
}

// ============= Form Types =============

export interface CreateRequisitionRequest {
  projectId?: string;
  department?: string;
  requiredDate?: string;
  urgency?: RequisitionUrgency;
  notes?: string;
  items: CreateRequisitionItemRequest[];
}

export interface CreateRequisitionItemRequest {
  stockItemId?: string;
  itemCode?: string;
  itemDescription: string;
  quantity: number;
  uom: string;
  estimatedUnitPrice?: number;
  suggestedSupplierId?: number;
  notes?: string;
}

export interface UpdateRequisitionRequest {
  requiredDate?: string;
  urgency?: RequisitionUrgency;
  notes?: string;
}

export interface SubmitRequisitionRequest {
  id: string;
}

export interface ApproveRequisitionRequest {
  id: string;
  notes?: string;
}

export interface RejectRequisitionRequest {
  id: string;
  reason: string;
}

// ============= List & Filter Types =============

export interface RequisitionFilters {
  projectId?: string;
  department?: string;
  status?: RequisitionStatus[];
  urgency?: RequisitionUrgency[];
  requestedBy?: string;
  dateRange?: {
    start: string;
    end: string;
  };
  searchTerm?: string;
}

export interface RequisitionListItem {
  id: string;
  requisitionNumber: string;
  projectId?: string;
  projectName?: string;
  department?: string;
  requestedByName?: string;
  requestedDate: string;
  requiredDate?: string;
  status: RequisitionStatus;
  urgency: RequisitionUrgency;
  estimatedTotal?: number;
  currency: string;
  itemCount: number;
  createdAt: string;
}

// ============= Statistics =============

export interface RequisitionStats {
  total: number;
  byStatus: Record<RequisitionStatus, number>;
  byUrgency: Record<RequisitionUrgency, number>;
  totalEstimatedValue: number;
  averageApprovalDays: number;
  pendingApproval: number;
}
