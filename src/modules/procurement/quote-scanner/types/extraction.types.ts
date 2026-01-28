/**
 * Quote Extraction Types
 * Types for OCR/VLM quote document extraction and RFQ matching
 */

// =============================================================================
// EXTRACTION TYPES
// =============================================================================

export type ExtractionMethod = 'vlm' | 'ocr' | 'manual';
export type ExtractionStatus = 'processing' | 'extracted' | 'matched' | 'applied' | 'failed' | 'cancelled';
export type MatchReason = 'exact_code' | 'fuzzy_description' | 'quantity_unit' | 'manual' | 'unmatched';

/**
 * Extracted supplier information from quote document
 */
export interface ExtractedSupplier {
  name: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  vatNumber?: string | null;
  contactPerson?: string | null;
}

/**
 * Extracted quote metadata
 */
export interface ExtractedQuoteInfo {
  quoteNumber: string | null;
  quoteDate: string | null; // YYYY-MM-DD
  validUntil: string | null; // YYYY-MM-DD
  paymentTerms: string | null;
  deliveryTerms: string | null;
  deliveryDays: number | null;
  reference?: string | null;
}

/**
 * Extracted line item from quote
 */
export interface ExtractedLineItem {
  lineNumber: number;
  itemCode: string | null;
  description: string;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  totalPrice: number | null;
  notes?: string | null;
  confidence: number; // 0-1
}

/**
 * Extracted totals from quote
 */
export interface ExtractedTotals {
  subtotal: number | null;
  vatRate: number | null; // e.g., 15 for 15%
  vatAmount: number | null;
  total: number | null;
  currency: string; // Default: ZAR
}

/**
 * Complete extraction result from VLM/OCR
 */
export interface QuoteExtractionResult {
  supplier: ExtractedSupplier;
  quoteInfo: ExtractedQuoteInfo;
  lineItems: ExtractedLineItem[];
  totals: ExtractedTotals;
  extractionNotes?: string;
  rawResponse?: string; // Original VLM response for debugging
}

// =============================================================================
// MATCHING TYPES
// =============================================================================

/**
 * Result of matching an extracted item to an RFQ item
 */
export interface ItemMatchResult {
  extractedIndex: number;
  extractedDescription: string;
  rfqItemId: string | null;
  rfqItemDescription?: string;
  rfqItemCode?: string;
  matchConfidence: number; // 0-1
  matchReason: MatchReason;
  quantityMatch: boolean;
  priceDifferencePercent?: number;
}

/**
 * Complete matching result for all items
 */
export interface QuoteMatchingResult {
  rfqId: string;
  rfqNumber: string;
  matchedItems: ItemMatchResult[];
  totalMatched: number;
  totalUnmatched: number;
  overallConfidence: number;
  warnings: string[];
}

// =============================================================================
// DATABASE ENTITY TYPES
// =============================================================================

/**
 * Quote extraction database record
 */
export interface QuoteExtraction {
  id: string;
  rfqId: string | null;
  projectId: string;
  supplierId: number | null;

  // Document info
  documentUrl: string;
  documentType: 'pdf' | 'image';
  documentName: string | null;
  documentSize: number | null;

  // Extracted supplier
  extractedSupplierName: string | null;
  extractedSupplierEmail: string | null;
  extractedSupplierPhone: string | null;
  extractedSupplierVat: string | null;

  // Extracted quote info
  extractedQuoteNumber: string | null;
  extractedQuoteDate: string | null;
  extractedValidUntil: string | null;
  extractedPaymentTerms: string | null;
  extractedDeliveryTerms: string | null;
  extractedDeliveryDays: number | null;

  // Extracted totals
  extractedSubtotal: number | null;
  extractedVatRate: number | null;
  extractedVatAmount: number | null;
  extractedTotal: number | null;
  extractedCurrency: string;

  // Full extraction data
  extractionData: QuoteExtractionResult;

  // Metadata
  extractionMethod: ExtractionMethod;
  confidenceScore: number | null;
  processingTimeMs: number | null;
  extractionNotes: string | null;

  // Matching
  matchingData: QuoteMatchingResult | null;
  matchedItemsCount: number;
  unmatchedItemsCount: number;

  // Status
  status: ExtractionStatus;
  errorMessage: string | null;
  appliedToQuoteId: string | null;

  // Audit
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Quote extraction item database record
 */
export interface QuoteExtractionItem {
  id: string;
  extractionId: string;

  lineNumber: number;
  itemCode: string | null;
  description: string;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  totalPrice: number | null;
  notes: string | null;

  confidenceScore: number | null;

  matchedRfqItemId: string | null;
  matchConfidence: number | null;
  matchReason: MatchReason | null;

  isMatched: boolean;
  isSkipped: boolean;
  skipReason: string | null;

  createdAt: string;
}

// =============================================================================
// API REQUEST/RESPONSE TYPES
// =============================================================================

/**
 * Request body for extract-from-document API
 */
export interface ExtractQuoteRequest {
  rfqId?: string; // Optional - for auto-matching
  projectId: string;
  supplierId?: number; // Optional - if known
}

/**
 * Response from extract-from-document API
 */
export interface ExtractQuoteResponse {
  success: boolean;
  extractionId: string;
  extraction: QuoteExtractionResult;
  matching?: QuoteMatchingResult;
  documentUrl: string;
  processingTimeMs: number;
  warnings?: string[];
  error?: string;
}

/**
 * Request to apply extraction to create a quote
 */
export interface ApplyExtractionRequest {
  extractionId: string;
  rfqId: string;
  supplierId: number;
  itemMappings: Array<{
    extractedIndex: number;
    rfqItemId: string;
    unitPrice?: number; // Override if needed
    quantity?: number; // Override if needed
  }>;
  overrides?: {
    quoteNumber?: string;
    validUntil?: string;
    paymentTerms?: string;
    deliveryTerms?: string;
  };
}

/**
 * Response from apply extraction
 */
export interface ApplyExtractionResponse {
  success: boolean;
  quoteId: string;
  quoteNumber: string;
  itemsCreated: number;
  warnings?: string[];
}

// =============================================================================
// UI STATE TYPES
// =============================================================================

/**
 * State for QuoteScannerModal
 */
export interface ScannerModalState {
  step: 'upload' | 'processing' | 'review' | 'matching' | 'complete';
  file: File | null;
  previewUrl: string | null;
  extractionResult: QuoteExtractionResult | null;
  matchingResult: QuoteMatchingResult | null;
  error: string | null;
  isProcessing: boolean;
}

/**
 * Editable extraction item for review
 */
export interface EditableExtractionItem extends ExtractedLineItem {
  isEdited: boolean;
  isSelected: boolean;
  manualMatchedRfqItemId?: string;
}

/**
 * Props for QuoteExtractionResults component
 */
export interface QuoteExtractionResultsProps {
  extraction: QuoteExtractionResult;
  onItemEdit: (index: number, item: Partial<ExtractedLineItem>) => void;
  onItemToggle: (index: number, selected: boolean) => void;
  editableItems: EditableExtractionItem[];
}

/**
 * Props for QuoteMatchingReview component
 */
export interface QuoteMatchingReviewProps {
  extraction: QuoteExtractionResult;
  matching: QuoteMatchingResult;
  rfqItems: Array<{
    id: string;
    description: string;
    itemCode?: string;
    quantity: number;
    unit: string;
  }>;
  onMatchChange: (extractedIndex: number, rfqItemId: string | null) => void;
  onConfirm: () => void;
  onCancel: () => void;
}
