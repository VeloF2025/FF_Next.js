// ============= Purchase Order Types =============

export interface PurchaseOrder {
  id: string;
  projectId: string;
  
  // PO Details
  poNumber: string;
  rfqId?: string; // Source RFQ if created from RFQ
  quoteId?: string; // Source Quote if created from quote
  supplierId: number; // Database uses integer
  
  // Basic Information
  title: string;
  description?: string;
  orderType: POOrderType;
  
  // Status and Workflow
  status: POStatus;
  approvalStatus: POApprovalStatus;
  
  // Approval Workflow
  approvalWorkflow?: POApprovalWorkflow;
  currentApprovalLevel?: ApprovalLevel;
  
  // Supplier Information
  supplier: POSupplier;
  
  // Financial Details
  currency: string;
  subtotal: number;
  taxAmount: number;
  discountAmount?: number;
  totalAmount: number;
  
  // Terms and Conditions
  paymentTerms: string;
  deliveryTerms: string;
  validityPeriod?: number; // days
  warrantyPeriod?: number; // days
  retentionPercentage?: number;
  
  // Delivery Information
  deliveryAddress: POAddress;
  expectedDeliveryDate?: Date;
  actualDeliveryDate?: Date;
  partialDeliveryAllowed: boolean;
  
  // Timeline
  issuedAt?: Date;
  sentAt?: Date;
  acknowledgedAt?: Date;
  lastModifiedAt: Date;
  
  // Created By
  createdBy: string;
  issuedBy?: string;
  approvedBy?: string[];
  
  // Tracking
  deliveryStatus: PODeliveryStatus;
  invoiceStatus: POInvoiceStatus;
  
  // Notes and Communications
  notes?: string;
  internalNotes?: string;
  supplierComments?: string;
  
  // Amendments
  amendmentCount: number;
  originalPOId?: string; // If this is an amendment
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

export interface POItem {
  id: string;
  poId: string;
  rfqItemId?: string;
  
  // Item Details
  lineNumber: number;
  itemCode?: string;
  description: string;
  category?: string;
  
  // Quantities
  quantity: number;
  uom: string;
  unitPrice: number;
  lineTotal: number;
  
  // Delivery Tracking
  quantityDelivered: number;
  quantityPending: number;
  quantityInvoiced: number;
  
  // Specifications
  specifications?: Record<string, unknown>;
  technicalRequirements?: string;
  
  // Delivery Schedule
  expectedDeliveryDate?: Date;
  actualDeliveryDate?: Date;
  
  // Status
  itemStatus: POItemStatus;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

export interface POSupplier {
  id: string;
  name: string;
  code?: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
  
  // Address
  address?: POAddress;
  
  // Banking Details (for payments)
  bankDetails?: POBankDetails;
  
  // Tax Information
  taxNumber?: string;
  vatNumber?: string;
}

export interface POAddress {
  street: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
}

export interface POBankDetails {
  bankName: string;
  accountNumber: string;
  branchCode: string;
  accountType: string;
}

export interface POApprovalWorkflow {
  id: string;
  name: string;
  steps: POApprovalStep[];
  currentStep: number;
  isCompleted: boolean;
  
  // Workflow metadata
  totalSteps: number;
  completedSteps: number;
  
  // Timestamps
  startedAt: Date;
  completedAt?: Date;
}

export interface POApprovalStep {
  id: string;
  level: ApprovalLevel;
  approverRole: string;
  requiredApprovers: number;
  
  // Status
  status: ApprovalStepStatus;
  
  // Approvals
  approvals: POApproval[];
  
  // Conditions
  conditions?: POApprovalCondition[];
  
  // Timestamps
  startedAt?: Date;
  completedAt?: Date;
  dueAt?: Date;
}

export interface POApproval {
  id: string;
  approverId: string;
  approverName: string;
  approverRole: string;
  
  decision: ApprovalDecision;
  comments?: string;
  
  approvedAt: Date;
}

export interface POApprovalCondition {
  field: string;
  operator: 'equals' | 'greater' | 'less' | 'contains';
  value: unknown;
}

export interface PODeliveryNote {
  id: string;
  poId: string;
  deliveryNoteNumber: string;
  
