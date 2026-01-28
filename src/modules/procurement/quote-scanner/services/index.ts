/**
 * Quote Scanner Services
 *
 * VLM extraction and RFQ matching services
 */

export {
  extractQuoteFromImage,
  extractQuoteFromImageUrl,
  extractQuoteFromMultipleImages,
  calculateExtractionConfidence,
  isValidExtraction,
} from './quoteExtractionService';

export {
  matchExtractedToRfq,
  applyManualMatch,
  getMatchingSummary,
  type RfqItem,
} from './quoteMatchingService';
