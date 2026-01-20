/**
 * Quote Types
 * Formal supplier quotes - can be from RFQ responses or standalone
 */

export type QuoteStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'converted';

export interface Quote {
  id: string;
  quoteNumber: string;

  // Source linkage
  rfqId?: string;
  rfqResponseId?: string;

  // Supplier
  supplierId: number;
  supplierName?: string;
  supplierContact?: string;
  supplierEmail?: string;

  // Context
  projectId?: string;

  // Details
  title?: string;
  description?: string;
  referenceNumber?: string; // Supplier's quote reference

  // Dates
  quoteDate: Date;
  validFrom?: Date;
  validUntil?: Date;

  // Status
  status: QuoteStatus;

  // Financials
  currency: string;
  subtotal?: number;
  taxRate?: number;
  taxAmount?: number;
  discountAmount?: number;
  shippingCost?: number;
  totalAmount?: number;

  // Terms
  paymentTerms?: string;
  deliveryTerms?: string;
  deliveryDays?: number;
  warrantyTerms?: string;

  // Evaluation
  evaluationScore?: number;
  evaluationNotes?: string;
  evaluatedBy?: string;
  evaluatedAt?: Date;

  // Conversion tracking
  convertedToPoId?: string;
  convertedAt?: Date;
  convertedBy?: string;

  // Notes
  attachments?: QuoteAttachment[];
  internalNotes?: string;
  supplierNotes?: string;

  // Audit
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuoteAttachment {
  id: string;
  name: string;
  url: string;
  type: string;
  size: number;
  uploadedAt: Date;
}

export interface QuoteItem {
  id: string;
  quoteId: string;

  // Item reference
  rfqItemId?: string;
  stockItemId?: string;
  boqItemId?: string;

  // Item details
  lineNumber: number;
  itemCode?: string;
  itemDescription: string;
  specifications?: string;

  // Quantities
  quantity: number;
  uom: string;

  // Pricing
  unitPrice: number;
  discountPercent?: number;
  taxRate?: number;
  taxAmount?: number;
  lineTotal?: number;

  // Delivery
  leadTimeDays?: number;
  availabilityStatus?: 'in_stock' | 'on_order' | 'make_to_order';

  // Alternative offering
  isAlternative?: boolean;
  originalItemId?: string;
  alternativeReason?: string;

  notes?: string;
  createdAt: Date;
}

// List view for quotes
export interface QuoteListItem {
  id: string;
  quoteNumber: string;
  supplierName: string;
  supplierId: number;
  projectId?: string;
  projectName?: string;
  title?: string;
  status: QuoteStatus;
  totalAmount?: number;
  currency: string;
  quoteDate: Date;
  validUntil?: Date;
  itemCount: number;
  rfqNumber?: string;
  createdAt: Date;
}

// Create/Update DTOs
export interface CreateQuoteRequest {
  supplierId: number;
  projectId?: string;
  rfqId?: string;
  title?: string;
  description?: string;
  referenceNumber?: string;
  quoteDate?: Date;
  validUntil?: Date;
  paymentTerms?: string;
  deliveryTerms?: string;
  items: CreateQuoteItemRequest[];
  internalNotes?: string;
  supplierNotes?: string;
}

export interface CreateQuoteItemRequest {
  rfqItemId?: string;
  stockItemId?: string;
  boqItemId?: string;
  itemCode?: string;
  itemDescription: string;
  specifications?: string;
  quantity: number;
  uom: string;
  unitPrice: number;
  discountPercent?: number;
  taxRate?: number;
  leadTimeDays?: number;
  availabilityStatus?: 'in_stock' | 'on_order' | 'make_to_order';
  isAlternative?: boolean;
  originalItemId?: string;
  alternativeReason?: string;
  notes?: string;
}

export interface UpdateQuoteRequest {
  title?: string;
  description?: string;
  referenceNumber?: string;
  status?: QuoteStatus;
  validUntil?: Date;
  paymentTerms?: string;
  deliveryTerms?: string;
  warrantyTerms?: string;
  internalNotes?: string;
  supplierNotes?: string;
  evaluationScore?: number;
  evaluationNotes?: string;
}

// Filters
export interface QuoteFilters {
  projectId?: string;
  supplierId?: number;
  rfqId?: string;
  status?: QuoteStatus[];
  searchTerm?: string;
  dateRange?: {
    start: Date;
    end: Date;
  };
  amountRange?: {
    min: number;
    max: number;
  };
}

// Stats
export interface QuoteStats {
  total: number;
  byStatus: Record<QuoteStatus, number>;
  totalValue: number;
  averageValue: number;
  averageEvaluationScore: number;
  conversionRate: number; // % of quotes converted to PO
  averageValidityDays: number;
}

// Quote comparison (for evaluation)
export interface QuoteComparison {
  quotes: Quote[];
  items: QuoteComparisonItem[];
  summary: QuoteComparisonSummary;
}

export interface QuoteComparisonItem {
  rfqItemId: string;
  itemCode?: string;
  description: string;
  quantity: number;
  uom: string;
  quotedPrices: {
    quoteId: string;
    supplierName: string;
    unitPrice: number;
    lineTotal: number;
    leadTimeDays?: number;
    isLowest: boolean;
  }[];
  lowestPrice: number;
  highestPrice: number;
  averagePrice: number;
}

export interface QuoteComparisonSummary {
  rfqId: string;
  rfqNumber: string;
  totalQuotes: number;
  lowestTotalQuote: {
    quoteId: string;
    supplierName: string;
    totalAmount: number;
  };
  highestTotalQuote: {
    quoteId: string;
    supplierName: string;
    totalAmount: number;
  };
  averageTotalAmount: number;
  potentialSavings: number; // Difference between highest and lowest
}