  // Delivery Details
  deliveredBy: string;
  receivedBy: string;
  deliveryDate: Date;
  
  // Items Delivered
  items: PODeliveryItem[];
  
  // Status
  status: DeliveryNoteStatus;
  
  // Notes
  deliveryNotes?: string;
  receivingNotes?: string;
  
  // Quality Check
  qualityCheckPassed?: boolean;
  qualityNotes?: string;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

export interface PODeliveryItem {
  id: string;
  poItemId: string;
  quantityDelivered: number;
  condition: ItemCondition;
  notes?: string;
}

export interface POInvoice {
  id: string;
  poId: string;
  invoiceNumber: string;
  
  // Financial Details
  invoiceAmount: number;
  taxAmount: number;
  totalAmount: number;
  
  // Matching Status
  matchingStatus: InvoiceMatchingStatus;
  matchingNotes?: string;
  
  // Items
  items: POInvoiceItem[];
  
  // Dates
  invoiceDate: Date;
  dueDate: Date;
  receivedDate: Date;
  
  // Payment
  paymentStatus: PaymentStatus;
  paidDate?: Date;
  paymentReference?: string;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

export interface POInvoiceItem {
  id: string;
  poItemId: string;
  quantityInvoiced: number;
  unitPrice: number;
  lineTotal: number;
}

export interface POAmendment {
  id: string;
  originalPOId: string;
  amendmentNumber: number;
  
  // Amendment Details
  reason: string;
  description: string;
  changeType: AmendmentType;
  
  // Changes
  changes: POChange[];
  
  // Financial Impact
  previousTotal: number;
  newTotal: number;
  changeAmount: number;
  
  // Approval
  approvalStatus: POApprovalStatus;
  approvedBy?: string;
  approvedAt?: Date;
  
  // Status
  status: AmendmentStatus;
  
