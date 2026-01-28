/**
 * Quote Scanner Module
 *
 * OCR/VLM-based supplier quote document scanning with RFQ matching
 *
 * Features:
 * - Upload PDF or image quote documents
 * - Extract supplier info, line items, and totals using VLM
 * - Auto-match extracted items to RFQ items
 * - Manual matching adjustment
 * - Pre-populate quote submission forms
 *
 * Usage:
 * ```tsx
 * import { QuoteScannerModal } from '@/modules/procurement/quote-scanner';
 *
 * <QuoteScannerModal
 *   isOpen={isOpen}
 *   onClose={() => setIsOpen(false)}
 *   projectId={project.id}
 *   rfqId={rfq.id}
 *   rfqNumber={rfq.rfqNumber}
 *   onExtractionComplete={(extraction, matching, extractionId) => {
 *     // Handle extracted data
 *   }}
 * />
 * ```
 *
 * Status: WORKING - Phase 1 Complete
 */

// Components
export * from './components';

// Services
export * from './services';

// Types
export type {
  QuoteExtractionResult,
  ExtractedSupplier,
  ExtractedQuoteInfo,
  ExtractedLineItem,
  ExtractedTotals,
  QuoteMatchingResult,
  ItemMatchResult,
  MatchReason,
  ExtractionMethod,
  ExtractionStatus,
  QuoteExtraction,
  QuoteExtractionItem,
  ExtractQuoteRequest,
  ExtractQuoteResponse,
  ApplyExtractionRequest,
  ApplyExtractionResponse,
  ScannerModalState,
  EditableExtractionItem,
  QuoteExtractionResultsProps,
  QuoteMatchingReviewProps,
} from './types/extraction.types';
