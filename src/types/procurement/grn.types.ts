// ============= Goods Receipt Note Types =============
// PRD-050: Comprehensive Procurement Portal - Phase 1

// Status enums
export type GRNStatus =
  | 'draft'
  | 'receiving'
  | 'inspecting'
  | 'completed'
  | 'partial'
  | 'rejected'
  | 'cancelled';

export type InspectionStatus = 'pending' | 'passed' | 'failed' | 'partial';

// ============= Goods Receipt Note =============

export interface GoodsReceiptNote {
  id: string;
  grnNumber: string;

  // Source linkage
  purchaseOrderId?: string;
  purchaseOrderNumber?: string;
  supplierId: number;
  supplierName?: string;

  // Delivery details
  deliveryDate: string;
  deliveryNoteNumber?: string;
  carrier?: string;
  vehicleNumber?: string;

  // Location
  warehouseId: string;
  warehouseName?: string;
  receivingBay?: string;

  // Status
  status: GRNStatus;

  // Inspection
  inspectionRequired: boolean;
  inspectedBy?: string;
  inspectedAt?: string;
  inspectionStatus?: InspectionStatus;
  inspectionNotes?: string;

  // Totals
  totalItems: number;
  totalQuantityExpected: number;
  totalQuantityReceived: number;
  totalQuantityRejected: number;

  // Discrepancy handling
  hasDiscrepancy: boolean;
  discrepancyNotes?: string;
  discrepancyResolved: boolean;
  discrepancyResolvedBy?: string;
  discrepancyResolvedAt?: string;

  // Personnel
  receivedBy: string;
  receivedByName?: string;
  verifiedBy?: string;
  verifiedAt?: string;

  notes?: string;

  // Items
  items?: GoodsReceiptItem[];

  // Timestamps
  createdAt: string;
  updatedAt: string;
}

// ============= Goods Receipt Item =============

export interface GoodsReceiptItem {
  id: string;
  grnId: string;
  poItemId?: string;

  // Item reference
  stockItemId?: string;
  itemCode?: string;
  itemDescription?: string;

  // Quantities
  quantityExpected?: number;
  quantityReceived: number;
  quantityRejected: number;
  quantityAccepted: number; // Computed: received - rejected
  uom: string;

  // Serial tracking
  serialNumbers?: string[];

  // Lot tracking
  lotNumber?: string;
  batchNumber?: string;
  manufactureDate?: string;
  expiryDate?: string;

  // Location assignment
  locationId?: string;
  binLocation?: string;

  // Quality inspection
  inspectionStatus?: InspectionStatus;
  rejectionReason?: string;
  rejectionCode?: string;

  // Valuation
  unitCost?: number;
  totalCost?: number;

  notes?: string;
  createdAt: string;
}

// ============= Form Types =============

export interface CreateGRNRequest {
  purchaseOrderId?: string;
  supplierId: number;
  warehouseId: string;
  deliveryNoteNumber?: string;
  carrier?: string;
  vehicleNumber?: string;
  receivingBay?: string;
  inspectionRequired?: boolean;
  notes?: string;
  items: CreateGRNItemRequest[];
}

export interface CreateGRNItemRequest {
  poItemId?: string;
  stockItemId?: string;
  itemCode?: string;
  itemDescription?: string;
  quantityExpected?: number;
  quantityReceived: number;
  quantityRejected?: number;
  uom: string;
  serialNumbers?: string[];
  lotNumber?: string;
  batchNumber?: string;
  manufactureDate?: string;
  expiryDate?: string;
  locationId?: string;
  binLocation?: string;
  unitCost?: number;
  notes?: string;
}

export interface UpdateGRNRequest {
  deliveryNoteNumber?: string;
  carrier?: string;
  vehicleNumber?: string;
  receivingBay?: string;
  notes?: string;
}

export interface CompleteGRNRequest {
  id: string;
  verifiedBy?: string;
}

export interface InspectGRNItemRequest {
  itemId: string;
  inspectionStatus: InspectionStatus;
  rejectionReason?: string;
  rejectionCode?: string;
  quantityRejected?: number;
}

export interface ResolveDiscrepancyRequest {
  id: string;
  notes: string;
}

// ============= List & Filter Types =============

export interface GRNFilters {
  purchaseOrderId?: string;
  supplierId?: number;
  warehouseId?: string;
  status?: GRNStatus[];
  hasDiscrepancy?: boolean;
  inspectionStatus?: InspectionStatus[];
  dateRange?: {
    start: string;
    end: string;
  };
  searchTerm?: string;
}

export interface GRNListItem {
  id: string;
  grnNumber: string;
  purchaseOrderNumber?: string;
  supplierName?: string;
  warehouseName?: string;
  deliveryDate: string;
  status: GRNStatus;
  totalItems: number;
  totalQuantityReceived: number;
  totalQuantityRejected: number;
  hasDiscrepancy: boolean;
  inspectionStatus?: InspectionStatus;
  receivedByName?: string;
  createdAt: string;
}

// ============= Statistics =============

export interface GRNStats {
  total: number;
  byStatus: Record<GRNStatus, number>;
  totalItemsReceived: number;
  totalItemsRejected: number;
  discrepancyRate: number;
  averageReceivingTime: number;
  pendingInspection: number;
}

// ============= 3-Way Matching =============

export interface ThreeWayMatch {
  poNumber: string;
  grnNumber: string;
  invoiceNumber?: string;

  poAmount: number;
  grnAmount: number;
  invoiceAmount?: number;

  quantityOrdered: number;
  quantityReceived: number;
  quantityInvoiced?: number;

  matchStatus: 'matched' | 'partial' | 'discrepancy';
  discrepancies?: MatchDiscrepancy[];
}

export interface MatchDiscrepancy {
  field: 'quantity' | 'price' | 'total';
  expected: number;
  actual: number;
  variance: number;
  variancePercent: number;
}