  // Created By
  createdBy: string;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

export interface POChange {
  field: string;
  previousValue: unknown;
  newValue: unknown;
  changeType: 'added' | 'modified' | 'removed';
}

// Enums
export enum POStatus {
  DRAFT = 'DRAFT',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  SENT = 'SENT',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  IN_PROGRESS = 'IN_PROGRESS',
  PARTIALLY_DELIVERED = 'PARTIALLY_DELIVERED',
  DELIVERED = 'DELIVERED',
  INVOICED = 'INVOICED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  SUSPENDED = 'SUSPENDED'
}

export enum POApprovalStatus {
  NOT_REQUIRED = 'NOT_REQUIRED',
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED'
}

export enum POOrderType {
  GOODS = 'GOODS',
  SERVICES = 'SERVICES',
  MIXED = 'MIXED'
}

export enum PODeliveryStatus {
  NOT_STARTED = 'NOT_STARTED',
  IN_TRANSIT = 'IN_TRANSIT',
  PARTIALLY_DELIVERED = 'PARTIALLY_DELIVERED',
  FULLY_DELIVERED = 'FULLY_DELIVERED',
  DELIVERY_ISSUES = 'DELIVERY_ISSUES'
}

export enum POInvoiceStatus {
  NOT_INVOICED = 'NOT_INVOICED',
  PARTIALLY_INVOICED = 'PARTIALLY_INVOICED',
  FULLY_INVOICED = 'FULLY_INVOICED',
  INVOICE_DISCREPANCIES = 'INVOICE_DISCREPANCIES'
}

export enum POItemStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  IN_PRODUCTION = 'IN_PRODUCTION',
  READY_FOR_DELIVERY = 'READY_FOR_DELIVERY',
  DELIVERED = 'DELIVERED',
  INVOICED = 'INVOICED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED'
}

export enum ApprovalLevel {
  AUTOMATIC = 'AUTOMATIC',
  SUPERVISOR = 'SUPERVISOR',
  MANAGER = 'MANAGER',
  DIRECTOR = 'DIRECTOR',
  BOARD = 'BOARD'
}

export enum ApprovalStepStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  SKIPPED = 'SKIPPED'
}

export enum ApprovalDecision {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
  REQUEST_CHANGES = 'REQUEST_CHANGES'
}

export enum DeliveryNoteStatus {
  PENDING = 'PENDING',
  RECEIVED = 'RECEIVED',
  QUALITY_CHECK_FAILED = 'QUALITY_CHECK_FAILED',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED'
}

export enum ItemCondition {
  GOOD = 'GOOD',
  DAMAGED = 'DAMAGED',
  INCOMPLETE = 'INCOMPLETE',
  WRONG_ITEM = 'WRONG_ITEM'
}

export enum InvoiceMatchingStatus {
  NOT_MATCHED = 'NOT_MATCHED',
  PARTIALLY_MATCHED = 'PARTIALLY_MATCHED',
  FULLY_MATCHED = 'FULLY_MATCHED',
  DISCREPANCIES = 'DISCREPANCIES'
}

export enum PaymentStatus {
  NOT_DUE = 'NOT_DUE',
  DUE = 'DUE',
  OVERDUE = 'OVERDUE',
  PAID = 'PAID',
  PARTIALLY_PAID = 'PARTIALLY_PAID',
  CANCELLED = 'CANCELLED'
}

export enum AmendmentType {
  QUANTITY_CHANGE = 'QUANTITY_CHANGE',
  PRICE_CHANGE = 'PRICE_CHANGE',
  DELIVERY_CHANGE = 'DELIVERY_CHANGE',
  SPECIFICATION_CHANGE = 'SPECIFICATION_CHANGE',
  TERMS_CHANGE = 'TERMS_CHANGE',
  CANCELLATION = 'CANCELLATION',
  ADDITION = 'ADDITION'
}

export enum AmendmentStatus {
  DRAFT = 'DRAFT',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED'
}

// Filter and Query Types
export interface POFilters {
  projectId?: string;
  supplierId?: string;
  status?: POStatus[];
  approvalStatus?: POApprovalStatus[];
  deliveryStatus?: PODeliveryStatus[];
  invoiceStatus?: POInvoiceStatus[];
  dateRange?: {
    start: Date;
    end: Date;
  };
  amountRange?: {
    min: number;
    max: number;
  };
  searchTerm?: string;
}

export interface POListItem {
  id: string;
  poNumber: string;
  title: string;
  supplier: {
    id: string;
    name: string;
  };
  status: POStatus;
  approvalStatus: POApprovalStatus;
  deliveryStatus: PODeliveryStatus;
  invoiceStatus: POInvoiceStatus;
  totalAmount: number;
  currency: string;
  expectedDeliveryDate?: Date;
  issuedAt?: Date;
  createdAt: Date;
  
  // Counts for quick reference
  itemCount: number;
  deliveredItemCount: number;
  invoicedItemCount: number;
}

// Statistics and Analytics Types
export interface POStats {
  total: number;
  byStatus: Record<POStatus, number>;
  byApprovalStatus: Record<POApprovalStatus, number>;
  totalValue: number;
  averageValue: number;
  
  // Delivery Performance
  onTimeDeliveries: number;
  lateDeliveries: number;
  averageDeliveryDays: number;
  
  // Processing Times
  averageApprovalDays: number;
  averageProcessingDays: number;
  
  // Trends
  monthlyStats: POMonthlyStats[];
}

export interface POMonthlyStats {
  month: string;
  count: number;
  value: number;
  onTimeDeliveryRate: number;
  averageProcessingDays: number;
}

// Form Types for Creation/Editing
export interface CreatePORequest {
  projectId: string;
  rfqId?: string;
  quoteId?: string;
  supplierId: number; // Database uses integer
  title: string;
  description?: string;
  orderType: POOrderType;
  
  // Terms
  paymentTerms: string;
  deliveryTerms: string;
  expectedDeliveryDate?: Date;
  
  // Address
  deliveryAddress: POAddress;
  
  // Items
  items: CreatePOItemRequest[];
  
  // Notes
  notes?: string;
  internalNotes?: string;
}

export interface CreatePOItemRequest {
  rfqItemId?: string;
  description: string;
  category?: string;
  quantity: number;
  uom: string;
  unitPrice: number;
  expectedDeliveryDate?: Date;
  specifications?: Record<string, unknown>;
}