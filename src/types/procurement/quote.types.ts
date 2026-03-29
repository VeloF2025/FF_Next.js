/**
 * Quote Types
 * Formal supplier quotes - can be from RFQ responses or standalone
 * Note: These are standalone quote types. For RFQ-related quotes, see ./rfq/quote.types.ts
 */

export type StandaloneQuoteStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'converted';

export interface StandaloneQuote {
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
  status: StandaloneQuoteStatus;

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
  attachments?: StandaloneQuoteAttachment[];
  internalNotes?: string;
  supplierNotes?: string;

  // Audit
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface StandaloneQuoteAttachment {
  id: string;
  name: string;
  url: string;
  type: string;
  size: number;
  uploadedAt: Date;
}

export interface StandaloneQuoteItem {
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
export interface StandaloneQuoteListItem {
  id: string;
  quoteNumber: string;
  supplierName: string;
  supplierId: number;
  projectId?: string;
  projectName?: string;
  title?: string;
  status: StandaloneQuoteStatus;
  totalAmount?: number;
  currency: string;
  quoteDate: Date;
  validUntil?: Date;
  itemCount: number;
  rfqNumber?: string;
  createdAt: Date;
}

// Create/Update DTOs
export interface CreateStandaloneQuoteRequest {
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
  items: CreateStandaloneQuoteItemRequest[];
  internalNotes?: string;
  supplierNotes?: string;
}

export interface CreateStandaloneQuoteItemRequest {
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

export interface UpdateStandaloneQuoteRequest {
  title?: string;
  description?: string;
  referenceNumber?: string;
  status?: StandaloneQuoteStatus;
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
export interface StandaloneQuoteFilters {
  projectId?: string;
  supplierId?: number;
  rfqId?: string;
  status?: StandaloneQuoteStatus[];
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
export interface StandaloneQuoteStats {
  total: number;
  byStatus: Record<StandaloneQuoteStatus, number>;
  totalValue: number;
  averageValue: number;
  averageEvaluationScore: number;
  conversionRate: number; // % of quotes converted to PO
  averageValidityDays: number;
}

// Quote comparison (for evaluation)
export interface StandaloneQuoteComparison {
  quotes: StandaloneQuote[];
  items: StandaloneQuoteComparisonItem[];
  summary: StandaloneQuoteComparisonSummary;
}

export interface StandaloneQuoteComparisonItem {
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

export interface StandaloneQuoteComparisonSummary {
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
