/** Timestamp values from Neon PostgreSQL are returned as strings or Date objects */
type Timestamp = string | Date;

import { Currency, UnitOfMeasure } from './stock.types';

// ============= Purchase Order Types =============

export type POStatus = 'draft' | 'pending_approval' | 'approved' | 'sent' | 'acknowledged' | 'partial' | 'fulfilled' | 'cancelled';
export type DeliveryStatus = 'pending' | 'shipped' | 'partial' | 'delivered' | 'returned';
export type PaymentStatus = 'pending' | 'partial' | 'paid' | 'overdue' | 'disputed';

export interface PurchaseOrder {
  id?: string;
  number: string; // Unique PO number
  
  // Reference
  quoteId?: string;
  quoteNumber?: string;
  rfqId?: string;
  rfqNumber?: string;
  projectId?: string;
  projectName?: string;
  
  // Supplier
  supplierId: number; // Database uses integer
  supplierName: string;
  supplierContact?: string;
  supplierEmail?: string;
  supplierPhone?: string;
  supplierAddress?: string;
  
  // Status
  status: POStatus;
  
  // Items
  items: POItem[];
  totalItems: number;
  
  // Financials
  subtotal: number;
  discount?: number;
  discountPercent?: number;
  vat: number;
  vatRate: number;
  shipping?: number;
  total: number;
  currency: Currency;
  
  // Delivery
  deliveryDate: Timestamp;
  deliveryAddress: string;
  deliveryContact?: string;
  deliveryPhone?: string;
  deliveryTerms?: string;
  deliveryStatus: DeliveryStatus;
  
  // Payment
  paymentTerms: string;
  paymentDueDate?: Timestamp;
  paymentStatus: PaymentStatus;
  
  // Terms
  termsAndConditions?: string;
  specialInstructions?: string;
  
  // Metadata
  notes?: string;
  internalNotes?: string;
  attachments?: string[];
  
  // Workflow
  createdAt: Timestamp;
  createdBy: string;
  createdByName: string;
  
  submittedForApprovalAt?: Timestamp;
  submittedBy?: string;
  
  approvedAt?: Timestamp;
  approvedBy?: string;
  approvedByName?: string;
  approvalNotes?: string;
  
  sentAt?: Timestamp;
  sentBy?: string;
  sentMethod?: 'email' | 'portal' | 'manual';
  
  acknowledgedAt?: Timestamp;
  acknowledgementRef?: string;
  
  cancelledAt?: Timestamp;
  cancelledBy?: string;
  cancellationReason?: string;
}

export interface POItem {
  id: string;
  
  // Item details
  itemCode: string;
  itemName: string;
  description?: string;
  specifications?: string;
  
  // Quantities
  quantity: number;
  unit: UnitOfMeasure;
  
  // Pricing
  unitPrice: number;
  totalPrice: number;
  currency: Currency;
  
  // Reference
  stockItemId?: string;
  boqItemId?: string;
  rfqItemId?: string;
  quoteItemId?: string;
  
  // Delivery
  expectedDeliveryDate?: Timestamp;
  deliveredQuantity: number;
  deliveryNotes?: string;
  
  // Status
  status: 'pending' | 'partial' | 'delivered' | 'cancelled';
  
  // Metadata
  notes?: string;
}

export interface PODelivery {
  id?: string;
  poId: string;
  poNumber: string;
  
  // Delivery details
  deliveryNumber: string;
  deliveryDate: Timestamp;
  
  // Items
  items: PODeliveryItem[];
  
  // Status
  status: 'pending' | 'received' | 'partial' | 'rejected';
  
  // Verification
  receivedBy?: string;
  receivedByName?: string;
  receivedAt?: Timestamp;
  
  verifiedBy?: string;
  verifiedByName?: string;
  verifiedAt?: Timestamp;
  
  // Documentation
  deliveryNoteNumber?: string;
  invoiceNumber?: string;
  attachments?: string[];
  
  // Issues
  hasIssues: boolean;
  issues?: Array<{
    itemId: string;
    issueType: 'quantity' | 'quality' | 'damage' | 'wrong_item' | 'other';
    description: string;
    resolution?: string;
  }>;
  
  // Metadata
  notes?: string;
  photos?: string[];
  
  createdAt: Timestamp;
  createdBy: string;
}

export interface PODeliveryItem {
  poItemId: string;
  itemCode: string;
  itemName: string;
  
  // Quantities
  orderedQuantity: number;
  deliveredQuantity: number;
  acceptedQuantity: number;
  rejectedQuantity: number;
  
  // Status
  status: 'accepted' | 'partial' | 'rejected';
  rejectionReason?: string;
  
  // Location
  stockLocation?: string;
  binNumber?: string;
  
  // Quality
  qualityCheckPassed?: boolean;
  qualityNotes?: string;
  
  // Metadata
  batchNumber?: string;
  serialNumbers?: string[];
  expiryDate?: Timestamp;
  notes?: string;
}

export interface POPayment {
  id?: string;
  poId: string;
  poNumber: string;
  
  // Payment details
  paymentNumber: string;
  paymentDate: Timestamp;
  amount: number;
  currency: Currency;
  
  // Method
  paymentMethod: 'bank_transfer' | 'cheque' | 'cash' | 'credit' | 'other';
  reference?: string;
  
  // Status
  status: 'pending' | 'processed' | 'confirmed' | 'failed';
  
  // Bank details (if applicable)
  bankName?: string;
  accountNumber?: string;
  transactionId?: string;
  
  // Documentation
  invoiceNumber?: string;
  receiptNumber?: string;
  attachments?: string[];
  
  // Metadata
  notes?: string;
  
  // Workflow
  processedAt?: Timestamp;
  processedBy?: string;
  processedByName?: string;
  
  confirmedAt?: Timestamp;
  confirmedBy?: string;
  confirmationRef?: string;
}

export interface POApproval {
  id?: string;
  poId: string;
  poNumber: string;
  poTotal: number;
  
  // Approval chain
  level: number;
  requiredApprovers: string[];
  currentApprover?: string;
  
  // Status
  status: 'pending' | 'approved' | 'rejected' | 'escalated';
  
  // Decision
  decision?: 'approve' | 'reject' | 'request_changes';
  decisionNotes?: string;
  
  // Conditions
  conditions?: string[];
  
  // Metadata
  requestedAt: Timestamp;
  requestedBy: string;
  
  decidedAt?: Timestamp;
  decidedBy?: string;
  decidedByName?: string;
  
  escalatedAt?: Timestamp;
  escalatedTo?: string;
  escalationReason?: string;
}