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

// Services are deliberately NOT re-exported here.
//
// `export * from './services'` reached quoteExtractionService, which imports
// vlmLearningService, which runs `neon(process.env.DATABASE_URL)` at MODULE
// SCOPE — so merely importing this barrel put a database client construction
// and the @neondatabase driver into the browser bundle for the only page that
// uses it, /procurement/rfq/[id], which imports QuoteScannerModal and nothing
// else. Confirmed in .next/static before this change, absent after.
//
// Nothing outside this module imported the services through the barrel or
// directly, so narrowing it breaks no caller. Server code should import
// './services/<name>' explicitly.

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
